let SHIPPO_RATES_WEBAPP_URL = "";
let selectedShippoRate = null;
let lastShippoRates = [];

function shippoMoney(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function shippoText(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
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

function updateShippoSuggestion() {
  const suggestionText = document.getElementById("shippo-suggestion-text");
  if (!suggestionText) return;

  const address = buildShippoAddress();

  const parts = [
    address.street1,
    address.city,
    address.state,
    address.zip
  ].filter(Boolean);

  suggestionText.textContent =
    parts.length > 0 ? parts.join(" ") : "Start typing your address";
}

function loadShippoConfig() {
  return fetch("../config.json?cacheBust=" + Date.now(), {
    cache: "no-cache"
  })
    .then((res) => res.json())
    .then((cfg) => {
      SHIPPO_RATES_WEBAPP_URL = cfg.SHIPPO_RATES_WEBAPP_URL || "";
    })
    .catch((err) => {
      console.warn("[SHIPPO] Could not load config:", err);
    });
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
      reject(new Error("Shippo rates request timed out."));
    }, 25000);

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
      reject(new Error("Shippo rates request failed."));
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

async function getShippoRates() {
  const address = buildShippoAddress();
  const error = validateShippoAddressFields(address);

  if (error) {
    setShippoMessage(error, true);
    return;
  }

  if (!SHIPPO_RATES_WEBAPP_URL || SHIPPO_RATES_WEBAPP_URL.includes("PASTE_")) {
    setShippoMessage(
      "Shippo rates are not configured yet. Add your Shippo Apps Script /exec URL to config.json.",
      true
    );
    return;
  }

  selectedShippoRate = null;
  lastShippoRates = [];
  renderShippoRates([]);

  setShippoMessage("Getting Shippo test rates…", false);

  const payload = {
    action: "rates",
    addressTo: address
  };

  try {
    const data = await shippoJsonp(SHIPPO_RATES_WEBAPP_URL, payload);

    if (!data || !data.ok) {
      throw new Error((data && data.error) || "Shippo returned an error.");
    }

    lastShippoRates = Array.isArray(data.rates) ? data.rates : [];

    if (!lastShippoRates.length) {
      setShippoMessage("No shipping rates were returned for this address.", true);
      return;
    }

    setShippoMessage("Choose one shipping option.", false);
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

    const top = document.createElement("div");
    top.className = "shippo-rate-top";

    const service = document.createElement("span");
    service.textContent = rate.service;

    const price = document.createElement("span");
    price.className = "shippo-rate-price";
    price.textContent = shippoMoney(rate.customerCharge);

    top.appendChild(service);
    top.appendChild(price);

    const sub = document.createElement("div");
    sub.className = "shippo-rate-sub";
    sub.textContent =
      `${rate.carrier} • base ${shippoMoney(rate.baseRate)} • reserve ${shippoMoney(rate.reserve)}${
        rate.estimatedDays ? ` • estimated ${rate.estimatedDays} business day(s)` : ""
      }`;

    card.appendChild(top);
    card.appendChild(sub);

    card.addEventListener("click", () => {
      selectedShippoRate = rate;

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

    if (index === 0) {
      card.click();
    }

    list.appendChild(card);
  });
}

function buildShippoDiscordNote() {
  if (!selectedShippoRate) return "";

  const address = buildShippoAddress();

  return [
    "",
    "--- Shippo shipping selected ---",
    `Customer address: ${formatShippoAddress(address).replace(/\n/g, ", ")}`,
    `Carrier: ${selectedShippoRate.carrier}`,
    `Service: ${selectedShippoRate.service}`,
    `Shippo base rate: ${shippoMoney(selectedShippoRate.baseRate)}`,
    `Customer charged shipping: ${shippoMoney(selectedShippoRate.customerCharge)}`,
    `Shipping reserve: ${shippoMoney(selectedShippoRate.reserve)}`,
    selectedShippoRate.estimatedDays
      ? `Estimated delivery: ${selectedShippoRate.estimatedDays} business day(s)`
      : "",
    `Shippo rate ID: ${selectedShippoRate.rateId || "N/A"}`,
    "Label purchase: manual after Square invoice payment"
  ]
    .filter(Boolean)
    .join("\n");
}

function installShippoShippingOverride() {
  const originalGetShippingCharge =
    typeof window.getShippingCharge === "function"
      ? window.getShippingCharge
      : null;

  window.getShippingCharge = function (expediteChoice) {
    if (selectedShippoRate) {
      return Number(selectedShippoRate.customerCharge || 0);
    }

    if (originalGetShippingCharge) {
      return originalGetShippingCharge(expediteChoice);
    }

    return 0;
  };
}

function prepareShippoBeforeOrderSubmit(event) {
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
    setShippoMessage("Please get and select a shipping rate first.", true);

    if (typeof showSubmitMessage === "function") {
      showSubmitMessage("Please select a Shippo shipping rate before submitting.", true);
    }

    return;
  }

  const shippingInfo = document.getElementById("shipping-info");
  if (shippingInfo) {
    shippingInfo.value = formatShippoAddress(address);
  }

  const extraNotes = document.getElementById("extra-notes");
  if (extraNotes) {
    const note = buildShippoDiscordNote();

    if (!extraNotes.value.includes("--- Shippo shipping selected ---")) {
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
        selectedShippoRate = null;
        renderShippoRates([]);
        updateShippoSuggestion();
        setShippoMessage("Address changed. Get shipping rates again.", false);

        if (typeof updateTotals === "function") {
          updateTotals();
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

      selectedShippoRate = null;
      renderShippoRates([]);
      updateShippoSuggestion();
      setShippoMessage("", false);

      if (typeof updateTotals === "function") {
        updateTotals();
      }
    });
  }

  const suggestionBtn = document.getElementById("shippo-main-suggestion");
  if (suggestionBtn) {
    suggestionBtn.addEventListener("click", () => {
      const street = document.getElementById("shippo-street1");
      if (street) street.focus();
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
  updateShippoSuggestion();
}

window.addEventListener("DOMContentLoaded", initShippoShipping);