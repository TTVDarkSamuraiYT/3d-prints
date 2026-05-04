// maintenance.js
// Reads your Google Sheet tab named "website toggle".
// Put either Active or Offline in any visible cell on that tab.
// Active = website works normally.
// Offline = visitors get sent to /404.html maintenance page.

(function () {
  const CONFIG_PATH = getConfigPath();
  const MAINTENANCE_PAGE = getRootPath() + "404.html";

  function getRootPath() {
    const path = window.location.pathname;
    if (path.includes("/prints/") || path.includes("/tracking/")) return "../";
    return "";
  }

  function getConfigPath() {
    return getRootPath() + "config.json";
  }

  function currentPageIsMaintenancePage() {
    return window.location.pathname.toLowerCase().endsWith("/404.html");
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseSheetJSON(text) {
    return JSON.parse(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1));
  }

  async function getWebsiteStatus() {
    const configRes = await fetch(CONFIG_PATH, { cache: "no-cache" });
    if (!configRes.ok) throw new Error("Could not load config.json");

    const cfg = await configRes.json();
    const sheetId = cfg.SHEET_ID;
    const toggleSheetName = cfg.WEBSITE_TOGGLE_SHEET_NAME || "website toggle";

    if (!sheetId) return "active";

    const url =
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(sheetId) +
      "/gviz/tq?tqx=out:json&sheet=" +
      encodeURIComponent(toggleSheetName);

    const sheetRes = await fetch(url, { cache: "no-cache" });
    if (!sheetRes.ok) throw new Error("Could not load website toggle sheet");

    const json = parseSheetJSON(await sheetRes.text());
    const rows = json.table && json.table.rows ? json.table.rows : [];

    for (const row of rows) {
      const cells = row.c || [];
      for (const cell of cells) {
        const value = normalize(cell && cell.v);
        if (value === "offline" || value === "off" || value === "maintenance") {
          return "offline";
        }
        if (value === "active" || value === "online" || value === "on") {
          return "active";
        }
      }
    }

    return "active";
  }

  async function checkMaintenanceMode() {
    try {
      const status = await getWebsiteStatus();

      if (status === "offline" && !currentPageIsMaintenancePage()) {
        window.location.replace(MAINTENANCE_PAGE);
        return;
      }

      if (status === "active" && currentPageIsMaintenancePage()) {
        const homePath = getRootPath() || "./";
        const notice = document.getElementById("maintenance-status");
        if (notice) {
          notice.textContent = "Website is active again. You can return to the shop.";
        }
        const homeBtn = document.getElementById("maintenance-home-link");
        if (homeBtn) {
          homeBtn.style.display = "inline-block";
          homeBtn.href = homePath;
        }
      }
    } catch (err) {
      console.warn("Maintenance toggle check failed:", err);
      // Fail open so a temporary Sheets/config problem does not accidentally hide your site.
    }
  }

  window.addEventListener("DOMContentLoaded", checkMaintenanceMode);
})();
