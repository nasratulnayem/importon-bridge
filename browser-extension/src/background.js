/* global chrome */

const DEFAULTS = {
  wpBaseUrl: "",
  wpUser: "",
  wpAppPassword: "",
  updateExisting: true,
  downloadImages: true,
  defaultCategoryId: 0,
  askCategoryBeforeImport: true,
  maxPageItems: 20,
  variationPriceStrategy: "min",
  importedProductUrls: []
};

const activeImportRuns = new Map();
const activeDashboardBatches = new Map();

function makeImportId() {
  return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function beginImportRun(tabId, preferredId = "") {
  const id = String(preferredId || "").trim() || makeImportId();
  const run = { id, tabId, cancelled: false };
  activeImportRuns.set(tabId, run);
  return run;
}

function finishImportRun(tabId, run) {
  if (activeImportRuns.get(tabId) === run) {
    activeImportRuns.delete(tabId);
  }
}

async function sendImportProgress(tabId, run, payload = {}) {
  if (!tabId || !run) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      cmd: "importonbridge_import_progress",
      importId: run.id,
      ...(payload || {})
    });
  } catch {
    // ignore (content script may be unavailable briefly)
  }
}

async function sendUrlImportBatchProgress(tabId, runId, payload = {}) {
  if (!tabId || !runId) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      cmd: "importonbridge_url_import_batch_progress",
      runId,
      ...(payload || {})
    });
  } catch {
    // ignore (bridge script may be reloading)
  }
}

function b64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function normalizeWpUser(u) {
  return String(u || "").trim();
}

function normalizeWpAppPassword(p) {
  // Allow copy/paste with spaces; WP strips non-alnum internally, but keep it clean here too.
  return String(p || "").replace(/\s+/g, "").trim();
}

function buildBasicAuthHeader(wpUser, wpAppPassword) {
  const u = normalizeWpUser(wpUser);
  const p = normalizeWpAppPassword(wpAppPassword);
  return `Basic ${b64(`${u}:${p}`)}`;
}

async function getSettings() {
  const [syncVals, localVals] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get(DEFAULTS)
  ]);
  // Prefer local values for immediacy after popup changes.
  return { ...DEFAULTS, ...syncVals, ...localVals };
}

async function setSettings(partial = {}) {
  const cur = await getSettings();
  const next = { ...cur, ...(partial || {}) };
  await Promise.all([
    chrome.storage.sync.set(next),
    chrome.storage.local.set(next)
  ]);
  return next;
}

function isAlibabaTabUrl(url) {
  try {
    const u = String(url || "");
    return /^https?:\/\/([^.]+\.)*alibaba\.com\//i.test(u) || u.startsWith("file://");
  } catch {
    return false;
  }
}

function isWpAdminUrl(url) {
  try {
    return /^https?:\/\/.+\/wp-admin(?:[/?#]|$)/i.test(String(url || "").trim());
  } catch {
    return false;
  }
}

async function injectAlibabaContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["src/content.js"]
  });
}

async function injectWpAdminBridgeScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/wp-admin-bridge.js"]
  });
}

async function injectSupportScriptsForTab(tabId, url = "") {
  if (!tabId) return false;

  if (isAlibabaTabUrl(url)) {
    try {
      await injectAlibabaContentScript(tabId);
    } catch (e) {
      try {
        chrome.action.setBadgeText({ tabId, text: "!" });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#ff0033" });
      } catch {
        // ignore
      }
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "src/icon48.png",
          title: "Importon Bridge needs site access",
          message: "Enable Site access for alibaba.com in Chrome's site access settings."
        });
      } catch {
        // ignore
      }
      throw e;
    }
    return true;
  }

  if (isWpAdminUrl(url)) {
    await injectWpAdminBridgeScript(tabId);
    return true;
  }

  return false;
}

async function primeInjectableTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    (Array.isArray(tabs) ? tabs : []).map((tab) =>
      injectSupportScriptsForTab(tab?.id, tab?.url || "").catch(() => {})
    )
  );
}

function normalizeImportedUrls(value) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of arr) {
    const s = String(item || "").trim().toLowerCase();
    if (!s) continue;
    if (s.length > 255) continue;
    out.push(s);
    if (out.length >= 500) break;
  }
  return Array.from(new Set(out));
}

function normalizeSyncedSettings(input = {}) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(input, "updateExisting")) out.updateExisting = !!input.updateExisting;
  if (Object.prototype.hasOwnProperty.call(input, "downloadImages")) out.downloadImages = !!input.downloadImages;
  if (Object.prototype.hasOwnProperty.call(input, "showCardButtons")) out.showCardButtons = !!input.showCardButtons;
  if (Object.prototype.hasOwnProperty.call(input, "askCategoryBeforeImport")) out.askCategoryBeforeImport = !!input.askCategoryBeforeImport;
  if (Object.prototype.hasOwnProperty.call(input, "defaultCategoryId")) out.defaultCategoryId = toPositiveInt(input.defaultCategoryId);
  if (Object.prototype.hasOwnProperty.call(input, "maxPageItems")) {
    const n = Number(input.maxPageItems);
    out.maxPageItems = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : DEFAULTS.maxPageItems;
  }
  if (Object.prototype.hasOwnProperty.call(input, "variationPriceStrategy")) {
    const s = String(input.variationPriceStrategy || "").toLowerCase();
    out.variationPriceStrategy = ["min", "max", "avg", "first"].includes(s) ? s : DEFAULTS.variationPriceStrategy;
  }
  if (Object.prototype.hasOwnProperty.call(input, "importedProductUrls")) {
    out.importedProductUrls = normalizeImportedUrls(input.importedProductUrls);
  }
  return out;
}

function mergeImportSettings(baseSettings, override = {}) {
  const out = { ...(baseSettings || {}) };
  const baseUrl = normalizeWpBaseUrl(override?.wpBaseUrl);
  const user = normalizeWpUser(override?.wpUser);
  const pass = normalizeWpAppPassword(override?.wpAppPassword);
  const nonce = String(override?.wpNonce || "").trim();
  if (baseUrl) out.wpBaseUrl = baseUrl;
  if (user) out.wpUser = user;
  if (pass) out.wpAppPassword = pass;
  if (nonce) out.wpNonce = nonce;
  return out;
}

function normalizeWpBaseUrl(url) {
  url = (url || "").trim();
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

async function execInTab(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args
  });
  return res?.result;
}

