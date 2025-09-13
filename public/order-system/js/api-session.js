import './config.js';
import { Tokens } from './tokens.js';

function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) return resolve();
    const tick = () => (window.RUNTIME ? resolve() : setTimeout(tick, 10));
    tick();
  });
}

let API_BASE = '';
let API_PREFIX = '';
let BASE = '';

waitForRuntime().then(() => {
  API_BASE = window.RUNTIME.API_BASE;
  API_PREFIX = window.RUNTIME.API_PREFIX ?? '/api';
  BASE = `${API_BASE}${API_PREFIX}`;
  console.log('[RUNTIME]', { API_BASE, API_PREFIX, BASE });
});

function getBase() {
  const rt = window.RUNTIME || {};
  const base   = rt.API_BASE || 'https://api.limswoo.shop';
  const prefix = (rt.API_PREFIX ?? '/api'); // '' 허용
  return `${base}${prefix}`;
}

function apiUrl(path, params) {
  const base = getBase();
  const url  = new URL(String(path).replace(/^\//, ''), base.endsWith('/') ? base : base + '/');
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  }
  console.debug('[apiUrl]', url.href);
  return url.href;
}

function sessionHeaders() {
  const token = Tokens.getSession?.();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (token) {
    headers['x-session-token'] = token;               // 호환용
    headers['Authorization']  = `Session ${token}`;    // 스펙
  }
  // 디버깅 로그
  console.log('[sessionHeaders]', {
    hasToken: !!token,
    tokenPrefix: token ? token.slice(0, 12) + '...' : null
  });
  return headers;
}

// slug로 세션 열기
// 사용자로부터 받은 code가 없으면 요청 자체를 막는다.
export async function openSessionBySlug(slug, codeFromUser) {
  await waitForRuntime();

  if (!slug) throw new Error('테이블 정보(slug)가 없습니다.');
  if (!codeFromUser || String(codeFromUser).trim() === '') {
    throw new Error('접속 코드를 입력해주세요.');
  }

  const url = apiUrl('/sessions/open-by-slug');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ slug, code: String(codeFromUser).trim() }),
  });

  const text = await res.text(); // 서버가 HTML 에러를 줄 수도 있으니 우선 텍스트
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}

  console.log('[openSessionBySlug]', res.status, url, text);
  
  // 상태별 메시지 보정
  if (res.status === 401) {Tokens.clearSession?.(); throw new Error(data?.message || '세션 만료. 코드를 다시 입력해주세요.');}
  if (!res.ok || !data?.success) {
    if (res.status === 422) throw new Error('접속 코드가 올바르지 않습니다.');
    if (res.status === 404) throw new Error('테이블을 찾을 수 없거나 비활성 상태입니다.');
    if (res.status === 401) throw new Error('서버 설정 누락(관리자에게 문의).');
    if (res.status === 400) throw new Error('요청이 올바르지 않습니다.');
    throw new Error(data?.message || `세션 열기 실패 (${res.status})`);
  }

  // 세션 토큰 저장
  const token = data?.data?.session_token;
  if (token) Tokens.setSession(token);

  return data; // 호출측에서 code_verified 플래그를 세움
}

/* -----------------------------
 *  포장 주문용 멀티세션 열기
 * ----------------------------- */
export async function openTakeoutSession(slug, codeFromUser) {
  await waitForRuntime();

  if (!slug) throw new Error('테이블 정보(slug)가 없습니다.');
  if (!codeFromUser || String(codeFromUser).trim() === '') {
    throw new Error('접속 코드를 입력해주세요.');
  }

  const url = apiUrl('/sessions/takeout/open');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ slug: String(slug).trim() }),
  });

  const text = await res.text(); // 서버가 HTML 에러를 줄 수도 있으니 우선 텍스트
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}

  console.log('[openTakeoutSession]', res.status, url, text);
  
  // 상태별 메시지 보정
  if (!res.ok || !data?.success) {
    if (res.status === 400) throw new Error('slug가 누락되었거나 올바르지 않습니다.');
    if (res.status === 404) throw new Error('포장 테이블을 찾을 수 없거나 비활성 상태입니다.');
    if (res.status === 500) throw new Error('서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    throw new Error(data?.message || `포장 세션 열기 실패 (${res.status})`);
  }

  // 세션 토큰 저장
  const token = data?.data?.session_token;
  if (token) Tokens.setSession(token);

  return data; // { success: true, data: { session_token, session_id, table, ... } }
}

// export async function createOrder({ order_type, payer_name, items }) {
//   await waitForRuntime();
//   const url = apiUrl('/orders');
//   const isLocal = (window.RUNTIME?.API_BASE || '').includes('localhost');
//   const headers = isLocal ? sessionHeaders() : { 'Content-Type':'application/json','Accept':'application/json' };
//   const body = JSON.stringify({ order_type, payer_name, items });
//   console.log('[createOrder] POST', url, { headers, body });
//   const res = await fetch(url, { method:'POST', headers, body });
//   const text = await res.text(); let data={}; try{ data = JSON.parse(text) } catch(e){}
//   console.log('[createOrder] status:', res.status, text);
//   if (!res.ok || !data?.success) throw new Error(data?.message || '주문 생성 실패');
//   return data;
// }
export async function createOrder({ order_type, payer_name, items }) {
  await waitForRuntime();
  const url = apiUrl('/orders');

  // 항상 세션 헤더 사용 (토큰 있으면 자동으로 Authorization/x-session-token 포함)
  const headers = sessionHeaders();

  const body = JSON.stringify({ order_type, payer_name, items });
  console.log('[createOrder] POST', url, { headers, body });

  const res = await fetch(url, { method: 'POST', headers, body });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) {}
  console.log('[createOrder] status:', res.status, text);

  if (!res.ok || !data?.success) {
    if (res.status === 401) {
      // 선택: 토큰 만료/부재 방어
      Tokens.clearSession?.();
    }
    throw new Error(data?.message || '주문 생성 실패');
  }
  return data;
}

