// public/order-system/js/waiting.js - 새로운 API 시스템을 위한 대기 화면
import './config.js';
import { getUserOrderDetails, openTakeoutSession } from './api-session.js';
import { Tokens, SessionStore } from './tokens.js';


/* =========================
   전역 변수
========================= */
let currentOrderId = null;
let currentSlug = '';
let refreshInterval = null;
let isRefreshing = false;

const HISTORY_KEY_PREFIX = 'ORDER_SESSION_'; // 주문 스냅샷 prefix (app.js에서 저장)

/* =========================
   DOM 로드 후 시작
========================= */
document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[waiting] init error', err);
    renderError('초기화 중 오류가 발생했습니다.');
  });

  // 버튼 이벤트 바인딩
  const refreshBtn = document.getElementById('refresh-btn');
  const backBtn = document.getElementById('back-btn');
  const modal = document.getElementById('reorder-modal');
  const confirmBtn = document.getElementById('reorder-confirm');
  const cancelBtn = document.getElementById('reorder-cancel');

  // 새로고침: 현재 페이지 단순 리로드
  refreshBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.reload();
  });

  // 처음으로: 추가 주문 안내 모달 표시
  backBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    modal?.classList.remove('hidden');
  });

  // 모달 취소: 닫기
  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    modal?.classList.add('hidden');
  });

  // 모달 확인: 현재 slug로 주문 페이지로 이동 (세션은 유지)
  confirmBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      const sp = new URL(location.href).searchParams;
      const slug = (location.pathname.match(/\/t\/([^/]+)/)?.[1]) || sp.get('slug') || '';
      if (!slug) {
        // 슬러그가 없으면 루트 주문 페이지로
        window.location.href = '/order-system/order.html';
        return;
      }
      // 세션을 지우지 않고 해당 slug로 이동
      window.location.href = `/order-system/order.html?slug=${encodeURIComponent(slug)}`;
    } finally {
      modal?.classList.add('hidden');
    }
  });
});

/* =========================
   초기화 및 메인 로직
========================= */
async function init() {
  const sp = new URL(location.href).searchParams;
  currentOrderId = sp.get('orderId') || sp.get('id');
  currentSlug    = (location.pathname.match(/\/t\/([^/]+)/)?.[1]) || sp.get('slug') || '';

  if (!currentOrderId) return renderError('주문 ID가 없습니다.');

  const ok = await ensureOrderSessionForOrder(currentOrderId, currentSlug);
  if (!ok) return renderError('세션이 만료되었거나 찾을 수 없습니다.');
  const ch = (SessionStore.getSession?.(currentSlug)?.channel || 'TAKEOUT');
  trackPage({
    page_title: 'Waiting Page',
    page_path: '/waiting',
    slug: currentSlug,
    channel: String(ch).toUpperCase(),
    step: 'loaded',
  });

  await loadWaitingData();  // 세션 보장 후 호출
  startAutoRefresh();

  // 히스토리도 로드
  try {
    await loadMyOrderHistory();
  } catch (e) {
    console.warn('[waiting] history load failed', e);
  }
}


