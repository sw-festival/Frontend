// public/order-system/js/api-session.js
// Authorization: Session <token>도 동시 전송하도록 수정하고, 세션 오픈 함수는 code를 파라미터로 받을 수 있게

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
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['x-session-token'] = token;          // 호환
    headers['Authorization'] = `Session ${token}`; // 스펙
  }
  return headers;
}

// ✅ code를 인자로 받을 수 있게
export async function openSessionBySlug(slug, codeFromUser) {
  await waitForRuntime();
  const code = (codeFromUser ?? window.RUNTIME.SESSION_OPEN_CODE);
  const res = await fetch(`${API_BASE}/sessions/open-by-slug`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ slug, code }),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data?.success) throw new Error(data?.message || '세션 열기 실패');
  if (data?.data?.session_token) Tokens.setSession(data.data.session_token);
  return data;
}

export async function createOrder({ order_type, payer_name, items }) {
  await waitForRuntime();
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: sessionHeaders(),
    // ⚠️ 스펙: items = [{ product_id, quantity }] 만
    body: JSON.stringify({ order_type, payer_name, items }),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data?.success) throw new Error(data?.message || '주문 생성 실패');
  return data;
}

export async function getUserOrderDetails(orderId) {
  await waitForRuntime();
  const res = await fetch(`${API_BASE}/orders/${orderId}`, {
    method: 'GET',
    headers: sessionHeaders(),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data?.success) throw new Error(data?.message || '주문 조회 실패');
  return data;
}