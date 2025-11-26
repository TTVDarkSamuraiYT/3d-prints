// ---------- GLOBALS ----------
let SHEET_ID = "";
let INVENTORY_SHEET_NAME = "";
let COLORS_SHEET_NAME = "";
let ORDERS_SHEET_NAME = "";
let PROMOS_SHEET_NAME = "";
let ORDER_WEBHOOK_URL = "";
let HISTORY_WEBHOOK_URL = "";
let STOCK_WEBAPP_URL = "";
let CASHAPP_TAG = "";

let colorsData = [];
let inventoryData = [];
let promosData = [];
let cart = [];
let appliedPromo = null; // { rawCode, code, discountType, discountValue, scope, statusNorm, limit }

// Order counter per day (for order ID like 20251126-001)
function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function nextOrderNumber() {
  const todayKey = getTodayKey();
  const stored = JSON.parse(
    localStorage.getItem("order_counter_state") || "{}"
  );
  let counter = 0;
  if (stored.date === todayKey) {
    counter = stored.counter || 0;
  }
  counter += 1;
  localStorage.setItem(
    "order_counter_state",
    JSON.stringify({ date: todayKey, counter })
  );
  return `${todayKey}-${String(counter).padStart(3, "0")}`;
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

// Parse "discount $/%" from Promos sheet
// Returns { type: 'percent' | 'flat', value: number } or null
function parseDiscountCell(raw) {
  if (raw == null || raw === "") return null;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (raw > 1.0000001) {
      return { type: "flat", value: raw }; // dollars
    } else {
      return { type: "percent", value: raw }; // 0.15 => 15%
    }
  }

  const s = String(raw).trim();
  if (!s) return null;

  if (s.endsWith("%")) {
    const n = parseFloat(s.slice(0, -1));
    if (!Number.isFinite(n) || n <= 0) return null;
    return { type: "percent", value: n / 100 };
  }

  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { type: "flat", value: n };
}

// ---------- CONFIG / SHEET LOADING ----------

// config.json is in repo root, prints/ is one level down
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
    PROMOS_SHEET_NAME = cfg.PROMOS_SHEET_NAME || "Promos";
    ORDER_WEBHOOK_URL = cfg.ORDER_WEBHOOK_URL;
    HISTORY_WEBHOOK_URL = cfg.HISTORY_WEBHOOK_URL;
    STOCK_WEBAPP_URL = cfg.STOCK_WEBAPP_URL || "";
    CASHAPP_TAG = cfg.CASHAPP_TAG || "$CashApp";

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

    const mapped = rows
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

    colorsData = mapped;
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
        const stock = safeNumber(stockRaw); // # of premades available
        const statusNorm = normalizeStatus(statusRaw);

        if (statusNorm === "offshelf") return null;

        const isLimitedStatus = statusNorm === "limited";

        let availability = "available";
        if (statusNorm === "temporarily unavailable") {
          availability = "temp";
        } else if (statusNorm === "sold out" || statusNorm === "unavailable") {
          availability = "unavailable";
        } else if (isLimitedStatus) {
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
          isLimitedStatus,
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
        const rawCode = c[0]?.v ? String(c[0].v).trim() : "";
        if (!rawCode) return null;
        const discRaw = c[1]?.v;
        const status = c[2]?.v ? String(c[2].v).trim() : "";
        const limitRaw = c[3]?.v;
        const scopeRaw = c[4]?.v ? String(c[4].v).trim() : "";

        const parsedDiscount = parseDiscountCell(discRaw);
        if (!parsedDiscount) return null;

        const statusNorm = normalizeStatus(status);
        const scopeNorm = scopeRaw ? scopeRaw.toLowerCase() : "cart"; // "cart" or "custom"
        const limit = safeNumber(limitRaw);

        return {
          rawCode,
          code: rawCode.toUpperCase(),
          discountType: parsedDiscount.type, // 'percent' | 'flat'
          discountValue: parsedDiscount.value,
          statusNorm,
          scope: scopeNorm === "custom" ? "custom" : "cart",
          limit,
        };
      })
      .filter(Boolean);

    console.log("Promos from sheet:", promosData);
  } catch (err) {
    console.error("Error loading promos sheet", err);
    promosData = [];
  }
}

