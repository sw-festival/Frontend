(function () {
  const GA = { id: null };

  function gtag() {
    window.dataLayer.push(arguments);
  }

  // GA4 초기화
  window.initGA = function (id) {
    if (!id) return;
    if (document.getElementById('ga4')) return;

    window.dataLayer = window.dataLayer || [];

    const s = document.createElement('script');
    s.async = true;
    s.id = 'ga4';
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);

    gtag('js', new Date());
    gtag('config', id, { send_page_view: false }); // SPA 중복 방지
    GA.id = id;
  };

  // 페이지뷰
  window.trackPage = function ({ page_title, page_path, slug, channel, step, debug = false }) {
    if (!GA.id || !window.gtag) return;
    const p = {
      page_title,
      page_path,
      page_location: location.href,
      slug,
      channel,
      step
    };
    if (debug) p.debug_mode = true;
    gtag('event', 'page_view', p);
  };

  // 주문 성공
  window.trackOrderSuccess = function ({ order_id, value, slug, channel, currency = 'KRW', debug = false }) {
    if (!GA.id || !window.gtag) return;
    const p = {
      transaction_id: String(order_id),
      value,
      currency,
      slug,
      channel
    };
    if (debug) p.debug_mode = true;
    gtag('event', 'purchase', p); // GA4 표준 전자상거래 이벤트
  };

  // 주문 실패
  window.trackOrderFail = function ({ reason, slug, channel, debug = false }) {
    if (!GA.id || !window.gtag) return;
    const p = { reason, slug, channel };
    if (debug) p.debug_mode = true;
    gtag('event', 'order_fail', p);
  };

  // 대기열 이벤트
  window.trackQueue = function ({ position, est_ms, slug, channel, debug = false }) {
    if (!GA.id || !window.gtag) return;
    const p = { queue_pos: position, queue_ms: est_ms, slug, channel };
    if (debug) p.debug_mode = true;
    gtag('event', 'queue_view', p);
  };
})();
