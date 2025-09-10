// 제품 카탈로그 (product_id 기반)
const PRODUCTS = {
  1:  { name: 'SSG 문학철판구이(400g)', price: 25900 },
  2:  { name: 'NC 빙하기공룡고기(400g)', price: 19900 },
  3:  { name: 'KIA 호랑이 생고기',       price: 21900 },
  4:  { name: 'LG라면',                 price: 5900  },
  5:  { name: '라팍 김치말이국수',       price: 7900  },
  6:  { name: '두산 B볶음s',            price: 8900  },
  7:  { name: '키움쫄?쫄면',            price: 5900  },
  8:  { name: '롯데 자이언츠 화채',      price: 6900  },
  9:  { name: 'KT랍찜',                 price: 3900  }, 
  10: { name: '후리카케크봉밥',          price: 2500  },
  11: { name: '포도맛 칵테일',           price: 3500  },
  12: { name: '자몽맛 칵테일',           price: 3500  },
  13: { name: '소다맛 칵테일',           price: 3500  },
  14: { name: '제로콜라',                price: 3000  },
  15: { name: '사이다',                  price: 3000  },
  16: { name: '물',                      price: 2000  },
};

// product_id로 가격을 찾는 테이블
const PRICE_TABLE = Object.fromEntries(
  Object.entries(PRODUCTS).map(([id, p]) => [Number(id), p.price])
);

const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;
const SECRET = 'dev-secret';
const ADMIN_PIN = '2025';

// 미들웨어 설정
app.use(cors());
app.use(express.json());

app.use((err, req, res, next) => {
  console.error('[UNCAUGHT ERROR]', err);
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

// 정적 파일 서빙: localhost:3000/order-system/index.html 접근 가능하게 설정
app.use('/order-system', express.static(path.join(__dirname, 'public/order-system')));

// 간단한 메모리 저장소
let orders = [];
let sessions = [];
let tables = [];   // { id, label, slug, is_active }

// 유틸
function readSessionToken(req) {
  const h = req.get('Authorization') || '';
  const byAuth = h.startsWith('Session ') ? h.slice('Session '.length).trim() : null;
  const byHeader = req.get('x-session-token') || null;
  return byAuth || byHeader || null;
}

function nowISO() { return new Date().toISOString(); }

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

// ===== Admin APIs =====
app.post('/admin/login', (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ success:false, message:'Missing PIN' });
  if (pin !== ADMIN_PIN) return res.status(401).json({ success:false, message:'Invalid PIN' });
  const token = jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '12h' });
  res.json({ success:true, message:'Login successful', token });
});

app.post('/admin/tables/ensure', (req, res) => {
  const auth = (req.get('Authorization') || '').split(' ')[1];
  try { jwt.verify(auth, SECRET); } catch {
    return res.status(401).json({ success:false, message:'Unauthorized' });
  }
  const { label, active } = req.body || {};
  if (!label) return res.status(400).json({ success:false, message:'label required' });

  let created = false;
  let table = tables.find(t => t.label === label);
  if (!table) {
    const slug = Math.random().toString(36).slice(2, 8);
    table = { id: tables.length + 1, label, slug, is_active: active !== false };
    tables.push(table);
    created = true;
  } else {
    if (typeof active === 'boolean') table.is_active = active;
  }

  res.status(created ? 201 : 200).json({
    success: true,
    message: created ? 'Created' : 'OK',
    data: {
      table,
      qr: { slugUrl: `http://localhost:3000/order-system/order.html?slug=${table.slug}` },
      created
    }
  });
});

// ===== Public APIs =====
// 세션 열기
app.post('/sessions/open-by-slug', (req, res) => {
  const { slug, code } = req.body || {};
  if (!slug || !code) return res.status(400).json({ success:false, message:'Missing slug/code' });
  
  // 글로벌 코드 확인 (실제로는 환경변수에서 가져와야 함)
  const globalCode = 'test123'; // SESSION_OPEN_CODE
  if (code !== globalCode) return res.status(422).json({ success:false, message:'Invalid code' });

  // 기존 세션 만료 처리
  sessions.forEach(session => {
    if (session.slug === slug && session.status !== 'expired') {
      session.status = 'expired';
      session.expired_at = nowISO();
    }
  });

  // 새 세션 생성
  const sessionId = sessions.length + 1;
  const token = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const newSession = {
    id: sessionId,
    token,
    slug,
    status: 'active',
    created_at: nowISO(),
    table: { id: sessionId, label: `A-${Math.floor(Math.random() * 20) + 1}`, slug, is_active: true }
  };
  
  sessions.push(newSession);

  res.json({
    success: true,
    message: 'Session opened successfully',
    data: {
      session_token: token,
      session_id: sessionId,
      table: newSession.table,
      abs_ttl_min: 120,
      idle_ttl_min: 30
    }
  });
});

