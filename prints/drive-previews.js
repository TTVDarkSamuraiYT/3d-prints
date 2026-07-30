(function () {
  let DRIVE_PREVIEW_FOLDER_ID = "";
  let DRIVE_PREVIEW_WEBAPP_URL = "";

  let drivePreviewLoaded = false;
  let drivePreviewLoading = false;
  let drivePreviewError = "";
  let drivePreviewFiles = [];
  let drivePreviewMap = {};

  let activeDrivePreviewFiles = [];
  let activeDrivePreviewIndex = 0;

  function normalizePreviewKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\.[^/.]+$/, "")
      .replace(/[-_]+[0-9]+$/, "")
      .replace(/\s+/g, " ");
  }

  function slugifyPreviewKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\.[^/.]+$/, "")
      .replace(/[-_]+[0-9]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function setPreviewMessage(message, isError) {
    const copy = document.getElementById("preview-copy");
    if (!copy) return;

    copy.textContent = message || "";
    copy.className = isError ? "error-text" : "helper-text";
  }

  function loadConfigForDrivePreviews() {
    return fetch("../config.json?cacheBust=" + Date.now(), {
      cache: "no-cache"
    })
      .then((res) => res.json())
      .then((cfg) => {
        DRIVE_PREVIEW_FOLDER_ID = cfg.DRIVE_PREVIEW_FOLDER_ID || "";
        DRIVE_PREVIEW_WEBAPP_URL = cfg.DRIVE_PREVIEW_WEBAPP_URL || "";
      });
  }

  function jsonp(url, params) {
    return new Promise((resolve, reject) => {
      const callbackName =
        "drivePreviewCallback_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2);

      const query = new URLSearchParams();

      Object.keys(params || {}).forEach((key) => {
        query.set(key, params[key]);
      });

      query.set("callback", callbackName);
      query.set("cacheBust", Date.now());

      const joiner = url.includes("?") ? "&" : "?";
      const script = document.createElement("script");

      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "Preview request timed out. Make sure the Preview Apps Script is deployed as Execute as me + Anyone."
          )
        );
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
        reject(
          new Error(
            "Preview request failed. Check DRIVE_PREVIEW_WEBAPP_URL in config.json and deploy the Preview Apps Script as Anyone."
          )
        );
      };

      script.src = url + joiner + query.toString();
      document.body.appendChild(script);
    });
  }

  function indexDrivePreviewFiles(files) {
    drivePreviewFiles = Array.isArray(files) ? files : [];
    drivePreviewMap = {};

    drivePreviewFiles.forEach((file) => {
      const keys = [];

      keys.push(normalizePreviewKey(file.itemName));
      keys.push(slugifyPreviewKey(file.itemName));
      keys.push(normalizePreviewKey(file.baseName));
      keys.push(slugifyPreviewKey(file.baseName));
      keys.push(normalizePreviewKey(file.name));
      keys.push(slugifyPreviewKey(file.name));

      [...new Set(keys.filter(Boolean))].forEach((key) => {
        if (!drivePreviewMap[key]) drivePreviewMap[key] = [];
        drivePreviewMap[key].push(file);
      });
    });

    Object.keys(drivePreviewMap).forEach((key) => {
      drivePreviewMap[key].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          numeric: true,
          sensitivity: "base"
        })
      );
    });
  }

  function preloadDrivePreviewImages() {
    const loaded = new Set();

    drivePreviewFiles.forEach((file) => {
      if (file.type !== "image") return;
      if (!file.url) return;
      if (loaded.has(file.url)) return;

      loaded.add(file.url);

      const img = new Image();
      img.src = file.url;
    });
  }

  async function loadDrivePreviews() {
    if (drivePreviewLoaded || drivePreviewLoading) return;

    drivePreviewLoading = true;
    drivePreviewError = "";

    try {
      await loadConfigForDrivePreviews();

      if (
        !DRIVE_PREVIEW_WEBAPP_URL ||
        DRIVE_PREVIEW_WEBAPP_URL.includes("PASTE_")
      ) {
        throw new Error(
          "DRIVE_PREVIEW_WEBAPP_URL is missing in config.json."
        );
      }

      if (!DRIVE_PREVIEW_FOLDER_ID) {
        throw new Error("DRIVE_PREVIEW_FOLDER_ID is missing in config.json.");
      }

      const data = await jsonp(DRIVE_PREVIEW_WEBAPP_URL, {
        folderId: DRIVE_PREVIEW_FOLDER_ID
      });

      if (!data || !data.ok) {
        throw new Error((data && data.error) || "Preview index returned an error.");
      }

      indexDrivePreviewFiles(data.files || []);
      preloadDrivePreviewImages();

      drivePreviewLoaded = true;
      drivePreviewLoading = false;

      console.log("[DRIVE PREVIEWS] Loaded", drivePreviewFiles.length, "file(s).");
    } catch (err) {
      drivePreviewError = String(err && err.message ? err.message : err);
      drivePreviewLoaded = true;
      drivePreviewLoading = false;

      console.warn("[DRIVE PREVIEWS] Failed:", err);
    }
  }

  function getDrivePreviewFilesForItem(itemName) {
    const keys = [normalizePreviewKey(itemName), slugifyPreviewKey(itemName)];

    for (const key of keys) {
      if (drivePreviewMap[key] && drivePreviewMap[key].length) {
        return drivePreviewMap[key];
      }
    }

    return [];
  }

  function renderDrivePreviewMedia() {
    const mediaWrap = document.getElementById("preview-media-wrap");
    const thumbs = document.getElementById("preview-thumbs");
    const prevBtn = document.getElementById("preview-prev-btn");
    const nextBtn = document.getElementById("preview-next-btn");

    if (!mediaWrap || !thumbs) return;

    mediaWrap.innerHTML = "";
    thumbs.innerHTML = "";

    if (!activeDrivePreviewFiles.length) return;

    const file = activeDrivePreviewFiles[activeDrivePreviewIndex];

    if (file.type === "video") {
      const iframe = document.createElement("iframe");
      iframe.src = file.url;
      iframe.className = "preview-main-media preview-drive-frame";
      iframe.allow = "autoplay; fullscreen";
      iframe.allowFullscreen = true;
      iframe.loading = "eager";

      mediaWrap.appendChild(iframe);
    } else {
      const img = document.createElement("img");
      img.src = file.url;
      img.alt = file.name || "Print preview";
      img.className = "preview-main-media";

      mediaWrap.appendChild(img);
    }

    activeDrivePreviewFiles.forEach((thumbFile, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className =
        "preview-thumb" + (index === activeDrivePreviewIndex ? " active" : "");
      thumb.setAttribute("aria-label", `Preview ${index + 1}`);

      if (thumbFile.type === "video") {
        const label = document.createElement("span");
        label.textContent = "Video";
        thumb.appendChild(label);
      } else {
        const img = document.createElement("img");
        img.src = thumbFile.thumbnail || thumbFile.url;
        img.alt = "";
        thumb.appendChild(img);
      }

      thumb.addEventListener("click", () => {
        activeDrivePreviewIndex = index;
        renderDrivePreviewMedia();
      });

      thumbs.appendChild(thumb);
    });

    const hasMultiple = activeDrivePreviewFiles.length > 1;

    if (prevBtn) prevBtn.style.display = hasMultiple ? "flex" : "none";
    if (nextBtn) nextBtn.style.display = hasMultiple ? "flex" : "none";

    setPreviewMessage(
      `${activeDrivePreviewIndex + 1} of ${activeDrivePreviewFiles.length} preview file${
        activeDrivePreviewFiles.length === 1 ? "" : "s"
      }`,
      false
    );
  }

  function moveDrivePreview(step) {
    if (!activeDrivePreviewFiles.length) return;

    activeDrivePreviewIndex =
      (activeDrivePreviewIndex + step + activeDrivePreviewFiles.length) %
      activeDrivePreviewFiles.length;

    renderDrivePreviewMedia();
  }

  async function openDrivePreviewModal(itemName) {
    const modal = document.getElementById("preview-modal");
    const title = document.getElementById("preview-title");
    const loading = document.getElementById("preview-loading");
    const viewer = document.getElementById("preview-viewer");
    const thumbs = document.getElementById("preview-thumbs");

    if (!modal || !title || !loading || !viewer || !thumbs) return;

    title.textContent = `${itemName} preview`;

    activeDrivePreviewFiles = [];
    activeDrivePreviewIndex = 0;

    viewer.classList.add("hidden");
    thumbs.classList.add("hidden");

    loading.classList.remove("hidden");
    loading.textContent = "Loading preview files…";

    setPreviewMessage("", false);

    modal.classList.remove("hidden");
    modal.removeAttribute("aria-hidden");

    await loadDrivePreviews();

    activeDrivePreviewFiles = getDrivePreviewFilesForItem(itemName);

    loading.classList.add("hidden");

    if (!activeDrivePreviewFiles.length) {
      let msg =
        `No previews were found for "${itemName}". ` +
        `The Drive folder loaded ${drivePreviewFiles.length} preview file(s). ` +
        `Make sure the file is named like "${itemName}.png", "${itemName}-1.jpg", or "${itemName}.mp4".`;

      if (drivePreviewError) {
        msg += ` Preview loader error: ${drivePreviewError}`;
      } else if (drivePreviewFiles.length) {
        msg +=
          " Drive files found: " +
          drivePreviewFiles.map((f) => f.name).join(", ");
      }

      setPreviewMessage(msg, true);
      return;
    }

    viewer.classList.remove("hidden");
    thumbs.classList.remove("hidden");

    renderDrivePreviewMedia();
  }

  function closeDrivePreviewModal() {
    const modal = document.getElementById("preview-modal");
    const mediaWrap = document.getElementById("preview-media-wrap");

    if (!modal) return;

    if (
      document.activeElement &&
      modal.contains(document.activeElement) &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }

    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");

    if (mediaWrap) mediaWrap.innerHTML = "";

    activeDrivePreviewFiles = [];
    activeDrivePreviewIndex = 0;
  }

  window.openPreviewModal = openDrivePreviewModal;
  window.closePreviewModal = closeDrivePreviewModal;
  window.movePreview = moveDrivePreview;

  window.addEventListener("DOMContentLoaded", () => {
    loadDrivePreviews();

    const closePreviewBtn = document.getElementById("close-preview-btn");
    if (closePreviewBtn) {
      closePreviewBtn.addEventListener("click", closeDrivePreviewModal);
    }

    const previewPrevBtn = document.getElementById("preview-prev-btn");
    if (previewPrevBtn) {
      previewPrevBtn.addEventListener("click", (e) => {
        e.preventDefault();
        moveDrivePreview(-1);
      });
    }

    const previewNextBtn = document.getElementById("preview-next-btn");
    if (previewNextBtn) {
      previewNextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        moveDrivePreview(1);
      });
    }

    const previewModal = document.getElementById("preview-modal");
    if (previewModal) {
      previewModal.addEventListener("click", (e) => {
        if (e.target === previewModal) closeDrivePreviewModal();
      });
    }

    document.addEventListener("keydown", (e) => {
      const modal = document.getElementById("preview-modal");
      const open = modal && !modal.classList.contains("hidden");

      if (e.key === "Escape") closeDrivePreviewModal();
      if (open && e.key === "ArrowLeft") moveDrivePreview(-1);
      if (open && e.key === "ArrowRight") moveDrivePreview(1);
    });
  });
})();
