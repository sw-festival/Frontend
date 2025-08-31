// Public 세션/주문
import { Tokens } from './tokens.js';

// window.RUNTIME이 로드되기를 기다림
function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) {
      resolve();
    } else {
      const checkRuntime = () => {
        if (window.RUNTIME) {
          resolve();
        } else {
          setTimeout(checkRuntime, 10);
        }
      };
      checkRuntime();
    }
  });
}

// RUNTIME 설정을 기다린 후 API_BASE 설정
let API_BASE;
waitForRuntime().then(() => {
  API_BASE = window.RUNTIME.API_BASE;
});

export async function openSessionBySlug(slug) {
  await waitForRuntime();
  const code = window.RUNTIME.SESSION_OPEN_CODE;
  const res = await fetch(`${API_BASE}/sessions/open-by-slug`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ slug, code }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '세션 열기 실패');
  if (data?.data?.session_token) Tokens.setSession(data.data.session_token);
  return data;
}

export async function createOrder({ order_type, payer_name, items }) {
  await waitForRuntime();
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'x-session-token': Tokens.getSession(),
    },
    body: JSON.stringify({ order_type, payer_name, items }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '주문 생성 실패');
  return data; // { data: { order_id, ... } }
}
