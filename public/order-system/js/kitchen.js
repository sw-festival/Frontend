// kitchen.js - 새로운 API 시스템을 위한 주방 디스플레이
import './config.js';
import { patchOrderStatus, getActiveOrders, createOrderStream } from './api-admin.js';

/* =========================
   공통 유틸 / 인증 처리
========================= */
function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) return resolve();
    const tick = () => (window.RUNTIME ? resolve() : setTimeout(tick, 10));
    tick();
  });
}

/* =========================
   전역 변수
========================= */
let sseConnection = null;      // SSE 핸들
let currentOrders = {};        // 현재 주문 데이터 캐시
let soundEnabled = true;       // 사운드 활성화 상태
let isFirstLoad = true;        // 첫 로드 확인
let currentModalOrder = null;  // 현재 모달에서 처리중인 주문

/* =========================
   DOM 로드 후 시작
========================= */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('주방 디스플레이 시작');

  await waitForRuntime();

  // DOM 요소 캐시
  const kitchenClock = document.getElementById('kitchen-clock');
  const confirmedCountEl = document.getElementById('confirmed-count');
  const inProgressCountEl = document.getElementById('in-progress-count');
  const servedCountEl = document.getElementById('served-count');
  const urgentCountEl = document.getElementById('urgent-count');
  
  const urgentOrdersList = document.getElementById('urgent-orders-list');
  const confirmedOrdersList = document.getElementById('confirmed-orders-list');
  const inProgressOrdersList = document.getElementById('in-progress-orders-list');
  const servedOrdersList = document.getElementById('served-orders-list');
  
  const refreshBtn = document.getElementById('refresh-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');

  // 모달 요소들
  const modal = document.getElementById('order-status-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalOrderInfo = document.getElementById('modal-order-info');
  const modalStatusInfo = document.getElementById('modal-status-info');
  const modalConfirm = document.getElementById('modal-confirm');
  const modalCancel = document.getElementById('modal-cancel');
  const modalClose = document.getElementById('modal-close');

  /* ============ 유틸 함수들 ============ */
  
  // 시계 업데이트
  function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    if (kitchenClock) kitchenClock.textContent = timeString;
  }

  // 상태 한국어 매핑
  function mapStatusK(status) {
    switch (status) {
      case 'PENDING':     return '💰 입금 대기';
      case 'CONFIRMED':   return '💳 입금 확인됨';
      case 'IN_PROGRESS': return '👨‍🍳 조리중';
      case 'SERVED':      return '🍽️ 서빙 완료';
      case 'CANCELED':    return '❌취소됨';
      default:            return status || '';
    }
  }

  // 상태별 색상 반환
  function getStatusColor(status) {
    switch (status) {
      case 'PENDING': return '#f39c12';      // 주황색
      case 'CONFIRMED': return '#27ae60';    // 초록색
      case 'IN_PROGRESS': return '#3498db';  // 파란색
      case 'SERVED': return '#2ecc71';       // 밝은 초록
      case 'CANCELED': return '#e74c3c';     // 빨간색
      default: return '#95a5a6';             // 회색
    }
  }

  // 사운드 재생
  function playKitchenSound(type) {
    if (!soundEnabled) return;
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const beep = (freq, dur) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(freq, audioContext.currentTime);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.2, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + dur / 1000);
        osc.start();
        osc.stop(audioContext.currentTime + dur / 1000);
      };
      
      switch (type) {
        case 'new-order':
          beep(400, 300); setTimeout(() => beep(600, 300), 400); break;
        case 'urgent-order':
          beep(800, 200); setTimeout(() => beep(1000, 200), 300); setTimeout(() => beep(800, 200), 600); break;
        case 'start-cooking':
          beep(600, 400); break;
        case 'order-ready':
          beep(500, 200); setTimeout(() => beep(700, 200), 200); setTimeout(() => beep(900, 400), 400); break;
      }
    } catch (e) {
      console.warn('주방 사운드 재생 실패:', e);
    }
  }

  /* ============ 주문 분류 및 렌더링 ============ */
  
  // 주문 분류
  function categorizeOrders(orders) {
    const categories = {
      urgent: [],
      confirmed: [],
      inProgress: [],
      served: []
    };
    
    const now = Date.now();
    const URGENT_THRESHOLD = 15 * 60 * 1000; // 15분

    orders.forEach(order => {
      const orderTime = new Date(order.created_at).getTime();
      const timeDiff = now - orderTime;
      const isUrgent = timeDiff > URGENT_THRESHOLD;

      // 상태별 분류
      if (order.status === 'CONFIRMED') {
        if (isUrgent) {
          categories.urgent.push({ ...order, timeDiff, isUrgent: true });
        } else {
          categories.confirmed.push({ ...order, timeDiff, isUrgent: false });
        }
      } else if (order.status === 'IN_PROGRESS') {
        if (isUrgent) {
          categories.urgent.push({ ...order, timeDiff, isUrgent: true });
        } else {
          categories.inProgress.push({ ...order, timeDiff, isUrgent: false });
        }
      } else if (order.status === 'SERVED') {
        categories.served.push({ ...order, timeDiff, isUrgent: false });
      }
    });

    // 오래된 순으로 정렬 (대기 시간이 긴 것부터)
    const sortByOldest = (a, b) => b.timeDiff - a.timeDiff;
    categories.urgent.sort(sortByOldest);
    categories.confirmed.sort(sortByOldest);
    categories.inProgress.sort(sortByOldest);
    categories.served.sort(sortByOldest);

    return categories;
  }

  // 주문 카드 생성
  function createKitchenOrderCard(order) {
    const card = document.createElement('div');
    const isUrgent = order.isUrgent || false;
    
    card.className = `kitchen-order-card ${isUrgent ? 'urgent' : ''} ${order.status.toLowerCase().replace('_', '-')}`;
    card.onclick = () => openStatusModal(order);

    const minutes = Math.floor(order.timeDiff / (60 * 1000));
    const timeText = minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 전`;

    const tableInfo = order.order_type === 'TAKEOUT' ? '📦 포장' : `🍽️ ${order.table?.label || '테이블'}`;

    // 주문 항목 HTML 생성
    let menuListHtml = '';
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        menuListHtml += `
          <li class="menu-item">
            <span class="menu-name">${item.name}</span>
            <span class="menu-quantity">×${item.quantity}</span>
          </li>
        `;
      });
    }

    card.innerHTML = `
      <div class="order-header">
        <span class="order-id">#${order.id}</span>
        <span class="order-time ${isUrgent ? 'urgent' : ''}">${timeText}</span>
      </div>
      <div class="table-info">${tableInfo}</div>
      <div class="customer-name">👤 ${order.payer_name || '-'}</div>
      <div class="order-status">
        <span class="status-badge" style="background-color: ${getStatusColor(order.status)};">
          ${mapStatusK(order.status)}
        </span>
      </div>
      <ul class="menu-list">
        ${menuListHtml || '<li class="no-items">항목 정보 없음</li>'}
      </ul>
      <div class="order-total">
        총 ${Number(order.total_amount || 0).toLocaleString()}원
      </div>
    `;

    return card;
  }

  /* ============ 모달 시스템 ============ */
  
  function openStatusModal(order) {
    if (!modal) return;
    
    currentModalOrder = order;
    
    // 모달 제목 설정
    modalTitle.textContent = `주문 #${order.id} 상태 변경`;
    
    // 주문 정보 표시
    const tableInfo = order.order_type === 'TAKEOUT' ? '포장 주문' : `테이블: ${order.table?.label || '정보 없음'}`;
    const itemsHtml = (order.items || [])
      .map(item => `<li>${item.name} × ${item.quantity}개</li>`)
      .join('');
    
    modalOrderInfo.innerHTML = `
      <div class="modal-order-details">
        <h4>주문 정보</h4>
        <p><strong>주문번호:</strong> #${order.id}</p>
        <p><strong>${tableInfo}</strong></p>
        <p><strong>입금자:</strong> ${order.payer_name || '정보 없음'}</p>
        <p><strong>총 금액:</strong> ${Number(order.total_amount || 0).toLocaleString()}원</p>
        <div class="order-items">
          <h5>주문 항목:</h5>
          <ul>${itemsHtml || '<li>항목 정보 없음</li>'}</ul>
        </div>
      </div>
    `;
    
    // 상태 변경 정보 표시
    let nextStatus = '';
    let nextStatusText = '';
    let actionText = '';
    
    if (order.status === 'CONFIRMED') {
      nextStatus = 'IN_PROGRESS';
      nextStatusText = '👨‍🍳 조리중';
      actionText = '조리를 시작하시겠습니까?';
    } else if (order.status === 'IN_PROGRESS') {
      nextStatus = 'SERVED';
      nextStatusText = '🍽️ 서빙 완료';
      actionText = '조리를 완료하고 서빙 준비하시겠습니까?';
    } else {
      modalStatusInfo.innerHTML = '<p>이 주문은 상태 변경이 불가능합니다.</p>';
      modalConfirm.style.display = 'none';
      modal.style.display = 'block';
      return;
    }
    
    modalStatusInfo.innerHTML = `
      <div class="status-change-info">
        <h4>상태 변경</h4>
        <div class="status-flow">
          <span class="current-status" style="background-color: ${getStatusColor(order.status)};">
            ${mapStatusK(order.status)}
          </span>
          <span class="arrow">→</span>
          <span class="next-status" style="background-color: ${getStatusColor(nextStatus)};">
            ${nextStatusText}
          </span>
        </div>
        <p class="action-question">${actionText}</p>
      </div>
    `;
    
    modalConfirm.style.display = 'inline-block';
    modal.style.display = 'block';
  }

  function closeStatusModal() {
    if (modal) {
      modal.style.display = 'none';
      currentModalOrder = null;
    }
  }

  async function confirmStatusChange() {
    if (!currentModalOrder) return;
    
    try {
      let action = '';
      if (currentModalOrder.status === 'CONFIRMED') {
        action = 'start_preparing';
      } else if (currentModalOrder.status === 'IN_PROGRESS') {
        action = 'serve';
      }
      
      if (!action) return;

      // 버튼 비활성화
      modalConfirm.disabled = true;
      modalConfirm.textContent = '처리중...';

      // 상태 변경 API 호출
      await patchOrderStatus(currentModalOrder.id, action);

      // 사운드 재생
      if (action === 'start_preparing') {
        playKitchenSound('start-cooking');
      } else if (action === 'serve') {
        playKitchenSound('order-ready');
      }

      // 성공 메시지
      console.log(`✅ 주문 #${currentModalOrder.id} 상태 변경 완료: ${action}`);

      // 모달 닫기
      closeStatusModal();

      // 주문 목록 새로고침
      await loadKitchenOrders();

    } catch (err) {
      console.error('상태 변경 실패:', err);
      alert(`상태 변경 실패: ${err?.message || '알 수 없는 오류'}`);
    } finally {
      // 버튼 복원
      modalConfirm.disabled = false;
      modalConfirm.textContent = '확인';
    }
  }

  /* ============ 데이터 로드 및 렌더링 ============ */
  
  async function loadKitchenOrders() {
    try {
      console.log('📊 주방 주문 데이터 로드 중...');
      
      // 활성 주문 데이터 가져오기
      const resp = await getActiveOrders();
      const { urgent = [], waiting = [], preparing = [] } = resp.data || {};
      
      // 모든 주문을 하나의 배열로 합치기
      const allOrders = [...urgent, ...waiting, ...preparing];
      
      // 주방에서 처리할 주문만 필터링 (CONFIRMED, IN_PROGRESS, SERVED)
      const kitchenOrders = allOrders.filter(order => 
        ['CONFIRMED', 'IN_PROGRESS', 'SERVED'].includes(order.status)
      );

      // 주문 분류
      const categories = categorizeOrders(kitchenOrders);

      // 화면 업데이트
      updateKitchenDisplay(categories);
      
      // 새로운 주문 알림 체크
      checkForNewOrders(kitchenOrders);

      console.log(`✅ 주방 주문 로드 완료: ${kitchenOrders.length}건`);

    } catch (err) {
      console.error('❌ 주방 주문 로드 실패:', err);
      showErrorState();
    }
  }

  function updateKitchenDisplay(categories) {
    // 통계 업데이트
    if (confirmedCountEl) confirmedCountEl.textContent = categories.confirmed.length;
    if (inProgressCountEl) inProgressCountEl.textContent = categories.inProgress.length;
    if (servedCountEl) servedCountEl.textContent = categories.served.length;
    if (urgentCountEl) urgentCountEl.textContent = categories.urgent.length;

    // 긴급 주문 렌더링
    if (urgentOrdersList) {
      if (categories.urgent.length > 0) {
        urgentOrdersList.innerHTML = '';
        categories.urgent.forEach(order => {
          urgentOrdersList.appendChild(createKitchenOrderCard(order));
        });
      } else {
        urgentOrdersList.innerHTML = '<div class="empty-state urgent">🎉 긴급 주문이 없습니다</div>';
      }
    }

    // 대기중인 주문 (CONFIRMED) 렌더링
    if (confirmedOrdersList) {
      if (categories.confirmed.length > 0) {
        confirmedOrdersList.innerHTML = '';
        categories.confirmed.forEach(order => {
          confirmedOrdersList.appendChild(createKitchenOrderCard(order));
        });
      } else {
        confirmedOrdersList.innerHTML = '<div class="empty-state confirmed">😊 새로운 주문을 기다리는 중...</div>';
      }
    }

    // 조리중인 주문 (IN_PROGRESS) 렌더링
    if (inProgressOrdersList) {
      if (categories.inProgress.length > 0) {
        inProgressOrdersList.innerHTML = '';
        categories.inProgress.forEach(order => {
          inProgressOrdersList.appendChild(createKitchenOrderCard(order));
        });
      } else {
        inProgressOrdersList.innerHTML = '<div class="empty-state in-progress">✨ 조리중인 주문이 없습니다</div>';
      }
    }

    // 완료된 주문 (SERVED) 렌더링
    if (servedOrdersList) {
      if (categories.served.length > 0) {
        servedOrdersList.innerHTML = '';
        categories.served.forEach(order => {
          servedOrdersList.appendChild(createKitchenOrderCard(order));
        });
      } else {
        servedOrdersList.innerHTML = '<div class="empty-state served">🍽️ 완료된 주문이 없습니다</div>';
      }
    }
  }

  function showErrorState() {
    const errorHtml = '<div class="empty-state error">❌ 주문 데이터를 불러올 수 없습니다</div>';
    if (urgentOrdersList) urgentOrdersList.innerHTML = errorHtml;
    if (confirmedOrdersList) confirmedOrdersList.innerHTML = errorHtml;
    if (inProgressOrdersList) inProgressOrdersList.innerHTML = errorHtml;
    if (servedOrdersList) servedOrdersList.innerHTML = errorHtml;
  }

  // 새로운 주문 알림
  function checkForNewOrders(orders) {
    if (isFirstLoad) {
      isFirstLoad = false;
      currentOrders = orders.reduce((acc, order) => {
        acc[order.id] = order;
        return acc;
      }, {});
      return;
    }

    const newOrderIds = orders.filter(order => !currentOrders[order.id]).map(o => o.id);
    
    newOrderIds.forEach(id => {
      const order = orders.find(o => o.id === id);
      if (order && order.status === 'CONFIRMED') {
        const now = Date.now();
        const orderTime = new Date(order.created_at).getTime();
        const timeDiff = now - orderTime;
        
        if (timeDiff > 15 * 60 * 1000) {
          playKitchenSound('urgent-order');
        } else {
          playKitchenSound('new-order');
        }
      }
    });

    // 캐시 업데이트
    currentOrders = orders.reduce((acc, order) => {
      acc[order.id] = order;
      return acc;
    }, {});
  }

  /* ============ 이벤트 리스너 설정 ============ */
  
  // 시계 업데이트
  setInterval(updateClock, 1000);
  updateClock();

  // 모달 이벤트
  if (modalConfirm) modalConfirm.addEventListener('click', confirmStatusChange);
  if (modalCancel) modalCancel.addEventListener('click', closeStatusModal);
  if (modalClose) modalClose.addEventListener('click', closeStatusModal);
  
  // 모달 배경 클릭시 닫기
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeStatusModal();
    });
  }

  // 기타 버튼들
  if (refreshBtn) refreshBtn.addEventListener('click', () => location.reload());
  
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => console.log('전체화면 실패:', err));
      } else {
        document.exitFullscreen();
      }
    });
  }

  // 사운드 토글
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      soundToggleBtn.textContent = soundEnabled ? '🔔 알림음' : '🔕 알림음';
      soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
      localStorage.setItem('kitchen-sound-enabled', String(soundEnabled));
      if (soundEnabled) playKitchenSound('start-cooking');
    });

    // 저장된 사운드 설정 로드
    const savedSound = localStorage.getItem('kitchen-sound-enabled');
    if (savedSound !== null) {
      soundEnabled = savedSound === 'true';
      soundToggleBtn.textContent = soundEnabled ? '🔔 알림음' : '🔕 알림음';
      soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
    }
  }

  // 전체화면 변경 감지
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
  });

  /* ============ 실시간 데이터 연결 ============ */
  
  // SSE 연결 시도
  try {
    sseConnection = await createOrderStream(
      (type, payload) => {
        if (type === 'snapshot') {
          // 초기 스냅샷은 활성 주문 API로 대체
          loadKitchenOrders();
        } else if (type === 'orders_changed') {
          // 주문 변경 시 새로고침
          loadKitchenOrders();
        } else if (type === 'ping') {
          // 연결 유지
          console.log('🏓 SSE 연결 유지됨');
        }
      },
      (err) => {
        console.warn('SSE 오류, 폴링으로 대체:', err?.message || err);
        // SSE 실패시 주기적 폴링으로 대체
        setInterval(loadKitchenOrders, 10000); // 10초마다
      }
    );
    console.log('✅ SSE 연결 성공');
  } catch (e) {
    console.warn('SSE 연결 실패, 폴링 사용');
    setInterval(loadKitchenOrders, 10000); // 10초마다
  }

  // 초기 데이터 로드
  loadKitchenOrders();
  
  // 백업 폴링 (30초마다)
  setInterval(loadKitchenOrders, 30000);

  console.log('✅ 주방 디스플레이 초기화 완료');
});