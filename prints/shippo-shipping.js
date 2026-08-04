let SHIPPO_RATES_WEBAPP_URL = "";
let selectedShippoRate = null;
let lastShippoRates = [];
let lastShippoOrder = null;
let shippoSuggestTimer = null;
let shippoSuggestionResults = [];
let shippoConfigPromise = null;
let shippoOrderDraftAttempted = false;

function shippoMoney(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function shippoText(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function getTekniqCart() {
  try {
    if (typeof cart !== "undefined" && Array.isArray(cart)) {
      return cart;
    }
  } catch {
    // ignore
  }

  return [];
}

function isLocalRate(rate) {
  return Boolean(rate && rate.isLocal);
}

function setShippoMessage(message, isError) {
  const el = document.getElementById("shippo-rate-message");
  if (!el) return;

  el.textContent = message || "";
  el.className = isError ? "error-text" : "helper-text";
}

function buildShippoAddress() {
  return {
    name: shippoText("customer-name") || "Customer",
    street1: shippoText("shippo-street1"),
    street2: shippoText("shippo-street2"),
    city: shippoText("shippo-city"),
    state: shippoText("shippo-state").toUpperCase(),
    zip: shippoText("shippo-zip"),
    country: shippoText("shippo-country") || "US",
    phone: shippoText("customer-contact"),
    email: shippoText("customer-contact")
  };
}

function formatShippoAddress(address) {
  const line1 = address.street2
    ? `${address.street1}, ${address.street2}`
    : address.street1;

  return [
    line1,
    `${address.city}, ${address.state} ${address.zip}`,
    address.country
  ]
    .filter(Boolean)
    .join("\n");
}

function validateShippoAddressFields(address) {
  if (!address.street1) return "Street address is required.";
  if (!address.city) return "City is required.";
  if (!address.state) return "State is required.";
  if (!address.zip) return "ZIP code is required.";
  if (!address.country) return "Country is required.";
  return "";
}

function loadShippoConfig() {
  shippoConfigPromise = fetch("../config.json?cacheBust=" + Date.now(), {
    cache: "no-cache"
  })
    .then((res) => res.json())
    .then((cfg) => {
      SHIPPO_RATES_WEBAPP_URL = cfg.SHIPPO_RATES_WEBAPP_URL || "";
      return SHIPPO_RATES_WEBAPP_URL;
    })
    .catch((err) => {
      console.warn("[SHIPPO] Could not load config:", err);
      return "";
    });

  return shippoConfigPromise;
}

async function ensureShippoConfigLoaded() {
  if (!SHIPPO_RATES_WEBAPP_URL) {
    if (!shippoConfigPromise) loadShippoConfig();
    await shippoConfigPromise;
  }

  return SHIPPO_RATES_WEBAPP_URL;
}

function shippoJsonp(url, payload) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "shippoRatesCallback_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2);

    const script = document.createElement("script");
    const joiner = url.includes("?") ? "&" : "?";

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Shippo request timed out."));
    }, 30000);

    window[callbackName] = function (data) {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timeout);

      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    script.onerror = function () {
      cleanup();
      reject(new Error("Shippo request failed."));
    };

    script.src =
      url +
      joiner +
      "callback=" +
      encodeURIComponent(callbackName) +
      "&payload=" +
      encodeURIComponent(JSON.stringify(payload)) +
      "&cacheBust=" +
      Date.now();

    document.body.appendChild(script);
  });
}

function getCartShippingItemsForShippo() {
  const currentCart = getTekniqCart();

  return currentCart.map((item) => {
    const quantity = Number(item.quantity || 1);
    const filamentKgEach = Number(item.filamentKgNeeded || 0);

    return {
      title: item.name || "3D print",
      quantity: quantity,
      total_price: Number((item.unitPrice || 0) * quantity).toFixed(2),
      currency: "USD",
      mode: item.mode || "print",
      color: item.color || "",
      filamentKgEach: filamentKgEach,
      estimatedWeightLbEach:
        filamentKgEach > 0
          ? Math.max(0.15, filamentKgEach * 2.20462 + 0.05)
          : item.mode === "Custom"
          ? 0.3
          : 0.2,
      sku: item.mode || "print",
      variant_title: item.color || ""
    };
  });
}