// ---------- BUILD UI ----------

function getBaseColorsForPremade() {
  return colorsData.filter((c) => {
    const nameNorm = c.name.trim().toLowerCase();

    // Skip header row "colors" and the special "premade" row
    if (nameNorm === "colors" || nameNorm === "premade") return false;

    const s = c.normStatus;
    if (s === "offshelf") return false; // hidden from shop

    return true;
  });
}

function getBaseColorsForCustom() {
  return colorsData.filter((c) => {
    const nameNorm = c.name.trim().toLowerCase();

    if (nameNorm === "colors" || nameNorm === "premade") return false;

    const s = c.normStatus;
    if (s === "offshelf" || s === "sold out" || s === "unavailable") return false;

    return true;
  });
}

function renderPremadeCards() {
  const listEl = document.getElementById("premade-list");
  listEl.innerHTML = "";

  const baseColors = getBaseColorsForPremade();

  if (!inventoryData.length) {
    listEl.innerHTML =
      '<div class="helper-text">No premade items are configured yet.</div>';
    return;
  }

  inventoryData.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "premade-card";

    const left = document.createElement("div");
    left.className = "premade-main";

    const title = document.createElement("h3");
    title.textContent = item.name;
    left.appendChild(title);

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

    // Teal stock label (only shown when premade is selected, or always for limited-only items)
    const stockLabel = document.createElement("div");
    stockLabel.className = "premade-stock-label";
    stockLabel.id = `premade-stock-${index}`;
    if (item.stock != null && item.stock > 0) {
      stockLabel.textContent = `Stock: ${item.stock}`;
    } else {
      stockLabel.textContent = "Stock: 0";
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

    const hasPremadeStock = item.stock != null && item.stock > 0;
    let colorSelect;

    if (item.isLimitedStatus) {
      // Limited status: premade-only item
      colorSelect = document.createElement("select");
      colorSelect.disabled = true;
      const opt = document.createElement("option");
      opt.value = "__premade";
      opt.textContent = "Premade only";
      colorSelect.appendChild(opt);

      // Always show stock label for premade-only items
      stockLabel.style.display = "inline-block";
    } else {
      colorSelect = document.createElement("select");
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

      if (hasPremadeStock && item.availability !== "unavailable") {
        const premOpt = document.createElement("option");
        premOpt.value = "__premade";
        premOpt.textContent = "Premade (15% off, random color)";
        colorSelect.appendChild(premOpt);
      }

      // Show / hide stock label based on select
      colorSelect.addEventListener("change", () => {
        if (colorSelect.value === "__premade") {
          if (hasPremadeStock) {
            stockLabel.style.display = "inline-block";
          } else {
            stockLabel.style.display = "none";
          }
        } else {
          stockLabel.style.display = "none";
        }
      });
    }

    colorSelect.id = `premade-color-${index}`;
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

    if (item.availability === "unavailable") {
      btn.disabled = true;
      btn.textContent = "Unavailable";
    }

    btn.addEventListener("click", () => {
      let qtyVal = Math.max(1, Number(qtyInput.value) || 1);

      let mode;
      let color;
      let maxStock = null;

      if (item.isLimitedStatus) {
        // Premade-only item
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

        if (qtyVal > item.stock) {
          qtyVal = item.stock;
          showSubmitMessage(
            `You can only order up to ${item.stock} premades for "${item.name}".`,
            true
          );
        }
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

          if (qtyVal > item.stock) {
            qtyVal = item.stock;
            showSubmitMessage(
              `You can only order up to ${item.stock} premades for "${item.name}".`,
              true
            );
          }

          // show stock label if hidden
          stockLabel.style.display = "inline-block";
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
          maxStock = null; // made-to-order, no premade limit
          stockLabel.style.display = "none";
        }
      }

      addToCart(
        {
          name: item.name,
          mode,
          color,
          price:
            mode === "Premade" ? item.price * 0.85 /* 15% off */ : item.price,
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

  // custom colors
  const customColorSelect = document.getElementById("custom-color");
  customColorSelect.innerHTML = '<option value="">Select color</option>';
  getBaseColorsForCustom().forEach((c) => {
    const o = document.createElement("option");
    o.value = c.name;
    o.textContent = c.name;
    customColorSelect.appendChild(o);
  });
}

// ---------- CART & PRICING ----------

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
    if (qty > remaining) {
      qty = remaining;
      showSubmitMessage(
        `Only ${remaining} premades left for "${itemBase.name}".`,
        true
      );
    }
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
      mode: itemBase.mode, // Premade, Color, Custom
      color: itemBase.color,
      unitPrice: itemBase.price,
      quantity: qty,
      maxStock: itemBase.maxStock,
    });
  }

  renderCart();
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
        renderCart();
      }
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
  if (shippingChoice === "pickup") return 0;
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