/* =========================
   주문 세션 보장(복원/재오픈)
========================= */
async function ensureOrderSessionForOrder(orderId, slug) {
  try {
    const key   = `ORDER_SESSION_${orderId}`;
    const saved = JSON.parse(localStorage.getItem(key) || 'null');

    // 1) 스냅샷 있으면 복원 (SessionStore 형태 준수, 기존 유효 세션은 덮어쓰지 않음)
    if (saved) {
      const token   = saved.token || Tokens.getSession?.();
      const useSlug = slug || saved.slug || 'legacy';

      if (!token) return false; // 토큰 없으면 인증 불가

      // 기존 세션이 유효하면 유지
      const exist = SessionStore.getSession?.(useSlug);
      if (!exist || !exist.token) {
        // abs_ttl_min 계산 (만료 예정 시간이 있으면 남은 분, 없으면 120분 기본)
        let absMin = 120;
        if (saved.expiresAt) {
          const diffMs = new Date(saved.expiresAt).getTime() - Date.now();
          absMin = Math.max(1, Math.ceil(diffMs / 60000));
        }
        SessionStore.setSession(useSlug, {
          session_token: token,
          session_id: saved.session_id,
          table_id: saved.table_id,
          channel: (saved.channel || 'DINEIN').toUpperCase(),
          abs_ttl_min: absMin,
        });
      }

      // 레거시 토큰/메타는 항상 주입
      Tokens.setSession(token);
      Tokens.setSessionMeta({
        session_id: saved.session_id,
        table_id: saved.table_id,
        channel: saved.channel,
        slug: useSlug,
        opened_at: saved.createdAt || new Date().toISOString(),
        token,
      });

      // 현재 슬러그 갱신(legacy 분기 방지)
      currentSlug = useSlug;

      // 만료 처리(포장만 자동 재오픈)
      if (saved.expiresAt && new Date(saved.expiresAt) <= new Date()) {
        if ((saved.channel || '').toUpperCase() === 'TAKEOUT' && useSlug) {
          await openTakeoutSession(useSlug);
        } else {
          return false;
        }
      }
      return true;
    }

    // 2) 스냅샷이 없어도 현재 slug 세션이 살아있으면 사용
    if (slug) {
      const cur = SessionStore.getSession?.(slug);
      if (cur?.token && new Date(cur.expiresAt) > new Date()) {
        Tokens.setSession(cur.token);
        Tokens.setSessionMeta({
          session_id: cur.session_id, table_id: cur.table_id,
          channel: cur.channel, slug, opened_at: cur.createdAt || new Date().toISOString(),
        });
        currentSlug = slug;
        return true;
      }
    }

    // 3) 포장 + slug 있으면 새 세션 오픈 시도
    if (slug) {
      try {
        await openTakeoutSession(slug);
        currentSlug = slug;
        return true;
      } catch {}
    }

    return false;
  } catch (e) {
    console.warn('[ensureOrderSessionForOrder] error', e);
    return false;
  }
}

/* =========================
   주문 히스토리 로딩/렌더링
========================= */
async function loadMyOrderHistory() {
  const container = document.getElementById('history-container');
  if (!container) return;

  // 1) localStorage에서 이 기기에서 생성한 내 주문 id 수집
  const myOrderIds = collectMyOrderIdsForSlug(currentSlug);
  if (myOrderIds.length === 0) {
    container.innerHTML = '<div class="history-card">이 기기에서 만든 주문이 없습니다.</div>';
    return;
  }

  // 최신순 정렬
  myOrderIds.sort((a, b) => Number(b) - Number(a));

  // 2) 각 주문 상세 조회 (세션 인증 필요)
  const cards = [];
  for (const oid of myOrderIds) {
    try {
      const details = await getUserOrderDetails(oid, currentSlug);
      cards.push(renderHistoryCard(details?.data || details));
    } catch (e) {
      console.warn('[history] order fetch failed', oid, e);
    }
  }

  if (cards.length === 0) {
    container.innerHTML = '<div class="history-card">표시할 주문이 없습니다.</div>';
  } else {
    container.innerHTML = cards.join('');
  }
}

function collectMyOrderIdsForSlug(slug) {
  try {
    const ids = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith(HISTORY_KEY_PREFIX)) continue; // ORDER_SESSION_
      const val = localStorage.getItem(key);
      if (!val) continue;
      try {
        const snap = JSON.parse(val);
        if (!snap?.token) continue;
        // 같은 slug의 내 주문만 수집
        if (slug && snap.slug && String(snap.slug) !== String(slug)) continue;
        ids.push(key.replace(HISTORY_KEY_PREFIX, ''));
      } catch {}
    }
    return ids;
  } catch {
    return [];
  }
}

