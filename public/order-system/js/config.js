// 위 플래그/베이스
(function () {
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  window.RUNTIME = {
    API_BASE: isLocal ? 'http://localhost:3000' : 'https://api.limswoo.shop', // 운영 도메인
    API_PREFIX: isLocal ? '' : '/api',
    SESSION_OPEN_CODE: 'test123',         // 운영에선 서버 설정과 맞춰야 함
    USE_FIREBASE_READ: true,
    USE_FIREBASE_WRITE_MIRROR: true,
    ADMIN_PIN: '2025'
  };
})();

