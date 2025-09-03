import { adminLogin, patchOrderStatus, ensureTable, getOrderDetails, getActiveOrders } from './api-admin.js';

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

// 관리자 인증 확인
function checkAdminAuth() {
  const isLoggedIn = sessionStorage.getItem('admin_logged_in') === 'true';
  const loginTime = sessionStorage.getItem('admin_login_time');
  // 로그인되지 않았거나 12시간 이상 지난 경우
  if (!isLoggedIn || !loginTime || (Date.now() - parseInt(loginTime, 10)) > (12 * 60 * 60 * 1000)) {
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_login_time');
    // 로그인 페이지로 리디렉션
    window.location.href = '/order-system/admin-login.html';
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

  // ✅ 슬러그 발급 UI 요소 (없으면 자동 무시)
  const ensureLabelInput  = document.getElementById('ensure-label');   // ex) A-10
  const ensureActiveCheck = document.getElementById('ensure-active');  // 체크박스
  const ensureBtn         = document.getElementById('ensure-btn');     // 발급 버튼
  const ensureResult      = document.getElementById('ensure-result');  // 결과 출력 <p>

  let allOrdersCache = {}; // 전체 주문 데이터 캐시
  let isFirstLoad = true;  // 첫 로드 확인
  let notificationsEnabled = false; // 브라우저 알림 권한 상태
  let soundEnabled = true; // 소리 활성화 상태

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

  // function showSystemNotification(title, body) {
  //  if (notificationsEnabled && 'Notification' in window) {
  //    const notification = new Notification(title, {
  //      body: body,
  //      icon: '../../icons/icon.png', 
  //      tag: 'memory-pub-order'
  //    });
  //    setTimeout(() => notification.close(), 5000);
  //   } 
  // }

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
  if (ensureBtn) {
    ensureBtn.addEventListener('click', async () => {
      if (!ensureResult) return;
      ensureResult.textContent = '';
      const label  = (ensureLabelInput?.value || '').trim();
      const active = !!(ensureActiveCheck?.checked);
      if (!label) {
        ensureResult.textContent = '라벨을 입력하세요 (예: A-10)';
        return;
      }
      try {
        // api-admin.js의 ensureTable 사용 (구현 시그니처: ensureTable(label, active))
        const data = await ensureTable(label, active);
        const slug = data?.table?.slug;
        // QR URL은 배포 구성에 맞춰 선택
        const FRONT_BASE = window.RUNTIME?.FRONT_BASE || location.origin;
        const qrUrl = `${FRONT_BASE}/t/${slug}`; // Next rewrites 사용 시
        // const qrUrl = `${FRONT_BASE}/order-system/order.html?slug=${slug}`; // 정적 직접 접근 시

        ensureResult.innerHTML =
          `✅ 발급 완료<br>
           • Table: <b>${data.table.label}</b><br>
           • Slug: <code>${slug}</code><br>
           • QR URL: <a href="${qrUrl}" target="_blank">${qrUrl}</a>`;
      } catch (e) {
        ensureResult.textContent = '발급 실패: ' + (e?.message || '알 수 없는 오류');
      }
    });
  }

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

// import { adminLogin, patchOrderStatus, ensureTable, getOrderDetails, getActiveOrders } from './api-admin.js';

// // window.RUNTIME이 로드되기를 기다림
// function waitForRuntime() {
//     return new Promise((resolve) => {
//         if (window.RUNTIME) {
//             resolve();
//         } else {
//             const checkRuntime = () => {
//                 if (window.RUNTIME) {
// resolve();
//                 } else {
// setTimeout(checkRuntime, 10);
//                 }
//             };
//             checkRuntime();
//         }
//     });
// }

// // 관리자 인증 확인
// function checkAdminAuth() {
//     const isLoggedIn = sessionStorage.getItem('admin_logged_in') === 'true';
//     const loginTime = sessionStorage.getItem('admin_login_time');
    
//     // 로그인되지 않았거나 12시간 이상 지난 경우
//     if (!isLoggedIn || !loginTime || (Date.now() - parseInt(loginTime)) > (12 * 60 * 60 * 1000)) {
//         // 세션 정리
//         sessionStorage.removeItem('admin_logged_in');
//         sessionStorage.removeItem('admin_login_time');
        
//         // 로그인 페이지로 리디렉션
//         window.location.href = '/admin-login.html';
//         return false;
//     }
    
//     return true;
// }

// // 로그아웃 처리
// function logout() {
//     sessionStorage.removeItem('admin_logged_in');
//     sessionStorage.removeItem('admin_login_time');
//     window.location.href = '/admin-login.html';
// }

// // 전역 Firebase 변수
// let db = null;

// document.addEventListener('DOMContentLoaded', () => {
//     // 관리자 인증 확인
//     if (!checkAdminAuth()) {
//         return; // 인증 실패시 여기서 종료
//     }
//     // Firebase 초기화
//     firebase.initializeApp(firebaseConfig);
//     db = firebase.database();
//     const ordersRef = db.ref('orders');

//     const adminDashboard = document.getElementById('admin-dashboard');
//     const inventoryList = document.getElementById('inventory-list');
//     const notificationToggleBtn = document.getElementById('notification-toggle');
//     const testSoundBtn = document.getElementById('test-sound-btn');
//     let allOrdersCache = {}; // 전체 주문 데이터 캐시
//     let isFirstLoad = true; // 첫 로드 확인
//     let notificationsEnabled = false; // 알림 권한 상태
//     let soundEnabled = true; // 소리 활성화 상태
    
//     // 메뉴별 초기 재고 (관리자가 설정 가능)
//     const menuInventory = {
//         '김치전': 50,
//         '부추전': 50,
//         '오징어볶음': 30,
//         '닭꼬치': 40,
//         '소주': 100,
//         '맥주': 80,
//         '콜라': 60
//     };
    
//     // 메뉴 상태 텍스트 반환 함수
//     function getStatusText(status) {
//         switch(status) {
//             case 'pending': return '대기중';
//             case 'preparing': return '준비중';
//             case 'ready': return '완료';
//             case 'served': return '서빙완료';
//             default: return '대기중';
//         }
//     }
    
//     // 주문 상태 표시 텍스트 반환 함수
//     function getStatusDisplayText(status) {
//         switch(status) {
//             case 'Payment Pending': return '💰 입금 대기중';
//             case 'Payment Confirmed': return '💳 입금 확인됨';
//             case 'Preparing': return '👨‍🍳 준비중';
//             case 'Order Complete': return '✅ 완료';
//             default: return status;
//         }
//     }
    
//     // 알림 권한 요청 함수
//     function requestNotificationPermission() {
//         if ('Notification' in window) {
//             Notification.requestPermission().then(permission => {
//                 notificationsEnabled = permission === 'granted';
//                 if (notificationsEnabled) {
// console.log('✅ 브라우저 알림 권한이 허용되었습니다.');
// showSystemNotification('MEMORY 주점 관리자', '실시간 알림이 활성화되었습니다! 🎉');
//                 } else {
// console.log('❌ 브라우저 알림 권한이 거부되었습니다.');
//                 }
//             });
//         }
//     }
    
//     // 시스템 알림 표시 함수
//     function showSystemNotification(title, body, icon = '⚾') {
//         if (notificationsEnabled && 'Notification' in window) {
//             const notification = new Notification(title, {
//                 body: body,
//                 icon: 'data:text/plain;base64,' + btoa(icon),
//                 tag: 'memory-pub-order'
//             });
            
//             // 5초 후 자동 닫기
//             setTimeout(() => notification.close(), 5000);
//         }
//     }
    
//     // 알림 소리 재생 함수
//     function playNotificationSound(type = 'new-order') {
//         if (!soundEnabled) return; // 소리 비활성화 시 재생 안함
        
//         try {
//             const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
//             if (type === 'new-order') {
//                 // 새 주문 소리 (높은 톤 2번)
//                 playBeep(audioContext, 800, 200);
//                 setTimeout(() => playBeep(audioContext, 1000, 200), 300);
//             } else if (type === 'status-change') {
//                 // 상태 변경 소리 (중간 톤 1번)
//                 playBeep(audioContext, 600, 300);
//             } else if (type === 'payment-pending') {
//                 // 입금 대기 소리 (특별한 패턴)
//                 playBeep(audioContext, 500, 150);
//                 setTimeout(() => playBeep(audioContext, 700, 150), 200);
//                 setTimeout(() => playBeep(audioContext, 900, 150), 400);
//             }
//         } catch (error) {
//             console.warn('소리 재생 실패:', error);
//         }
//     }
    
//     // 알림 설정 토글 함수
//     function toggleNotifications() {
//         if (soundEnabled) {
//             soundEnabled = false;
//             notificationToggleBtn.innerHTML = '🔕 알림 OFF';
//             notificationToggleBtn.style.opacity = '0.6';
//         } else {
//             soundEnabled = true;
//             notificationToggleBtn.innerHTML = '🔔 알림 ON';
//             notificationToggleBtn.style.opacity = '1';
            
//             // 알림 활성화 확인 소리
//             playNotificationSound('status-change');
//         }
        
//         // 로컬 저장소에 설정 저장
//         localStorage.setItem('memory-pub-sound-enabled', soundEnabled);
//     }
    
//     // 소리 테스트 함수
//     function testNotificationSound() {
//         playNotificationSound('new-order');
//         setTimeout(() => {
//             showSystemNotification('🔊 소리 테스트', '소리가 잘 들리시나요?');
//         }, 500);
//     }
    
//     // 저장된 알림 설정 불러오기
//     function loadNotificationSettings() {
//         const savedSoundEnabled = localStorage.getItem('memory-pub-sound-enabled');
//         if (savedSoundEnabled !== null) {
//             soundEnabled = savedSoundEnabled === 'true';
//             if (notificationToggleBtn) {
//                 notificationToggleBtn.innerHTML = soundEnabled ? '🔔 알림 ON' : '🔕 알림 OFF';
//                 notificationToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
//             }
//         }
//     }
    
//     // 비프 소리 생성 함수
//     function playBeep(audioContext, frequency, duration) {
//         const oscillator = audioContext.createOscillator();
//         const gainNode = audioContext.createGain();
        
//         oscillator.connect(gainNode);
//         gainNode.connect(audioContext.destination);
        
//         oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
//         oscillator.type = 'sine';
        
//         gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
//         gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
        
//         oscillator.start(audioContext.currentTime);
//         oscillator.stop(audioContext.currentTime + duration / 1000);
//     }
    
//     // 새 주문 감지 및 알림 함수
//     function checkForNewOrders(newOrders) {
//         if (isFirstLoad) {
//             isFirstLoad = false;
//             return; // 첫 로드시에는 알림 안함
//         }
        
//         const newOrderIds = Object.keys(newOrders);
//         const cachedOrderIds = Object.keys(allOrdersCache);
        
//         // 새로운 주문 확인
//         const reallyNewOrders = newOrderIds.filter(id => !cachedOrderIds.includes(id));
        
//         if (reallyNewOrders.length > 0) {
//             reallyNewOrders.forEach(orderId => {
//                 const order = newOrders[orderId];
//                 const tableInfo = order.orderType === 'takeout' ? '포장' : `테이블 #${order.tableNumber}`;
                
//                 // 소리 재생
//                 if (order.status === 'Payment Pending') {
// playNotificationSound('payment-pending');
// // 브라우저 알림
// showSystemNotification(
//     '💰 새 주문 (입금 대기)',
//     `${tableInfo} - ${order.customerName}님\n총 ${order.totalPrice.toLocaleString()}원`
// );
//                 } else {
// playNotificationSound('new-order');
// showSystemNotification(
//     '🎉 새 주문 접수!',
//     `${tableInfo} - ${order.customerName}님\n총 ${order.totalPrice.toLocaleString()}원`
// );
//                 }
//             });
//         }
        
//         // 상태 변경 감지
//         cachedOrderIds.forEach(orderId => {
//             if (newOrders[orderId] && allOrdersCache[orderId]) {
//                 const oldStatus = allOrdersCache[orderId].status;
//                 const newStatus = newOrders[orderId].status;
                
//                 if (oldStatus !== newStatus) {
// playNotificationSound('status-change');
// const order = newOrders[orderId];
// const tableInfo = order.orderType === 'takeout' ? '포장' : `테이블 #${order.tableNumber}`;

// showSystemNotification(
//     '🔄 주문 상태 변경',
//     `${tableInfo} - ${getStatusDisplayText(newStatus)}`
// );
//                 }
//             }
//         });
//     }

//     // 실시간으로 주문 데이터 가져오기
//     // API 기반 주문 데이터 로드 함수
//     async function loadActiveOrders() {
//         try {
//             console.log('📊 진행중 주문 데이터 로드 중...');
//             const response = await getActiveOrders();
//             const { urgent, waiting, preparing } = response.data;
//             const meta = response.meta;
            
//             // 대시보드 초기화
//             adminDashboard.innerHTML = '';
            
//             // 모든 주문을 하나의 배열로 합치기
//             const allActiveOrders = [...urgent, ...waiting, ...preparing];
            
//             console.log(`✅ 활성 주문 로드 완료: ${meta.total}건`);
            
//             // API 응답을 Firebase 형태로 변환하여 기존 로직 재사용
//             const ordersForDisplay = {};
//             allActiveOrders.forEach(order => {
//                 ordersForDisplay[order.id] = {
// id: order.id,
// status: mapAPIStatusToFirebase(order.status),
// tableNumber: order.table,
// customerName: order.payer_name,
// timestamp: new Date(order.placed_at).getTime(),
// items: {},
// totalPrice: 0,
// orderType: 'dine-in'
//                 };
//             });
            
//             // 기존 로직 재사용
//             if (Object.keys(ordersForDisplay).length > 0) {
//                 allOrdersCache = ordersForDisplay;
//                 const sortedOrders = Object.entries(ordersForDisplay).sort(([, a], [, b]) => b.timestamp - a.timestamp);
                
//                 updateStatistics(ordersForDisplay);
//                 updateInventory(ordersForDisplay);
//                 updateSalesDashboard(ordersForDisplay);
                
//                 for (const [orderId, orderData] of sortedOrders) {
// const orderCard = createOrderCard(orderId, orderData);
// adminDashboard.appendChild(orderCard);
//                 }
//             } else {
//                 adminDashboard.innerHTML = '<p>아직 접수된 주문이 없습니다.</p>';
//                 updateStatistics({});
//                 updateInventory({});
//                 updateSalesDashboard({});
//             }
            
//             isFirstLoad = false;
//         } catch (error) {
//             console.error('❌ 주문 데이터 로드 실패:', error);
//             adminDashboard.innerHTML = '<p>주문 데이터를 불러오는데 실패했습니다.</p>';
//         }
//     }
    
//     // API 상태를 Firebase 상태로 매핑
//     function mapAPIStatusToFirebase(apiStatus) {
//         switch(apiStatus) {
//             case 'CONFIRMED': return 'Payment Confirmed';
//             case 'IN_PROGRESS': return 'Preparing';
//             case 'COMPLETED': return 'Order Complete';
//             default: return 'Payment Pending';
//         }
//     }
    
//     // Firebase 상태를 API 액션으로 매핑
//     function mapFirebaseStatusToAPIAction(firebaseStatus) {
//         switch(firebaseStatus) {
//             case 'Payment Confirmed': return 'confirm';
//             case 'Preparing': return 'start_preparing';
//             case 'Order Complete': return 'complete';
//             default: return 'confirm';
//         }
//     }
    
//     // 주문 새로고침 함수
//     function refreshOrders() {
//         loadActiveOrders();
//     }
    
//     // 초기 로드 및 주기적 새로고침
//     loadActiveOrders();
//     setInterval(refreshOrders, 30000); // 30초마다 새로고침
    
    // Firebase 백업 - 실시간 주문 데이터 감시 (주석 처리)
    // Firebase 백업 주석 처리됨
    /*
    ordersRef.on('value', (snapshot) => {
        adminDashboard.innerHTML = ''; // 대시보드 초기화
        const orders = snapshot.val();

        if (orders) {
            // 새 주문 및 상태 변경 감지 (알림 처리)
            checkForNewOrders(orders);
            
            // 전체 주문 데이터 캐시 업데이트
            allOrdersCache = orders;
            
            // 주문을 시간 역순으로 정렬 (최신 주문이 위로)
            const sortedOrders = Object.entries(orders).sort(([, a], [, b]) => b.timestamp - a.timestamp);

            // 통계 업데이트
            updateStatistics(orders);
            
            // 재고 업데이트
            updateInventory(orders);
            
            // 매출 현황 업데이트
            updateSalesDashboard(orders);

            for (const [orderId, orderData] of sortedOrders) {
                const orderCard = createOrderCard(orderId, orderData);
                adminDashboard.appendChild(orderCard);
            }
        } else {
            adminDashboard.innerHTML = '<p>아직 접수된 주문이 없습니다.</p>';
            // 통계 초기화
            updateStatistics({});
            // 재고 초기화 (주문이 없을 때)
            updateInventory({});
            // 매출 현황 초기화
            updateSalesDashboard({});
            allOrdersCache = {};
        }
    });

    // 주문 카드 생성 함수
    function createOrderCard(orderId, orderData) {
        const card = document.createElement('div');
        card.className = 'order-card';
        card.setAttribute('data-status', orderData.status);

        let itemsHtml = '<ul>';
        for (const itemName in orderData.items) {
            const item = orderData.items[itemName];
            const menuStatus = orderData.menuStatus || {};
            const status = menuStatus[itemName] || 'pending';
            
            itemsHtml += `<li>
                ${itemName} x${item.quantity}
                <div class="menu-status">
<span class="menu-status-item ${status}" data-menu="${itemName}" data-order-id="${orderId}">
    <span class="status-indicator"></span>
    ${getStatusText(status)}
</span>
                </div>
            </li>`;
        }
        itemsHtml += '</ul>';

        // 상태별 표시 정보
        let statusInfo = '';
        if (orderData.status === 'Payment Pending') {
            statusInfo = '<span class="payment-pending-badge">💰 입금 대기중</span>';
        } else if (orderData.status === 'Order Complete') {
            statusInfo = '<span class="completed-badge">✅ 완료</span>';
        } else {
            const waitingPosition = calculateWaitingPosition(orderId, orderData);
            statusInfo = `<span class="waiting-badge">🕒 대기 ${waitingPosition}번째</span>`;
        }

        card.innerHTML = `
            <div class="order-header">
${orderData.orderType === 'takeout' ? '<h3>📦 포장 주문</h3>' : `<h3>🍽️ 테이블 #${orderData.tableNumber}</h3>`}
                ${statusInfo}
            </div>
            <p><strong>입금자명:</strong> ${orderData.customerName}</p>
            <p><strong>주문 메뉴:</strong></p>
            ${itemsHtml}
            ${orderData.discountAmount > 0 ? 
                `<p><strong>원가:</strong> <span style="text-decoration: line-through;">${orderData.originalPrice.toLocaleString()}원</span></p>
                 <p><strong>포장 할인:</strong> <span style="color: #dc3545;">-${orderData.discountAmount.toLocaleString()}원</span></p>` : ''}
            <p><strong>총 금액:</strong> <span style="color: #FF6B35; font-weight: bold; font-size: 1.1em;">${orderData.totalPrice.toLocaleString()}원</span></p>
            <div class="order-status">
                <p><strong>상태:</strong> <span class="status-text">${getStatusDisplayText(orderData.status)}</span></p>
                ${orderData.status === 'Payment Pending' ? 
'<button class="status-btn payment-confirm-btn" data-order-id="' + orderId + '" data-status="Payment Confirmed">💰 입금 확인</button>' :
'<button class="status-btn" data-order-id="' + orderId + '" data-status="Payment Confirmed">입금확인</button>'
                }
                <button class="status-btn" data-order-id="${orderId}" data-status="Preparing">준비중</button>
                <button class="status-btn" data-order-id="${orderId}" data-status="Order Complete">완료</button>
            </div>
            <p style="font-size: 0.8em; color: #888; margin-top: 10px;">주문 시간: ${new Date(orderData.timestamp).toLocaleString()}</p>
        `;

        // 상태 변경 버튼에 이벤트 리스너 추가
        const statusButtons = card.querySelectorAll('.status-btn');
        statusButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const newStatus = btn.dataset.status;
                updateOrderStatus(orderId, newStatus);
            });
        });

        // 메뉴별 상태 변경 이벤트 리스너 추가
        const menuStatusItems = card.querySelectorAll('.menu-status-item');
        menuStatusItems.forEach(item => {
            item.addEventListener('click', () => {
                const menuName = item.dataset.menu;
                const orderId = item.dataset.orderId;
                const currentStatus = item.classList.contains('preparing') ? 'preparing' :
               item.classList.contains('ready') ? 'ready' :
               item.classList.contains('served') ? 'served' : 'pending';
                
                toggleMenuStatus(orderId, menuName, currentStatus);
            });
        });

        return card;
    }

    // 메뉴별 상태 토글 함수
    function toggleMenuStatus(orderId, menuName, currentStatus) {
        const statusOrder = ['pending', 'preparing', 'ready', 'served'];
        const currentIndex = statusOrder.indexOf(currentStatus);
        const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length];
        
        // Firebase에서 현재 주문 데이터 가져오기
        db.ref('orders/' + orderId).once('value', (snapshot) => {
            const orderData = snapshot.val();
            if (orderData) {
                const menuStatus = orderData.menuStatus || {};
                menuStatus[menuName] = nextStatus;
                
                // 메뉴 상태 업데이트
                db.ref('orders/' + orderId + '/menuStatus').set(menuStatus)
.then(() => {
    console.log(`메뉴 "${menuName}" 상태가 "${nextStatus}"로 변경됨`);
})
.catch(error => {
    console.error('메뉴 상태 업데이트 실패:', error);
    alert('메뉴 상태 업데이트 중 오류가 발생했습니다.');
});
            }
        });
    }

    // 주문 상태 업데이트 함수는 파일 하단의 전역 함수 사용

    // 통계 업데이트 함수
    function updateStatistics(orders) {
        const waitingTeams = document.getElementById('waiting-teams');
        const totalOrders = document.getElementById('total-orders');
        const paymentPendingOrders = document.getElementById('payment-pending-orders');
        const pendingOrders = document.getElementById('pending-orders');
        const completedOrders = document.getElementById('completed-orders');

        if (Object.keys(orders).length === 0) {
            waitingTeams.textContent = '0';
            totalOrders.textContent = '0';
            paymentPendingOrders.textContent = '0';
            pendingOrders.textContent = '0';
            completedOrders.textContent = '0';
            return;
        }

        const orderArray = Object.values(orders);
        const total = orderArray.length;
        const completed = orderArray.filter(order => order.status === 'Order Complete').length;
        const paymentPending = orderArray.filter(order => order.status === 'Payment Pending').length;
        const pending = orderArray.filter(order => order.status !== 'Order Complete' && order.status !== 'Payment Pending').length;

        waitingTeams.textContent = (pending + paymentPending).toString();
        totalOrders.textContent = total.toString();
        paymentPendingOrders.textContent = paymentPending.toString();
        pendingOrders.textContent = pending.toString();
        completedOrders.textContent = completed.toString();

        // 대기팀 수에 따른 색상 변경
        if (pending > 10) {
            waitingTeams.style.color = '#ff4757';
        } else if (pending > 5) {
            waitingTeams.style.color = '#ffa502';
        } else {
            waitingTeams.style.color = '#2ed573';
        }
    }

    // 재고 업데이트 함수
    function updateInventory(orders) {
        // 현재 재고 계산 (초기 재고에서 주문량 차감)
        const currentInventory = { ...menuInventory };
        
        if (orders && Object.keys(orders).length > 0) {
            Object.values(orders).forEach(order => {
                if (order.items) {
Object.entries(order.items).forEach(([menuName, item]) => {
    if (currentInventory[menuName] !== undefined) {
        currentInventory[menuName] -= item.quantity;
    }
});
                }
            });
        }
        
        // 재고 UI 업데이트
        inventoryList.innerHTML = '';
        
        Object.entries(currentInventory).forEach(([menuName, count]) => {
            const inventoryItem = document.createElement('div');
            inventoryItem.className = 'inventory-item';
            
            let countClass = 'inventory-count';
            if (count <= 0) {
                countClass += ' out';
            } else if (count <= 10) {
                countClass += ' low';
            }
            
            let statusText = '';
            if (count <= 0) {
                statusText = '품절';
            } else if (count <= 10) {
                statusText = `${count}개 (부족)`;
            } else {
                statusText = `${count}개`;
            }
            
            inventoryItem.innerHTML = `
                <span class="menu-name">${menuName}</span>
                <span class="${countClass}">${statusText}</span>
            `;
            
            inventoryList.appendChild(inventoryItem);
        });
    }

    // 매출 대시보드 업데이트 함수
    function updateSalesDashboard(orders) {
        const todaySalesEl = document.getElementById('today-sales');
        const todayCompletedEl = document.getElementById('today-completed');
        const avgOrderEl = document.getElementById('avg-order');
        const currentTimeEl = document.getElementById('current-time');
        const hourlyOrdersEl = document.getElementById('hourly-orders');
        const estimatedWaitEl = document.getElementById('estimated-wait');
        const topSellingMenuEl = document.getElementById('top-selling-menu');
        const topMenuCountEl = document.getElementById('top-menu-count');
        const menuPercentageEl = document.getElementById('menu-percentage');

        // 현재 시간 업데이트
        if (currentTimeEl) {
            const now = new Date();
            currentTimeEl.textContent = now.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        }

        if (Object.keys(orders).length === 0) {
            // 주문이 없을 때 초기화
            if (todaySalesEl) todaySalesEl.textContent = '0원';
            if (todayCompletedEl) todayCompletedEl.textContent = '0';
            if (avgOrderEl) avgOrderEl.textContent = '0';
            if (hourlyOrdersEl) hourlyOrdersEl.textContent = '0';
            if (estimatedWaitEl) estimatedWaitEl.textContent = '-';
            if (topSellingMenuEl) topSellingMenuEl.textContent = '-';
            if (topMenuCountEl) topMenuCountEl.textContent = '0건 주문됨';
            if (menuPercentageEl) menuPercentageEl.textContent = '전체의 0%';
            return;
        }

        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const orderArray = Object.values(orders);

        // 오늘 주문들만 필터링
        const todayOrders = orderArray.filter(order => {
            const orderDate = new Date(order.timestamp);
            return orderDate >= todayStart;
        });

        // 완료된 주문들
        const completedOrders = todayOrders.filter(order => order.status === 'Order Complete');

        // 오늘 매출 계산
        const todaySales = completedOrders.reduce((total, order) => total + order.totalPrice, 0);
        if (todaySalesEl) {
            todaySalesEl.textContent = todaySales.toLocaleString() + '원';
        }

        // 완료된 주문 수
        if (todayCompletedEl) {
            todayCompletedEl.textContent = completedOrders.length.toString();
        }

        // 평균 주문 금액
        const avgOrder = completedOrders.length > 0 ? Math.round(todaySales / completedOrders.length) : 0;
        if (avgOrderEl) {
            avgOrderEl.textContent = avgOrder.toLocaleString();
        }

        // 시간당 주문 수 (최근 1시간)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentOrders = todayOrders.filter(order => new Date(order.timestamp) > oneHourAgo);
        if (hourlyOrdersEl) {
            hourlyOrdersEl.textContent = recentOrders.length.toString();
        }

        // 예상 대기시간 (준비중인 주문 기준)
        const preparingOrders = orderArray.filter(order => 
            order.status === 'Payment Confirmed' || order.status === 'Preparing'
        ).length;
        const estimatedMinutes = preparingOrders * 8; // 주문당 약 8분 예상
        if (estimatedWaitEl) {
            if (estimatedMinutes === 0) {
                estimatedWaitEl.textContent = '대기없음';
            } else {
                estimatedWaitEl.textContent = `약 ${estimatedMinutes}분`;
            }
        }

        // 인기 메뉴 분석
        const menuStats = {};
        let totalMenuCount = 0;

        todayOrders.forEach(order => {
            if (order.items) {
                Object.entries(order.items).forEach(([menuName, item]) => {
if (menuStats[menuName]) {
    menuStats[menuName] += item.quantity;
} else {
    menuStats[menuName] = item.quantity;
}
totalMenuCount += item.quantity;
                });
            }
        });

        if (totalMenuCount > 0) {
            const sortedMenus = Object.entries(menuStats).sort(([,a], [,b]) => b - a);
            const topMenu = sortedMenus[0];
            
            if (topSellingMenuEl) {
                topSellingMenuEl.textContent = topMenu[0];
            }
            if (topMenuCountEl) {
                topMenuCountEl.textContent = `${topMenu[1]}건 주문됨`;
            }
            if (menuPercentageEl) {
                const percentage = Math.round((topMenu[1] / totalMenuCount) * 100);
                menuPercentageEl.textContent = `전체의 ${percentage}%`;
            }
        }
    }

    // 대기 순번 계산 함수
    function calculateWaitingPosition(orderId, orderData) {
        if (orderData.status === 'Order Complete') return 0;
        
        // 완료되지 않은 주문들만 필터링하고 시간순 정렬
        const pendingOrders = Object.entries(allOrdersCache)
            .filter(([id, order]) => order.status !== 'Order Complete')
            .sort(([, a], [, b]) => a.timestamp - b.timestamp);

        // 현재 주문의 위치 찾기
        const position = pendingOrders.findIndex(([id]) => id === orderId);
        return position + 1; // 1부터 시작
    }


    

    
    // 인쇄 함수
    function printQRCodes() {
        if (qrCodesContainer.children.length === 0) {
            alert('먼저 QR코드를 생성해주세요.');
            return;
        }
        
        const printWindow = window.open('', '_blank');
        const qrCodesHTML = qrCodesContainer.innerHTML;
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>MEMORY 주점 QR코드</title>
                <style>
body {
    font-family: 'Noto Sans KR', Arial, sans-serif;
    margin: 20px;
    background: white;
}
.qr-code-item {
    display: inline-block;
    border: 2px solid #FF6B35;
    border-radius: 15px;
    padding: 20px;
    margin: 10px;
    text-align: center;
    page-break-inside: avoid;
    width: 250px;
    vertical-align: top;
}
.qr-code-header h3 {
    color: #FF6B35;
    font-size: 1.5em;
    margin: 0 0 5px 0;
    font-weight: bold;
}
.qr-instruction {
    color: #666;
    font-size: 0.9em;
    margin: 0 0 15px 0;
}
.qr-code-image img {
    border: 1px solid #ddd;
    border-radius: 8px;
}
.store-name {
    color: #FF6B35;
    font-weight: bold;
    font-size: 1.1em;
    margin: 15px 0 5px 0;
}
.qr-url {
    color: #999;
    font-size: 0.7em;
    word-break: break-all;
    margin: 5px 0;
}
@media print {
    body { margin: 0; }
    .qr-code-item { margin: 5px; }
}
                </style>
            </head>
            <body>
                <div style="text-align: center; margin-bottom: 30px;">
<h1 style="color: #FF6B35;">⚾ MEMORY 주점 QR코드</h1>
<p style="color: #666;">각 테이블에 부착하여 사용하세요</p>
                </div>
                ${qrCodesHTML}
            </body>
            </html>
        `);
        
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
        }, 1000);
    }
    

    
    // 알림 설정 버튼 이벤트
    if (notificationToggleBtn) {
        notificationToggleBtn.addEventListener('click', toggleNotifications);
    }
    
    // 소리 테스트 버튼 이벤트
    if (testSoundBtn) {
        testSoundBtn.addEventListener('click', testNotificationSound);
    }
    
    // 저장된 알림 설정 불러오기
    loadNotificationSettings();
    
    // 실시간 시계 업데이트 (매초)
    setInterval(() => {
        const currentTimeEl = document.getElementById('current-time');
        if (currentTimeEl) {
            const now = new Date();
            currentTimeEl.textContent = now.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        }
    }, 1000);
    
    // 페이지 로드 완료 후 알림 권한 요청
    setTimeout(() => {
        requestNotificationPermission();
    }, 2000); // 2초 후 권한 요청
    // 로그아웃 버튼 이벤트 리스너 추가
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('로그아웃하시겠습니까?')) {
                logout();
            }
        });
    }
});

// 주문 상태 업데이트 함수 (API 기반)
async function updateOrderStatus(orderId, status) {
    try {
        // Firebase 상태를 API 액션으로 매핑
        const action = mapFirebaseStatusToAPIAction(status);
        
        console.log(`주문 ${orderId} 상태 변경 시도: ${status} -> ${action}`);
        
        // API 우선 호출
        await patchOrderStatus(orderId, action);
        console.log(`✅ 주문 ${orderId} 상태가 API에서 "${status}"로 변경됨`);
        
        // Firebase 백업 (설정된 경우)
        if (window.RUNTIME?.USE_FIREBASE_WRITE_MIRROR && db) {
            try {
                await db.ref('orders/' + orderId).update({ 
status: status,
lastUpdated: Date.now()
                });
                console.log(`📁 Firebase 백업 동기화 완료`);
            } catch(firebaseError) {
                console.warn('Firebase 백업 실패:', firebaseError);
                // Firebase 실패는 무시하고 API 업데이트는 유지
            }
        }
        
        // 상태 변경 후 주문 목록 새로고침
        refreshOrders();
        
        // 성공 시 소리 및 알림
        playNotificationSound('status-change');
        showSystemNotification('상태 변경 완료', `주문이 "${getStatusDisplayText(status)}" 상태로 변경되었습니다.`);
        
    } catch(error) { 
        console.error('상태 변경 실패:', error);
        alert(error.message || '상태 변경 중 오류가 발생했습니다.'); 
    }
}

    // Firebase 백업용 함수들
    function decideAction(status) { 
        // 서버 API 액션 매핑 (선택적 사용)
        if (status === 'Payment Confirmed') return 'confirm';
        if (status === 'Preparing') return 'ready';
        if (status === 'Order Complete') return 'complete';
        return 'confirm';
    }
    
    */
// });