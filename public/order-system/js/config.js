// 위 플래그/베이스
window.RUNTIME = {
  API_BASE: "https://api.limswoo.shop",
  SESSION_OPEN_CODE: "여기에_운영코드",   // 배포 시 교체
  USE_FIREBASE_READ: true,                // 조회 API 나오면 false로
  USE_FIREBASE_WRITE_MIRROR: true,        // 서버 성공 후 파베에 "요약"만 동기화(임시)
  ADMIN_PIN: "admin2025"                  // 관리자 PIN (배포 시 변경 필요)
};