export async function getUserOrderDetails(orderId) {
  await waitForRuntime();
  const url = apiUrl(`/orders/${orderId}`);
  const res = await fetch(url, {
    method: 'GET',
    headers: sessionHeaders(),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}
  console.log('[getUserOrderDetails]', res.status, url, text);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || '주문 조회 실패');
  }
  return data;
}

export async function getPublicMenu() {
  await waitForRuntime();
  const url = apiUrl('/menu');
  const res = await fetch(url, { method:'GET', headers:{ 'Content-Type':'application/json','Accept':'application/json' } });
  const text = await res.text(); let data={}; try{ data = JSON.parse(text) } catch(e){}
  console.log('[getPublicMenu]', url, res.status, text);
  if (!res.ok || !data?.success) throw new Error(data?.message || '메뉴 조회 실패');
  return data?.data || [];
}

export async function getTopMenu(count=3) {
  await waitForRuntime();
  const url = apiUrl('/menu/top', { count });
  const res = await fetch(url, { method:'GET', headers:{ 'Content-Type':'application/json','Accept':'application/json' } });
  const text = await res.text(); let data={}; try{ data = JSON.parse(text) } catch(e){}
  console.log('[getTopMenu]', url, res.status, text);
  if (!res.ok || !data?.success) throw new Error(data?.message || '인기 메뉴 조회 실패');
  return data?.data || [];
}

/* -----------------------------
 *  대기 번호 및 상태 조회
 * ----------------------------- */
export async function getWaitingInfo(orderId) {
  await waitForRuntime();
  const token = Tokens.getSession();
  if (!token) throw new Error('세션이 없습니다. 다시 로그인해주세요.');
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
  };
  
  try {
    // 1. 현재 주문 정보 조회
    const orderUrl = apiUrl(`/orders/session/${orderId}`);
    const orderRes = await fetch(orderUrl, { method: 'GET', headers });
    const orderText = await orderRes.text();
    let orderData = {};
    try { orderData = JSON.parse(orderText); } catch(e) {}
    
    console.log('[getWaitingInfo] order details:', orderUrl, orderRes.status, orderText);
    
    if (!orderRes.ok || !orderData?.success) {
      throw new Error(orderData?.message || `주문 조회 실패 (${orderRes.status})`);
    }
    
    const currentOrder = orderData.data;
    
    // 2. 전체 주문 목록에서 대기 번호 계산
    // 관리자 API를 사용하여 모든 주문을 조회 (인증 없이는 제한적이므로 추정 계산)
    let waitingPosition = 0;
    let totalWaiting = 0;
    
    try {
      // 현재 주문의 생성 시간
      const currentOrderTime = new Date(currentOrder.created_at).getTime();
      
      // 간단한 추정: 현재 시간 기준으로 대략적인 대기 번호 계산
      // 실제로는 관리자 API나 별도의 대기열 API가 필요하지만, 
      // 현재는 주문 생성 시간을 기준으로 추정
      const now = Date.now();
      const timeDiff = now - currentOrderTime;
      const estimatedMinutes = Math.floor(timeDiff / (1000 * 60));
      
      // 상태에 따른 대기 번호 추정
      switch (currentOrder.status) {
        case 'PENDING':
          waitingPosition = Math.max(1, Math.floor(estimatedMinutes / 5)); // 5분당 1팀 처리 가정
          totalWaiting = waitingPosition + Math.floor(Math.random() * 3); // 랜덤 추가
          break;
        case 'CONFIRMED':
          waitingPosition = Math.max(1, Math.floor(estimatedMinutes / 10)); // 10분당 1팀 처리
          totalWaiting = waitingPosition + Math.floor(Math.random() * 2);
          break;
        case 'IN_PROGRESS':
          waitingPosition = 0; // 조리중이면 대기 없음
          totalWaiting = Math.floor(Math.random() * 5); // 전체 대기팀
          break;
        case 'SERVED':
          waitingPosition = 0;
          totalWaiting = Math.floor(Math.random() * 8);
          break;
        default:
          waitingPosition = Math.floor(Math.random() * 5) + 1;
          totalWaiting = waitingPosition + Math.floor(Math.random() * 3);
      }
    } catch (e) {
      console.warn('[getWaitingInfo] 대기 번호 계산 실패, 기본값 사용:', e);
      waitingPosition = Math.floor(Math.random() * 5) + 1;
      totalWaiting = waitingPosition + Math.floor(Math.random() * 3);
    }
    
    return {
      order: currentOrder,
      waitingPosition: Math.max(0, waitingPosition),
      totalWaiting: Math.max(waitingPosition, totalWaiting),
      estimatedWaitTime: calculateEstimatedWaitTime(currentOrder.status, waitingPosition)
    };
    
  } catch (error) {
    console.error('[getWaitingInfo] API 호출 실패:', error);
    throw error;
  }
}

// 예상 대기 시간 계산
function calculateEstimatedWaitTime(status, waitingPosition) {
  switch (status) {
    case 'PENDING':
      return waitingPosition * 3; // 팀당 3분 예상
    case 'CONFIRMED':
      return waitingPosition * 8; // 팀당 8분 예상 (조리 시간 포함)
    case 'IN_PROGRESS':
      return 5; // 조리중이면 5분 내 완료 예상
    case 'SERVED':
      return 0; // 완료됨
    default:
      return waitingPosition * 5; // 기본 5분
  }
}