import './config.js';
import { adminLogin, patchOrderStatus, ensureTable, getOrderDetails, getActiveOrders, getAdminMenu, createOrderStream, forceCloseSession } from './api-admin.js';

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

// 관리자 인증 확인 (수정)
function checkAdminAuth() {
  const isLoggedIn = sessionStorage.getItem('admin_logged_in') === 'true';
  const loginTime  = Number(sessionStorage.getItem('admin_login_time') || 0);
  const hasToken   = !!(sessionStorage.getItem('admin_token') || localStorage.getItem('accesstoken'));

  const expired = !loginTime || (Date.now() - loginTime) > (12 * 60 * 60 * 1000);

  if (!isLoggedIn || !hasToken || expired) {
        sessionStorage.removeItem('admin_logged_in');
        sessionStorage.removeItem('admin_login_time');
    sessionStorage.removeItem('admin_token');
    window.location.href = '/admin-login';
        return false;
    }
    return true;
}

// 로그아웃 처리
function logout() {
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_login_time');
  window.location.href = '/order-system/admin-login.html';
}

// 전역 Firebase 변수
let db = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 관리자 인증 확인
  if (!checkAdminAuth()) return;

  // RUNTIME 준비 (API_BASE 등)
  await waitForRuntime();

    // Firebase 초기화
  if (typeof firebase !== 'undefined' && window.firebaseConfig) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  }

    const adminDashboard = document.getElementById('admin-dashboard');
    const inventoryList = document.getElementById('inventory-list');
    const notificationToggleBtn = document.getElementById('notification-toggle');
    const testSoundBtn = document.getElementById('test-sound-btn');

  // 슬러그 발급 UI 요소 (없으면 자동 무시)
  const ensureLabelInput  = document.getElementById('ensure-label');   // ex) A-10
  const ensureActiveCheck = document.getElementById('ensure-active');  // 체크박스
  const ensureBtn         = document.getElementById('ensure-btn');     // 발급 버튼
  const ensureResult      = document.getElementById('ensure-result');  // 결과 출력 <p>

    let allOrdersCache = {}; // 전체 주문 데이터 캐시
  let isFirstLoad = true;  // 첫 로드 확인
  let notificationsEnabled = false; // 브라우저 알림 권한 상태
    let soundEnabled = true; // 소리 활성화 상태
  let sseConnection = null; // SSE 연결 객체
  let adminMenuData = []; // 관리자용 메뉴 데이터
    
    // 메뉴별 초기 재고 (관리자가 설정 가능)
    const menuInventory = {
    'SSG 문학철판구이' : 25900,
    'NC 빙하기공룡고기' : 19900,
    'KIA 호랑이 생고기 (기아 타이거즈 고추장 범벅)' : 21900,
    '라팍 김치말이국수' : 7900,
    '키움쫄?쫄면' : 5900,
    'LG라면' : 5900,
    '롯데 자이언츠 화채' : 6900,
    '두산 B볶음s' : 8900,
    '후리카케 크봉밥' : 2500,
    '캔음료(제로콜라, 사이다)' : 3000,
    '물' : 2000,
    '팀 컬러 칵테일': 3500
  };

  // ===== 유틸 =====
    function getStatusText(status) {
    switch (status) {
            case 'pending': return '대기중';
            case 'preparing': return '준비중';
            case 'ready': return '완료';
            case 'served': return '서빙완료';
            default: return '대기중';
        }
    }
    function getStatusDisplayText(status) {
    switch (status) {
            case 'Payment Pending': return '💰 입금 대기중';
            case 'Payment Confirmed': return '💳 입금 확인됨';
            case 'Preparing': return '👨‍🍳 준비중';
            case 'Order Complete': return '✅ 완료';
            default: return status;
        }
    }
    
  // ===== 알림 =====
    function requestNotificationPermission() {
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                notificationsEnabled = permission === 'granted';
                if (notificationsEnabled) {
                    console.log('✅ 브라우저 알림 권한이 허용되었습니다.');
          // showSystemNotification('MEMORY 주점 관리자', '실시간 알림이 활성화되었습니다! 🎉');
                } else {
                    console.log('❌ 브라우저 알림 권한이 거부되었습니다.');
                }
            });
        }
    }

    function playNotificationSound(type = 'new-order') {
    if (!soundEnabled) return;
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const playBeep = (frequency, duration) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration / 1000);
      };
            if (type === 'new-order') {
        playBeep(800, 200);
        setTimeout(() => playBeep(1000, 200), 300);
            } else if (type === 'status-change') {
        playBeep(600, 300);
            } else if (type === 'payment-pending') {
        playBeep(500, 150);
        setTimeout(() => playBeep(700, 150), 200);
        setTimeout(() => playBeep(900, 150), 400);
            }
        } catch (error) {
            console.warn('소리 재생 실패:', error);
        }
    }
    function toggleNotifications() {
    soundEnabled = !soundEnabled;
    if (notificationToggleBtn) {
      notificationToggleBtn.innerHTML = soundEnabled ? '🔔 알림 ON' : '🔕 알림 OFF';
      notificationToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
    }
    if (soundEnabled) playNotificationSound('status-change');
        localStorage.setItem('memory-pub-sound-enabled', soundEnabled);
    }
    function testNotificationSound() {
        playNotificationSound('new-order');
        setTimeout(() => {
            showSystemNotification('🔊 소리 테스트', '소리가 잘 들리시나요?');
        }, 500);
    }
    function loadNotificationSettings() {
    const saved = localStorage.getItem('memory-pub-sound-enabled');
    if (saved !== null) {
      soundEnabled = saved === 'true';
    }
            if (notificationToggleBtn) {
                notificationToggleBtn.innerHTML = soundEnabled ? '🔔 알림 ON' : '🔕 알림 OFF';
                notificationToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
            }
        }

  // ===== 새 주문/상태 변경 감지 =====
  function checkForNewOrders(newOrders) {
    if (isFirstLoad) { isFirstLoad = false; return; }
    const newIds = Object.keys(newOrders);
    const oldIds = Object.keys(allOrdersCache);

    const created = newIds.filter(id => !oldIds.includes(id));
    if (created.length > 0) {
      created.forEach(id => {
        const order = newOrders[id];
        const tableInfo = order.orderType === 'takeout' ? '포장' : `테이블 #${order.tableNumber}`;
        if (order.status === 'Payment Pending') {
          playNotificationSound('payment-pending');
          showSystemNotification('💰 새 주문 (입금 대기)', `${tableInfo} - ${order.customerName}님\n총 ${order.totalPrice?.toLocaleString?.() || ''}원`);
        } else {
          playNotificationSound('new-order');
          showSystemNotification('🎉 새 주문 접수!', `${tableInfo} - ${order.customerName}님\n총 ${order.totalPrice?.toLocaleString?.() || ''}원`);
        }
      });
    }

    oldIds.forEach(id => {
      if (newOrders[id] && allOrdersCache[id]) {
        const oldStatus = allOrdersCache[id].status;
        const newStatus = newOrders[id].status;
        if (oldStatus !== newStatus) {
          playNotificationSound('status-change');
          const order = newOrders[id];
          const tableInfo = order.orderType === 'takeout' ? '포장' : `테이블 #${order.tableNumber}`;
          showSystemNotification('🔄 주문 상태 변경', `${tableInfo} - ${getStatusDisplayText(newStatus)}`);
        }
      }
    });
  }

  // ===== SSE 연결 관리 =====
  async function initSSEConnection() {
    try {
      console.log('🔗 SSE 연결 초기화 중...');
      
      if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
      }

      sseConnection = await createOrderStream(
        (eventType, data) => {
          console.log(`📨 SSE 이벤트 수신: ${eventType}`, data);
          
          switch (eventType) {
            case 'snapshot':
              // 초기 스냅샷 수신 시 주문 목록 업데이트
              updateOrdersFromSSE(data);
              break;
              
            case 'orders_changed':
              // 주문 변경 시 목록 새로고침
              console.log('🔄 주문 변경 감지, 목록 새로고침');
              loadActiveOrders();
              break;
              
            case 'ping':
              // 연결 유지 확인
              console.log('🏓 SSE 연결 유지됨');
              break;
          }
        },
        (error) => {
          console.error('❌ SSE 연결 오류:', error);
          // 5초 후 재연결 시도
          setTimeout(() => {
            console.log('🔄 SSE 재연결 시도...');
            initSSEConnection();
          }, 5000);
        }
      );

      console.log('✅ SSE 연결 성공');
      
    } catch (error) {
      console.error('❌ SSE 연결 실패:', error);
      // 폴백: 주기적 폴링으로 대체
      console.log('📊 폴링 모드로 전환');
      setInterval(loadActiveOrders, 10000); // 10초마다 새로고침
    }
  }

  function updateOrdersFromSSE(sseData) {
    try {
      const { data: { urgent = [], waiting = [], preparing = [] } = {}, meta = {} } = sseData;
      
      // 대시보드 초기화
      if (adminDashboard) adminDashboard.innerHTML = '';

      // SSE 데이터를 Firebase 형태로 변환
      const allActive = [...urgent, ...waiting, ...preparing];
      const ordersForDisplay = {};
      
      allActive.forEach(order => {
        ordersForDisplay[order.id] = {
          id: order.id,
          status: getFirebaseStatus(order.status),
          customerName: order.payer_name,
          tableNumber: extractTableNumber(order.table),
          orderType: order.status === 'TAKEOUT' ? 'takeout' : 'dine-in',
          totalPrice: 0, // SSE에서는 가격 정보가 없으므로 0으로 설정
          timestamp: new Date(order.placed_at).getTime(),
          items: {}
        };
      });

      // 기존 displayOrders 함수 재사용
      displayOrders(ordersForDisplay);
      
      // 통계 업데이트
      updateOrderStats(meta);
      
    } catch (error) {
      console.error('SSE 데이터 처리 오류:', error);
    }
  }

  function getFirebaseStatus(apiStatus) {
    switch (apiStatus) {
      case 'CONFIRMED': return 'Payment Confirmed';
      case 'IN_PROGRESS': return 'Preparing';
      case 'COMPLETED': return 'Order Complete';
      case 'CANCELLED': return 'Cancelled';
      default: return 'Payment Pending';
    }
  }

  function extractTableNumber(tableLabel) {
    if (!tableLabel) return 1;
    const match = tableLabel.match(/(\d+)/);
    return match ? parseInt(match[1]) : 1;
  }

  function updateOrderStats(meta) {
    const statsEl = document.getElementById('order-stats');
    if (statsEl && meta) {
      statsEl.innerHTML = `
        <div class="stats-item">
          <span class="stats-label">긴급:</span>
          <span class="stats-value urgent">${meta.counts?.urgent || 0}</span>
        </div>
        <div class="stats-item">
          <span class="stats-label">대기:</span>
          <span class="stats-value waiting">${meta.counts?.waiting || 0}</span>
        </div>
        <div class="stats-item">
          <span class="stats-label">준비중:</span>
          <span class="stats-value preparing">${meta.counts?.preparing || 0}</span>
        </div>
        <div class="stats-item">
          <span class="stats-label">총계:</span>
          <span class="stats-value total">${meta.total || 0}</span>
        </div>
      `;
    }
  }

  // ===== 관리자용 메뉴 관리 =====
  async function loadAdminMenu() {
    try {
      console.log('📋 관리자용 메뉴 로드 중...');
      adminMenuData = await getAdminMenu();
      displayMenuInventory(adminMenuData);
      console.log('✅ 메뉴 로드 완료:', adminMenuData.length, '개 항목');
    } catch (error) {
      console.error('❌ 메뉴 로드 실패:', error);
      // 폴백: 기존 하드코딩된 메뉴 사용
      displayMenuInventory([]);
    }
  }

  function displayMenuInventory(menuData) {
    if (!inventoryList) return;

    let inventoryHTML = '<h3>📋 메뉴 재고 관리</h3>';
    
    if (menuData && menuData.length > 0) {
      // API에서 받은 메뉴 데이터 사용
      menuData.forEach(item => {
        const soldOutClass = item.is_sold_out ? 'sold-out' : '';
        const stockStatus = item.is_sold_out ? '품절' : `재고 ${item.stock}개`;
        
        inventoryHTML += `
          <div class="inventory-item ${soldOutClass}">
            <div class="menu-info">
              <span class="menu-name">${item.name}</span>
              <span class="menu-price">${item.price.toLocaleString()}원</span>
            </div>
            <div class="inventory-controls">
              <span class="stock-info">${stockStatus}</span>
              <button class="toggle-stock-btn" data-menu-id="${item.id}" data-sold-out="${item.is_sold_out}">
                ${item.is_sold_out ? '재입고' : '품절처리'}
              </button>
            </div>
          </div>
        `;
      });
    } else {
      // 폴백: 기존 하드코딩된 메뉴 사용
      Object.entries(menuInventory).forEach(([name, price]) => {
        inventoryHTML += `
          <div class="inventory-item">
            <div class="menu-info">
              <span class="menu-name">${name}</span>
              <span class="menu-price">${price.toLocaleString()}원</span>
            </div>
            <div class="inventory-controls">
              <span class="stock-info">재고 관리 중</span>
              <button class="toggle-stock-btn" data-menu-name="${name}">
                재고 관리
              </button>
            </div>
          </div>
        `;
      });
    }

    inventoryList.innerHTML = inventoryHTML;

    // 재고 관리 버튼 이벤트 리스너 추가
    inventoryList.querySelectorAll('.toggle-stock-btn').forEach(btn => {
      btn.addEventListener('click', handleStockToggle);
    });
  }

  function handleStockToggle(event) {
    const btn = event.target;
    const menuId = btn.dataset.menuId;
    const menuName = btn.dataset.menuName;
    const isSoldOut = btn.dataset.soldOut === 'true';

    if (menuId) {
      // API 기반 재고 관리
      console.log(`재고 상태 변경: 메뉴 ID ${menuId}, 현재 품절: ${isSoldOut}`);
      // TODO: 실제 재고 상태 변경 API 호출
      alert(`${isSoldOut ? '재입고' : '품절처리'} 기능은 추후 구현 예정입니다.`);
    } else if (menuName) {
      // 폴백 모드
      console.log(`재고 관리: ${menuName}`);
      alert(`${menuName} 재고 관리 기능은 추후 구현 예정입니다.`);
    }
  }

  // ===== API 기반 주문 로드 =====
    async function loadActiveOrders() {
        try {
            console.log('📊 진행중 주문 데이터 로드 중...');
            const response = await getActiveOrders();
      const { urgent = [], waiting = [], preparing = [] } = response.data || {};
      const meta = response.meta || {};
            
            // 대시보드 초기화
      if (adminDashboard) adminDashboard.innerHTML = '';

      // 모든 주문을 배열로 합치고 Firebase형태 유사객체로 변환
      const allActive = [...urgent, ...waiting, ...preparing];
            const ordersForDisplay = {};
      allActive.forEach(order => {
                ordersForDisplay[order.id] = {
                    id: order.id,
                    status: mapAPIStatusToFirebase(order.status),
                    tableNumber: order.table,
                    customerName: order.payer_name,
                    timestamp: new Date(order.placed_at).getTime(),
                    items: {},
                    totalPrice: 0,
                    orderType: 'dine-in'
                };
            });
            
      // 기존 렌더링 로직 재사용 (createOrderCard / updateStatistics / updateInventory / updateSalesDashboard 등)
            if (Object.keys(ordersForDisplay).length > 0) {
        // 변경 감지/알림
        checkForNewOrders(ordersForDisplay);
                allOrdersCache = ordersForDisplay;

        const sorted = Object.entries(ordersForDisplay).sort(([, a], [, b]) => b.timestamp - a.timestamp);

        if (typeof updateStatistics === 'function') updateStatistics(ordersForDisplay);
        if (typeof updateInventory === 'function') updateInventory(ordersForDisplay);
        if (typeof updateSalesDashboard === 'function') updateSalesDashboard(ordersForDisplay);

        if (adminDashboard) {
          for (const [, orderData] of sorted) {
            if (typeof createOrderCard === 'function') {
              const card = createOrderCard(orderData.id, orderData);
              adminDashboard.appendChild(card);
            } else {
              // 카드 생성 함수가 없다면 최소 표시
              const div = document.createElement('div');
              div.className = 'order-card';
              div.textContent = `#${orderData.id} ${orderData.customerName} (${orderData.tableNumber}) - ${getStatusDisplayText(orderData.status)}`;
              adminDashboard.appendChild(div);
            }
          }
                }
            } else {
        if (adminDashboard) {
                adminDashboard.innerHTML = '<p>아직 접수된 주문이 없습니다.</p>';
        }
        if (typeof updateStatistics === 'function') updateStatistics({});
        if (typeof updateInventory === 'function') updateInventory({});
        if (typeof updateSalesDashboard === 'function') updateSalesDashboard({});
            }
            
            isFirstLoad = false;
      console.log(`✅ 활성 주문 로드 완료: ${meta.total ?? Object.keys(ordersForDisplay).length}건`);
        } catch (error) {
            console.error('❌ 주문 데이터 로드 실패:', error);
      if (adminDashboard) adminDashboard.innerHTML = '<p>주문 데이터를 불러오는데 실패했습니다.</p>';
        }
    }
    
  // API 상태 → Firebase 상태로 매핑
    function mapAPIStatusToFirebase(apiStatus) {
    switch (apiStatus) {
      case 'CONFIRMED':  return 'Payment Confirmed';
      case 'IN_PROGRESS':return 'Preparing';
      case 'COMPLETED':  return 'Order Complete';
      default:           return 'Payment Pending';
    }
  }
  // Firebase 상태 → API 액션으로 매핑
    function mapFirebaseStatusToAPIAction(firebaseStatus) {
    switch (firebaseStatus) {
            case 'Payment Confirmed': return 'confirm';
      case 'Preparing':         return 'start_preparing';
      case 'Order Complete':    return 'complete';
      default:                  return 'confirm';
    }
  }

  // 새로고침
    function refreshOrders() {
        loadActiveOrders();
    }
    
  // ====== 🔗 여기서부터 "버튼/이벤트 연결"을 실제로 붙입니다 ======

  // 1) 알림 버튼 연결
  if (notificationToggleBtn) notificationToggleBtn.addEventListener('click', toggleNotifications);
  if (testSoundBtn)          testSoundBtn.addEventListener('click', testNotificationSound);
  loadNotificationSettings();
  requestNotificationPermission();

  // 2) 슬러그 발급(ensure) 버튼 연결
  // if (ensureBtn) {
  //   ensureBtn.addEventListener('click', async () => {
  //     if (!ensureResult) return;
  //     ensureResult.textContent = '';
  //     const label  = (ensureLabelInput?.value || '').trim();
  //     const active = !!(ensureActiveCheck?.checked);
  //     if (!label) {
  //       ensureResult.textContent = '라벨을 입력하세요 (예: A-10)';
  //       return;
  //     }
  //     try {
  //       // api-admin.js의 ensureTable 사용 (구현 시그니처: ensureTable(label, active))
  //       const data = await ensureTable(label, active);
  //       const slug = data?.table?.slug;
  //       // QR URL은 배포 구성에 맞춰 선택
  //       const FRONT_BASE = window.RUNTIME?.FRONT_BASE || location.origin;
  //       // const qrUrl = `${FRONT_BASE}/t/${slug}`; // Next rewrites 사용 시
  //       const qrUrl = `${FRONT_BASE}/order-system/order.html?slug=${slug}`; // 정적 직접 접근 시

  //       ensureResult.innerHTML =
  //         `✅ 발급 완료<br>
  //          • Table: <b>${data.table.label}</b><br>
  //          • Slug: <code>${slug}</code><br>
  //          • QR URL: <a href="${qrUrl}" target="_blank">${qrUrl}</a>`;
  //     } catch (e) {
  //       ensureResult.textContent = '발급 실패: ' + (e?.message || '알 수 없는 오류');
  //     }
  //   });
  // }

  // ====== 렌더링 대상 컨테이너 ======
  const $dash = document.getElementById('admin-dashboard');

  function renderBuckets(urgent=[], waiting=[], preparing=[], meta={}) {
    if (!$dash) return;

    const section = (title, list) => `
      <section class="bucket">
        <h3>${title} <small>(${list.length})</small></h3>
        <div class="bucket-list">
          ${list.map(renderCard).join('') || '<div class="empty">비어있음</div>'}
        </div>
      </section>
    `;

    $dash.innerHTML = `
      <div class="buckets">
        ${section('🚨 긴급', urgent)}
        ${section('🕒 대기중', waiting)}
        ${section('👨‍🍳 준비중', preparing)}
      </div>
    `;

    // 간단 스타일(없으면 추가)
    if (!document.getElementById('admin-inline-style')) {
      const style = document.createElement('style');
      style.id = 'admin-inline-style';
      style.textContent = `
        .buckets{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        .bucket{background:#fff;border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.08)}
        .bucket h3{margin:0 0 8px}
        .card{border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:10px}
        .card .meta{font-size:12px;color:#666;margin:4px 0}
        .card .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
        .card button{padding:6px 10px;border-radius:8px;border:0;background:#1a5490;color:#fff;cursor:pointer}
        .card button.secondary{background:#888}
        .card button.danger{background:#c0392b}
        .empty{color:#aaa;padding:8px;text-align:center}
      `;
      document.head.appendChild(style);
    }
  }

  function renderCard(o) {
    // o: { id, status, table, payer_name, placed_at }
    const statusK = mapStatusK(o.status);
    const tableLabel = o.table?.label || (o.table || '') || (o.orderType === 'takeout' ? '포장' : '-');
    const placedAt = o.placed_at ? new Date(o.placed_at).toLocaleTimeString() : '';

    // 상태별 버튼
    const btns = [];
    if (o.status === 'PENDING') {
      btns.push(`<button data-act="confirm" data-id="${o.id}">💳 입금 확인</button>`);
    }
    if (o.status === 'CONFIRMED') {
      btns.push(`<button data-act="start_preparing" data-id="${o.id}">👨‍🍳 조리 시작</button>`);
    }
    if (o.status === 'IN_PROGRESS') {
      btns.push(`<button data-act="complete" data-id="${o.id}">✅ 완료</button>`);
    }
    // 항상 노출
    btns.push(`<button class="secondary" data-act="detail" data-id="${o.id}">🔍 상세</button>`);

    return `
      <div class="card" id="order-${o.id}">
        <div><b>#${o.id}</b> · ${tableLabel} · ${o.payer_name || ''}</div>
        <div class="meta">${statusK}${placedAt ? ' · ' + placedAt : ''}</div>
        <div class="btns">${btns.join('')}</div>
      </div>
    `;
  }

  function mapStatusK(s) {
    switch (s) {
      case 'PENDING':     return '💰 입금 대기';
      case 'CONFIRMED':   return '💳 입금 확인됨';
      case 'IN_PROGRESS': return '👨‍🍳 준비중';
      case 'COMPLETED':   return '✅ 완료';
      case 'CANCELLED':   return '⛔ 취소';
      default:            return s || '';
    }
  }

  // ===== 주문번호 단건 조회/확정 UI =====
  (function wireSingleOrderInspect() {
    const $form = document.getElementById('order-search-form');
    const $input = document.getElementById('order-search-id');
    const $inspect = document.getElementById('order-inspect');

    if (!$form || !$input || !$inspect) return;

    const renderInspect = (od) => {
      if (!od || !od.id) {
        return `<div class="empty">주문을 찾을 수 없습니다.</div>`;
      }
      const status = String(od.status || '').toUpperCase();
      const isPending = status === 'PENDING';
      const itemsHtml = (od.items || [])
        .map(i => `<li>${i.name} × ${i.qty} = ${Number(i.line_total||0).toLocaleString()}원</li>`)
        .join('');

      return `
        <div class="card" style="border:1px solid #ddd;padding:12px;border-radius:8px;">
          <div><b>#${od.id}</b> · ${od.table?.label || '-'} · ${od.payer_name || '-'}</div>
          <div style="color:#555;">상태: ${status}</div>
          <div style="color:#555;">합계: ${Number(od.amounts?.total||0).toLocaleString()}원</div>
          <div style="margin-top:8px;">
            <ul style="margin:0;padding-left:18px;">${itemsHtml || '<li>항목 없음</li>'}</ul>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            ${isPending
              ? `<button class="btn-confirm" data-id="${od.id}">💳 입금확인(Confirm)</button>`
              : ''
            }
            <button class="btn-refresh" data-id="${od.id}">🔄 새로고침</button>
          </div>
        </div>
      `;
    };

    async function fetchAndShow(id) {
      try {
        const detail = await getOrderDetails(id); // GET /orders/admin/{id}
        // 일부 백엔드 응답이 {data:{...}} 형태면 아래처럼 정규화
        const od = detail?.id ? detail : (detail?.data || detail);
        $inspect.innerHTML = renderInspect(od);
      } catch (e) {
        console.error(e);
        $inspect.innerHTML = `<div class="error">조회 실패: ${e?.message || '알 수 없는 오류'}</div>`;
      }
    }

    $form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = Number(($input.value || '').trim());
      if (!id) {
        $inspect.innerHTML = `<div class="error">주문 번호를 입력하세요.</div>`;
        return;
      }
      fetchAndShow(id);
    });

    $inspect.addEventListener('click', async (e) => {
      const btnConfirm = e.target.closest('.btn-confirm[data-id]');
      const btnRefresh = e.target.closest('.btn-refresh[data-id]');
      if (!btnConfirm && !btnRefresh) return;

      const id = Number((btnConfirm || btnRefresh).dataset.id);

      try {
        if (btnConfirm) {
          // PATCH /orders/{id}/status  { action: 'confirm' }
          await patchOrderStatus(id, 'confirm');
          // 대시보드 새로고침 + 상세 새로고침
          await Promise.all([fetchAndShow(id), loadActiveOrders()]);
        } else if (btnRefresh) {
          await fetchAndShow(id);
        }
      } catch (err) {
        alert('처리 실패: ' + (err?.message || '알 수 없는 오류'));
      }
    });
  })();

  // ====== 클릭 이벤트 위임: 상태 변경 & 상세 ======
  if ($dash) {
    $dash.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const id  = Number(btn.getAttribute('data-id'));
      if (!id) return;

      try {
        if (act === 'detail') {
          const d = await getOrderDetails(id); // /orders/admin/{id}
          alert(detailText(d));
          return;
        }
        // 상태 변경
        await patchOrderStatus(id, act);       // confirm | start_preparing | complete
        // 성공 후 목록 갱신
        await loadActiveOrders();
      } catch (err) {
        alert(err?.message || '요청 실패');
      }
    });
  }

  function detailText(d) {
    // d 예시: { id, status, table:{label}, payer_name, amounts, items:[...] ... }
    const lines = [];
    lines.push(`주문 #${d.id} (${mapStatusK(d.status)})`);
    if (d.table?.label) lines.push(`테이블: ${d.table.label}`);
    if (d.payer_name)   lines.push(`입금자: ${d.payer_name}`);
    if (d.amounts?.total != null) lines.push(`합계: ${Number(d.amounts.total).toLocaleString()}원`);
    if (Array.isArray(d.items) && d.items.length) {
      lines.push('품목:');
      d.items.forEach(it => {
        lines.push(` - ${it.name || it.product_id} x${it.qty} (${Number(it.line_total).toLocaleString()}원)`);
      });
    }
    return lines.join('\n');
  }

  // ====== 로딩/갱신 로직 교체 ======
  async function loadActiveOrders() {
    try {
      console.log('📊 진행중 주문 데이터 로드 중...');
      const resp = await getActiveOrders(); // { data:{urgent,waiting,preparing}, meta }
      const { urgent = [], waiting = [], preparing = [] } = resp.data || {};
      const meta = resp.meta || {};
      renderBuckets(urgent, waiting, preparing, meta);
      console.log(`✅ 활성 주문 로드 완료: ${(meta.total) ?? (urgent.length + waiting.length + preparing.length)}건`);
    } catch (err) {
      console.error('❌ 주문 데이터 로드 실패:', err);
      if ($dash) $dash.innerHTML = '<p>주문 데이터를 불러오는데 실패했습니다.</p>';
    }
  }

  // ====== SSE 연결: 스냅샷은 즉시 렌더, 변경 신호 오면 재로딩 ======
  (async () => {
    try {
      await createOrderStream(
        (type, payload) => {
          if (type === 'snapshot') {
            const { data: { urgent=[], waiting=[], preparing=[] } = {}, meta = {} } = payload || {};
            renderBuckets(urgent, waiting, preparing, meta);
          } else if (type === 'orders_changed') {
            loadActiveOrders(); // 변경 시 API로 최신화
          } else if (type === 'ping') {
            // keepalive
          }
        },
        (err) => {
          console.warn('SSE 오류, 폴백으로 폴링 유지:', err?.message || err);
        }
      );
    } catch (e) {
      console.warn('SSE 연결 실패, 폴링 사용');
    }
  })();

  // 초기 1회 로드 + 폴링 백업
  loadActiveOrders();
  setInterval(loadActiveOrders, 30000);


  // 3) (선택) 대시보드 내부 상태 변경 액션을 patch API로 연결
  //    createOrderCard가 상태 변경 select/button을 렌더링한다면, 아래처럼 이벤트 위임으로 처리
  if (adminDashboard) {
    adminDashboard.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action][data-order-id]');
      if (!btn) return;
      const orderId = Number(btn.getAttribute('data-order-id'));
      const firebaseStatus = btn.getAttribute('data-action'); // ex) 'Payment Confirmed' 등
      const action = mapFirebaseStatusToAPIAction(firebaseStatus);
      try {
        await patchOrderStatus(orderId, action);
        // 성공 시 목록 리로드
        refreshOrders();
      } catch (err) {
        alert('상태 변경 실패: ' + (err?.message || '알 수 없는 오류'));
      }
    });
  }

  // 초기 로드 + 주기적 새로고침
    loadActiveOrders();
    setInterval(refreshOrders, 30000); // 30초마다 새로고침
});