// Core pricing calculation used by both updateTotals() and handleSubmitOrder()
function calculatePricing(shippingChoice, expediteChoice) {
  let itemsSubtotal = 0;
  let customSubtotal = 0;

  cart.forEach((item) => {
    const sub = item.unitPrice * item.quantity;
    itemsSubtotal += sub;
    if (item.mode === "Custom") {
      customSubtotal += sub;
    }
  });

  let promoDiscountAmount = 0;

  if (appliedPromo) {
    let base =
      appliedPromo.scope === "custom" ? customSubtotal : itemsSubtotal;
    if (base > 0) {
      if (appliedPromo.discountType === "percent") {
        promoDiscountAmount = base * appliedPromo.discountValue;
      } else {
        promoDiscountAmount = appliedPromo.discountValue;
      }
      if (promoDiscountAmount > base) promoDiscountAmount = base;
    }
  }

  const effectiveItemsSubtotal = Math.max(
    0,
    itemsSubtotal - promoDiscountAmount
  );

  const shippingEstimate = getShippingEstimate(
    effectiveItemsSubtotal,
    shippingChoice
  );
  const expediteFee = getExpediteFee(
    effectiveItemsSubtotal,
    expediteChoice
  );
  const grandTotal =
    effectiveItemsSubtotal + shippingEstimate + expediteFee;

  return {
    itemsSubtotal,
    customSubtotal,
    promoDiscountAmount,
    effectiveItemsSubtotal,
    shippingEstimate,
    expediteFee,
    grandTotal,
  };
}

// Ensure promo discount row exists in summary
function ensurePromoRow() {
  const summary = document.getElementById("cart-summary");
  if (!summary) return null;

  let row = document.getElementById("promo-discount-row");
  if (row) return row;

  row = document.createElement("div");
  row.className = "summary-row";
  row.id = "promo-discount-row";

  const label = document.createElement("span");
  label.textContent = "Promo discount";

  const val = document.createElement("span");
  val.id = "promo-discount";
  val.textContent = "-$0.00";

  row.appendChild(label);
  row.appendChild(val);

  const totalRow = summary.querySelector(".summary-row.total");
  if (totalRow && totalRow.parentNode === summary) {
    summary.insertBefore(row, totalRow);
  } else {
    summary.appendChild(row);
  }

  return row;
}

function updateTotals() {
  const itemsSubtotalEl = document.getElementById("items-subtotal");
  const shippingEl = document.getElementById("shipping-estimate");
  const expediteEl = document.getElementById("expedite-fee");
  const grandEl = document.getElementById("grand-total");

  const shippingChoice = document.getElementById("shipping-choice").value;
  const expediteChoice = document.getElementById("expedite-choice").value;

  const pricing = calculatePricing(shippingChoice, expediteChoice);

  itemsSubtotalEl.textContent = formatCurrency(pricing.itemsSubtotal);
  shippingEl.textContent = formatCurrency(pricing.shippingEstimate);
  expediteEl.textContent = formatCurrency(pricing.expediteFee);
  grandEl.textContent = formatCurrency(pricing.grandTotal);

  const promoRow = ensurePromoRow();
  if (promoRow) {
    if (pricing.promoDiscountAmount > 0.001) {
      promoRow.style.display = "flex";
      const valEl = document.getElementById("promo-discount");
      const text = formatCurrency(pricing.promoDiscountAmount).replace(
        "$",
        ""
      );
      valEl.textContent = `- $${text}`;
    } else {
      promoRow.style.display = "none";
    }
  }
}

