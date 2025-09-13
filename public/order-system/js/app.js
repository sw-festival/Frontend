// public/order-system/js/app.js
import './config.js';
import { createOrder, openSessionBySlug, openTakeoutSession, getPublicMenu, getTopMenu, ensureSessionBeforeOrder } from './api-session.js';
import { PRODUCT_ID_MAP } from './product-map.js';
import { Tokens, SessionStore } from './tokens.js';

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 MEMORY 주점 주문 시스템 시작');

  // -----------------------------
  // 상태
  // -----------------------------
  let orderType = 'dine-in';
  let discountRate = 0;
  const cart = {};
  let allMenus = {}; // 카테고리별 메뉴 데이터
  let currentCategory = 'set';
  let isProcessing = false;

  // -----------------------------
  // slug 추출
  // -----------------------------
  function extractSlug() {
    const { pathname, href } = window.location;
    const m = pathname.match(/\/t\/([^/?#]+)/);
    const fromPath = m ? decodeURIComponent(m[1]) : null;
    if (fromPath) return fromPath.replace(/^:/, '').trim();
    const sp = new URL(href).searchParams;
    const fromQuery = sp.get('slug');
    if (fromQuery) return fromQuery.replace(/^:/, '').trim();
    return (window.RUNTIME?.DEFAULT_SLUG || '').trim();
  }
  const slug = extractSlug();
  console.log('Slug:', slug || '(없음)');

  // -----------------------------
  // slug → 주문유형 결정 (RUNTIME 우선, 없으면 JSON)
  // -----------------------------
  let _slugTypes;
  async function getSlugTypes() {
    if (_slugTypes) return _slugTypes;
    const url = window.RUNTIME?.SLUG_TYPES_URL || '/order-system/data/slug-types.json';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      _slugTypes = {
        takeout: new Set(json.takeout || []),
        dinein:  new Set(json.dinein  || []),
      };
    } catch (e) {
      console.warn('[slug-types] load failed, fallback dine-in', e);
      _slugTypes = { takeout: new Set(), dinein: new Set() };
    }
    return _slugTypes;
  }
  async function resolveOrderTypeBySlug(slugVal) {
    const types = await getSlugTypes();
    if (types.takeout.has(slugVal)) return 'takeout';
    if (types.dinein.has(slugVal))  return 'dine-in';
    return 'dine-in';
  }

  // -----------------------------
  // 화면 전환 (1단계 숨기고 메뉴로)
  // -----------------------------
  function goToMenuStep(type) {
    const headerTitle = document.querySelector('header h1');
    if (headerTitle) {
      headerTitle.innerHTML = (type === 'takeout')
        ? `<i class="fas fa-shopping-bag"></i> 포장 주문 (10% 할인)`
        : `<i class="fas fa-utensils"></i> 매장 이용`;
    }

    const dineInBtn  = document.getElementById('dine-in-btn');
    const takeoutBtn = document.getElementById('takeout-btn');
    if (dineInBtn && takeoutBtn) {
      if (type === 'takeout') {
        takeoutBtn.classList.add('selected');
        dineInBtn.classList.remove('selected');
      } else {
        dineInBtn.classList.add('selected');
        takeoutBtn.classList.remove('selected');
      }
    }

    const orderTypeSection = document.getElementById('order-type-section');
    const menuSection = document.getElementById('menu-section');
    if (orderTypeSection) orderTypeSection.classList.add('hidden');
    if (menuSection) menuSection.classList.remove('hidden');

    console.log('타입 자동결정으로 메뉴 단계 진입:', type);
  }

  // -----------------------------
  // 모달 유틸
  // -----------------------------
  const codeModal     = document.getElementById('code-modal');
  const codeInput     = document.getElementById('code-input');
  const verifyBtn     = document.getElementById('verify-btn');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const codeError     = document.getElementById('code-error');
  const codeLoading   = document.getElementById('code-loading');

  function showCodeModal() {
    codeModal?.classList.remove('hidden');
    if (codeInput) {
      codeInput.value = '';
      codeInput.focus();
    }
    hideModalMessages();
    console.log('코드 입력 모달 표시');
  }
  function hideCodeModal() {
    codeModal?.classList.add('hidden');
    console.log('코드 입력 모달 숨김');
  }
  function hideModalMessages() {
    codeError?.classList.add('hidden');
    codeLoading?.classList.add('hidden');
  }

  modalCloseBtn?.addEventListener('click', hideCodeModal);
  codeModal?.addEventListener('click', (e) => { if (e.target === codeModal) hideCodeModal(); });
  codeInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !verifyBtn?.classList.contains('disabled')) verifyBtn?.click(); });
  
  // 코드 입력 실시간 유효성 검사
  codeInput?.addEventListener('input', (e) => {
    const code = e.target.value.trim();
    const validationMessage = document.getElementById('code-validation-message');
    
    if (code.length >= 3) { // 최소 3자리 이상
      // 유효한 코드 상태
      verifyBtn?.classList.remove('disabled');
      if (validationMessage) {
        validationMessage.className = 'validation-message success';
        validationMessage.innerHTML = '<i class="fas fa-check-circle"></i> 접속하기 버튼을 클릭해주세요';
      }
    } else {
      // 비활성 상태
      verifyBtn?.classList.add('disabled');
      if (validationMessage) {
        validationMessage.className = 'validation-message error';
        validationMessage.innerHTML = '<i class="fas fa-exclamation-circle"></i> 올바른 코드를 입력해주세요';
      }
    }
  });

  // -----------------------------
  // 장바구니/주문 유틸
  // -----------------------------
  const menuList          = document.getElementById('menu-list');
  const cartItems         = document.getElementById('cart-items');
  const totalPriceEl      = document.getElementById('total-price');
  const customerNameInput = document.getElementById('customer-name');
  const placeOrderBtn     = document.getElementById('place-order-btn');

  function updateMenuAvailability(apiMenuData) {
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(menuItem => {
      const menuName = menuItem.querySelector('.menu-name')?.textContent || '';
      const apiMenu = apiMenuData.find(item => item.name === menuName);
      if (!apiMenu) return;

      // 품절
      if (apiMenu.is_sold_out) {
        menuItem.classList.add('sold-out');
        menuItem.style.opacity = '0.5';
        if (!menuItem.querySelector('.sold-out-label')) {
          const soldOutLabel = document.createElement('div');
          soldOutLabel.className = 'sold-out-label';
          soldOutLabel.innerHTML = '<span style="color: red; font-weight: bold;">품절</span>';
          menuItem.appendChild(soldOutLabel);
        }
        menuItem.querySelectorAll('.quantity-btn').forEach(btn => {
          btn.disabled = true;
          btn.style.opacity = '0.3';
        });
      } else {
        menuItem.classList.remove('sold-out');
        menuItem.style.opacity = '1';
      }

      // 가격 동기화
      const priceEl = menuItem.querySelector('.menu-price');
      const currentPrice = parseInt(menuItem.dataset.price);
      if (Number.isFinite(apiMenu.price) && apiMenu.price !== currentPrice) {
        if (priceEl) priceEl.textContent = `${apiMenu.price.toLocaleString()}원`;
        menuItem.dataset.price = apiMenu.price;
        console.log(`💰 가격 업데이트: ${menuName} ${currentPrice} → ${apiMenu.price}`);
      }
    });
  }

