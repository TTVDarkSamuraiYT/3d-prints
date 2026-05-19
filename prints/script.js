// ---------- GLOBALS ----------
let SHEET_ID = "";
let INVENTORY_SHEET_NAME = "";
let COLORS_SHEET_NAME = "";
let ORDERS_SHEET_NAME = "";
let ORDER_WEBHOOK_URL = "";
let STOCK_WEBAPP_URL = "";
let SUGGESTIONS_WEBHOOK_URL = "";
let PRINT_PREVIEWS_FOLDER_URL = "";
let CASHAPP_TAG = "";

let PROMOS_SHEET_NAME = "Promos";

let colorsData = [];
let inventoryData = [];
let promosData = [];
let cart = [];

let appliedPromo = null; // { code, type, amount, scope, statusNorm }
let promoDiscountAmount = 0;

const PREMADE_DISCOUNT = 0.85;

// ---------- ORDER ID (NEVER DUPLICATE) ----------
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

// ---------- HELPERS ----------

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function normalizeStatus(str) {
  if (!str) return "";
  return String(str).trim().toLowerCase();
}

function parseSheetJSON(text) {
  const json = JSON.parse(
    text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1)
  );
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
    if (n > 0 && n <= 1) {
      return { type: "percent", amount: n * 100 };
    }
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

function buildDriveSearchUrl(itemName) {
  const query = `"${itemName}"`;
  return "https://drive.google.com/drive/search?q=" + encodeURIComponent(query);
}