function parseFirstNumber(s) {
  if (!s) return null;
  const m = String(s).match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseAllNumbers(s) {
  if (s == null) return [];
  const matches = String(s).replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/g) || [];
  const out = [];
  for (const m of matches) {
    const n = Number(m);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function pickNumberByStrategy(numbers, strategy = "min") {
  const vals = Array.isArray(numbers) ? numbers.filter((n) => Number.isFinite(Number(n))).map(Number) : [];
  if (!vals.length) return null;
  if (strategy === "max") return Math.max(...vals);
  if (strategy === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (strategy === "first") return vals[0];
  return Math.min(...vals);
}

function parsePriceFromAny(value, strategy = "min", depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return pickNumberByStrategy(parseAllNumbers(value), strategy);
  if (Array.isArray(value)) {
    const nums = [];
    for (const item of value) {
      const n = parsePriceFromAny(item, strategy, depth + 1);
      if (n != null) nums.push(n);
    }
    return pickNumberByStrategy(nums, strategy);
  }
  if (typeof value === "object") {
    const nums = [];
    for (const v of Object.values(value)) {
      const n = parsePriceFromAny(v, strategy, depth + 1);
      if (n != null) nums.push(n);
    }
    return pickNumberByStrategy(nums, strategy);
  }
  return null;
}

function parseQtyRangeLabel(label) {
  const txt = String(label || "").replace(/,/g, "").trim();
  if (!txt) return { min_qty: 0, max_qty: 0 };
  const nums = parseAllNumbers(txt);
  if (txt.includes(">=") && nums[0] != null) return { min_qty: Math.max(1, Math.floor(nums[0])), max_qty: 0 };
  if (nums.length >= 2) return { min_qty: Math.max(1, Math.floor(nums[0])), max_qty: Math.max(0, Math.floor(nums[1])) };
  if (nums.length === 1) return { min_qty: Math.max(1, Math.floor(nums[0])), max_qty: 0 };
  return { min_qty: 0, max_qty: 0 };
}

function normalizePriceTiers(rawTiers, strategy = "first") {
  const out = [];
  const arr = Array.isArray(rawTiers) ? rawTiers : [];
  for (const t of arr) {
    if (!t || typeof t !== "object") continue;
    const price = parsePriceFromAny(
      t.price ?? t.skuPrice ?? t.formatPrice ?? t.priceRaw ?? t.amount ?? t.value,
      strategy
    );
    if (price == null) continue;
    let minQty = toPositiveInt(t.min_qty ?? t.minQty ?? t.beginAmount ?? t.startQty ?? t.fromQty ?? t.min);
    let maxQty = toPositiveInt(t.max_qty ?? t.maxQty ?? t.endAmount ?? t.endQty ?? t.toQty ?? t.max);
    if (!minQty && !maxQty) {
      const fromLabel = t.qtyLabel ?? t.quantityLabel ?? t.title ?? t.range ?? t.quantityRange;
      const parsed = parseQtyRangeLabel(fromLabel);
      minQty = parsed.min_qty;
      maxQty = parsed.max_qty;
    }
    if (!minQty) minQty = 1;
    out.push({ min_qty: minQty, max_qty: maxQty, price: price });
  }
  out.sort((a, b) => a.min_qty - b.min_qty);
  return out;
}

function getByPath(obj, path) {
  try {
    const segs = String(path || "").split(".");
    let cur = obj;
    for (const s of segs) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[s];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function collectLikelyPriceValues(input, out, depth = 0) {
  if (depth > 5 || input == null || typeof input !== "object") return;
  for (const [k, v] of Object.entries(input)) {
    const key = String(k || "").toLowerCase();
    const likelyPriceKey = /(price|amount|cost|value)/.test(key);
    const blockedKey = /(inventory|stock|quantity|qty|moq|min.?order|warehouse)/.test(key);
    if (likelyPriceKey && !blockedKey) {
      out.push(v);
    }
    if (v && typeof v === "object") collectLikelyPriceValues(v, out, depth + 1);
  }
}

function extractVariationPrice(info, strategy = "first") {
  const orderedPaths = [
    "price",
    "skuPrice",
    "salePrice",
    "finalPrice",
    "tradePrice",
    "priceInfo.price",
    "priceInfo.value",
    "priceInfo.priceText",
    "skuVal.actSkuCalPrice",
    "skuVal.skuCalPrice",
    "skuVal.skuPrice",
    "skuVal.price",
    "skuVal.discountPrice",
    "offerPrice",
    "offerPriceText",
    "orderPrice",
    "formatPrice",
    "priceRaw",
    "priceRange"
  ];
  for (const path of orderedPaths) {
    const n = parsePriceFromAny(getByPath(info, path), strategy);
    if (n != null) return n;
  }
  const candidates = [];
  collectLikelyPriceValues(info, candidates);
  for (const c of candidates) {
    const n = parsePriceFromAny(c, strategy);
    if (n != null) return n;
  }
  return null;
}

function extractPrimaryProductPrice(priceObj, strategy = "first") {
  if (!priceObj || typeof priceObj !== "object") return null;

  const orderedPaths = [
    "price",
    "formatPrice",
    "salePrice",
    "discountPrice",
    "finalPrice",
    "priceText",
    "priceInfo.price",
    "priceInfo.value",
    "priceInfo.priceText",
    "skuPrice",
    "offerPrice",
    "offerPriceText",
    "orderPrice"
  ];

  for (const path of orderedPaths) {
    const n = parsePriceFromAny(getByPath(priceObj, path), strategy);
    if (n != null) return n;
  }

  return null;
}

function extractCurrencyCodeFromPattern(pattern) {
  // Examples: "BDT&nbsp;{0}" / "US $ {0}" / "€{0}"
  if (!pattern) return "";
  const txt = String(pattern).replace(/&nbsp;|&#160;|\s+/g, " ").trim();
  // Try 3-letter ISO-ish codes first.
  const m = txt.match(/\b([A-Z]{3})\b/);
  if (m) return m[1];
  // Fallback: return prefix before {0}
  return txt.split("{0}")[0].trim().slice(0, 10);
}

function titleCase(s) {
  s = String(s || "").trim();
  if (!s) return "";
  return s
    .replace(/[_-]+/g, " ")
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function isLikelyVideoUrl(u) {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes(".mp4") ||
    s.includes(".webm") ||
    s.includes(".mov") ||
    s.includes(".m3u8")
  );
}

function toAbsHttpUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  return s;
}

function validateImportUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "Invalid URL.";
  if (!/^https?:\/\//i.test(s)) {
    return "URL must start with http:// or https://.";
  }

  try {
    new URL(s);
  } catch {
    return "Invalid URL.";
  }

  return "";
}

function looksLikeRobotBlockedPage(docData = {}) {
  const pieces = [
    docData?.pageTitle,
    docData?.bodyText,
    docData?.metaDescription,
    docData?.ogTitle
  ]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
  const text = pieces.join(" ");
  if (!text) return "";

  if (
    /captcha|verify you are human|unusual traffic|access denied|security check|challenge required|prove you're human|prove you are human|sorry, we just need to make sure|i am not a robot|not a robot/i.test(text)
  ) {
    return "Source page is blocked by robot verification or access protection. Open the URL in a normal browser tab, complete verification, then retry this product.";
  }

  return "";
}

async function surfaceWorkerForUser(worker) {
  try {
    if (worker?.windowId) {
      await chrome.windows.update(worker.windowId, { focused: true, state: "normal" });
    }
  } catch {
    // ignore
  }
  try {
    if (worker?.tabId) {
      await chrome.tabs.update(worker.tabId, { active: true });
    }
  } catch {
    // ignore
  }
}

function collectVideoUrlsDeep(input, out, depth = 0) {
  if (!input || depth > 8) return;

  if (typeof input === "string") {
    const u = toAbsHttpUrl(input);
    if (isLikelyVideoUrl(u)) out.add(u);
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) collectVideoUrlsDeep(item, out, depth + 1);
    return;
  }

  if (typeof input === "object") {
    for (const v of Object.values(input)) {
      collectVideoUrlsDeep(v, out, depth + 1);
    }
  }
}

function buildWpEndpoint(baseUrl, path) {
  const base = normalizeWpBaseUrl(baseUrl);
  if (!base) return "";
  const p = String(path || "").replace(/^\/+/, "");
  return `${base}/${p}`;
}

function buildWpRestRouteFallback(baseUrl, restRoute) {
  // Works even if Apache rewrite for /wp-json/* is broken.
  const base = normalizeWpBaseUrl(baseUrl);
  if (!base) return "";
  const rr = String(restRoute || "").replace(/^\/+/, "");
  return `${base}/?rest_route=/${rr}`;
}

function toPositiveInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function fetchWithRestFallback(baseUrl, wpJsonPath, restRoute, init) {
  const requestInit = {
    credentials: "include",
    ...(init || {})
  };
  const url1 = buildWpEndpoint(baseUrl, wpJsonPath);
  const r1 = await fetch(url1, requestInit);
  const ct1 = String(r1.headers.get("content-type") || "").toLowerCase();
  const looksJson1 = ct1.includes("application/json") || ct1.includes("application/problem+json");
  if (r1.status !== 404 && !r1.redirected && looksJson1) return r1;

  // Retry with ?rest_route= fallback when /wp-json/ is missing, redirected, or returned non-JSON.
  const url2 = buildWpRestRouteFallback(baseUrl, restRoute);
  return fetch(url2, requestInit);
}

function buildWpRequestHeaders(settings, extraHeaders = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (settings?.wpUser && settings?.wpAppPassword) {
    headers.Authorization = buildBasicAuthHeader(settings.wpUser, settings.wpAppPassword);
  }
  if (settings?.wpNonce) {
    headers["X-WP-Nonce"] = String(settings.wpNonce).trim();
  }
  return headers;
}

async function testWpAuth(settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  if (!base) throw new Error("Set WordPress Base URL.");
  if (!settings.wpUser || !settings.wpAppPassword) {
    throw new Error("Set WordPress username + application password.");
  }

  // Prefer plugin ping: this works even if wp/v2/users/me is blocked or app-password auth is flaky.
  const resp = await fetchWithRestFallback(
    base,
    "wp-json/importonbridge/v1/ping",
    "importonbridge/v1/ping",
    { method: "GET", headers: buildWpRequestHeaders(settings) }
  );

  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${resp.status}`;
    throw new Error(String(msg).slice(0, 300));
  }

  return { ok: true, user: data?.user_login || data?.user_id || "user" };
}

async function fetchWpCategories(settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  if (!base) throw new Error("Set WordPress Base URL.");
  if (!settings.wpUser || !settings.wpAppPassword) {
    throw new Error("Set WordPress username + application password.");
  }
  let data = null;

  const pingResp = await fetchWithRestFallback(
    base,
    "wp-json/importonbridge/v1/ping",
    "importonbridge/v1/ping",
    { method: "GET", headers: buildWpRequestHeaders(settings) }
  );
  const pingText = await pingResp.text();
  try {
    data = JSON.parse(pingText);
  } catch {
    data = null;
  }

  if (!pingResp.ok) {
    const msg = data?.message || data?.error || pingText || `HTTP ${pingResp.status}`;
    throw new Error(String(msg).slice(0, 300));
  }

  const categories = Array.isArray(data?.categories) ? data.categories : [];

  return {
    ok: true,
    categories: categories
      .map((c) => ({
        id: toPositiveInt(c?.id),
        name: String(c?.name || ""),
        path: String(c?.path || c?.name || ""),
        parent: toPositiveInt(c?.parent),
        slug: String(c?.slug || "")
      }))
      .filter((c) => c.id > 0 && c.name)
  };
}

async function getConnectionState(settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  const configured = !!(base && settings.wpUser && settings.wpAppPassword);
  const cachedCategories = Array.isArray(settings.cachedCategories) ? settings.cachedCategories : [];
  let connected = !!settings.authPassed && configured;
  let authError = "";
  let user = "";

  if (configured && connected) {
    try {
      const res = await testWpAuth(settings);
      user = String(res?.user || "");
      if (!user) connected = false;
    } catch (e) {
      connected = false;
      authError = String(e?.message || e).slice(0, 200);
      await setSettings({ authPassed: false });
    }
  }

  return {
    ok: true,
    configured,
    connected,
    authError,
    wpBaseUrl: base,
    user,
    defaultCategoryId: toPositiveInt(settings.defaultCategoryId),
    categories: cachedCategories
  };
}

async function connectExtension(input = {}) {
  const settings = mergeImportSettings(await getSettings(), input);
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  if (!base) throw new Error("Set WordPress Base URL.");
  if (!settings.wpUser || !settings.wpAppPassword) {
    throw new Error("Set WordPress username + application password.");
  }

  const auth = await testWpAuth(settings);
  let categories = [];
  let categoryError = "";

  try {
    const fetched = await fetchWpCategories(settings);
    categories = Array.isArray(fetched?.categories) ? fetched.categories : [];
  } catch (e) {
    categoryError = String(e?.message || e).slice(0, 200);
    const currentSettings = await getSettings();
    const cachedCategories = Array.isArray(currentSettings.cachedCategories) ? currentSettings.cachedCategories : [];
    categories = cachedCategories;
  }

  await setSettings({
    wpBaseUrl: base,
    wpUser: normalizeWpUser(settings.wpUser),
    wpAppPassword: normalizeWpAppPassword(settings.wpAppPassword),
    authPassed: true,
    cachedCategories: categories
  });

  return {
    ok: true,
    connected: true,
    user: auth?.user || "user",
    wpBaseUrl: base,
    defaultCategoryId: toPositiveInt(settings.defaultCategoryId),
    categories,
    categoryError
  };
}

async function disconnectExtension() {
  await setSettings({ authPassed: false });
  return { ok: true, connected: false };
}

async function pullSettingsFromWordPress(settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  if (!base) throw new Error("Set WordPress Base URL.");
  if (!settings.wpUser || !settings.wpAppPassword) {
    throw new Error("Set WordPress username + application password.");
  }
  const resp = await fetchWithRestFallback(
    base,
    "wp-json/importonbridge/v1/settings",
    "importonbridge/v1/settings",
    { method: "GET", headers: buildWpRequestHeaders(settings) }
  );
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!resp.ok) {
    const msg = data?.error || data?.message || text || `HTTP ${resp.status}`;
    throw new Error(String(msg).slice(0, 300));
  }
  const normalized = normalizeSyncedSettings(data?.settings || {});
  const merged = await setSettings(normalized);
  return { ok: true, settings: merged };
}

async function pushSettingsToWordPress(inputSettings = {}, settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  if (!base || !settings.wpUser || !settings.wpAppPassword) {
    // No auth yet: keep local only.
    const mergedLocal = await setSettings(normalizeSyncedSettings(inputSettings || {}));
    return { ok: true, settings: mergedLocal, skippedRemote: true };
  }

  const syncData = normalizeSyncedSettings(inputSettings || {});
  const resp = await fetchWithRestFallback(
    base,
    "wp-json/importonbridge/v1/settings",
    "importonbridge/v1/settings",
    {
      method: "POST",
      headers: buildWpRequestHeaders(settings, { "Content-Type": "application/json" }),
      body: JSON.stringify({ settings: syncData })
    }
  );
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!resp.ok) {
    const msg = data?.error || data?.message || text || `HTTP ${resp.status}`;
    throw new Error(String(msg).slice(0, 300));
  }
  const normalized = normalizeSyncedSettings(data?.settings || syncData);
  const merged = await setSettings(normalized);
  return { ok: true, settings: merged };
}

async function wpImport(payload, settings) {
  const base = normalizeWpBaseUrl(settings.wpBaseUrl);
  if (!base) throw new Error("Set WordPress Base URL in Importon Bridge.");
  if (!settings.wpUser || !settings.wpAppPassword) {
    throw new Error("Set WordPress username + application password in Importon Bridge.");
  }

  const resp = await fetchWithRestFallback(
    base,
    "wp-json/importonbridge/v1/import",
    "importonbridge/v1/import",
    {
      method: "POST",
      headers: buildWpRequestHeaders(settings, {
        "Content-Type": "application/json"
      }),
      body: JSON.stringify(payload)
    }
  );
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!resp.ok) {
    const msg = data?.error || data?.message || text || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Strip Alibaba branding/sourcing text from scraped meta descriptions.
 * Alibaba meta descriptions often end with "...Supplier or Manufacturer on Alibaba.com"
 * or contain "Find Complete Details about ... from [Company] on Alibaba.com."
 */
function cleanAlibabaMeta(text) {
  if (!text) return "";
  let s = text.trim();

  // Remove "Supplier or Manufacturer on Alibaba.com" suffix (and preceding context)
  s = s.replace(/[.,]?\s*(?:Find Complete Details about[\s\S]*?on\s+Alibaba\.com[^.]*\.?\s*)?(?:Supplier(?:s)?(?:\s*or\s*Manufacturer(?:s)?)?[\s\S]*?on\s+Alibaba\.com[^.]*\.?)/gi, "");

  // Remove "from [Company] on Alibaba.com" fragments
  s = s.replace(/\s*from\s+[\s\S]*?on\s+Alibaba\.com[^.]*\.?/gi, "");

  // Remove generic "from [Company Limited]" fragments even when Alibaba.com is omitted.
  s = s.replace(/\s*from\s+[A-Z][A-Za-z0-9&'().,\-]*(?:\s+[A-Z][A-Za-z0-9&'().,\-]*){1,10}\s+(?:company\s+limited|limited|co\.?\s*,?\s*ltd\.?|inc\.?|llc|corp\.?|corporation)\b[.,:]*/g, "");

  // Remove any remaining "on Alibaba.com" references
  s = s.replace(/\s*on\s+Alibaba\.com[^.]*\.?/gi, "");

  // Remove "Find Complete Details about ... ." sentence fragments
  s = s.replace(/Find Complete Details about[\s\S]*?(?:on\s+Alibaba\.com[^.]*\.?|\.\s*)/gi, "");
  s = s.replace(/Find Complete Details about[\s\S]*$/gi, "");

  // Remove leftover company suffix fragments that can remain after stripping
  // "from Supplier Co., Ltd. on Alibaba.com" patterns.
  s = s.replace(/(?:\s*,\s*)+(?:co\.?\s*)?(?:,\s*)?(?:ltd|limited)\.?$/i, "");
  s = s.replace(/(?:\s*,\s*)+(?:inc|corp|corporation|llc)\.?$/i, "");

  // Clean up double spaces and punctuation left behind
  s = s
    .replace(/(?:\s*,\s*){2,}/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*\.\s*\./g, ".")
    .trim()
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "");

  return s;
}

function normalizeFactText(value) {
  if (value == null) return "";
  let s = String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  s = cleanAlibabaMeta(s);
  return s.replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, "").trim();
}

function normalizeFactLabel(value) {
  const label = normalizeFactText(value);
  return label ? titleCase(label) : "";
}

function collectAlibabaPropertyRows(...groups) {
  const rows = [];
  const seen = new Set();

  for (const group of groups) {
    const items = Array.isArray(group) ? group : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const label = normalizeFactLabel(item.attrName ?? item.name ?? item.label);
      const value = normalizeFactText(item.attrValue ?? item.value ?? item.text);
      if (!label || !value) continue;
      if (/(supplier|manufacturer|factory|seller|company)/i.test(label)) continue;
      const key = `${label}::${value}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ label, value });
    }
  }

  return rows;
}