//   function updateCartDisplay() {
//     if (!cartItems || !totalPriceEl) return;

//     const keys = Object.keys(cart);
//     if (!keys.length) {
//       cartItems.innerHTML = `
//         <p style="text-align: center; color: #666; padding: 2rem;">
//           선택한 메뉴가 여기에 표시됩니다.
//         </p>`;
//       totalPriceEl.textContent = '0';
//       return;
//     }

//     let html = '';
//     let subtotal = 0;
//     keys.forEach(name => {
//       const item = cart[name];
//       const itemTotal = item.price * item.quantity;
//       subtotal += itemTotal;
//       html += `
//         <div class="cart-item">
//           <div>
//             <strong>${item.name}</strong><br>
//             <small>${item.price.toLocaleString()}원 × ${item.quantity}개</small>
//           </div>
//           <div style="font-weight: bold; color: #1a5490;">
//             ${itemTotal.toLocaleString()}원
//           </div>
//         </div>`;
//     });

//     cartItems.innerHTML = html;

//     const discount = Math.round(subtotal * discountRate);
//     const total = subtotal - discount;
//     if (discount > 0) {
//       cartItems.innerHTML += `
//         <div class="cart-item" style="color: #28a745;">
//           <div>포장 할인 (10%)</div>
//           <div>-${discount.toLocaleString()}원</div>
//         </div>`;
//     }
//     totalPriceEl.textContent = total.toLocaleString();