(function(){
  const FR = () => window.RUNTIME?.FRONT_BASE || location.origin;
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('bulk-ensure-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const prefix = ($('bulk-prefix')?.value || '').trim();   // 예: "A-"
      const start  = parseInt($('bulk-start')?.value || '1', 10);
      const end    = parseInt($('bulk-end')?.value || '50', 10);
      const active = !!$('bulk-active')?.checked;
      const out    = $('bulk-result');
      const dl     = $('bulk-download');

      if (!prefix || isNaN(start) || isNaN(end) || start > end) {
        out.textContent = '입력 값을 확인하세요.'; return;
      }

      const rows = [['label','slug','qr_url']]; // CSV 헤더
      out.textContent = '발급 중...\n';

      for (let n = start; n <= end; n++) {
        const label = `${prefix}${n}`;
        try {
          const data = await ensureTable(label, active);
          const slug = data?.table?.slug || '';
          // 리라이트 사용 시
          const qrUrl = `${FR()}/t/${slug}`;
          // 정적 경로 직접 접근이면 다음 라인으로 교체:
          // const qrUrl = `${FR()}/order-system/order.html?slug=${slug}`;

          rows.push([label, slug, qrUrl]);
          out.textContent += `✅ ${label} → ${slug}\n`;
        } catch (e) {
          out.textContent += `❌ ${label} 발급 실패: ${e?.message || '알 수 없는 오류'}\n`;
        }
      }

      // CSV 파일 생성/다운로드
      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      dl.href = url;
      dl.style.display = 'inline-block';
      dl.click(); // 자동 다운로드
    });
  });
})();