function getCartTotalsForShippo() {
  let subtotal = 0;

  getTekniqCart().forEach((item) => {
    subtotal += Number(item.unitPrice || 0) * Number(item.quantity || 1);
  });

  const shipping = selectedShippoRate
    ? Number(selectedShippoRate.customerCharge || 0)
    : 0;

  return {
    subtotal,
    shipping,
    total: subtotal + shipping
  };
}

async function getShippoRates() {
  const address = buildShippoAddress();
  const error = validateShippoAddressFields(address);

  if (error) {
    setShippoMessage(error, true);
    return;
  }

  await ensureShippoConfigLoaded();

  if (!SHIPPO_RATES_WEBAPP_URL || SHIPPO_RATES_WEBAPP_URL.includes("PASTE_")) {
    setShippoMessage(
      "Shipping is not configured yet. Add your Apps Script /exec URL to config.json.",
      true
    );
    return;
  }

  selectedShippoRate = null;
  lastShippoRates = [];
  lastShippoOrder = null;
  shippoOrderDraftAttempted = false;
  renderShippoRates([]);

  setShippoMessage("Getting shipping options…", false);

  const payload = {
    action: "rates",
    addressTo: address,
    cartItems: getCartShippingItemsForShippo()
  };

  try {
    const data = await shippoJsonp(SHIPPO_RATES_WEBAPP_URL, payload);

    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Shipping returned an error.");
    }

    lastShippoRates = Array.isArray(data.rates) ? data.rates : [];

    if (!lastShippoRates.length) {
      setShippoMessage("No shipping options were returned for this address.", true);
      return;
    }

    const hasLocal = lastShippoRates.some((rate) => rate.isLocal);

    if (data.parcel) {
      setShippoMessage(
        hasLocal
          ? `Local option available. Package estimate for carrier shipping: ${data.parcel.length}×${data.parcel.width}×${data.parcel.height} in, ${data.parcel.weight} lb.`
          : `Choose one shipping option. Package estimate: ${data.parcel.length}×${data.parcel.width}×${data.parcel.height} in, ${data.parcel.weight} lb.`,
        false
      );
    } else {
      setShippoMessage(
        hasLocal
          ? "Local option available. Choose one option."
          : "Choose one shipping option.",
        false
      );
    }

    renderShippoRates(lastShippoRates);
  } catch (err) {
    setShippoMessage(String(err.message || err), true);
  }
}

function renderShippoRates(rates) {
  const list = document.getElementById("shippo-rates-list");
  if (!list) return;

  list.innerHTML = "";

  rates.forEach((rate, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "shippo-rate-card";

    if (isLocalRate(rate)) {
      card.classList.add("shippo-local-rate");
    }

    const top = document.createElement("div");
    top.className = "shippo-rate-top";

    const service = document.createElement("span");
    service.textContent = rate.service || "Shipping option";

    const price = document.createElement("span");
    price.className = "shippo-rate-price";
    price.textContent = shippoMoney(rate.customerCharge);

    top.appendChild(service);
    top.appendChild(price);

    const sub = document.createElement("div");
    sub.className = "shippo-rate-sub";

    const details = [];

    if (isLocalRate(rate)) {
      details.push("Within local Worcester range");
      if (rate.localDistanceMiles != null) {
        details.push(`${Number(rate.localDistanceMiles).toFixed(1)} miles away`);
      }
      details.push("local delivery timing varies");
    } else {
      if (rate.carrier) details.push(rate.carrier);
      if (rate.estimatedDays) {
        details.push(`estimated ${rate.estimatedDays} business day(s)`);
      }
      if (rate.parcelSummary) {
        details.push(rate.parcelSummary);
      }
    }

    sub.textContent = details.join(" • ");

    card.appendChild(top);
    card.appendChild(sub);

    card.addEventListener("click", () => {
      selectedShippoRate = rate;
      lastShippoOrder = null;
      shippoOrderDraftAttempted = false;

      document.querySelectorAll(".shippo-rate-card").forEach((el) => {
        el.classList.remove("selected");
      });

      card.classList.add("selected");

      const shippingInfo = document.getElementById("shipping-info");
      if (shippingInfo) {
        shippingInfo.value = formatShippoAddress(buildShippoAddress());
      }

      if (typeof updateTotals === "function") {
        updateTotals();
      }

      setShippoMessage(
        `Selected ${rate.service} for ${shippoMoney(rate.customerCharge)}.`,
        false
      );
    });

    list.appendChild(card);

    if (index === 0) {
      card.click();
    }
  });
}