function findPropertyValue(rows, labels = []) {
  const wanted = new Set((Array.isArray(labels) ? labels : []).map((label) => String(label || "").trim().toLowerCase()));
  if (!wanted.size) return "";
  for (const row of Array.isArray(rows) ? rows : []) {
    const label = String(row?.label || "").trim().toLowerCase();
    if (wanted.has(label)) return normalizeFactText(row?.value);
  }
  return "";
}

function formatPriceValue(value, currency = "") {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const cleaned = normalizeFactText(value);
    if (cleaned) return cleaned;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const formatted = numeric.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2
  });
  return currency ? `${currency} ${formatted}`.trim() : formatted;
}

function buildPriceTierSummary(priceTiers, currency = "", unitLabel = "") {
  const tiers = Array.isArray(priceTiers) ? priceTiers : [];
  const unit = normalizeFactText(unitLabel);
  const parts = [];

  for (const tier of tiers.slice(0, 5)) {
    const price = formatPriceValue(tier?.price, currency);
    if (!price) continue;
    const minQty = toPositiveInt(tier?.min_qty);
    const maxQty = Number(tier?.max_qty);
    let range = `${minQty || 1}+`;
    if (Number.isFinite(maxQty) && maxQty > 0) {
      range = `${minQty || 1}-${Math.floor(maxQty)}`;
    }
    if (unit) range += ` ${unit}`;
    parts.push(`${range}: ${price}`);
  }

  return parts.join(" | ");
}

