// ===== 서버 연동 (관리자 PATCH) =====
import { patchOrderStatus } from './api-admin.js';

// ===== 런타임 플래그 기본값 (없으면 기본 세팅) =====
window.RUNTIME = window.RUNTIME || {};
if (typeof window.RUNTIME.USE_FIREBASE_READ === 'undefined') window.RUNTIME.USE_FIREBASE_READ = true;           // 조회 API 나오면 false로
if (typeof window.RUNTIME.USE_FIREBASE_WRITE_MIRROR === 'undefined') window.RUNTIME.USE_FIREBASE_WRITE_MIRROR = true; // 임시 미러

document.addEventListener('DOMContentLoaded', () => {
  console.log('주방 디스플레이 시작');

  // ===== Firebase 안전 초기화 (읽기 전용/미러 목적) =====
  let db = null;
  let ordersRef = null;
  try {
    if (
      window.RUNTIME.USE_FIREBASE_READ &&
      typeof firebase !== 'undefined' &&
      typeof firebaseConfig !== 'undefined'
    ) {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      ordersRef = db.ref('orders');
      console.log('Firebase 초기화 성공 (주방)');
    } else {
      console.warn('Firebase 미사용 또는 설정 누락 (USE_FIREBASE_READ=false 이거나 SDK 미로드)');
    }
  } catch (e) {
    console.error('Firebase 초기화 실패:', e);
  }

  // ===== DOM 요소 =====
  const kitchenClock = document.getElementById('kitchen-clock');
  const pendingCountEl = document.getElementById('pending-count');
  const preparingCountEl = document.getElementById('preparing-count');
  const urgentCountEl = document.getElementById('urgent-count');
  const urgentOrdersList = document.getElementById('urgent-orders-list');
  const normalOrdersList = document.getElementById('normal-orders-list');
  const preparingOrdersList = document.getElementById('preparing-orders-list');
  const refreshBtn = document.getElementById('refresh-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');

  let soundEnabled = true;
  let isFirstLoad = true;
  let previousOrdersCache = {};

  // ===== 시계 =====
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
  setInterval(updateClock, 1000);
  updateClock();

  // ===== 분류 로직 =====
  function categorizeOrders(orders) {
    const categories = { urgent: [], normal: [], preparing: [] };
    const now = Date.now();
    const URGENT_THRESHOLD = 15 * 60 * 1000; // 15분

    Object.entries(orders).forEach(([orderId, order]) => {
      // 입금 확인 이후의 주문만 주방 처리
      if (order.status === 'Payment Confirmed' || order.status === 'Preparing') {
        const orderTime = new Date(order.timestamp).getTime();
        const timeDiff = now - orderTime;

        if (order.status === 'Preparing') {
          categories.preparing.push({ id: orderId, data: order, timeDiff });
        } else if (timeDiff > URGENT_THRESHOLD) {
          categories.urgent.push({ id: orderId, data: order, timeDiff });
        } else {
          categories.normal.push({ id: orderId, data: order, timeDiff });
        }
      }
    });

    // 오래된 순(대기 길수록 위)
    const byOldest = (a, b) => b.timeDiff - a.timeDiff;
    categories.urgent.sort(byOldest);
    categories.normal.sort(byOldest);
    categories.preparing.sort(byOldest);

    return categories;
  }

  // ===== 카드 생성 =====
  function createKitchenOrderCard(orderId, orderData, timeDiff) {
    const card = document.createElement('div');
    const isUrgent = timeDiff > 15 * 60 * 1000;
    const isPreparing = orderData.status === 'Preparing';

    card.className = `kitchen-order-card ${isUrgent ? 'urgent' : ''} ${isPreparing ? 'preparing' : ''}`;
    card.onclick = () => toggleOrderStatus(orderId, orderData); // 클릭으로 상태 토글

    const minutes = Math.floor(timeDiff / (60 * 1000));
    const timeText =
      minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 전`;

    const tableInfo = orderData.orderType === 'takeout' ? '📦 포장' : `🍽️ 테이블 #${orderData.tableNumber}`;

    let menuListHtml = '';
    Object.entries(orderData.items || {}).forEach(([menuName, item]) => {
      menuListHtml += `
        <li class="menu-item">
          <span class="menu-name">${menuName}</span>
          <span class="menu-quantity">${item.quantity}</span>
        </li>
      `;
    });

    card.innerHTML = `
      <div class="order-header">
        <span class="order-id">${(orderId || '').slice(-6).toUpperCase()}</span>
        <span class="order-time ${isUrgent ? 'urgent' : ''}">${timeText}</span>
      </div>
      <div class="table-info">${tableInfo}</div>
      <div class="customer-name">👤 ${orderData.customerName || '-'}</div>
      <ul class="menu-list">
        ${menuListHtml}
      </ul>
      <div class="menu-status-indicator">
        ${Object.keys(orderData.items || {}).map(() => '<span class="status-dot"></span>').join('')}
      </div>
    `;
    return card;
  }

  // ===== 상태 토글 (주방 카드 클릭) =====
  async function toggleOrderStatus(orderId, orderData) {
    try {
      const next =
        orderData.status === 'Payment Confirmed'
          ? 'Preparing'
          : orderData.status === 'Preparing'
          ? 'Order Complete'
          : null;
      if (!next) return;

      // 서버 order_id가 있으면 서버 PATCH 우선
      const serverOrderId = orderData.serverOrderId; // app에서 미러 쓸 때 저장
      if (serverOrderId) {
        const action = next === 'Preparing' ? 'ready' : 'complete';
        await patchOrderStatus(serverOrderId, action);
      } else {
        console.warn('serverOrderId 없음: 임시 미러 데이터로 간주 → 서버 PATCH 건너뜀');
      }

      // (임시) 서버 성공 후 Firebase 미러 동기화
      if (db && window.RUNTIME.USE_FIREBASE_READ && window.RUNTIME.USE_FIREBASE_WRITE_MIRROR) {
        await db.ref('orders/' + orderId).update({ status: next });
      }

      // UX 피드백(사운드)
      if (next === 'Preparing') playKitchenSound('start-cooking');
      if (next === 'Order Complete') playKitchenSound('order-ready');
    } catch (e) {
      console.error(e);
      alert('상태 변경 실패: ' + (e.message || '알 수 없는 오류'));
    }
  }

  // ===== 사운드 =====
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

  // ===== 새 주문/상태 변경 감지(알림 트리거) =====
  function checkForNewOrders(current) {
    if (isFirstLoad) {
      isFirstLoad = false;
      previousOrdersCache = { ...current };
      return;
    }
    const curIds = Object.keys(current);
    const prevIds = Object.keys(previousOrdersCache);
    const newIds = curIds.filter((id) => !prevIds.includes(id));

    newIds.forEach((id) => {
      const o = current[id];
      if (o.status === 'Payment Confirmed') {
        const now = Date.now();
        const t = new Date(o.timestamp).getTime();
        const diff = now - t;
        if (diff > 15 * 60 * 1000) playKitchenSound('urgent-order');
        else playKitchenSound('new-order');
      }
    });

    previousOrdersCache = { ...current };
  }

  // ===== 화면 렌더 =====
  function updateKitchenDisplay(orders) {
    if (!orders) {
      pendingCountEl.textContent = '0';
      preparingCountEl.textContent = '0';
      urgentCountEl.textContent = '0';
      urgentOrdersList.innerHTML = '<div class="empty-state urgent">🎉 긴급 주문이 없습니다</div>';
      normalOrdersList.innerHTML = '<div class="empty-state normal">😊 새로운 주문을 기다리는 중...</div>';
      preparingOrdersList.innerHTML = '<div class="empty-state preparing">✨ 준비중인 주문이 없습니다</div>';
      return;
    }

    // 알림
    checkForNewOrders(orders);

    // 분류
    const categories = categorizeOrders(orders);

    // 통계
    pendingCountEl.textContent = String(categories.normal.length);
    preparingCountEl.textContent = String(categories.preparing.length);
    urgentCountEl.textContent = String(categories.urgent.length);

    // 긴급
    if (categories.urgent.length) {
      urgentOrdersList.innerHTML = '';
      categories.urgent.forEach((o) => urgentOrdersList.appendChild(createKitchenOrderCard(o.id, o.data, o.timeDiff)));
    } else {
      urgentOrdersList.innerHTML = '<div class="empty-state urgent">🎉 긴급 주문이 없습니다</div>';
    }

    // 일반
    if (categories.normal.length) {
      normalOrdersList.innerHTML = '';
      categories.normal.forEach((o) => normalOrdersList.appendChild(createKitchenOrderCard(o.id, o.data, o.timeDiff)));
    } else {
      normalOrdersList.innerHTML = '<div class="empty-state normal">😊 새로운 주문을 기다리는 중...</div>';
    }

    // 준비중
    if (categories.preparing.length) {
      preparingOrdersList.innerHTML = '';
      categories.preparing.forEach((o) =>
        preparingOrdersList.appendChild(createKitchenOrderCard(o.id, o.data, o.timeDiff))
      );
    } else {
      preparingOrdersList.innerHTML = '<div class="empty-state preparing">✨ 준비중인 주문이 없습니다</div>';
    }
  }

  // ===== 실시간 구독 or 안내 =====
  if (ordersRef) {
    ordersRef.on('value', (snap) => updateKitchenDisplay(snap.val()));
  } else {
    // Firebase 미사용 시 안내 (조회 API 나오면 여기서 폴링을 붙이면 됨)
    pendingCountEl.textContent = '0';
    preparingCountEl.textContent = '0';
    urgentCountEl.textContent = '0';
    urgentOrdersList.innerHTML = '<div class="empty-state urgent">서버 연결 중...</div>';
    normalOrdersList.innerHTML = '<div class="empty-state normal">서버 연결 중...</div>';
    preparingOrdersList.innerHTML = '<div class="empty-state preparing">서버 연결 중...</div>';
  }

  // ===== 기타 버튼 =====
  refreshBtn?.addEventListener('click', () => location.reload());
  fullscreenBtn?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => console.log('전체화면 실패:', err));
    } else {
      document.exitFullscreen();
    }
  });

  // 사운드 토글
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      soundToggleBtn.textContent = soundEnabled ? '🔔 알림음' : '🔕 알림음';
      soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
      localStorage.setItem('kitchen-sound-enabled', String(soundEnabled));
      if (soundEnabled) playKitchenSound('start-cooking');
    });

    const saved = localStorage.getItem('kitchen-sound-enabled');
    if (saved !== null) {
      soundEnabled = saved === 'true';
      soundToggleBtn.textContent = soundEnabled ? '🔔 알림음' : '🔕 알림음';
      soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
    }
  }

  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
  });

  console.log('✅ 주방 디스플레이 초기화 완료');
});
