// ---------- GLOBALS ----------

let SHEET_ID = "";
let INVENTORY_SHEET_NAME = "";
let COLORS_SHEET_NAME = "";
let ORDER_WEBHOOK_URL = "";
let STOCK_WEBAPP_URL = "";
let SUGGESTIONS_WEBHOOK_URL = "";
let PRINT_PREVIEWS_FOLDER_URL = "";
let PRINT_PREVIEW_FOLDER_ID = "";
let PREVIEW_WEBAPP_URL = "";
let CASHAPP_TAG = "";
let PROMOS_SHEET_NAME = "Promos";

let colorsData = [];
let inventoryData = [];
let promosData = [];
let cart = [];

let appliedPromo = null;
let promoDiscountAmount = 0;

let previewFileIndex = [];
let previewFileMap = {};
let previewsPreloaded = false;
let activePreviewFiles = [];
let activePreviewIndex = 0;
let previewLoadError = "";

const PREMADE_DISCOUNT = 0.85;
const CONFIG_PATH = "../config.json";

// ---------- ORDER ID ----------

function nextOrderNumber() {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const datePart = `${y}${m}${d}`;
  const timePart = `${hh}${mm}${ss}`;
  const key = `${datePart}-${timePart}`;

  let state;
  try {
    state = JSON.parse(localStorage.getItem("order_state") || "{}");
  } catch {
    state = {};
  }

  let seq = 1;
  if (state.key === key && typeof state.seq === "number") {
    seq = state.seq + 1;
  }

  state.key = key;
  state.seq = seq;

  try {
    localStorage.setItem("order_state", JSON.stringify(state));
  } catch {
    // ignore
  }

  const seqPart = String(seq).padStart(3, "0");
  const randPart = Math.floor(Math.random() * 36 * 36)
    .toString(36)
    .padStart(2, "0");

  return `${datePart}-${timePart}-${seqPart}${randPart}`;
}

// ---------- BASIC HELPERS ----------

function formatCurrency(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function formatKg(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return "0kg";
  return `${n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}kg`;
}

function normalizeStatus(str) {
  if (!str) return "";
  return String(str).trim().toLowerCase();
}

function parseSheetJSON(text) {
  const json = JSON.parse(
    text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1)
  );

  if (!json.table || !json.table.rows) return [];

  return json.table.rows;
}

function safeNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePromoDiscount(raw) {
  if (raw == null || raw === "") return null;

  if (typeof raw === "number") {
    const n = raw;
    if (!Number.isFinite(n)) return null;
    if (n > 0 && n <= 1) return { type: "percent", amount: n * 100 };
    return { type: "percent", amount: n };
  }

  const s = String(raw).trim();

  const percentMatch = s.match(/([\d.]+)\s*%/);
  if (percentMatch) {
    const val = parseFloat(percentMatch[1]);
    if (!isNaN(val)) return { type: "percent", amount: val };
  }

  const dollarMatch = s.match(/\$?\s*([\d.]+)/);
  if (dollarMatch && s.includes("$")) {
    const val = parseFloat(dollarMatch[1]);
    if (!isNaN(val)) return { type: "fixed", amount: val };
  }

  const num = parseFloat(s);
  if (!isNaN(num)) return { type: "percent", amount: num };

  return null;
}

function getColorByName(colorName) {
  const target = String(colorName || "").trim().toLowerCase();
  return colorsData.find((c) => c.name.trim().toLowerCase() === target) || null;
}

function colorHasEnoughFilament(colorName, kgNeeded, qty) {
  const color = getColorByName(colorName);
  if (!color) return false;

  const remaining = Number(color.kgRemaining || 0);
  const need = Number(kgNeeded || 0) * Number(qty || 1);

  if (!kgNeeded || need <= 0) return true;

  return remaining >= need;
}

// ---------- PREVIEW HELPERS ----------

function normalizePreviewKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+[0-9]+$/, "")
    .replace(/\s+/g, " ");
}

function slugifyPreviewName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+[0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function previewTypeFromFile(file) {
  const explicitType = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const mime = String(file.mimeType || "").toLowerCase();

  if (
    explicitType === "video" ||
    mime.startsWith("video/") ||
    name.endsWith(".mp4") ||
    name.endsWith(".webm") ||
    name.endsWith(".mov") ||
    name.endsWith(".m4v")
  ) {
    return "video";
  }

  return "image";
}

function getBaseNameFromPreviewFile(filename) {
  return String(filename || "")
    .trim()
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+[0-9]+$/, "");
}

function indexPreviewFiles(files) {
  previewFileIndex = Array.isArray(files) ? files : [];
  previewFileMap = {};

  previewFileIndex.forEach((file) => {
    const fallbackBaseName = getBaseNameFromPreviewFile(file.name);
    const baseName = file.baseName || fallbackBaseName;

    const keys = [];

    if (Array.isArray(file.matchKeys)) {
      file.matchKeys.forEach((key) => {
        if (key) keys.push(String(key));
      });
    }

    keys.push(normalizePreviewKey(baseName));
    keys.push(slugifyPreviewName(baseName));
    keys.push(normalizePreviewKey(file.name));
    keys.push(slugifyPreviewName(file.name));

    [...new Set(keys.filter(Boolean))].forEach((key) => {
      if (!previewFileMap[key]) previewFileMap[key] = [];

      const type = previewTypeFromFile(file);

      previewFileMap[key].push({
        url:
          type === "video"
            ? file.previewUrl || file.directUrl || file.downloadUrl || file.viewUrl
            : file.directUrl || file.thumbnailUrl || file.downloadUrl || file.viewUrl,
        fallbackUrl: file.downloadUrl || file.viewUrl || file.directUrl,
        thumbnailUrl: file.thumbnailUrl || file.directUrl || file.downloadUrl,
        viewUrl: file.viewUrl,
        previewUrl: file.previewUrl,
        name: file.name,
        title: baseName,
        type: type
      });
    });
  });

  Object.keys(previewFileMap).forEach((key) => {
    previewFileMap[key].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
  });
}

function loadScriptJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "previewCallback_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2);

    const joiner = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");

    window[callbackName] = function (data) {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    script.onerror = function () {
      cleanup();
      reject(new Error("Preview JSONP request failed"));
    };

    script.src =
      url +
      joiner +
      "callback=" +
      encodeURIComponent(callbackName) +
      "&cacheBust=" +
      Date.now();

    document.body.appendChild(script);
  });
}

