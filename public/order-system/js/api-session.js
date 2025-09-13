import './config.js';
import { Tokens, SessionStore } from './tokens.js';

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

export function sessionHeaders(arg = {}) {
  const opt =
    typeof arg === 'string' ? { slug: arg } : (arg || {});
  const {
    slug,
    scheme = 'Session',
    useOnlyX = false,
    idemKey
  } = opt;

  // 1) localStorage에 저장된 세션 스토어/메타에서 우선 조회
  let store = {};
  let meta  = {};
  try { store = JSON.parse(localStorage.getItem('session_store') || '{}'); } catch {}
  try { meta  = JSON.parse(localStorage.getItem('session_meta')  || '{}'); } catch {}

  const fromStore = (slug && store && store[slug]) ? store[slug] : null;
  const fromMeta  = (meta && meta.token) ? meta : null;

  // 2) 여러 경로에서 토큰 후보 수집 → 우선순위대로 선택
  let token =
    (fromStore && fromStore.token) ||
    (fromMeta  && fromMeta.token)  ||
    (window.SessionStore?.getSession?.(slug)?.token) ||
    (window.Tokens?.getSession?.()) ||
    sessionStorage.getItem('session_token') ||
    localStorage.getItem('session_token') ||
    '';

  token = String(token || '').replace(/^"|"$/g, '');

  const h = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (token) {
    // 권장: Authorization: Session <token>
    if (!useOnlyX) h.Authorization = `${scheme} ${token}`;
    // 호환 헤더들
    h['x-session-token'] = token;

    const s = fromStore || fromMeta || window.SessionStore?.getSession?.(slug) || {};
    if (s.session_id != null) h['x-session-id'] = String(s.session_id);
    if (s.table_id   != null) h['x-table-id']   = String(s.table_id);
    if (s.channel)           h['x-channel']    = String(s.channel);
    if (slug)                h['x-table-slug'] = String(slug);
  }

  if (idemKey) h['x-idempotency-key'] = idemKey;

  return h;
}

// (사용자) 내 주문 상세 조회
// - 서버 요구사항: 세션 토큰 인증(Authorization: Session <token> 또는 x-session-token)
// - 반환: 백엔드가 {success, data:{...}}를 주면 data, 아니면 그대로 객체 반환
export async function getUserOrderDetails(orderId, slug) {
  await waitForRuntime(); // 기존 유틸 그대로 사용
  const url = apiUrl(`/orders/${orderId}`); // 기존 유틸 그대로 사용
  const headers = sessionHeaders({ slug }); // ← 반드시 객체 형태로 slug 전달

  const res  = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}

  console.log(`[getUserOrderDetails] ${orderId} (slug: ${slug || 'n/a'})`, res.status, text);

  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `HTTP ${res.status}`);
  }
  return json?.data || json;
}

// function sessionHeaders({ scheme='Session', idemKey, useOnlyX=false, slug } = {}) {
//   const store = JSON.parse(localStorage.getItem('session_store') || '{}');
//   const meta  = JSON.parse(localStorage.getItem('session_meta')  || '{}');

//   const s = (slug && store[slug]) ? store[slug] : meta;      // slug 우선
//   const token = (s && s.token) || (window.Tokens?.getSession?.() || '');

//   const h = { 'Content-Type':'application/json', 'Accept':'application/json' };
//   if (token) {
//     if (!useOnlyX) h.Authorization = `${scheme} ${token}`;   // 반드시 Session 스킴
//     h['X-Session-Token'] = token;
//     if (s?.session_id) h['X-Session-Id'] = String(s.session_id);
//     if (s?.table_id)   h['X-Table-Id']   = String(s.table_id);
//     if (s?.channel)    h['X-Channel']    = String(s.channel);
//     if (s?.slug)       h['X-Table-Slug'] = String(s.slug);
//   }
//   if (idemKey) h['X-Idempotency-Key'] = idemKey;
//   return h;
// }

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
    credentials: 'include'
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

  // SessionStore에 세션 저장
  const sessionData = {
    session_token: data?.data?.session_token,
    session_id: data?.data?.session_id,
    table: data?.data?.table,
    table_id: data?.data?.table?.id,
    channel: data?.data?.channel || 'DINEIN',
    abs_ttl_min: data?.data?.abs_ttl_min
  };
  
  if (sessionData.session_token) {
    SessionStore.setSession(slug, sessionData);
    
    // 레거시 호환성 유지
    Tokens.setSession(sessionData.session_token);
    const legacyMeta = {
      session_id: sessionData.session_id,
      table_id: sessionData.table_id,
      channel: sessionData.channel,
      slug: slug,
      opened_at: new Date().toISOString(),
      token: sessionData.session_token // 백업 메타에 token 포함
    };
    Tokens.setSessionMeta(legacyMeta);
    
    console.log(`[openSessionBySlug] DINE-IN 세션 저장: ${slug}`, {
      channel: sessionData.channel,
      sessionId: sessionData.session_id,
      tableId: sessionData.table_id,
      expiresAt: SessionStore.getSession(slug)?.expiresAt
    });
  }

  return data; // 호출측에서 code_verified 플래그를 세움
}

