// public/order-system/js/waiting.js
import './config.js';
import { getUserOrderDetails } from './api-session.js';
import { Tokens } from './tokens.js';

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[waiting] init error', err);
    renderError('초기화 중 오류가 발생했습니다.');
  });
});

async function init() {
  // --- 요소 참조
  const $info   = document.getElementById('waiting-info');    // 로딩/안내 문구
  const $sectionDetails = document.getElementById('order-details');
  const $summary = document.getElementById('order-summary');
  const $sectionStatus  = document.getElementById('waiting-status');

  // 버튼
  document.getElementById('refresh-btn')?.addEventListener('click', () => init());
  document.getElementById('back-btn')?.addEventListener('click', () => (location.href = '/'));

  // --- 주문 ID 추출
  const sp = new URL(location.href).searchParams;
  const orderId = sp.get('orderId') || sp.get('id');
  if (!orderId) return renderError('주문 ID가 없습니다. 올바른 링크로 접근해주세요.');

  // --- 세션 토큰 확인
  const token = Tokens.getSession?.();
  console.log('[waiting] token', token ? token.slice(0, 12) + '...' : '(없음)');
  if (!token) {
    return renderError('세션이 만료되었거나 처음 접속입니다. 주문 페이지에서 코드를 다시 입력해주세요.');
  }

  // --- 로딩 표시
  $info?.classList.remove('hidden');
  $info.textContent = '대기 순번을 확인하는 중...';
  $sectionDetails?.classList.add('hidden');
  $sectionStatus?.classList.add('hidden');

  // --- 상세 조회
  try {
    const res = await getUserOrderDetails(orderId);
    const data = res?.data;
    console.log('[waiting] order details:', data);

    // 상세 UI
    renderSummary($summary, data);

    // 상태 보드
    renderStatusBoard($sectionStatus, data?.status);

    // 표시 전환
    $info?.classList.add('hidden');
    $sectionDetails?.classList.remove('hidden');
    $sectionStatus?.classList.remove('hidden');
  } catch (e) {
    const msg = String(e?.message || e);
    console.error('[waiting] getUserOrderDetails failed:', msg);
    if (msg.includes('401') || msg.toLowerCase().includes('token')) {
      Tokens.clearSession?.();
      return renderError('세션이 만료되었습니다. 주문 페이지에서 코드를 다시 입력해주세요.');
    }
    return renderError('주문 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
}

function renderSummary($summary, data) {
  if (!$summary || !data) return;

  const itemsHTML = (data.items || [])
    .map(it => `<li>${esc(it.name)} × ${it.qty} — ${nf(it.line_total)}원</li>`)
    .join('');

  $summary.innerHTML = `
    <div class="summary-grid">
      <div><strong>주문번호</strong></div><div>#${data.id}</div>
      <div><strong>상태</strong></div><div>${esc(data.status)}</div>
      <div><strong>테이블</strong></div><div>${esc(data.table?.label ?? '-')}</div>
      <div><strong>입금자명</strong></div><div>${esc(data.payer_name ?? '-')}</div>
      <div><strong>총 금액</strong></div><div>${nf(data.amounts?.total)}원</div>
    </div>
    <h3 style="margin-top:1rem;">항목</h3>
    <ul>${itemsHTML || '<li>항목 없음</li>'}</ul>
  `;
}

function renderStatusBoard($sectionStatus, statusRaw) {
  if (!$sectionStatus) return;
  const status = String(statusRaw || '').toUpperCase();

  // 단계 활성화 규칙(백엔드 상태에 맞춰 느슨하게 매핑)
  const receivedOn  = !!status; // 상세를 받았으면 접수는 된 것
  const paidOn      = ['PAID','CONFIRMED','PREPARING','READY','COMPLETED','DONE'].includes(status);
  const preparingOn = ['PREPARING','READY','COMPLETED','DONE'].includes(status);
  const completeOn  = ['READY','COMPLETED','DONE'].includes(status);

  const steps = [
    ['status-received',  receivedOn ],
    ['status-payment',   paidOn     ],
    ['status-preparing', preparingOn],
    ['status-complete',  completeOn ],
  ];
  steps.forEach(([id, on]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !!on);
  });

  // 대기번호/앞팀 수는 백엔드/파베 연동 전까지 placeholder
  const numEl = document.getElementById('waiting-number');
  const ahead = document.getElementById('ahead-count');
  if (numEl)  numEl.textContent  = dataOr('-', '—');
  if (ahead)  ahead.textContent  = dataOr('-', '—');

  function dataOr(v, fallback) { return v ?? fallback; }
}

function renderError(message) {
  const el = document.getElementById('waiting-info');
  if (el) {
    el.classList.remove('hidden');
    el.textContent = message;
  } else {
    alert(message);
  }
}

// utils
function nf(n) { return Number(n || 0).toLocaleString(); }
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