function buildLeadTimeSummary(leadTimeRows, unitLabel = "") {
  const rows = Array.isArray(leadTimeRows) ? leadTimeRows : [];
  const unit = normalizeFactText(unitLabel);
  const parts = [];

  for (const row of rows.slice(0, 5)) {
    const minQty = toPositiveInt(row?.minQuantity ?? row?.localMinQuantity);
    const maxRaw = row?.maxQuantity ?? row?.localMaxQuantity;
    const maxQty = Number(maxRaw);
    const days = toPositiveInt(row?.processPeriod);
    if (!days) continue;

    let range = `${minQty || 1}+`;
    if (Number.isFinite(maxQty) && maxQty > 0) {
      range = `${minQty || 1}-${Math.floor(maxQty)}`;
    }
    if (unit) range += ` ${unit}`;
    parts.push(`${range}: ${days} days`);
  }

  return parts.join(" | ");
}

function extractCertificationNames(certifications) {
  const certs = Array.isArray(certifications) ? certifications : [];
  const out = [];
  const seen = new Set();

  for (const cert of certs) {
    const name = normalizeFactText(cert?.certName || cert?.summary?.sellingPoint || cert?.title);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }

  return out;
}

function buildReviewSummary(review) {
  if (!review || typeof review !== "object") return "";
  const average = Number(review.averageStar);
  const total = toPositiveInt(review.totalReviewCount);
  const parts = [];

  if (Number.isFinite(average) && average > 0) {
    parts.push(`${average}/5`);
  }
  if (total > 0) {
    parts.push(`${total} review${total === 1 ? "" : "s"}`);
  }

  return parts.join(" from ");
}

function buildRichAlibabaContext(detailData, docData, payload) {
  const gd = detailData?.globalData || {};
  const prod = gd?.product || {};
  const trade = gd?.trade || {};
  const review = gd?.review?.productReview || {};
  const propertyRows = collectAlibabaPropertyRows(
    prod?.productBasicProperties,
    prod?.productOtherProperties,
    prod?.productKeyIndustryProperties
  );
  const cleanMeta = normalizeFactText(docData?.jsonLdDescription || docData?.metaDescription || "");
  const productName = normalizeFactText(payload?.name || prod?.subject || docData?.ogTitle || docData?.jsonLdName || "");
  const unitLabel = normalizeFactText(
    payload?.min_order_unit ||
      trade?.tradeInfo?.quantityUnitStr ||
      prod?.price?.unitEven ||
      prod?.price?.unit
  );
  const sections = [];
  const overviewLines = [];
  const overviewFacts = [];

  if (productName) {
    overviewLines.push(`- Product name: ${productName}.`);
  }

  for (const label of ["Type", "Material", "Capacity", "Use", "Applicable People", "With Rack Or Not"]) {
    const value = findPropertyValue(propertyRows, [label]);
    if (value) overviewFacts.push(`${label}: ${value}`);
  }

  if (cleanMeta && cleanMeta.length >= 45) {
    overviewLines.push(`- Product summary: ${cleanMeta}.`);
  } else if (overviewFacts.length) {
    overviewLines.push(`- Product summary: ${overviewFacts.slice(0, 5).join("; ")}.`);
  }

  if (overviewLines.length) {
    sections.push(["Product Overview:", ...overviewLines].join("\n"));
  }

  const specLines = propertyRows.slice(0, 14).map((row) => `- ${row.label}: ${row.value}.`);
  if (specLines.length) {
    sections.push(["Key Specifications:", ...specLines].join("\n"));
  }

  const orderLines = [];
  if (payload?.moq) {
    orderLines.push(`- Minimum order quantity: ${normalizeFactText(payload.moq)}${unitLabel ? ` ${unitLabel}` : ""}.`);
  }

  const priceTiers = buildPriceTierSummary(payload?.price_tiers, payload?.currency, unitLabel);
  if (priceTiers) {
    orderLines.push(`- Price tiers: ${priceTiers}.`);
  }

  if (prod?.sampleInfo?.enable) {
    const samplePrice = normalizeFactText(prod?.sampleInfo?.formatPrice || formatPriceValue(prod?.sampleInfo?.price, payload?.currency));
    if (samplePrice) {
      let sampleLine = `- Sample order price: ${samplePrice}`;
      const maxQuantity = toPositiveInt(prod?.sampleInfo?.maxQuantity);
      if (maxQuantity > 0) {
        sampleLine += `, up to ${maxQuantity}${unitLabel ? ` ${unitLabel}` : " pieces"}`;
      }
      orderLines.push(`${sampleLine}.`);
    }
  }

  const leadTime = buildLeadTimeSummary(
    trade?.leadTimeInfo?.ladderPeriodList || trade?.warehouseLeadTimeInfo?.DEFAULT,
    unitLabel
  );
  if (leadTime) {
    orderLines.push(`- Lead time: ${leadTime}.`);
  }

  const unitSize = normalizeFactText(trade?.logisticInfo?.unitSize);
  if (unitSize) {
    orderLines.push(`- Package size: ${unitSize}.`);
  }

  const unitWeight = normalizeFactText(trade?.logisticInfo?.unitWeight);
  if (unitWeight) {
    orderLines.push(`- Package weight: ${unitWeight}.`);
  }

  const salesVolume = normalizeFactText(trade?.salesVolume);
  if (salesVolume) {
    orderLines.push(`- Sales volume: ${salesVolume}.`);
  }

  const reviewSummary = buildReviewSummary(review);
  if (reviewSummary) {
    orderLines.push(`- Buyer rating: ${reviewSummary}.`);
  }

  const certifications = extractCertificationNames(gd?.certification);
  if (certifications.length) {
    orderLines.push(`- Certifications: ${certifications.join(", ")}.`);
  }

  if (orderLines.length) {
    sections.push(["Order And Shipping Details:", ...orderLines].join("\n"));
  }

  const shortPieces = [];
  const shortType = findPropertyValue(propertyRows, ["Type"]);
  const shortMaterial = findPropertyValue(propertyRows, ["Material"]);
  const shortCapacity = findPropertyValue(propertyRows, ["Capacity"]);
  const shortUse = findPropertyValue(propertyRows, ["Use"]);
  if (shortType) shortPieces.push(shortType);
  if (shortMaterial) shortPieces.push(`Material: ${shortMaterial}`);
  if (shortCapacity) shortPieces.push(`Capacity: ${shortCapacity}`);
  if (shortUse) shortPieces.push(`Use: ${shortUse}`);
  if (payload?.moq) {
    shortPieces.push(`MOQ: ${normalizeFactText(payload.moq)}${unitLabel ? ` ${unitLabel}` : ""}`);
  }

  const shortDescription = cleanMeta && cleanMeta.length >= 45
    ? cleanMeta
    : [productName, shortPieces.join(". ")].filter(Boolean).join(". ").trim().replace(/\.\s*\./g, ".");

  return {
    text: sections.join("\n\n").trim(),
    shortDescription: normalizeFactText(shortDescription),
    propertyRows,
    metaDescription: cleanMeta
  };
}

