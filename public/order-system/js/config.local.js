// 로컬에서는 API를 같은 오리진(/api)로 때리고, vite가 프록시로 백엔드에 붙여줍니다.
window.RUNTIME = {
  API_BASE: window.location.origin, // ← 중요
  API_PREFIX: '/api',
  // (선택) 슬러그 분류 파일 경로가 상대경로면 그대로 두세요.
  SLUG_TYPES_URL: '/order-system/data/slug-types.json',
  TAKEOUT_SLUGS: [] // 필요시
};
