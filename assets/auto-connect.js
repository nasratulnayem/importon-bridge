(function () {
  var LS_KEY = 'importonbridge_downloaded';

  function showDownloadedState() {
    var hero = document.getElementById('importonbridge-download-hero');
    var main = document.getElementById('importonbridge-main-section');
    if (hero) hero.style.display = 'none';
    if (main) main.style.display = 'block';
  }

  function showDownloadState() {
    var hero = document.getElementById('importonbridge-download-hero');
    var main = document.getElementById('importonbridge-main-section');
    if (hero) hero.style.display = '';
    if (main) main.style.display = 'none';
  }

  function init() {
    try {
      if (localStorage.getItem(LS_KEY) === '1') {
        showDownloadedState();
      }
    } catch (e) {
      // localStorage unavailable
    }

    var downloadBtn = document.getElementById('importonbridge-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        try {
          localStorage.setItem(LS_KEY, '1');
        } catch (e) {}
        showDownloadedState();
      });
    }

    var connectBtn = document.getElementById('importonbridge-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', function () {
        var pwEl = document.getElementById('importonbridge-new-apppass-data');
        var password = pwEl ? pwEl.getAttribute('data-password') : '';
        var username = pwEl ? pwEl.getAttribute('data-username') : '';
        var baseUrl = pwEl ? pwEl.getAttribute('data-baseurl') : '';

        if (!username) {
          var usernameEl = document.querySelector('.importonbridge-info-item code');
          if (usernameEl) {
            username = usernameEl.textContent.trim();
          }
        }

        var statusEl = document.getElementById('importonbridge-connect-status');
        if (!statusEl) {
          statusEl = document.createElement('div');
          statusEl.id = 'importonbridge-connect-status';
          statusEl.style.cssText = 'margin-top:10px;font-size:13px;font-weight:600;min-height:20px;';
          connectBtn.parentNode.appendChild(statusEl);
        }

        statusEl.textContent = 'Connecting...';
        statusEl.style.color = '#666';

        var requestId = 'importonbridge_connect_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        function handleResponse(evt) {
          if (evt.source !== window || evt.origin !== window.location.origin) return;
          var data = evt.data || {};
          if (data.type !== 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE') return;
          if (data.requestId !== requestId) return;
          window.removeEventListener('message', handleResponse);
          statusEl.textContent = 'Connected';
          statusEl.style.color = '#16a34a';
        }

        window.addEventListener('message', handleResponse);

        window.postMessage({
          type: 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_REQUEST',
          requestId: requestId,
          cmd: 'save_bridge_credentials',
          payload: {
            wpBaseUrl: baseUrl || 'http://127.0.0.1:8080/atw',
            wpUser: username || 'nayem',
            wpAppPassword: password || ''
          }
        }, window.location.origin);

        setTimeout(function () {
          statusEl.textContent = 'Connected';
          statusEl.style.color = '#16a34a';
        }, 2000);
      });
    }

    var passEl = document.getElementById('importonbridge-new-apppass-data');
    if (passEl) {
      var autoPassword = passEl.getAttribute('data-password');
      var autoUsername = passEl.getAttribute('data-username');
      var autoBaseUrl = passEl.getAttribute('data-baseurl');
      if (autoPassword && autoUsername && autoBaseUrl) {
        var autoStatus = document.createElement('div');
        autoStatus.style.cssText = 'margin-bottom:10px;font-size:13px;font-weight:600;color:#16a34a;';
        autoStatus.textContent = 'Auto-connecting extension...';
        passEl.parentNode.insertBefore(autoStatus, passEl.nextSibling);

        var autoReqId = 'importonbridge_autoconnect_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        function autoResponse(evt) {
          if (evt.source !== window || evt.origin !== window.location.origin) return;
          var data = evt.data || {};
          if (data.type !== 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE') return;
          if (data.requestId !== autoReqId) return;
          window.removeEventListener('message', autoResponse);
          autoStatus.textContent = 'Auto-connected';
        }

        window.addEventListener('message', autoResponse);

        window.postMessage({
          type: 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_REQUEST',
          requestId: autoReqId,
          cmd: 'save_bridge_credentials',
          payload: {
            wpBaseUrl: autoBaseUrl,
            wpUser: autoUsername,
            wpAppPassword: autoPassword
          }
        }, window.location.origin);

        setTimeout(function () {
          autoStatus.textContent = 'Auto-connected';
        }, 2000);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
