const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 정적 파일 서빙: localhost:3000/order-system/index.html 접근 가능하게 설정
app.use('/order-system', express.static(path.join(__dirname, 'public/order-system')));

// 간단한 메모리 저장소
let orders = [];
let sessions = [];

// 헬스체크 엔드포인트 (테스트용)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'API 서버가 정상 작동 중입니다.' });
});

// 세션 열기 엔드포인트
app.post('/sessions/open-by-slug', (req, res) => {
    const { slug, code } = req.body;
    
    if (code !== 'test123') {
        return res.status(401).json({ 
            success: false, 
            message: '잘못된 세션 코드입니다.' 
        });
    }
    
    // 간단한 테이블 정보 생성
    const sessionData = {
        success: true,
        data: {
            session_token: `session_${Date.now()}`,
            table: {
                id: 1,
                number: Math.floor(Math.random() * 20) + 1,
                name: `테이블 ${Math.floor(Math.random() * 20) + 1}`
            }
        }
    };
    
    res.json(sessionData);
});

// 주문 생성 엔드포인트
app.post('/orders', (req, res) => {
    const { order_type, payer_name, items } = req.body;
    
    if (!payer_name || !items || items.length === 0) {
        return res.status(400).json({
            success: false,
            message: '필수 정보가 누락되었습니다.'
        });
    }
    
    // 주문 ID 생성
    const orderId = `order_${Date.now()}`;
    
    // 주문 데이터 생성
    const order = {
        id: orderId,
        order_type,
        payer_name,
        items,
        status: 'pending',
        created_at: new Date().toISOString(),
        total_amount: items.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0)
    };
    
    orders.push(order);
    
    console.log('새 주문 생성:', order);
    
    res.json({
        success: true,
        data: {
            order_id: orderId,
            message: '주문이 성공적으로 생성되었습니다.'
        }
    });
});

// 주문 조회 엔드포인트
app.get('/orders/:orderId', (req, res) => {
    const { orderId } = req.params;
    
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
        return res.status(404).json({
            success: false,
            message: '주문을 찾을 수 없습니다.'
        });
    }
    
    res.json({
        success: true,
        data: {
            id: order.id,
            payer_name: order.payer_name,
            order_type: order.order_type,
            items: order.items,
            status: order.status,
            amounts: {
                total: order.total_amount
            },
            created_at: order.created_at
        }
    });
});

// 모든 주문 조회 (관리자용)
app.get('/orders', (req, res) => {
    res.json({
        success: true,
        data: orders
    });
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 테스트 API 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log(`📋 사용 가능한 엔드포인트:`);
    console.log(`   GET  /health - 서버 상태 확인`);
    console.log(`   POST /sessions/open-by-slug - 세션 열기`);
    console.log(`   POST /orders - 주문 생성`);
    console.log(`   GET  /orders/:id - 주문 조회`);
    console.log(`   GET  /orders - 모든 주문 조회`);
});

// 에러 핸들링
app.use((err, req, res, next) => {
    console.error('서버 에러:', err);
    res.status(500).json({
        success: false,
        message: '서버 내부 오류가 발생했습니다.'
    });
});
