// 메뉴명 → product_id

// SSG 문학철판구이 25,900
// NC 빙하기공룡고기 19,900원
// KIA 호랑이 생고기 (기아 타이거즈 고추장 범벅) 21,900원
// 라팍 김치말이국수 7,900원
// 키움쫄?쫄면 5,900원
// LG라면 5,900원
// 롯데 자이언츠 화채 6,900원
// 두산 B볶음s 8,900원
// 후리카케 크봉밥 2,500
// 캔음료(제로콜라, 사이다) 3,000
// 물 2,000
// 팀 컬러 칵테일 3,500

// export const PRODUCT_ID_MAP = {
//   'SSG 문학철판구이(400g)': 1,
//   'NC 빙하기공룡고기(400g)': 2,
//   'KIA 호랑이 생고기': 3,
//   'LG라면': 4,
//   '라팍 김치말이국수': 5,
//   '두산 B볶음s': 6,
//   '키움쫄?쫄면': 7,
//   '롯데 자이언츠 화채': 8,
//   'KT랍찜': 9,
//   '후리카케크봉밥': 10,

//   // 포도맛 칵테일 (팀별 변형 포함)
//   '포도맛 칵테일': 11,
//   '포도맛 (두산)': 11,
//   '포도맛 (KT)': 11,
//   '포도맛 (롯데)': 11,
//   '포도맛 (LG)': 11,

//   // 자몽맛 칵테일 (팀별 변형 포함)
//   '자몽맛 칵테일': 12,
//   '자몽맛 (한화)': 12,
//   '자몽맛 (SSG)': 12,
//   '자몽맛 (기아)': 12,

//   // 소다맛 칵테일 (팀별 변형 포함)
//   '소다맛 칵테일': 13,
//   '소다맛 (NC)': 13,
//   '소다맛 (삼성)': 13,

//   '제로콜라': 14,
//   '사이다': 15,
//   '물': 16,
// };

// 실제 DB 데이터 기반 제품 카탈로그
export const PRODUCTS = {
  1:  { name: 'SSG 문학철판구이(400g)', price: 25900 },
  2:  { name: 'NC 빙하기공룡고기(400g)', price: 25900 },
  3:  { name: 'KIA 호랑이 생고기',       price: 19900 },
  4:  { name: 'LG라면',                  price: 5900  },
  5:  { name: '라팍 김치말이국수',       price: 7900  },
  6:  { name: '두산 B볶rs',             price: 6900  },
  7:  { name: '키움쫄?쫄면',            price: 5900  },
  8:  { name: '롯데 자이언츠 화채',      price: 6900  },
  9:  { name: 'KT랍찜',                 price: 3900  }, 
  10: { name: '후리카케크봉밥',          price: 2500  },
  11: { name: '포도맛 (두산/KT/롯데/LG/키움) 칵테일', price: 3500 },
  12: { name: '자몽맛 (한화/SSG/기아) 칵테일',       price: 3500 },
  13: { name: '소다맛 (NC/삼성) 칵테일',             price: 3500 },
  14: { name: '제로콜라',                price: 3000  },
  15: { name: '사이다',                  price: 3000  },
  16: { name: '물',                      price: 3000  },
};

// 서버에서 쓰는 가격 테이블
const PRICE_TABLE = Object.fromEntries(
  Object.entries(PRODUCTS).map(([id, p]) => [Number(id), p.price])
);

// 메뉴 이름으로 product_id를 찾는 매핑 (하위 호환성)
export const PRODUCT_ID_MAP = {};

// 1. PRODUCTS에서 정확한 이름으로 매핑
Object.entries(PRODUCTS).forEach(([id, product]) => {
  PRODUCT_ID_MAP[product.name] = Number(id);
});

// 2. HTML에서 사용되는 메뉴 이름들과 매핑 (하드코딩된 메뉴 이름)
const menuNameMappings = {
  'SSG 문학철판구이(400g)': 1,
  'NC 빙하기공룡고기(400g)': 2,
  'KIA 호랑이 생고기': 3,
  'LG라ㄹ면': 4,
  '라팍 김치말이국수': 5,
  '두산 B볶rs': 6,
  '키움쫄?쫄면': 7,
  '롯데 자이언츠 화채': 8,
  'KT란찜': 9,
  '후리카케크봉밥': 10,
  '포도맛 (두산/KT/롯데/LG/키움) 칵테일': 11,
  '자몽맛 (한화/SSG/기아) 칵테일': 12,
  '소다맛 (NC/삼성) 칵테일': 13,
  '제로콜라': 14,
  '사이다': 15,
  '물': 16,
};

Object.entries(menuNameMappings).forEach(([menuName, productId]) => {
  PRODUCT_ID_MAP[menuName] = productId;
});

console.log('[PRODUCT_ID_MAP]', PRODUCT_ID_MAP); // 디버그