function buildPayloadFromDetail(detailData, docData, url, settings) {
  const priceStrategy = ["min", "max", "avg", "first"].includes(String(settings?.variationPriceStrategy || "").toLowerCase())
    ? String(settings.variationPriceStrategy).toLowerCase()
    : "min";
  const payload = {
    sku: "",
    name: "",
    description: "",
    short_description: "",
    regular_price: "",
    price_tiers: [],
    images: [],
    // Optional: variable products (variations).
    product_type: "simple",
    attributes: [],
    variations: [],
    video_urls: [],
    video_poster: "",
    source_url: url,
    visit_country: "",
    currency: "",
    price_raw: "",
    moq: "",
    min_order_unit: "",
    supplier_name: "",
    update_existing: !!settings.updateExisting,
    download_images: !!settings.downloadImages,
    raw: {}
  };

  // Prefer detailData (window.detailData), fallback to JSON-LD and meta.
  const gd = detailData?.globalData || {};
  const prod = gd?.product || {};
  const global = gd?.global || {};

  const productId = prod?.productId ? String(prod.productId) : "";
  payload.sku = productId || docData?.jsonLdSku || docData?.productIdFromUrl || "";

  payload.name =
    (prod?.subject && String(prod.subject).trim()) ||
    docData?.ogTitle ||
    docData?.jsonLdName ||
    "";

  payload.description = cleanAlibabaMeta(
    (docData?.jsonLdDescription || docData?.metaDescription || "").trim()
  );

  payload.short_description = payload.description.slice(0, 400);

  // Visit country/currency
  payload.visit_country = (global?.visitCountry || global?.ipCountry || "").toString();
  payload.currency =
    extractCurrencyCodeFromPattern(prod?.price?.currencyRule?.currencyPattern) ||
    (docData?.jsonLdPriceCurrency || "").toString();

  // Price priority:
  // 1. Visible price from live DOM — exact match to what user sees on screen
  // 2. Explicit product-level current price from detail data (Alibaba API)
  // 3. Ladder/base price
  // 4. JSON-LD offer
  if (docData?.visiblePrice) {
    const visible = parsePriceFromAny(docData.visiblePrice, "min");
    if (visible != null) {
      payload.regular_price = String(visible);
      payload.price_raw = String(docData.visiblePrice);
    }
  }
  if (!payload.regular_price) {
    const primaryProductPrice = extractPrimaryProductPrice(prod?.price, "min");
    if (primaryProductPrice != null) {
      payload.regular_price = String(primaryProductPrice);
      payload.price_raw = String(prod?.price?.formatPrice || primaryProductPrice);
    }
  }

  // Keep ladder tiers for wholesale reference, but only use them as main price fallback.
  const ladder = prod?.price?.productLadderPrices;
  if (Array.isArray(ladder) && ladder.length) {
    const ladderNumbers = ladder
      .map((x) => parsePriceFromAny(x?.price, priceStrategy))
      .filter((n) => n != null);
    const picked = pickNumberByStrategy(ladderNumbers, priceStrategy);
    if (!payload.regular_price && picked != null) {
      payload.regular_price = String(picked);
      payload.price_raw = String(ladder[0]?.formatPrice || picked);
    }
    payload.price_tiers = normalizePriceTiers(
      ladder.map((x) => ({
        min_qty: x?.beginAmount ?? x?.min ?? x?.startQty,
        max_qty: x?.endAmount ?? x?.max ?? x?.endQty,
        qtyLabel: x?.quantity ?? x?.range ?? x?.amount ?? "",
        price: x?.price,
        formatPrice: x?.formatPrice
      })),
      priceStrategy
    );
  } else if (!payload.regular_price && docData?.jsonLdPrice) {
    const p = parsePriceFromAny(docData.jsonLdPrice, priceStrategy);
    if (p != null) payload.regular_price = String(p);
    payload.price_raw = String(docData.jsonLdPrice);
  }

  // MOQ
  if (prod?.moq != null) payload.moq = String(prod.moq);
  if (prod?.price?.unitEven) payload.min_order_unit = String(prod.price.unitEven);

  // Supplier (best-effort)
  payload.supplier_name =
    (gd?.seller?.companyName && String(gd.seller.companyName)) ||
    "";

  // Images: prefer mediaItems
  const imgs = [];
  const mediaItems = Array.isArray(prod?.mediaItems) ? prod.mediaItems : [];
  for (const it of mediaItems) {
    const u = it?.imageUrl?.big || it?.imageUrl?.normal || it?.imageUrl?.small;
    if (u) imgs.push(u);
  }
  if (!imgs.length && Array.isArray(docData?.jsonLdImages)) {
    imgs.push(...docData.jsonLdImages);
  }
  if (!imgs.length && docData?.ogImage) {
    imgs.push(docData.ogImage);
  }
  payload.images = Array.from(new Set(imgs)).slice(0, 12);

  // Videos: capture explicit DOM video src plus anything discoverable in detailData.
  const videoSet = new Set();
  const domVideos = Array.isArray(docData?.videoSources) ? docData.videoSources : [];
  for (const v of domVideos) {
    const u = toAbsHttpUrl(v);
    if (isLikelyVideoUrl(u)) videoSet.add(u);
  }
  collectVideoUrlsDeep(detailData, videoSet);
  payload.video_urls = Array.from(videoSet).slice(0, 6);
  payload.video_poster = String(docData?.videoPoster || "").trim();

  const richContext = buildRichAlibabaContext(detailData, docData, payload);
  if (richContext?.text) {
    payload.description = richContext.text;
    payload.description_context = richContext.text;
  }
  if (richContext?.shortDescription) {
    payload.short_description = richContext.shortDescription;
  }

  payload.raw = {
    detailData: detailData || null,
    doc: docData || null,
    extracted_context: richContext || null
  };

  // Variations (Alibaba SKU)
  try {
    const sku = detailData?.globalData?.product?.sku;
    const inv = detailData?.globalData?.inventory?.skuInventory || {};
    const skuAttrs = Array.isArray(sku?.skuAttrs) ? sku.skuAttrs : [];
    const skuInfoMap = sku?.skuInfoMap && typeof sku.skuInfoMap === "object" ? sku.skuInfoMap : null;

    // Build attributes list (for variable products).
    const attrs = [];
    for (const a of skuAttrs) {
      const aname = titleCase(a?.name || "");
      const values = Array.isArray(a?.values) ? a.values : [];
      const options = Array.from(
        new Set(
          values
            .map((v) => String(v?.name || "").trim())
            .filter(Boolean)
        )
      );
      if (aname && options.length) {
        attrs.push({ name: aname, options });
      }
    }
    payload.attributes = attrs;

    // Build variations only if there are multiple SKUs/options.
    const skuKeys = skuInfoMap ? Object.keys(skuInfoMap) : [];
    const hasOptionVariance = skuAttrs.some((a) => Array.isArray(a?.values) && a.values.length > 1);
    if (skuInfoMap && skuKeys.length > 1 && hasOptionVariance) {
      payload.product_type = "variable";
      const variations = [];
      const seenVariationCombos = new Set();

      // Map attributeId -> attribute object for fast lookup.
      const attrById = new Map(skuAttrs.map((a) => [String(a?.id), a]));
      const expectedAttrNames = attrs.map((a) => String(a?.name || "").trim()).filter(Boolean);

      for (const key of skuKeys) {
        const info = skuInfoMap[key];
        const skuId =
          (info?.id != null ? String(info.id).trim() : "") ||
          (info?.skuId != null ? String(info.skuId).trim() : "") ||
          (info?.skuID != null ? String(info.skuID).trim() : "") ||
          "";
        if (!skuId) continue;

        const segments = String(key || "")
          .split(";")
          .map((s) => String(s || "").trim())
          .filter(Boolean);
        const varAttrs = {};
        let varImage = "";

        for (const seg of segments) {
          const pair = seg.split(":");
          if (pair.length < 2) continue;
          const attrId = pair[0];
          const valId = pair[1];
          const a = attrById.get(String(attrId));
          if (!a) continue;
          const values = Array.isArray(a.values) ? a.values : [];
          const v = values.find((x) => String(x?.id) === String(valId));
          const aname = titleCase(a?.name || "");
          const vname = String(v?.name || "").trim();
          if (aname && vname) varAttrs[aname] = vname;

          const img = v?.originImage || v?.largeImage || v?.smallImage || "";
          if (!varImage && img) varImage = img;
        }

        // Avoid malformed variation rows that would map wrong options in WooCommerce.
        if (!Object.keys(varAttrs).length) continue;
        if (expectedAttrNames.length && Object.keys(varAttrs).length < expectedAttrNames.length) {
          // If Alibaba key misses one attribute in a multi-attr product, skip inaccurate row.
          continue;
        }
        const comboKey = expectedAttrNames.length
          ? expectedAttrNames.map((n) => `${n}=${String(varAttrs[n] || "")}`).join("|")
          : JSON.stringify(varAttrs);
        if (seenVariationCombos.has(comboKey)) continue;
        seenVariationCombos.add(comboKey);

        // Stock (best effort)
        let stockQty = null;
        const invCount = inv?.[skuId]?.warehouseInventoryList?.[0]?.inventoryCount;
        if (invCount != null && Number.isFinite(Number(invCount))) stockQty = Number(invCount);

        // Price (strict per-variation): try variation-level fields only.
        const vp = extractVariationPrice(info, priceStrategy);
        let price = vp != null ? String(vp) : "";
        if (!price && payload.regular_price) price = payload.regular_price;
        const varTiers = normalizePriceTiers(
          [
            ...(Array.isArray(info?.productLadderPrices) ? info.productLadderPrices : []),
            ...(Array.isArray(info?.priceList) ? info.priceList : []),
            ...(Array.isArray(info?.priceRangeList) ? info.priceRangeList : []),
            ...(Array.isArray(info?.tierPrices) ? info.tierPrices : [])
          ],
          priceStrategy
        );

        variations.push({
          sku: skuId,
          regular_price: price,
          price_tiers: varTiers,
          attributes: varAttrs,
          image: varImage ? (String(varImage).startsWith("//") ? `https:${varImage}` : String(varImage)) : "",
          stock_quantity: stockQty
        });
      }

      payload.variations = variations;
    }
  } catch {
    // ignore variation parsing
  }

  return payload;
}

