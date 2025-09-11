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
// 주문 상태 변경
export async function patchOrderStatus(orderId, action, reason) {
  await waitForRuntime();
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  // 액션별 대안 경로 (서버 구현 차이 흡수)
  const altPaths = [];
  // 1) 표준: /orders/:id/status (JSON body {action, reason})
  altPaths.push({ method:'POST',  path:`/orders/${orderId}/status`,  body:{ action, reason } });
  altPaths.push({ method:'PATCH', path:`/orders/${orderId}/status`,  body:{ action, reason } });
  // 2) admin prefix 변형
  altPaths.push({ method:'POST',  path:`/admin/orders/${orderId}/status`, body:{ action, reason } });
  altPaths.push({ method:'PATCH', path:`/admin/orders/${orderId}/status`, body:{ action, reason } });

  // 3) 액션별 엔드포인트(서버가 /:action 형태로 받는 경우)
  //    예) /orders/3/confirm, /orders/3/start-preparing, /orders/3/complete
  const actionPaths = [
    { method:'POST', path:`/orders/${orderId}/${action}` },
    { method:'POST', path:`/admin/orders/${orderId}/${action}` },
  ];
  altPaths.push(...actionPaths);

  // 4) start_preparing의 케밥케이스도 시도
  if (action === 'start_preparing') {
    altPaths.push({ method:'POST', path:`/orders/${orderId}/start-preparing` });
    altPaths.push({ method:'POST', path:`/admin/orders/${orderId}/start-preparing` });
  }

  // 5) 트레일링 슬래시 변형도 추가 (서버가 슬래시 구분하는 경우 대비)
  const withTrailing = [];
  for (const t of altPaths) {
    if (!t.path.endsWith('/')) withTrailing.push({ ...t, path: t.path + '/' });
  }
  altPaths.push(...withTrailing);

  // 시도
  let lastText = '';
  for (const t of altPaths) {
    const url = apiUrl(t.path);
    const res = await fetch(url, {
      method: t.method,
      headers: adminHeaders(),
      ...(t.body ? { body: JSON.stringify(t.body) } : {}),
    });

    const txt = await res.text();
    lastText = txt;
    console.log('[patchOrderStatus try]', t.method, url, res.status, txt);

    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }
    if (res.status === 404 || res.status === 405) {
      // 다음 조합 계속
      continue;
    }
    // 2xx면 성공 처리
    if (res.ok) {
      try {
        const data = JSON.parse(txt);
        if (data?.success === false) throw new Error(data?.message || '상태 변경 실패');
        return data || { success: true };
      } catch {
        return { success: true };
      }
    }
    // 다른 에러면 즉시 종료
    throw new Error(`상태 변경 실패 (${res.status})`);
  }

  throw new Error(`상태 변경 엔드포인트를 찾을 수 없습니다 (모든 조합 실패). 마지막 응답: ${lastText || 'N/A'}`);
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
