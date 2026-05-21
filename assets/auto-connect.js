(function () {
  var LS_KEY = 'importonbridge_downloaded';
  var cfg = window.importonbridgeAutoConnectData || {};

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

  function sendToExtension(password, username, baseUrl) {
    var statusEl = document.getElementById('importonbridge-connect-status');
    if (!statusEl) return;
    statusEl.textContent = 'Connecting...';
    statusEl.style.color = '#666';

    var requestId = 'importonbridge_connect_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var timedOut = false;

    var timeout = setTimeout(function () {
      timedOut = true;
      window.removeEventListener('message', handleResponse);
      statusEl.textContent = 'Failed: Extension did not respond. Make sure it is loaded on this page, then try again.';
      statusEl.style.color = '#dc2626';
      var btn = document.getElementById('importonbridge-connect-btn');
      if (btn) btn.disabled = false;
    }, 5000);

    function handleResponse(evt) {
      if (timedOut) return;
      if (evt.source !== window || evt.origin !== window.location.origin) return;
      var data = evt.data || {};
      if (data.type !== 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE') return;
      if (data.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);
      var btn = document.getElementById('importonbridge-connect-btn');
      if (data.ok === false) {
        var errMsg = data.error || '';
        if (/extension context invalidated/i.test(errMsg)) {
          statusEl.textContent = 'Failed: Extension was reloaded. Please refresh this page and try again.';
        } else {
          statusEl.textContent = 'Failed: ' + errMsg;
        }
        statusEl.style.color = '#dc2626';
        if (btn) btn.disabled = false;
        return;
      }
      statusEl.textContent = 'Connected';
      statusEl.style.color = '#16a34a';
      if (btn) btn.disabled = false;
    }

    window.addEventListener('message', handleResponse);

    window.postMessage({
      type: 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_REQUEST',
      requestId: requestId,
      cmd: 'save_bridge_credentials',
      payload: {
        wpBaseUrl: baseUrl || cfg.siteBaseUrl || '',
        wpUser: username || cfg.currentUser || '',
        wpAppPassword: password || ''
      }
    }, window.location.origin);
  }

  function init() {
    try {
      if (localStorage.getItem(LS_KEY) === '1') {
        showDownloadedState();
      }
    } catch (e) {}

    var downloadBtn = document.getElementById('importonbridge-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        try { localStorage.setItem(LS_KEY, '1'); } catch (e) {}
        showDownloadedState();
      });
    }

    var connectBtn = document.getElementById('importonbridge-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', function () {
        var statusEl = document.getElementById('importonbridge-connect-status');
        if (statusEl) {
          statusEl.textContent = 'Creating application password...';
          statusEl.style.color = '#666';
        }
        connectBtn.disabled = true;

        var body = new URLSearchParams();
        body.set('action', 'importonbridge_auto_apppass');
        if (cfg.ajaxUrl) {
          fetch(cfg.ajaxUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
          })
          .then(function (resp) { return resp.json(); })
          .then(function (json) {
            if (json.success && json.data) {
              sendToExtension(json.data.password, json.data.username, json.data.baseUrl);
            } else {
              if (statusEl) {
                statusEl.textContent = 'Failed: ' + (json.data?.message || 'Unknown error');
                statusEl.style.color = '#dc2626';
              }
              connectBtn.disabled = false;
            }
          })
          .catch(function (err) {
            if (statusEl) {
              statusEl.textContent = 'Failed: ' + String(err.message || err);
              statusEl.style.color = '#dc2626';
            }
            connectBtn.disabled = false;
          });
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