function renderHistoryCard(order) {
  if (!order) return '';
  const status = String(order.status || '-');
  const statusKo = mapStatusToKorean(order.status);
  const created = formatOrderTime(order.created_at);
  const items = (order.items || []).map(it => {
    const name = esc(it?.name || it?.product_name || '-');
    const rawQty = it?.quantity ?? it?.qty ?? it?.count ?? 1;
    const qty = Number(rawQty);
    const showQty = Number.isFinite(qty) && qty > 1;
    return showQty ? `${name} × ${qty}` : name;
  }).join('<br>');
  const title = `#${order.id} · ${statusKo}`;

  return `
    <div class="history-card">
      <div class="title">${title}</div>
      <div class="meta">${created}</div>
      <div class="history-items">${items || '항목 없음'}</div>
    </div>
  `;
}

/* =========================
   데이터 로드
========================= */
async function loadWaitingData() {
  if (isRefreshing) return;
  isRefreshing = true;

  const $info = document.getElementById('waiting-info');
  const $summary = document.getElementById('order-summary');
  const $sectionStatus = document.getElementById('waiting-status');

  try {
    // 로딩 UI
    $info?.classList.remove('hidden');
    $info.textContent = '주문 정보를 불러오는 중...';
    $sectionStatus?.classList.add('hidden');

    // 주문 상세(본인 세션 인증) 조회
    const res   = await getUserOrderDetails(currentOrderId, currentSlug); // 
    const order = res?.data || res;

    // 간이 대기 수치(서버 대기열 API가 없어서 추정)
    const wait = estimateWaiting(order);
    const ch2 = (SessionStore.getSession?.(currentSlug)?.channel || order?.order_type || 'TAKEOUT');
    trackQueue({
      position: wait.waitingPosition,
      est_ms: wait.estimatedWaitTime * 60 * 1000,
      slug: currentSlug,
      channel: String(ch2).toUpperCase(),
    });
    
    // 렌더링
    renderSummary($summary, order);
    renderStatusBoard($sectionStatus, order.status, wait.waitingPosition, wait.totalWaiting, wait.estimatedWaitTime);
    updateScoreboard(order.status, wait.waitingPosition, wait.estimatedWaitTime);

    // 표시 전환
    $info?.classList.add('hidden');
    $sectionStatus?.classList.remove('hidden');

  } catch (e) {
    const msg = String(e?.message || e);
    console.error('[waiting] loadWaitingData failed:', msg);

    // 세션 이슈 공통 처리
    if (msg.includes('401') || /token|세션|invalid|closed/i.test(msg)) {
      return renderError('세션이 만료되었거나 권한이 없습니다. 주문 페이지에서 다시 접속해주세요.');
    }

    return renderError('주문 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  } finally {
    isRefreshing = false;
  }
}

async function refreshWaitingInfo() {
  console.log('[waiting] 수동 새로고침');
  await loadWaitingData();
}

/* =========================
   대기 추정(임시)
========================= */
function estimateWaiting(order) {
  const status = String(order?.status || '').toUpperCase();
  let waitingPosition = 0;
  let totalWaiting = 0;
  let estimatedWaitTime = 0;

  const created = order?.created_at ? new Date(order.created_at).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((Date.now() - created) / 60000));

  switch (status) {
    case 'PENDING':
      waitingPosition = Math.max(1, Math.floor(mins / 5));
      totalWaiting = waitingPosition + 1;
      estimatedWaitTime = waitingPosition * 3;
      break;
    case 'CONFIRMED':
      waitingPosition = Math.max(1, Math.floor(mins / 8));
      totalWaiting = waitingPosition + 1;
      estimatedWaitTime = waitingPosition * 8;
      break;
    case 'IN_PROGRESS':
      waitingPosition = 0;
      totalWaiting = Math.floor(Math.random() * 5);
      estimatedWaitTime = 5;
      break;
    case 'SERVED':
      waitingPosition = 0;
      totalWaiting = 0;
      estimatedWaitTime = 0;
      break;
    default:
      waitingPosition = Math.floor(Math.random() * 3);
      totalWaiting = waitingPosition + Math.floor(Math.random() * 2);
      estimatedWaitTime = waitingPosition * 5;
  }

  return { waitingPosition, totalWaiting, estimatedWaitTime };
}

