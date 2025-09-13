// 관리자 전용 API 래퍼 (JWT Bearer)
import './config.js';

function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) return resolve();
    const tick = () => (window.RUNTIME ? resolve() : setTimeout(tick, 10));
    tick();
  });
}

function getBase() {
  const rt = window.RUNTIME || {};
  const base = rt.API_BASE || 'https://api.limswoo.shop';

  // base가 로컬인지 판단
  const isLocalBase =
    /(^http:\/\/(?:localhost|127\.0\.0\.1)|^https?:\/\/192\.168\.)/i.test(base);

  let prefix = rt.API_PREFIX;
  // null/undefined이거나 빈 문자열인데 로컬이 아니면 강제로 '/api'
  if (prefix == null || (prefix === '' && !isLocalBase)) {
    prefix = '/api';
  }
  return `${base}${prefix}`;
}

function apiUrl(path, params) {
  const base = getBase();
  const url = new URL(String(path).replace(/^\//, ''), base.endsWith('/') ? base : base + '/');
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  }
  console.debug('[admin.apiUrl]', url.href);
  return url.href;
}

async function parseJsonSafe(res) {
  const text = await res.text();
  try { return { data: JSON.parse(text), text }; }
  catch { return { data: {}, text }; }
}

/* -----------------------------
 * 인증/토큰 유틸
 * ----------------------------- */
function getAdminToken() {
  return sessionStorage.getItem('admin_token') || localStorage.getItem('accesstoken') || '';
}
function setAdminToken(jwt) {
  sessionStorage.setItem('admin_token', jwt);
  sessionStorage.setItem('admin_logged_in', 'true');
  sessionStorage.setItem('admin_login_time', String(Date.now()));
}
function clearAdminSession() {
  sessionStorage.removeItem('admin_token');
  sessionStorage.removeItem('admin_logged_in');
  sessionStorage.removeItem('admin_login_time');
  localStorage.removeItem('accesstoken'); // 구버전 호환
}
function adminHeaders() {
  const token = getAdminToken();
  const headers = { 'Content-Type':'application/json', 'Accept':'application/json' };
  if (token) headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  return headers;
}
function isTokenValid() {
  const token = getAdminToken();
  if (!token) return false;

  // JWT exp 확인
  try {
    const parts = token.replace(/^Bearer\s+/i,'').split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && Date.now() > payload.exp * 1000) return false;
      return true;
    }
  } catch {
    // 형식 이상: 로그인 시간으로 24h 체크
  }
  const loginTime = Number(sessionStorage.getItem('admin_login_time') || 0);
  const maxAge = 24 * 60 * 60 * 1000;
  return !!loginTime && (Date.now() - loginTime) < maxAge;
}

/* -----------------------------
 *  🔐 관리자 로그인
 * ----------------------------- */
export async function adminLogin(pin) {
  await waitForRuntime();
  const url = apiUrl('/admin/login'); // 운영에선 자동으로 /api/admin/login
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ pin })
  });

  const { data, text } = await parseJsonSafe(res);
  console.log('[adminLogin]', url, res.status, text);

  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `로그인 실패 (${res.status})`);
  }

  const jwt = data?.data?.token || data?.token;
  if (jwt) setAdminToken(jwt);
  return data;
}

/* -----------------------------
 *  (선택) 토큰 서버 검증
 * ----------------------------- */
export async function validateAndRefreshToken() {
  const token = getAdminToken();
  if (!token) {
    console.log('❌ No token found');
    return false;
  }

  // 클라이언트 만료 체크
  if (!isTokenValid()) {
    console.log('❌ Token invalid/expired (client check)');
    clearAdminSession();
    return false;
  }

  // 서버 검증 엔드포인트가 있으면 사용
  try {
    await waitForRuntime();
    const url = apiUrl('/admin/validate');
    const res = await fetch(url, { method:'GET', headers: adminHeaders() });
    if (res.ok) {
      console.log('✅ Server token validation passed');
      return true;
    }
    console.log('❌ Server token validation failed:', res.status);
    clearAdminSession();
    return false;
  } catch (e) {
    // 엔드포인트 없으면 통과
    console.log('⚠️ Token validation endpoint not available:', e?.message);
    return true;
  }
}

/* -----------------------------
 *  테이블 슬러그 발급
 * ----------------------------- */