// 주문 생성 (수정본)
app.post('/orders', (req, res) => {
  try {
    // 1) 인증
    const token = readSessionToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // 2) 바디 파싱 & 1차 검증
    const { order_type, payer_name, items } = req.body || {};

    if (!['DINE_IN', 'TAKEOUT'].includes(order_type)) {
      return res.status(400).json({ success: false, message: 'invalid order_type' });
    }
    if (!payer_name || typeof payer_name !== 'string' || payer_name.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'payer_name required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items required' });
    }

    // 3) 품목 검증 + 가격 계산
    let subtotal = 0;
    const normalized = [];

    for (const it of items) {
      const pid = it?.product_id;
      const qty = Number(it?.quantity ?? 0);

      if (!Number.isFinite(pid) || PRICE_TABLE[pid] === undefined) {
        return res.status(400).json({ success: false, message: `unknown product_id: ${pid}` });
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ success: false, message: `invalid quantity for product_id ${pid}` });
      }

      const unit = PRICE_TABLE[pid];
      const line = unit * qty;
      subtotal += line;

      normalized.push({
        product_id: pid,
        qty,
        unit_price: unit,
        line_total: line,
      });
    }

    // 4) 할인(포장 10% 예시) — 필요 없으면 0 유지
    let discount = 0;
    if (order_type === 'TAKEOUT') {
      discount = Math.round(subtotal * 0.10);
    }
    const total = subtotal - discount;

    // 5) 테이블 정보: 세션에서 테이블 정보 찾기
    const session = sessions.find(s => s.token === token);
    const tableInfo = session?.table || null;

    // 6) 주문 객체 구성 & 저장
    const order = {
      id: orders.length + 1,
      session_token: token,
      order_type,
      payer_name: payer_name.trim(),
      items: normalized,
      status: 'CONFIRMED',
      created_at: nowISO(),
      table: tableInfo, // { id, label, slug } or null
      amounts: { subtotal, discount, total },
    };
    orders.push(order);

     // 7) 응답(JSON) - 스웨거 스펙에 맞게 수정
     return res.status(201).json({
       success: true,
       message: 'Created',
       data: {
         order_id: order.id,
         order_type,
         status: order.status,
         subtotal_amount: subtotal,
         discount_amount: discount,
         total_amount: total
       },
     });
  } catch (err) {
    console.error('[POST /orders] error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
});


// (관리자) 진행중 주문 버킷
app.get('/orders/active', (req, res) => {
  const THRESHOLD_MIN = 15;
  const now = Date.now();

  // 진행중: status ∈ {CONFIRMED, IN_PROGRESS}
  const inFlight = orders.filter(o => ['CONFIRMED', 'IN_PROGRESS'].includes(o.status));
  const toRow = (o) => ({
    id: o.id,
    status: o.status,
    table: o.table?.label || 'A-10',
    payer_name: o.payer_name,
    age_min: Math.floor((now - new Date(o.created_at).getTime()) / 60000),
    placed_at: o.created_at
  });

  const urgent = [];
  const waiting = [];
  const preparing = [];

  inFlight.forEach(o => {
    const age = Math.floor((now - new Date(o.created_at).getTime()) / 60000);
    if (['CONFIRMED', 'IN_PROGRESS'].includes(o.status) && age >= THRESHOLD_MIN) {
      urgent.push(toRow(o));
    }
    if (o.status === 'CONFIRMED') waiting.push(toRow(o));
    if (o.status === 'IN_PROGRESS') preparing.push(toRow(o));
  });

  // 오래된 순 (age_min 내림차순)
  const byAgeDesc = (a, b) => b.age_min - a.age_min;
  urgent.sort(byAgeDesc); waiting.sort(byAgeDesc); preparing.sort(byAgeDesc);

  res.json({
    success: true,
    message: 'active orders grouped',
    data: { urgent, waiting, preparing },
    meta: {
      now: new Date(now).toISOString(),
      threshold_min: THRESHOLD_MIN,
      counts: {
        urgent: urgent.length,
        waiting: waiting.length,
        preparing: preparing.length
      },
      total: urgent.length + waiting.length + preparing.length
    }
  });
});

