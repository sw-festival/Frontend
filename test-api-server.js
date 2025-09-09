const PRICE_TABLE = {
  'SSG 문학철판구이': 25900, 'NC 빙하기공룡고기': 19900, 'KIA 호랑이 생고기 (기아 타이거즈 고추장 범벅)': 21900, '라팍 김치말이국수': 7900, '키움쫄?쫄면': 5900, 'LG라면': 5900, '롯데 자이언츠 화채': 6900, '두산 B볶음s': 8900, '후리카케 크봉밥': 2500, '캔음료(제로콜라, 사이다)': 3000, '물': 2000, '팀 컬러 칵테일': 3500
};

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

    // 5) 테이블 정보: 세션에 저장해 둔게 있으면 꺼내기(없으면 null)
    //   open-by-slug 시 세션에 { table:{id,label,slug} } 저장해뒀다는 가정
    const session = getSessionByToken?.(token); // 없다면 기존대로 null/하드코딩
    const tableInfo = session?.table ?? null;

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

    // 7) 응답(JSON)
    return res.status(201).json({
      success: true,
      message: 'Created',
      data: {
        order_id: order.id,
        order_type,
        status: order.status,
        amounts: { subtotal, discount, total },
        payer_name: order.payer_name,
        table: order.table,
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