// ---------- CONTACT + PAYMENT VALIDATION ----------

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
  const selected = document.querySelector(
    'input[name="payment-method"]:checked'
  );
  if (!selected) return null;

  let text;
  if (selected.value === "card") {
    text = "Card via Square (manual)";
  } else if (selected.value === "cash") {
    text = "Cash (local pickup)";
  } else if (selected.value === "cashapp") {
    const ref = document.getElementById("cashapp-reference").value.trim();
    text = "Cash App to " + CASHAPP_TAG + (ref ? ` (ref: ${ref})` : "");
  } else {
    text = selected.value;
  }

  return { value: selected.value, text };
}

function showSubmitMessage(msg, isError) {
  const el = document.getElementById("submit-message");
  if (!msg) {
    el.textContent = "";
    el.className = "helper-text";
    return;
  }
  el.textContent = msg;
  el.className = isError ? "error-text" : "success-text";
}

// ---------- ORDER SUBMISSION / BACKEND ----------

async function sendOrderWebhook(content) {
  const payload = { content };

  async function send(url) {
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error("Webhook failed", url, await res.text());
      }
    } catch (err) {
      console.error("Webhook error", url, err);
    }
  }

  await Promise.all([send(ORDER_WEBHOOK_URL), send(HISTORY_WEBHOOK_URL)]);
}

async function sendStockUpdateToAppsScript(stockItems) {
  if (!STOCK_WEBAPP_URL || !Array.isArray(stockItems) || !stockItems.length) {
    return;
  }
  try {
    await fetch(STOCK_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify({ items: stockItems }),
    });
    console.log("[STOCK WEBAPP] Stock update sent", stockItems);
  } catch (err) {
    console.error("[STOCK WEBAPP ERROR] Failed to send stock update", err);
  }
}

async function sendOrderToSheets(orderRecord) {
  if (!STOCK_WEBAPP_URL) return;
  try {
    await fetch(STOCK_WEBAPP_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify({
        order: orderRecord,
        ordersSheetName: ORDERS_SHEET_NAME,
        promoCodeUsed: appliedPromo ? appliedPromo.rawCode : "",
      }),
    });
    console.log("[STOCK WEBAPP] Order logged to sheet");
  } catch (err) {
    console.error("[STOCK WEBAPP ERROR] Failed to log order", err);
  }
}

// ---------- PROMO UI ----------

function setupPromoUI() {
  const input = document.getElementById("promo-code");
  const applyBtn = document.getElementById("apply-promo-btn");
  const clearBtn = document.getElementById("clear-promo-btn");

  if (!input || !applyBtn) return;

  applyBtn.addEventListener("click", () => {
    const raw = input.value.trim();
    if (!raw) {
      showSubmitMessage("Enter a promo code first.", true);
      return;
    }
    const codeUpper = raw.toUpperCase();

    const promo = promosData.find(
      (p) => p.code === codeUpper && p.statusNorm !== "off use"
    );

    if (!promo) {
      appliedPromo = null;
      updateTotals();
      showSubmitMessage("That promo code is not active right now.", true);
      return;
    }

    if (
      promo.statusNorm === "limited" &&
      promo.limit != null &&
      promo.limit <= 0
    ) {
      appliedPromo = null;
      updateTotals();
      showSubmitMessage("That promo code has no uses left.", true);
      return;
    }

    // If code only works on custom prints, make sure there is at least one custom item
    if (promo.scope === "custom") {
      const hasCustom = cart.some((i) => i.mode === "Custom");
      if (!hasCustom) {
        appliedPromo = null;
        updateTotals();
        showSubmitMessage(
          "This promo only applies to custom prints. Add a custom print first.",
          true
        );
        return;
      }
    }

    appliedPromo = promo;
    updateTotals();
    showSubmitMessage(`Promo "${promo.rawCode}" applied.`, false);
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      appliedPromo = null;
      input.value = "";
      updateTotals();
      showSubmitMessage("Promo removed.", false);
    });
  }
}

