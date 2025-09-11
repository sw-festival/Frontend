// public/order-system/js/api-admin.js
// 관리자 전용 API 래퍼 (JWT Bearer)

function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) return resolve();
    const tick = () => (window.RUNTIME ? resolve() : setTimeout(tick, 10));
    tick();
  });
}

// API URL 헬퍼 함수 (관리자용)
function apiUrl(path, params) {
  const rt = window.RUNTIME || {};
  const base = rt.API_BASE || 'https://api.limswoo.shop';
  // 관리자 API는 API_PREFIX를 사용하지 않음
  const url = new URL(String(path).replace(/^\//, ''), base.endsWith('/') ? base : base + '/');
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  }
  console.debug('[Admin apiUrl]', url.href);
  return url.href;
}

// 공통 관리자 헤더: 세션스토리지 'admin_token' 우선, 구버전 호환 'accesstoken' 보조
function adminHeaders(extra = {}) {
  const token =
    sessionStorage.getItem('admin_token') ||
    localStorage.getItem('accesstoken') || // 이전에 저장해둔 키 호환
    '';
  
  const h = { 'Content-Type': 'application/json', ...extra };
  
  // 토큰이 있을 때만 Authorization 헤더 추가
  if (token) {
    // Bearer 접두사가 이미 포함되어 있는지 확인
    h.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }
  
  // 디버깅용 로그 (프로덕션에서는 제거)
  console.log('Admin Headers:', { 
    hasToken: !!token, 
    tokenPrefix: token ? token.substring(0, 20) + '...' : 'none',
    headers: h 
  });
  
  return h;
}

// 토큰 유효성 검사 헬퍼
function isTokenValid() {
  const token = sessionStorage.getItem('admin_token') || localStorage.getItem('accesstoken');
  const loginTime = sessionStorage.getItem('admin_login_time');
  
  if (!token) return false;
  
  // 토큰이 있지만 로그인 시간이 없으면 (구버전 호환)
  if (!loginTime) return true;
  
  // 24시간 만료 체크 (필요시 조정)
  const elapsed = Date.now() - parseInt(loginTime);
  const maxAge = 24 * 60 * 60 * 1000; // 24시간
  
  return elapsed < maxAge;
}

// 로그아웃 처리
function clearAdminSession() {
  sessionStorage.removeItem('admin_token');
  sessionStorage.removeItem('admin_logged_in');
  sessionStorage.removeItem('admin_login_time');
  localStorage.removeItem('accesstoken'); // 구버전 토큰도 정리
}

// 토큰 검증 및 재발급 헬퍼
export async function validateAndRefreshToken() {
  const token = sessionStorage.getItem('admin_token') || localStorage.getItem('accesstoken');
  
  if (!token) {
    console.log('❌ No token found');
    return false;
  }
  
  // JWT 만료 시간 체크
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && Date.now() > payload.exp * 1000) {
        console.log('❌ Token expired:', new Date(payload.exp * 1000));
        clearAdminSession();
        return false;
      }
      console.log('✅ Token valid until:', new Date(payload.exp * 1000));
    }
  } catch (e) {
    console.log('❌ Invalid JWT format:', e.message);
    clearAdminSession();
    return false;
  }
  
  // 서버에 토큰 검증 요청 (optional - 서버에 validate 엔드포인트가 있다면)
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;
  
  try {
    const url = apiUrl('/admin/validate');
    const res = await fetch(url, {
      method: 'GET',
      headers: adminHeaders()
    });
    
    if (res.ok) {
      console.log('✅ Server token validation passed');
      return true;
    } else {
      console.log('❌ Server token validation failed:', res.status);
      clearAdminSession();
      return false;
    }
  } catch (e) {
    // validate 엔드포인트가 없을 수도 있으므로 에러는 무시
    console.log('⚠️ Token validation endpoint not available:', e.message);
    return true; // 클라이언트 측 검증은 통과했으므로 true 반환
  }
}

// ──────────────────────────────────────────────────────────────
// 로그인: PIN → JWT 발급
export async function adminLogin(pin) {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  try {
    const url = apiUrl('/admin/login');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `로그인 실패 (${res.status})`);
    }

    // 응답 스키마 호환: data.token 또는 data.data.token
    const token = data?.data?.token || data?.token;
    if (!token) throw new Error('토큰이 응답에 없습니다.');

    // 기존 세션 정리 후 새 토큰 저장
    clearAdminSession();
    
    // ✅ 세션스토리지 저장 (이 키를 이후 모든 호출에서 사용)
    sessionStorage.setItem('admin_token', token);
    sessionStorage.setItem('admin_logged_in', 'true');
    sessionStorage.setItem('admin_login_time', String(Date.now()));

    return data;
  } catch (error) {
    console.error('Admin login error:', error);
    throw error;
  }
}

