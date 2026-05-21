(function () {
  const cfg = window.importonbridgeUrlImportData || {};
  const startBtn = document.getElementById("importonbridge-url-import-start");
  if (!startBtn) return;
  const clearRunsBtn = document.getElementById("importonbridge-url-import-clear-runs");

  const state = {
    currentRun: cfg.latestRun && typeof cfg.latestRun === "object" ? cfg.latestRun : null,
    recentRuns: Array.isArray(cfg.recentRuns) ? cfg.recentRuns.slice() : [],
    processing: false,
    bridgeReady: false,
    extensionState: "checking",
    requestSeq: 0,
    bridgeRequests: new Map(),
    syncChain: Promise.resolve()
  };

  const statusMap = {
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    completed_with_errors: "Completed With Errors",
    failed: "Failed",
    stopped: "Stopped"
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function humanStatus(status) {
    return statusMap[String(status || "").trim()] || "Idle";
  }

  function isInvalidatedBridgeError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function isNumericId(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  }

  function normalizeUrls(raw) {
    return Array.from(
      new Set(
        String(raw || "")
          .split(/[\r\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }

  async function ajax(action, data = {}) {
    const body = new URLSearchParams();
    body.set("action", action);
    body.set("nonce", String(cfg.nonce || ""));
    Object.entries(data).forEach(([key, value]) => {
      if (value == null) return;
      body.set(key, typeof value === "string" ? value : String(value));
    });

    const resp = await fetch(String(cfg.ajaxUrl || ""), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: body.toString()
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json || !json.success) {
      throw new Error(json?.data?.message || `Request failed (${resp.status})`);
    }
    return json.data || {};
  }

  function renderCategories() {
    const select = el("importonbridge-url-import-category");
    const categories = Array.isArray(cfg.categories) ? cfg.categories : [];
    const currentCategoryId = isNumericId(state.currentRun?.category_id) ? Number(state.currentRun.category_id) : 0;

    select.innerHTML = '<option value="">Select category...</option>';
    categories.forEach((category) => {
      const id = Number(category?.id || 0);
      if (!id) return;
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = String(category?.path || category?.name || `Category #${id}`);
      select.appendChild(option);
    });

    if (currentCategoryId > 0) {
      select.value = String(currentCategoryId);
    }
  }

  function updateButtons() {
    const failedItems = Array.isArray(state.currentRun?.failed_items) ? state.currentRun.failed_items : [];
    startBtn.disabled = !!state.processing;
    el("importonbridge-url-import-retry").disabled = !!state.processing || failedItems.length === 0;
    if (clearRunsBtn) {
      clearRunsBtn.disabled = !!state.processing || state.recentRuns.length === 0;
    }
  }

  function setExtensionStatus(message, kind = "checking") {
    const box = el("importonbridge-url-import-extension-box");
    const pill = el("importonbridge-url-import-extension-pill");
    const text = el("importonbridge-url-import-extension-status");
    const defs = {
      checking: { tone: "neutral", label: "Checking" },
      ready: { tone: "success", label: "Ready" },
      incomplete: { tone: "warning", label: "Setup" },
      mismatch: { tone: "warning", label: "Wrong Site" },
      unavailable: { tone: "danger", label: "Disconnected" }
    };
    const meta = defs[kind] || defs.checking;

    state.extensionState = kind;
    if (box) {
      box.dataset.tone = meta.tone;
      box.classList.toggle("importonbridge-note-box--hidden", kind === "ready");
    }
    if (pill) {
      pill.textContent = meta.label;
      pill.className = `importonbridge-status-pill importonbridge-status-pill--${meta.tone}`;
    }
    if (text) {
      text.textContent = String(message || "");
    }
  }

  function setLogLink(run) {
    const link = el("importonbridge-url-import-log-link");
    const url = String(run?.log_url || "").trim();
    if (!link || link.tagName !== "A") return;
    link.href = url || "#";
  }

  function renderFailedItems(run) {
    const body = el("importonbridge-url-import-failed-body");
    if (!body) return;
    const items = Array.isArray(run?.failed_items) ? run.failed_items : [];
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="3" class="importonbridge-empty-state">No failed URLs for the selected run.</td></tr>';
      return;
    }

    body.innerHTML = items
      .map((item) => {
        return [
          "<tr>",
          `<td data-label="URL"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a></td>`,
          `<td data-label="Reason">${escapeHtml(item.error || "Unknown error.")}</td>`,
          `<td data-label="Updated">${escapeHtml(item.updated_at || "")}</td>`,
          "</tr>"
        ].join("");
      })
      .join("");
  }

  function summarizeRun(run) {
    return {
      id: String(run?.id || ""),
      status: String(run?.status || ""),
      category_path: String(run?.category_path || ""),
      total: Number(run?.total || 0),
      success: Number(run?.success || 0),
      failed: Number(run?.failed || 0),
      log_url: String(run?.log_url || "")
    };
  }

  function mergeRunIntoHistory(run) {
    if (!run || !run.id) return;
    const summary = summarizeRun(run);
    const next = [summary].concat(state.recentRuns.filter((item) => item && item.id !== summary.id));
    state.recentRuns = next.slice(0, 8);
  }

  function renderRecentRuns() {
    const body = el("importonbridge-url-import-runs-body");
    if (!state.recentRuns.length) {
      body.innerHTML = '<div class="importonbridge-empty-state">No import runs yet.</div>';
      return;
    }

    body.innerHTML = state.recentRuns
      .map((run) => {
        const failedCount = Number(run.failed || 0);
        const status = humanStatus(run.status);
        const statusClass = status === "Completed" ? "importonbridge-status-success" : (status === "Failed" || status === "Completed With Errors" ? "importonbridge-status-danger" : (status === "Running" ? "importonbridge-status-running" : "importonbridge-status-pending"));
        const logCell = failedCount > 0 && run.log_url
          ? `<a href="${escapeHtml(run.log_url)}" target="_blank" rel="noopener" class="importonbridge-log-link">View</a>`
          : '<span style="color:#94a3b8;">—</span>';
        const successCount = Number(run.success || 0);
        const failedDisplay = failedCount > 0 ? `<span style="color:#dc2626;font-weight:600;">${failedCount}</span>` : "0";
        const successDisplay = successCount > 0 ? `<span style="color:#16a34a;font-weight:600;">${successCount}</span>` : "0";
        return [
          "<div class=\"importonbridge-run-row\">",
          `<div class="importonbridge-run-col importonbridge-run-id" title="${escapeHtml(run.id || "")}">${escapeHtml(run.id || "")}</div>`,
          `<div class="importonbridge-run-col importonbridge-run-category">${escapeHtml(run.category_path || "")}</div>`,
          `<div class="importonbridge-run-col importonbridge-run-status"><span class="importonbridge-status-badge ${statusClass}">${status}</span></div>`,
          `<div class="importonbridge-run-col importonbridge-run-total">${escapeHtml(run.total || 0)}</div>`,
          `<div class="importonbridge-run-col importonbridge-run-success">${successDisplay}</div>`,
          `<div class="importonbridge-run-col importonbridge-run-failed">${failedDisplay}</div>`,
          `<div class="importonbridge-run-col importonbridge-run-log">${logCell}</div>`,
          "</div>"
        ].join("");
      })
      .join("");
  }

  function statusDotColor(status) {
    const s = String(status || "").trim();
    if (s === "completed") return "#16a34a";
    if (s === "completed_with_errors") return "#d97706";
    if (s === "running") return "#2563eb";
    if (s === "failed" || s === "stopped") return "#dc2626";
    return "#94a3b8";
  }

  function statusTextColor(status) {
    const s = String(status || "").trim();
    if (s === "completed") return "#16a34a";
    if (s === "completed_with_errors") return "#d97706";
    if (s === "running") return "#2563eb";
    if (s === "failed" || s === "stopped") return "#dc2626";
    return "#64748b";
  }

  function renderRun(run) {
    const total = Number(run?.total || 0);
    const processed = Number(run?.processed || 0);
    const success = Number(run?.success || 0);
    const failed = Number(run?.failed || 0);
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : 0;
    const statusStr = humanStatus(run?.status);
    const statusKey = String(run?.status || "").trim();
    const dotColor = statusDotColor(statusKey);
    const txtColor = statusTextColor(statusKey);

    const statusEl = el("importonbridge-run-status");
    if (statusEl) {
      statusEl.style.color = txtColor;
      statusEl.innerHTML = '<span style="width:8px;height:8px;background:' + dotColor + ';border-radius:50%;display:inline-block;"></span> ' + statusStr;
    }

    el("importonbridge-run-total").textContent = String(total);
    el("importonbridge-run-processed").textContent = String(processed);
    el("importonbridge-run-success").textContent = String(success);
    el("importonbridge-run-failed").textContent = String(failed);
    el("importonbridge-run-progress-bar").style.width = `${pct}%`;
    el("importonbridge-run-message").textContent = String(run?.latest_message || "No run started yet.");

    setLogLink(run);
    renderFailedItems(run);
    if (run) mergeRunIntoHistory(run);
    renderRecentRuns();
    updateButtons();
  }

  function resetRunView() {
    state.currentRun = null;
    renderRun(null);
  }

  async function refreshRecentRuns() {
    try {
      const data = await ajax("importonbridge_url_import_recent_runs");
      if (Array.isArray(data.runs)) {
        state.recentRuns = data.runs;
        renderRecentRuns();
      }
    } catch {
      // ignore
    }
  }

  function bridgeRequest(cmd, payload = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const requestId = `importonbridge_bridge_${Date.now()}_${++state.requestSeq}`;
      const timer = window.setTimeout(() => {
        state.bridgeRequests.delete(requestId);
        reject(new Error("Importon Bridge extension did not respond. Make sure it is installed, enabled, and allowed on this site."));
      }, timeoutMs);

      state.bridgeRequests.set(requestId, { resolve, reject, timer });
      window.postMessage(
        {
          type: "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_REQUEST",
          requestId,
          cmd,
          payload
        },
        window.location.origin
      );
    });
  }

  function onBridgeResponse(data) {
    const requestId = String(data?.requestId || "");
    if (!requestId || !state.bridgeRequests.has(requestId)) return;

    const request = state.bridgeRequests.get(requestId);
    state.bridgeRequests.delete(requestId);
    window.clearTimeout(request.timer);
    state.bridgeReady = true;

    if (data?.ok === false) {
      if (isInvalidatedBridgeError(data?.error)) {
        state.bridgeReady = false;
      }
      request.reject(new Error(data?.error || "Importon Bridge extension request failed."));
      return;
    }

    request.resolve(data?.payload ?? data);
  }

  function queueRunEvent(runId, event) {
    state.syncChain = state.syncChain
      .then(async () => {
        const data = await ajax("importonbridge_url_import_update_run", {
          run_id: runId,
          event: JSON.stringify(event)
        });
        if (data?.run) {
          state.currentRun = data.run;
          if (event.type === "state" && ["done", "error", "stopped"].includes(String(event.state || ""))) {
            state.processing = false;
            refreshRecentRuns();
          }
          renderRun(state.currentRun);
        }
      })
      .catch((error) => {
        state.processing = false;
        el("importonbridge-run-message").textContent = String(error?.message || error);
        updateButtons();
      });

    return state.syncChain;
  }

  function onBridgeEvent(eventName, payload) {
    if (eventName !== "batch_progress") return;

    const runId = String(payload?.runId || "");
    if (!runId) return;

    let event = null;
    const progressState = String(payload?.state || "");

    if (progressState === "start") {
      state.processing = true;
      event = {
        type: "state",
        state: "start",
        message: payload?.message || `Importing ${Number(payload?.total || 0)} URLs...`
      };
    } else if (progressState === "item") {
      event = {
        type: "item",
        url: payload?.url || "",
        ok: !!payload?.ok,
        message: payload?.message || "",
        error: payload?.error || ""
      };
    } else if (progressState === "done") {
      event = {
        type: "state",
        state: "done",
        message: payload?.message || `Run finished. Success: ${payload?.success || 0}, failed: ${payload?.failed || 0}.`
      };
    } else if (progressState === "stopped") {
      event = {
        type: "state",
        state: "stopped",
        message: payload?.message || "Run stopped."
      };
    } else if (progressState === "error") {
      event = {
        type: "state",
        state: "error",
        message: payload?.error || "Batch import failed."
      };
    }

    if (event) {
      queueRunEvent(runId, event);
    }
  }

  window.addEventListener("message", (evt) => {
    if (evt.source !== window || evt.origin !== window.location.origin) return;
    const data = evt.data || {};
    if (data?.type === "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_READY") {
      state.bridgeReady = true;
      if (state.extensionState !== "ready") {
        window.setTimeout(() => {
          updateExtensionStatus({ attempts: 2, delayMs: 400 });
        }, 120);
      }
      return;
    }
    if (data?.type === "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_RESPONSE") {
      onBridgeResponse(data);
      return;
    }
    if (data?.type === "IMPORTONBRIDGE_URL_IMPORT_BRIDGE_EVENT") {
      onBridgeEvent(data?.event, data?.payload || {});
    }
  });

  async function updateExtensionStatus({ attempts = 4, delayMs = 700 } = {}) {
    setExtensionStatus("Checking the Importon Bridge extension bridge on this admin tab...", "checking");

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const status = await bridgeRequest("get_url_import_bridge_status", {}, 5000);
        state.bridgeReady = true;
        const configured = !!status?.configured;
        const savedBase = String(status?.wpBaseUrl || "").trim();
        const currentBase = String(cfg.siteBaseUrl || "").replace(/\/+$/, "");
        if (!configured) {
          setExtensionStatus(
            "Extension detected, but the saved WordPress credentials are incomplete. Open Importon Bridge settings in the extension and save the site URL, username, and Application Password.",
            "incomplete"
          );
          return false;
        }
        if (savedBase && savedBase !== currentBase) {
          setExtensionStatus(
            `Extension detected, but the saved site is ${savedBase} while this dashboard is ${currentBase}. Update the extension settings before starting the batch.`,
            "mismatch"
          );
          return false;
        }
        if (!status?.authOk) {
          const reason = status?.authError ? ` (${status.authError})` : "";
          setExtensionStatus(
            `Extension credentials failed authentication${reason}. Open Importon Bridge extension settings, re-enter the Application Password, then click Test Connection to save.`,
            "auth_failed"
          );
          return false;
        }
        setExtensionStatus("Extension detected and ready.", "ready");
        return true;
      } catch (error) {
        lastError = error;
        if (isInvalidatedBridgeError(error)) {
          state.bridgeReady = false;
        }
        if (attempt < attempts) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }
      }
    }

    const fallback = isInvalidatedBridgeError(lastError)
      ? "The Importon Bridge extension was reloaded or updated after this admin tab was opened. Click Refresh Extension Status, or reload this wp-admin tab once to reconnect the bridge."
      : !state.bridgeReady
      ? "The Importon Bridge extension bridge is not loaded on this admin tab yet. Click Refresh Extension Status, open the Importon Bridge extension once on this tab, or reload the page."
      : String(lastError?.message || lastError || "Importon Bridge extension is unavailable on this admin page.");
    setExtensionStatus(fallback, "unavailable");
    return false;
  }

  async function ensureExtensionReady() {
    if (state.extensionState === "ready") {
      return true;
    }
    return updateExtensionStatus({ attempts: 3, delayMs: 600 });
  }

  async function startBatch(urls, categoryId, sourceRunId = "") {
    const extensionReady = await ensureExtensionReady();
    if (!extensionReady) {
      throw new Error("The Importon Bridge extension is not ready on this admin tab. Refresh the status, then try again.");
    }

    const created = await ajax("importonbridge_url_import_create_run", {
      urls: urls.join("\n"),
      category_id: String(categoryId),
      source_run_id: sourceRunId
    });

    state.currentRun = created.run || null;
    state.processing = true;
    renderRun(state.currentRun);

    try {
      const res = await bridgeRequest(
        "run_url_import_batch",
        {
          runId: state.currentRun?.id || "",
          urls,
          categoryId
        },
        12000
      );

      if (!res?.ok) {
        throw new Error(res?.error || "Extension rejected the batch import request.");
      }
    } catch (error) {
      await queueRunEvent(state.currentRun?.id || "", {
        type: "state",
        state: "error",
        message: String(error?.message || error)
      });
    }
  }

  startBtn.addEventListener("click", async () => {
    const urls = normalizeUrls(el("importonbridge-url-import-urls").value);
    const categoryId = Number(el("importonbridge-url-import-category").value || 0);

    if (!urls.length) {
      el("importonbridge-run-message").textContent = "Paste at least one Alibaba product URL.";
      return;
    }
    if (!categoryId) {
      el("importonbridge-run-message").textContent = "Select a WooCommerce category first.";
      return;
    }

    try {
      await startBatch(urls, categoryId, "");
    } catch (error) {
      state.processing = false;
      el("importonbridge-run-message").textContent = String(error?.message || error);
      updateButtons();
    }
  });

  el("importonbridge-url-import-retry").addEventListener("click", async () => {
    const failedItems = Array.isArray(state.currentRun?.failed_items) ? state.currentRun.failed_items : [];
    const urls = failedItems.map((item) => String(item?.url || "").trim()).filter(Boolean);
    const categoryId = Number(state.currentRun?.category_id || 0);

    if (!urls.length || !categoryId) {
      return;
    }

    try {
      await startBatch(urls, categoryId, String(state.currentRun?.id || ""));
    } catch (error) {
      state.processing = false;
      el("importonbridge-run-message").textContent = String(error?.message || error);
      updateButtons();
    }
  });

  el("importonbridge-url-import-extension-refresh")?.addEventListener("click", async () => {
    await updateExtensionStatus({ attempts: 3, delayMs: 500 });
  });


  clearRunsBtn?.addEventListener("click", async () => {
    if (state.processing || !state.recentRuns.length) {
      return;
    }
    if (!window.confirm("Clear all recent Importon Bridge import runs?")) {
      return;
    }

    try {
      clearRunsBtn.disabled = true;
      await ajax("importonbridge_url_import_clear_runs");
      state.recentRuns = [];
      resetRunView();
    } catch (error) {
      el("importonbridge-run-message").textContent = String(error?.message || error);
      updateButtons();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      updateExtensionStatus({ attempts: 2, delayMs: 400 }).catch(() => {});
    }
  });

  renderCategories();
  renderRun(state.currentRun);
  refreshRecentRuns();
  updateExtensionStatus().catch(() => {});
})();
