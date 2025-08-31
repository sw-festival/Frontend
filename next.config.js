// next.config.js
module.exports = {
  async rewrites() {
    return [
      { source: '/',        destination: '/order-system/order.html' },
      { source: '/admin',   destination: '/order-system/admin.html' },
      { source: '/kitchen', destination: '/order-system/kitchen.html' },
      { source: '/waiting', destination: '/order-system/waiting.html' },
      // ✅ QR: 슬러그 진입
      { source: '/t/:slug', destination: '/order-system/order.html?slug=:slug' },
      // 직접 .html 접근
      { source: '/:file(index|admin|kitchen|waiting|admin-login).html', destination: '/order-system/:file.html' },
      // 정적 자산
      { source: '/css/:path*', destination: '/order-system/css/:path*' },
      { source: '/js/:path*',  destination: '/order-system/js/:path*'  },
      { source: '/images/:path*', destination: '/order-system/images/:path*' },
      { source: '/img/:path*',    destination: '/order-system/img/:path*'    },
    ];
  },
};
