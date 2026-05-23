/* global chrome */

(() => {
  // Guard: we sometimes force-inject this script (allFrames) as a fallback.
  // Avoid creating multiple intervals/event listeners on reinjection.
  try {
    if (window.__IMPORTONBRIDGE_CONTENT_LOADED__) return;
    window.__IMPORTONBRIDGE_CONTENT_LOADED__ = true;
    document.documentElement && (document.documentElement.dataset.importonbridgeLoaded = "1");
  } catch {
    // ignore
  }

const HOST_ID = "importonbridge-import-host";
const BTN_ID = "importonbridge-import-btn";
const CARD_BTN_CLASS = "importonbridge-card-import-btn";
const FLOAT_BTN_CLASS = "importonbridge-float-import-btn";
const STYLE_ID = "importonbridge-import-style";
const IMPORTED_URLS_KEY = "importonbridgeImportedProductUrls";
  const IS_TOP_WINDOW = (() => {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  })();
  const CARD_SETTING_DEFAULTS = { showCardButtons: true };

  let showCardButtons = true;
  let importedLoaded = false;
  const importedUrlSet = new Set();
  let activeFloatImportId = "";

  function loadCardButtonSetting() {
    try {
      chrome.storage.sync.get(CARD_SETTING_DEFAULTS, (v) => {
        showCardButtons = v?.showCardButtons !== false;
        if (!showCardButtons) removeCardButtons();
        else ensureCardButtons();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (!changes?.showCardButtons) return;
        showCardButtons = changes.showCardButtons.newValue !== false;
        if (!showCardButtons) removeCardButtons();
        else ensureCardButtons();
      });
    } catch {
      // ignore
    }
  }

  function normalizeImportUrl(u) {
    try {
      const x = new URL(String(u || ""), location.href);
      return `${x.host}${x.pathname}`.toLowerCase();
    } catch {
      return "";
    }
  }

  function saveImportedState() {
    try {
      const arr = Array.from(importedUrlSet).slice(-500);
      chrome.storage.local.set({ [IMPORTED_URLS_KEY]: arr });
    } catch {
      // ignore
    }
  }

  function markImportedUrl(u) {
    const key = normalizeImportUrl(u);
    if (!key) return;
    importedUrlSet.add(key);
    saveImportedState();
  }

  function isImportedUrl(u) {
    const key = normalizeImportUrl(u);
    if (!key) return false;
    return importedUrlSet.has(key);
  }

  function loadImportedState() {
    try {
      chrome.storage.local.get({ [IMPORTED_URLS_KEY]: [] }, (v) => {
        const arr = Array.isArray(v?.[IMPORTED_URLS_KEY]) ? v[IMPORTED_URLS_KEY] : [];
        importedUrlSet.clear();
        for (const raw of arr) {
          const key = normalizeImportUrl(raw);
          if (key) importedUrlSet.add(key);
        }
        importedLoaded = true;
        ensureButton();
        ensureCardButtons();
      });
    } catch {
      importedLoaded = true;
    }
  }

  function hardStyle(el, styles) {
    for (const [k, v] of Object.entries(styles)) {
      el.style.setProperty(k, v, "important");
    }
  }

  function isTransformed(el) {
    try {
      const cs = getComputedStyle(el);
      return (
        cs.transform !== "none" ||
        cs.perspective !== "none" ||
        cs.filter !== "none" ||
        cs.backdropFilter !== "none"
      );
    } catch {
      return false;
    }
  }

  function isBadContainer(el) {
    if (!el) return true;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none") return true;
      if (cs.visibility === "hidden") return true;
      // If a container disables hit-testing for the subtree, the button can become unusable.
      if (cs.pointerEvents === "none") return true;
      const r = el.getBoundingClientRect();
      if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return true;
      if (r.width < 20 || r.height < 20) return true;
      return false;
    } catch {
      return false;
    }
  }

  function pickMountPoint() {
    const html = document.documentElement;
    const body = document.body;
    // Prefer mounting under the element that is NOT transformed,
    // because `position: fixed` becomes relative to transformed ancestors.
    if (body && !isTransformed(body)) return body;
    if (html && !isTransformed(html)) return html;
    return body || html;
  }

  function isSearchPage() {
    return (
      location.pathname.startsWith("/trade/search") ||
      location.pathname.startsWith("/trade/search2") ||
      location.pathname.includes("/trade/search")
    );
  }

  function isProductDetailPage() {
    return (
      location.pathname.includes("/product-detail/") ||
      /\/product-detail\/.+_\d+\.html/.test(location.pathname)
    );
  }

  function countProductDetailLinks() {
    try {
      return document.querySelectorAll(
        'a[href*="/product-detail/"], a[href*="alibaba.com/product-detail/"]'
      ).length;
    } catch {
      return 0;
    }
  }

  function isListingLikePage() {
    // Non-search list pages exist on Alibaba (e.g. sale.alibaba.com category landing pages)
    // and have a grid of many product-detail links.
    return !isProductDetailPage() && countProductDetailLinks() >= 6;
  }

  function hasDetailRecommendationsSection() {
    return !!(
      document.querySelector("#cdn-pc-recommend_detail__you_may_like") ||
      document.querySelector('[data-spm="you_may_like"]') ||
      document.querySelector("a.hFR19[href*='/product-detail/']")
    );
  }

  function ensureHost() {
    if (!IS_TOP_WINDOW) return null;
    // Keep exactly one floating host and one floating button in the document.
    // Some Alibaba re-renders or script reinjections can leave orphan nodes behind.
    const hosts = Array.from(document.querySelectorAll(`#${HOST_ID}`));
    const host = hosts.shift() || null;
    for (const extra of hosts) {
      try {
        extra.remove();
      } catch {
        // ignore
      }
    }

    const floatingBtns = Array.from(document.querySelectorAll(`button#${BTN_ID}`));
    if (host) {
      const keptInHost = host.querySelector(`button#${BTN_ID}`);
      for (const b of floatingBtns) {
        if (b !== keptInHost) {
          try {
            b.remove();
          } catch {
            // ignore
          }
        }
      }
      host.dataset.importonbridgeMode = "light";
      return host;
    }

    const newHost = document.createElement("div");
    newHost.id = HOST_ID;
    const mount = pickMountPoint();
    mount.appendChild(newHost);

    // Inline styles so page CSS can't easily hide/move it.
    hardStyle(newHost, {
      // Avoid `all: initial` here; some sites rely on inherited styles to render properly.
      position: "fixed",
      right: "16px",
      bottom: "16px",
      "z-index": "2147483647",
      "pointer-events": "auto",
      display: "block"
    });

    // Use only light DOM. Some sites and other scripts can affect shadow rendering or stacking.
    newHost.dataset.importonbridgeMode = "light";

    // eslint-disable-next-line no-console
    console.log(
      "[ImportonBridge] host injected",
      newHost.getBoundingClientRect(),
      "inner",
      window.innerWidth,
      window.innerHeight,
      "mount=",
      mount === document.body ? "body" : "html"
    );
    return newHost;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
/* Floating button host */
#${HOST_ID}{ position:fixed !important; z-index:2147483647 !important; }

/* Per-card buttons */
.${CARD_BTN_CLASS}{
  position:absolute !important;
  top:10px !important;
  right:10px !important;
  z-index:8 !important;
  pointer-events:auto !important;
  display:inline-flex !important;
  align-items:center !important;
  gap:8px !important;
  border:0 !important;
  border-radius:999px !important;
  padding:10px 12px !important;
  background:#6878F6 !important;
  color:#fff !important;
  font:800 13px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial !important;
  box-shadow:0 10px 30px rgba(0,0,0,.35) !important;
  cursor:pointer !important;
  outline:3px solid #fff !important;
}
.${CARD_BTN_CLASS}[data-busy="1"]{ opacity:.7 !important; cursor:progress !important; }
.${CARD_BTN_CLASS}:hover{ filter:brightness(1.05) !important; }
.${CARD_BTN_CLASS}[data-state="success"]{ background:#16a34a !important; }
.${CARD_BTN_CLASS}[data-state="error"]{ background:#dc2626 !important; }

/* Floating import button states */
.${FLOAT_BTN_CLASS}[data-busy="1"]{
  opacity:.78 !important;
  cursor:progress !important;
  filter:saturate(.9) !important;
}
.${FLOAT_BTN_CLASS}[data-state="success"]{ background:#16a34a !important; }
.${FLOAT_BTN_CLASS}[data-state="error"]{ background:#dc2626 !important; }
    `.trim();
    (document.head || document.documentElement).appendChild(st);
  }

  function toast(msg, ms = 3500) {
    const host = ensureHost();
    let el = document.getElementById("importonbridge-import-toast");
    if (el) el.remove();
    el = document.createElement("div");
    el.id = "importonbridge-import-toast";
    el.textContent = msg;
    hardStyle(el, {
      position: "fixed",
      right: "16px",
      bottom: "74px",
      "z-index": "2147483647",
      "max-width": "420px",
      background: "rgba(17,24,39,.95)",
      color: "#fff",
      "border-radius": "12px",
      padding: "10px 12px",
      "box-shadow": "0 12px 40px rgba(0,0,0,.35)",
      font: "600 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial"
    });
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function removeCategoryModal() {
    const existing = document.getElementById("importonbridge-category-modal");
    if (existing) existing.remove();
  }

  function pickCategoryModal(categories, defaultCategoryId) {
    return new Promise((resolve) => {
      removeCategoryModal();

      const overlay = document.createElement("div");
      overlay.id = "importonbridge-category-modal";
      hardStyle(overlay, {
        position: "fixed",
        inset: "0",
        "z-index": "2147483647",
        background: "rgba(0,0,0,.45)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "16px"
      });

      const panel = document.createElement("div");
      hardStyle(panel, {
        width: "100%",
        "max-width": "420px",
        background: "#0f172a",
        color: "#fff",
        border: "1px solid rgba(255,255,255,.18)",
        "border-radius": "14px",
        padding: "14px",
        "box-shadow": "0 24px 50px rgba(0,0,0,.45)",
        font: "600 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial"
      });
      panel.innerHTML = `
        <div style="font-weight:800;font-size:14px;margin-bottom:8px;">Select Category</div>
        <div style="opacity:.85;margin-bottom:8px;">Choose where this product should be imported.</div>
        <select id="importonbridge-category-select" style="width:100%;border-radius:10px;padding:10px;border:1px solid rgba(255,255,255,.2);background:#0b1220;color:#fff;"></select>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="importonbridge-cat-cancel" style="flex:1;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:9px 10px;background:#111827;color:#fff;font-weight:800;cursor:pointer;">Cancel</button>
          <button id="importonbridge-cat-ok" style="flex:1;border:0;border-radius:10px;padding:9px 10px;background:#6878F6;color:#fff;font-weight:800;cursor:pointer;">Import</button>
        </div>
      `;

      overlay.appendChild(panel);
      document.documentElement.appendChild(overlay);

      const select = panel.querySelector("#importonbridge-category-select");
      const foundDefault = categories.some((c) => Number(c.id) === Number(defaultCategoryId));
      for (const c of categories) {
        const opt = document.createElement("option");
        opt.value = String(c.id);
        opt.textContent = c.path || c.name || `Category #${c.id}`;
        select.appendChild(opt);
      }
      if (select && select.options.length) {
        select.value = foundDefault ? String(defaultCategoryId) : String(categories[0].id);
      }

      const close = (value) => {
        removeCategoryModal();
        resolve(value);
      };

      panel.querySelector("#importonbridge-cat-cancel").addEventListener("click", () => close(0));
      panel.querySelector("#importonbridge-cat-ok").addEventListener("click", () => {
        const n = Number(select?.value || 0);
        close(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(0);
      });
    });
  }

  async function resolveImportCategoryId() {
    const pref = await chrome.runtime.sendMessage({ cmd: "get_import_preferences" });
    if (!pref?.ok) return 0;

    const defaultId = Number(pref.defaultCategoryId || 0);
    if (pref.askCategoryBeforeImport === false) {
      return Number.isFinite(defaultId) && defaultId > 0 ? Math.floor(defaultId) : 0;
    }

    const catsRes = await chrome.runtime.sendMessage({ cmd: "fetch_wp_categories" });
    if (!catsRes?.ok) {
      throw new Error(catsRes?.error || "Failed to load WordPress categories.");
    }
    const categories = Array.isArray(catsRes.categories) ? catsRes.categories.filter((c) => Number(c?.id) > 0) : [];
    if (!categories.length) {
      throw new Error("No WooCommerce product categories found.");
    }

    const picked = await pickCategoryModal(categories, defaultId);
    if (!(picked > 0)) {
      throw new Error("Import cancelled.");
    }
    return picked;
  }

  function absUrl(u) {
    try {
      return new URL(u, location.href).toString();
    } catch {
      return "";
    }
  }

  async function getImportCreds() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(
          { wpBaseUrl: "", wpUser: "", wpAppPassword: "" },
          (localVals) => {
            chrome.storage.sync.get(
              { wpBaseUrl: "", wpUser: "", wpAppPassword: "" },
              (syncVals) => {
                const merged = { ...syncVals, ...localVals };
                resolve({
                  wpBaseUrl: String(merged.wpBaseUrl || "").trim().replace(/\/+$/, ""),
                  wpUser: String(merged.wpUser || "").trim(),
                  wpAppPassword: String(merged.wpAppPassword || "").trim()
                });
              }
            );
          }
        );
      } catch {
        resolve({ wpBaseUrl: "", wpUser: "", wpAppPassword: "" });
      }
    });
  }

  function beginImportVisual(btn, loadingText = "Importing...", opts = {}) {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (!btn.dataset.baseLabel) {
      btn.dataset.baseLabel = (btn.textContent || "Import").trim();
    }
    const stopEnabled = !!opts.stopEnabled;
    btn.dataset.busy = "1";
    btn.dataset.state = "busy";
    btn.dataset.stopEnabled = stopEnabled ? "1" : "0";
    btn.dataset.stopping = "0";
    btn.disabled = !stopEnabled;
    btn.textContent = loadingText;
  }

  function finishImportVisual(btn, ok, successText = "Imported", errorText = "Failed") {
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.dataset.busy = "0";
    btn.dataset.state = ok ? "success" : "error";
    btn.dataset.stopEnabled = "0";
    btn.dataset.stopping = "0";
    btn.disabled = false;
    btn.textContent = ok ? successText : errorText;

    const resetTo = btn.dataset.baseLabel || "Import";
    if (ok) {
      return; // Keep success state visible until next user action.
    }
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.state = "idle";
      btn.textContent = resetTo;
    }, 1800);
  }

  function showImportedVisual(btn) {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (!btn.dataset.baseLabel) {
      btn.dataset.baseLabel = "Import";
    }
    btn.dataset.busy = "0";
    btn.dataset.state = "success";
    btn.dataset.stopEnabled = "0";
    btn.dataset.stopping = "0";
    btn.disabled = false;
    btn.textContent = "Imported";
  }

  function updateFloatImportProgress(btn, done, total, ok, fail) {
    if (!(btn instanceof HTMLButtonElement)) return;
    const d = Number.isFinite(Number(done)) ? Number(done) : 0;
    const t = Number.isFinite(Number(total)) ? Number(total) : 0;
    const o = Number.isFinite(Number(ok)) ? Number(ok) : 0;
    const f = Number.isFinite(Number(fail)) ? Number(fail) : 0;
    const action = btn.dataset.stopping === "1" ? "Stopping..." : "Stop";
    const failPart = f > 0 ? ` | fail ${f}` : "";
    btn.textContent = `Importing... ${d}/${t || "?"} | ok ${o}${failPart} ${action}`;
  }

  function findProductLinkCandidates() {
    // Alibaba uses various card layouts; anchor href is the most stable signal.
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/product-detail/"], a[href*="alibaba.com/product-detail/"]')) {
      const href = a.getAttribute("href") || "";
      if (!href) continue;
      const u = absUrl(href);
      if (!u.includes("alibaba.com/product-detail/")) continue;
      out.push({ a, url: u });
    }
    return out;
  }

  function findCardContainerForLink(a) {
    // IMPORTANT: the card contains many nested <div> and multiple <a> tags.
    // We must always return the OUTER card wrapper, otherwise we inject multiple buttons.
    const directMatch = (
      a.closest(".traffic-card-gallery") ||
      a.closest(".fy26-product-card-wrapper") ||
      a.closest(".searchx-offer-item") ||
      a.closest('[data-spm="normal_offer"]') ||
      // Product detail "Other recommendations for your business" carousel.
      a.closest(".q2Myn") ||
      a.closest(".LblAo") ||
      // sale.alibaba.com category pages (Hugo layout)
      a.closest(".hugo5-pc-grid-item") ||
      // sale.alibaba.com product-card grid layout
      a.closest(".hugo4-pc-grid-item") ||
      a.closest("a.product-card") ||
      a.closest("a.hugo4-product") ||
      null
    );

    if (directMatch) return directMatch;

    // Fallback for category/list layouts where Alibaba rotates wrapper class names.
    // Walk up to the first reasonably sized container that looks like a product card.
    let el = a.parentElement;
    let best = null;
    let depth = 0;
    while (el && depth < 7) {
      if (
        !isInExcludedUiArea(el) &&
        (el.querySelector("img") ||
          el.querySelector(".pic-wrapper") ||
          el.querySelector(".image-container") ||
          el.querySelector('[data-role="img-area"]'))
      ) {
        try {
          const r = el.getBoundingClientRect();
          if (Number.isFinite(r.width) && Number.isFinite(r.height) && r.width >= 120 && r.height >= 120) {
            best = el;
          }
        } catch {
          // ignore bad layout reads and keep climbing
        }
      }
      el = el.parentElement;
      depth += 1;
    }

    return best;
  }

  function isInExcludedUiArea(el) {
    if (!el) return false;
    return !!el.closest(
      [
        "header",
        "[role='banner']",
        ".header-content",
        ".tnh-main",
        ".tnh-searchbar",
        ".functional",
        ".LDTEl",
        ".page-tab-top-wrapper",
        ".jptkG",
        ".iJkMO",
        "#popup-root",
        "#importonbridge-category-modal"
      ].join(",")
    );
  }

  function isLikelyProductCard(card, linkEl) {
    if (!card || !linkEl) return false;
    if (isInExcludedUiArea(card) || isInExcludedUiArea(linkEl)) return false;
    const href = absUrl(linkEl.getAttribute("href") || "");
    if (!href.includes("alibaba.com/product-detail/")) return false;

    const hasImage =
      !!card.querySelector("img") ||
      !!card.querySelector("[data-role='img-area']") ||
      !!card.querySelector(".image-container") ||
      !!card.querySelector(".pic-wrapper");
    if (!hasImage) return false;

    try {
      const r = card.getBoundingClientRect();
      if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return false;
      // Avoid tiny menu/list elements in nav/header.
      if (r.width < 120 || r.height < 120) return false;
    } catch {
      return false;
    }

    return true;
  }

  function findCardMount(card) {
    // Prefer mounting on the image area so the button stays "on the image".
    const candidates = [
      // Current alibaba.com category page layout
      card.querySelector("a.product-image"),
      // sale.alibaba.com product-card grid layout
      card.querySelector(".image-container"),
      // sale.alibaba.com category pages
      card.querySelector(".pic-wrapper"),
      card.querySelector(".hugo4-product-picture"),
      // trade search
      card.querySelector('[data-role="img-area"]'),
      card.querySelector(".searchx-img-area"),
      card
    ].filter(Boolean);

    for (const el of candidates) {
      if (!isBadContainer(el)) return el;
    }
    return card;
  }

  function removeCardButtons() {
    for (const b of document.querySelectorAll(`button.${CARD_BTN_CLASS}`)) {
      try {
        b.remove();
      } catch {
        // ignore
      }
    }
  }

  function ensureCardButtons() {
    // Inject per-card buttons on listing pages and product-detail recommendation carousels.
    if (!isSearchPage() && !isListingLikePage() && !hasDetailRecommendationsSection()) return;
    if (!showCardButtons) return;
    ensureStyles();

    const links = findProductLinkCandidates();

    // Dedupe: Alibaba cards usually contain multiple <a> links; we want exactly 1 button per card.
    const cardToUrl = new Map();
    for (const { a, url } of links) {
      const card = findCardContainerForLink(a);
      if (!card) continue;
      if (!isLikelyProductCard(card, a)) continue;
      if (!cardToUrl.has(card)) cardToUrl.set(card, url);
    }

    for (const [card, url] of cardToUrl.entries()) {
      const mount = findCardMount(card);

      // Ensure mount can host an absolutely positioned button.
      const cs = getComputedStyle(mount);
      if (cs.position === "static") {
        mount.style.setProperty("position", "relative", "important");
      }

      // Keep exactly ONE button per card.
      const buttons = Array.from(card.querySelectorAll(`button.${CARD_BTN_CLASS}`));
      const btn = buttons.shift() || document.createElement("button");
      for (const extra of buttons) extra.remove();

      if (!btn.isConnected) {
        btn.type = "button";
        btn.className = CARD_BTN_CLASS;
        btn.textContent = "Import";
      }

      btn.setAttribute("data-url", url);
      if (importedLoaded && isImportedUrl(url)) {
        showImportedVisual(btn);
      }

      if (btn.parentElement !== mount) {
        mount.appendChild(btn);
      }
    }
  }

  function ensureButton() {
    if (!IS_TOP_WINDOW) return;
    const host = ensureHost();
    if (!host) return;
    const existingInHost = host.querySelector(`button#${BTN_ID}`);
    if (existingInHost) return;

    // Safety cleanup: no floating import button should exist outside current host.
    for (const b of document.querySelectorAll(`button#${BTN_ID}`)) {
      if (!host.contains(b)) {
        try {
          b.remove();
        } catch {
          // ignore
        }
      }
    }

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = FLOAT_BTN_CLASS;
    btn.setAttribute("aria-label", "Import with Importon Bridge");

    const mode = isProductDetailPage()
      ? "Import product"
      : isSearchPage()
        ? "Import page"
        : "Import";

    btn.textContent = `${mode} (Importon Bridge)`;
    hardStyle(btn, {
      position: "relative",
      "pointer-events": "auto",
      "z-index": "2147483647",
      display: "inline-flex",
      border: "0",
      "border-radius": "999px",
      padding: "12px 14px",
      background: "#6878F6",
      color: "#fff",
      font: "800 14px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "box-shadow": "0 10px 30px rgba(0,0,0,.35)",
      cursor: "pointer",
      outline: "4px solid #fff"
    });

    btn.addEventListener("click", async () => {
      // Same button acts as "Stop" while import is running.
      if (btn.dataset.busy === "1" && btn.dataset.stopEnabled === "1") {
        if (btn.dataset.stopping === "1") return;
        btn.dataset.stopping = "1";
        btn.textContent = "Stopping...";
        try {
          const stopRes = await chrome.runtime.sendMessage({ cmd: "cancel_import" });
          if (!stopRes?.ok) {
            btn.dataset.stopping = "0";
            toast(stopRes?.error || "Unable to stop import.");
          }
        } catch (e) {
          btn.dataset.stopping = "0";
          toast(String(e?.message || e));
        }
        return;
      }

      try {
        const cmd = isProductDetailPage()
          ? "import_product_detail"
          : isSearchPage()
            ? "import_search_page"
            : "import_try";

        const importId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        activeFloatImportId = importId;
        if (cmd === "import_search_page") {
          beginImportVisual(btn, "Importing... 0/0 | ok 0 Stop", { stopEnabled: true });
        } else {
          beginImportVisual(btn, "Importing...");
        }

        const categoryId = cmd === "import_try" ? 0 : await resolveImportCategoryId();
        const creds = await getImportCreds();
        const res = await chrome.runtime.sendMessage({ cmd, categoryId, importId, ...creds });
        if (!res) {
          toast("No response from Importon Bridge background.");
          finishImportVisual(btn, false, "Imported", "No Response");
          activeFloatImportId = "";
          return;
        }
        if (res.ok) {
          toast(res.message || "Imported.");
          if (isProductDetailPage()) {
            markImportedUrl(location.href);
          }
          if (cmd === "import_search_page") {
            const done = Number(res?.imported || 0);
            const total = Number(res?.total || done || 0);
            finishImportVisual(btn, true, `Imported ${done}/${total}`, "Failed");
          } else {
            finishImportVisual(btn, true);
          }
        } else {
          if (res?.cancelled) {
            toast(res.message || "Import stopped.");
            const done = Number(res?.imported || 0);
            const total = Number(res?.total || 0);
            finishImportVisual(btn, false, "Imported", `Stopped ${done}/${total}`);
          } else {
            toast(res.error || "Import failed.");
            finishImportVisual(btn, false);
          }
        }
      } catch (e) {
        toast(String(e?.message || e));
        finishImportVisual(btn, false);
      } finally {
        activeFloatImportId = "";
      }
    });

    host.appendChild(btn);
    if (importedLoaded && isProductDetailPage() && isImportedUrl(location.href)) {
      showImportedVisual(btn);
    }

    // Keep floating button fixed at bottom-right only.
    hardStyle(host, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      left: "auto",
      top: "auto",
      "z-index": "2147483647",
      display: "block",
      visibility: "visible",
      opacity: "1",
      transform: "none"
    });

    // eslint-disable-next-line no-console
    console.log("[ImportonBridge] button injected", btn.getBoundingClientRect());
  }

  // Install once and re-check after navigation updates.
  // If you don't see the button, check Site access for alibaba.com and reload the page.
  // eslint-disable-next-line no-console
  console.log("[ImportonBridge] content script loaded:", location.href);
  ensureStyles();
  loadImportedState();
  if (IS_TOP_WINDOW) ensureButton();
  loadCardButtonSetting();
  ensureCardButtons();

  // Per-card click handler (event delegation)
  document.addEventListener(
    "click",
    async (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest(`button.${CARD_BTN_CLASS}`);
      if (!btn) return;

      ev.preventDefault();
      ev.stopPropagation();

      const url = btn.getAttribute("data-url") || "";
      if (!url) return;

      beginImportVisual(btn, "Importing...");
      try {
        const categoryId = await resolveImportCategoryId();
        const creds = await getImportCreds();
        const res = await chrome.runtime.sendMessage({ cmd: "import_product_url", url, categoryId, ...creds });
        if (res?.ok) {
          toast(res.message || "Imported.");
          markImportedUrl(url);
          finishImportVisual(btn, true);
        } else {
          toast(res?.error || "Import failed.");
          finishImportVisual(btn, false);
        }
      } catch (e) {
        toast(String(e?.message || e));
        finishImportVisual(btn, false);
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.cmd !== "importonbridge_import_progress") return;
    const btn = document.getElementById(BTN_ID);
    if (!(btn instanceof HTMLButtonElement)) return;
    if (btn.dataset.busy !== "1" || btn.dataset.stopEnabled !== "1") return;
    if (activeFloatImportId && msg.importId && msg.importId !== activeFloatImportId) return;
    updateFloatImportProgress(btn, msg?.done, msg?.total, msg?.ok, msg?.fail);
  });

  // Watchdog: if the page removes the host/button, re-inject it.
  const watchdog = () => {
    // Clean accidental duplicates first.
    const hosts = Array.from(document.querySelectorAll(`#${HOST_ID}`));
    if (hosts.length > 1) {
      const keep = hosts.shift();
      for (const h of hosts) {
        try {
          h.remove();
        } catch {
          // ignore
        }
      }
      if (keep && !document.body.contains(keep) && document.documentElement) {
        document.documentElement.appendChild(keep);
      }
    }
    const floatBtns = Array.from(document.querySelectorAll(`button#${BTN_ID}`));
    if (floatBtns.length > 1) {
      const hostNow = document.getElementById(HOST_ID);
      for (const b of floatBtns) {
        if (!hostNow || !hostNow.contains(b)) {
          try {
            b.remove();
          } catch {
            // ignore
          }
        }
      }
    }

    const host = document.getElementById(HOST_ID);
    if (!host) {
      ensureButton();
      return;
    }

    // If the page later applies transforms to <body>, fixed elements become relative and
    // can appear "missing". Remount under <html> in that case.
    try {
      if (host.parentElement === document.body && isTransformed(document.body) && document.documentElement) {
        document.documentElement.appendChild(host);
      }
    } catch {
      // ignore
    }

    // If the host became non-visible due to layout changes, recreate it.
    try {
      const r = host.getBoundingClientRect();
      if (!Number.isFinite(r.width) || r.width < 1 || r.height < 1) {
        host.remove();
        ensureButton();
        return;
      }
    } catch {
      // ignore
    }

    // Re-assert key styles (some sites mutate inline styles).
    hardStyle(host, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      left: "auto",
      top: "auto",
      "z-index": "2147483647",
      "pointer-events": "auto",
      display: "block"
    });
    const root = host.shadowRoot;
    const btn = root ? root.getElementById(BTN_ID) : host.querySelector(`#${BTN_ID}`);
    if (!btn) ensureButton();
    if (showCardButtons) ensureCardButtons();
  };
  if (IS_TOP_WINDOW) {
    setInterval(watchdog, 1500);
  }

  let lastHref = location.href;
  if (IS_TOP_WINDOW) {
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        for (const host of document.querySelectorAll(`#${HOST_ID}`)) {
          try {
            host.remove();
          } catch {
            // ignore
          }
        }
        for (const b of document.querySelectorAll(`button#${BTN_ID}`)) {
          try {
            b.remove();
          } catch {
            // ignore
          }
        }
        ensureButton();
      }
    }, 800);
  }
})();