/* =========================
   렌더링 함수들
========================= */
function renderSummary($summary, order) {
  if (!$summary || !order) return;

  const itemsHTML = (order.items || [])
    .map(item => `<li>${esc(item.name)} × ${item.quantity} — ${nf(item.line_total)}원</li>`)
    .join('');

  const statusText = mapStatusToKorean(order.status);
  const statusClass = getStatusClass(order.status);

  $summary.innerHTML = `
    <div class="summary-grid">
      <div><strong>주문번호</strong></div><div>#${order.id}</div>
      <div><strong>상태</strong></div><div class="status-text ${statusClass}">${statusText}</div>
      <div><strong>테이블</strong></div><div>${esc(order.table?.label ?? '포장 주문')}</div>
      <div><strong>입금자명</strong></div><div>${esc(order.payer_name ?? '-')}</div>
      <div><strong>총 금액</strong></div><div class="total-amount">${nf(order.total_amount)}원</div>
      <div><strong>주문 시간</strong></div><div>${formatOrderTime(order.created_at)}</div>
    </div>
    <h3 style="margin-top:1rem;">📋 주문 항목</h3>
    <ul class="order-items-list">${itemsHTML || '<li>항목 없음</li>'}</ul>
  `;
}

function renderStatusBoard($sectionStatus, status, waitingPosition, totalWaiting, estimatedWaitTime) {
  if (!$sectionStatus) return;

  const statusUpper = String(status || '').toUpperCase();
  console.log('[야구 베이스] 상태 업데이트:', statusUpper);

  // 야구 베이스 시스템에 맞춘 단계 활성화
  const firstBaseOn = !!status; // PENDING - 1루 (주문 접수)
  const secondBaseOn = ['CONFIRMED', 'IN_PROGRESS', 'SERVED'].includes(statusUpper); // 2루 (입금 확인)
  const thirdBaseOn = ['IN_PROGRESS', 'SERVED'].includes(statusUpper); // 3루 (조리중)
  const homeBaseOn = ['SERVED'].includes(statusUpper); // 홈 (완료)

  // 야구 베이스 단계 업데이트
  const bases = [
    ['base-first', firstBaseOn],
    ['base-second', secondBaseOn], 
    ['base-third', thirdBaseOn],
    ['base-home', homeBaseOn],
  ];

  bases.forEach(([id, isActive]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !!isActive);
    el.classList.toggle('current', false); // 일단 current 제거
  });

  // 베이스 설명 텍스트도 함께 업데이트
  const descriptions = [
    ['first-desc', firstBaseOn],
    ['second-desc', secondBaseOn],
    ['third-desc', thirdBaseOn], 
    ['home-desc', homeBaseOn],
  ];

  descriptions.forEach(([className, isActive]) => {
    const el = document.querySelector(`.${className}`);
    if (!el) return;
    el.classList.toggle('active', !!isActive);
  });

  // 현재 베이스 표시 (야구선수가 서있는 위치)
  let currentBaseId = '';
  if (homeBaseOn) {
    currentBaseId = 'base-home'; // 홈베이스 - 완료
  } else if (thirdBaseOn) {
    currentBaseId = 'base-third'; // 3루 - 조리중
  } else if (secondBaseOn) {
    currentBaseId = 'base-second'; // 2루 - 입금 확인
  } else if (firstBaseOn) {
    currentBaseId = 'base-first'; // 1루 - 주문 접수
  }

  if (currentBaseId) {
    const currentEl = document.getElementById(currentBaseId);
    if (currentEl) {
      currentEl.classList.add('current');
      console.log('[야구 베이스] 현재 위치:', currentBaseId);
    }
  }

  // 베이스 연결선 활성화
  updateBaseLines(statusUpper);

  // 대기 번호 및 정보 업데이트
  updateWaitingNumbers(waitingPosition, totalWaiting, estimatedWaitTime, statusUpper);
}

