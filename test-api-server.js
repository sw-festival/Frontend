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
  if (code !== 'test123') return res.status(422).json({ success:false, message:'Invalid code' });

  const token = `session_${Date.now()}`;
  sessions.push({ token, slug, created_at: Date.now() });
  res.json({
    success: true,
    message: 'Session opened successfully',
    data: {
      session_token: token,
      session_id: sessions.length,
      table: { id: 1, label: 'A-10', slug, is_active: true },
      abs_ttl_min: 120,
      idle_ttl_min: 30
    }
  });
});

// 주문 생성
app.post('/orders', (req, res) => {
  const token = readSessionToken(req);
  if (!token) return res.status(401).json({ success:false, message:'Unauthorized' });

  const { order_type, payer_name, items } = req.body || {};
  if (!payer_name || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success:false, message:'Bad Request' });
  }

  let subtotal = 0;
  const normalized = items.map(it => {
    const qty = Number(it.quantity || 0);
    const unit = PRICE_TABLE[it.product_id] ?? 0;
    subtotal += unit * qty;
    return {
      product_id: it.product_id,
      qty,
      unit_price: unit,
      line_total: unit * qty
    };
  });
  const discount = 0;
  const total = subtotal - discount;

  const order = {
    id: orders.length + 1,
    session_token: token,
    order_type,
    payer_name,
    items: normalized,
    status: 'CONFIRMED',
    created_at: nowISO(),
    table: { id: 1, label: 'A-10' },
    amounts: { subtotal, discount, total }
  };
  orders.push(order);

  res.status(201).json({
    success: true,
    message: 'Created',
    data: {
      order_id: order.id,
      order_type,
      status: order.status,
      subtotal_amount: subtotal,
      discount_amount: discount,
      total_amount: total
    }
  });
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

  res.json({
    success: true,
    message: 'order details retrieved successfully',
    data: {
      id: order.id,
      status: order.status,
      table: order.table,
      payer_name: order.payer_name,
      amounts: order.amounts,
      created_at: order.created_at,
      items: order.items
    }
  });
});

// (관리자) 주문 상세 (인증 생략 테스트용)
app.get('/orders/admin/:id', (req, res) => {
  const idNum = Number(req.params.id);
  const order = orders.find(o => o.id === idNum);
  if (!order) return res.status(404).json({ success:false, message:'Not Found' });
  res.json({
    success: true,
    message: 'order details retrieved successfully',
    data: {
      id: order.id,
      status: order.status,
      table: order.table,
      payer_name: order.payer_name,
      amounts: order.amounts,
      created_at: order.created_at,
      items: order.items
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 테스트 API 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log('📋 사용 가능한 엔드포인트:');
  console.log('   GET  /health');
  console.log('   POST /admin/login');
  console.log('   POST /admin/tables/ensure');
  console.log('   POST /sessions/open-by-slug');
  console.log('   POST /orders');
  console.log('   GET  /orders/:id');
  console.log('   GET  /orders/active');
  console.log('   GET  /orders/admin/:id');
});