// (사용자) 주문 조회
app.get('/orders/:id', (req, res) => {
  const token = readSessionToken(req);
  if (!token) return res.status(401).json({ success:false, message:'세션 토큰 누락/무효' });

  const idNum = Number(req.params.id);
  const order = orders.find(o => o.id === idNum);
  if (!order) return res.status(404).json({ success:false, message:'Not Found' });
  if (order.session_token !== token) return res.status(403).json({ success:false, message:'본인 세션의 주문이 아님' });

  // 스웨거 스펙에 맞게 items 구조 변경
  const formattedItems = order.items.map((item, index) => ({
    id: index + 1,
    product_id: item.product_id,
    name: typeof item.product_id === 'string' ? item.product_id : `상품 ${item.product_id}`,
    qty: item.qty,
    unit_price: item.unit_price,
    line_total: item.line_total
  }));

  res.json({
    success: true,
    message: 'order details retrieved successfully',
    data: {
      id: order.id,
      status: order.status,
      table: order.table,
      payer_name: order.payer_name,
      amounts: {
        subtotal: order.amounts.subtotal,
        discount: order.amounts.discount,
        total: order.amounts.total
      },
      created_at: order.created_at,
      items: formattedItems
    }
  });
});

// (관리자) 주문 상세 조회
app.get('/orders/admin/:id', (req, res) => {
  // JWT 인증 확인
  const auth = (req.get('Authorization') || '').split(' ')[1];
  try { 
    jwt.verify(auth, SECRET); 
  } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const idNum = Number(req.params.id);
  const order = orders.find(o => o.id === idNum);
  if (!order) return res.status(404).json({ success: false, message: 'Not Found' });

  // 스웨거 스펙에 맞게 items 구조 변경
  const formattedItems = order.items.map((item, index) => ({
    id: index + 1,
    product_id: item.product_id,
    name: typeof item.product_id === 'string' ? item.product_id : `상품 ${item.product_id}`,
    qty: item.qty,
    unit_price: item.unit_price,
    line_total: item.line_total
  }));

  res.json({
    success: true,
    message: 'order details retrieved successfully',
    data: {
      id: order.id,
      status: order.status,
      table: order.table,
      payer_name: order.payer_name,
      amounts: {
        subtotal: order.amounts.subtotal,
        discount: order.amounts.discount,
        total: order.amounts.total
      },
      created_at: order.created_at,
      items: formattedItems
    }
  });
});

// ===== 추가 API 엔드포인트 =====

