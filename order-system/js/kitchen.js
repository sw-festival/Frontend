document.addEventListener('DOMContentLoaded', () => {
    console.log('주방 디스플레이 시작');
    
    // Firebase 초기화
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const ordersRef = db.ref('orders');
    
    // DOM 요소
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
    
    // 실시간 시계 업데이트
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        if (kitchenClock) {
            kitchenClock.textContent = timeString;
        }
    }
    
    // 매초마다 시계 업데이트
    setInterval(updateClock, 1000);
    updateClock(); // 즉시 실행
    
    // 주문 상태에 따른 분류
    function categorizeOrders(orders) {
        const categories = {
            urgent: [],
            normal: [],
            preparing: []
        };
        
        const now = new Date().getTime();
        const URGENT_THRESHOLD = 15 * 60 * 1000; // 15분
        
        Object.entries(orders).forEach(([orderId, order]) => {
            // 입금 확인된 주문만 주방에서 처리
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
        
        // 시간순으로 정렬 (오래된 순)
        categories.urgent.sort((a, b) => b.timeDiff - a.timeDiff);
        categories.normal.sort((a, b) => b.timeDiff - a.timeDiff);
        categories.preparing.sort((a, b) => b.timeDiff - a.timeDiff);
        
        return categories;
    }
    
    // 주문 카드 생성
    function createKitchenOrderCard(orderId, orderData, timeDiff) {
        const card = document.createElement('div');
        const isUrgent = timeDiff > 15 * 60 * 1000;
        const isPreparing = orderData.status === 'Preparing';
        
        card.className = `kitchen-order-card ${isUrgent ? 'urgent' : ''} ${isPreparing ? 'preparing' : ''}`;
        card.onclick = () => toggleOrderStatus(orderId, orderData);
        
        // 경과 시간 계산
        const minutes = Math.floor(timeDiff / (60 * 1000));
        const timeText = minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 전`;
        
        // 테이블 정보
        const tableInfo = orderData.orderType === 'takeout' ? '📦 포장' : `🍽️ 테이블 #${orderData.tableNumber}`;
        
        // 메뉴 리스트 생성
        let menuListHtml = '';
        Object.entries(orderData.items).forEach(([menuName, item]) => {
            const menuStatus = orderData.menuStatus?.[menuName] || 'pending';
            menuListHtml += `
                <li class="menu-item">
                    <span class="menu-name">${menuName}</span>
                    <span class="menu-quantity">${item.quantity}</span>
                </li>
            `;
        });
        
        card.innerHTML = `
            <div class="order-header">
                <span class="order-id">${orderId.slice(-6).toUpperCase()}</span>
                <span class="order-time ${isUrgent ? 'urgent' : ''}">${timeText}</span>
            </div>
            <div class="table-info">${tableInfo}</div>
            <div class="customer-name">👤 ${orderData.customerName}</div>
            <ul class="menu-list">
                ${menuListHtml}
            </ul>
            <div class="menu-status-indicator">
                ${Object.keys(orderData.items).map(() => 
                    '<span class="status-dot"></span>'
                ).join('')}
            </div>
        `;
        
        return card;
    }
    
    // 주문 상태 토글 (주방에서 클릭시 준비중/완료 전환)
    function toggleOrderStatus(orderId, orderData) {
        let newStatus;
        if (orderData.status === 'Payment Confirmed') {
            newStatus = 'Preparing';
            playKitchenSound('start-cooking');
        } else if (orderData.status === 'Preparing') {
            newStatus = 'Order Complete';
            playKitchenSound('order-ready');
        } else {
            return; // 다른 상태는 처리하지 않음
        }
        
        db.ref('orders/' + orderId).update({ status: newStatus })
            .then(() => {
                console.log(`주문 ${orderId} 상태를 ${newStatus}로 변경`);
            })
            .catch(error => {
                console.error('상태 업데이트 실패:', error);
            });
    }
    
    // 주방용 사운드 재생
    function playKitchenSound(type) {
        if (!soundEnabled) return;
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            switch (type) {
                case 'new-order':
                    // 새 주문: 따뜻한 톤 2번
                    playBeep(audioContext, 400, 300);
                    setTimeout(() => playBeep(audioContext, 600, 300), 400);
                    break;
                    
                case 'urgent-order':
                    // 긴급 주문: 경고음 3번
                    playBeep(audioContext, 800, 200);
                    setTimeout(() => playBeep(audioContext, 1000, 200), 300);
                    setTimeout(() => playBeep(audioContext, 800, 200), 600);
                    break;
                    
                case 'start-cooking':
                    // 요리 시작: 확인음
                    playBeep(audioContext, 600, 400);
                    break;
                    
                case 'order-ready':
                    // 주문 완료: 성공음
                    playBeep(audioContext, 500, 200);
                    setTimeout(() => playBeep(audioContext, 700, 200), 200);
                    setTimeout(() => playBeep(audioContext, 900, 400), 400);
                    break;
            }
        } catch (error) {
            console.warn('주방 사운드 재생 실패:', error);
        }
    }
    
    // 비프음 생성
    function playBeep(audioContext, frequency, duration) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration / 1000);
    }
    
    // 새 주문 감지
    function checkForNewOrders(currentOrders) {
        if (isFirstLoad) {
            isFirstLoad = false;
            previousOrdersCache = { ...currentOrders };
            return;
        }
        
        const currentOrderIds = Object.keys(currentOrders);
        const previousOrderIds = Object.keys(previousOrdersCache);
        
        // 새로운 주문 감지
        const newOrderIds = currentOrderIds.filter(id => !previousOrderIds.includes(id));
        
        newOrderIds.forEach(orderId => {
            const order = currentOrders[orderId];
            if (order.status === 'Payment Confirmed') {
                const now = new Date().getTime();
                const orderTime = new Date(order.timestamp).getTime();
                const timeDiff = now - orderTime;
                
                if (timeDiff > 15 * 60 * 1000) {
                    playKitchenSound('urgent-order');
                } else {
                    playKitchenSound('new-order');
                }
            }
        });
        
        previousOrdersCache = { ...currentOrders };
    }
    
    // 주방 디스플레이 업데이트
    function updateKitchenDisplay(orders) {
        if (!orders) {
            // 주문이 없을 때
            pendingCountEl.textContent = '0';
            preparingCountEl.textContent = '0';
            urgentCountEl.textContent = '0';
            
            urgentOrdersList.innerHTML = '<div class="empty-state urgent">🎉 긴급 주문이 없습니다</div>';
            normalOrdersList.innerHTML = '<div class="empty-state normal">😊 새로운 주문을 기다리는 중...</div>';
            preparingOrdersList.innerHTML = '<div class="empty-state preparing">✨ 준비중인 주문이 없습니다</div>';
            return;
        }
        
        // 새 주문 감지 및 알림
        checkForNewOrders(orders);
        
        // 주문 분류
        const categories = categorizeOrders(orders);
        
        // 통계 업데이트
        pendingCountEl.textContent = categories.normal.length.toString();
        preparingCountEl.textContent = categories.preparing.length.toString();
        urgentCountEl.textContent = categories.urgent.length.toString();
        
        // 긴급 주문 표시
        if (categories.urgent.length > 0) {
            urgentOrdersList.innerHTML = '';
            categories.urgent.forEach(order => {
                const card = createKitchenOrderCard(order.id, order.data, order.timeDiff);
                urgentOrdersList.appendChild(card);
            });
        } else {
            urgentOrdersList.innerHTML = '<div class="empty-state urgent">🎉 긴급 주문이 없습니다</div>';
        }
        
        // 일반 주문 표시
        if (categories.normal.length > 0) {
            normalOrdersList.innerHTML = '';
            categories.normal.forEach(order => {
                const card = createKitchenOrderCard(order.id, order.data, order.timeDiff);
                normalOrdersList.appendChild(card);
            });
        } else {
            normalOrdersList.innerHTML = '<div class="empty-state normal">😊 새로운 주문을 기다리는 중...</div>';
        }
        
        // 준비중 주문 표시
        if (categories.preparing.length > 0) {
            preparingOrdersList.innerHTML = '';
            categories.preparing.forEach(order => {
                const card = createKitchenOrderCard(order.id, order.data, order.timeDiff);
                preparingOrdersList.appendChild(card);
            });
        } else {
            preparingOrdersList.innerHTML = '<div class="empty-state preparing">✨ 준비중인 주문이 없습니다</div>';
        }
    }
    
    // Firebase 실시간 데이터 수신
    ordersRef.on('value', (snapshot) => {
        const orders = snapshot.val();
        updateKitchenDisplay(orders);
    });
    
    // 새로고침 버튼
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            location.reload();
        });
    }
    
    // 전체화면 버튼
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.log('전체화면 실패:', err);
                });
            } else {
                document.exitFullscreen();
            }
        });
    }
    
    // 사운드 토글 버튼
    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            soundToggleBtn.textContent = soundEnabled ? '🔔 알림음' : '🔕 알림음';
            soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
            
            // 설정 저장
            localStorage.setItem('kitchen-sound-enabled', soundEnabled);
            
            // 확인 사운드
            if (soundEnabled) {
                playKitchenSound('start-cooking');
            }
        });
        
        // 저장된 사운드 설정 불러오기
        const savedSoundEnabled = localStorage.getItem('kitchen-sound-enabled');
        if (savedSoundEnabled !== null) {
            soundEnabled = savedSoundEnabled === 'true';
            soundToggleBtn.textContent = soundEnabled ? '🔔 알림음' : '🔕 알림음';
            soundToggleBtn.style.opacity = soundEnabled ? '1' : '0.6';
        }
    }
    
    // 전체화면 변경 감지
    document.addEventListener('fullscreenchange', () => {
        document.body.classList.toggle('fullscreen', !!document.fullscreenElement);
    });
    
    console.log('✅ 주방 디스플레이 초기화 완료');
});