function renderAddressSuggestions(suggestions) {
  const list = document.getElementById("shippo-suggestion-list");
  if (!list) return;

  list.innerHTML = "";
  shippoSuggestionResults = suggestions || [];

  if (!shippoSuggestionResults.length) {
    list.classList.remove("visible");
    return;
  }

  shippoSuggestionResults.forEach((suggestion, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shippo-suggestion";

    const pin = document.createElement("span");
    pin.className = "shippo-pin";
    pin.textContent = "📍";

    const textWrap = document.createElement("span");

    const main = document.createElement("span");
    main.className = "shippo-suggestion-main";
    main.textContent =
      suggestion.street1 || suggestion.display || "Suggested address";

    const sub = document.createElement("span");
    sub.className = "shippo-suggestion-sub";
    sub.textContent = [
      suggestion.city,
      suggestion.state,
      suggestion.zip,
      suggestion.country
    ]
      .filter(Boolean)
      .join(" ");

    textWrap.appendChild(main);
    textWrap.appendChild(sub);

    btn.appendChild(pin);
    btn.appendChild(textWrap);

    btn.addEventListener("click", () => {
      applyShippoSuggestion(index);
    });

    list.appendChild(btn);
  });

  list.classList.add("visible");
}

function applyShippoSuggestion(index) {
  const suggestion = shippoSuggestionResults[index];
  if (!suggestion) return;

  const street1 = document.getElementById("shippo-street1");
  const city = document.getElementById("shippo-city");
  const state = document.getElementById("shippo-state");
  const zip = document.getElementById("shippo-zip");
  const country = document.getElementById("shippo-country");

  if (street1) street1.value = suggestion.street1 || street1.value;
  if (city) city.value = suggestion.city || city.value;
  if (state) state.value = suggestion.state || state.value;
  if (zip) zip.value = suggestion.zip || zip.value;
  if (country) country.value = suggestion.country || "US";

  renderAddressSuggestions([]);
  resetSelectedRateBecauseAddressChanged(false);
}

async function suggestShippoAddress() {
  const street = shippoText("shippo-street1");

  if (!street || street.length < 4) {
    renderAddressSuggestions([]);
    return;
  }

  await ensureShippoConfigLoaded();

  if (!SHIPPO_RATES_WEBAPP_URL || SHIPPO_RATES_WEBAPP_URL.includes("PASTE_")) {
    renderAddressSuggestions([]);
    return;
  }

  const payload = {
    action: "suggest",
    query: street,
    city: shippoText("shippo-city"),
    state: shippoText("shippo-state"),
    zip: shippoText("shippo-zip"),
    country: shippoText("shippo-country") || "US"
  };

  try {
    const data = await shippoJsonp(SHIPPO_RATES_WEBAPP_URL, payload);

    if (!data || !data.ok) {
      renderAddressSuggestions([]);
      return;
    }

    renderAddressSuggestions(
      Array.isArray(data.suggestions) ? data.suggestions : []
    );
  } catch {
    renderAddressSuggestions([]);
  }
}

function queueShippoSuggest() {
  clearTimeout(shippoSuggestTimer);
  shippoSuggestTimer = setTimeout(suggestShippoAddress, 450);
}

