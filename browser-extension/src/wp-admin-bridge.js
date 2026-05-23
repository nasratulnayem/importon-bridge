/* global chrome */

(function () {
  const marker = document.querySelector('meta[name="importonbridge-url-import-bridge"][content="1"]');
  if (!marker) return;
  if (!/\/wp-admin(?:\/|$)/.test(window.location.pathname)) return;

  const stateKey = "__IMPORTONBRIDGE_WP_ADMIN_BRIDGE_STATE__";
  const instanceId = `importonbridge_bridge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  function isCurrentBridge() {
    try {
      return !!window[stateKey] && window[stateKey].instanceId === instanceId;
    } catch {
      return false;
    }
  }

  try {
    window[stateKey] = {
      instanceId,
      loadedAt: Date.now()
    };
  } catch {
    // ignore
  }

  function postToPage(message) {
    try {
      window.postMessage(message, window.location.origin);
    } catch {
      // ignore
    }
  }

  function announceReady(reason) {
    if (!isCurrentBridge()) return;
    postToPage({
      type: "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_READY",
      reason: String(reason || "ready"),
      href: window.location.href,
      bridgeInstanceId: instanceId
    });
  }

  announceReady("loaded");

  try {
    chrome.runtime.sendMessage({
      cmd: "sync_wp_site_context",
      wpBaseUrl: window.location.origin
    }).catch(() => {});
  } catch {
    // ignore
  }

  window.addEventListener("pageshow", () => {
    announceReady("pageshow");
    try {
      chrome.runtime.sendMessage({
        cmd: "sync_wp_site_context",
        wpBaseUrl: window.location.origin
      }).catch(() => {});
    } catch {
      // ignore
    }
  });

  window.addEventListener("message", async (event) => {
    if (!isCurrentBridge()) return;
    if (event.source !== window || event.origin !== window.location.origin) return;

    const data = event.data || {};
    if (data?.type !== "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_REQUEST") return;

    const requestId = String(data?.requestId || "");
    const cmd = String(data?.cmd || "");
    const payload = data?.payload && typeof data.payload === "object" ? data.payload : {};
    if (!requestId || !cmd) return;

    try {
      const response = await chrome.runtime.sendMessage({ cmd, ...payload });
      if (!isCurrentBridge()) return;
      const ok = !(response && Object.prototype.hasOwnProperty.call(response, "ok")) || !!response.ok;
      postToPage({
        type: "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE",
        requestId,
        ok,
        payload: response,
        error: response?.error || "",
        bridgeInstanceId: instanceId
      });
    } catch (error) {
      if (!isCurrentBridge()) return;
      postToPage({
        type: "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE",
        requestId,
        ok: false,
        error: String(error?.message || error),
        bridgeInstanceId: instanceId
      });
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!isCurrentBridge()) return;
    if (message?.cmd !== "importonbridge_url_import_batch_progress") return;
    postToPage({
      type: "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_EVENT",
      event: "batch_progress",
      payload: message,
      bridgeInstanceId: instanceId
    });
  });
})();
