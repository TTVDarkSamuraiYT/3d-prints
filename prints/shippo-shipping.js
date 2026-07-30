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

    const details = [];

    if (rate.carrier) details.push(rate.carrier);
    if (rate.estimatedDays) {
      details.push(`estimated ${rate.estimatedDays} business day(s)`);
    }
    if (rate.parcelSummary) {
      details.push(rate.parcelSummary);
    }

    sub.textContent = details.join(" • ");

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

    list.appendChild(card);

    if (index === 0) {
      card.click();
    }
  });
}
