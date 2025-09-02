// public/order-system/js/session-gate.js
// slug 읽기 → 난수 입력 → /sessions/open-by-slug 호출 → 토큰 저장 → 주문 UI 노출.

(function () {
  // 간단한 querystring 파서
  function getQueryParam(name) {
    var s = window.location.search.replace(/^\?/, '');
    if (!s) return null;
    var pairs = s.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (decodeURIComponent(kv[0]) === name) {
        return decodeURIComponent(kv[1] || '');
      }
    }
    return null;
  }

  function show(el) { el && (el.style.display = 'block'); }
  function hide(el) { el && (el.style.display = 'none'); }

  document.addEventListener('DOMContentLoaded', function () {
    var gate = document.getElementById('session-gate');
    var orderSection = document.getElementById('order-section');
    var gateMsg = document.getElementById('gate-msg');
    var openBtn = document.getElementById('openSessionBtn');
    var codeInput = document.getElementById('openCode');
    var tableLabel = document.getElementById('gate-table-label');

    var slug = getQueryParam('slug');

    // slug 없으면 안내
    if (!slug) {
      if (tableLabel) tableLabel.textContent = 'QR 정보가 없습니다. URL에 slug가 필요합니다.';
      show(gate); hide(orderSection);
      if (openBtn) openBtn.disabled = true;
      return;
    }

    // 이미 세션 토큰이 있으면 바로 주문 화면
    try {
      var existing = window.Tokens && window.Tokens.getSession && window.Tokens.getSession();
      if (existing) {
        hide(gate);
        orderSection && orderSection.classList.remove('hidden');
        return;
      }
    } catch (e) {}

    // 안내 표시
    if (tableLabel) tableLabel.textContent = 'QR slug: ' + slug;
    show(gate); orderSection && orderSection.classList.add('hidden');

    if (!openBtn) return;
    openBtn.addEventListener('click', function () {
      openBtn.disabled = true; gateMsg.textContent = '';

      var code = (codeInput && codeInput.value || '').trim();
      if (!code) { gateMsg.textContent = '난수를 입력하세요.'; openBtn.disabled = false; return; }

      var base = (window.RUNTIME && window.RUNTIME.API_BASE) || '';
      if (!base) { gateMsg.textContent = 'API_BASE 설정이 없습니다.'; openBtn.disabled = false; return; }

      fetch(base + '/sessions/open-by-slug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug, code: code })
      })
      .then(function (res) { return res.json().catch(function(){return {};}).then(function (j){ return {ok:res.ok, body:j}; }); })
      .then(function (out) {
        if (!out.ok || !out.body?.success || !out.body?.data?.session_token) {
          throw new Error(out.body?.message || '세션 열기 실패');
        }
        var token = out.body.data.session_token;
        if (window.Tokens && window.Tokens.setSession) window.Tokens.setSession(token);
        else try { localStorage.setItem('session_token', token); } catch(e){}

        hide(gate);
        orderSection && orderSection.classList.remove('hidden');
      })
      .catch(function (err) {
        gateMsg.textContent = '세션 열기 실패: ' + (err?.message || '알 수 없는 오류');
      })
      .finally(function () { openBtn.disabled = false; });
    });
  });
})();