function openPreviewModal(itemName) {
  const modal = document.getElementById("preview-modal");
  const title = document.getElementById("preview-title");
  const copy = document.getElementById("preview-copy");
  const folderLink = document.getElementById("preview-folder-link");
  const searchLink = document.getElementById("preview-search-link");

  if (!modal || !title || !copy || !folderLink || !searchLink) return;

  title.textContent = `${itemName} preview`;
  copy.textContent =
    `Photos or clips for "${itemName}" should be saved in the preview folder with the same item name. ` +
    "Open the folder or search the item name to view what is available.";

  const folderUrl = PRINT_PREVIEWS_FOLDER_URL || "#";
  folderLink.href = folderUrl;
  folderLink.style.display = PRINT_PREVIEWS_FOLDER_URL ? "inline-flex" : "none";
  searchLink.href = buildDriveSearchUrl(itemName);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closePreviewModal() {
  const modal = document.getElementById("preview-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function switchShopTab(tabName) {
  document.querySelectorAll(".shop-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });
}

// ---------- CONFIG / SHEET LOADING ----------

const CONFIG_PATH = "../config.json";

async function loadConfig() {
  try {
    const res = await fetch(CONFIG_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error("config fetch failed");
    const cfg = await res.json();

    SHEET_ID = cfg.SHEET_ID;
    INVENTORY_SHEET_NAME = cfg.INVENTORY_SHEET_NAME;
    COLORS_SHEET_NAME = cfg.COLORS_SHEET_NAME;
    ORDERS_SHEET_NAME = cfg.ORDERS_SHEET_NAME || "Orders";
    ORDER_WEBHOOK_URL = cfg.ORDER_WEBHOOK_URL;
    STOCK_WEBAPP_URL = cfg.STOCK_WEBAPP_URL || "";
    SUGGESTIONS_WEBHOOK_URL = cfg.SUGGESTIONS_WEBHOOK_URL || "";
    PRINT_PREVIEWS_FOLDER_URL = cfg.PRINT_PREVIEWS_FOLDER_URL || "";
    CASHAPP_TAG = cfg.CASHAPP_TAG || "$CashApp";
    PROMOS_SHEET_NAME = cfg.PROMOS_SHEET_NAME || "Promos";

    const cashTagEl = document.getElementById("cashapp-tag-display");
    if (cashTagEl) cashTagEl.textContent = CASHAPP_TAG;

    console.log("Config loaded.");
  } catch (err) {
    console.error("Error loading config.json", err);
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

    const res = await fetch(url);
    if (!res.ok) throw new Error("colors fetch failed");
    const text = await res.text();
    const rows = parseSheetJSON(text);

    colorsData = rows
      .map((r) => {
        const c = r.c || [];
        const name = c[0]?.v ? String(c[0].v).trim() : "";
        const status = c[1]?.v ? String(c[1].v).trim() : "";
        if (!name) return null;
        const normStatus = normalizeStatus(status);
        return {
          name,
          status,
          normStatus,
        };
      })
      .filter(Boolean);

    console.log("Colors from sheet:", colorsData);
  } catch (err) {
    console.error("Error loading colors sheet", err);
    colorsData = [];
  }
}

async function loadInventory() {
  const inventoryError = document.getElementById("inventory-error");
  if (!SHEET_ID || !INVENTORY_SHEET_NAME) return;
  try {
    inventoryError.style.display = "none";

    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(SHEET_ID) +
      "/gviz/tq?tqx=out:json&sheet=" +
      encodeURIComponent(INVENTORY_SHEET_NAME);

    const res = await fetch(url);
    if (!res.ok) throw new Error("inventory fetch failed");
    const text = await res.text();
    const rows = parseSheetJSON(text);

    const mapped = rows
      .map((r) => {
        const c = r.c || [];
        const name = c[0]?.v ? String(c[0].v).trim() : "";
        const priceRaw = c[1]?.v;
        const stockRaw = c[2]?.v;
        const statusRaw = c[3]?.v ? String(c[3].v).trim() : "";
        const notes = c[4]?.v ? String(c[4].v).trim() : "";

        if (!name || priceRaw === null || priceRaw === "") {
          return null;
        }

        const price = Number(priceRaw) || 0;
        const stock = safeNumber(stockRaw);
        const statusNorm = normalizeStatus(statusRaw);

        if (statusNorm === "offshelf") return null;

        const isLimited = statusNorm === "limited";
        if (isLimited && (stock === null || stock <= 0)) {
          return null;
        }

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
        };
      })
      .filter(Boolean);

    inventoryData = mapped;
    console.log("Inventory from sheet:", inventoryData);

    renderPremadeCards();
  } catch (err) {
    console.error("Error loading inventory sheet", err);
    inventoryError.style.display = "block";
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

    const res = await fetch(url);
    if (!res.ok) throw new Error("promos fetch failed");
    const text = await res.text();
    const rows = parseSheetJSON(text);

    promosData = rows
      .map((r) => {
        const c = r.c || [];
        const codeRaw = c[0]?.v;
        if (!codeRaw) return null;

        const discountRaw = c[1]?.v;
        const statusRaw = c[2]?.v ? String(c[2].v).trim() : "";
        const limitRaw = c[3]?.v;
        const discountedRaw = c[4]?.v ? String(c[4].v).trim() : "";

        const code = String(codeRaw).trim().toUpperCase();
        const discountParsed = parsePromoDiscount(discountRaw);
        if (!discountParsed) return null;

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
          scope,
        };
      })
      .filter(Boolean);

    console.log("Promos loaded:", promosData);
  } catch (err) {
    console.error("Error loading promos sheet", err);
    promosData = [];
  }
}

// ---------- COLOR HELPERS ----------

function getBaseColors() {
  // filter out header/premade row
  return colorsData.filter((c) => {
    const nameNorm = c.name.trim().toLowerCase();
    if (nameNorm === "colors" || nameNorm === "premade") return false;
    return true;
  });
}

// ---------- PREMIADES / CUSTOMS ----------

function renderPremadeCards() {
  const listEl = document.getElementById("premade-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const baseColors = getBaseColors();

  if (!inventoryData.length) {
    listEl.innerHTML =
      '<div class="helper-text">No premade items are configured yet.</div>';
    return;
  }

  // sort so available/limited at top, temp/unavailable at bottom
  const orderMap = { available: 0, limited: 1, temp: 2, unavailable: 3 };
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

    const title = document.createElement("h3");
    title.textContent = item.name;
    topRow.appendChild(title);

    const previewBtn = document.createElement("button");
    previewBtn.className = "btn btn-ghost btn-small preview-btn";
    previewBtn.type = "button";
    previewBtn.textContent = "Preview";
    previewBtn.title = `Preview photos or clips for ${item.name}`;
    previewBtn.addEventListener("click", () => {
      openPreviewModal(item.name);
    });
    topRow.appendChild(previewBtn);

    left.appendChild(topRow);

    const priceEl = document.createElement("div");
    priceEl.className = "premade-price";
    priceEl.textContent = formatCurrency(item.price);
    left.appendChild(priceEl);

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
      if (item.stock != null) {
        badge.textContent = `Limited (${item.stock} premades)`;
      } else {
        badge.textContent = "Limited";
      }
    } else {
      badge.classList.add("badge-unavailable");
      badge.textContent = "Unavailable";
    }

    statusWrap.appendChild(badge);
    left.appendChild(statusWrap);

    const stockLabel = document.createElement("div");
    stockLabel.className = "premade-stock-label";
    stockLabel.style.display = "none";
    if (item.stock != null) {
      stockLabel.textContent = `Stock: ${item.stock}`;
    }
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
      item.stock != null && item.stock > 0 && item.availability !== "unavailable";

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

      baseColors.forEach((c) => {
        const o = document.createElement("option");
        o.value = c.name;
        const norm = c.normStatus;
        let label = c.name;

        if (norm === "temporarily unavailable") {
          label += " (temp unavailable)";
        } else if (norm === "being resupplied") {
          label += " (being resupplied)";
        } else if (norm === "sold out" || norm === "unavailable") {
          label += " (unavailable)";
        }

        o.textContent = label;

        if (
          norm === "sold out" ||
          norm === "unavailable" ||
          norm === "temporarily unavailable"
        ) {
          o.disabled = true;
        }

        colorSelect.appendChild(o);
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

    const btnRow = document.createElement("div");
    const btn = document.createElement("button");
    btn.textContent = "Add to cart";
    btn.className = "btn btn-primary";
    btn.style.width = "100%";

    // disable controls when temp unavailable or unavailable
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

      if (item.isLimited) {
        if (!hasPremadeStock) {
          showSubmitMessage(
            `Sorry, "${item.name}" premades are sold out.`,
            true
          );
          return;
        }
        mode = "Premade";
        color = "Premade";
        maxStock = item.stock;
      } else {
        const selected = colorSelect.value;
        if (selected === "__premade") {
          if (!hasPremadeStock) {
            showSubmitMessage(
              `Sorry, "${item.name}" premades are sold out.`,
              true
            );
            return;
          }
          mode = "Premade";
          color = "Premade";
          maxStock = item.stock;
        } else {
          if (!selected) {
            showSubmitMessage(
              "Please choose a color or the premade option.",
              true
            );
            return;
          }
          mode = "Color";
          color = selected;
          maxStock = null;
        }
      }

      addToCart(
        {
          name: item.name,
          mode,
          color,
          price: mode === "Premade" ? item.price * PREMADE_DISCOUNT : item.price,
          maxStock,
        },
        qtyVal
      );
    });

    btnRow.appendChild(btn);
    right.appendChild(btnRow);

    card.appendChild(left);
    card.appendChild(right);
    listEl.appendChild(card);
  });

  // Custom colors: follow same status rules
  const customColorSelect = document.getElementById("custom-color");
  if (customColorSelect) {
    customColorSelect.innerHTML = '<option value="">Select color</option>';
    baseColors.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.name;
      const norm = c.normStatus;
      let label = c.name;

      if (norm === "temporarily unavailable") {
        label += " (temp unavailable)";
      } else if (norm === "being resupplied") {
        label += " (being resupplied)";
      } else if (norm === "sold out" || norm === "unavailable") {
        label += " (unavailable)";
      }

      o.textContent = label;

      if (
        norm === "sold out" ||
        norm === "unavailable" ||
        norm === "temporarily unavailable"
      ) {
        o.disabled = true;
      }

      customColorSelect.appendChild(o);
    });
  }
}