function buildPayloadFromSearchItem(item, url, settings) {
  const priceStrategy = ["min", "max", "avg", "first"].includes(String(settings?.variationPriceStrategy || "").toLowerCase())
    ? String(settings.variationPriceStrategy).toLowerCase()
    : "min";
  const productId = String(item.productId || item.id || "").trim();
  const title = String(item.title || "").trim();
  const detailUrl = String(item.detailUrl || "").trim();

  const payload = {
    sku: productId,
    name: title,
    description: "",
    short_description: "",
    regular_price: "",
    images: [],
    source_url: url,
    visit_country: "",
    currency: "",
    price_raw: String(item.priceRaw || ""),
    moq: String(item.minOrderQuality || ""),
    min_order_unit: String(item.minOrderUnit || ""),
    supplier_name: String(item.companyName || ""),
    update_existing: !!settings.updateExisting,
    download_images: !!settings.downloadImages,
    raw: { item }
  };

  // Best-effort price parse
  const n = parsePriceFromAny(payload.price_raw, priceStrategy);
  if (n != null) payload.regular_price = String(n);

  // Images
  const imgs = Array.isArray(item.images) ? item.images : [];
  payload.images = Array.from(new Set(imgs)).slice(0, 12);

  return payload;
}

function applySelectedCategory(payload, settings, selectedCategoryId) {
  const cid = toPositiveInt(selectedCategoryId) || toPositiveInt(settings?.defaultCategoryId);
  if (cid > 0) {
    payload.category_id = cid;
    payload.category_ids = [cid];
  }
}

async function importCurrentProduct(tabId, selectedCategoryId = 0, settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const url = await execInTab(tabId, () => location.href);

  const data = await execInTab(tabId, () => {
    // Collect both JS global and document-derived data in the page context.
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
    const ogImage = document.querySelector('meta[property="og:image"]')?.content || "";
    const metaDescription = document.querySelector('meta[name="description"]')?.content || "";
    const ogVideo =
      document.querySelector('meta[property="og:video:secure_url"]')?.content ||
      document.querySelector('meta[property="og:video:url"]')?.content ||
      document.querySelector('meta[property="og:video"]')?.content ||
      "";

    let jsonLdName = "";
    let jsonLdDescription = "";
    let jsonLdSku = "";
    let jsonLdPrice = "";
    let jsonLdPriceCurrency = "";
    let jsonLdImages = [];
    let visiblePrice = "";

    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      const txt = el.textContent?.trim();
      if (!txt) continue;
      try {
        const obj = JSON.parse(txt);
        const candidates = Array.isArray(obj) ? obj : [obj];
        for (const c of candidates) {
          if (typeof c?.name === "string" && c.name.length > jsonLdName.length) jsonLdName = c.name;
          if (typeof c?.description === "string" && c.description.length > jsonLdDescription.length) jsonLdDescription = c.description;
          if (typeof c?.sku === "string" && !jsonLdSku) jsonLdSku = c.sku;
          if (Array.isArray(c?.image) && c.image.length) jsonLdImages = c.image;
          if (typeof c?.image === "string") jsonLdImages = [c.image];
          const offers = c?.offers;
          const off = Array.isArray(offers) ? offers[0] : offers;
          if (off) {
            if (off.price != null && !jsonLdPrice) jsonLdPrice = String(off.price);
            if (typeof off.priceCurrency === "string" && !jsonLdPriceCurrency) jsonLdPriceCurrency = off.priceCurrency;
          }
        }
      } catch {
        // ignore
      }
    }

    const m = location.href.match(/_([0-9]+)\.html/);
    const productIdFromUrl = m ? m[1] : "";

    const videoSources = [];
    for (const el of document.querySelectorAll("video[src], video source[src]")) {
      const src = el.getAttribute("src") || "";
      if (src) videoSources.push(src);
    }
    if (ogVideo) videoSources.push(ogVideo);
    const videoPoster = document.querySelector("video[poster]")?.getAttribute("poster") || "";

    const priceSelectors = [
      '[data-testid="product-price"]',
      '[data-role="price"]',
      '[class*="price"]',
      '[class*="Price"]',
      '[class*="amount"]',
      '[class*="Amount"]'
    ];
    const priceRegex = /(?:\b[A-Z]{3}\b\s*)?(?:[$€£¥৳]|USD|EUR|GBP|BDT|AUD|CAD|JPY|SAR|AED)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/;

    for (const selector of priceSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 80) continue;
        if (!priceRegex.test(text)) continue;
        if (/shipping|save|coupon|discount|off|reviews?|sold/i.test(text)) continue;
        visiblePrice = text.match(priceRegex)?.[0] || text;
        break;
      }
      if (visiblePrice) break;
    }

    return {
      detailData: window.detailData || null,
      doc: {
        pageTitle: document.title || "",
        ogTitle,
        ogImage,
        metaDescription,
        jsonLdName,
        jsonLdDescription,
        jsonLdSku,
        jsonLdPrice,
        jsonLdPriceCurrency,
        jsonLdImages,
        visiblePrice,
        productIdFromUrl,
        videoSources,
        videoPoster,
        bodyText: (document.body?.innerText || "").slice(0, 6000)
      }
    };
  });

  const payload = buildPayloadFromDetail(data?.detailData, data?.doc, url, settings);
  applySelectedCategory(payload, settings, selectedCategoryId);

  const blockedReason = looksLikeRobotBlockedPage(data?.doc || {});
  if (blockedReason) {
    throw new Error(blockedReason);
  }

  if (!payload.sku || !payload.name) {
    throw new Error("Could not extract product SKU/title from this page.");
  }

  const res = await wpImport(payload, settings);
  const mediaSuffix = res?.media_deferred ? " Media downloads continue in background." : "";
  return { ok: true, message: `Imported ${payload.sku} -> product #${res.product_id}.${mediaSuffix}` };
}