/* -----------------------------
 *  포장 주문용 멀티세션 열기
 *  - Authorization 불필요 (코드 검증 없이 바로 세션 열기)
 *  - 멀티 세션 지원 (기존 세션 만료시키지 않음)
 * ----------------------------- */
export async function openTakeoutSession(slug) {
  await waitForRuntime();

  if (!slug) throw new Error('테이블 정보(slug)가 없습니다.');

  console.log('[openTakeoutSession] 포장 세션 열기 시도:', slug);

  const url = apiUrl('/sessions/takeout/open');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Accept': 'application/json' 
    },
    body: JSON.stringify({ slug: String(slug).trim() }),
  });

  const text = await res.text();
  let data = {};
  try { 
    data = JSON.parse(text); 
  } catch(e) {
    console.error('[openTakeoutSession] JSON 파싱 실패:', e, text);
  }

  console.log('[openTakeoutSession] 응답:', res.status, data);
  
  // 상태별 메시지 보정
  if (!res.ok || !data?.success) {
    if (res.status === 400) {
      throw new Error(data?.message || 'slug가 누락되었거나 올바르지 않습니다.');
    }
    if (res.status === 404) {
      throw new Error('포장 테이블을 찾을 수 없거나 비활성 상태입니다.');
    }
    if (res.status === 500) {
      throw new Error('서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
    throw new Error(data?.message || `포장 세션 열기 실패 (${res.status})`);
  }

  // SessionStore에 세션 저장
  const sessionData = {
    session_token: data?.data?.session_token,
    session_id: data?.data?.session_id,
    table: data?.data?.table,
    table_id: data?.data?.table?.id,
    channel: data?.data?.channel || 'TAKEOUT',
    abs_ttl_min: data?.data?.abs_ttl_min
  };
  
  if (!sessionData.session_token) {
    throw new Error('서버에서 세션 토큰을 반환하지 않았습니다.');
  }
  
  SessionStore.setSession(slug, sessionData);
  
  // 레거시 호환성 유지
  Tokens.setSession(sessionData.session_token);
  const legacyMeta = {
    session_id: sessionData.session_id,
    table_id: sessionData.table_id,
    channel: sessionData.channel,
    slug: slug,
    opened_at: new Date().toISOString(),
    token: sessionData.session_token // 백업 메타에 token 포함
  };
  Tokens.setSessionMeta(legacyMeta);
  
  console.log(`[openTakeoutSession] TAKEOUT 세션 저장: ${slug}`, {
    channel: sessionData.channel,
    sessionId: sessionData.session_id,
    tableId: sessionData.table_id,
    token: sessionData.session_token.substring(0, 20) + '...',
    expiresAt: SessionStore.getSession(slug)?.expiresAt
  });

  return data; // { success: true, data: { session_token, session_id, table, ... } }
}

/* -----------------------------
 *  세션 보장 함수 (주문 전 필수 체크)
 * ----------------------------- */
export async function ensureSessionBeforeOrder(slug, expectedChannel, options = {}) {
  console.log(`[ensureSessionBeforeOrder] ${slug}, 채널: ${expectedChannel}`, options);
  
  // TAKEOUT 안전모드: 항상 새 세션 열기 (서버 측 세션 상태 불일치 방지)
  if (expectedChannel === 'TAKEOUT' && options.alwaysRefresh) {
    console.log(`[ensureSessionBeforeOrder] TAKEOUT 안전모드: 기존 세션 무시하고 새로 열기 - ${slug}`);
    SessionStore.removeSession(slug); // 기존 세션 제거
    await openTakeoutSession(slug);
    const newSession = SessionStore.getSession(slug);
    console.log(`[ensureSessionBeforeOrder] TAKEOUT 안전모드 완료: ${slug}`, {
      sessionId: newSession?.session_id,
      expiresAt: newSession?.expiresAt
    });
    return newSession;
  }
  
  const session = SessionStore.getSession(slug);
  
  // 1. 토큰 없음
  if (!session || !session.token) {
    console.log(`[ensureSessionBeforeOrder] 세션 없음: ${slug}`);
    if (expectedChannel === 'DINEIN') {
      throw new Error('DINEIN_NO_SESSION'); // 코드 모달 유도
    } else if (expectedChannel === 'TAKEOUT') {
      console.log(`[ensureSessionBeforeOrder] TAKEOUT 자동 재오픈: ${slug}`);
      await openTakeoutSession(slug);
      return SessionStore.getSession(slug);
    }
  }

  // 2. 채널 불일치
  if (session.channel !== expectedChannel) {
    console.log(`[ensureSessionBeforeOrder] 채널 불일치: ${session.channel} ≠ ${expectedChannel}`);
    SessionStore.removeSession(slug);
    if (expectedChannel === 'DINEIN') {
      throw new Error('DINEIN_CHANNEL_MISMATCH'); // 코드 모달 유도
    } else if (expectedChannel === 'TAKEOUT') {
      console.log(`[ensureSessionBeforeOrder] TAKEOUT 자동 재오픈: ${slug}`);
      await openTakeoutSession(slug);
      return SessionStore.getSession(slug);
    }
  }

  // 3. 슬러그 불일치
  if (session.slug !== slug) {
    console.log(`[ensureSessionBeforeOrder] 슬러그 불일치: ${session.slug} ≠ ${slug}`);
    SessionStore.removeSession(slug);
    if (expectedChannel === 'DINEIN') {
      throw new Error('DINEIN_SLUG_MISMATCH'); // 코드 모달 유도
    } else if (expectedChannel === 'TAKEOUT') {
      console.log(`[ensureSessionBeforeOrder] TAKEOUT 자동 재오픈: ${slug}`);
      await openTakeoutSession(slug);
      return SessionStore.getSession(slug);
    }
  }

  // 4. 만료 체크 (SessionStore.getSession에서 이미 체크하지만 명시적으로)
  if (new Date(session.expiresAt) <= new Date()) {
    console.log(`[ensureSessionBeforeOrder] 세션 만료: ${slug}, expiresAt: ${session.expiresAt}`);
    SessionStore.removeSession(slug);
    if (expectedChannel === 'DINEIN') {
      throw new Error('DINEIN_EXPIRED'); // 코드 모달 유도
    } else if (expectedChannel === 'TAKEOUT') {
      console.log(`[ensureSessionBeforeOrder] TAKEOUT 자동 재오픈: ${slug}`);
      await openTakeoutSession(slug);
      return SessionStore.getSession(slug);
    }
  }

  console.log(`[ensureSessionBeforeOrder] 세션 유효: ${slug}`, {
    channel: session.channel,
    sessionId: session.session_id,
    expiresAt: session.expiresAt
  });
  
  return session;
}
function makeIdemKey(slug) {
    const rand = Math.random().toString(36).slice(2, 10);
    return `order-${slug}-${Date.now()}-${rand}`;
  }

export async function createOrder(order, slug) {
  await waitForRuntime();
  const url  = apiUrl('/orders');
  const body = JSON.stringify(order);

  // --- 초시도 ---
  const key1 = makeIdemKey(slug);
  const h1   = sessionHeaders(slug, { scheme: 'Session', idemKey: key1 });
  let res = await fetch(url, { method:'POST', headers: h1, body, credentials: 'include' });
  let txt = await res.text(); let data = {}; try { data = JSON.parse(txt); } catch {}
  console.log('[createOrder] try1', res.status, txt);

  const isTakeout = (order?.order_type || '').toUpperCase() === 'TAKEOUT';
  const msg = (data?.message || '').toLowerCase();
  const needReopen =
    isTakeout && (
      res.status === 401 ||
      (res.status === 422 && (
        msg.includes('token expired') ||
        msg.includes('invalid') ||
        msg.includes('closed')
      ))
    );

  if (!needReopen) {
    if (!res.ok || !data?.success) throw new Error(data?.message || `주문 실패 (${res.status})`);
    return data;
  }

  // --- 재오픈 ---
  console.log('[createOrder] takeout reopen & retry due to:', data?.message);
  await openTakeoutSession(slug); // 새 토큰 발급
  // 재시도는 반드시 "새 Idempotency-Key"
  const key2 = makeIdemKey(slug);

  // (A) 스킴 폴백: Bearer로 시도
  const h2 = sessionHeaders(slug, { scheme: 'Bearer', idemKey: key2 });
  res = await fetch(url, { method:'POST', headers: h2, body, credentials: 'include' });
  txt = await res.text(); data = {}; try { data = JSON.parse(txt); } catch {}
  console.log('[createOrder] try2(Bearer)', res.status, txt);
  if (res.ok && data?.success) return data;

  // (B) 그래도 안되면 Authorization 제거, x-session-token만
  const key3 = makeIdemKey(slug);
  const h3 = sessionHeaders(slug, { idemKey: key3, useOnlyX: true });
  res = await fetch(url, { method:'POST', headers: h3, body, credentials: 'include' });
  txt = await res.text(); data = {}; try { data = JSON.parse(txt); } catch {}
  console.log('[createOrder] try3(x-only)', res.status, txt);

  if (!res.ok || !data?.success) throw new Error(data?.message || `주문 실패 (${res.status})`);
  return data;
}

// export async function getUserOrderDetails(orderId, slug) {
//   await waitForRuntime();
//   const url = apiUrl(`/orders/${orderId}`);
//   const headers = sessionHeaders(slug); // slug 필수로 사용
  
//   const res = await fetch(url, { method: 'GET', headers });
//   const text = await res.text();
//   let data = {};
//   try { data = JSON.parse(text); } catch(e) {}
//   console.log(`[getUserOrderDetails] ${orderId} (slug: ${slug || 'legacy'})`, res.status, text);

//   if (!res.ok || !data?.success) {
//     throw new Error(data?.message || '주문 조회 실패');
//   }
//   return data;
// }

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
    const orderUrl = apiUrl(`/orders/${orderId}`);
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