// 야구 베이스 연결선 업데이트 함수
function updateBaseLines(status) {
  const statusUpper = String(status || '').toUpperCase();
  
  // 연결선 요소들
  const lines = {
    'line-home-1': document.querySelector('.line-home-1'),
    'line-1-2': document.querySelector('.line-1-2'),
    'line-2-3': document.querySelector('.line-2-3'),
    'line-3-home': document.querySelector('.line-3-home'),
  };

  // 모든 연결선 비활성화
  Object.values(lines).forEach(line => {
    if (line) line.classList.remove('active');
  });

  // 상태에 따른 연결선 활성화
  switch (statusUpper) {
    case 'PENDING':
      // 1루까지 - 홈에서 1루로 가는 선
      if (lines['line-home-1']) lines['line-home-1'].classList.add('active');
      break;
    case 'CONFIRMED':
      // 2루까지 - 홈→1루→2루
      if (lines['line-home-1']) lines['line-home-1'].classList.add('active');
      if (lines['line-1-2']) lines['line-1-2'].classList.add('active');
      break;
    case 'IN_PROGRESS':
      // 3루까지 - 홈→1루→2루→3루
      if (lines['line-home-1']) lines['line-home-1'].classList.add('active');
      if (lines['line-1-2']) lines['line-1-2'].classList.add('active');
      if (lines['line-2-3']) lines['line-2-3'].classList.add('active');
      break;
    case 'SERVED':
      // 홈런! 모든 연결선 활성화
      Object.values(lines).forEach(line => {
        if (line) line.classList.add('active');
      });
      break;
  }

  console.log('[야구 베이스] 연결선 업데이트:', statusUpper);
}

function updateWaitingNumbers(waitingPosition, totalWaiting, estimatedWaitTime, status) {
  const waitingNumberEl = document.getElementById('waiting-number');
  const aheadCountEl = document.getElementById('ahead-count');
  const waitingSubtitleEl = document.querySelector('.waiting-subtitle');

  if (waitingNumberEl && aheadCountEl && waitingSubtitleEl) {
    if (status === 'SERVED') {
      // 완료된 경우
      waitingNumberEl.textContent = '완료';
      waitingNumberEl.className = 'waiting-number completed';
      waitingSubtitleEl.innerHTML = '🎉 주문이 완료되었습니다!';
    } else if (status === 'IN_PROGRESS') {
      // 조리중인 경우
      waitingNumberEl.textContent = '조리중';
      waitingNumberEl.className = 'waiting-number preparing';
      waitingSubtitleEl.innerHTML = `👨‍🍳 현재 조리중입니다. 약 ${estimatedWaitTime}분 후 완료 예정`;
    } else if (waitingPosition === 0) {
      // 대기 없음 (다음 차례)
      waitingNumberEl.textContent = '대기없음';
      waitingNumberEl.className = 'waiting-number next';
      waitingSubtitleEl.innerHTML = '🔥 곧 처리될 예정입니다!';
    } else {
      // 일반 대기
      waitingNumberEl.textContent = waitingPosition;
      waitingNumberEl.className = 'waiting-number waiting';
      aheadCountEl.textContent = waitingPosition;
      waitingSubtitleEl.innerHTML = `앞에 <span class="highlight">${waitingPosition}</span>팀이 기다리고 있습니다<br>예상 대기 시간: <span class="time-highlight">${estimatedWaitTime}분</span>`;
    }
  }

  // 전체 대기팀 수 표시 (추가 정보)
  const additionalInfoEl = document.querySelector('.additional-waiting-info');
  if (additionalInfoEl) {
    additionalInfoEl.textContent = `현재 총 ${totalWaiting}팀이 대기중입니다.`;
  } else {
    // 추가 정보 엘리먼트가 없으면 생성
    const parentEl = document.querySelector('.waiting-number-container');
    if (parentEl) {
      const infoDiv = document.createElement('div');
      infoDiv.className = 'additional-waiting-info';
      infoDiv.textContent = `현재 총 ${totalWaiting}팀이 대기중입니다.`;
      parentEl.appendChild(infoDiv);
    }
  }
}