// ---------- CART / TOTALS (same as before) ----------

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
      showSubmitMessage(
        `Sorry, "${itemBase.name}" premades are sold out.`,
        true
      );
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
    });
  }

  renderCart();
  updateTotals();
  showSubmitMessage("", false);
}

function detailLabelForItem(item) {
  if (item.mode === "Premade") return "Premade";
  if (item.mode === "Color") return item.color || "Color";
  if (item.mode === "Custom") return `Custom / ${item.color || "N/A"}`;
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
    const displayName = detail ? `${item.name} (${detail})` : item.name;
    title.textContent = displayName;

    const sub = document.createElement("div");
    sub.className = "cart-item-sub";
    sub.textContent = "";

    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "cart-item-right";

    const minusBtn = document.createElement("button");
    minusBtn.className = "btn-circle";
    minusBtn.textContent = "–";
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
    plusBtn.addEventListener("click", () => {
      let newQty = item.quantity + 1;
      if (item.maxStock != null && newQty > item.maxStock) {
        newQty = item.maxStock;
      }
      item.quantity = newQty;
      renderCart();
    });

    const price = document.createElement("div");
    price.className = "cart-item-price";
    const subtotal = item.unitPrice * item.quantity;
    price.textContent = formatCurrency(subtotal);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-danger";
    removeBtn.textContent = "Remove";
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

function getShippingEstimate(itemsSubtotal, shippingChoice) {
  if (shippingChoice === "local") return 0;
  if (itemsSubtotal <= 0) return 0;
  if (itemsSubtotal <= 10) return 6.0;
  if (itemsSubtotal <= 40) return 9.0;
  return 14.0;
}

function getExpediteFee(itemsSubtotal, expediteChoice) {
  if (expediteChoice === "priority") {
    return Math.max(5, itemsSubtotal * 0.1);
  }
  if (expediteChoice === "rush") {
    return Math.max(10, itemsSubtotal * 0.18);
  }
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
    if (item.mode === "Custom") {
      customSubtotal += sub;
    }
  });

  const expediteChoiceEl = document.getElementById("expedite-choice");
  const expediteChoice = expediteChoiceEl
    ? expediteChoiceEl.value
    : "none";

  const shippingChoiceEl = document.getElementById("shipping-choice");
  const shippingChoice = shippingChoiceEl
    ? shippingChoiceEl.value
    : "shipping";

  const shippingEstimate = getShippingEstimate(
    itemsSubtotal,
    shippingChoice
  );
  const expediteFee = getExpediteFee(itemsSubtotal, expediteChoice);

  promoDiscountAmount = 0;
  if (appliedPromo) {
    let base = 0;
    if (appliedPromo.scope === "custom") {
      base = customSubtotal;
    } else {
      base = itemsSubtotal;
    }

    if (base > 0) {
      if (appliedPromo.type === "percent") {
        promoDiscountAmount = (base * appliedPromo.amount) / 100;
      } else if (appliedPromo.type === "fixed") {
        promoDiscountAmount = appliedPromo.amount;
      }

      if (promoDiscountAmount > base) {
        promoDiscountAmount = base;
      }
    }
  }

  const itemsAfterPromo = Math.max(itemsSubtotal - promoDiscountAmount, 0);
  const grandTotal = itemsAfterPromo + shippingEstimate + expediteFee;

  itemsSubtotalEl.textContent = formatCurrency(itemsSubtotal);
  shippingEl.textContent = formatCurrency(shippingEstimate);
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