export async function ensureTable(label, active = true) {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  const url = apiUrl('/admin/tables/ensure');
  console.log('Calling ensureTable API:', { label, active, url });

  const res = await fetch(url, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ label, active }),
  });

  console.log('ensureTable response status:', res.status, res.statusText);
  if (res.status === 401) {
    clearAdminSession();
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }

  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `테이블 발급 실패 (${res.status}: ${res.statusText})`);
  }
  return data?.data || data;
}

/* -----------------------------
 *  진행중 주문(관리자)
 * ----------------------------- */
export async function getActiveOrders() {
  await waitForRuntime();
  const url = apiUrl('/orders/active');
  const res = await fetch(url, { headers: adminHeaders() });
  const { data, text } = await parseJsonSafe(res);
  console.log('[getActiveOrders]', url, res.status, text);
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `주문 로드 실패 (${res.status})`);
  }
  return data; // { data: { urgent, waiting, preparing }, meta: ... }
}

// 관리자 주문 상세
export async function getOrderDetails(orderId) {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }
  const url = apiUrl(`/orders/admin/${orderId}`);
  const res = await fetch(url, { method: 'GET', headers: adminHeaders() });
  const { data, text } = await parseJsonSafe(res);
  console.log('[getOrderDetails]', url, res.status, text);
  if (res.status === 401) {
    clearAdminSession();
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `주문 조회 실패 (${res.status})`);
  }
  return data?.data || data; // 백엔드 포맷 대응
}

/* -----------------------------
 *  주문 상태 변경 (경로 호환)
 *  1차: /admin/orders/:id/status
 *  2차: /orders/:id/status
 * ----------------------------- */
// 주문 상태 변경 (PATCH + 쿼리스트링)
export async function patchOrderStatus(orderId, action, reason) {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  console.log(`[patchOrderStatus] 주문 #${orderId} 상태 변경 시도: ${action}`);

  // 서버 요구사항에 따른 우선순위 시도
  const attempts = [
    // 1순위: PATCH + 쿼리스트링 (서버 요구사항)
    {
      method: 'PATCH',
      path: `/orders/${orderId}/status`,
      query: { action, ...(reason && { reason }) }
    },
    // 2순위: admin prefix
    {
      method: 'PATCH', 
      path: `/admin/orders/${orderId}/status`,
      query: { action, ...(reason && { reason }) }
    },
    // 3순위: JSON body (백업)
    {
      method: 'PATCH',
      path: `/orders/${orderId}/status`,
      body: { action, ...(reason && { reason }) }
    }
  ];

  for (const attempt of attempts) {
    try {
      const url = attempt.query 
        ? apiUrl(attempt.path, attempt.query)
        : apiUrl(attempt.path);
        
      const options = {
        method: attempt.method,
        headers: adminHeaders()
      };
      
      if (attempt.body) {
        options.body = JSON.stringify(attempt.body);
      }

      console.log(`[patchOrderStatus] 시도: ${attempt.method} ${url}`);
      
      const res = await fetch(url, options);
      const text = await res.text();
      
      console.log(`[patchOrderStatus] 응답: ${res.status} - ${text.substring(0, 200)}`);

      if (res.status === 401) {
        clearAdminSession();
        throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
      }

      if (res.status === 404 || res.status === 405) {
        continue; // 다음 방법 시도
      }

      if (res.ok) {
        try {
          const data = JSON.parse(text);
          if (data?.success === false) {
            throw new Error(data?.message || '상태 변경 실패');
          }
          console.log(`✅ [patchOrderStatus] 성공`);
          return data || { success: true };
        } catch {
          console.log(`✅ [patchOrderStatus] 성공 (JSON 파싱 불가하지만 HTTP 200)`);
          return { success: true };
        }
      }

      // 400 오류 - 메시지 확인 후 다음 방법 시도
      if (res.status === 400) {
        try {
          const errorData = JSON.parse(text);
          console.log(`[patchOrderStatus] 400 오류: ${errorData.message || text}`);
          if (errorData.message?.includes('action required')) {
            continue; // 다른 방법 시도
          }
        } catch {}
      }

      // 기타 오류는 즉시 throw
      const errorMsg = `상태 변경 실패 (${res.status})`;
      try {
        const errorData = JSON.parse(text);
        throw new Error(errorData.message || errorMsg);
      } catch {
        throw new Error(errorMsg);
      }

    } catch (error) {
      console.error(`[patchOrderStatus] 시도 실패:`, error);
      
      // 마지막 시도였다면 throw
      if (attempt === attempts[attempts.length - 1]) {
        throw error;
      }
      // 아니면 다음 방법 시도
    }
  }

  throw new Error('모든 상태 변경 방법이 실패했습니다.');
}