function extractSearchItemsFromHtml(html, limit) {
  const patterns = [
    /"detailUrl"\s*:\s*"\\\/\\\/www\.alibaba\.com\\\/product-detail\\\//g,
    /"detailUrl"\s*:\s*"\/\/www\.alibaba\.com\/product-detail\//g
  ];

  const hits = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) && hits.length < 500) {
      hits.push(m.index);
    }
  }
  if (!hits.length) return [];

  function tryParseObjectAt(pos) {
    const startAt = Math.max(0, pos - 50000);
    for (let s = pos; s >= startAt; s--) {
      if (html[s] !== "{") continue;
      // Scan forward with brace balance, tracking JSON strings.
      let bal = 0;
      let inQ = false;
      let esc = false;
      for (let i = s; i < html.length; i++) {
        const c = html[i];
        if (inQ) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inQ = false;
          continue;
        }
        if (c === '"') {
          inQ = true;
          continue;
        }
        if (c === "{") bal++;
        else if (c === "}") {
          bal--;
          if (bal === 0) {
            const end = i + 1;
            if (!(s < pos && pos < end)) break;
            const txt = html.slice(s, end);
            try {
              const obj = JSON.parse(txt);
              return obj;
            } catch {
              return null;
            }
          }
        }
      }
    }
    return null;
  }

  const seen = new Set();
  const out = [];
  for (const pos of hits) {
    const obj = tryParseObjectAt(pos);
    if (!obj) continue;
    const pid = String(obj.productId || obj.id || "").trim();
    if (!pid || seen.has(pid)) continue;
    const title = String(obj.title || "").trim();
    const detailUrl = String(obj.detailUrl || "").trim();
    if (!title || !detailUrl) continue;
    seen.add(pid);

    const multi = Array.isArray(obj.multiImage) ? obj.multiImage : [];
    const images = [];
    for (const u of multi) {
      if (typeof u === "string" && u.trim()) images.push(u.startsWith("//") ? `https:${u}` : u);
    }
    if (!images.length && typeof obj.imageUrl === "string") {
      const u = obj.imageUrl.trim();
      if (u) images.push(u.startsWith("//") ? `https:${u}` : u);
    }

    out.push({
      productId: pid,
      title,
      detailUrl: detailUrl.startsWith("//") ? `https:${detailUrl}` : detailUrl,
      images,
      companyName: obj.companyName || "",
      priceRaw: obj.originalMinPrice || obj.localOriginalPriceRangeStr || "",
      minOrderQuality: obj.minOrderQuality || "",
      minOrderUnit: obj.minOrderUnit || ""
    });

    if (out.length >= limit) break;
  }
  return out;
}