function updateScoreboard(status, waitingPosition, estimatedWaitTime) {
  const scoreboardEl = document.querySelector('.baseball-scoreboard .score');
  if (!scoreboardEl) return;

  const statusUpper = String(status || '').toUpperCase();
  let message = '';

  switch (statusUpper) {
    case 'PENDING':
      message = `⚾ 1루 진출! 입금 확인 대기중 (${waitingPosition}번째)`;
      break;
    case 'CONFIRMED':
      message = `⚾ 2루 진출! 입금 확인 완료, 조리 대기 (${waitingPosition}번째)`;
      break;
    case 'IN_PROGRESS':
      message = `⚾ 3루 진출! 현재 조리중, ${estimatedWaitTime}분 후 홈런 예정`;
      break;
    case 'SERVED':
      message = '🏆 홈런! 조리 완료, 픽업 가능합니다';
      stopAutoRefresh();
      break;
    default:
      message = '⚾ 타석 준비중입니다';
  }

  scoreboardEl.textContent = message;
}

/* =========================
   자동 새로고침
========================= */
function startAutoRefresh() {
  // 기존 인터벌 정리
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  // 30초마다 자동 새로고침
  refreshInterval = setInterval(async () => {
    console.log('[waiting] 자동 새로고침 실행');
    await loadWaitingData();
  }, 30000);

  console.log('[waiting] 자동 새로고침 시작 (30초 간격)');
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('[waiting] 자동 새로고침 중지');
  }
}

// 페이지 숨김/표시 시 자동 새로고침 제어
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    startAutoRefresh();
    // 페이지가 다시 보일 때 즉시 새로고침
    loadWaitingData();
  }
});

/* =========================
   유틸리티 함수들
========================= */
function mapStatusToKorean(status) {
  const statusUpper = String(status || '').toUpperCase();
  switch (statusUpper) {
    case 'PENDING': return '⚾ 1루 - 입금 대기중';
    case 'CONFIRMED': return '⚾ 2루 - 입금 확인됨';
    case 'IN_PROGRESS': return '⚾ 3루 - 조리중';
    case 'SERVED': return '🏆 홈런 - 완료';
    case 'CANCELED': return '❌ 아웃 - 취소됨';
    default: return status || '⚾ 타석 준비중';
  }
}

function getStatusClass(status) {
  const statusUpper = String(status || '').toUpperCase();
  switch (statusUpper) {
    case 'PENDING': return 'status-pending';
    case 'CONFIRMED': return 'status-confirmed';
    case 'IN_PROGRESS': return 'status-preparing';
    case 'SERVED': return 'status-completed';
    case 'CANCELED': return 'status-canceled';
    default: return 'status-default';
  }
}

function formatOrderTime(timestamp) {
  if (!timestamp) return '-';
  
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (e) {
    return timestamp;
  }
}

function renderError(message) {
  const el = document.getElementById('waiting-info');
  if (el) {
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="error-message">
        <div class="error-icon">⚠️</div>
        <div class="error-text">${message}</div>
      </div>
    `;
  } else {
    alert(message);
  }
}

// 유틸리티 함수들
function nf(n) { 
  return Number(n || 0).toLocaleString(); 
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 페이지 언로드 시 정리
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});