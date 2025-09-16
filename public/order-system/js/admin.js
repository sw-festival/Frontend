// admin.js (수정본)
import './config.js';
import { adminLogin, patchOrderStatus, ensureTable, getOrderDetails, getActiveOrders, getAdminMenu, createOrderStream, forceCloseSession, getAllOrders } from './api-admin.js';

/* =========================
   공통 유틸 / 인증 처리
========================= */
const LOGIN_PATH = '/admin/login';

// window.RUNTIME 준비 대기
function waitForRuntime() {
  return new Promise((resolve) => {
    if (window.RUNTIME) return resolve();
    const tick = () => (window.RUNTIME ? resolve() : setTimeout(tick, 10));
    tick();
  });
}

// 세션 전체 정리
function clearClientSession() {
  try {
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_logged_in');
    sessionStorage.removeItem('admin_login_time');
    localStorage.removeItem('accesstoken'); // 구버전 제거
  } catch (e) {}
}

let POLL_TIMER = null;

function redirectToLogin() {
  if (POLL_TIMER) {
    clearInterval(POLL_TIMER);
    POLL_TIMER = null;
  }
  clearClientSession();
  window.location.replace(LOGIN_PATH);
}

// 401/만료 에러 공통 처리
function handleAuthError(err) {
  const msg = String(err?.message || '');
  if (/401|unauthorized|expired|만료|로그인/i.test(msg)) {
    redirectToLogin();
    return true;
  }
  return false;
}

// 최초 진입 시 인증 체크
function checkAdminAuth() {
  const isLoggedIn = sessionStorage.getItem('admin_logged_in') === 'true';
  const loginTime  = Number(sessionStorage.getItem('admin_login_time') || 0);
  const hasToken   = !!(sessionStorage.getItem('admin_token') || localStorage.getItem('accesstoken'));
  const expired    = !loginTime || (Date.now() - loginTime) > (12 * 60 * 60 * 1000); // 12시간

  if (!isLoggedIn || !hasToken || expired) {
    redirectToLogin();
    return false;
  }
  return true;
}

/* =========================
   전역
========================= */
let db = null;                 // (옵션) Firebase
let sseConnection = null;      // SSE 핸들