/* -----------------------------
 *  세션 강제 종료 (경로 호환)
 *  1차: /admin/sessions/:id/close
 *  2차: /sessions/:id/close
 * ----------------------------- */
export async function forceCloseSession(sessionId) {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  // 1차
  let url = apiUrl(`/admin/sessions/${sessionId}/close`);
  let res = await fetch(url, { method: 'POST', headers: adminHeaders() });

  // 404 폴백
  if (res.status === 404) {
    url = apiUrl(`/sessions/${sessionId}/close`);
    res = await fetch(url, { method: 'POST', headers: adminHeaders() });
  }

  if (res.status === 401) {
    clearAdminSession();
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }

  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `세션 강제 종료 실패 (${res.status})`);
  }
  return data;
}

/* -----------------------------
 *  관리자용 전체 메뉴 조회 (경로 호환)
 *  1차: /admin/menu
 *  2차: /menu/admin
 * ----------------------------- */
export async function getAdminMenu() {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  // 1차
  let url = apiUrl('/admin/menu');
  let res = await fetch(url, { method:'GET', headers: adminHeaders() });

  // 404면 폴백
  if (res.status === 404) {
    url = apiUrl('/menu/admin');
    res = await fetch(url, { method:'GET', headers: adminHeaders() });
  }

  if (res.status === 401) {
    clearAdminSession();
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }

  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `메뉴 조회 실패 (${res.status})`);
  }
  return data?.data || [];
}

/* -----------------------------
 *  실시간 주문 스트림 (SSE)
 *  ⚠️ 브라우저 EventSource는 헤더 설정 불가 → 토큰은 쿼리로 전달 필요
 *  서버가 ?token=... 지원 안하면 폴링으로 폴백
 * ----------------------------- */
// ✅ text/event-stream fetch 폴리필
export function createOrderStream(onMessage, onError) {
  return new Promise(async (resolve, reject) => {
    await waitForRuntime();
    if (!isTokenValid()) {
      const err = new Error('로그인이 필요합니다. 다시 로그인해주세요.');
      onError?.(err);
      return reject(err);
    }
    const url = apiUrl('/sse/orders/stream'); // 문서 기준 경로
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...adminHeaders(),
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        }
      });
      if (!res.ok || !res.body) throw new Error(`SSE 연결 실패 (${res.status})`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const parseBlock = (block) => {
        let event = 'message';
        const dataLines = [];
        block.split('\n').forEach(line => {
          const l = line.trim();
          if (l.startsWith('event:')) event = l.slice(6).trim();
          else if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
        });
        return { event, data: dataLines.join('\n') };
      };

      (async function pump() {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const raw = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 2);
              if (!raw) continue;

              const evt = parseBlock(raw);
              if (evt.event === 'snapshot') {
                try { onMessage?.('snapshot', JSON.parse(evt.data)); } catch {}
              } else if (evt.event === 'orders_changed') {
                try { onMessage?.('orders_changed', JSON.parse(evt.data)); } catch {}
              } else if (evt.event === 'ping') {
                onMessage?.('ping', evt.data);
              }
            }
          }
        } catch (err) {
          onError?.(err);
        }
      })();

      resolve({ close: () => reader.cancel() });
    } catch (e) {
      onError?.(e);
      reject(e);
    }
  });
}

/* -----------------------------
 *  전체 주문 조회 (관리자) - 페이지네이션
 * ----------------------------- */
export async function getAllOrders(options = {}) {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  const params = {};
  if (options.limit) params.limit = options.limit;
  if (options.after) params.after = options.after;
  if (options.before) params.before = options.before;
  if (options.status) params.status = options.status;
  if (options.order_type) params.order_type = options.order_type;
  if (options.table_slug) params.table_slug = options.table_slug;
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;

  const url = apiUrl('/orders/admin', params);
  const res = await fetch(url, { method: 'GET', headers: adminHeaders() });
  const { data, text } = await parseJsonSafe(res);
  
  console.log('[getAllOrders]', url, res.status, text);
  
  if (res.status === 401) {
    clearAdminSession();
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
  }
  
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `전체 주문 조회 실패 (${res.status})`);
  }
  
  return data?.data || data; // { items: [...], page_info: {...} }
}
