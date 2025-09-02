// 위 플래그/베이스
window.RUNTIME = {
  API_BASE: isLocalhost ? "http://localhost:3000" : "https://api.limswoo.shop",      // 로컬 테스트용 (실제 서버 주소로 변경 필요)
  SESSION_OPEN_CODE: "test123",           // 테스트용 코드
  USE_FIREBASE_READ: true,                // 조회 API 나오면 false로
  USE_FIREBASE_WRITE_MIRROR: true,        // 서버 성공 후 파베에 "요약"만 동기화(임시)
  ADMIN_PIN: "2025"                  // 관리자 PIN (배포 시 변경 필요)
};