// ---------- HANDLE SUBMIT ----------

async function handleSubmitOrder() {
  if (!cart.length) {
    showSubmitMessage("Your cart is empty.", true);
    return;
  }

  const nameInput = document.getElementById("customer-name");
  const contactInput = document.getElementById("customer-contact");
  const shippingInfoInput = document.getElementById("shipping-info");
  const notesInput = document.getElementById("extra-notes");

  const shippingChoice = document.getElementById("shipping-choice").value;
  const expediteChoice = document.getElementById("expedite-choice").value;

  let contact = contactInput.value.trim();
  if (!contact) {
    showSubmitMessage("Contact info is required (phone or email).", true);
    return;
  }

  let isEmail = isValidEmail(contact);
  let isPhone = isValidPhone(contact);

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

  const payment = getSelectedPayment();
  if (!payment) {
    showSubmitMessage("Please choose a payment method.", true);
    return;
  }

  if (payment.value === "card" && !nameText) {
    showSubmitMessage(
      "Name is required for card payments (for the Square invoice).",
      true
    );
    return;
  }

  if (shippingChoice === "standard") {
    const shippingText = shippingInfoInput.value.trim();
    if (!shippingText) {
      showSubmitMessage(
        "Please provide shipping info for shipping orders.",
        true
      );
      return;
    }
  }

  const cashappRefInput = document.getElementById("cashapp-reference");
  let cashappRef = cashappRefInput.value.trim();

  if (payment.value === "cashapp" && !cashappRef) {
    showSubmitMessage(
      "Please enter your Cash App name or a payment note.",
      true
    );
    return;
  }

  const orderId = nextOrderNumber();

  const pricing = calculatePricing(shippingChoice, expediteChoice);
  const stockItems = cart
    .filter((item) => item.mode === "Premade" && item.maxStock != null)
    .map((item) => ({
      name: item.name,
      qty: item.quantity,
    }));

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
  lines.push(`Items subtotal: ${formatCurrency(pricing.itemsSubtotal)}`);
  if (pricing.promoDiscountAmount > 0.001) {
    lines.push(
      `Promo discount: -${formatCurrency(pricing.promoDiscountAmount)}${
        appliedPromo ? ` (code: ${appliedPromo.rawCode})` : ""
      }`
    );
  }
  lines.push(
    `Subtotal after promo: ${formatCurrency(pricing.effectiveItemsSubtotal)}`
  );
  lines.push(`Shipping estimate: ${formatCurrency(pricing.shippingEstimate)}`);
  lines.push(`Expedite fee: ${formatCurrency(pricing.expediteFee)}`);
  lines.push(`**Total estimate: ${formatCurrency(pricing.grandTotal)}**`);
  lines.push("");

  const shipText = shippingInfoInput.value.trim();
  const notesText = notesInput.value.trim();

  lines.push(`**Contact:** ${contact}`);
  if (nameText) lines.push(`**Name:** ${nameText}`);
  if (shippingChoice === "pickup") {
    lines.push("**Shipping:** Local pickup");
  } else if (shipText) {
    lines.push(`**Shipping:** ${shipText}`);
  }

  if (expediteChoice === "priority") {
    lines.push("**Queue priority:** Priority");
  } else if (expediteChoice === "rush") {
    lines.push("**Queue priority:** Rush");
  } else {
    lines.push("**Queue priority:** None");
  }

  if (notesText) lines.push(`**Notes:** ${notesText}`);

  if (payment.value === "card") {
    lines.push(
      `**Payment:** Card via Square (manual) — Name: ${nameText}; Contact for Square link: ${contact}`
    );
  } else if (payment.value === "cash") {
    lines.push("**Payment:** Cash (local pickup)");
  } else if (payment.value === "cashapp") {
    lines.push(
      `**Payment:** Cash App to ${CASHAPP_TAG} — reference: ${cashappRef}`
    );
  } else {
    lines.push(`**Payment:** ${payment.text}`);
  }

  const summary = lines.join("\n");

  const priorityValue =
    expediteChoice === "priority"
      ? "priority"
      : expediteChoice === "rush"
      ? "rush"
      : "none";

  // Build order record for Orders sheet
  let notesForSheet = notesText || "";
  if (appliedPromo && pricing.promoDiscountAmount > 0.001) {
    if (notesForSheet) notesForSheet += " | ";
    notesForSheet += `Promo ${appliedPromo.rawCode} (-${formatCurrency(
      pricing.promoDiscountAmount
    )})`;
  }

  const orderRecord = {
    orderId,
    createdAt: new Date().toISOString(), // not in sheet but useful if ever needed
    name: nameText || "",
    priority: priorityValue,
    contact,
    shippingInfo:
      shippingChoice === "pickup" ? "Local pickup" : shipText || "",
    status: payment.value === "cash" ? "processing" : "paid",
    paymentMethod: payment.text,
    itemsJson: JSON.stringify(cart),
    itemsSubtotal: pricing.itemsSubtotal,
    shippingEstimate: pricing.shippingEstimate,
    expediteFee: pricing.expediteFee,
    totalEstimate: pricing.grandTotal,
    notes: notesForSheet,
  };

  showSubmitMessage("Submitting order…", false);
  document.getElementById("submit-order-btn").disabled = true;

  try {
    await Promise.all([
      sendOrderWebhook(summary),
      sendStockUpdateToAppsScript(stockItems),
      sendOrderToSheets(orderRecord),
    ]);

    showSubmitMessage(
      `Order submitted! Your order number is ${orderId}.`,
      false
    );

    cart = [];
    appliedPromo = null;
    renderCart();

    nameInput.value = "";
    shippingInfoInput.value = "";
    notesInput.value = "";
    if (cashappRefInput) cashappRefInput.value = "";
    const promoInput = document.getElementById("promo-code");
    if (promoInput) promoInput.value = "";
    const promoRow = document.getElementById("promo-discount-row");
    if (promoRow) promoRow.style.display = "none";

    document
      .querySelectorAll('input[name="payment-method"]')
      .forEach((r) => (r.checked = false));
    document.getElementById("cashapp-extra").classList.add("hidden");
  } catch (err) {
    console.error("Submit error", err);
    showSubmitMessage("Sorry, there was an error submitting your order.", true);
  } finally {
    document.getElementById("submit-order-btn").disabled = false;
  }
}