// (관리자) 실시간 주문 스트림 (SSE)
app.get('/sse/orders/stream', (req, res) => {
  const auth = (req.get('Authorization') || '').split(' ')[1];
  try { jwt.verify(auth, SECRET); } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // 초기 스냅샷 전송
  const activeOrders = getActiveOrdersData();
  res.write(`event: snapshot\n`);
  res.write(`data: ${JSON.stringify(activeOrders)}\n\n`);

  // 주기적 ping (30초마다)
  const pingInterval = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: "pong"\n\n`);
  }, 30000);

  // 클라이언트 연결 해제 시 정리
  req.on('close', () => {
    clearInterval(pingInterval);
    console.log('SSE 클라이언트 연결 해제');
  });

  console.log('SSE 클라이언트 연결됨');
});

// (공용) 전체 메뉴 조회
app.get('/menu', (req, res) => {
  const menuItems = Object.entries(PRICE_TABLE).map((item, index) => ({
    id: index + 1,
    name: item[0],
    price: item[1],
    image_url: null,
    description: `맛있는 ${item[0]}`,
    type: 'MAIN',
    is_sold_out: Math.random() > 0.9 // 10% 확률로 품절
  }));

  res.json({
    success: true,
    message: 'menu returned successfully',
    data: menuItems
  });
});

// (관리자) 전체 메뉴 조회
app.get('/menu/admin', (req, res) => {
  const auth = (req.get('Authorization') || '').split(' ')[1];
  try { jwt.verify(auth, SECRET); } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const menuItems = Object.entries(PRICE_TABLE).map((item, index) => ({
    id: index + 1,
    name: item[0],
    price: item[1],
    image_url: null,
    description: `맛있는 ${item[0]}`,
    type: 'MAIN',
    is_sold_out: Math.random() > 0.9, // 10% 확률로 품절
    stock: Math.floor(Math.random() * 50) + 10 // 랜덤 재고
  }));

  res.json({
    success: true,
    message: 'menu returned successfully',
    data: menuItems
  });
});

// (공용) 인기 메뉴 Top N
app.get('/menu/top', (req, res) => {
  const count = parseInt(req.query.count) || 3;
  
  // 메뉴별 랜덤 판매 데이터 생성
  const menuStats = Object.entries(PRICE_TABLE).map((item, index) => ({
    id: index + 1,
    name: item[0],
    price: item[1],
    image_url: null,
    description: `맛있는 ${item[0]}`,
    qty_sold: Math.floor(Math.random() * 20) + 5, // 5-24개 판매
    amount_sold: 0 // 아래에서 계산
  }));

  // 매출 계산
  menuStats.forEach(item => {
    item.amount_sold = item.qty_sold * item.price;
  });

  // 정렬: 판매수량 내림차순 → 매출합계 내림차순
  menuStats.sort((a, b) => {
    if (b.qty_sold !== a.qty_sold) {
      return b.qty_sold - a.qty_sold;
    }
    return b.amount_sold - a.amount_sold;
  });

  // 상위 N개만 반환
  const topMenus = menuStats.slice(0, count);

  res.json({
    success: true,
    message: 'top menu returned successfully',
    data: topMenus
  });
});

// 세션 강제 종료
app.post('/sessions/:id/close', (req, res) => {
  const auth = (req.get('Authorization') || '').split(' ')[1];
  try { jwt.verify(auth, SECRET); } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const sessionId = parseInt(req.params.id);
  const session = sessions.find(s => s.id === sessionId);
  
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  if (session.status === 'closed') {
    return res.status(409).json({ success: false, message: 'Session already closed' });
  }

  session.status = 'closed';
  session.closed_at = nowISO();

  res.json({
    success: true,
    message: 'Session closed successfully'
  });
});

// 주문 상태 변경
app.patch('/orders/:id/status', (req, res) => {
  const auth = (req.get('Authorization') || '').split(' ')[1];
  try { jwt.verify(auth, SECRET); } catch {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const orderId = parseInt(req.params.id);
  const { action, reason } = req.body || {};
  
  const order = orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const prevStatus = order.status;
  let nextStatus;

  // 상태 변경 로직
  switch (action) {
    case 'confirm':
      if (order.status !== 'CONFIRMED') {
        nextStatus = 'CONFIRMED';
      }
      break;
    case 'start_preparing':
      if (order.status === 'CONFIRMED') {
        nextStatus = 'IN_PROGRESS';
      }
      break;
    case 'complete':
      if (order.status === 'IN_PROGRESS') {
        nextStatus = 'COMPLETED';
      }
      break;
    case 'cancel':
      if (['CONFIRMED', 'IN_PROGRESS'].includes(order.status)) {
        nextStatus = 'CANCELLED';
      }
      break;
    default:
      return res.status(400).json({ success: false, message: 'Invalid action' });
  }

  if (!nextStatus) {
    return res.status(409).json({ 
      success: false, 
      message: `Cannot ${action} order with status ${prevStatus}` 
    });
  }

  order.status = nextStatus;
  order.updated_at = nowISO();
  if (reason) order.reason = reason;

  res.json({
    success: true,
    message: 'Status updated successfully',
    data: {
      order_id: orderId,
      prev: prevStatus,
      next: nextStatus
    }
  });
});

// 헬퍼 함수: Active Orders 데이터 생성
function getActiveOrdersData() {
  const THRESHOLD_MIN = 15;
  const now = Date.now();

  const inFlight = orders.filter(o => ['CONFIRMED', 'IN_PROGRESS'].includes(o.status));
  const toRow = (o) => ({
    id: o.id,
    status: o.status,
    table: o.table?.label || 'A-10',
    payer_name: o.payer_name,
    age_min: Math.floor((now - new Date(o.created_at).getTime()) / 60000),
    placed_at: o.created_at
  });

  const urgent = [];
  const waiting = [];
  const preparing = [];

  inFlight.forEach(o => {
    const age = Math.floor((now - new Date(o.created_at).getTime()) / 60000);
    if (['CONFIRMED', 'IN_PROGRESS'].includes(o.status) && age >= THRESHOLD_MIN) {
      urgent.push(toRow(o));
    }
    if (o.status === 'CONFIRMED') waiting.push(toRow(o));
    if (o.status === 'IN_PROGRESS') preparing.push(toRow(o));
  });

  const byAgeDesc = (a, b) => b.age_min - a.age_min;
  urgent.sort(byAgeDesc); 
  waiting.sort(byAgeDesc); 
  preparing.sort(byAgeDesc);

  return {
    success: true,
    message: 'active orders grouped',
    data: { urgent, waiting, preparing },
    meta: {
      now: new Date(now).toISOString(),
      threshold_min: THRESHOLD_MIN,
      counts: {
        urgent: urgent.length,
        waiting: waiting.length,
        preparing: preparing.length
      },
      total: urgent.length + waiting.length + preparing.length
    }
  };
}

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 테스트 API 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log('📋 사용 가능한 엔드포인트:');
  console.log('   GET  /health');
  console.log('   POST /admin/login');
  console.log('   POST /admin/tables/ensure');
  console.log('   POST /sessions/open-by-slug');
  console.log('   POST /sessions/:id/close');
  console.log('   POST /orders');
  console.log('   GET  /orders/:id');
  console.log('   GET  /orders/active');
  console.log('   GET  /orders/admin/:id');
  console.log('   PATCH /orders/:id/status');
  console.log('   GET  /sse/orders/stream');
  console.log('   GET  /menu');
  console.log('   GET  /menu/admin');
  console.log('   GET  /menu/top');
});
