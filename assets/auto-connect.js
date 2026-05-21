(function () {
  var passEl = document.getElementById('importonbridge-new-apppass-data');
  if (!passEl) return;

  var password = passEl.getAttribute('data-password');
  var username = passEl.getAttribute('data-username');
  var baseUrl = passEl.getAttribute('data-baseurl');
  if (!password || !username || !baseUrl) return;

  var statusEl = document.createElement('div');
  statusEl.id = 'importonbridge-autoconnect-status';
  statusEl.style.cssText = 'margin-top:8px;font-size:13px;font-weight:600;';
  statusEl.textContent = 'Auto-connecting extension...';
  passEl.parentNode.insertBefore(statusEl, passEl.nextSibling);

  var requestId = 'importonbridge_autoconnect_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  function handleResponse(evt) {
    if (evt.source !== window || evt.origin !== window.location.origin) return;
    var data = evt.data || {};
    if (data.type !== 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE') return;
    if (data.requestId !== requestId) return;
    window.removeEventListener('message', handleResponse);

    if (data.ok) {
      statusEl.textContent = 'Extension auto-connected successfully.';
      statusEl.style.color = '#16a34a';
      passEl.style.display = 'none';
    } else {
      statusEl.textContent = 'Auto-connect failed. Copy the password manually into the extension.';
      statusEl.style.color = '#dc2626';
    }
  }

  window.addEventListener('message', handleResponse);

  var sendTimer = window.setTimeout(function () {
    window.postMessage({
      type: 'IMPORTONBRIDGE_URL_IMPORT_BRIDGE_REQUEST',
      requestId: requestId,
      cmd: 'save_bridge_credentials',
      payload: {
        wpBaseUrl: baseUrl,
        wpUser: username,
        wpAppPassword: password
      }
    }, window.location.origin);
  }, 600);
})();
