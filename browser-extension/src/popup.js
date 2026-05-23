/* global chrome */

const DEFAULTS = {
  wpBaseUrl: "",
  wpUser: "",
  wpAppPassword: "",
  defaultCategoryId: 0,
  cachedCategories: [],
  uiMode: "light",
  authPassed: false
};

function qs(id) {
  return document.getElementById(id);
}

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function applyTheme(mode) {
  const theme = mode === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  qs("themeToggle").textContent = theme === "dark" ? "Light" : "Dark";
}

function setStatus(message, tone = "") {
  const el = qs("status");
  el.textContent = message || "";
  el.dataset.tone = tone || "";
}

function setCatStatus(message) {
  qs("catStatus").textContent = message || "";
}

function setConnectionState(connected, meta = {}) {
  const badge = qs("connectionBadge");
  const connectBtn = qs("connectBtn");
  const disconnectBtn = qs("disconnectBtn");
  const form = qs("connectionForm");
  const refreshBtn = qs("refreshBtn");
  const copy = qs("connectionCopy");

  document.body.dataset.state = connected ? "connected" : "disconnected";

  if (connected) {
    badge.textContent = "Connected";
    badge.className = "badge badge--ok";
    connectBtn.textContent = "Connected";
    connectBtn.className = "btn btn--success";
    connectBtn.disabled = true;
    disconnectBtn.classList.remove("hidden");
    form.classList.add("hidden");
    refreshBtn.classList.remove("hidden");
    copy.textContent = meta?.wpBaseUrl ? `Connected to ${meta.wpBaseUrl}` : "Connected and ready for imports.";
  } else {
    badge.textContent = "Disconnected";
    badge.className = "badge badge--warn";
    connectBtn.textContent = "Connect";
    connectBtn.className = "btn btn--danger";
    connectBtn.disabled = false;
    disconnectBtn.classList.add("hidden");
    form.classList.remove("hidden");
    refreshBtn.classList.add("hidden");
    copy.textContent = "Connect once to activate imports and category sync.";
  }
}

function renderCategories(categories, selectedId) {
  const select = qs("defaultCategoryId");
  const list = Array.isArray(categories) ? categories : [];

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length ? "Select category..." : "Connect to load categories";
  select.appendChild(placeholder);

  for (const category of list) {
    const id = toPositiveInt(category?.id);
    if (!id) continue;
    const option = document.createElement("option");
    option.value = String(id);
    option.textContent = String(category?.path || category?.name || `Category #${id}`);
    select.appendChild(option);
  }

  const chosen = toPositiveInt(selectedId);
  if (chosen) select.value = String(chosen);

  setCatStatus(list.length ? `${list.length} categories available.` : "Connect to load categories.");
}

async function saveDraft(extra = {}) {
  const [syncVals, localVals] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get(DEFAULTS)
  ]);
  const current = { ...DEFAULTS, ...syncVals, ...localVals };
  const next = {
    ...current,
    wpBaseUrl: normalizeBaseUrl(qs("wpBaseUrl").value),
    wpUser: qs("wpUser").value.trim(),
    wpAppPassword: qs("wpAppPassword").value.trim(),
    defaultCategoryId: toPositiveInt(qs("defaultCategoryId").value),
    uiMode: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
    ...extra
  };
  await Promise.all([
    chrome.storage.sync.set(next),
    chrome.storage.local.set(next)
  ]);
  return next;
}

async function loadConnectionState() {
  const [syncVals, localVals] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get(DEFAULTS)
  ]);
  const stored = { ...DEFAULTS, ...syncVals, ...localVals };

  applyTheme(stored.uiMode || "light");
  qs("wpBaseUrl").value = stored.wpBaseUrl || "";
  qs("wpUser").value = stored.wpUser || "";
  qs("wpAppPassword").value = stored.wpAppPassword || "";

  const response = await chrome.runtime.sendMessage({ cmd: "get_connection_state" });
  if (response?.ok) {
    setConnectionState(!!response.connected, { wpBaseUrl: response.wpBaseUrl || stored.wpBaseUrl || "" });
    renderCategories(response.categories || stored.cachedCategories || [], response.defaultCategoryId || stored.defaultCategoryId);
    if (!response.connected && response.authError) {
      setStatus(response.authError, "error");
    } else if (response.connected) {
      setStatus("Connected.", "ok");
    }
    return;
  }

  setConnectionState(false);
  renderCategories(stored.cachedCategories || [], stored.defaultCategoryId);
}

async function connect() {
  const wpBaseUrl = normalizeBaseUrl(qs("wpBaseUrl").value);
  const wpUser = qs("wpUser").value.trim();
  const wpAppPassword = qs("wpAppPassword").value.trim();

  if (!wpBaseUrl || !wpUser || !wpAppPassword) {
    setStatus("Enter the WordPress URL, username, and application password.", "error");
    return;
  }

  setStatus("Connecting...", "info");
  qs("connectBtn").disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      cmd: "connect_bridge",
      wpBaseUrl,
      wpUser,
      wpAppPassword
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Connection failed.");
    }

    await saveDraft({
      authPassed: true,
      cachedCategories: Array.isArray(response.categories) ? response.categories : []
    });

    setConnectionState(true, { wpBaseUrl });
    renderCategories(response.categories || [], response.defaultCategoryId || toPositiveInt(qs("defaultCategoryId").value));
    setStatus("Connected.", "ok");

    if (response.categoryError) {
      setCatStatus(response.categoryError);
    }
  } catch (error) {
    setConnectionState(false);
    setStatus(String(error?.message || error), "error");
  } finally {
    qs("connectBtn").disabled = false;
  }
}

async function disconnect() {
  try {
    await chrome.runtime.sendMessage({ cmd: "disconnect_bridge" });
  } catch {
    // ignore
  }

  await saveDraft({ authPassed: false });
  setConnectionState(false);
  setStatus("Disconnected.", "warn");
  renderCategories([], 0);
}

qs("themeToggle").addEventListener("click", async () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    await saveDraft({ uiMode: next });
  } catch {
    // ignore
  }
});

qs("connectBtn").addEventListener("click", async () => {
  await connect();
});

qs("disconnectBtn").addEventListener("click", async () => {
  await disconnect();
});

qs("refreshBtn").addEventListener("click", async () => {
  try {
    setStatus("Refreshing categories...", "info");
    const response = await chrome.runtime.sendMessage({
      cmd: "connect_bridge",
      wpBaseUrl: normalizeBaseUrl(qs("wpBaseUrl").value),
      wpUser: qs("wpUser").value.trim(),
      wpAppPassword: qs("wpAppPassword").value.trim()
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to refresh categories.");
    }
    await saveDraft({
      authPassed: true,
      cachedCategories: Array.isArray(response.categories) ? response.categories : []
    });
    renderCategories(response.categories || [], toPositiveInt(qs("defaultCategoryId").value));
    setStatus("Categories refreshed.", "ok");
  } catch (error) {
    setStatus(String(error?.message || error), "error");
  }
});

qs("defaultCategoryId").addEventListener("change", async () => {
  try {
    await saveDraft();
  } catch {
    // ignore
  }
});

for (const id of ["wpBaseUrl", "wpUser", "wpAppPassword"]) {
  qs(id).addEventListener("input", async () => {
    try {
      await saveDraft();
    } catch {
      // ignore
    }
  });
}

chrome.runtime.sendMessage({ cmd: "ensure_injected" }).catch(() => {});
loadConnectionState().catch((error) => {
  setConnectionState(false);
  setStatus(String(error?.message || error), "error");
});
