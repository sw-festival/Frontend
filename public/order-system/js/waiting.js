// API 기반 주문 조회 함수들 import
import { getUserOrderDetails } from './api-session.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('🕒 대기 페이지 로드 완료');
    // Firebase 초기화 (안전하게)
    let db = null;
    try {
        if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
            firebase.initializeApp(firebaseConfig);
            db = firebase.database();
            console.log('Firebase 초기화 성공');
        } else {
            console.log('Firebase 스크립트가 로드되지 않음');
        }
    } catch (error) {
        console.error('Firebase 초기화 실패:', error);
        console.log('로컬 저장소 모드로 작동');
    }
    
    // URL에서 주문 ID 가져오기
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('orderId');
    
    if (!orderId) {
        document.getElementById('waiting-info').innerHTML = `
            <div class="error-message">
                <h3>❌ 잘못된 접근입니다</h3>
                <p>주문 ID가 없습니다.</p>
                <button onclick="window.location.href='order.html'">다시 주문하기</button>
            </div>
        `;
        return;
    }

    // DOM 요소들
    const waitingInfo = document.getElementById('waiting-info');
    const orderDetails = document.getElementById('order-details');
    const waitingStatus = document.getElementById('waiting-status');
    const waitingNumber = document.getElementById('waiting-number');
    const aheadCount = document.getElementById('ahead-count');
    const orderSummary = document.getElementById('order-summary');
    const refreshBtn = document.getElementById('refresh-btn');
    const backBtn = document.getElementById('back-btn');

    // 버튼 이벤트
    refreshBtn.addEventListener('click', loadWaitingInfo);
    backBtn.addEventListener('click', () => window.location.href = 'order.html');

    // 실시간 대기 순번 정보 로드
    loadWaitingInfo();

    async function loadWaitingInfo() {
        try {
            console.log('📊 주문 정보 로드 시작:', orderId);
            
            // API를 통한 주문 조회 시도
            const response = await getUserOrderDetails(orderId);
            console.log('✅ API 주문 조회 성공:', response);
            
            if (response?.success && response?.data) {
                displayOrderInfoFromAPI(response.data);
                await calculateWaitingPositionFromAPI(orderId);
            } else {
                throw new Error('주문 데이터 없음');
            }
        } catch (apiError) {
            console.warn('⚠️ API 주문 조회 실패:', apiError);
            
            // Firebase 폴백
            if (db) {
                console.log('🔄 Firebase 폴백 시도');
                loadFromFirebase();
            } else {
                console.log('🔄 로컬 저장소 폴백 시도');
                loadFromLocalStorage();
            }
        }
    }

    // API 응답 데이터로 주문 정보 표시
    function displayOrderInfoFromAPI(orderData) {
        console.log('📋 API 주문 정보 표시:', orderData);
        
        // 주문 상태 매핑
        const statusMap = {
            'PENDING': { text: '접수 대기', class: 'pending' },
            'CONFIRMED': { text: '접수 완료', class: 'confirmed' },
            'IN_PROGRESS': { text: '조리 중', class: 'preparing' },
            'READY': { text: '준비 완료', class: 'ready' },
            'COMPLETED': { text: '완료', class: 'completed' },
            'CANCELLED': { text: '취소됨', class: 'cancelled' }
        };
        
        const status = statusMap[orderData.status] || { text: orderData.status, class: 'unknown' };
        
        // 주문 요약 정보 업데이트
        orderSummary.innerHTML = `
            <div class="order-header">
                <h3>주문 #${orderData.id}</h3>
                <span class="order-status ${status.class}">${status.text}</span>
            </div>
            <div class="order-info">
                <p><strong>주문자:</strong> ${orderData.payer_name}</p>
                <p><strong>테이블:</strong> ${orderData.table?.label || 'N/A'}</p>
                <p><strong>주문 시간:</strong> ${new Date(orderData.created_at).toLocaleString()}</p>
                <p><strong>총 금액:</strong> ${orderData.amounts?.total?.toLocaleString() || 0}원</p>
            </div>
        `;

        // 주문 항목 표시
        if (orderData.items && orderData.items.length > 0) {
            const itemsHTML = orderData.items.map(item => `
                <div class="order-item">
                    <span class="item-name">${item.name}</span>
                    <span class="item-qty">x${item.qty}</span>
                    <span class="item-price">${item.line_total?.toLocaleString() || 0}원</span>
                </div>
            `).join('');
            
            orderSummary.innerHTML += `
                <div class="order-items">
                    <h4>주문 내역</h4>
                    ${itemsHTML}
                </div>
            `;
        }
        
        // 대기 상태에 따른 메시지 표시
        displayWaitingMessage(orderData.status);
    }

    // API 기반 대기 순번 계산
    async function calculateWaitingPositionFromAPI(currentOrderId) {
        try {
            // 활성 주문 목록을 가져와서 대기 순번 계산
            // 실제로는 별도 API가 필요하지만, 여기서는 간단히 처리
            console.log('📊 대기 순번 계산 중...');
            
            // 임시로 랜덤 대기 순번 표시 (실제로는 서버에서 계산)
            const waitingPosition = Math.floor(Math.random() * 5) + 1;
            const estimatedTime = waitingPosition * 10; // 대략적인 예상 시간
            
            waitingNumber.textContent = waitingPosition;
            aheadCount.textContent = Math.max(0, waitingPosition - 1);
            
            document.getElementById('estimated-time').textContent = `약 ${estimatedTime}분`;
            
        } catch (error) {
            console.error('대기 순번 계산 실패:', error);
            waitingNumber.textContent = '?';
            aheadCount.textContent = '?';
        }
    }

    // 주문 상태별 대기 메시지 표시
    function displayWaitingMessage(status) {
        let message = '';
        let icon = '⏳';
        
        switch (status) {
            case 'PENDING':
                message = '주문이 접수 대기 중입니다.';
                icon = '⏳';
                break;
            case 'CONFIRMED':
                message = '주문이 접수되어 조리 대기 중입니다.';
                icon = '👨‍🍳';
                break;
            case 'IN_PROGRESS':
                message = '주문하신 음식을 조리 중입니다.';
                icon = '🔥';
                break;
            case 'READY':
                message = '주문하신 음식이 준비되었습니다!';
                icon = '✅';
                break;
            case 'COMPLETED':
                message = '주문이 완료되었습니다.';
                icon = '🎉';
                break;
            case 'CANCELLED':
                message = '주문이 취소되었습니다.';
                icon = '❌';
                break;
            default:
                message = '주문 상태를 확인 중입니다.';
                icon = '❓';
        }
        
        waitingStatus.innerHTML = `
            <div class="status-message">
                <span class="status-icon">${icon}</span>
                <p>${message}</p>
            </div>
        `;
    }
    
    function loadFromFirebase() {
        const ordersRef = db.ref('orders');
        
        ordersRef.once('value', (snapshot) => {
            const orders = snapshot.val();
            
            if (!orders || !orders[orderId]) {
                showErrorMessage();
                return;
            }

            const currentOrder = orders[orderId];
            displayOrderInfo(currentOrder);
            calculateWaitingPosition(orders, orderId, currentOrder);
            
            // 실시간 업데이트 설정
            setupRealtimeUpdates(orderId);
        });
    }
    
    function loadFromLocalStorage() {
        try {
            const orders = JSON.parse(localStorage.getItem('memoryOrders') || '[]');
            const currentOrder = orders.find(order => order.id === orderId);
            
            if (!currentOrder) {
                showErrorMessage();
                return;
            }
            
            console.log('로컬에서 주문 정보 로드:', currentOrder);
            displayOrderInfo(currentOrder);
            calculateWaitingPositionLocal(orders, orderId, currentOrder);
            
            // 로컬에서는 실시간 업데이트 대신 새로고침 버튼 활성화
            setupLocalRefresh();
            
        } catch (error) {
            console.error('로컬 저장소 읽기 오류:', error);
            showErrorMessage();
        }
    }
    
    function showErrorMessage() {
        waitingInfo.innerHTML = `
            <div class="error-message">
                <h3>❌ 주문을 찾을 수 없습니다</h3>
                <p>주문 정보가 존재하지 않습니다.</p>
                <button onclick="window.location.href='order.html'">다시 주문하기</button>
            </div>
        `;
    }

    function displayOrderInfo(orderData) {
        // 주문 내역 표시
        let itemsHtml = '<ul>';
        for (const itemName in orderData.items) {
            const item = orderData.items[itemName];
            itemsHtml += `<li>${itemName} x${item.quantity}</li>`;
        }
        itemsHtml += '</ul>';

        orderSummary.innerHTML = `
            <div class="order-card">
                <p><strong>테이블:</strong> #${orderData.tableNumber}</p>
                <p><strong>입금자명:</strong> ${orderData.customerName}</p>
                <p><strong>주문 메뉴:</strong></p>
                ${itemsHtml}
                <p><strong>총 금액:</strong> ${orderData.totalPrice.toLocaleString()}원</p>
                <p><strong>주문 시간:</strong> ${new Date(orderData.timestamp).toLocaleString()}</p>
            </div>
        `;

        // 상태 표시
        updateStatusIndicator(orderData.status);
        
        // 섹션 표시
        waitingInfo.classList.add('hidden');
        orderDetails.classList.remove('hidden');
        waitingStatus.classList.remove('hidden');
    }

    function calculateWaitingPosition(allOrders, currentOrderId, currentOrder) {
        // 완료되지 않은 주문들만 필터링하고 시간순 정렬
        const pendingOrders = Object.entries(allOrders)
            .filter(([id, order]) => order.status !== 'Order Complete')
            .sort(([, a], [, b]) => a.timestamp - b.timestamp);

        // 현재 주문의 위치 찾기
        const currentPosition = pendingOrders.findIndex(([id]) => id === currentOrderId);
        
        if (currentPosition === -1) {
            // 주문이 완료된 경우
            waitingNumber.textContent = '0';
            aheadCount.textContent = '0';
            waitingNumber.parentElement.querySelector('.waiting-subtitle').textContent = '주문이 완료되었습니다!';
            return;
        }

        const waitingPos = currentPosition + 1;
        const aheadTeams = currentPosition;

        waitingNumber.textContent = waitingPos;
        aheadCount.textContent = aheadTeams;

        // 대기 순번에 따른 메시지
        const subtitle = waitingNumber.parentElement.querySelector('.waiting-subtitle');
        if (aheadTeams === 0) {
            subtitle.textContent = '다음 순서입니다! 곧 완료됩니다 🎉';
            subtitle.style.color = '#28a745';
        } else {
            subtitle.textContent = `앞에 ${aheadTeams}팀이 기다리고 있습니다`;
            subtitle.style.color = '#ffa502';
        }
    }

    function updateStatusIndicator(status) {
        // 모든 상태 아이템 초기화
        document.querySelectorAll('.status-item').forEach(item => {
            item.classList.remove('active', 'completed');
        });

        // 현재 상태까지 활성화
        const statusOrder = ['Payment Pending', 'Order Received', 'Payment Confirmed', 'Preparing', 'Order Complete'];
        const currentIndex = statusOrder.indexOf(status);

        statusOrder.forEach((s, index) => {
            const statusItem = document.getElementById(`status-${s.toLowerCase().replace(' ', '-')}`);
            if (statusItem) {
                if (index < currentIndex) {
                    statusItem.classList.add('completed');
                } else if (index === currentIndex) {
                    statusItem.classList.add('active');
                }
            }
        });
    }

    function setupRealtimeUpdates(orderId) {
        // 실시간으로 주문 상태 및 대기열 업데이트
        const ordersRef = db.ref('orders');
        
        ordersRef.on('value', (snapshot) => {
            const orders = snapshot.val();
            
            if (orders && orders[orderId]) {
                const currentOrder = orders[orderId];
                updateStatusIndicator(currentOrder.status);
                calculateWaitingPosition(orders, orderId, currentOrder);
                
                // 완료된 경우 축하 메시지
                if (currentOrder.status === 'Order Complete') {
                    showCompletionMessage();
                }
            }
        });
    }

    function showCompletionMessage() {
        const completionHtml = `
            <div class="completion-message">
                <div class="celebration">🎉 주문 완료! 🎉</div>
                <p>맛있게 드세요!</p>
                <p>MEMORY 주점을 이용해 주셔서 감사합니다.</p>
            </div>
        `;
        
        // 기존 대기 정보를 완료 메시지로 교체
        const waitingContainer = document.querySelector('.waiting-number-container');
        waitingContainer.innerHTML = completionHtml;
    }
    
    // 로컬 저장소용 대기 순번 계산
    function calculateWaitingPositionLocal(allOrders, currentOrderId, currentOrder) {
        // 완료되지 않은 주문들만 필터링하고 시간순 정렬
        const pendingOrders = allOrders
            .filter(order => order.status !== 'Order Complete')
            .sort((a, b) => a.timestamp - b.timestamp);

        // 현재 주문의 위치 찾기
        const currentPosition = pendingOrders.findIndex(order => order.id === currentOrderId);
        
        if (currentPosition === -1) {
            // 주문이 완료된 경우
            waitingNumber.textContent = '0';
            aheadCount.textContent = '0';
            waitingNumber.parentElement.querySelector('.waiting-subtitle').textContent = '주문이 완료되었습니다!';
            return;
        }

        const waitingPos = currentPosition + 1;
        const aheadTeams = currentPosition;

        waitingNumber.textContent = waitingPos;
        aheadCount.textContent = aheadTeams;

        // 대기 순번에 따른 메시지
        const subtitle = waitingNumber.parentElement.querySelector('.waiting-subtitle');
        if (aheadTeams === 0) {
            subtitle.textContent = '다음 순서입니다! 곧 완료됩니다 🎉';
            subtitle.style.color = '#28a745';
        } else {
            subtitle.textContent = `앞에 ${aheadTeams}팀이 기다리고 있습니다`;
            subtitle.style.color = '#ffa502';
        }
    }
    
    // 로컬 저장소용 새로고침 설정
    function setupLocalRefresh() {
        console.log('로컬 모드: 수동 새로고침으로 상태 확인 가능');
        
        // 새로고침 버튼에 추가 안내
        refreshBtn.textContent = '🔄 새로고침 (상태 확인)';
        refreshBtn.style.background = 'linear-gradient(135deg, #ffa502, #ff6348)';
    }
  }
);