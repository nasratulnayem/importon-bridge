(function () {
  var LS_KEY = 'importonbridge_downloaded';
  var cfg = window.importonbridgeAutoConnectData || {};

  function showDownloadedState() {
    var hero = document.getElementById('importonbridge-download-hero');
    var main = document.getElementById('importonbridge-main-section');
    if (hero) hero.style.display = 'none';
    if (main) main.style.display = 'block';
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
              var passEl = document.getElementById('importonbridge-new-apppass-data');
              if (passEl) {
                passEl.setAttribute('data-password', json.data.password);
                passEl.setAttribute('data-username', json.data.username);
                passEl.setAttribute('data-baseurl', json.data.baseUrl);
              }
              if (statusEl) {
                statusEl.textContent = 'Connected';
                statusEl.style.color = '#16a34a';
              }
              window.dispatchEvent(new CustomEvent('importonbridge_creds_updated'));
            } else {
              if (statusEl) {
                statusEl.textContent = 'Failed: ' + (json.data?.message || 'Unknown error');
                statusEl.style.color = '#dc2626';
              }
            }
          })
          .catch(function (err) {
            if (statusEl) {
              statusEl.textContent = 'Failed: ' + String(err.message || err);
              statusEl.style.color = '#dc2626';
            }
          })
          .finally(function () {
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
