// next.config.js
module.exports = {
  async rewrites() {
    return [
      // 랜딩 페이지
      { source: '/', destination: '/order-system/index.html' },

      // 보기 좋게 별칭 라우트 제공
      { source: '/admin',   destination: '/order-system/admin.html' },
      { source: '/admin-login',  destination: '/order-system/admin-login.html' },
      { source: '/kitchen', destination: '/order-system/kitchen.html' },
      { source: '/waiting', destination: '/order-system/waiting.html' },

      // QR 전용: /t/:slug → 내부적으로 order.html로 서빙 (브라우저 URL은 /t/:slug 유지)
      { source: '/t/:slug', destination: '/order-system/order.html?slug=:slug' },

      // 직접 html 접근도 허용
      { source: '/:file(index|admin|kitchen|waiting|admin-login).html', destination: '/order-system/:file.html' },

      // 정적 자산 절대경로 지원
      { source: '/css/:path*',    destination: '/order-system/css/:path*' },
      { source: '/js/:path*',     destination: '/order-system/js/:path*'  },
      { source: '/images/:path*', destination: '/order-system/images/:path*' },
      { source: '/img/:path*',    destination: '/order-system/img/:path*' },
    ];
  },
};
