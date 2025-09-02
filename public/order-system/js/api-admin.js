// Admin 인증/관리
import { Tokens } from './tokens.js';
const { API_BASE } = window.RUNTIME;

function authHeader(){
  const t = Tokens.getAdmin();
  return t ? { 'Authorization': `Bearer ${t}` } : {};
}

export async function adminLogin(pin){
  const res = await fetch(`${API_BASE}/admin/login`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ pin }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '로그인 실패');
  if (data?.token) Tokens.setAdmin(data.token);
  return data;
}

export async function ensureTable(label, active=true){
  const res = await fetch(`${API_BASE}/admin/tables/ensure`, {
    method:'POST',
    headers:{'Content-Type':'application/json', ...authHeader()},
    body: JSON.stringify({ label, active }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '테이블 보장 실패');
  return data;
}

export async function patchOrderStatus(orderId, action, reason){
  const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
    method:'PATCH',
    headers:{'Content-Type':'application/json', ...authHeader()},
    body: JSON.stringify({ action, reason }),
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '상태 변경 실패');
  return data;
}

export async function forceCloseSession(sessionId){
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/close`, {
    method:'POST',
    headers:{...authHeader()},
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '세션 강제 종료 실패');
  return data;
}

// 주문 관련 API들
export async function getOrderDetails(orderId) {
  const res = await fetch(`${API_BASE}/orders/admin/${orderId}`, {
    method: 'GET',
    headers: {...authHeader()},
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '주문 조회 실패');
  return data;
}

export async function getActiveOrders() {
  const res = await fetch(`${API_BASE}/orders/active`, {
    method: 'GET',
    headers: {...authHeader()},
  });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.message || '진행중 주문 조회 실패');
  return data;
}