async function importSearchPage(tabId, selectedCategoryId = 0, settingsOverride = {}, importId = "") {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  const url = await execInTab(tabId, () => location.href);
  const html = await execInTab(tabId, () => document.documentElement.innerHTML);
  const run = beginImportRun(tabId, importId);
  let lastError = "";

  const items = extractSearchItemsFromHtml(html || "", settings.maxPageItems || 20);
  if (!items.length) {
    finishImportRun(tabId, run);
    throw new Error("No products found on this page. (Try a product detail page or ensure results are visible.)");
  }

  const total = items.length;
  let ok = 0;
  let fail = 0;

  await sendImportProgress(tabId, run, { state: "start", done: 0, total, ok, fail });

  try {
    for (const it of items) {
      if (run.cancelled) {
        await sendImportProgress(tabId, run, { state: "stopped", done: ok + fail, total, ok, fail });
        return {
          ok: false,
          cancelled: true,
          importId: run.id,
          imported: ok,
          failed: fail,
          total,
          message: `Stopped. Imported ${ok}/${total} (failed ${fail}).`
        };
      }

      const detailUrl = String(it?.detailUrl || "").trim();
      try {
        if (!detailUrl) {
          throw new Error("Missing product detail URL.");
        }
        await importProductFromUrl(detailUrl, selectedCategoryId, settings);
        ok++;
      } catch (error) {
        fail++;
        lastError = String(error?.message || error || "");
      }
      await sendImportProgress(tabId, run, { state: "progress", done: ok + fail, total, ok, fail });
    }

    await sendImportProgress(tabId, run, { state: "done", done: total, total, ok, fail });
    return {
      ok: true,
      importId: run.id,
      imported: ok,
      failed: fail,
      total,
      message: lastError && fail > 0
        ? `Imported ${ok} items (failed ${fail}). Last error: ${lastError}`
        : `Imported ${ok} items (failed ${fail}).`
    };
  } finally {
    finishImportRun(tabId, run);
  }
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();

    const timer = setInterval(() => {
      if (Date.now() - t0 > timeoutMs) {
        cleanup();
        reject(new Error("Timed out waiting for product page to load."));
      }
    }, 500);

    function cleanup() {
      clearInterval(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    function onRemoved(id) {
      if (id !== tabId) return;
      cleanup();
      reject(new Error("Tab was closed before import finished."));
    }

    function onUpdated(id, info) {
      if (id !== tabId) return;
      if (info.status === "complete") {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function getWorkerPageSnapshot(tabId) {
  return execInTab(tabId, () => ({
    pageTitle: document.title || "",
    bodyText: (document.body?.innerText || "").slice(0, 6000),
    metaDescription: document.querySelector('meta[name="description"]')?.content || "",
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
    href: location.href
  }));
}

async function waitForVerificationClear(worker, timeoutMs = 5 * 60 * 1000, pollMs = 2000) {
  const start = Date.now();
  for (;;) {
    const snapshot = await getWorkerPageSnapshot(worker.tabId).catch(() => null);
    if (snapshot && !looksLikeRobotBlockedPage(snapshot)) {
      return true;
    }
    if (Date.now() - start >= timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function createImportWorkerTarget(url, options = {}) {
  const visible = !!options?.visible;
  try {
    const win = await chrome.windows.create({
      url,
      focused: visible,
      state: visible ? "normal" : "minimized",
      type: "normal"
    });
    const tab = Array.isArray(win?.tabs) ? win.tabs[0] : null;
    if (win?.id && tab?.id) {
      return {
        tabId: tab.id,
        windowId: win.id,
        close: async () => {
          await chrome.windows.remove(win.id);
        }
      };
    }
  } catch {
    // Fall back to a background tab if a minimized worker window cannot be created.
  }

  const tab = await chrome.tabs.create({ url, active: visible });
  return {
    tabId: tab.id,
    windowId: tab.windowId || 0,
    close: async () => {
      await chrome.tabs.remove(tab.id);
    }
  };
}

async function navigateWorkerToUrl(worker, url) {
  if (!worker?.tabId) {
    throw new Error("Missing import worker.");
  }

  await chrome.tabs.update(worker.tabId, {
    url,
    active: false
  });
  await waitForTabComplete(worker.tabId);
}

async function importProductFromWorkerUrl(worker, url, selectedCategoryId = 0, settingsOverride = {}, callbacks = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  url = String(url || "").trim();
  const urlError = validateImportUrl(url);
  if (urlError) {
    throw new Error(urlError);
  }

  const pauseTimeoutMs = Number.isFinite(Number(callbacks?.pauseTimeoutMs)) ? Number(callbacks.pauseTimeoutMs) : 5 * 60 * 1000;
  const onPause = typeof callbacks?.onPause === "function" ? callbacks.onPause : null;
  const onResume = typeof callbacks?.onResume === "function" ? callbacks.onResume : null;

  for (;;) {
    try {
      await navigateWorkerToUrl(worker, url);
      const res = await importCurrentProduct(worker.tabId, selectedCategoryId, settings);
      return res;
    } catch (error) {
      const message = String(error?.message || error || "");
      const blocked = /captcha|robot verification|access protection|access denied|security check|challenge required|prove you are human|prove you're human|i am not a robot|not a robot/i.test(message);
      if (!blocked) {
        throw error;
      }

      if (onPause) {
        await onPause(message);
      }
      await surfaceWorkerForUser(worker);

      const cleared = await waitForVerificationClear(worker, pauseTimeoutMs);
      if (!cleared) {
        throw new Error("Timed out waiting for robot verification to clear.");
      }

      if (onResume) {
        await onResume();
      }
    }
  }
}

async function importProductFromUrl(url, selectedCategoryId = 0, settingsOverride = {}) {
  const settings = mergeImportSettings(await getSettings(), settingsOverride);
  url = String(url || "").trim();
  const urlError = validateImportUrl(url);
  if (urlError) {
    throw new Error(urlError);
  }

  const worker = await createImportWorkerTarget(url, { visible: false });
  let keepWorkerOpen = false;
  try {
    await waitForTabComplete(worker.tabId);
    const res = await importCurrentProduct(worker.tabId, selectedCategoryId, settings);
    return res;
  } catch (error) {
    const message = String(error?.message || error || "");
    if (
      /captcha|robot verification|access protection|access denied|security check|challenge required|prove you are human|prove you're human|i am not a robot|not a robot/i.test(message)
    ) {
      keepWorkerOpen = true;
      await surfaceWorkerForUser(worker);
    }
    throw error;
  } finally {
    if (!keepWorkerOpen) {
      try {
        await worker.close();
      } catch {
        // ignore
      }
    }
  }
}

function normalizeUrlImportBatchUrls(value) {
  const out = [];
  const items = Array.isArray(value) ? value : [];
  for (const item of items) {
    const url = String(item || "").trim();
    if (!url) continue;
    out.push(url);
  }
  return Array.from(new Set(out));
}

function senderMatchesConfiguredWpSite(senderUrl, settings) {
  const base = normalizeWpBaseUrl(settings?.wpBaseUrl);
  const url = String(senderUrl || "").trim();
  if (!base || !url) return false;
  return (
    url === `${base}/wp-admin` ||
    url.startsWith(`${base}/wp-admin/`) ||
    url.startsWith(`${base}/wp-admin?`)
  );
}

async function runUrlImportBatch(adminTabId, urls, selectedCategoryId = 0, settings = null, runId = "") {
  const resolvedSettings = settings || await getSettings();
  const batch = activeDashboardBatches.get(adminTabId);
  const total = urls.length;
  let success = 0;
  let failed = 0;
  const worker = await createImportWorkerTarget("about:blank", { visible: false });

  await sendUrlImportBatchProgress(adminTabId, runId, {
    state: "start",
    total,
    success,
    failed,
    message: `Importing ${total} URLs...`
  });

  try {
    for (const url of urls) {
      if (!batch || batch.cancelled) {
        await sendUrlImportBatchProgress(adminTabId, runId, {
          state: "stopped",
          total,
          success,
          failed,
          message: "Url Import batch stopped."
        });
        return;
      }

      try {
        const res = await importProductFromWorkerUrl(worker, url, selectedCategoryId, resolvedSettings, {
          pauseTimeoutMs: 10 * 60 * 1000,
          onPause: async (reason) => {
            await sendUrlImportBatchProgress(adminTabId, runId, {
              state: "paused",
              url,
              total,
              success,
              failed,
              done: success + failed,
              message: `Robot verification required. Solve it in the opened tab to continue. ${reason || ""}`.trim()
            });
          },
          onResume: async () => {
            await sendUrlImportBatchProgress(adminTabId, runId, {
              state: "running",
              url,
              total,
              success,
              failed,
              done: success + failed,
              message: "Verification cleared. Resuming imports..."
            });
          }
        });
        success++;
        await sendUrlImportBatchProgress(adminTabId, runId, {
          state: "item",
          url,
          ok: true,
          total,
          success,
          failed,
          done: success + failed,
          message: res?.message || "Imported successfully."
        });
      } catch (error) {
        failed++;
        await sendUrlImportBatchProgress(adminTabId, runId, {
          state: "item",
          url,
          ok: false,
          total,
          success,
          failed,
          done: success + failed,
          error: String(error?.message || error)
        });
      }
    }

    await sendUrlImportBatchProgress(adminTabId, runId, {
      state: "done",
      total,
      success,
      failed,
      message: `Run finished. Success: ${success}, failed: ${failed}.`
    });
  } finally {
    const current = activeDashboardBatches.get(adminTabId);
    if (current && current.id === runId) {
      activeDashboardBatches.delete(adminTabId);
    }
    try {
      await worker.close();
    } catch {
      // ignore
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.cmd === "ensure_injected") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        const tabId = tab?.id;
        if (!tabId) throw new Error("No active tab.");

        await injectSupportScriptsForTab(tabId, tab?.url || "");

        sendResponse({ ok: true });
        return;
      }

      if (msg?.cmd === "get_connection_state") {
        const res = await getConnectionState({
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword,
          wpNonce: msg?.wpNonce
        });
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "connect_bridge") {
        const res = await connectExtension({
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword
        });
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "disconnect_bridge") {
        const res = await disconnectExtension();
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "test_wp_auth") {
        const res = await testWpAuth({
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword,
          wpNonce: msg?.wpNonce
        });
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "fetch_wp_categories") {
        const res = await fetchWpCategories({
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword,
          wpNonce: msg?.wpNonce
        });
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "get_url_import_bridge_status") {
        const s = await getSettings();
        const configured = !!(normalizeWpBaseUrl(s.wpBaseUrl) && s.wpUser && s.wpAppPassword);
        let authOk = false;
        let authError = "";
        if (configured) {
          try {
            await testWpAuth({ wpNonce: msg?.restNonce });
            authOk = true;
          } catch (e) {
            authError = String(e?.message || e).slice(0, 200);
          }
        }
        sendResponse({
          ok: true,
          configured,
          wpBaseUrl: normalizeWpBaseUrl(s.wpBaseUrl),
          siteMatched: senderMatchesConfiguredWpSite(sender?.tab?.url, s),
          authOk,
          authError
        });
        return;
      }

      if (msg?.cmd === "get_import_preferences") {
        const s = await getSettings();
        sendResponse({
          ok: true,
          askCategoryBeforeImport: s.askCategoryBeforeImport !== false,
          defaultCategoryId: toPositiveInt(s.defaultCategoryId)
        });
        return;
      }

      const tabId = (msg && Number.isFinite(Number(msg.tabId)) ? Number(msg.tabId) : null) || sender?.tab?.id;
      if (!tabId) throw new Error("No active tab.");

      if (msg?.cmd === "run_url_import_batch") {
        const settings = mergeImportSettings(await getSettings(), { wpNonce: msg?.restNonce });
        if (!(normalizeWpBaseUrl(settings.wpBaseUrl) && settings.wpUser && settings.wpAppPassword)) {
          throw new Error("Complete the WordPress site URL, username, and Application Password in Importon Bridge first.");
        }
        if (!senderMatchesConfiguredWpSite(sender?.tab?.url, settings)) {
          throw new Error("This dashboard does not match the WordPress site saved in Importon Bridge. Update the connection first.");
        }

        const urls = normalizeUrlImportBatchUrls(msg?.urls);
        if (!urls.length) {
          throw new Error("Paste at least one valid Alibaba product detail URL.");
        }

        if (activeDashboardBatches.has(tabId)) {
          throw new Error("Another Url Import batch is already running in this dashboard tab.");
        }

        const runId = String(msg?.runId || "").trim() || makeImportId();
        activeDashboardBatches.set(tabId, { id: runId, tabId, cancelled: false });

        runUrlImportBatch(tabId, urls, msg?.categoryId, settings, runId).catch(async (error) => {
          const current = activeDashboardBatches.get(tabId);
          if (current && current.id === runId) {
            activeDashboardBatches.delete(tabId);
          }
          await sendUrlImportBatchProgress(tabId, runId, {
            state: "error",
            error: String(error?.message || error)
          });
        });

        sendResponse({ ok: true, started: true, runId });
        return;
      }

      if (msg?.cmd === "import_product_detail") {
        const res = await importCurrentProduct(tabId, msg?.categoryId, {
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword
        });
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "import_search_page") {
        const res = await importSearchPage(tabId, msg?.categoryId, {
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword
        }, msg?.importId);
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "cancel_import") {
        const run = activeImportRuns.get(tabId);
        if (!run) {
          sendResponse({ ok: false, error: "No active import to stop." });
          return;
        }
        run.cancelled = true;
        sendResponse({ ok: true, importId: run.id, message: "Stopping..." });
        return;
      }

      if (msg?.cmd === "import_product_url") {
        const res = await importProductFromUrl(msg?.url, msg?.categoryId, {
          wpBaseUrl: msg?.wpBaseUrl,
          wpUser: msg?.wpUser,
          wpAppPassword: msg?.wpAppPassword
        });
        sendResponse(res);
        return;
      }

      if (msg?.cmd === "import_try") {
        sendResponse({
          ok: false,
          error: "Open an Alibaba product detail page or a search/category results page, then click Import."
        });
        return;
      }

      sendResponse({ ok: false, error: "Unsupported command." });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  primeInjectableTabs().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  primeInjectableTabs().catch(() => {});
});

// Auto-inject after navigation completes so users don't need to reopen popup.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    if (changeInfo.status !== "complete") return;
    const url = changeInfo.url || tab?.url || "";
    injectSupportScriptsForTab(tabId, url).catch(() => {});
  } catch {
    // ignore
  }
});

primeInjectableTabs().catch(() => {});
