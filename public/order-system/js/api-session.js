// public/order-system/js/api-session.js
import { Tokens } from './tokens.js';

function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) return resolve();
    const tick = () => (window.RUNTIME ? resolve() : setTimeout(tick, 10));
    tick();
  });
}

let API_BASE = '';
waitForRuntime().then(() => { API_BASE = window.RUNTIME.API_BASE; });

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

  const res  = await fetch(`${API_BASE}/sessions/open-by-slug`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ slug, code: String(codeFromUser).trim() }),
  });

  const text = await res.text(); // 서버가 HTML 에러를 줄 수도 있으니 우선 텍스트
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}

  console.log('[openSessionBySlug] status:', res.status, 'body:', text);

  // 상태별 메시지 보정
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

// export async function openSessionBySlug(slug, codeFromUser) {
//   await waitForRuntime();
//   const code = (codeFromUser ?? window.RUNTIME.SESSION_OPEN_CODE);
//   const res  = await fetch(`${API_BASE}/sessions/open-by-slug`, {
//     method: 'POST',
//     headers: {'Content-Type':'application/json', 'Accept':'application/json'},
//     body: JSON.stringify({ slug, code }),
//   });

//   const text = await res.text(); // ← 먼저 텍스트로 받아서
//   let data = {};
//   try { data = JSON.parse(text); } catch(e) {}
//   console.log('[openSessionBySlug] status:', res.status, 'body:', text);

//   if (!res.ok || !data?.success) {
//     throw new Error(data?.message || `세션 열기 실패 (${res.status})`);
//   }
//   if (data?.data?.session_token) {
//     Tokens.setSession(data.data.session_token);
//   }
//   return data;
// }

// 주문 생성
export async function createOrder({ order_type, payer_name, items }) {
  await waitForRuntime();
  
  // 배포 서버와 로컬 서버 구분
  const isLocal = API_BASE.includes('localhost');
  const headers = isLocal ? sessionHeaders() : { 'Content-Type': 'application/json' };
  
  const body = JSON.stringify({ order_type, payer_name, items });
  console.log('[createOrder] POST /orders', { API_BASE, isLocal, headers, body });

  const res = await fetch(`${API_BASE}/orders`, { method: 'POST', headers, body });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}
  console.log('[createOrder] status:', res.status, 'body:', text);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || '주문 생성 실패');
  }
  return data;
}

export async function getUserOrderDetails(orderId) {
  await waitForRuntime();
  const res  = await fetch(`${API_BASE}/orders/${orderId}`, {
    method: 'GET',
    headers: sessionHeaders(),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}
  console.log('[getUserOrderDetails]', res.status, text);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || '주문 조회 실패');
  }
  return data;
}

// 공용 메뉴 조회
export async function getPublicMenu() {
  await waitForRuntime();
  const res = await fetch(`${API_BASE}/menu`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}
  console.log('[getPublicMenu]', res.status, text);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || '메뉴 조회 실패');
  }
  return data?.data || [];
}

// 인기 메뉴 Top N 조회
export async function getTopMenu(count = 3) {
  await waitForRuntime();
  const res = await fetch(`${API_BASE}/menu/top?count=${count}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch(e) {}
  console.log('[getTopMenu]', res.status, text);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || '인기 메뉴 조회 실패');
  }
  return data?.data || [];
}