// ---------- CONTACT + PAYMENT ----------

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
  if (forbidden.includes(digits.slice(-10))) return false;
  return true;
}

function formatPhonePretty(value) {
  const digits = value.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return value;
  const area = digits.slice(0, 3);
  const mid = digits.slice(3, 6);
  const last = digits.slice(6);
  return `(${area})-${mid}-${last}`;
}

function getSelectedPayment() {
  return {
    value: "square_invoice",
    text: "Square invoice sent by phone/email",
  };
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

// ---------- PROMO UI ----------

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
    statusNorm: promo.statusNorm,
  };

  const scopeText =
    promo.scope === "custom" ? "custom prints" : "cart total";
  const discountText =
    promo.discountType === "percent"
      ? `${promo.discountAmount}% off ${scopeText}`
      : `$${promo.discountAmount.toFixed(2)} off ${scopeText}`;

  showPromoMessage(`Promo "${raw}" applied: ${discountText}.`, false);
  updateTotals();
}

// ---------- BACKEND CALLS ----------
async function sendOrderWebhook(content) {
  if (!ORDER_WEBHOOK_URL) return;
  const payload = { content };

  try {
    const res = await fetch(ORDER_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Order webhook failed", await res.text());
    }
  } catch (err) {
    console.error("Order webhook error", err);
  }
}

