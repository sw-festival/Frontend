// public/order-system/js/waiting.js - 새로운 API 시스템을 위한 대기 화면
import './config.js';
import { getUserOrderDetails, getWaitingInfo } from './api-session.js';
import { Tokens } from './tokens.js';

/* =========================
   전역 변수
========================= */
let currentOrderId = null;
let refreshInterval = null;
let isRefreshing = false;

/* =========================
   DOM 로드 후 시작
========================= */
document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('[waiting] init error', err);
    renderError('초기화 중 오류가 발생했습니다.');
  });
});

/* =========================
   초기화 및 메인 로직
========================= */
async function init() {
  // DOM 요소 참조
  const $info = document.getElementById('waiting-info');
  const $sectionDetails = document.getElementById('order-details');
  const $summary = document.getElementById('order-summary');
  const $sectionStatus = document.getElementById('waiting-status');

  // 버튼 이벤트 리스너
  document.getElementById('refresh-btn')?.addEventListener('click', () => refreshWaitingInfo());
  document.getElementById('back-btn')?.addEventListener('click', () => (location.href = '/'));

  // 주문 ID 추출
  const sp = new URL(location.href).searchParams;
  currentOrderId = sp.get('orderId') || sp.get('id');
  if (!currentOrderId) {
    return renderError('주문 ID가 없습니다. 올바른 링크로 접근해주세요.');
  }

  // 세션 토큰 확인
  const token = Tokens.getSession?.();
  console.log('[waiting] token', token ? token.slice(0, 12) + '...' : '(없음)');
  if (!token) {
    return renderError('세션이 만료되었거나 처음 접속입니다. 주문 페이지에서 코드를 다시 입력해주세요.');
  }

  // 초기 데이터 로드
  await loadWaitingData();

  // 자동 새로고침 시작 (30초마다)
  startAutoRefresh();
}

/* =========================
   데이터 로드 함수들
========================= */
async function loadWaitingData() {
  if (isRefreshing) return;
  isRefreshing = true;

  const $info = document.getElementById('waiting-info');
  const $sectionDetails = document.getElementById('order-details');
  const $summary = document.getElementById('order-summary');
  const $sectionStatus = document.getElementById('waiting-status');

  try {
    // 로딩 표시
    $info?.classList.remove('hidden');
    $info.textContent = '대기 순번을 확인하는 중...';
    $sectionDetails?.classList.add('hidden');
    $sectionStatus?.classList.add('hidden');

    // 대기 정보 조회 (주문 정보 + 대기 번호 포함)
    const waitingData = await getWaitingInfo(currentOrderId);
    console.log('[waiting] waiting data:', waitingData);

    const { order, waitingPosition, totalWaiting, estimatedWaitTime } = waitingData;

    // 주문 상세 정보 렌더링
    renderSummary($summary, order);

    // 상태 보드 렌더링 (새로운 상태 시스템 적용)
    renderStatusBoard($sectionStatus, order.status, waitingPosition, totalWaiting, estimatedWaitTime);

    // 스코어보드 업데이트
    updateScoreboard(order.status, waitingPosition, estimatedWaitTime);

    // 표시 전환
    $info?.classList.add('hidden');
    $sectionDetails?.classList.remove('hidden');
    $sectionStatus?.classList.remove('hidden');

  } catch (e) {
    const msg = String(e?.message || e);
    console.error('[waiting] loadWaitingData failed:', msg);
    
    if (msg.includes('401') || msg.toLowerCase().includes('token') || msg.includes('세션')) {
      Tokens.clearSession?.();
      return renderError('세션이 만료되었습니다. 주문 페이지에서 코드를 다시 입력해주세요.');
    }
    
    return renderError('주문 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  } finally {
    isRefreshing = false;
  }
}

async function refreshWaitingInfo() {
  console.log('[waiting] 수동 새로고침 시작');
  await loadWaitingData();
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

  // 새로운 상태 시스템에 맞춘 단계 활성화
  const receivedOn = !!status; // 상태가 있으면 접수됨
  const paymentOn = ['CONFIRMED', 'IN_PROGRESS', 'SERVED'].includes(statusUpper);
  const preparingOn = ['IN_PROGRESS', 'SERVED'].includes(statusUpper);
  const completeOn = ['SERVED'].includes(statusUpper);

  // 상태 단계 업데이트
  const steps = [
    ['status-received', receivedOn],
    ['status-payment', paymentOn],
    ['status-preparing', preparingOn],
    ['status-complete', completeOn],
  ];

  steps.forEach(([id, isActive]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', !!isActive);
    el.classList.toggle('current', false); // 일단 current 제거
  });

  // 현재 단계 표시
  let currentStepId = '';
  if (completeOn) {
    currentStepId = 'status-complete';
  } else if (preparingOn) {
    currentStepId = 'status-preparing';
  } else if (paymentOn) {
    currentStepId = 'status-payment';
  } else if (receivedOn) {
    currentStepId = 'status-received';
  }

  if (currentStepId) {
    const currentEl = document.getElementById(currentStepId);
    if (currentEl) currentEl.classList.add('current');
  }

  // 대기 번호 및 정보 업데이트
  updateWaitingNumbers(waitingPosition, totalWaiting, estimatedWaitTime, statusUpper);
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
      message = `💰 입금 확인 대기중 (${waitingPosition}번째)`;
      break;
    case 'CONFIRMED':
      message = `✅ 입금 확인 완료! 조리 대기 (${waitingPosition}번째)`;
      break;
    case 'IN_PROGRESS':
      message = `👨‍🍳 현재 조리중! ${estimatedWaitTime}분 후 완료 예정`;
      break;
    case 'SERVED':
      message = '🎉 조리 완료! 픽업 가능합니다';
      break;
    default:
      message = '주문 처리중입니다';
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
    case 'PENDING': return '💰 입금 대기중';
    case 'CONFIRMED': return '✅ 입금 확인됨';
    case 'IN_PROGRESS': return '👨‍🍳 조리중';
    case 'SERVED': return '🎉 완료';
    case 'CANCELED': return '❌ 취소됨';
    default: return status || '처리중';
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