// ---------- INIT ----------

async function init() {
  await loadConfig();
  await Promise.all([loadColors(), loadInventory(), loadPromos()]);

  const paymentRadios = document.querySelectorAll(
    'input[name="payment-method"]'
  );
  const cashappExtra = document.getElementById("cashapp-extra");
  const cashappRefInput = document.getElementById("cashapp-reference");

  paymentRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;

      if (radio.value === "cashapp") {
        cashappExtra.classList.remove("hidden");
      } else {
        cashappExtra.classList.add("hidden");
        cashappRefInput.value = "";
      }
    });
  });

  document
    .getElementById("shipping-choice")
    .addEventListener("change", updateTotals);
  document
    .getElementById("expedite-choice")
    .addEventListener("change", updateTotals);

  // Custom print add button
  document.getElementById("add-custom-btn").addEventListener("click", () => {
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
      showSubmitMessage(
        "Please choose a color for the custom print.",
        true
      );
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

    const estPrice = basePrice;

    addToCart(
      {
        name: file.name,
        mode: "Custom",
        color,
        price: estPrice,
        maxStock: null,
      },
      qty
    );

    document.getElementById("custom-estimate-text").textContent =
      "Custom print estimate added to cart.";
  });

  document
    .getElementById("submit-order-btn")
    .addEventListener("click", (e) => {
      e.preventDefault();
      handleSubmitOrder();
    });

  document.getElementById("open-tracking-btn").addEventListener("click", () => {
    window.location.href = "/tracking/";
  });

  setupPromoUI();

  // Periodic refresh of config & inventory & promos
  setInterval(() => {
    loadConfig();
    loadColors();
    loadInventory();
    loadPromos();
  }, 30000);
}

window.addEventListener("DOMContentLoaded", init);