async function sendSuggestionWebhook(content) {
  if (!SUGGESTIONS_WEBHOOK_URL) {
    throw new Error("Suggestions webhook is not configured.");
  }

  const payload = { content };

  const res = await fetch(SUGGESTIONS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error("Suggestion webhook failed.");
  }
}

function setSuggestionMessage(msg, isError) {
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
    setSuggestionMessage("Please enter a suggestion title.", true);
    return;
  }

  if (!details) {
    setSuggestionMessage("Please add some details for the suggestion.", true);
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

  try {
    if (btn) btn.disabled = true;
    setSuggestionMessage("Sending suggestion…", false);
    await sendSuggestionWebhook(lines.join("\n"));
    setSuggestionMessage("Suggestion sent. Thank you!", false);

    if (nameInput) nameInput.value = "";
    if (contactInput) contactInput.value = "";
    if (titleInput) titleInput.value = "";
    if (detailsInput) detailsInput.value = "";
    if (linkInput) linkInput.value = "";
  } catch (err) {
    console.error("Suggestion error", err);
    setSuggestionMessage("Sorry, there was an error sending the suggestion.", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// send stock + promo usage ONLY (no order storage)
async function sendStockAndPromoUpdate(stockItems, promoCodeUsed) {
  if (!STOCK_WEBAPP_URL) return;

  const payload = {};
  if (Array.isArray(stockItems) && stockItems.length) {
    payload.items = stockItems;
  }
  if (promoCodeUsed) {
    payload.promoCodeUsed = promoCodeUsed;
  }

  if (!Object.keys(payload).length) return;

  try {
    await fetch(STOCK_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(payload),
    });
    console.log("[WEBAPP] Stock/promo update sent", payload);
  } catch (err) {
    console.error("[WEBAPP ERROR] Failed to send update", err);
  }
}

// ---------- ORDER SUBMISSION ----------
async function handleSubmitOrder() {
  if (!cart.length) {
    showSubmitMessage("Your cart is empty.", true);
    return;
  }

  const nameInput = document.getElementById("customer-name");
  const contactInput = document.getElementById("customer-contact");
  const shippingInfoInput = document.getElementById("shipping-info");
  const notesInput = document.getElementById("extra-notes");
  const expediteChoiceEl = document.getElementById("expedite-choice");
  const shippingChoiceEl = document.getElementById("shipping-choice");

  const expediteChoice = expediteChoiceEl ? expediteChoiceEl.value : "none";
  const shippingChoice = shippingChoiceEl
    ? shippingChoiceEl.value
    : "shipping";

  let contact = contactInput.value.trim();
  if (!contact) {
    showSubmitMessage("Contact info is required (phone or email).", true);
    return;
  }

  const isEmail = isValidEmail(contact);
  const isPhone = isValidPhone(contact);

  if (!isEmail && !isPhone) {
    showSubmitMessage(
      "Contact must be a real-looking email or phone number.",
      true
    );
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

  const payment = getSelectedPayment();

  const shipText = shippingInfoInput.value.trim();
  if (!shipText) {
    showSubmitMessage(
      "Shipping address or pickup info is required for every order.",
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

  const shippingEstimate = getShippingEstimate(
    itemsSubtotal,
    shippingChoice
  );
  const expediteFee = getExpediteFee(itemsSubtotal, expediteChoice);

  promoDiscountAmount = 0;
  if (appliedPromo) {
    let base = appliedPromo.scope === "custom" ? customSubtotal : itemsSubtotal;
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
  const grandTotal = itemsAfterPromo + shippingEstimate + expediteFee;

  const stockItems = cart
    .filter((item) => item.mode === "Premade" && item.maxStock != null)
    .map((item) => ({
      name: item.name,
      qty: item.quantity,
    }));

  let promoCodeUsed = null;
  if (appliedPromo && appliedPromo.statusNorm === "limited") {
    promoCodeUsed = appliedPromo.code;
  }

  const lines = [];
  lines.push(`**New order #${orderId}**`);
  lines.push("");
  lines.push("**Items:**");
  cart.forEach((item) => {
    const subtotal = item.unitPrice * item.quantity;
    const detail = detailLabelForItem(item);
    const displayName = detail ? `${item.name} (${detail})` : item.name;
    lines.push(
      `• ${displayName} x${item.quantity} — ${formatCurrency(subtotal)}`
    );
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
  lines.push(`Shipping estimate: ${formatCurrency(shippingEstimate)}`);
  lines.push(`Expedite fee: ${formatCurrency(expediteFee)}`);
  lines.push(`**Total estimate: ${formatCurrency(grandTotal)}**`);
  lines.push("");

  const notesText = notesInput.value.trim();

  lines.push(`**Contact:** ${contact}`);
  if (nameText) lines.push(`**Name:** ${nameText}`);

  if (shippingChoice === "local") {
    lines.push(
      "**Delivery:** Local pickup" + (shipText ? ` — ${shipText}` : "")
    );
  } else {
    lines.push("**Delivery:** Shipping — " + (shipText || "address provided"));
  }

  if (notesText) lines.push(`**Notes:** ${notesText}`);

  lines.push(
    `**Payment:** Square invoice needed — send invoice to ${contact}`
  );

  const summary = lines.join("\n");

  showSubmitMessage("Submitting order…", false);
  document.getElementById("submit-order-btn").disabled = true;

  try {
    await Promise.all([
      sendOrderWebhook(summary),
      sendStockAndPromoUpdate(stockItems, promoCodeUsed),
    ]);

    const msg = `Order submitted! Your order number is ${orderId}.`;
    showSubmitMessage(msg, false);
    alert(msg);

    cart = [];
    renderCart();

    nameInput.value = "";
    shippingInfoInput.value = "";
    notesInput.value = "";
    contactInput.value = "";
  } catch (err) {
    console.error("Submit error", err);
    showSubmitMessage("Sorry, there was an error submitting your order.", true);
  } finally {
    document.getElementById("submit-order-btn").disabled = false;
  }
}

// ---------- INIT ----------
async function refreshShopData() {
  await loadConfig();
  await loadColors();
  await Promise.all([loadInventory(), loadPromos()]);
}

async function init() {
  await refreshShopData();

  const expediteChoiceEl = document.getElementById("expedite-choice");
  if (expediteChoiceEl) {
    expediteChoiceEl.addEventListener("change", updateTotals);
  }

  const shippingChoiceEl = document.getElementById("shipping-choice");
  if (shippingChoiceEl) {
    shippingChoiceEl.addEventListener("change", updateTotals);
  }

  const addCustomBtn = document.getElementById("add-custom-btn");
  if (addCustomBtn) {
    addCustomBtn.addEventListener("click", () => {
      const fileInput = document.getElementById("custom-file");
      const sizeSelect = document.getElementById("custom-size");
      const detailSelect = document.getElementById("custom-detail");
      const colorSelect = document.getElementById("custom-color");
      const qtyInput = document.getElementById("custom-qty");

      const file = fileInput.files[0];
      if (!file) {
        showSubmitMessage("Please upload a file for custom prints.", true);
        return;
      }

      const color = colorSelect.value;
      if (!color) {
        showSubmitMessage("Please choose a color for the custom print.", true);
        return;
      }

      let qty = Math.max(1, Number(qtyInput.value) || 1);

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
        },
        qty
      );

      const estText = document.getElementById("custom-estimate-text");
      if (estText) {
        estText.textContent = "Custom print estimate added to cart.";
      }
    });
  }

  const submitBtn = document.getElementById("submit-order-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleSubmitOrder();
    });
  }

  const trackingBtn = document.getElementById("open-tracking-btn");
  if (trackingBtn) {
    trackingBtn.addEventListener("click", () => {
      window.location.href = "../tracking/";
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

  const previewModal = document.getElementById("preview-modal");
  if (previewModal) {
    previewModal.addEventListener("click", (e) => {
      if (e.target === previewModal) closePreviewModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePreviewModal();
  });

  renderCart();

  setInterval(() => {
    refreshShopData();
  }, 30000);
}

window.addEventListener("DOMContentLoaded", init);