// 테이블 슬러그 발급
export async function ensureTable(label, active = true) {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  // 토큰 유효성 사전 체크
  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  try {
    const url = apiUrl('/admin/tables/ensure');
    console.log('Calling ensureTable API:', { label, active, url });
    
    const res = await fetch(url, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ label, active }),
    });

    // 응답 상태 로깅
    console.log('ensureTable response status:', res.status, res.statusText);

    // 401 에러 특별 처리
    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    const data = await res.json().catch((parseError) => {
      console.error('JSON parse error:', parseError);
      return {};
    });

    console.log('ensureTable response data:', data);

    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `테이블 발급 실패 (${res.status}: ${res.statusText})`);
    }

    // 스웨거 예시처럼 data 안에 table/qr가 들어오는 경우 지원
    return data?.data || data;
    
  } catch (error) {
    console.error('ensureTable error:', error);
    throw error;
  }
}

// 진행중 주문
export async function getActiveOrders() {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  try {
    const url = apiUrl('/orders/active');
    const res = await fetch(url, {
      method: 'GET',
      headers: adminHeaders(),
    });

    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `진행중 주문 조회 실패 (${res.status})`);
    }
    return data;
  } catch (error) {
    console.error('getActiveOrders error:', error);
    throw error;
  }
}

// 관리자용 주문 상세
export async function getOrderDetails(orderId) {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  try {
    const url = apiUrl(`/orders/admin/${orderId}`);
    const res = await fetch(url, {
      method: 'GET',
      headers: adminHeaders(),
    });

    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `주문 조회 실패 (${res.status})`);
    }
    return data?.data || data;
  } catch (error) {
    console.error('getOrderDetails error:', error);
    throw error;
  }
}

// 주문 상태 변경
export async function patchOrderStatus(orderId, action, reason) {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  try {
    const url = apiUrl(`/orders/${orderId}/status`);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ action, reason }),
    });

    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `상태 변경 실패 (${res.status})`);
    }
    return data;
  } catch (error) {
    console.error('patchOrderStatus error:', error);
    throw error;
  }
}

// 세션 강제 종료
export async function forceCloseSession(sessionId) {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  try {
    const url = apiUrl(`/sessions/${sessionId}/close`);
    const res = await fetch(url, {
      method: 'POST',
      headers: adminHeaders(),
    });

    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `세션 강제 종료 실패 (${res.status})`);
    }
    return data;
  } catch (error) {
    console.error('forceCloseSession error:', error);
    throw error;
  }
}

// 관리자용 전체 메뉴 조회
export async function getAdminMenu() {
  await waitForRuntime();
  const { API_BASE } = window.RUNTIME;

  if (!isTokenValid()) {
    clearAdminSession();
    throw new Error('로그인이 필요합니다. 다시 로그인해주세요.');
  }

  try {
    const url = apiUrl('/menu/admin');
    const res = await fetch(url, {
      method: 'GET',
      headers: adminHeaders(),
    });

    if (res.status === 401) {
      clearAdminSession();
      throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `메뉴 조회 실패 (${res.status})`);
    }
    return data?.data || [];
  } catch (error) {
    console.error('getAdminMenu error:', error);
    throw error;
  }
}

// 실시간 주문 스트림 (SSE) 연결
export function createOrderStream(onMessage, onError) {
  return new Promise(async (resolve, reject) => {
    await waitForRuntime();
    const { API_BASE } = window.RUNTIME;

    if (!isTokenValid()) {
      clearAdminSession();
      reject(new Error('로그인이 필요합니다. 다시 로그인해주세요.'));
      return;
    }

    try {
      const token = sessionStorage.getItem('admin_token') || localStorage.getItem('accesstoken');
      const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

      const url = apiUrl('/sse/orders/stream');
      const eventSource = new EventSource(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      });

      eventSource.onopen = () => {
        console.log('✅ SSE 연결 성공');
        resolve(eventSource);
      };

      eventSource.onerror = (error) => {
        console.error('❌ SSE 연결 오류:', error);
        if (onError) onError(error);
      };

      // 스냅샷 이벤트 처리
      eventSource.addEventListener('snapshot', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📸 스냅샷 수신:', data);
          if (onMessage) onMessage('snapshot', data);
        } catch (e) {
          console.error('스냅샷 파싱 오류:', e);
        }
      });

      // 주문 변경 이벤트 처리
      eventSource.addEventListener('orders_changed', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('🔄 주문 변경:', data);
          if (onMessage) onMessage('orders_changed', data);
        } catch (e) {
          console.error('주문 변경 파싱 오류:', e);
        }
      });

      // 핑 이벤트 처리
      eventSource.addEventListener('ping', (event) => {
        console.log('🏓 핑 수신:', event.data);
        if (onMessage) onMessage('ping', event.data);
      });

    } catch (error) {
      console.error('SSE 연결 생성 오류:', error);
      reject(error);
    }
  });
}