async function loadDrivePreviewIndex() {
  previewLoadError = "";

  if (!PREVIEW_WEBAPP_URL || PREVIEW_WEBAPP_URL.includes("PASTE_")) {
    previewsPreloaded = true;
    previewLoadError =
      "PREVIEW_WEBAPP_URL is missing in config.json. Paste your deployed Apps Script /exec URL.";
    return;
  }

  if (previewsPreloaded) return;

  try {
    let url = PREVIEW_WEBAPP_URL;

    if (PRINT_PREVIEW_FOLDER_ID) {
      const joiner = url.includes("?") ? "&" : "?";
      url += joiner + "folderId=" + encodeURIComponent(PRINT_PREVIEW_FOLDER_ID);
    }

    let data;

    try {
      const res = await fetch(
        url + (url.includes("?") ? "&" : "?") + "cacheBust=" + Date.now(),
        { cache: "no-cache" }
      );

      if (!res.ok) throw new Error("Preview fetch request failed");
      data = await res.json();
    } catch (fetchErr) {
      data = await loadScriptJsonp(url);
    }

    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Preview index returned an error");
    }

    indexPreviewFiles(data.files || []);
    previewsPreloaded = true;
    preloadPreviewMedia();
  } catch (err) {
    previewsPreloaded = true;
    previewLoadError = String(err && err.message ? err.message : err);
  }
}

function preloadPreviewMedia() {
  const loaded = new Set();

  Object.values(previewFileMap).forEach((files) => {
    files.forEach((file) => {
      if (!file.url || loaded.has(file.url)) return;
      loaded.add(file.url);

      if (file.type === "image") {
        const img = new Image();
        img.src = file.url;
      }
    });
  });
}

function getPreviewFilesForItem(itemName) {
  const keys = [normalizePreviewKey(itemName), slugifyPreviewName(itemName)];

  for (const key of keys) {
    if (previewFileMap[key] && previewFileMap[key].length) {
      return previewFileMap[key];
    }
  }

  return [];
}

function setPreviewMessage(message, isError) {
  const copy = document.getElementById("preview-copy");
  if (!copy) return;

  copy.textContent = message || "";
  copy.className = isError ? "error-text" : "helper-text";
}

function renderPreviewMedia() {
  const mediaWrap = document.getElementById("preview-media-wrap");
  const thumbs = document.getElementById("preview-thumbs");
  const prevBtn = document.getElementById("preview-prev-btn");
  const nextBtn = document.getElementById("preview-next-btn");

  if (!mediaWrap || !thumbs) return;

  mediaWrap.innerHTML = "";
  thumbs.innerHTML = "";

  if (!activePreviewFiles.length) return;

  const file = activePreviewFiles[activePreviewIndex];

  if (file.type === "video") {
    const iframe = document.createElement("iframe");
    iframe.src = file.previewUrl || file.url || file.viewUrl;
    iframe.className = "preview-main-media preview-drive-frame";
    iframe.allow = "autoplay; fullscreen";
    iframe.allowFullscreen = true;
    iframe.loading = "eager";
    mediaWrap.appendChild(iframe);
  } else {
    const img = document.createElement("img");
    img.src = file.url;
    img.alt = file.title || "Print preview";
    img.className = "preview-main-media";

    img.addEventListener("error", () => {
      if (file.fallbackUrl && img.src !== file.fallbackUrl) {
        img.src = file.fallbackUrl;
      }
    });

    mediaWrap.appendChild(img);
  }

  activePreviewFiles.forEach((thumbFile, index) => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className =
      "preview-thumb" + (index === activePreviewIndex ? " active" : "");
    thumb.setAttribute("aria-label", `Preview ${index + 1}`);

    if (thumbFile.type === "video") {
      const label = document.createElement("span");
      label.textContent = "Video";
      thumb.appendChild(label);
    } else {
      const img = document.createElement("img");
      img.src = thumbFile.thumbnailUrl || thumbFile.url;
      img.alt = "";
      thumb.appendChild(img);
    }

    thumb.addEventListener("click", () => {
      activePreviewIndex = index;
      renderPreviewMedia();
    });

    thumbs.appendChild(thumb);
  });

  const hasMultiple = activePreviewFiles.length > 1;

  if (prevBtn) prevBtn.style.display = hasMultiple ? "flex" : "none";
  if (nextBtn) nextBtn.style.display = hasMultiple ? "flex" : "none";

  setPreviewMessage(
    `${activePreviewIndex + 1} of ${activePreviewFiles.length} preview file${
      activePreviewFiles.length === 1 ? "" : "s"
    }`,
    false
  );
}

function movePreview(step) {
  if (!activePreviewFiles.length) return;

  activePreviewIndex =
    (activePreviewIndex + step + activePreviewFiles.length) %
    activePreviewFiles.length;

  renderPreviewMedia();
}

async function openPreviewModal(itemName) {
  const modal = document.getElementById("preview-modal");
  const title = document.getElementById("preview-title");
  const loading = document.getElementById("preview-loading");
  const viewer = document.getElementById("preview-viewer");
  const thumbs = document.getElementById("preview-thumbs");

  if (!modal || !title || !loading || !viewer || !thumbs) return;

  title.textContent = `${itemName} preview`;

  activePreviewFiles = [];
  activePreviewIndex = 0;

  viewer.classList.add("hidden");
  thumbs.classList.add("hidden");
  loading.classList.remove("hidden");
  loading.textContent = "Loading preview files…";
  setPreviewMessage("", false);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  if (!previewsPreloaded) await loadDrivePreviewIndex();

  activePreviewFiles = getPreviewFilesForItem(itemName);

  loading.classList.add("hidden");

  if (!activePreviewFiles.length) {
    let msg = `No previews were found for "${itemName}". The site loaded ${previewFileIndex.length} file(s) from Drive.`;

    if (previewLoadError) {
      msg += ` Preview loader error: ${previewLoadError}`;
    } else if (previewFileIndex.length) {
      msg += ` Drive files found: ${previewFileIndex
        .map((file) => file.name)
        .join(", ")}.`;
    }

    setPreviewMessage(msg, true);
    return;
  }

  viewer.classList.remove("hidden");
  thumbs.classList.remove("hidden");

  renderPreviewMedia();
}

function closePreviewModal() {
  const modal = document.getElementById("preview-modal");
  const mediaWrap = document.getElementById("preview-media-wrap");

  if (!modal) return;

  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");

  if (mediaWrap) mediaWrap.innerHTML = "";

  activePreviewFiles = [];
  activePreviewIndex = 0;
}

// ---------- TABS ----------