//     console.log('장바구니 업데이트:', { subtotal, discount, total, items: keys.length });
//   }

  function prepareOrderData() {
    // const items = Object.values(cart).map(item => ({
    //   product_id: PRODUCT_ID_MAP[item.name],
    //   quantity: item.quantity,
    // }));
    // cart는 { [menuId]: { name, price, quantity } }
    const items = Object.entries(cart).map(([menuId, item]) => ({
        product_id: Number(menuId),
        quantity: item.quantity,
    }));
    
    const orderData = {
      order_type: orderType === 'dine-in' ? 'DINE_IN' : 'TAKEOUT',
      payer_name: customerNameInput.value.trim(),
      items,
    };
    
    console.log('[prepareOrderData] 주문 데이터:', orderData);
    console.log('[prepareOrderData] 세션 토큰 상태:', {
      hasToken: !!Tokens.getSession?.(),
      tokenPreview: Tokens.getSession?.()?.substring(0, 20) + '...'
    });
    
    return orderData;
  }

  async function placeOrderWithNewSession(slug, expectedChannel) {
    try {
      if (isProcessing) return;
      isProcessing = true;

      const orderData = prepareOrderData();
      console.log(`[주문 진행] 주문 데이터 준비 완료 (${slug}, ${expectedChannel}):`, orderData);

      const result = await createOrder(orderData, slug);
      console.log(`[주문 진행] 주문 생성 성공 (${slug}):`, result);

      handleOrderSuccess(result.data.order_id);
    } catch (e) {
      console.error(`[주문 진행] 주문 실패 (${slug}):`, e);
      const msg = String(e?.message || e);
      
      // DINE-IN 토큰 만료는 코드 모달로
      if (msg === 'DINEIN_TOKEN_EXPIRED') {
        console.log(`[주문 진행] DINE-IN 토큰 만료, 코드 모달 표시: ${slug}`);
        SessionStore.removeSession(slug);
        Tokens.clearSession(); // 레거시 호환성
        showCodeModal();
        return;
      }
      
      // 기타 세션 관련 에러
      if (msg.includes('세션') || msg.includes('401') || msg.toLowerCase().includes('token')) {
        if (expectedChannel === 'DINEIN') {
          console.log(`[주문 진행] DINE-IN 세션 에러, 코드 모달 표시: ${slug}`);
          SessionStore.removeSession(slug);
          Tokens.clearSession();
        showCodeModal();
        return;
      }
        // TAKEOUT은 이미 ensureSessionBeforeOrder에서 자동 재시도했으므로 여기까지 오면 진짜 실패
      }
      
      alert('주문 중 오류가 발생했습니다: ' + msg);
    } finally {
      isProcessing = false;
    }
  }

  function handleOrderSuccess(orderId) {
    console.log('주문 성공 처리:', orderId, 'orderType:', orderType);
    hideCodeModal();

    // 주문 당시 세션 스냅샷 저장 (waiting 페이지 복원용)
    try {
        const s = SessionStore.getSession?.(slug) || {};
        const tokenForSnapshot = s.token || Tokens.getSession?.();   // 폴백 추가

        if (tokenForSnapshot) {
            localStorage.setItem(
            `ORDER_SESSION_${orderId}`,
            JSON.stringify({
                token: tokenForSnapshot,        // 항상 토큰이 저장되도록
                session_id: s.session_id,
                table_id: s.table_id,
                channel: s.channel,             // 'DINEIN' | 'TAKEOUT'
                slug,
                createdAt: new Date().toISOString(),
                expiresAt: s.expiresAt
            })
            );
        }
        const map = JSON.parse(localStorage.getItem('LAST_ORDER_BY_SLUG') || '{}');
        map[slug] = orderId;
        localStorage.setItem('LAST_ORDER_BY_SLUG', JSON.stringify(map));
        } catch (e) {
        console.warn('[handleOrderSuccess] 세션 스냅샷 저장 실패', e);
    }

    // 알림 문구
    let successMessage = '주문이 성공적으로 완료되었습니다!';
    successMessage += (orderType === 'dine-in')
        ? '\n\n매장 이용시간은 2시간입니다.'
        : '\n\n포장 주문이 완료되었습니다.';
    alert(successMessage);

    // 루트 waiting.html로 보내고 slug는 쿼리로 전달
    const waitingUrl = `/waiting.html?orderId=${orderId}&slug=${encodeURIComponent(slug)}`;
    window.location.href = waitingUrl;
}

  // 주문하기 클릭
  placeOrderBtn?.addEventListener('click', async () => {
    console.log('주문 시도 - orderType:', orderType);
    if (Object.keys(cart).length === 0) { alert('메뉴를 선택해주세요.'); return; }
    if (!customerNameInput.value.trim()) { alert('입금자명을 입력해주세요.'); customerNameInput.focus(); return; }
    if (!slug) { alert('유효하지 않은 접근입니다. /t/{slug} 주소로 접속해주세요.'); return; }
    
    const expectedChannel = orderType === 'takeout' ? 'TAKEOUT' : 'DINEIN';
    console.log(`[주문하기] 세션 보장 시작: ${slug}, 채널: ${expectedChannel}`);
    
    try {
      // TAKEOUT 안전모드: 항상 새 세션 열기 (서버 측 세션 상태 불일치 방지)
      const options = expectedChannel === 'TAKEOUT' ? { alwaysRefresh: true } : {};
      
      // ensureSessionBeforeOrder로 세션 보장
      await ensureSessionBeforeOrder(slug, expectedChannel, options);
      console.log(`[주문하기] 세션 보장 완료: ${slug}`, { 
        channel: expectedChannel, 
        safeMode: options.alwaysRefresh 
      });
      
      // 주문 진행
      await placeOrderWithNewSession(slug, expectedChannel);
      
    } catch (error) {
      console.error(`[주문하기] 세션 보장 실패: ${slug}`, error);
      
      // DINE-IN 에러들은 코드 모달로 유도
      if (error.message.startsWith('DINEIN_')) {
        console.log(`[주문하기] DINE-IN 세션 문제, 코드 모달 표시: ${error.message}`);
        SessionStore.removeSession(slug);
        Tokens.clearSession(); // 레거시 호환성
        showCodeModal();
        return;
      }
      
      // 기타 에러
      alert('세션 확인 중 오류가 발생했습니다: ' + error.message);
    }
  });

  // 코드 검증 + 세션 열기 (매장 주문 전용)
  verifyBtn?.addEventListener('click', async () => {
    if (isProcessing) return;
    if (verifyBtn.classList.contains('disabled')) return; // 비활성 상태에서 클릭 방지
    
    // 포장 주문에서는 이 버튼이 실행되면 안 됨
    if (orderType === 'takeout') {
      console.error('[verifyBtn] TAKEOUT 경로에서 코드 모달이 열렸습니다. 무시합니다.');
      hideCodeModal();
      return;
    }
    
    const code = codeInput.value.trim();
    if (!code) { alert('접속 코드를 입력해주세요.'); codeInput.focus(); return; }
    if (!slug) { alert('슬러그 정보가 없습니다. /t/{slug}로 접속해주세요.'); return; }

    console.log(`[verifyBtn] DINE-IN 코드 검증 시작: ${slug}, code: ${code}`);
    isProcessing = true;
    hideModalMessages();
    codeLoading?.classList.remove('hidden');
    verifyBtn.disabled = true;

    try {
      // DINE-IN 세션 열기 (openSessionBySlug는 SessionStore에 저장)
      await openSessionBySlug(slug, code);
      
      const session = SessionStore.getSession(slug);
      console.log(`[verifyBtn] DINE-IN 세션 열기 성공: ${slug}`, {
        sessionId: session?.session_id,
        channel: session?.channel,
        expiresAt: session?.expiresAt
      });

      codeLoading?.classList.add('hidden');

      // 모달 가이드 메시지 표시
      const modalGuideMessage = document.querySelector('.modal-guide-message');
      if (modalGuideMessage) {
        modalGuideMessage.style.display = 'block';
      }

      hideCodeModal();

      // 주문 진행 (DINE-IN 채널로)
      await placeOrderWithNewSession(slug, 'DINEIN');
      
    } catch (error) {
      console.error(`[verifyBtn] DINE-IN 세션 열기 실패: ${slug}`, error);
      codeLoading?.classList.add('hidden');
      codeError?.classList.remove('hidden');
      
      // DINE-IN에서는 절대 자동 재오픈 하지 않음
      SessionStore.removeSession(slug);
      Tokens.clearSession(); // 레거시 호환성
      
      // 에러 메시지 개선
      if (codeError) {
        codeError.innerHTML = `
          <div class="error-content">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${error?.message || '알 수 없는 오류가 발생했습니다.'}</span>
          </div>
        `;
      }
    } finally {
      isProcessing = false;
      verifyBtn.disabled = false;
    }
  });

  // -----------------------------
  // 초기 주문유형 결정 → 화면 진입 → API 로드
  // -----------------------------
  (async () => {
    try {
      const cfgSet = new Set(window.RUNTIME?.TAKEOUT_SLUGS || []);
      if (cfgSet.size > 0) {
        orderType = (slug && cfgSet.has(slug)) ? 'takeout' : 'dine-in';
      } else {
        orderType = await resolveOrderTypeBySlug(slug);
      }
      discountRate = (orderType === 'takeout') ? 0.1 : 0;

      goToMenuStep(orderType);

      // 인기/메뉴 병렬 로드 (한쪽 실패해도 나머지 진행)
      const [topRes, menuRes] = await Promise.allSettled([ getTopMenu(3), getPublicMenu() ]);

      // 인기 메뉴 TOP3 포디움
      if (topRes.status === 'fulfilled') {
        const topMenus = topRes.value || [];
        updateTop3Podium(topMenus);
      }

      // 전체 메뉴 데이터 저장 및 초기 탭 로드
      if (menuRes.status === 'fulfilled') {
        const menuData = menuRes.value || [];
        allMenus = categorizeMenus(menuData);
        loadMenusByCategory('set'); // 기본적으로 세트메뉴 탭 표시
        setupMenuTabEvents();
        setupCartEvents();
      }

      console.log('새로운 탭 기반 주문 시스템 초기화 완료');
    } catch (e) {
      console.error('초기화 중 오류:', e);
    }
  })();

  // -----------------------------
  // 새로운 탭 기반 메뉴 시스템 함수들
  // -----------------------------

  // 인기 메뉴 컴포넌트 업데이트
  function updateTop3Podium(topMenus) {
    const popularItems = document.querySelectorAll('.popular-item');
    const ranks = ['first-rank', 'second-rank', 'third-rank'];
    
    topMenus.forEach((menu, index) => {
      if (index < 3) {
        const popularItem = document.querySelector(`.${ranks[index]}`);
        if (popularItem) {
          const nameElement = popularItem.querySelector('.popular-name');
          const countElement = popularItem.querySelector('.popular-count');
          
          if (nameElement) nameElement.textContent = menu.name || '데이터 없음';
          if (countElement) countElement.textContent = `${menu.qty_sold || 0}건 주문`;
        }
      }
    });
    
    // 데이터가 없을 경우 기본값 설정
    if (topMenus.length === 0) {
      popularItems.forEach((item, index) => {
        const nameElement = item.querySelector('.popular-name');
        const countElement = item.querySelector('.popular-count');
        
        if (nameElement) nameElement.textContent = '데이터 로딩 중...';
        if (countElement) countElement.textContent = '-';
      });
    }
  }

  // 메뉴를 카테고리별로 분류
  function categorizeMenus(menuData) {
    const categories = {
      set: [],
      main: [],
      side: [],
      drink: []
    };

    // 한화e글스-ㅔ트 세트메뉴 추가 (회장이 한화 팬이라.. 절대적 권력에 의하여 세트 이름이 선정되었습니다...)
    const hanwhaSet = {
      id: 'hanwha-set-001',
      name: '한화e글스-ㅔ트',
      description: '(회장이 한화 팬이라.. 절대적 권력에 의하여 세트 이름이 선정되었습니다...)',
      price: 149000,
      image_url: '/images/grape-flavor-logos.png',
      category: 'set'
    };
    categories.set.push(hanwhaSet);

    menuData.forEach(menu => {
      // 메뉴 이름이나 태그를 기반으로 카테고리 분류
      const name = menu.name.toLowerCase();
      
      if (name.includes('세트') || name.includes('set') || menu.price >= 15000) {
        categories.set.push(menu);
      } else if (name.includes('콜라') || name.includes('사이다') || name.includes('물') || name.includes('칵테일') || name.includes('화채')) {
        categories.drink.push(menu);
      } else if (name.includes('밥') || name.includes('면') || menu.price <= 8000) {
        categories.side.push(menu);
      } else {
        categories.main.push(menu);
      }
    });

    return categories;
  }

  // 카테고리별 메뉴 로드 (수량 유지)
  function loadMenusByCategory(category) {
    currentCategory = category;
    const menuList = document.getElementById('menu-list');
    const menus = allMenus[category] || [];

    if (!menuList) return;

    if (menus.length === 0) {
      menuList.innerHTML = `
        <div style="text-align: center; padding: 3rem; color: #666;">
          <i class="fas fa-utensils" style="font-size: 3rem; margin-bottom: 1rem; color: #ddd;"></i>
          <p>이 카테고리에 메뉴가 없습니다.</p>
        </div>
      `;
      return;
    }

    menuList.innerHTML = menus.map(menu => createMenuItemHTML(menu)).join('');
    
    // 기존 장바구니 수량 복원
    restoreQuantitiesFromCart();
    setupMenuItemEvents();
  }

  // 장바구니에서 수량 복원
  function restoreQuantitiesFromCart() {
    Object.keys(cart).forEach(menuId => {
      const menuItem = document.querySelector(`[data-menu-id="${menuId}"]`);
      if (menuItem) {
        const quantitySpan = menuItem.querySelector('.quantity');
        if (quantitySpan) {
          quantitySpan.textContent = cart[menuId].quantity;
        }
      }
    });
  }

  // 메뉴 아이템 HTML 생성
  function createMenuItemHTML(menu) {
    const categoryIcons = {
      set: 'fas fa-utensils',
      main: 'fas fa-drumstick-bite',
      side: 'fas fa-pepper-hot',
      drink: 'fas fa-glass-cheers'
    };

    const icon = categoryIcons[currentCategory] || 'fas fa-utensils';
    
    // 메뉴 설명 생성 (기본값 설정)
    const description = menu.description || `맛있는 ${menu.name}입니다. 신선한 재료로 만든 인기 메뉴입니다.`;
    
    // 메뉴 이미지 처리
    const imageHtml = menu.image_url 
      ? `<img src="${menu.image_url}" alt="${menu.name}" class="menu-image" style="width: 100px; height: 100px; object-fit: cover; border-radius: 12px;">`
      : `<div class="menu-img-placeholder"><i class="${icon}"></i></div>`;
    
    return `
      <div class="menu-item" data-menu-id="${menu.id}" data-price="${menu.price}">
        <div class="menu-image">
          ${imageHtml}
        </div>
        <div class="menu-content">
          <div class="menu-info">
            <h3 class="menu-name">${menu.name}</h3>
            <p class="menu-description">${description}</p>
            <p class="menu-price" style="display: none;">${menu.price.toLocaleString()}원</p>
          </div>
          <div class="menu-quantity">
            <button class="quantity-btn minus-btn" data-action="minus">
              <i class="fas fa-minus"></i>
            </button>
            <span class="quantity">0</span>
            <button class="quantity-btn plus-btn" data-action="plus">
              <i class="fas fa-plus"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // 메뉴 탭 이벤트 설정
  function setupMenuTabEvents() {
    const menuTabs = document.querySelectorAll('.menu-tab');
    
    menuTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // 활성 탭 변경
        menuTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // 해당 카테고리 메뉴 로드
        const category = tab.dataset.category;
        loadMenusByCategory(category);
      });
    });
  }

  // 메뉴 아이템 이벤트 설정 (이벤트 위임 방식으로 중복 방지)
  function setupMenuItemEvents() {
    const menuList = document.getElementById('menu-list');
    if (!menuList) return;
    
    // 기존 이벤트 리스너 제거
    const newMenuList = menuList.cloneNode(true);
    menuList.parentNode.replaceChild(newMenuList, menuList);
    
    // 이벤트 위임으로 단일 이벤트 리스너 등록
    newMenuList.addEventListener('click', (e) => {
      const btn = e.target.closest('.quantity-btn');
      if (!btn) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const action = btn.dataset.action;
      const menuItem = btn.closest('.menu-item');
      const menuId = menuItem.dataset.menuId;
      const price = parseInt(menuItem.dataset.price);
      const menuName = menuItem.querySelector('.menu-name').textContent;
      const quantitySpan = menuItem.querySelector('.quantity');
      
      let currentQuantity = parseInt(quantitySpan.textContent) || 0;
      
      if (action === 'plus') {
        currentQuantity++;
        updateCart(menuId, menuName, price, currentQuantity);
      } else if (action === 'minus' && currentQuantity > 0) {
        currentQuantity--;
        if (currentQuantity === 0) {
          removeFromCart(menuId);
        } else {
          updateCart(menuId, menuName, price, currentQuantity);
        }
      }
      
      quantitySpan.textContent = currentQuantity;
    });
  }

  // 장바구니 업데이트
  function updateCart(menuId, menuName, price, quantity) {
    cart[menuId] = {
      name: menuName,
      price: price,
      quantity: quantity
    };
    
    renderCart();
    updateTotalAmount();
  }

  // 장바구니에서 제거
  function removeFromCart(menuId) {
    delete cart[menuId];
    renderCart();
    updateTotalAmount();
  }

  // 장바구니 렌더링
  function renderCart() {
    const cartItems = document.getElementById('cart-items');
    if (!cartItems) return;

    const cartKeys = Object.keys(cart);
    
    if (cartKeys.length === 0) {
      cartItems.innerHTML = `
        <div class="empty-cart">
          <i class="fas fa-shopping-cart"></i>
          <p>장바구니가 비어있습니다</p>
        </div>
      `;
      return;
    }

    cartItems.innerHTML = cartKeys.map(menuId => {
      const item = cart[menuId];
      return `
        <div class="cart-item" data-menu-id="${menuId}">
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-quantity">${item.quantity}개</div>
          </div>
          <button class="cart-item-remove" data-menu-id="${menuId}">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
    }).join('');
  }

  // 총 금액 업데이트
  function updateTotalAmount() {
    const totalPriceElement = document.getElementById('total-price');
    const summaryElement = document.getElementById('selected-items-summary');
    
    if (!totalPriceElement || !summaryElement) return;

    let totalAmount = 0;
    const cartKeys = Object.keys(cart);
    
    cartKeys.forEach(menuId => {
      const item = cart[menuId];
      totalAmount += item.price * item.quantity;
    });

    // 포장 주문 할인 적용
    if (orderType === 'takeout') {
      totalAmount = Math.floor(totalAmount * 0.9);
    }

    totalPriceElement.textContent = `${totalAmount.toLocaleString()}원`;
    
    // 선택된 메뉴 요약 (메뉴명만 표시, 가격 숨김)
    if (cartKeys.length === 0) {
      summaryElement.textContent = '선택한 메뉴가 없습니다';
    } else {
      const summary = cartKeys.map(menuId => {
        const item = cart[menuId];
        return `${item.name} × ${item.quantity}`;
      }).join(', ');
      
      summaryElement.innerHTML = `
        <div style="margin-bottom: 0.5rem;">선택한 메뉴:</div>
        <div style="font-size: 0.9em; line-height: 1.4;">${summary}</div>
        ${orderType === 'takeout' ? '<div style="margin-top: 0.5rem; color: #28a745; font-weight: bold;">포장 주문 10% 할인 적용</div>' : ''}
      `;
    }
  }

  // 장바구니 이벤트 설정
  function setupCartEvents() {
    const cartItems = document.getElementById('cart-items');
    
    if (cartItems) {
      cartItems.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.cart-item-remove');
        if (removeBtn) {
          const menuId = removeBtn.dataset.menuId;
          removeFromCart(menuId);
          
          // 해당 메뉴의 수량도 0으로 업데이트
          const menuItem = document.querySelector(`[data-menu-id="${menuId}"]`);
          if (menuItem) {
            const quantitySpan = menuItem.querySelector('.quantity');
            if (quantitySpan) quantitySpan.textContent = '0';
          }
        }
      });
    }
  }

});