function resetSelectedRateBecauseAddressChanged(showMessage) {
  selectedShippoRate = null;
  lastShippoOrder = null;
  shippoOrderDraftAttempted = false;
  renderShippoRates([]);

  if (showMessage) {
    setShippoMessage("Address/order changed. Get shipping options again.", false);
  }

  if (typeof updateTotals === "function") {
    updateTotals();
  }
}

function buildShippoDiscordNote() {
  if (!selectedShippoRate) return "";

  const address = buildShippoAddress();

  if (isLocalRate(selectedShippoRate)) {
    return [
      "",
      "**Delivery option:** Local Worcester",
      `**Address:** ${formatShippoAddress(address).replace(/\n/g, ", ")}`,
      `**Fee:** ${shippoMoney(selectedShippoRate.customerCharge)}`,
      selectedShippoRate.localDistanceMiles != null
        ? `**Distance:** ${Number(selectedShippoRate.localDistanceMiles).toFixed(1)} miles`
        : "",
      "**Timing:** Local delivery timing varies"
    ]
      .filter(Boolean)
      .join("\n");
  }

  const label =
    lastShippoOrder && lastShippoOrder.label ? lastShippoOrder.label : null;

  return [
    "",
    "**Shipping:** " +
      `${selectedShippoRate.carrier || "Carrier"} ${selectedShippoRate.service || ""}`.trim(),
    `**Customer shipping charge:** ${shippoMoney(selectedShippoRate.customerCharge)}`,
    selectedShippoRate.estimatedDays
      ? `**ETA:** ${selectedShippoRate.estimatedDays} business day(s)`
      : "",
    selectedShippoRate.parcelSummary
      ? `**Package:** ${selectedShippoRate.parcelSummary}`
      : "",
    `**Shippo shipment ID:** ${selectedShippoRate.shipmentId || "N/A"}`,
    `**Shippo rate ID:** ${selectedShippoRate.rateId || "N/A"}`,
    lastShippoOrder && lastShippoOrder.orderId
      ? `**Shippo order ID:** ${lastShippoOrder.orderId}`
      : "",
    label && label.labelUrl ? `**Label PDF:** ${label.labelUrl}` : "",
    label && label.trackingNumber ? `**Tracking:** ${label.trackingNumber}` : "",
    lastShippoOrder && lastShippoOrder.error
      ? "**Shippo order note:** Order draft not created. Use shipment/rate ID manually."
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function createShippoOrderDraft() {
  shippoOrderDraftAttempted = true;

  if (!selectedShippoRate) return null;

  if (isLocalRate(selectedShippoRate)) {
    lastShippoOrder = {
      orderId: "LOCAL",
      orderNumber: "local-" + Date.now(),
      local: true,
      label: null
    };

    return lastShippoOrder;
  }

  await ensureShippoConfigLoaded();

  if (!SHIPPO_RATES_WEBAPP_URL || SHIPPO_RATES_WEBAPP_URL.includes("PASTE_")) {
    lastShippoOrder = {
      orderId: "NOT_CREATED",
      orderNumber: "",
      error: "Shippo web app URL missing",
      label: null
    };

    return lastShippoOrder;
  }

  const address = buildShippoAddress();
  const totals = getCartTotalsForShippo();

  const payload = {
    action: "create_order",
    addressTo: address,
    selectedRate: selectedShippoRate,
    orderNumber: "pending-" + Date.now(),
    lineItems: getCartShippingItemsForShippo(),
    subtotal: totals.subtotal,
    shipping: totals.shipping,
    total: totals.total,
    notes: "Tekniq website order. Await Square payment."
  };

  try {
    const data = await shippoJsonp(SHIPPO_RATES_WEBAPP_URL, payload);

    if (data && data.ok) {
      lastShippoOrder = {
        orderId: data.orderId || "",
        orderNumber: data.orderNumber || "",
        label: data.label || null
      };

      return lastShippoOrder;
    }

    lastShippoOrder = {
      orderId: "NOT_CREATED",
      orderNumber: "",
      error: (data && data.error) || "Shippo order draft was not created",
      label: null
    };

    console.warn("[SHIPPO] Order draft failed:", data);
    return lastShippoOrder;
  } catch (err) {
    lastShippoOrder = {
      orderId: "NOT_CREATED",
      orderNumber: "",
      error: String(err && err.message ? err.message : err),
      label: null
    };

    console.warn("[SHIPPO] Could not create Shippo order draft:", err);
    return lastShippoOrder;
  }
}

function installShippoShippingOverride() {
  window.getShippingCharge = function () {
    if (selectedShippoRate) {
      return Number(selectedShippoRate.customerCharge || 0);
    }

    return 0;
  };
}

async function prepareShippoBeforeOrderSubmit(event) {
  const submitBtn = event.target.closest("#submit-order-btn");
  if (!submitBtn) return;

  const address = buildShippoAddress();
  const addressError = validateShippoAddressFields(address);

  if (addressError) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setShippoMessage(addressError, true);

    if (typeof showSubmitMessage === "function") {
      showSubmitMessage("Please complete your shipping address.", true);
    }

    return;
  }

  if (!selectedShippoRate) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setShippoMessage("Please get and select a shipping option first.", true);

    if (typeof showSubmitMessage === "function") {
      showSubmitMessage("Please select a shipping option before submitting.", true);
    }

    return;
  }

  if (!shippoOrderDraftAttempted) {
    event.preventDefault();
    event.stopImmediatePropagation();

    setShippoMessage(
      isLocalRate(selectedShippoRate)
        ? "Saving local option…"
        : "Preparing shipping details…",
      false
    );

    await createShippoOrderDraft();

    if (lastShippoOrder && lastShippoOrder.error) {
      setShippoMessage(
        "Shipping rate is selected. Submitting order to Discord anyway.",
        false
      );
    } else {
      setShippoMessage(
        `Selected ${selectedShippoRate.service} for ${shippoMoney(selectedShippoRate.customerCharge)}.`,
        false
      );
    }

    setTimeout(() => {
      submitBtn.click();
    }, 50);

    return;
  }

  const shippingInfo = document.getElementById("shipping-info");
  if (shippingInfo) {
    shippingInfo.value = formatShippoAddress(address);
  }

  const extraNotes = document.getElementById("extra-notes");
  if (extraNotes) {
    const note = buildShippoDiscordNote();

    if (
      !extraNotes.value.includes("**Shipping:**") &&
      !extraNotes.value.includes("**Delivery option:**")
    ) {
      extraNotes.value = extraNotes.value
        ? extraNotes.value + "\n" + note
        : note.trim();
    }
  }

  if (typeof updateTotals === "function") {
    updateTotals();
  }
}

function initShippoShipping() {
  loadShippoConfig();
  installShippoShippingOverride();

  [
    "shippo-street1",
    "shippo-street2",
    "shippo-city",
    "shippo-state",
    "shippo-zip",
    "shippo-country"
  ].forEach((id) => {
    const el = document.getElementById(id);

    if (el) {
      el.addEventListener("input", () => {
        resetSelectedRateBecauseAddressChanged(true);

        if (
          id === "shippo-street1" ||
          id === "shippo-city" ||
          id === "shippo-state" ||
          id === "shippo-zip"
        ) {
          queueShippoSuggest();
        }
      });
    }
  });

  const clearBtn = document.getElementById("shippo-clear-address");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      [
        "shippo-street1",
        "shippo-street2",
        "shippo-city",
        "shippo-state",
        "shippo-zip"
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });

      renderAddressSuggestions([]);
      resetSelectedRateBecauseAddressChanged(false);
      setShippoMessage("", false);
    });
  }

  const getRatesBtn = document.getElementById("shippo-get-rates-btn");
  if (getRatesBtn) {
    getRatesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      getShippoRates();
    });
  }

  document.addEventListener("click", prepareShippoBeforeOrderSubmit, true);
}

window.addEventListener("DOMContentLoaded", initShippoShipping);