function switchShopTab(tabName) {
  document.querySelectorAll(".shop-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

// ---------- CONFIG / SHEETS ----------

async function loadConfig() {
  try {
    const res = await fetch(CONFIG_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error("config fetch failed");

    const cfg = await res.json();

    SHEET_ID = cfg.SHEET_ID || "";
    INVENTORY_SHEET_NAME = cfg.INVENTORY_SHEET_NAME || "Inventory";
    COLORS_SHEET_NAME = cfg.COLORS_SHEET_NAME || "Colors";
    ORDER_WEBHOOK_URL = cfg.ORDER_WEBHOOK_URL || "";
    STOCK_WEBAPP_URL = cfg.STOCK_WEBAPP_URL || "";
    SUGGESTIONS_WEBHOOK_URL = cfg.SUGGESTIONS_WEBHOOK_URL || "";
    PRINT_PREVIEWS_FOLDER_URL = cfg.PRINT_PREVIEWS_FOLDER_URL || "";
    PRINT_PREVIEW_FOLDER_ID = cfg.PRINT_PREVIEW_FOLDER_ID || "";
    PREVIEW_WEBAPP_URL = cfg.PREVIEW_WEBAPP_URL || "";
    CASHAPP_TAG = cfg.CASHAPP_TAG || "$CashApp";
    PROMOS_SHEET_NAME = cfg.PROMOS_SHEET_NAME || "Promos";
  } catch (err) {
    console.error("[CONFIG] Error loading config.json", err);
  }
}

async function loadColors() {
  if (!SHEET_ID || !COLORS_SHEET_NAME) return;

  try {
    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(SHEET_ID) +
      "/gviz/tq?tqx=out:json&sheet=" +
      encodeURIComponent(COLORS_SHEET_NAME);

    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("colors fetch failed");

    const rows = parseSheetJSON(await res.text());

    colorsData = rows
      .map((r) => {
        const c = r.c || [];

        const name = c[0]?.v ? String(c[0].v).trim() : "";
        const status = c[1]?.v ? String(c[1].v).trim() : "";
        const kgRemaining = safeNumber(c[2]?.v);

        if (!name) return null;

        return {
          name,
          status,
          normStatus: normalizeStatus(status),
          kgRemaining: kgRemaining == null ? 0 : kgRemaining
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error("[COLORS] Error loading colors sheet", err);
    colorsData = [];
  }
}

async function loadInventory() {
  const inventoryError = document.getElementById("inventory-error");

  if (!SHEET_ID || !INVENTORY_SHEET_NAME) return;

  try {
    if (inventoryError) inventoryError.style.display = "none";

    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(SHEET_ID) +
      "/gviz/tq?tqx=out:json&sheet=" +
      encodeURIComponent(INVENTORY_SHEET_NAME);

    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("inventory fetch failed");

    const rows = parseSheetJSON(await res.text());

    inventoryData = rows
      .map((r) => {
        const c = r.c || [];

        const name = c[0]?.v ? String(c[0].v).trim() : "";
        const priceRaw = c[1]?.v;
        const stockRaw = c[2]?.v;
        const statusRaw = c[3]?.v ? String(c[3].v).trim() : "";
        const notes = c[4]?.v ? String(c[4].v).trim() : "";
        const filamentKgNeeded = safeNumber(c[5]?.v);

        if (!name || priceRaw === null || priceRaw === "") return null;

        const price = Number(priceRaw) || 0;
        const stock = safeNumber(stockRaw);
        const statusNorm = normalizeStatus(statusRaw);

        if (statusNorm === "offshelf") return null;

        const isLimited = statusNorm === "limited";

        if (isLimited && (stock === null || stock <= 0)) return null;

        let availability = "available";

        if (statusNorm === "temporarily unavailable") {
          availability = "temp";
        } else if (statusNorm === "sold out" || statusNorm === "unavailable") {
          availability = "unavailable";
        } else if (isLimited) {
          availability = "limited";
        }

        return {
          name,
          price,
          stock,
          status: statusRaw,
          statusNorm,
          notes,
          availability,
          isLimited,
          filamentKgNeeded: filamentKgNeeded == null ? 0 : filamentKgNeeded
        };
      })
      .filter(Boolean);

    renderPremadeCards();
  } catch (err) {
    console.error("[INVENTORY] Error loading inventory sheet", err);
    if (inventoryError) inventoryError.style.display = "block";
  }
}

async function loadPromos() {
  promosData = [];

  if (!SHEET_ID || !PROMOS_SHEET_NAME) return;

  try {
    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(SHEET_ID) +
      "/gviz/tq?tqx=out:json&sheet=" +
      encodeURIComponent(PROMOS_SHEET_NAME);

    const res = await fetch(url, { cache: "no-cache" });

    if (!res.ok) return;

    const rows = parseSheetJSON(await res.text());

    promosData = rows
      .map((r) => {
        const c = r.c || [];

        const codeRaw = c[0]?.v;
        if (!codeRaw) return null;

        const discountParsed = parsePromoDiscount(c[1]?.v);
        if (!discountParsed) return null;

        const statusRaw = c[2]?.v ? String(c[2].v).trim() : "";
        const limitRaw = c[3]?.v;
        const discountedRaw = c[4]?.v ? String(c[4].v).trim() : "";

        const code = String(codeRaw).trim().toUpperCase();

        let limit = safeNumber(limitRaw);
        if (limit == null) limit = null;

        let statusNorm = normalizeStatus(statusRaw);
        if (!statusNorm) statusNorm = "available";

        let scope = discountedRaw ? discountedRaw.toLowerCase() : "cart";
        if (scope !== "custom") scope = "cart";

        return {
          code,
          discountType: discountParsed.type,
          discountAmount: discountParsed.amount,
          rawStatus: statusRaw,
          statusNorm,
          limit,
          scope
        };
      })
      .filter(Boolean);
  } catch (err) {
    promosData = [];
  }
}

// ---------- COLORS ----------

function getBaseColors() {
  return colorsData.filter((c) => {
    const nameNorm = c.name.trim().toLowerCase();
    if (nameNorm === "colors" || nameNorm === "premade") return false;
    return true;
  });
}

function buildColorOptionLabel(color, requiredKg) {
  const norm = color.normStatus;
  let label = `${color.name} (${formatKg(color.kgRemaining)} left)`;

  if (norm === "temporarily unavailable") {
    label += " — temp unavailable";
  } else if (norm === "being resupplied") {
    label += " — being resupplied";
  } else if (norm === "sold out" || norm === "unavailable") {
    label += " — unavailable";
  } else if (requiredKg > 0 && color.kgRemaining < requiredKg) {
    label += " — insufficient filament";
  }

  return label;
}

function shouldDisableColor(color, requiredKg) {
  const norm = color.normStatus;

  if (
    norm === "sold out" ||
    norm === "unavailable" ||
    norm === "temporarily unavailable"
  ) {
    return true;
  }

  if (requiredKg > 0 && color.kgRemaining < requiredKg) return true;

  return false;
}

function renderCustomColorOptions() {
  const customColorSelect = document.getElementById("custom-color");
  if (!customColorSelect) return;

  const baseColors = getBaseColors();

  customColorSelect.innerHTML = '<option value="">Select preferred color</option>';

  baseColors.forEach((color) => {
    const o = document.createElement("option");
    o.value = color.name;
    o.textContent = `${color.name} (${formatKg(color.kgRemaining)} left)`;

    if (
      color.normStatus === "sold out" ||
      color.normStatus === "unavailable" ||
      color.normStatus === "temporarily unavailable"
    ) {
      o.disabled = true;
      o.textContent += " — unavailable";
    }

    customColorSelect.appendChild(o);
  });
}

// ---------- PREMADE RENDERING ----------

function renderPremadeCards() {
  const listEl = document.getElementById("premade-list");
  if (!listEl) return;

  listEl.innerHTML = "";

  const baseColors = getBaseColors();

  if (!inventoryData.length) {
    listEl.innerHTML =
      '<div class="helper-text">No premade items are configured yet.</div>';

    renderCustomColorOptions();
    return;
  }

  const orderMap = {
    available: 0,
    limited: 1,
    temp: 2,
    unavailable: 3
  };

  const sorted = [...inventoryData].sort(
    (a, b) =>
      (orderMap[a.availability] ?? 99) -
      (orderMap[b.availability] ?? 99)
  );

  sorted.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "premade-card";

    const left = document.createElement("div");
    left.className = "premade-main";

    const topRow = document.createElement("div");
    topRow.className = "premade-top-row";

    const titleWrap = document.createElement("div");

    const title = document.createElement("h3");
    title.textContent = item.name;
    titleWrap.appendChild(title);

    const priceEl = document.createElement("div");
    priceEl.className = "premade-price";
    priceEl.textContent = formatCurrency(item.price);
    titleWrap.appendChild(priceEl);

    topRow.appendChild(titleWrap);

    const previewBtn = document.createElement("button");
    previewBtn.className = "btn btn-ghost btn-small preview-btn";
    previewBtn.type = "button";
    previewBtn.textContent = "Preview";
    previewBtn.addEventListener("click", () => openPreviewModal(item.name));
    topRow.appendChild(previewBtn);

    left.appendChild(topRow);

    const statusWrap = document.createElement("div");
    statusWrap.style.marginTop = "4px";

    const badge = document.createElement("span");
    badge.className = "badge";

    if (item.availability === "available") {
      badge.classList.add("badge-available");
      badge.textContent = "Available";
    } else if (item.availability === "temp") {
      badge.classList.add("badge-temp");
      badge.textContent = "Temporarily unavailable";
    } else if (item.availability === "limited") {
      badge.classList.add("badge-limited");
      badge.textContent =
        item.stock != null ? `Limited (${item.stock} premades)` : "Limited";
    } else {
      badge.classList.add("badge-unavailable");
      badge.textContent = "Unavailable";
    }

    statusWrap.appendChild(badge);
    left.appendChild(statusWrap);

    if (item.filamentKgNeeded > 0) {
      const filamentNote = document.createElement("div");
      filamentNote.className = "premade-note";
      filamentNote.textContent = `Uses about ${formatKg(
        item.filamentKgNeeded
      )} filament each.`;
      left.appendChild(filamentNote);
    }

    const stockLabel = document.createElement("div");
    stockLabel.className = "premade-stock-label";
    stockLabel.style.display = "none";

    if (item.stock != null) stockLabel.textContent = `Stock: ${item.stock}`;

    left.appendChild(stockLabel);

    if (item.notes) {
      const note = document.createElement("div");
      note.className = "premade-note";
      note.textContent = item.notes;
      left.appendChild(note);
    }

    const right = document.createElement("div");

    const colorRow = document.createElement("div");
    colorRow.className = "field-row";

    const colorLabel = document.createElement("label");
    colorLabel.textContent = "Color";
    colorRow.appendChild(colorLabel);

    const colorSelect = document.createElement("select");
    colorSelect.id = `premade-color-${index}`;

    const hasPremadeStock =
      item.stock != null &&
      item.stock > 0 &&
      item.availability !== "unavailable";

    if (item.isLimited) {
      const opt = document.createElement("option");
      opt.value = "__premade";
      opt.textContent = "Premade (15% off, random color)";
      colorSelect.appendChild(opt);
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select color";
      colorSelect.appendChild(placeholder);

      baseColors.forEach((color) => {
        const option = document.createElement("option");
        option.value = color.name;
        option.textContent = buildColorOptionLabel(
          color,
          item.filamentKgNeeded
        );

        if (shouldDisableColor(color, item.filamentKgNeeded)) {
          option.disabled = true;
        }

        colorSelect.appendChild(option);
      });

      if (hasPremadeStock) {
        const prem = document.createElement("option");
        prem.value = "__premade";
        prem.textContent = "Premade (15% off, random color)";
        colorSelect.appendChild(prem);
      }
    }

    colorSelect.addEventListener("change", () => {
      if (colorSelect.value === "__premade" && item.stock != null) {
        stockLabel.style.display = "inline-block";
      } else {
        stockLabel.style.display = "none";
      }
    });

    colorRow.appendChild(colorSelect);
    right.appendChild(colorRow);

    const qtyRow = document.createElement("div");
    qtyRow.className = "field-row";

    const qtyLabel = document.createElement("label");
    qtyLabel.textContent = "Quantity";
    qtyRow.appendChild(qtyLabel);

    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.step = "1";
    qtyInput.value = "1";
    qtyInput.id = `premade-qty-${index}`;

    qtyRow.appendChild(qtyInput);
    right.appendChild(qtyRow);

    const btn = document.createElement("button");
    btn.textContent = "Add to cart";
    btn.className = "btn btn-primary";
    btn.style.width = "100%";

    if (item.availability === "unavailable" || item.availability === "temp") {
      btn.disabled = true;
      btn.textContent =
        item.availability === "temp"
          ? "Temporarily unavailable"
          : "Unavailable";
      colorSelect.disabled = true;
      qtyInput.disabled = true;
    }

    btn.addEventListener("click", () => {
      if (btn.disabled) return;

      let qtyVal = Math.max(1, Number(qtyInput.value) || 1);
      let mode;
      let color;
      let maxStock = null;
      let subtractFilament = false;

      if (item.isLimited) {
        if (!hasPremadeStock) {
          showSubmitMessage(`Sorry, "${item.name}" premades are sold out.`, true);
          return;
        }

        mode = "Premade";
        color = "Premade";
        maxStock = item.stock;
        subtractFilament = false;
      } else {
        const selected = colorSelect.value;

        if (selected === "__premade") {
          if (!hasPremadeStock) {
            showSubmitMessage(`Sorry, "${item.name}" premades are sold out.`, true);
            return;
          }

          mode = "Premade";
          color = "Premade";
          maxStock = item.stock;
          subtractFilament = false;
        } else {
          if (!selected) {
            showSubmitMessage("Please choose a color or the premade option.", true);
            return;
          }

          const neededTotal = item.filamentKgNeeded * qtyVal;

          if (
            item.filamentKgNeeded > 0 &&
            !colorHasEnoughFilament(selected, item.filamentKgNeeded, qtyVal)
          ) {
            const selectedColor = getColorByName(selected);
            showSubmitMessage(
              `${selected} does not have enough filament for ${qtyVal}x "${item.name}". Needed: ${formatKg(
                neededTotal
              )}, available: ${formatKg(selectedColor ? selectedColor.kgRemaining : 0)}.`,
              true
            );
            return;
          }

          mode = "Color";
          color = selected;
          maxStock = null;
          subtractFilament = item.filamentKgNeeded > 0;
        }
      }

      addToCart(
        {
          name: item.name,
          mode,
          color,
          price:
            mode === "Premade" ? item.price * PREMADE_DISCOUNT : item.price,
          maxStock,
          filamentKgNeeded: item.filamentKgNeeded,
          subtractFilament
        },
        qtyVal
      );
    });

    right.appendChild(btn);

    card.appendChild(left);
    card.appendChild(right);
    listEl.appendChild(card);
  });

  renderCustomColorOptions();
}

// ---------- CART ----------

function addToCart(itemBase, qty) {
  qty = Math.max(1, Number(qty) || 1);

  if (itemBase.maxStock != null) {
    const existingQty = cart
      .filter(
        (c) =>
          c.name === itemBase.name &&
          c.mode === itemBase.mode &&
          c.color === itemBase.color
      )
      .reduce((sum, c) => sum + c.quantity, 0);

    const remaining = itemBase.maxStock - existingQty;

    if (remaining <= 0) {
      showSubmitMessage(`Sorry, "${itemBase.name}" premades are sold out.`, true);
      return;
    }

    if (qty > remaining) qty = remaining;
  }

  const existing = cart.find(
    (c) =>
      c.name === itemBase.name &&
      c.mode === itemBase.mode &&
      c.color === itemBase.color
  );

  if (existing) {
    let newQty = existing.quantity + qty;

    if (itemBase.maxStock != null && newQty > itemBase.maxStock) {
      newQty = itemBase.maxStock;
    }

    existing.quantity = newQty;
  } else {
    cart.push({
      name: itemBase.name,
      mode: itemBase.mode,
      color: itemBase.color,
      unitPrice: itemBase.price,
      quantity: qty,
      maxStock: itemBase.maxStock,
      filamentKgNeeded: itemBase.filamentKgNeeded || 0,
      subtractFilament: Boolean(itemBase.subtractFilament)
    });
  }

  renderCart();
  updateTotals();
  showSubmitMessage("", false);
}

function detailLabelForItem(item) {
  if (item.mode === "Premade") return "Premade";
  if (item.mode === "Color") return item.color || "Color";
  if (item.mode === "Custom") return `Custom quote / ${item.color || "N/A"}`;
  return item.color || item.mode || "";
}

function renderCart() {
  const itemsEl = document.getElementById("cart-items");
  const countEl = document.getElementById("cart-count");
  const emptyNote = document.getElementById("empty-cart-note");
  const summaryEl = document.getElementById("cart-summary");

  if (!itemsEl || !countEl || !emptyNote || !summaryEl) return;

  itemsEl.innerHTML = "";

  if (!cart.length) {
    countEl.textContent = "0 items";
    emptyNote.style.display = "block";
    summaryEl.style.display = "none";
    updateTotals();
    return;
  }

  emptyNote.style.display = "none";
  summaryEl.style.display = "block";

  let totalItems = 0;

  cart.forEach((item, idx) => {
    totalItems += item.quantity;

    const row = document.createElement("div");
    row.className = "cart-item";

    const left = document.createElement("div");

    const title = document.createElement("div");
    title.className = "cart-item-title";

    const detail = detailLabelForItem(item);
    title.textContent = detail ? `${item.name} (${detail})` : item.name;

    const sub = document.createElement("div");
    sub.className = "cart-item-sub";

    if (item.mode === "Custom") {
      sub.textContent = "Manual quote/review — filament not auto-subtracted";
    } else if (item.subtractFilament && item.filamentKgNeeded > 0) {
      sub.textContent = `Filament use: ${formatKg(
        item.filamentKgNeeded * item.quantity
      )}`;
    }

    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "cart-item-right";

    const minusBtn = document.createElement("button");
    minusBtn.className = "btn-circle";
    minusBtn.textContent = "–";
    minusBtn.type = "button";
    minusBtn.addEventListener("click", () => {
      if (item.quantity > 1) {
        item.quantity -= 1;
      } else {
        cart.splice(idx, 1);
      }

      renderCart();
    });

    const qty = document.createElement("span");
    qty.textContent = item.quantity;

    const plusBtn = document.createElement("button");
    plusBtn.className = "btn-circle";
    plusBtn.textContent = "+";
    plusBtn.type = "button";
    plusBtn.addEventListener("click", () => {
      const newQty = item.quantity + 1;

      if (item.maxStock != null && newQty > item.maxStock) {
        return;
      }

      if (
        item.subtractFilament &&
        item.filamentKgNeeded > 0 &&
        !colorHasEnoughFilament(item.color, item.filamentKgNeeded, newQty)
      ) {
        const selectedColor = getColorByName(item.color);
        showSubmitMessage(
          `${item.color} does not have enough filament for ${newQty}x "${item.name}". Needed: ${formatKg(
            item.filamentKgNeeded * newQty
          )}, available: ${formatKg(selectedColor ? selectedColor.kgRemaining : 0)}.`,
          true
        );
        return;
      }

      item.quantity = newQty;
      renderCart();
    });

    const price = document.createElement("div");
    price.className = "cart-item-price";
    price.textContent = formatCurrency(item.unitPrice * item.quantity);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.type = "button";
    removeBtn.addEventListener("click", () => {
      cart.splice(idx, 1);
      renderCart();
    });

    right.appendChild(minusBtn);
    right.appendChild(qty);
    right.appendChild(plusBtn);
    right.appendChild(price);
    right.appendChild(removeBtn);

    row.appendChild(left);
    row.appendChild(right);

    itemsEl.appendChild(row);
  });

  countEl.textContent = totalItems === 1 ? "1 item" : `${totalItems} items`;

  updateTotals();
}

// ---------- TOTALS ----------

function getShippingCharge(expediteChoice) {
  if (expediteChoice === "priority") return 20;
  if (expediteChoice === "rush") return 25;
  return 15;
}

function getExpediteFee(itemsSubtotal, expediteChoice) {
  if (itemsSubtotal <= 0) return 0;
  if (expediteChoice === "priority") return itemsSubtotal * 0.1;
  if (expediteChoice === "rush") return itemsSubtotal * 0.18;
  return 0;
}

function updateTotals() {
  const itemsSubtotalEl = document.getElementById("items-subtotal");
  const shippingEl = document.getElementById("shipping-estimate");
  const expediteEl = document.getElementById("expedite-fee");
  const grandEl = document.getElementById("grand-total");
  const promoRow = document.getElementById("promo-row");
  const promoValueEl = document.getElementById("promo-discount-value");

  if (!itemsSubtotalEl || !shippingEl || !expediteEl || !grandEl) return;

  let itemsSubtotal = 0;
  let customSubtotal = 0;

  cart.forEach((item) => {
    const sub = item.unitPrice * item.quantity;
    itemsSubtotal += sub;
    if (item.mode === "Custom") customSubtotal += sub;
  });

  const expediteChoiceEl = document.getElementById("expedite-choice");
  const expediteChoice = expediteChoiceEl ? expediteChoiceEl.value : "none";

  const shippingCharge = cart.length ? getShippingCharge(expediteChoice) : 0;
  const expediteFee = getExpediteFee(itemsSubtotal, expediteChoice);

  promoDiscountAmount = 0;

  if (appliedPromo) {
    const base =
      appliedPromo.scope === "custom" ? customSubtotal : itemsSubtotal;

    if (base > 0) {
      if (appliedPromo.type === "percent") {
        promoDiscountAmount = (base * appliedPromo.amount) / 100;
      } else if (appliedPromo.type === "fixed") {
        promoDiscountAmount = appliedPromo.amount;
      }

      if (promoDiscountAmount > base) promoDiscountAmount = base;
    }
  }

  const itemsAfterPromo = Math.max(itemsSubtotal - promoDiscountAmount, 0);
  const grandTotal = itemsAfterPromo + shippingCharge + expediteFee;

  itemsSubtotalEl.textContent = formatCurrency(itemsSubtotal);
  shippingEl.textContent = formatCurrency(shippingCharge);
  expediteEl.textContent = formatCurrency(expediteFee);
  grandEl.textContent = formatCurrency(grandTotal);

  if (promoRow && promoValueEl) {
    if (promoDiscountAmount > 0) {
      promoRow.style.display = "flex";
      promoValueEl.textContent = "-" + formatCurrency(promoDiscountAmount);
    } else {
      promoRow.style.display = "none";
      promoValueEl.textContent = "";
    }
  }
}

// ---------- VALIDATION / MESSAGES ----------

function isValidEmail(value) {
  const trimmed = value.trim();
  if (!trimmed.includes("@") || !trimmed.includes(".")) return false;
  if (trimmed.length < 6) return false;
  if (trimmed.startsWith("@")) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(trimmed.toLowerCase());
}

function isValidPhone(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return false;
  const forbidden = ["0000000000", "1111111111", "1234567890"];
  return !forbidden.includes(digits.slice(-10));
}

function formatPhonePretty(value) {
  const digits = value.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return value;
  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function showSubmitMessage(msg, isError) {
  const el = document.getElementById("submit-message");
  if (!el) return;

  if (!msg) {
    el.textContent = "";
    el.className = "helper-text";
    return;
  }

  el.textContent = msg;
  el.className = isError ? "error-text" : "success-text";
}

function showPromoMessage(msg, isError) {
  const el = document.getElementById("promo-message");
  if (!el) return;

  if (!msg) {
    el.textContent = "";
    el.className = "helper-text";
    return;
  }

  el.textContent = msg;
  el.className = isError ? "error-text" : "success-text";
}

function showSuggestionMessage(msg, isError) {
  const el = document.getElementById("suggestion-message");
  if (!el) return;

  if (!msg) {
    el.textContent = "";
    el.className = "helper-text";
    return;
  }

  el.textContent = msg;
  el.className = isError ? "error-text" : "success-text";
}

// ---------- PROMOS ----------

function clearPromo() {
  appliedPromo = null;
  promoDiscountAmount = 0;

  const input = document.getElementById("promo-code");
  if (input) input.value = "";

  showPromoMessage("", false);
  updateTotals();
}

function applyPromoCode() {
  if (!cart.length) {
    showPromoMessage("Add something to your cart before applying a code.", true);
    return;
  }

  const input = document.getElementById("promo-code");
  if (!input) return;

  const raw = input.value.trim();

  if (!raw) {
    showPromoMessage("Enter a promo code first.", true);
    return;
  }

  const codeUpper = raw.toUpperCase();
  const promo = promosData.find((p) => p.code === codeUpper);

  if (!promo) {
    showPromoMessage("That code is not valid right now.", true);
    appliedPromo = null;
    updateTotals();
    return;
  }

  if (promo.statusNorm === "off use") {
    showPromoMessage("That code is not active right now.", true);
    appliedPromo = null;
    updateTotals();
    return;
  }

  if (promo.statusNorm === "limited") {
    if (promo.limit == null || promo.limit <= 0) {
      showPromoMessage("That code has reached its usage limit.", true);
      appliedPromo = null;
      updateTotals();
      return;
    }
  }

  appliedPromo = {
    code: promo.code,
    type: promo.discountType,
    amount: promo.discountAmount,
    scope: promo.scope,
    statusNorm: promo.statusNorm
  };

  const scopeText = promo.scope === "custom" ? "custom prints" : "cart total";

  const discountText =
    promo.discountType === "percent"
      ? `${promo.discountAmount}% off ${scopeText}`
      : `$${promo.discountAmount.toFixed(2)} off ${scopeText}`;

  showPromoMessage(`Promo "${raw}" applied: ${discountText}.`, false);
  updateTotals();
}

// ---------- WEBHOOKS / SHEET UPDATES ----------

async function sendOrderWebhook(content) {
  if (!ORDER_WEBHOOK_URL) return;

  const payload = { content };

  try {
    const res = await fetch(ORDER_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error("[ORDER WEBHOOK] Failed", await res.text());
    }
  } catch (err) {
    console.error("[ORDER WEBHOOK] Error", err);
  }
}

function buildFilamentPayload() {
  const inventoryUpdates = [];
  const filamentUsageByColor = {};

  cart.forEach((item) => {
    if (item.mode === "Premade" && item.maxStock != null) {
      inventoryUpdates.push({
        name: item.name,
        qty: item.quantity
      });
    }

    if (
      item.subtractFilament &&
      item.mode === "Color" &&
      item.color &&
      item.color !== "Premade" &&
      item.filamentKgNeeded > 0
    ) {
      const key = item.color.trim();
      if (!filamentUsageByColor[key]) filamentUsageByColor[key] = 0;
      filamentUsageByColor[key] += item.filamentKgNeeded * item.quantity;
    }
  });

  const filamentUsage = Object.keys(filamentUsageByColor).map((color) => ({
    color,
    kg: Number(filamentUsageByColor[color].toFixed(6))
  }));

  const payload = {};

  if (inventoryUpdates.length) payload.items = inventoryUpdates;
  if (filamentUsage.length) payload.filamentUsage = filamentUsage;

  if (appliedPromo && appliedPromo.statusNorm === "limited") {
    payload.promoCodeUsed = appliedPromo.code;
  }

  return payload;
}

async function sendStockAndFilamentUpdate() {
  if (!STOCK_WEBAPP_URL || STOCK_WEBAPP_URL.includes("PASTE_")) return;

  const payload = buildFilamentPayload();

  if (!Object.keys(payload).length) return;

  try {
    await fetch(STOCK_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("[WEBAPP] Failed to send update", err);
  }
}

async function sendSuggestionWebhook(content) {
  if (!SUGGESTIONS_WEBHOOK_URL) {
    throw new Error("Suggestions webhook not configured.");
  }

  const payload = { content };

  const res = await fetch(SUGGESTIONS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error("Suggestions webhook failed.");
}

// ---------- SUGGESTIONS ----------

async function handleSubmitSuggestion() {
  const nameInput = document.getElementById("suggestion-name");
  const contactInput = document.getElementById("suggestion-contact");
  const titleInput = document.getElementById("suggestion-title");
  const detailsInput = document.getElementById("suggestion-details");
  const linkInput = document.getElementById("suggestion-link");
  const btn = document.getElementById("submit-suggestion-btn");

  const name = nameInput ? nameInput.value.trim() : "";
  const contact = contactInput ? contactInput.value.trim() : "";
  const title = titleInput ? titleInput.value.trim() : "";
  const details = detailsInput ? detailsInput.value.trim() : "";
  const link = linkInput ? linkInput.value.trim() : "";

  if (!title) {
    showSuggestionMessage("Please add a suggestion title.", true);
    return;
  }

  if (!details) {
    showSuggestionMessage("Please add some details for the suggestion.", true);
    return;
  }

  const lines = [];
  lines.push("**New website suggestion**");
  lines.push("");
  lines.push(`**Title:** ${title}`);
  lines.push(`**Details:** ${details}`);
  if (name) lines.push(`**Name:** ${name}`);
  if (contact) lines.push(`**Contact:** ${contact}`);
  if (link) lines.push(`**Reference link:** ${link}`);

  showSuggestionMessage("Sending suggestion…", false);
  if (btn) btn.disabled = true;

  try {
    await sendSuggestionWebhook(lines.join("\n"));

    showSuggestionMessage("Suggestion sent! Thank you.", false);

    if (nameInput) nameInput.value = "";
    if (contactInput) contactInput.value = "";
    if (titleInput) titleInput.value = "";
    if (detailsInput) detailsInput.value = "";
    if (linkInput) linkInput.value = "";
  } catch (err) {
    console.error(err);
    showSuggestionMessage("Sorry, there was an error sending the suggestion.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- ORDER SUBMISSION ----------

function validateFilamentBeforeSubmit() {
  const usage = {};

  cart.forEach((item) => {
    if (
      item.subtractFilament &&
      item.mode === "Color" &&
      item.color &&
      item.filamentKgNeeded > 0
    ) {
      if (!usage[item.color]) usage[item.color] = 0;
      usage[item.color] += item.filamentKgNeeded * item.quantity;
    }
  });

  for (const colorName of Object.keys(usage)) {
    const color = getColorByName(colorName);
    const available = color ? color.kgRemaining : 0;
    const needed = usage[colorName];

    if (available < needed) {
      return {
        ok: false,
        message: `${colorName} does not have enough filament. Needed: ${formatKg(
          needed
        )}, available: ${formatKg(available)}.`
      };
    }
  }

  return { ok: true, message: "" };
}

async function handleSubmitOrder() {
  if (!cart.length) {
    showSubmitMessage("Your cart is empty.", true);
    return;
  }

  const filamentCheck = validateFilamentBeforeSubmit();
  if (!filamentCheck.ok) {
    showSubmitMessage(filamentCheck.message, true);
    return;
  }

  const nameInput = document.getElementById("customer-name");
  const contactInput = document.getElementById("customer-contact");
  const shippingInfoInput = document.getElementById("shipping-info");
  const notesInput = document.getElementById("extra-notes");
  const expediteChoiceEl = document.getElementById("expedite-choice");

  const expediteChoice = expediteChoiceEl ? expediteChoiceEl.value : "none";

  let contact = contactInput.value.trim();

  if (!contact) {
    showSubmitMessage("Contact info is required (phone or email).", true);
    return;
  }

  const isEmail = isValidEmail(contact);
  const isPhone = isValidPhone(contact);

  if (!isEmail && !isPhone) {
    showSubmitMessage("Contact must be a real-looking email or phone number.", true);
    return;
  }

  if (isPhone) {
    contact = formatPhonePretty(contact);
    contactInput.value = contact;
  }

  const nameText = nameInput.value.trim();

  if (!nameText) {
    showSubmitMessage("Name is required for every order.", true);
    return;
  }

  const shipText = shippingInfoInput.value.trim();

  if (!shipText) {
    showSubmitMessage(
      "Shipping address is required for every order. If you want local pickup in Worcester, MA, mention it in the extra notes.",
      true
    );
    return;
  }

  const orderId = nextOrderNumber();

  let itemsSubtotal = 0;
  let customSubtotal = 0;

  cart.forEach((item) => {
    const sub = item.unitPrice * item.quantity;
    itemsSubtotal += sub;
    if (item.mode === "Custom") customSubtotal += sub;
  });

  const shippingCharge = getShippingCharge(expediteChoice);
  const expediteFee = getExpediteFee(itemsSubtotal, expediteChoice);

  promoDiscountAmount = 0;

  if (appliedPromo) {
    const base =
      appliedPromo.scope === "custom" ? customSubtotal : itemsSubtotal;

    if (base > 0) {
      if (appliedPromo.type === "percent") {
        promoDiscountAmount = (base * appliedPromo.amount) / 100;
      } else if (appliedPromo.type === "fixed") {
        promoDiscountAmount = appliedPromo.amount;
      }

      if (promoDiscountAmount > base) promoDiscountAmount = base;
    }
  }

  const itemsAfterPromo = Math.max(itemsSubtotal - promoDiscountAmount, 0);
  const grandTotal = itemsAfterPromo + shippingCharge + expediteFee;

  const lines = [];

  lines.push(`**New order #${orderId}**`);
  lines.push("");
  lines.push("**Items:**");

  cart.forEach((item) => {
    const subtotal = item.unitPrice * item.quantity;
    const detail = detailLabelForItem(item);
    const displayName = detail ? `${item.name} (${detail})` : item.name;

    let line = `• ${displayName} x${item.quantity} — ${formatCurrency(subtotal)}`;

    if (item.mode === "Custom") {
      line += " — manual quote/review";
    } else if (item.subtractFilament && item.filamentKgNeeded > 0) {
      line += ` — filament used: ${formatKg(
        item.filamentKgNeeded * item.quantity
      )}`;
    }

    lines.push(line);
  });

  lines.push("");
  lines.push(`Items subtotal: ${formatCurrency(itemsSubtotal)}`);

  if (promoDiscountAmount > 0) {
    lines.push(
      `Promo discount: -${formatCurrency(promoDiscountAmount)}${
        appliedPromo ? ` (code ${appliedPromo.code})` : ""
      }`
    );
  }

  lines.push(`Shipping: ${formatCurrency(shippingCharge)}`);
  lines.push(`Expedite fee: ${formatCurrency(expediteFee)}`);
  lines.push(`**Total: ${formatCurrency(grandTotal)}**`);
  lines.push("");
  lines.push(`**Contact:** ${contact}`);
  lines.push(`**Name:** ${nameText}`);
  lines.push("**Delivery:** Shipping by default — " + shipText);
  lines.push(
    "**Local pickup note:** Worcester, MA pickup is by appointment only if requested in notes and approved after purchase confirmation."
  );

  const notesText = notesInput.value.trim();

  if (notesText) lines.push(`**Notes:** ${notesText}`);

  lines.push(`**Payment:** Square invoice needed — send invoice to ${contact}`);

  const summary = lines.join("\n");

  showSubmitMessage("Submitting order…", false);

  const submitBtn = document.getElementById("submit-order-btn");
  if (submitBtn) submitBtn.disabled = true;

  try {
    await Promise.all([sendOrderWebhook(summary), sendStockAndFilamentUpdate()]);

    const msg = `Order submitted! Your order number is ${orderId}.`;

    showSubmitMessage(msg, false);
    alert(msg);

    cart = [];
    appliedPromo = null;
    promoDiscountAmount = 0;

    renderCart();

    nameInput.value = "";
    shippingInfoInput.value = "";
    notesInput.value = "";
    contactInput.value = "";

    const promoInput = document.getElementById("promo-code");
    if (promoInput) promoInput.value = "";

    showPromoMessage("", false);

    await refreshShopData();
  } catch (err) {
    console.error("[ORDER] Submit error", err);
    showSubmitMessage("Sorry, there was an error submitting your order.", true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------- CUSTOM PRINT ----------

function handleAddCustomPrint() {
  const fileInput = document.getElementById("custom-file");
  const sizeSelect = document.getElementById("custom-size");
  const detailSelect = document.getElementById("custom-detail");
  const colorSelect = document.getElementById("custom-color");
  const qtyInput = document.getElementById("custom-qty");

  const file = fileInput.files[0];

  if (!file) {
    showSubmitMessage("Please upload a file for custom prints.", true);
    switchShopTab("custom");
    return;
  }

  const color = colorSelect.value;

  if (!color) {
    showSubmitMessage("Please choose a preferred color for the custom print.", true);
    switchShopTab("custom");
    return;
  }

  const qty = Math.max(1, Number(qtyInput.value) || 1);

  let basePrice = 5;

  const size = sizeSelect.value;
  const detail = detailSelect.value;

  if (size === "medium") basePrice += 3;
  if (size === "large") basePrice += 7;
  if (detail === "high") basePrice += 2;
  if (detail === "ultra") basePrice += 5;

  addToCart(
    {
      name: file.name,
      mode: "Custom",
      color,
      price: basePrice,
      maxStock: null,
      filamentKgNeeded: 0,
      subtractFilament: false
    },
    qty
  );

  const estText = document.getElementById("custom-estimate-text");
  if (estText) {
    estText.textContent =
      "Custom quote request added to cart. Final price and filament use will be reviewed manually.";
  }
}

// ---------- REFRESH / INIT ----------

async function refreshShopData() {
  await loadConfig();

  previewsPreloaded = false;
  previewFileIndex = [];
  previewFileMap = {};

  await loadColors();

  await Promise.all([loadInventory(), loadPromos(), loadDrivePreviewIndex()]);
}

async function init() {
  await refreshShopData();

  const expediteChoiceEl = document.getElementById("expedite-choice");
  if (expediteChoiceEl) {
    expediteChoiceEl.addEventListener("change", updateTotals);
  }

  const addCustomBtn = document.getElementById("add-custom-btn");
  if (addCustomBtn) {
    addCustomBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleAddCustomPrint();
    });
  }

  const submitBtn = document.getElementById("submit-order-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleSubmitOrder();
    });
  }

  const applyPromoBtn = document.getElementById("apply-promo-btn");
  if (applyPromoBtn) {
    applyPromoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      applyPromoCode();
    });
  }

  const clearPromoBtn = document.getElementById("clear-promo-btn");
  if (clearPromoBtn) {
    clearPromoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearPromo();
    });
  }

  document.querySelectorAll(".shop-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchShopTab(btn.dataset.tab);
    });
  });

  const suggestionBtn = document.getElementById("submit-suggestion-btn");
  if (suggestionBtn) {
    suggestionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleSubmitSuggestion();
    });
  }

  const closePreviewBtn = document.getElementById("close-preview-btn");
  if (closePreviewBtn) {
    closePreviewBtn.addEventListener("click", closePreviewModal);
  }

  const previewPrevBtn = document.getElementById("preview-prev-btn");
  if (previewPrevBtn) {
    previewPrevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      movePreview(-1);
    });
  }

  const previewNextBtn = document.getElementById("preview-next-btn");
  if (previewNextBtn) {
    previewNextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      movePreview(1);
    });
  }

  const previewModal = document.getElementById("preview-modal");
  if (previewModal) {
    previewModal.addEventListener("click", (e) => {
      if (e.target === previewModal) closePreviewModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    const previewModalEl = document.getElementById("preview-modal");
    const previewOpen =
      previewModalEl && !previewModalEl.classList.contains("hidden");

    if (e.key === "Escape") closePreviewModal();
    if (previewOpen && e.key === "ArrowLeft") movePreview(-1);
    if (previewOpen && e.key === "ArrowRight") movePreview(1);
  });

  renderCart();

  setInterval(() => {
    refreshShopData();
  }, 30000);
}

window.addEventListener("DOMContentLoaded", init);
