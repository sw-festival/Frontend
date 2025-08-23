// next.config.js
module.exports = {
  async rewrites() {
    return [
      // 페이지 매핑
      { source: '/', destination: '/order-system/order.html' },
      { source: '/admin', destination: '/order-system/admin.html' },
      { source: '/kitchen', destination: '/order-system/kitchen.html' },
      { source: '/waiting', destination: '/order-system/waiting.html' },

      // .html로 직접 들어와도 동작
      { source: '/:file(index|admin|kitchen|waiting).html', destination: '/order-system/:file.html' },

      // 정적 자산 매핑(상대/절대 경로 혼용 대비)
      { source: '/css/:path*', destination: '/order-system/css/:path*' },
      { source: '/js/:path*', destination: '/order-system/js/:path*' },
      { source: '/images/:path*', destination: '/order-system/images/:path*' },
      { source: '/img/:path*', destination: '/order-system/img/:path*' },
    ];
  },
};