/* =========================
   DOM 로드 후 시작
========================= */
document.addEventListener('DOMContentLoaded', async () => {
  // 인증 확인
  if (!checkAdminAuth()) return;

  await waitForRuntime();

  // (옵션) Firebase 초기화
  if (typeof firebase !== 'undefined' && window.firebaseConfig) {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  }

  // 요소 캐시
  const adminDashboard        = document.getElementById('admin-dashboard');
  const inventoryList         = document.getElementById('inventory-list');
  const notificationToggleBtn = document.getElementById('notification-toggle');
  const testSoundBtn          = document.getElementById('test-sound-btn');
  const logoutBtn             = document.getElementById('admin-logout-btn');

  // 로그아웃 버튼 동작
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      redirectToLogin();
    });
  }

  // (옵션) 기본 메뉴 가격 맵(폴백)
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

  /* ============ 간단 유틸 ============ */
  function showSystemNotification(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      } else {
        console.log('[NOTI]', title, body);
      }
    } catch { console.log('[NOTI]', title, body); }
  }

  // 알림/사운드
  let soundEnabled = true;
  function playNotificationSound(type = 'new-order') {
    if (!soundEnabled) return;
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const beep = (freq, ms) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(freq, audioContext.currentTime);
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + ms/1000);
        osc.start(); osc.stop(audioContext.currentTime + ms/1000);
      };
      if (type === 'new-order')      { beep(800,200); setTimeout(()=>beep(1000,200),300); }
      else if (type === 'status-change'){ beep(600,300); }
      else if (type === 'payment-pending'){ beep(500,150); setTimeout(()=>beep(700,150),200); setTimeout(()=>beep(900,150),400); }
    } catch (e) { console.warn('소리 재생 실패:', e); }
  }
  function toggleNotifications() {
    soundEnabled = !soundEnabled;
    if (notificationToggleBtn) {
      notificationToggleBtn.innerHTML = soundEnabled ? '🔔 알림 ON' : '🔕 알림 OFF';
      notificationToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
    }
    if (soundEnabled) playNotificationSound('status-change');
    localStorage.setItem('memory-pub-sound-enabled', String(soundEnabled));
  }
  function testNotificationSound() {
    playNotificationSound('new-order');
    setTimeout(() => showSystemNotification('🔊 소리 테스트', '소리가 잘 들리시나요?'), 500);
  }
  function loadNotificationSettings() {
    const saved = localStorage.getItem('memory-pub-sound-enabled');
    if (saved !== null) soundEnabled = saved === 'true';
    if (notificationToggleBtn) {
      notificationToggleBtn.innerHTML = soundEnabled ? '🔔 알림 ON' : '🔕 알림 OFF';
      notificationToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
    }
  }
  // 권한 요청
  if ('Notification' in window) {
    Notification.requestPermission().then(() => {});
  }
  if (notificationToggleBtn) notificationToggleBtn.addEventListener('click', toggleNotifications);
  if (testSoundBtn)          testSoundBtn.addEventListener('click', testNotificationSound);
  loadNotificationSettings();

  /* ============ 렌더링 ============ */
  const $dash = document.getElementById('admin-dashboard');

  function mapStatusK(s) {
    switch (s) {
      case 'PENDING':     return '💰 입금 대기';
      case 'CONFIRMED':   return '💳 입금 확인됨';
      case 'IN_PROGRESS': return '👨‍🍳 조리중';
      case 'SERVED':      return '🍽️ 서빙 완료';
      case 'CANCELED':    return '❌ 취소됨';
      default:            return s || '';
    }
  }

  function renderCard(o) {
    // o: { id, status, table, payer_name, placed_at }
    const statusK = mapStatusK(o.status);
    const tableLabel = o.table?.label || (o.table || '') || (o.orderType === 'takeout' ? '포장' : '-');
    const placedAt = o.placed_at ? new Date(o.placed_at).toLocaleTimeString() : '';

    const btns = [];
    if (o.status === 'PENDING') {
      btns.push(`<button data-act="confirm" data-id="${o.id}">💳 입금 확인</button>`);
      btns.push(`<button data-act="cancel" data-id="${o.id}" class="danger">❌ 취소</button>`);
    }
    if (o.status === 'CONFIRMED') {
      btns.push(`<button data-act="start" data-id="${o.id}">👨‍🍳 조리 시작</button>`);
      btns.push(`<button data-act="cancel" data-id="${o.id}" class="danger">❌ 취소</button>`);
    }
    if (o.status === 'IN_PROGRESS') {
      btns.push(`<button data-act="serve" data-id="${o.id}">🍽️ 서빙 완료</button>`);
      btns.push(`<button data-act="cancel" data-id="${o.id}" class="danger">❌ 취소</button>`);
    }
    btns.push(`<button class="secondary" data-act="detail" data-id="${o.id}">🔍 상세</button>`);

    return `
      <div class="card" id="order-${o.id}">
        <div><b>#${o.id}</b> · ${tableLabel} · ${o.payer_name || ''}</div>
        <div class="meta">${statusK}${placedAt ? ' · ' + placedAt : ''}</div>
        <div class="btns">${btns.join('')}</div>
      </div>
    `;
  }

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

    // 통계 업데이트
    updateStats(urgent.length + waiting.length + preparing.length, 0, preparing.length, 0, meta);

    // 인라인 스타일 1회 주입
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

  /* ============ 폴링 함수들 ============ */
  function stopPolling() {
    if (POLL_TIMER) clearInterval(POLL_TIMER);
    POLL_TIMER = null;
  }
  
  function startPolling(ms = 30000) {
    if (POLL_TIMER) return;
    POLL_TIMER = setInterval(loadActiveOrders, ms);
  }

  /* ============ 데이터 로드 ============ */
  async function loadActiveOrders() {
    try {
      console.log('📊 진행중 주문 데이터 로드 중...');
      const resp = await getActiveOrders(); // { data:{urgent,waiting,preparing}, meta }
      const { urgent = [], waiting = [], preparing = [] } = resp.data || {};
      const meta = resp.meta || {};
      renderBuckets(urgent, waiting, preparing, meta);
      console.log(`✅ 활성 주문 로드 완료: ${(meta.total) ?? (urgent.length + waiting.length + preparing.length)}건`);
    } catch (err) {
      if (handleAuthError(err)) return;
      console.error('❌ 주문 데이터 로드 실패:', err);
      if ($dash) $dash.innerHTML = '<p>주문 데이터를 불러오는데 실패했습니다.</p>';
    }
  }

  // SSE: 스냅샷 즉시 렌더, 변경 이벤트 오면 재로딩
  (async () => {
    try {
      sseConnection = await createOrderStream(
        (type, payload) => {
          if (type === 'snapshot') {
            const { data: { urgent=[], waiting=[], preparing=[] } = {}, meta = {} } = payload || {};
            renderBuckets(urgent, waiting, preparing, meta);
          } else if (type === 'orders_changed') {
            loadActiveOrders();
          } else if (type === 'ping') {
            // keepalive
          }
        },
        (err) => {
          if (handleAuthError(err)) return;
          console.warn('SSE 오류, 폴백으로 폴링 유지:', err?.message || err);
          startPolling(10000);
        }
      );
    } catch (e) {
      if (!handleAuthError(e)) {
        console.warn('SSE 연결 실패, 폴링 사용');
        startPolling(10000);
      }
    }
  })();

  // 초기 1회 로드 + 기본 폴링
  loadActiveOrders();
  startPolling(30000);


  /* ============ 주문 조회 및 상태 관리 ============ */
  
  const orderSearchForm = document.getElementById('order-search-form');
  const orderSearchId = document.getElementById('order-search-id');
  const orderInspect = document.getElementById('order-inspect');

  if (orderSearchForm && orderSearchId && orderInspect) {
    orderSearchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const orderId = parseInt(orderSearchId.value);
      if (!orderId) {
        showError('주문 번호를 입력하세요.');
        return;
      }

      showLoading();

      try {
        const orderData = await getOrderDetails(orderId);
        const order = orderData?.id ? orderData : (orderData?.data || orderData);
        
        if (!order || !order.id) {
          showError(`주문 #${orderId}를 찾을 수 없습니다.`);
          return;
        }

        renderOrderCard(order);

      } catch (err) {
        if (handleAuthError(err)) return;
        console.error('주문 조회 실패:', err);
        showError(`주문 조회 실패: ${err?.message || '알 수 없는 오류'}`);
      }
    });
  }

  // 로딩 표시
  function showLoading() {
    orderInspect.innerHTML = `
      <div style="text-align:center; color:#666; padding:20px;">
        <i class="fas fa-spinner fa-spin" style="font-size:2em; margin-bottom:8px;"></i><br>
        주문 정보를 조회하고 있습니다...
      </div>
    `;
  }

  // 에러 표시
  function showError(message) {
    orderInspect.innerHTML = `
      <div style="text-align:center; color:#e74c3c; padding:20px; border:1px solid #e74c3c; border-radius:8px; background:#fdf2f2;">
        <i class="fas fa-exclamation-triangle" style="font-size:2em; margin-bottom:8px;"></i><br>
        ${message}
      </div>
    `;
  }

  // 주문 카드 렌더링
  function renderOrderCard(order) {
    const status = order.status;
    const createdTime = order.created_at ? new Date(order.created_at).toLocaleString('ko-KR') : '시간 정보 없음';
    const tableLabel = order.table?.label || '테이블 정보 없음';
    const total = order.amounts?.total ? Number(order.amounts.total).toLocaleString() : '0';
    
    const itemsHtml = (order.items || [])
      .map(item => `<li>${item.name || item.product_id} × ${item.qty}개 = ${Number(item.line_total || 0).toLocaleString()}원</li>`)
      .join('');

    // 상태별 버튼 생성
    const actionButtons = getActionButtons(order);

    orderInspect.innerHTML = `
      <div style="border:2px solid ${getStatusColor(status)}; padding:20px; border-radius:12px; background:white; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; color:#2c3e50;">주문 #${order.id}</h3>
            <span style="display:inline-block; margin-top:4px; padding:4px 12px; border-radius:20px; font-size:0.9em; font-weight:bold; background:${getStatusColor(status)}; color:white;">
              ${mapStatusK(status)}
            </span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${actionButtons}
            <button onclick="location.reload()" style="background:#95a5a6; color:white; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;">
              <i class="fas fa-sync"></i> 새로고침
            </button>
          </div>
        </div>
        
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:16px; padding:16px; background:#f8f9fa; border-radius:8px;">
          <div>
            <div style="margin-bottom:8px;"><i class="fas fa-table" style="color:#3498db;"></i> <strong>테이블:</strong> ${tableLabel}</div>
            <div><i class="fas fa-user" style="color:#27ae60;"></i> <strong>입금자:</strong> ${order.payer_name || '정보 없음'}</div>
          </div>
          <div>
            <div style="margin-bottom:8px;"><i class="fas fa-won-sign" style="color:#f39c12;"></i> <strong>합계:</strong> ${total}원</div>
            <div><i class="fas fa-clock" style="color:#9b59b6;"></i> <strong>주문시간:</strong> ${createdTime}</div>
          </div>
        </div>
        
        <div>
          <h4 style="margin:0 0 12px 0; color:#2c3e50;"><i class="fas fa-list"></i> 주문 항목</h4>
          <ul style="margin:0; padding:16px; background:#ffffff; border:1px solid #ecf0f1; border-radius:8px; list-style:none;">
            ${itemsHtml ? itemsHtml.replace(/<li>/g, '<li style="padding:4px 0; border-bottom:1px solid #ecf0f1;">').replace(/(<li[^>]*>)([^<]+)/g, '$1<i class="fas fa-utensils" style="color:#e67e22; margin-right:8px;"></i>$2') : '<li style="text-align:center; color:#95a5a6;">항목 없음</li>'}
          </ul>
        </div>
      </div>
    `;

    // 버튼 이벤트 바인딩
    bindActionButtons(order.id);
  }

  // 상태별 액션 버튼 생성
  function getActionButtons(order) {
    const status = order.status;
    const orderId = order.id;
    
    switch (status) {
      case 'PENDING':
        return `
          <button data-action="confirm" data-id="${orderId}" style="background:#27ae60; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; margin-right:8px;">
            <i class="fas fa-check-circle"></i> 입금 확인
          </button>
          <button data-action="cancel" data-id="${orderId}" style="background:#e74c3c; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold;">
            <i class="fas fa-times-circle"></i> 주문 취소
          </button>
        `;
      
      case 'CONFIRMED':
        return `
          <button data-action="start" data-id="${orderId}" style="background:#3498db; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; margin-right:8px;">
            <i class="fas fa-utensils"></i> 조리 시작
          </button>
          <button data-action="cancel" data-id="${orderId}" style="background:#e74c3c; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold;">
            <i class="fas fa-times-circle"></i> 주문 취소
          </button>
        `;
      
      case 'IN_PROGRESS':
        return `
          <button data-action="serve" data-id="${orderId}" style="background:#2ecc71; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; margin-right:8px;">
            <i class="fas fa-concierge-bell"></i> 서빙 완료
          </button>
          <button data-action="cancel" data-id="${orderId}" style="background:#e74c3c; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold;">
            <i class="fas fa-times-circle"></i> 주문 취소
          </button>
        `;
      
      case 'SERVED':
        return `<span style="color:#2ecc71; font-weight:bold; font-size:1.1em;"><i class="fas fa-check-double"></i> 서빙 완료된 주문</span>`;
      
      case 'CANCELED':
        return `<span style="color:#e74c3c; font-weight:bold; font-size:1.1em;"><i class="fas fa-ban"></i> 취소된 주문</span>`;
      
      default:
        return '';
    }
  }

  // 액션 버튼 이벤트 바인딩
  function bindActionButtons(orderId) {
    const actionButtons = orderInspect.querySelectorAll('button[data-action]');
    
    actionButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const id = parseInt(btn.getAttribute('data-id'));
        
        if (id !== orderId) return;
        
        try {
          // 취소 액션인 경우 확인 받기
          if (action === 'cancel') {
            const confirmMessage = `주문 #${id}를 취소하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`;
            if (!confirm(confirmMessage)) {
              return;
            }
          }
          
          // 버튼 비활성화
          btn.disabled = true;
          const originalText = btn.innerHTML;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리중...';
          
          // 상태 변경 API 호출
          await patchOrderStatus(id, action);
          
          // 성공 시 활성 주문 목록 새로고침
          await loadActiveOrders();
          
          // 현재 주문 정보 다시 조회
          orderSearchForm.dispatchEvent(new Event('submit'));
          
          // 성공 메시지
          const actionMessages = {
            'confirm': '입금이 확인되었습니다.',
            'start': '조리를 시작합니다.',
            'serve': '서빙이 완료되었습니다.',
            'cancel': '주문이 취소되었습니다.'
          };
          
          console.log(`✅ 주문 #${id}: ${actionMessages[action] || '상태 변경 완료'}`);
          
        } catch (err) {
          if (handleAuthError(err)) return;
          alert(`상태 변경 실패: ${err?.message || '알 수 없는 오류'}`);
          
          // 에러 시 버튼 복원
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      });
    });
  }

  // 상태별 색상 반환
  function getStatusColor(status) {
    switch (status) {
      case 'PENDING': return '#f39c12';      // 주황색 - 입금 대기
      case 'CONFIRMED': return '#27ae60';    // 초록색 - 입금 확인됨
      case 'IN_PROGRESS': return '#3498db';  // 파란색 - 조리중
      case 'SERVED': return '#2ecc71';       // 밝은 초록 - 서빙 완료
      case 'CANCELED': return '#e74c3c';     // 빨간색 - 취소됨
      default: return '#95a5a6';             // 회색 - 기타
    }
  }

  /* ============ 카드 버튼 액션 위임 ============ */
  if ($dash) {
    $dash.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');         // confirm | start | serve | cancel | detail
      const id  = Number(btn.getAttribute('data-id'));
      if (!id) return;

      try {
        if (act === 'detail') {
          const d = await getOrderDetails(id);
          const od = d?.id ? d : (d?.data || d);
          alert(detailText(od));
          return;
        }
        
        // 취소 액션인 경우 확인 받기
        if (act === 'cancel') {
          const confirmMessage = `주문 #${id}를 취소하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`;
          if (!confirm(confirmMessage)) {
            return;
          }
        }
        
        await patchOrderStatus(id, act); // 상태 변경
        await loadActiveOrders();
        
        // 성공 메시지
        const actionMessages = {
          'confirm': '입금이 확인되었습니다.',
          'start': '조리를 시작합니다.',
          'serve': '서빙이 완료되었습니다.',
          'cancel': '주문이 취소되었습니다.'
        };
        
        if (actionMessages[act]) {
          console.log(`✅ 주문 #${id}: ${actionMessages[act]}`);
        }
        
      } catch (err) {
        if (handleAuthError(err)) return;
        alert(err?.message || '요청 실패');
      }
    });
  }

  function detailText(d) {
    const lines = [];
    lines.push(`주문 #${d.id} (${mapStatusK(d.status)})`);
    if (d.table?.label) lines.push(`테이블: ${d.table.label}`);
    if (d.payer_name)   lines.push(`입금자: ${d.payer_name}`);
    if (d.amounts?.total != null) lines.push(`합계: ${Number(d.amounts.total).toLocaleString()}원`);
    if (Array.isArray(d.items) && d.items.length) {
      lines.push('품목:');
      d.items.forEach(it => lines.push(` - ${it.name || it.product_id} x${it.qty} (${Number(it.line_total).toLocaleString()}원)`));
    }
    return lines.join('\n');
  }

  // 통계 업데이트 함수
  function updateStats(totalActive, pendingCount, preparingCount, completedCount, meta) {
    const totalOrdersEl = document.getElementById('total-orders');
    const paymentPendingEl = document.getElementById('payment-pending-orders');
    const pendingOrdersEl = document.getElementById('pending-orders');
    const completedOrdersEl = document.getElementById('completed-orders');
    const waitingTeamsEl = document.getElementById('waiting-teams');

    if (totalOrdersEl) totalOrdersEl.textContent = totalActive;
    if (paymentPendingEl) paymentPendingEl.textContent = pendingCount;
    if (pendingOrdersEl) pendingOrdersEl.textContent = preparingCount;
    if (completedOrdersEl) completedOrdersEl.textContent = completedCount;
    if (waitingTeamsEl) waitingTeamsEl.textContent = totalActive;

    console.log(`📊 통계 업데이트: 활성 ${totalActive}, 입금대기 ${pendingCount}, 준비중 ${preparingCount}`);
  }

  /* ============ 재고 UI(폴백 포함) ============ */
  async function loadAdminMenu() {
    try {
      console.log('📋 관리자용 메뉴 로드 중...');
      const data = await getAdminMenu();
      displayMenuInventory(data);
      console.log('✅ 메뉴 로드 완료:', data.length, '개 항목');
    } catch (error) {
      if (handleAuthError(error)) return;
      console.error('❌ 메뉴 로드 실패:', error);
      displayMenuInventory([]); // 폴백
    }
  }

  function displayMenuInventory(menuData) {
    if (!inventoryList) return;
    let html = '<h3>📋 메뉴 재고 관리</h3>';
    if (menuData && menuData.length > 0) {
      menuData.forEach(item => {
        const soldOutClass = item.is_sold_out ? 'sold-out' : '';
        const stockStatus  = item.is_sold_out ? '품절' : `재고 ${item.stock}개`;
        html += `
          <div class="inventory-item ${soldOutClass}">
            <div class="menu-info">
              <span class="menu-name">${item.name}</span>
              <span class="menu-price">${Number(item.price).toLocaleString()}원</span>
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
      Object.entries(menuInventory).forEach(([name, price]) => {
        html += `
          <div class="inventory-item">
            <div class="menu-info">
              <span class="menu-name">${name}</span>
              <span class="menu-price">${Number(price).toLocaleString()}원</span>
            </div>
            <div class="inventory-controls">
              <span class="stock-info">재고 관리 중</span>
              <button class="toggle-stock-btn" data-menu-name="${name}">재고 관리</button>
            </div>
          </div>
        `;
      });
    }
    inventoryList.innerHTML = html;

    inventoryList.querySelectorAll('.toggle-stock-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const b = e.currentTarget;
        const menuId = b.dataset.menuId;
        const menuName = b.dataset.menuName;
        const isSoldOut = b.dataset.soldOut === 'true';
        if (menuId) {
          alert(`${isSoldOut ? '재입고' : '품절처리'} 기능은 추후 구현 예정입니다.`);
        } else if (menuName) {
          alert(`${menuName} 재고 관리 기능은 추후 구현 예정입니다.`);
        }
      });
    });
  }

  /* ============ 전체 주문 관리 ============ */
  
  // 전역 변수
  let currentPageCursor = null;  // 현재 페이지 커서
  let prevPageCursor = null;     // 이전 페이지 커서
  let currentLimit = 10;         // 페이지당 주문 수
  let currentStatusFilter = '';  // 상태 필터

  // 새로운 전체 주문 관리 요소들
  const allOrdersContainer    = document.getElementById('all-orders-container');
  const ordersPerPageSelect   = document.getElementById('orders-per-page');
  const statusFilterSelect    = document.getElementById('status-filter');
  const refreshAllOrdersBtn   = document.getElementById('refresh-all-orders');
  const prevPageBtn           = document.getElementById('prev-page-btn');
  const nextPageBtn           = document.getElementById('next-page-btn');
  const pageInfo              = document.getElementById('page-info');

  // 주문 카드 컴포넌트 렌더링
  function renderOrderComponent(order) {
    const statusK = mapStatusK(order.status);
    const tableLabel = order.table?.label || '테이블 정보 없음';
    const createdTime = new Date(order.created_at).toLocaleString('ko-KR');
    const total = Number(order.total_amount || 0).toLocaleString();
    
    const itemsHtml = (order.items || [])
      .map(item => `
        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #1C355D;">
          <span>${item.name} × ${item.quantity}개</span>
          <span>${Number(item.line_total || 0).toLocaleString()}원</span>
        </div>
      `).join('');

    // 상태별 액션 버튼
    const actionButtons = getOrderActionButtons(order);

    return `
      <div class="order-component" id="order-component-${order.id}" style="border:1px solid #ddd; border-radius:8px; padding:16px; margin-bottom:12px; background:white; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <!-- 주문 헤더 -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:2px solid #ecf0f1;">
          <div>
            <h4 style="margin:0; color:#2c3e50;">주문 #${order.id}</h4>
            <span style="display:inline-block; margin-top:4px; padding:4px 12px; border-radius:20px; font-size:0.85em; font-weight:bold; background:${getStatusColor(order.status)}; color:white;">
              ${statusK}
            </span>
          </div>
          <div style="text-align:right; color:#666; font-size:0.9em;">
            <div><i class="fas fa-clock"></i> ${createdTime}</div>
            <div><i class="fas fa-won-sign"></i> ${total}원</div>
          </div>
        </div>

        <!-- 주문 정보 -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:12px;">
          <div>
            <div style="margin-bottom:4px;"><i class="fas fa-table" style="color:#3498db;"></i> <strong>테이블:</strong> ${tableLabel}</div>
            <div><i class="fas fa-user" style="color:#27ae60;"></i> <strong>입금자:</strong> ${order.payer_name || '정보 없음'}</div>
          </div>
          <div>
            <div style="margin-bottom:4px;"><i class="fas fa-utensils" style="color:#e67e22;"></i> <strong>주문 유형:</strong> ${order.order_type === 'TAKEOUT' ? '포장' : '매장'}</div>
            <div><i class="fas fa-list" style="color:#9b59b6;"></i> <strong>항목 수:</strong> ${(order.items || []).length}개</div>
          </div>
        </div>

        <!-- 주문 항목 -->
        <div style="margin-bottom:16px;">
          <h5 style="margin:0 0 8px 0; color:#2c3e50;"><i class="fas fa-shopping-cart"></i> 주문 항목</h5>
          <div style="background:#f8f9fa; padding:12px; border-radius:6px; max-height:150px; overflow-y:auto;">
            ${itemsHtml || '<div style="text-align:center; color:#95a5a6;">주문 항목 정보 없음</div>'}
          </div>
        </div>

        <!-- 액션 버튼들 -->
        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          ${actionButtons}
        </div>
      </div>
    `;
  }

  // 주문별 액션 버튼 생성
  function getOrderActionButtons(order) {
    const status = order.status;
    const orderId = order.id;
    
    switch (status) {
      case 'PENDING':
        return `
          <button class="order-action-btn" data-action="confirm" data-order-id="${orderId}" style="background:#27ae60; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.85em;">
            <i class="fas fa-check-circle"></i> 입금 확인
          </button>
          <button class="order-action-btn" data-action="cancel" data-order-id="${orderId}" style="background:#e74c3c; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.85em;">
            <i class="fas fa-times-circle"></i> 취소
          </button>
        `;
      
      case 'CONFIRMED':
        return `
          <button class="order-action-btn" data-action="start" data-order-id="${orderId}" style="background:#3498db; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.85em;">
            <i class="fas fa-utensils"></i> 조리 시작
          </button>
          <button class="order-action-btn" data-action="cancel" data-order-id="${orderId}" style="background:#e74c3c; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.85em;">
            <i class="fas fa-times-circle"></i> 취소
          </button>
        `;
      
      case 'IN_PROGRESS':
        return `
          <button class="order-action-btn" data-action="serve" data-order-id="${orderId}" style="background:#2ecc71; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.85em;">
            <i class="fas fa-concierge-bell"></i> 서빙 완료
          </button>
          <button class="order-action-btn" data-action="cancel" data-order-id="${orderId}" style="background:#e74c3c; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:0.85em;">
            <i class="fas fa-times-circle"></i> 취소
          </button>
        `;
      
      case 'SERVED':
        return `<span style="color:#2ecc71; font-weight:bold; font-size:0.9em;"><i class="fas fa-check-double"></i> 서빙 완료</span>`;
      
      case 'CANCELED':
        return `<span style="color:#e74c3c; font-weight:bold; font-size:0.9em;"><i class="fas fa-ban"></i> 취소됨</span>`;
      
      default:
        return '';
    }
  }

  // 전체 주문 목록 로드
  async function loadAllOrders(options = {}) {
    if (!allOrdersContainer) return;

    try {
      // 로딩 표시
      allOrdersContainer.innerHTML = `
        <div style="text-align:center; color:#666; padding:20px;">
          <i class="fas fa-spinner fa-spin" style="font-size:2em; margin-bottom:8px;"></i><br>
          주문 목록을 불러오는 중...
        </div>
      `;

      const queryOptions = {
        limit: currentLimit,
        ...options
      };

      if (currentStatusFilter) {
        queryOptions.status = currentStatusFilter;
      }

      const result = await getAllOrders(queryOptions);
      const orders = result.items || [];
      const pageInfoData = result.page_info || {};

      if (orders.length === 0) {
        allOrdersContainer.innerHTML = `
          <div style="text-align:center; color:#666; padding:40px; border:1px dashed #ddd; border-radius:8px;">
            <i class="fas fa-inbox" style="font-size:3em; margin-bottom:12px; color:#bdc3c7;"></i><br>
            <h4 style="margin:0 0 8px 0;">주문이 없습니다</h4>
            <p style="margin:0; color:#95a5a6;">현재 조건에 맞는 주문이 없습니다.</p>
          </div>
        `;
      } else {
        // 주문 목록 렌더링
        const ordersHtml = orders.map(order => renderOrderComponent(order)).join('');
        allOrdersContainer.innerHTML = ordersHtml;
      }

      // 페이지네이션 업데이트
      updatePaginationControls(pageInfoData);

      console.log(`✅ 전체 주문 로드 완료: ${orders.length}건`);

    } catch (err) {
      if (handleAuthError(err)) return;
      console.error('❌ 전체 주문 로드 실패:', err);
      allOrdersContainer.innerHTML = `
        <div style="text-align:center; color:#e74c3c; padding:40px; border:1px solid #e74c3c; border-radius:8px; background:#fdf2f2;">
          <i class="fas fa-exclamation-triangle" style="font-size:3em; margin-bottom:12px;"></i><br>
          <h4 style="margin:0 0 8px 0;">주문 목록 로드 실패</h4>
          <p style="margin:0;">${err?.message || '알 수 없는 오류가 발생했습니다.'}</p>
        </div>
      `;
    }
  }

  // 페이지네이션 컨트롤 업데이트
  function updatePaginationControls(pageInfoData) {
    if (!pageInfoData) return;

    // 버튼 상태 업데이트
    if (prevPageBtn) {
      prevPageBtn.disabled = !pageInfoData.prev_cursor;
      prevPageBtn.style.background = pageInfoData.prev_cursor ? '#3498db' : '#95a5a6';
    }

    if (nextPageBtn) {
      nextPageBtn.disabled = !pageInfoData.has_more;
      nextPageBtn.style.background = pageInfoData.has_more ? '#3498db' : '#95a5a6';
    }

    // 페이지 정보 업데이트
    if (pageInfo) {
      const pageText = pageInfoData.has_more ? '페이지 진행중' : '마지막 페이지';
      pageInfo.textContent = pageText;
    }

    // 커서 정보 저장
    currentPageCursor = pageInfoData.next_cursor;
    prevPageCursor = pageInfoData.prev_cursor;
  }

  // 주문 액션 처리
  async function handleOrderAction(orderId, action) {
    try {
      // 취소 액션인 경우 확인 받기
      if (action === 'cancel') {
        const confirmMessage = `주문 #${orderId}를 취소하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`;
        if (!confirm(confirmMessage)) {
          return;
        }
      }

      // 해당 주문 컴포넌트 찾기
      const orderComponent = document.getElementById(`order-component-${orderId}`);
      if (orderComponent) {
        // 로딩 상태 표시
        const actionButtons = orderComponent.querySelectorAll('.order-action-btn');
        actionButtons.forEach(btn => {
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리중...';
        });
      }

      // 상태 변경 API 호출
      await patchOrderStatus(orderId, action);

      // 성공 메시지
      const actionMessages = {
        'confirm': '입금이 확인되었습니다.',
        'start': '조리를 시작합니다.',
        'serve': '서빙이 완료되었습니다.',
        'cancel': '주문이 취소되었습니다.'
      };

      console.log(`✅ 주문 #${orderId}: ${actionMessages[action] || '상태 변경 완료'}`);

      // 주문 목록 새로고침
      await loadAllOrders();
      
      // 활성 주문 목록도 새로고침
      await loadActiveOrders();

    } catch (err) {
      if (handleAuthError(err)) return;
      console.error('주문 액션 처리 실패:', err);
      alert(`상태 변경 실패: ${err?.message || '알 수 없는 오류'}`);
      
      // 실패 시 주문 목록 새로고침하여 원래 상태로 복원
      await loadAllOrders();
    }
  }

  // 이벤트 리스너 설정
  if (ordersPerPageSelect) {
    ordersPerPageSelect.addEventListener('change', (e) => {
      currentLimit = parseInt(e.target.value);
      currentPageCursor = null; // 페이지 리셋
      loadAllOrders();
    });
  }

  if (statusFilterSelect) {
    statusFilterSelect.addEventListener('change', (e) => {
      currentStatusFilter = e.target.value;
      currentPageCursor = null; // 페이지 리셋
      loadAllOrders();
    });
  }

  if (refreshAllOrdersBtn) {
    refreshAllOrdersBtn.addEventListener('click', () => {
      currentPageCursor = null; // 페이지 리셋
      loadAllOrders();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (prevPageCursor) {
        loadAllOrders({ before: prevPageCursor });
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (currentPageCursor) {
        loadAllOrders({ after: currentPageCursor });
      }
    });
  }

  // 주문 액션 버튼 이벤트 위임
  if (allOrdersContainer) {
    allOrdersContainer.addEventListener('click', async (e) => {
      const actionBtn = e.target.closest('.order-action-btn[data-action][data-order-id]');
      if (!actionBtn) return;

      const action = actionBtn.getAttribute('data-action');
      const orderId = parseInt(actionBtn.getAttribute('data-order-id'));
      
      if (orderId && action) {
        await handleOrderAction(orderId, action);
      }
    });
  }

  // 초기 전체 주문 목록 로드
  if (allOrdersContainer) {
    loadAllOrders();
  }

  // 필요 시 호출
  // loadAdminMenu();
});