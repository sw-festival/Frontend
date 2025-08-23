module.exports = {
  async rewrites() {
    return [
      { source: '/', destination: '/order-system/index.html' },
      { source: '/admin', destination: '/order-system/admin.html' },
      { source: '/kitchen', destination: '/order-system/kitchen.html' },
      { source: '/waiting', destination: '/order-system/waiting.html' },
      // 정적 자산 경로 매핑
      { source: '/css/:path*', destination: '/order-system/css/:path*' },
      { source: '/js/:path*', destination: '/order-system/js/:path*' },
      { source: '/images/:path*', destination: '/order-system/images/:path*' },
      { source: '/img/:path*', destination: '/order-system/img/:path*' }  
    ];
  },
};
