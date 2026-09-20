(() => {
  "use strict";

  const overlay = document.getElementById("toolsOverlay");
  const back = document.getElementById("toolsBackBtn");
  const tabs = document.getElementById("toolsTabs");
  const content = document.getElementById("toolsContent");
  const guestBanner = document.getElementById("guestLoginBanner");
  const guestLoginBtn = document.getElementById("guestLoginBtn");

  if (!overlay || !back || !tabs || !content) {
    console.warn("FNAA tools: required UI nodes are missing.");
    return;
  }

  const CONFIG = window.FNAA_CONFIG || {};
  const DB = CONFIG.database || window.FORTNITE_AI_DB || {};
  const API_ENDPOINT = String(
    CONFIG.apiEndpoint ||
    window.FORTNITE_AI_API_ENDPOINT ||
    ""
  ).trim().replace(/\/+$/, "");

  const EXPORT_BASE =
    "https://export-service-new.dillyapis.com/v1/export";

  const FORTNITE_API =
    "https://fortnite-api.com/v2/cosmetics/br";

  const TH3DRY_IMAGE_BASE =
    "https://raw.githubusercontent.com/Th3DryZ69/FortniteToolsWeb/main/public/images/";

  const COSMETIC_PAGE = 40;
  const CATALOG_PAGE = 48;
  const DEVICE_DETAIL_PAGE = 20;
  const STATIC_DATA_TIMEOUT_MS = 12_000;
  const ACTION_FLASH_MS = 3_000;
  const MAX_DOWNLOAD_IMAGE_BYTES =
    10 * 1024 * 1024;

  function actionAbortError(
    signal
  ) {
    const error =
      new Error(
        "This request was cancelled because a newer request replaced it."
      );

    error.name =
      "AbortError";

    error.code =
      "NOVASPARX_REQUEST_REPLACED";

    error.reason =
      signal?.reason ||
      "cancelled";

    return error;
  }

  function actionAborted(
    error,
    signal
  ) {
    return Boolean(
      signal?.aborted ||
      error?.name ===
        "AbortError"
    );
  }

  function throwIfActionAborted(
    signal
  ) {
    if (signal?.aborted) {
      throw actionAbortError(
        signal
      );
    }
  }

  const t = (key, fallback = "") =>
    window.FortniteI18n?.t?.(key) ||
    fallback ||
    key;

  let active = "assets";
  let idData = null;
  let deviceData = null;
  let cosmeticResults = [];
  let cosmeticShown = 0;
  let cosmeticFilter = "all";

  let renderGeneration = 0;
  let staticCatalogPromise = null;
  let islandRows = null;
  let deviceRows = null;

  const knownImageByPath =
    new Map();

  const exportJsonCache = new Map();

  function exportJsonCacheLimit() {
    const state =
      window.NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    return (
      state.isIOS ||
      state.isMobile
        ? 4
        : 10
    );
  }

  function cachedExportJson(
    key
  ) {
    if (
      !exportJsonCache.has(
        key
      )
    ) {
      return undefined;
    }

    const value =
      exportJsonCache.get(
        key
      );

    // Refresh insertion order so this Map behaves as a tiny LRU cache.
    exportJsonCache.delete(
      key
    );

    exportJsonCache.set(
      key,
      value
    );

    return value;
  }

  function rememberExportJson(
    key,
    value,
    rawBytes = 0
  ) {
    const state =
      window.NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    const maxCacheableBytes =
      state.isIOS
        ? 2 * 1024 * 1024
        : state.isMobile
          ? 4 * 1024 * 1024
          : 8 * 1024 * 1024;

    if (
      Number(rawBytes) >
      maxCacheableBytes
    ) {
      return;
    }

    exportJsonCache.delete(
      key
    );

    exportJsonCache.set(
      key,
      value
    );

    while (
      exportJsonCache.size >
      exportJsonCacheLimit()
    ) {
      const oldest =
        exportJsonCache.keys()
          .next()
          .value;

      exportJsonCache.delete(
        oldest
      );
    }
  }

  const assetClassificationCache =
    new Map();

  const assetClassificationRequests =
    new Map();

  const ASSET_CLASSIFICATION_CACHE_LIMIT =
    96;

  back.addEventListener("click", close);

  guestLoginBtn?.addEventListener(
    "click",
    () => window.FortniteAgent?.showApiLogin?.()
  );

  window.addEventListener(
    "fortnite-login-mode-changed",
    updateGuestBanner
  );

  window.addEventListener(
    "fortnite-language-changed",
    () => {
      if (!overlay.hidden) render();
    }
  );

  tabs.addEventListener("click", (event) => {
    const button =
      event.target.closest(".tools-tab");

    if (!button) return;

    active = button.dataset.tool || "assets";

    for (const item of tabs.querySelectorAll(".tools-tab")) {
      item.classList.toggle(
        "active",
        item === button
      );
    }

    render();
  });

  function open(tool = "assets") {
    active = tool;

    for (const button of tabs.querySelectorAll(".tools-tab")) {
      button.classList.toggle(
        "active",
        button.dataset.tool === active
      );
    }

    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");

    document.body.classList.add(
      "fnaa-tools-open"
    );

    updateGuestBanner();
    render();
  }

  function releaseAssetPreviews(
    root = content
  ) {
    for (
      const card of
      root?.querySelectorAll?.(
        ".asset-result-card"
      ) || []
    ) {
      const assetPath =
        card.dataset.assetPath ||
        "";

      if (assetPath) {
        window.FortnitePreview
          ?.release?.(
            assetPath
          );
      }
    }

    if (
      root === content
    ) {
      window.FortnitePreview
        ?.releaseAll?.();
    }
  }

  function close() {
    renderGeneration++;

    releaseAssetPreviews();

    window.NovaSparxBrowserGuard
      ?.abortActive?.(
        "tools-closed"
      );

    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    document.body.classList.remove(
      "fnaa-tools-open"
    );
  }

  function updateGuestBanner() {
    if (!guestBanner) return;

    guestBanner.hidden =
      sessionStorage.getItem(
        "fortniteAiAgent.loginMode.session"
      ) !== "guest";
  }

  async function render() {
    const generation =
      ++renderGeneration;

    releaseAssetPreviews();

    content.innerHTML =
      '<div class="tool-section"><div class="tool-empty">Loading...</div></div>';

    try {
      if (active === "assets") {
        renderAssets();
      } else if (active === "ids") {
        await renderIds(generation);
      } else if (active === "devices") {
        await renderDevices(generation);
      } else if (active === "convert") {
        renderConverters();
      } else if (active === "path") {
        renderPathModifier();
      } else if (active === "cosmetic") {
        renderCosmetics();
      } else {
        renderAssets();
      }
    } catch (error) {
      if (
        generation !==
        renderGeneration
      ) {
        return;
      }

      content.innerHTML = `
        <div class="tool-section">
          <div class="tool-empty">
            ${escapeHtml(error?.message || String(error))}
          </div>
        </div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Manual asset search
  // ---------------------------------------------------------------------------

  function renderAssets() {
    content.innerHTML = `
      <div class="tool-section fnaa-manual-search">
        <div class="tool-section-head">
          <div>
            <h2>${escapeHtml(t("manualSearch", "Manual Search"))}</h2>
            <p class="tool-note">
              ${escapeHtml(
                t(
                  "manualNote",
                  "Search the Fortnite asset database without sending the query to the AI."
                )
              )}
            </p>
          </div>
        </div>

        <div class="tool-searchbar">
          <input
            id="assetQuery"
            autocomplete="off"
            spellcheck="false"
            placeholder="${escapeAttr(
              t(
                "searchPlaceholder",
                "Search a path, asset, SM_, M_, MI_..."
              )
            )}"
          />
          <button
            id="assetSearch"
            class="tool-button primary"
            type="button"
          >${escapeHtml(t("search", "Search"))}</button>
        </div>

        <div class="asset-search-options" role="group" aria-label="Path format">
          <label class="tool-check">
            <input id="assetFormatted" type="checkbox" />
            <span>Formatted</span>
          </label>

          <label class="tool-check">
            <input id="assetAddClass" type="checkbox" />
            <span>Add _C</span>
          </label>
        </div>

        <div class="tool-subtabs asset-scope-tabs" role="tablist">
          <button
            class="tool-subtab active"
            data-scope="all"
            type="button"
          >All</button>

          <button
            class="tool-subtab"
            data-scope="sm"
            type="button"
          >SM_</button>

          <button
            class="tool-subtab"
            data-scope="m"
            type="button"
          >MI_ / M_</button>

          <button
            class="tool-subtab"
            data-scope="new"
            type="button"
          >New</button>
        </div>

        <div
          id="assetResults"
          class="tool-empty"
          aria-live="polite"
        >Type something to search.</div>
      </div>`;

    const input =
      content.querySelector("#assetQuery");

    const results =
      content.querySelector("#assetResults");

    const formattedToggle =
      content.querySelector("#assetFormatted");

    const classToggle =
      content.querySelector("#assetAddClass");

    const scopeRoot =
      content.querySelector(".asset-scope-tabs");

    const searchButton =
      content.querySelector("#assetSearch");

    let scope = routeScope() || "all";
    let latestRun = 0;

    for (const button of scopeRoot.querySelectorAll("[data-scope]")) {
      button.classList.toggle(
        "active",
        button.dataset.scope === scope
      );
    }

    const initialQuery =
      new URL(location.href)
        .searchParams
        .get("q") || "";

    if (initialQuery) {
      input.value = initialQuery;
    }

    const run = async () => {
      const query =
        input.value.trim();

      const thisRun = ++latestRun;

      updateManualSearchRoute(
        query,
        scope
      );

      if (!query) {
        results.className = "tool-empty";
        results.textContent =
          "Type something to search.";
        return;
      }

      results.className = "tool-empty";

      const stopSearching =
        startSearchingAnimation(results);

      try {
        const effectiveScope =
          smartSearchScope(
            scope,
            query
          );

        const data =
          await window.FortniteAgent
            ?.searchDatabase?.(
              effectiveScope,
              query
            );

        if (thisRun !== latestRun) {
          stopSearching();
          return;
        }

        stopSearching();

        const rows =
          Array.isArray(data?.results)
            ? data.results
            : [];

        if (!rows.length) {
          results.textContent =
            "No close results found.";
          return;
        }

        releaseAssetPreviews(
          results
        );

        results.className = "";

        const formatted =
          formattedToggle.checked;

        const addClass =
          classToggle.checked;

        results.innerHTML =
          rows
            .slice(0, 80)
            .map((item) =>
              pathCard(
                item,
                formatted,
                addClass
              )
            )
            .join("");

        bindAssetResultActions(results);
        hydrateAssetCards(results);

        const meta =
          document.createElement("div");

        meta.className =
          "tool-note asset-search-meta";

        meta.textContent =
          `${data.total ?? rows.length} result${(data.total ?? rows.length) === 1 ? "" : "s"} · ${data.source || "database"}`;

        results.prepend(meta);
      } catch (error) {
        if (thisRun !== latestRun) return;

        stopSearching();

        results.className = "tool-empty";
        results.textContent =
          error?.message ||
          "Search failed.";
      } finally {
        // database-worker.js aborts stale searches. latestRun prevents stale UI.
      }
    };

    scopeRoot.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest("[data-scope]");

        if (!button) return;

        scope =
          button.dataset.scope || "all";

        for (const item of scopeRoot.querySelectorAll("[data-scope]")) {
          item.classList.toggle(
            "active",
            item === button
          );
        }

        // Scope and formatting choices are applied only after Search/Enter.
        // This prevents several large shard requests while somebody is still
        // typing on an iPhone.
      }
    );

    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter") return;

        event.preventDefault();

        run();
      }
    );

    searchButton.addEventListener(
      "click",
      run
    );

    // A restored route may refill the field, but the user still starts the
    // search explicitly with Search or Enter.
  }

  function fallbackAssetClassification(
    path
  ) {
    const associations =
      window.NovaSparxAssociations;

    const diagnosis =
      associations?.diagnosePath?.(
        path
      ) ||
      null;

    const family =
      diagnosis?.family ||
      associations?.family?.(
        path
      ) ||
      "other";

    const name =
      assetTitle(path)
        .toLowerCase();

    let kind =
      diagnosis?.kind ||
      family;

    if (
      family === "mesh" &&
      ![
        "staticmesh",
        "skeletalmesh"
      ].includes(kind)
    ) {
      kind =
        /^(?:sk_|skm_)/i.test(name)
          ? "skeletalmesh"
          : "staticmesh";
    } else if (
      family === "blueprint" &&
      kind === "blueprint"
    ) {
      kind =
        "blueprint";
    }

    const capabilities =
      associations
        ?.capabilityProfile?.(
          kind
        ) ||
      {
        kind,
        canPreview:
          false,
        previewMode:
          family === "mesh"
            ? "3d"
            : family === "texture"
              ? "image"
              : "universal",
        canViewImage:
          false,
        canView3D:
          false,
        canDownload:
          true,
        canExportUEFN:
          false,
        downloadFormats:
          family === "mesh"
            ? ["nsmesh", "json"]
            : family === "texture"
              ? ["png", "json"]
              : ["json"],
        tags:
          [
            family === "other"
              ? "ASSET"
              : family.toUpperCase()
          ]
      };

    return {
      family,
      kind:
        capabilities.kind ||
        kind,
      source:
        diagnosis?.source ||
        "local-fallback",
      confidence:
        Number.isFinite(
          diagnosis?.confidence
        )
          ? diagnosis.confidence
          : family === "other"
            ? 0
            : 35,
      capabilities,
      tags:
        Array.isArray(
          capabilities.tags
        )
          ? capabilities.tags
          : ["ASSET"]
    };
  }

  function evidenceRank(source) {
    return ({ inspection: 5, "export-json": 4, "typed-path": 3,
      "generated-class-path": 2, "path-fallback": 1 })[source] || 0;
  }

  async function classifyAsset(
    path,
    options = {}
  ) {
    const key =
      String(path || "")
        .trim()
        .toLowerCase();

    const signal =
      options.signal ||
      null;

    const verifyKnown =
      options.verifyKnown !==
      false;

    throwIfActionAborted(
      signal
    );

    if (!key) {
      return fallbackAssetClassification(
        path
      );
    }

    if (
      !options.inspection && !options.data &&
      assetClassificationCache
        .has(key)
    ) {
      const cached =
        assetClassificationCache
          .get(key);

      const cachedVerified =
        [
          "inspection",
          "export-json",
          "typed-path"
        ].includes(
          String(
            cached?.source ||
            ""
          )
        );

      if (
        !verifyKnown ||
        cachedVerified
      ) {
        return cached;
      }
    }

    const requestKey =
      key +
      (
        verifyKnown
          ? "|verified"
          : "|light"
      );

    if (
      !signal && !options.inspection && !options.data &&
      assetClassificationRequests
        .has(requestKey)
    ) {
      return assetClassificationRequests
        .get(requestKey);
    }

    const request =
      Promise.resolve()
        .then(
          async () => {
            throwIfActionAborted(
              signal
            );

            const result =
              await window
                .NovaSparxAssociations
                ?.classify?.(
                  path,
                  {
                    verifyKnown,
                    inspection: options.inspection,
                    data: options.data,
                    signal:
                      signal ||
                      undefined
                  }
                );

            throwIfActionAborted(
              signal
            );

            return (
              result ||
              fallbackAssetClassification(
                path
              )
            );
          }
        )
        .catch(
          (error) => {
            if (
              actionAborted(
                error,
                signal
              )
            ) {
              throw actionAbortError(
                signal
              );
            }

            return fallbackAssetClassification(
              path
            );
          }
        )
        .then(
          (result) => {
            throwIfActionAborted(
              signal
            );

            const previous = assetClassificationCache.get(key);
            if (previous && evidenceRank(previous.source) > evidenceRank(result.source)) {
              return previous;
            }

            assetClassificationCache.set(
              key,
              result
            );

            while (
              assetClassificationCache
                .size >
              ASSET_CLASSIFICATION_CACHE_LIMIT
            ) {
              const oldest =
                assetClassificationCache
                  .keys()
                  .next()
                  .value;

              assetClassificationCache
                .delete(oldest);
            }

            return result;
          }
        )
        .finally(
          () => {
            if (
              assetClassificationRequests
                .get(
                  requestKey
                ) ===
              request
            ) {
              assetClassificationRequests
                .delete(
                  requestKey
                );
            }
          }
        );

    if (!signal && !options.inspection && !options.data) {
      assetClassificationRequests.set(
        requestKey,
        request
      );
    }

    return request;
  }

  function setAssetTags(
    card,
    classification
  ) {
    const root =
      card.querySelector(
        "[data-asset-tags]"
      );

    if (!root) return;

    const tags =
      Array.isArray(
        classification?.tags
      )
        ? classification.tags
        : [];

    const unique =
      [
        ...new Set(
          tags
            .map(
              (value) =>
                String(
                  value || ""
                ).trim()
            )
            .filter(Boolean)
        )
      ].slice(0, 3);

    if (!unique.length) {
      return;
    }

    root.replaceChildren(
      ...unique.map(
        (value) => {
          const span =
            document.createElement(
              "span"
            );

          span.textContent =
            value;

          return span;
        }
      )
    );
  }

  function browserMeshParserReady() {
    try {
      return (
        window.NovaSparxLocalParser
          ?.status?.()
          ?.registered ===
        true
      );
    } catch {
      return false;
    }
  }

  function applyAssetClassification(
    card,
    classification
  ) {
    if (
      !card ||
      !classification
    ) {
      return;
    }

    if (evidenceRank(card.dataset.assetEvidence) > evidenceRank(classification.source)) {
      return;
    }
    const capabilities =
      classification.capabilities ||
      {};

    const kind =
      String(
        classification.kind ||
        capabilities.kind ||
        "other"
      );

    card.dataset.assetKind =
      kind;

    card.dataset.assetConfidence =
      String(
        Number(
          classification.confidence ||
          0
        )
      );

    card.dataset.assetEvidence = classification.source || "unknown";
    setAssetTags(card, classification);
    const tagRoot = card.querySelector("[data-asset-tags]");
    if (tagRoot) {
      tagRoot.title = classification.source === "path-fallback"
        ? "Inferred from path naming; Unreal class is not verified."
        : classification.assetType
          ? `Unreal class: ${classification.assetType}`
          : "Asset type evidence unavailable.";
    }

    const previewButton =
      card.querySelector(
        '[data-asset-action="preview"]'
      );

    if (previewButton) {
      if (
        capabilities.canView3D &&
        browserMeshParserReady()
      ) {
        previewButton.disabled =
          false;

        previewButton.dataset
          .closedLabel =
          t(
            "view3dModel",
            "View 3D Model"
          );

        previewButton.dataset
          .openLabel =
          t(
            "hide3dModel",
            "Hide 3D Model"
          );
      } else if (
        capabilities.canViewImage
      ) {
        previewButton.disabled =
          false;

        previewButton.dataset
          .closedLabel =
          t(
            "viewImage",
            "View Image"
          );

        previewButton.dataset
          .openLabel =
          t(
            "hideImage",
            "Hide Image"
          );
      } else if (
        capabilities.canPreview === true &&
        !capabilities.canView3D
      ) {
        previewButton.disabled =
          false;

        previewButton.dataset
          .closedLabel =
          t(
            "viewPreview",
            "View Preview"
          );

        previewButton.dataset
          .openLabel =
          t(
            "hidePreview",
            "Hide Preview"
          );
      } else {
        previewButton.disabled =
          true;

        previewButton.dataset
          .closedLabel =
          t(
            "noVisualPreview",
            "No Visual Preview"
          );

        previewButton.dataset
          .openLabel =
          previewButton.dataset
            .closedLabel;
      }

      if (
        previewButton.dataset
          .fnaaOpen !== "1"
      ) {
        previewButton.textContent =
          previewButton.dataset
            .closedLabel;
      }
    }

    const exportButton =
      card.querySelector(
        '[data-asset-action="uefn"]'
      );

    if (exportButton) {
      const exporterSupports =
        Boolean(
          window.NovaSparxExporter
            ?.supports?.(
              classification
            )
        );

      const meshKind =
        [
          "staticmesh",
          "blueprint-visual"
        ].includes(
          kind
        );

      const supported =
        capabilities.canExportUEFN === true &&
        exporterSupports &&
        (
          !meshKind ||
          browserMeshParserReady()
        );

      exportButton.disabled =
        !supported;

      if (supported) {
        exportButton.removeAttribute(
          "title"
        );
      } else {
        exportButton.title =
          kind === "skeletalmesh"
            ? "Skeletal UEFN export is waiting for bones and skin weights."
            : [
                "staticmesh",
                "blueprint-visual"
              ].includes(kind) &&
              !browserMeshParserReady()
              ? "3D export is hidden until the browser parser has real geometry. No Back4App-only export is advertised."
              : "UEFN-ready export is not available for this asset type yet.";
      }
    }

    const downloadButton =
      card.querySelector(
        '[data-asset-action="download"]'
      );

    if (downloadButton) {
      downloadButton.disabled =
        capabilities.canDownload ===
        false;
    }
  }

  function hydrateAssetCards(
    root
  ) {
    const cards =
      [
        ...root.querySelectorAll(
          ".asset-result-card"
        )
      ];

    if (!cards.length) {
      return;
    }

    const hydrate =
      (card) => {
        if (
          card.dataset
            .assetClassifying ===
            "1" ||
          card.dataset
            .assetClassified ===
            "1"
        ) {
          return;
        }

        card.dataset
          .assetClassifying =
          "1";

        const assetPath =
          card.dataset.assetPath ||
          "";

        // Paint an immediate local answer so the card never waits on a
        // metadata request. The verified result can correct it afterwards.
        applyAssetClassification(
          card,
          fallbackAssetClassification(
            assetPath
          )
        );

        classifyAsset(
          assetPath,
          {
            verifyKnown:
              true
          }
        )
          .then(
            (classification) => {
              applyAssetClassification(
                card,
                classification
              );

              card.dataset
                .assetClassified =
                "1";
            }
          )
          .finally(
            () => {
              delete card.dataset
                .assetClassifying;
            }
          );
      };

    if (
      typeof IntersectionObserver !==
        "function"
    ) {
      cards
        .slice(0, 16)
        .forEach(hydrate);

      return;
    }

    const observer =
      new IntersectionObserver(
        (entries) => {
          for (
            const entry of entries
          ) {
            if (
              !entry.isIntersecting
            ) {
              continue;
            }

            observer.unobserve(
              entry.target
            );

            hydrate(
              entry.target
            );
          }
        },
        {
          rootMargin:
            "320px 0px"
        }
      );

    for (
      const card of cards
    ) {
      observer.observe(card);
    }
  }

  function safeAssetFilename(
    path,
    extension
  ) {
    const base =
      assetTitle(path)
        .replace(
          /[^A-Za-z0-9._-]+/g,
          "_"
        )
        .replace(
          /^_+|_+$/g,
          ""
        ) ||
      "NovaSparx_Asset";

    return (
      base +
      "." +
      String(extension || "bin")
        .replace(
          /^[.]+/,
          ""
        )
    );
  }

  function saveBlob(
    blob,
    filename
  ) {
    const url =
      URL.createObjectURL(
        blob
      );

    const link =
      document.createElement(
        "a"
      );

    link.href = url;
    link.download =
      filename;

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1_500
    );
  }

  async function responseBlobBounded(
    response,
    maxBytes,
    signal = null
  ) {
    throwIfActionAborted(
      signal
    );

    const declared =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      declared > 0 &&
      declared > maxBytes
    ) {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        "The download exceeded this device's safe image limit."
      );
    }

    if (
      !response.body ||
      typeof response.body
        .getReader !==
        "function"
    ) {
      const blob =
        await response.blob();

      throwIfActionAborted(
        signal
      );

      if (
        blob.size >
        maxBytes
      ) {
        throw new Error(
          "The download exceeded this device's safe image limit."
        );
      }

      return blob;
    }

    const reader =
      response.body
        .getReader();

    const chunks = [];
    let total = 0;

    try {
      while (true) {
        throwIfActionAborted(
          signal
        );

        const {
          done,
          value
        } =
          await reader.read();

        if (done) break;

        if (!value?.byteLength) {
          continue;
        }

        total +=
          value.byteLength;

        if (
          total >
          maxBytes
        ) {
          try {
            await reader.cancel(
              "download-too-large"
            );
          } catch {}

          throw new Error(
            "The download exceeded this device's safe image limit."
          );
        }

        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    throwIfActionAborted(
      signal
    );

    return new Blob(
      chunks,
      {
        type:
          response.headers.get(
            "content-type"
          ) ||
          "application/octet-stream"
      }
    );
  }

  async function downloadableMeshPath(
    path,
    classification,
    signal = null
  ) {
    if (
      classification?.kind !==
        "blueprint-visual"
    ) {
      return path;
    }

    const visual =
      await window
        .NovaSparxAssociations
        ?.resolveVisual?.(
          path,
          null,
          {
            signal
          }
        );

    throwIfActionAborted(
      signal
    );

    return (
      visual?.visualPath ||
      path
    );
  }

  async function downloadableTexturePath(
    path,
    classification,
    signal = null
  ) {
    if (
      classification?.kind ===
        "texture"
    ) {
      return path;
    }

    const visual =
      await window
        .NovaSparxAssociations
        ?.resolveVisual?.(
          path,
          null,
          {
            signal
          }
        );

    throwIfActionAborted(
      signal
    );

    return (
      visual?.previewImagePath ||
      (
        visual?.sourceFamily ===
          "texture"
          ? visual.visualPath
          : ""
      )
    );
  }

  async function downloadAssetFormat(
    path,
    format,
    classification,
    signal = null
  ) {
    throwIfActionAborted(
      signal
    );
    if (format === "glb") {
      const result =
        await window
          .NovaSparxExporter
          ?.exportGlb?.(
            path,
            {
              classification,
              signal
            }
          );

      throwIfActionAborted(
        signal
      );

      if (
        !result?.blob ||
        !result?.filename
      ) {
        throw new Error(
          "GLB export is unavailable for this asset."
        );
      }

      saveBlob(
        result.blob,
        result.filename
      );

      return;
    }

    if (format === "obj") {
      const result =
        await window
          .NovaSparxExporter
          ?.exportObj?.(
            path,
            {
              classification,
              signal
            }
          );

      throwIfActionAborted(
        signal
      );

      if (
        !result?.blob ||
        !result?.filename
      ) {
        throw new Error(
          "OBJ export is unavailable for this asset."
        );
      }

      saveBlob(
        result.blob,
        result.filename
      );

      return;
    }

    if (format === "json") {
      const payload =
        await exportJson(
          path,
          {
            signal
          }
        );

      throwIfActionAborted(
        signal
      );

      const text =
        JSON.stringify(
          payload,
          null,
          2
        );

      saveBlob(
        new Blob(
          [text],
          {
            type:
              "application/json;charset=utf-8"
          }
        ),
        safeAssetFilename(
          path,
          "json"
        )
      );

      return;
    }

    if (format === "png") {
      const texturePath =
        await downloadableTexturePath(
          path,
          classification,
          signal
        );

      if (!texturePath) {
        throw new Error(
          "No verified texture is available for this asset."
        );
      }

      const urls = [];

      if (API_ENDPOINT) {
        try {
          const direct =
            new URL(
              API_ENDPOINT +
              "/image"
            );

          direct.searchParams.set(
            "path",
            texturePath
          );

          direct.searchParams.set(
            "direct",
            "1"
          );

          urls.push(
            direct.toString()
          );
        } catch {}
      }

      const backendUrl =
        window.NovaSparx
          ?.textureUrl?.(
            texturePath
          );

      if (
        backendUrl &&
        !urls.includes(
          backendUrl
        )
      ) {
        urls.push(
          backendUrl
        );
      }

      if (!urls.length) {
        throw new Error(
          "Texture download is unavailable."
        );
      }

      let response = null;

      for (
        const url of urls
      ) {
        throwIfActionAborted(
          signal
        );

        const candidate =
          await fetchWithTimeout(
            url,
            {
              cache:
                "force-cache",
              headers: {
                Accept:
                  "image/png,image/*;q=0.8"
              },
              signal:
                signal ||
                undefined
            },
            16_000
          );

        if (
          candidate.ok &&
          String(
            candidate.headers.get(
              "content-type"
            ) || ""
          )
            .toLowerCase()
            .startsWith(
              "image/"
            )
        ) {
          response =
            candidate;
          break;
        }

        try {
          await candidate.body
            ?.cancel();
        } catch {}
      }

      if (!response) {
        throw new Error(
          "No verified texture image was available to download."
        );
      }

      const blob =
        await responseBlobBounded(
          response,
          MAX_DOWNLOAD_IMAGE_BYTES,
          signal
        );

      throwIfActionAborted(
        signal
      );

      saveBlob(
        blob,
        safeAssetFilename(
          texturePath,
          "png"
        )
      );

      return;
    }

    if (format === "nsmesh") {
      const meshPath =
        await downloadableMeshPath(
          path,
          classification,
          signal
        );

      const buffer =
        await window.NovaSparx
          ?.clientMeshBuffer?.(
            meshPath,
            {
              signal
            }
          );

      throwIfActionAborted(
        signal
      );

      if (
        !(buffer instanceof
          ArrayBuffer)
      ) {
        throw new Error(
          "NovaSparx mesh package is unavailable."
        );
      }

      saveBlob(
        new Blob(
          [buffer],
          {
            type:
              "application/vnd.novasparx.mesh-v1"
          }
        ),
        safeAssetFilename(
          meshPath,
          "nsmesh"
        )
      );

      return;
    }

    throw new Error(
      "That download format is not supported yet."
    );
  }

  function pathCard(
    item,
    formatted,
    addClass
  ) {
    const rawPath =
      String(item?.path || "").trim();

    const classCompatible =
      isClassCompatibleAsset(rawPath);

    const displayPath =
      formatted
        ? formatAssetPath(
            rawPath,
            addClass &&
            classCompatible
          )
        : (
            addClass &&
            classCompatible
              ? addClassSuffix(rawPath)
              : rawPath
          );

    const source =
      String(item?.source || "assets");

    const match =
      String(item?.match || "result");

    const classNote =
      addClass &&
      !classCompatible
        ? `<div class="tool-note asset-class-note">_C skipped: this asset does not look class-compatible.</div>`
        : "";

    return `
      <article
        class="tool-card asset-result-card"
        data-asset-path="${escapeAttr(rawPath)}"
      >
        <div class="tool-card-head">
          <div style="min-width:0;flex:1">
            <div class="tool-card-title">
              ${escapeHtml(assetTitle(rawPath))}
            </div>

            <div class="asset-result-tags" data-asset-tags>
              <span>${escapeHtml(match)}</span>
              <span>${escapeHtml(source)}</span>
            </div>
          </div>
        </div>

        ${pathRow("PATH", displayPath)}
        ${classNote}

        <div class="asset-result-actions">
          <button
            class="json-view-button"
            type="button"
            data-asset-action="describe"
          >${escapeHtml(t("description", "Description"))}</button>

          <button
            class="json-view-button"
            type="button"
            data-asset-action="preview"
            disabled
          >${escapeHtml(t("viewPreview", "View Preview"))}</button>

          <button
            class="json-view-button"
            type="button"
            data-asset-action="uefn"
            disabled
          >${escapeHtml(t("exportUEFN", "Export to UEFN"))}</button>

          <button
            class="json-view-button"
            type="button"
            data-asset-action="json"
          >${escapeHtml(t("viewJson", "View JSON"))}</button>

          <button
            class="json-view-button"
            type="button"
            data-asset-action="references"
          >${escapeHtml(t("viewReferences", "View References"))}</button>

          <button
            class="json-view-button"
            type="button"
            data-asset-action="download"
          >${escapeHtml(t("download", "Download"))}</button>
        </div>

        <div
          class="asset-inline-panel"
          data-asset-panel
          hidden
        ></div>
      </article>`;
  }

  function bindAssetResultActions(root) {
    bindCopyButtons(root);

    // Search redraws reuse the same results container. Bind this delegated
    // handler only once, otherwise one tap can open and immediately close
    // the same preview panel.
    if (root.dataset.assetActionsBound === "1") {
      return;
    }

    root.dataset.assetActionsBound = "1";

    root.addEventListener(
      "click",
      async (event) => {
        const button =
          event.target.closest(
            "[data-asset-action]"
          );

        if (!button) return;

        const card =
          button.closest(
            ".asset-result-card"
          );

        if (!card) return;

        const path =
          card.dataset.assetPath || "";

        const action =
          button.dataset.assetAction;

        window.NovaSparxBrowserGuard
          ?.abortActive?.(
            "replaced-by-new-asset-action"
          );

        if (action === "describe") {
          await describePath(
            path,
            button
          );
          return;
        }

        const panelRequest =
          beginPanelRequest(
            card,
            button,
            action
          );

        if (
          panelRequest.state ===
          "hidden"
        ) {
          return;
        }

        const usesGuestSlowmode =
          action === "preview" ||
          action === "references" ||
          action === "download" ||
          action === "uefn";

        const remaining =
          usesGuestSlowmode
            ? guestActionRemaining()
            : 0;

        if (remaining > 0) {
          cancelPanelRequest(
            card,
            button
          );

          flashActionCooldown(
            button,
            remaining
          );

          return;
        }

        if (usesGuestSlowmode) {
          window.FortniteAgent
            ?.beginGuestToolSlowmode?.();
        }

        if (action === "preview") {
          await previewPath(
            card,
            path,
            panelRequest.id
          );
          return;
        }

        const guard =
          window.NovaSparxBrowserGuard;

        const operation =
          guard?.beginOperation?.(
            `asset:${action}:${path}`
          ) ||
          null;

        const signal =
          operation?.signal ||
          null;

        try {
          if (action === "uefn") {
            await showUefnExport(
              card,
              path,
              panelRequest.id,
              signal
            );
            return;
          }

          if (action === "json") {
            await showJson(
              card,
              path,
              panelRequest.id,
              signal
            );
            return;
          }

          if (action === "references") {
            await showReferences(
              card,
              path,
              panelRequest.id,
              signal
            );
            return;
          }

          if (action === "download") {
            await showDownload(
              card,
              path,
              panelRequest.id,
              signal
            );
          }
        } finally {
          guard?.endOperation?.(
            operation
          );
        }
      }
    );
  }

  function panelLabels(action) {
    const labels = {
      preview: [
        t("viewPreview", "View Preview"),
        t("hidePreview", "Hide Preview")
      ],

      uefn: [
        t("exportUEFN", "Export to UEFN"),
        t("hideUEFNExport", "Hide UEFN Export")
      ],

      json: [
        t("viewJson", "View JSON"),
        t("hideJson", "Hide JSON")
      ],

      references: [
        t("viewReferences", "View References"),
        t("hideReferences", "Hide References")
      ],

      download: [
        t("download", "Download"),
        t("hideDownloads", "Hide Downloads")
      ]
    };

    return labels[action] || [
      action,
      action
    ];
  }

  function resetPanelButtons(
    card,
    except = null
  ) {
    for (
      const item of
      card.querySelectorAll(
        "[data-asset-action]"
      )
    ) {
      const action =
        item.dataset.assetAction;

      if (
        action === "describe" ||
        item === except
      ) {
        continue;
      }

      item.textContent =
        item.dataset.closedLabel ||
        panelLabels(action)[0];

      delete item.dataset.fnaaOpen;
    }
  }

  function beginPanelRequest(
    card,
    button,
    action
  ) {
    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    const current =
      card.dataset.openAction ||
      "";

    const nextId =
      Number(
        card.dataset.panelRequestId ||
        0
      ) + 1;

    card.dataset.panelRequestId =
      String(nextId);

    if (
      current === action &&
      panel &&
      !panel.hidden
    ) {
      window.NovaSparxBrowserGuard
        ?.abortActive?.(
          "asset-panel-closed"
        );

      panel.hidden = true;
      panel.replaceChildren();

      delete card.dataset.openAction;

      resetPanelButtons(card);

      if (action === "preview") {
        window.FortnitePreview
          ?.release?.(
            card.dataset.assetPath ||
            ""
          );
      }

      return {
        state: "hidden",
        id: nextId
      };
    }

    if (
      current === "preview" &&
      action !== "preview"
    ) {
      window.FortnitePreview
        ?.release?.(
          card.dataset.assetPath ||
          ""
        );
    }

    card.dataset.openAction =
      action;

    resetPanelButtons(
      card,
      button
    );

    button.textContent =
      button.dataset.openLabel ||
      panelLabels(action)[1];

    button.dataset.fnaaOpen =
      "1";

    if (panel) {
      panel.hidden = false;
    }

    return {
      state: "open",
      id: nextId
    };
  }

  function cancelPanelRequest(
    card,
    button
  ) {
    if (
      card.dataset.openAction ===
        "preview"
    ) {
      window.FortnitePreview
        ?.release?.(
          card.dataset.assetPath ||
          ""
        );
    }

    window.NovaSparxBrowserGuard
      ?.abortActive?.(
        "asset-panel-cancelled"
      );

    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    if (panel) {
      panel.hidden = true;
      panel.replaceChildren();
    }

    delete card.dataset.openAction;
    resetPanelButtons(card);

    if (button) {
      button.textContent =
        button.dataset.closedLabel ||
        panelLabels(
          button.dataset.assetAction
        )[0];
    }
  }

  function panelRequestIsCurrent(
    card,
    action,
    requestId
  ) {
    return (
      Number(
        card.dataset.panelRequestId ||
        0
      ) === requestId &&
      card.dataset.openAction ===
        action
    );
  }

  function guestActionRemaining() {
    if (
      window.FortniteAgent
        ?.isSignedIn?.()
    ) {
      return 0;
    }

    return Number(
      window.FortniteAgent
        ?.getGuestSlowmodeRemainingSeconds
        ?.() || 0
    );
  }

  async function describePath(
    path,
    button
  ) {
    const remaining =
      guestActionRemaining();

    if (remaining > 0) {
      flashActionCooldown(
        button,
        remaining
      );

      return;
    }

    if (
      button?.dataset
        .descriptionBusy === "1"
    ) {
      return;
    }

    if (button) {
      button.dataset.descriptionBusy =
        "1";

      button.disabled = true;
    }

    try {
      if (
        window.FortniteAgent
          ?.describePath
      ) {
        const result =
          await window.FortniteAgent
            .describePath(path);

        // The shared guest deadline can start in another tab between the
        // first check and the actual send.
        if (
          result?.blocked &&
          result.retryAfterSeconds > 0
        ) {
          if (button) {
            delete button.dataset
              .descriptionBusy;
          }

          flashActionCooldown(
            button,
            result.retryAfterSeconds
          );

          return;
        }

        close();
        return;
      }

      close();

      window.dispatchEvent(
        new CustomEvent(
          "fnaa-describe-path",
          {
            detail: { path }
          }
        )
      );
    } finally {
      if (
        button?.dataset
          .descriptionBusy === "1"
      ) {
        delete button.dataset
          .descriptionBusy;

        button.disabled = false;
      }
    }
  }

  function flashActionCooldown(
    button,
    seconds
  ) {
    if (!button) return;

    const safeSeconds =
      Math.max(
        1,
        Math.ceil(
          Number(seconds) || 0
        )
      );

    clearTimeout(
      Number(
      button.dataset
          .actionCooldownTimer || 0
      )
    );

    button.dataset
      .actionOriginalText =
      button.dataset
        .actionOriginalText ||
      button.textContent ||
      "Description";

    button.textContent =
      `SlowMode ${safeSeconds}..`;

    button.classList.add(
      "description-cooldown"
    );

    button.disabled = true;

    const timer =
      setTimeout(
        () => {
          button.disabled = false;

          button.classList.remove(
            "description-cooldown"
          );

          button.textContent =
            button.dataset
              .actionOriginalText ||
            "Description";

          delete button.dataset
            .actionCooldownTimer;
        },
        ACTION_FLASH_MS
      );

    button.dataset
      .actionCooldownTimer =
      String(timer);
  }

  async function previewPath(
    card,
    path,
    requestId
  ) {
    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    panel.hidden = false;

    panel.innerHTML =
      '<div class="tool-empty">Loading preview...</div>';

    try {
      if (
        window.FortnitePreview
          ?.toggle
      ) {
        panel.innerHTML =
          '<div class="preview-host" data-preview-host></div>';

        const host =
          panel.querySelector(
            "[data-preview-host]"
          );

        await window.FortnitePreview
          .toggle(
            host,
            path,
            null,
            {
              assetKind:
                card.dataset
                  .assetKind ||
                ""
            }
          );

        if (
          !panelRequestIsCurrent(
            card,
            "preview",
            requestId
          )
        ) {
          window.FortnitePreview
            ?.release?.(
              path
            );

          panel.hidden = true;
          panel.replaceChildren();
        }

        return;
      }

      panel.innerHTML =
        '<div class="tool-empty">Preview module is not loaded yet.</div>';
    } catch (error) {
      if (
        !panelRequestIsCurrent(
          card,
          "preview",
          requestId
        )
      ) {
        return;
      }

      panel.innerHTML = `
        <div class="tool-empty">
          ${escapeHtml(
            error?.message ||
            "Preview failed."
          )}
        </div>`;
    }
  }

  async function showUefnExport(
    card,
    path,
    requestId,
    signal = null
  ) {
    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    panel.hidden = false;

    panel.innerHTML =
      '<div class="tool-empty">Preparing UEFN-ready export...</div>';

    try {
      const classification =
        await classifyAsset(
          path,
          {
            signal
          }
        );

      throwIfActionAborted(
        signal
      );

      if (
        !panelRequestIsCurrent(
          card,
          "uefn",
          requestId
        )
      ) {
        return;
      }

      const exporter =
        window.NovaSparxExporter;

      if (
        !exporter?.supports?.(
          classification
        )
      ) {
        throw new Error(
          classification?.kind ===
            "skeletalmesh"
            ? "Skeletal UEFN export is not enabled until bones and skin weights are preserved."
            : "UEFN-ready export is not available for this asset type yet."
        );
      }

      panel.innerHTML =
        '<div class="tool-empty">Building UEFN-ready file on this device...</div>';

      const result =
        await exporter.exportUEFN(
          path,
          classification,
          {
            signal
          }
        );

      throwIfActionAborted(
        signal
      );

      if (
        !panelRequestIsCurrent(
          card,
          "uefn",
          requestId
        )
      ) {
        return;
      }

      if (
        !result?.blob ||
        !result?.filename
      ) {
        throw new Error(
          "NovaSparx exporter returned an invalid file."
        );
      }

      saveBlob(
        result.blob,
        result.filename
      );

      const warnings =
        Array.isArray(
          result.warnings
        )
          ? result.warnings
              .filter(Boolean)
              .slice(0, 3)
          : [];

      panel.innerHTML = `
        <div class="json-panel asset-download-panel">
          <div class="json-panel-head">
            <span>UEFN READY</span>
            <span class="tool-note">
              ${escapeHtml(result.filename)}
            </span>
          </div>

          <div class="tool-note">
            ${warnings.length
              ? escapeHtml(warnings.join(" "))
              : "File prepared successfully for UEFN import."}
          </div>

          <div class="asset-download-options">
            <button
              class="json-view-button"
              type="button"
              data-save-uefn
            >Save Again</button>
          </div>
        </div>`;

      panel
        .querySelector(
          "[data-save-uefn]"
        )
        ?.addEventListener(
          "click",
          () =>
            saveBlob(
              result.blob,
              result.filename
            )
        );
    } catch (error) {
      if (
        actionAborted(
          error,
          signal
        ) ||
        !panelRequestIsCurrent(
          card,
          "uefn",
          requestId
        )
      ) {
        return;
      }

      panel.innerHTML = `
        <div class="tool-empty">
          ${escapeHtml(
            error?.message ||
            "UEFN export failed."
          )}
        </div>`;
    }
  }

  async function showDownload(
    card,
    path,
    requestId,
    signal = null
  ) {
    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    panel.hidden = false;
    panel.innerHTML =
      '<div class="tool-empty">Preparing downloads...</div>';

    try {
      const classification =
        await classifyAsset(
          path,
          {
            signal
          }
        );

      throwIfActionAborted(
        signal
      );

      if (
        !panelRequestIsCurrent(
          card,
          "download",
          requestId
        )
      ) {
        return;
      }

      const formats =
        Array.isArray(
          classification
            ?.capabilities
            ?.downloadFormats
        )
          ? classification
              .capabilities
              .downloadFormats
          : ["json"];

      const allowed =
        formats.filter(
          (format) =>
            [
              "json",
              "png",
              "nsmesh",
              "glb",
              "obj"
            ].includes(format)
        );

      const exporter =
        window.NovaSparxExporter;

      const meshRuntimeReady =
        browserMeshParserReady();

      if (!meshRuntimeReady) {
        for (
          let index =
            allowed.length - 1;
          index >= 0;
          index--
        ) {
          if (
            [
              "glb",
              "obj",
              "nsmesh"
            ].includes(
              allowed[index]
            )
          ) {
            allowed.splice(
              index,
              1
            );
          }
        }
      }

      const exporterSupported =
        Boolean(
          exporter
            ?.supports?.(
              classification
            )
        );

      for (
        let index =
          allowed.length - 1;
        index >= 0;
        index--
      ) {
        if (
          [
            "glb",
            "obj"
          ].includes(
            allowed[index]
          ) &&
          !exporterSupported
        ) {
          allowed.splice(
            index,
            1
          );
        }
      }

      if (
        exporterSupported &&
        meshRuntimeReady &&
        [
          "staticmesh",
          "blueprint-visual"
        ].includes(
          String(
            classification?.kind ||
            ""
          )
        )
      ) {
        if (
          typeof exporter
            ?.exportObj ===
            "function"
        ) {
          allowed.unshift(
            "obj"
          );
        }

        if (
          typeof exporter
            ?.exportGlb ===
            "function"
        ) {
          allowed.unshift(
            "glb"
          );
        }
      }

      const uniqueAllowed =
        [
          ...new Set(
            allowed
          )
        ];

      if (!uniqueAllowed.length) {
        uniqueAllowed.push("json");
      }

      const labels = {
        glb:
          "GLB",
        obj:
          "OBJ",
        json:
          "JSON",
        png:
          "PNG",
        nsmesh:
          "NovaSparx Mesh"
      };

      panel.innerHTML = `
        <div class="json-panel asset-download-panel">
          <div class="json-panel-head">
            <span>DOWNLOAD</span>
            <span class="tool-note">
              Choose a format
            </span>
          </div>

          <div class="asset-download-options">
            ${uniqueAllowed
              .map(
                (format) => `
                  <button
                    class="json-view-button"
                    type="button"
                    data-download-format="${escapeAttr(format)}"
                  >${escapeHtml(labels[format] || format.toUpperCase())}</button>`
              )
              .join("")}
          </div>

          <div
            class="tool-note"
            data-download-status
          ></div>
        </div>`;

      const status =
        panel.querySelector(
          "[data-download-status]"
        );

      for (
        const button of
        panel.querySelectorAll(
          "[data-download-format]"
        )
      ) {
        button.addEventListener(
          "click",
          async () => {
            if (button.disabled) {
              return;
            }

            const format =
              button.dataset
                .downloadFormat ||
              "";

            button.disabled = true;

            if (status) {
              status.textContent =
                `Preparing ${format.toUpperCase()}…`;
            }

            const guard =
              window.NovaSparxBrowserGuard;

            const operation =
              guard?.beginOperation?.(
                `download:${format}:${path}`
              ) ||
              null;

            const formatSignal =
              operation?.signal ||
              null;

            try {
              await downloadAssetFormat(
                path,
                format,
                classification,
                formatSignal
              );

              throwIfActionAborted(
                formatSignal
              );

              if (status) {
                status.textContent =
                  "Download ready.";
              }
            } catch (error) {
              if (
                !actionAborted(
                  error,
                  formatSignal
                ) &&
                status
              ) {
                status.textContent =
                  error?.message ||
                  "Download failed.";
              }
            } finally {
              guard?.endOperation?.(
                operation
              );

              button.disabled =
                false;
            }
          }
        );
      }
    } catch (error) {
      if (
        actionAborted(
          error,
          signal
        ) ||
        !panelRequestIsCurrent(
          card,
          "download",
          requestId
        )
      ) {
        return;
      }

      panel.innerHTML = `
        <div class="tool-empty">
          ${escapeHtml(
            error?.message ||
            "Downloads are unavailable."
          )}
        </div>`;
    }
  }

  async function showJson(
    card,
    path,
    requestId,
    signal = null
  ) {
    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    panel.hidden = false;
    panel.innerHTML =
      '<div class="tool-empty">Loading JSON...</div>';

    try {
      const data =
        await exportJson(
          path,
          {
            signal
          }
        );

      throwIfActionAborted(
        signal
      );

      const text =
        JSON.stringify(
          data,
          null,
          2
        );

      if (
        !panelRequestIsCurrent(
          card,
          "json",
          requestId
        )
      ) {
        return;
      }

      panel.innerHTML = `
        <div class="json-panel asset-json-panel">
          <div class="json-panel-head">
            <span>JSON</span>
            <button
              class="json-view-button"
              type="button"
              data-copy-json
            >Copy JSON</button>
          </div>

          <pre><code>${escapeHtml(text)}</code></pre>
        </div>`;

      panel
        .querySelector("[data-copy-json]")
        .addEventListener(
          "click",
          () => copy(text)
        );
    } catch (error) {
      if (
        actionAborted(
          error,
          signal
        ) ||
        !panelRequestIsCurrent(
          card,
          "json",
          requestId
        )
      ) {
        return;
      }

      panel.innerHTML = `
        <div class="tool-empty">
          ${escapeHtml(
            error?.message ||
            "JSON unavailable."
          )}
        </div>`;
    }
  }

  async function showReferences(
    card,
    path,
    requestId,
    signal = null
  ) {
    const panel =
      card.querySelector(
        "[data-asset-panel]"
      );

    panel.hidden = false;
    panel.innerHTML =
      '<div class="tool-empty">Resolving references...</div>';

    try {
      let payload = null;

      // Dilly is the lightweight public layer for references. Resolve it
      // before waking NovaSparx so an expired backend credential can never
      // leak an "Unauthorized" transport error into this panel.
      try {
        const references =
          extractJsonReferences(
            await exportJson(
              path,
              {
                signal
              }
            ),
            path
          );

        throwIfActionAborted(
          signal
        );

        if (references.length) {
          payload = {
            state: "ready",
            source: "dilly-json",
            references
          };
        }
      } catch (error) {
        if (
          actionAborted(
            error,
            signal
          )
        ) {
          throw actionAbortError(
            signal
          );
        }

        // Continue to NovaSparx. Backend errors remain internal fallbacks.
      }

      if (
        !payload &&
        window.NovaSparx
          ?.inspect
      ) {
        try {
          const inspection =
            await window.NovaSparx
              .inspect(
                path,
                {
                  signal
                }
              );

          throwIfActionAborted(
            signal
          );

          const verified = await classifyAsset(path, { inspection, signal });
          applyAssetClassification(card, verified);

          if (
            Array.isArray(
              inspection?.references
            ) &&
            inspection.references.length
          ) {
            payload = {
              state: "ready",
              references:
                inspection.references
            };
          }
        } catch (error) {
          if (
            actionAborted(
              error,
              signal
            )
          ) {
            throw actionAbortError(
              signal
            );
          }

          // Continue to the edge endpoint and Dilly JSON fallback.
        }
      }

      if (!payload) {
        try {
          payload =
            await apiJson(
              "/nova/references",
              path,
              {
                signal
              }
            );

          throwIfActionAborted(
            signal
          );
        } catch (error) {
          if (
            actionAborted(
              error,
              signal
            )
          ) {
            throw actionAbortError(
              signal
            );
          }

          // NovaSparx may be cold/offline. Dilly JSON can still provide
          // deterministic object references for many lightweight assets.
        }
      }

      throwIfActionAborted(
        signal
      );

      if (
        !payload ||
        !Array.isArray(
          payload.references
        ) ||
        !payload.references.length
      ) {
        payload = {
          state: "missing",
          references: []
        };
      }

      if (
        !panelRequestIsCurrent(
          card,
          "references",
          requestId
        )
      ) {
        return;
      }

      const refs =
        Array.isArray(payload?.references)
          ? payload.references
          : [];

      if (!refs.length) {
        panel.innerHTML =
          '<div class="tool-empty">No verified references were returned.</div>';

        return;
      }

      panel.innerHTML = `
        <div class="reference-list">
          ${refs
            .slice(0, 200)
            .map((ref) => {
              const value =
                typeof ref === "string"
                  ? ref
                  : ref?.path || "";

              const kind =
                typeof ref === "object"
                  ? ref?.kind || "reference"
                  : "reference";

              return `
                <div class="reference-row">
                  <span class="device-field-tag">
                    ${escapeHtml(kind)}
                  </span>

                  <code>${escapeHtml(value)}</code>

                  <button
                    class="path-copy"
                    type="button"
                    data-copy="${escapeAttr(value)}"
                  >COPY</button>
                </div>`;
            })
            .join("")}
        </div>`;

      bindCopyButtons(panel);
    } catch (error) {
      if (
        actionAborted(
          error,
          signal
        ) ||
        !panelRequestIsCurrent(
          card,
          "references",
          requestId
        )
      ) {
        return;
      }

      panel.innerHTML = `
        <div class="tool-empty">
          ${escapeHtml(
            error?.message ||
            "References unavailable."
          )}
        </div>`;
    }
  }

  function extractJsonReferences(
    data,
    sourcePath = ""
  ) {
    const output = [];
    const seen = new Set();
    const sourceKey =
      normalizeAssetLookupKey(
        sourcePath
      );

    const add = (
      value,
      kind = "reference"
    ) => {
      if (
        typeof value !==
        "string"
      ) {
        return;
      }

      const match =
        value.trim().match(
          /(?:[A-Za-z][A-Za-z0-9_]+)?['\"]?((?:\/|FortniteGame\/|Engine\/)[^'\"\s]+)['\"]?/i
        );

      const path =
        match?.[1]
          ?.replace(/[),;]+$/, "") ||
        "";

      if (!path) return;

      const key =
        normalizeAssetLookupKey(path);

      if (
        !key ||
        key === sourceKey ||
        seen.has(key)
      ) {
        return;
      }

      seen.add(key);

      output.push({
        kind:
          String(kind || "reference")
            .slice(0, 40),
        path
      });
    };

    const scan = (
      value,
      key = "reference",
      depth = 0
    ) => {
      if (
        value === null ||
        value === undefined ||
        depth > 9 ||
        output.length >= 200
      ) {
        return;
      }

      if (
        typeof value ===
        "string"
      ) {
        add(value, key);
        return;
      }

      if (Array.isArray(value)) {
        for (
          const item of
          value.slice(0, 250)
        ) {
          scan(
            item,
            key,
            depth + 1
          );

          if (
            output.length >= 200
          ) {
            break;
          }
        }

        return;
      }

      if (
        typeof value ===
        "object"
      ) {
        let count = 0;

        for (
          const [childKey, child] of
          Object.entries(value)
        ) {
          if (count++ >= 250) {
            break;
          }

          scan(
            child,
            childKey,
            depth + 1
          );

          if (
            output.length >= 200
          ) {
            break;
          }
        }
      }
    };

    scan(data);

    return output;
  }

  function smartSearchScope(
    selectedScope,
    query
  ) {
    if (selectedScope !== "all") {
      return selectedScope;
    }

    const value =
      String(query || "")
        .trim()
        .toLowerCase();

    if (
      /(^|[\/._-])sm_/.test(value)
    ) {
      return "sm";
    }

    if (
      /(^|[\/._-])(m_|mi_)/.test(value)
    ) {
      return "m";
    }

    return "all";
  }

  function routeScope() {
    const value =
      new URL(location.href)
        .searchParams
        .get("scope");

    return [
      "all",
      "sm",
      "m",
      "new"
    ].includes(value)
      ? value
      : null;
  }

  function updateManualSearchRoute(
    query,
    scope
  ) {
    if (
      !window.FortniteAgent
        ?.navigate
    ) {
      return;
    }

    const route =
      CONFIG.routes?.paths ||
      "/ManualSearch/Paths";

    const params =
      new URLSearchParams();

    if (query) {
      params.set("q", query);
    }

    if (scope && scope !== "all") {
      params.set("scope", scope);
    }

    window.FortniteAgent.navigate(
      `${route}${params.size ? `?${params}` : ""}`,
      { replace: true }
    );
  }

  // ---------------------------------------------------------------------------
  // IDs
  // ---------------------------------------------------------------------------

  async function loadStaticCatalogs() {
    if (
      idData &&
      deviceData &&
      islandRows &&
      deviceRows
    ) {
      return {
        islands: islandRows,
        devices: deviceRows
      };
    }

    if (staticCatalogPromise) {
      return staticCatalogPromise;
    }

    staticCatalogPromise =
      (async () => {
        const [ids, devices] =
          await Promise.all([
            idData ||
              fetchJson(
                DB.ids ||
                "database/id.json",
                STATIC_DATA_TIMEOUT_MS
              ),

            deviceData ||
              fetchJson(
                DB.devices ||
                "database/devicemeshs.json",
                STATIC_DATA_TIMEOUT_MS
              )
          ]);

        idData = ids;
        deviceData = devices;

        const islands = [];

        walkIdData(
          idData,
          islands
        );

        islandRows = islands;

        deviceRows =
          sortDevices(
            cleanDeviceList(
              normalizeDeviceData(
                deviceData
              )
            )
          );

        rebuildKnownImageIndex();

        return {
          islands: islandRows,
          devices: deviceRows
        };
      })();

    try {
      return await staticCatalogPromise;
    } catch (error) {
      staticCatalogPromise = null;
      throw error;
    }
  }

  function rebuildKnownImageIndex() {
    knownImageByPath.clear();

    const indexObject =
      (value) => {
        if (
          !value ||
          typeof value !== "object"
        ) {
          return;
        }

        if (!Array.isArray(value)) {
          const image =
            resolveCatalogImageUrl(
              value.image
            );

          if (image) {
            for (const field of [
              "path",
              "playset",
              "plot",
              "id"
            ]) {
              addKnownImage(
                value[field],
                image
              );
            }
          }
        }

        for (
          const child of
          Array.isArray(value)
            ? value
            : Object.values(value)
        ) {
          indexObject(child);
        }
      };

    indexObject(idData);
    indexObject(deviceData);
  }

  function addKnownImage(
    rawPath,
    image
  ) {
    for (
      const key of
      assetLookupKeys(rawPath)
    ) {
      if (
        !knownImageByPath.has(key)
      ) {
        knownImageByPath.set(
          key,
          image
        );
      }
    }
  }

  async function findKnownImage(
    rawPath
  ) {
    try {
      // These catalogues are small and provide the actual verified image for
      // IDs/devices. Do not let a slow mobile connection time out this layer
      // and fall through to the heavyweight renderer unnecessarily.
      await loadStaticCatalogs();
    } catch {
      return "";
    }

    for (
      const key of
      assetLookupKeys(rawPath)
    ) {
      const image =
        knownImageByPath.get(key);

      if (image) return image;
    }

    return "";
  }

  async function renderIds(
    generation
  ) {
    const {
      islands,
      devices
    } =
      await loadStaticCatalogs();

    if (
      generation !==
      renderGeneration
    ) {
      return;
    }

    let showUnavailable = false;
    let idsShown = CATALOG_PAGE;
    let devicesShown = CATALOG_PAGE;

    content.innerHTML = `
      <div class="tool-section ids-combined-section">
        <section class="ids-group">
          <div class="ids-group-head">
            <div>
              <h2>Islands</h2>
              <p class="tool-note">
                Creative islands, playsets and plot IDs.
              </p>
            </div>
          </div>

          <div class="tool-searchbar">
            <input
              id="idSearch"
              placeholder="${escapeAttr(
                t(
                  "searchIslands",
                  "Search islands / IDs"
                )
              )}"
            />
          </div>

          <div id="idResults"></div>

          <div class="tool-actions">
            <button
              id="idLoadMore"
              class="tool-button"
              type="button"
              hidden
            >${escapeHtml(t("loadMore", "Load more"))}</button>
          </div>
        </section>

        <div class="ids-section-divider"></div>

        <section class="ids-group">
          <div class="ids-group-head">
            <div>
              <h2>${escapeHtml(
                t(
                  "deviceMeshes",
                  "Device Meshes"
                )
              )}</h2>
            </div>

            <button
              id="showAllDevices"
              class="tool-button"
              type="button"
            >Show All</button>
          </div>

          <div class="tool-searchbar">
            <input
              id="deviceSearchInIds"
              placeholder="${escapeAttr(
                t(
                  "searchDevice",
                  "Search device..."
                )
              )}"
            />
          </div>

          <div id="deviceResultsInIds"></div>

          <div class="tool-actions">
            <button
              id="deviceLoadMoreInIds"
              class="tool-button"
              type="button"
              hidden
            >${escapeHtml(t("loadMore", "Load more"))}</button>
          </div>
        </section>
      </div>`;

    const idInput =
      content.querySelector("#idSearch");

    const idResults =
      content.querySelector("#idResults");

    const deviceInput =
      content.querySelector(
        "#deviceSearchInIds"
      );

    const deviceResults =
      content.querySelector(
        "#deviceResultsInIds"
      );

    const showButton =
      content.querySelector(
        "#showAllDevices"
      );

    const idMore =
      content.querySelector(
        "#idLoadMore"
      );

    const deviceMore =
      content.querySelector(
        "#deviceLoadMoreInIds"
      );

    const drawIds = (
      reset = true
    ) => {
      if (reset) {
        idsShown = CATALOG_PAGE;
      }

      const query =
        idInput.value
          .trim()
          .toLowerCase();

      const filtered =
        !query
          ? islands
          : islands.filter(
              (item) =>
                JSON.stringify(item)
                  .toLowerCase()
                  .includes(query)
            );

      idResults.innerHTML =
        filtered
          .slice(0, idsShown)
          .map(idCard)
          .join("") ||
        '<div class="tool-empty">No results.</div>';

      bindCopyButtons(idResults);
      bindImageFallbacks(idResults);

      idMore.hidden =
        idsShown >= filtered.length;
    };

    const drawDevices = (
      reset = true
    ) => {
      if (reset) {
        devicesShown = CATALOG_PAGE;
      }

      const query =
        deviceInput.value
          .trim()
          .toLowerCase();

      const filtered =
        devices.filter((item) => {
          if (
            !showUnavailable &&
            item.dispo === false
          ) {
            return false;
          }

          if (!query) return true;

          return deviceSearchText(item)
            .includes(query);
        });

      deviceResults.innerHTML =
        filtered
          .slice(0, devicesShown)
          .map(deviceCardSimple)
          .join("") ||
        '<div class="tool-empty">No devices found.</div>';

      bindCopyButtons(deviceResults);
      bindImageFallbacks(deviceResults);

      deviceMore.hidden =
        devicesShown >= filtered.length;
    };

    idInput.addEventListener(
      "input",
      () => drawIds(true)
    );

    deviceInput.addEventListener(
      "input",
      () => drawDevices(true)
    );

    showButton.addEventListener(
      "click",
      () => {
        showUnavailable =
          !showUnavailable;

        showButton.textContent =
          showUnavailable
            ? "Hide Unavailable"
            : "Show All";

        drawDevices(true);
      }
    );

    idMore.addEventListener(
      "click",
      () => {
        idsShown += CATALOG_PAGE;
        drawIds(false);
      }
    );

    deviceMore.addEventListener(
      "click",
      () => {
        devicesShown +=
          CATALOG_PAGE;

        drawDevices(false);
      }
    );

    drawIds(true);
    drawDevices(true);
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  async function renderDevices(
    generation
  ) {
    const { devices } =
      await loadStaticCatalogs();

    if (
      generation !==
      renderGeneration
    ) {
      return;
    }

    let showUnavailable = false;
    let shown = DEVICE_DETAIL_PAGE;

    content.innerHTML = `
      <div class="tool-section">
        <div class="ids-group-head">
          <div>
            <h2>${escapeHtml(
              t(
                "deviceMeshes",
                "Device Meshes"
              )
            )}</h2>

            <p class="tool-note">
              Device paths, playsets and available option keys.
            </p>
          </div>

          <button
            id="showAllDevicesFull"
            class="tool-button"
            type="button"
          >Show All</button>
        </div>

        <div class="tool-searchbar">
          <input
            id="deviceSearch"
            placeholder="${escapeAttr(
              t(
                "searchDevice",
                "Search device..."
              )
            )}"
          />
        </div>

        <div id="deviceResults"></div>

        <div class="tool-actions">
          <button
            id="deviceLoadMore"
            class="tool-button"
            type="button"
            hidden
          >${escapeHtml(t("loadMore", "Load more"))}</button>
        </div>
      </div>`;

    const input =
      content.querySelector(
        "#deviceSearch"
      );

    const results =
      content.querySelector(
        "#deviceResults"
      );

    const showButton =
      content.querySelector(
        "#showAllDevicesFull"
      );

    const moreButton =
      content.querySelector(
        "#deviceLoadMore"
      );

    const draw = (
      reset = true
    ) => {
      if (reset) {
        shown = DEVICE_DETAIL_PAGE;
      }

      const query =
        input.value
          .trim()
          .toLowerCase();

      const filtered =
        devices.filter((item) => {
          if (
            !showUnavailable &&
            item.dispo === false
          ) {
            return false;
          }

          if (!query) return true;

          return deviceSearchText(item)
            .includes(query);
        });

      results.innerHTML =
        filtered
          .slice(0, shown)
          .map(deviceCard)
          .join("") ||
        '<div class="tool-empty">No devices found.</div>';

      bindCopyButtons(results);
      bindImageFallbacks(results);

      moreButton.hidden =
        shown >= filtered.length;
    };

    input.addEventListener(
      "input",
      () => draw(true)
    );

    showButton.addEventListener(
      "click",
      () => {
        showUnavailable =
          !showUnavailable;

        showButton.textContent =
          showUnavailable
            ? "Hide Unavailable"
            : "Show All";

        draw(true);
      }
    );

    moreButton.addEventListener(
      "click",
      () => {
        shown += DEVICE_DETAIL_PAGE;
        draw(false);
      }
    );

    draw(true);
  }

  function normalizeDeviceData(data) {
    if (Array.isArray(data)) {
      return data;
    }

    if (!data || typeof data !== "object") {
      return [];
    }

    for (const key of [
      "devices",
      "data",
      "items",
      "result"
    ]) {
      if (Array.isArray(data[key])) {
        return data[key];
      }
    }

    return Object.entries(data)
      .map(([key, value]) => {
        if (
          value &&
          typeof value === "object"
        ) {
          return {
            name:
              value.name ||
              value.title ||
              key,
            ...value
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  function cleanDeviceList(items) {
    return items.filter((item) => {
      const title =
        String(
          item?.name ||
          item?.title ||
          ""
        );

      return !isJunkDeviceText(
        title
      );
    });
  }

  function isJunkDeviceText(value) {
    const text =
      String(value || "")
        .toLowerCase();

    return (
      text.includes("discord.gg") ||
      text.includes("th3dry") ||
      text.includes("credits") ||
      text.includes("copyright")
    );
  }

  function cleanDeviceText(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return "";
    }

    if (
      typeof value === "object"
    ) {
      return JSON.stringify(value);
    }

    const text =
      String(value).trim();

    return isJunkDeviceText(text)
      ? ""
      : text;
  }

  function sortDevices(items) {
    return [...items].sort(
      (a, b) => {
        const aAvailable =
          a.dispo !== false;

        const bAvailable =
          b.dispo !== false;

        if (
          aAvailable !== bAvailable
        ) {
          return aAvailable
            ? -1
            : 1;
        }

        return String(
          a.name ||
          a.title ||
          ""
        ).localeCompare(
          String(
            b.name ||
            b.title ||
            ""
          ),
          undefined,
          {
            numeric: true,
            sensitivity: "base"
          }
        );
      }
    );
  }

  function deviceSearchText(item) {
    const settings =
      Object.entries(
        item.settings || {}
      )
        .map(
          ([name, data]) =>
            [
              name,
              data?.["option key"],
              data?.value
            ]
              .filter(Boolean)
              .join(" ")
        )
        .join(" ");

    return [
      item.name,
      item.title,
      cleanDeviceText(item.path),
      cleanDeviceText(item.playset),
      cleanDeviceText(item.important),
      ...(Array.isArray(item.tag)
        ? item.tag
        : []),
      settings
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function deviceCardSimple(item) {
    const title =
      item.name ||
      item.title ||
      item.device ||
      item.id ||
      "Device";

    const images =
      catalogImageCandidates(
        item
      );

    const path =
      cleanDeviceText(item.path);

    const playset =
      cleanDeviceText(item.playset);

    return `
      <article class="tool-card th3-device-card">
        <div class="tool-card-head th3-device-head">
          ${layeredImageMarkup(
            images,
            title,
            "device-image"
          )}

          <div style="min-width:0;flex:1">
            <div class="tool-card-title">
              ${escapeHtml(title)}
            </div>

            ${playset
              ? `<div class="tool-note">
                  ${escapeHtml(shortPath(playset))}
                </div>`
              : ""}
          </div>
        </div>

        ${path
          ? pathRow("PATH", path)
          : ""}

        ${playset
          ? pathRow("PLAYSET", playset)
          : ""}
      </article>`;
  }

  function deviceCard(item) {
    const title =
      item.name ||
      item.title ||
      item.device ||
      item.id ||
      "Device";

    const images =
      catalogImageCandidates(
        item
      );

    const path =
      cleanDeviceText(item.path);

    const playset =
      cleanDeviceText(item.playset);

    const important =
      cleanDeviceText(
        item.important
      );

    return `
      <article class="tool-card th3-device-card">
        <div class="tool-card-head th3-device-head">
          ${layeredImageMarkup(
            images,
            title,
            "device-image"
          )}

          <div style="min-width:0;flex:1">
            <div class="tool-card-title">
              ${escapeHtml(title)}
            </div>
          </div>
        </div>

        ${important
          ? `<div class="device-important">
              ${escapeHtml(important)}
            </div>`
          : ""}

        ${path
          ? pathRow("PATH", path)
          : ""}

        ${playset
          ? pathRow("PLAYSET", playset)
          : ""}

        ${deviceSettingsRows(
          item.settings
        )}
      </article>`;
  }

  function deviceSettingsRows(settings) {
    const entries =
      Object.entries(
        settings || {}
      ).filter(
        ([name, data]) =>
          !isJunkDeviceText(name) &&
          !isJunkDeviceText(
            data?.["option key"]
          ) &&
          !isJunkDeviceText(
            data?.value
          )
      );

    if (!entries.length) {
      return "";
    }

    return `
      <div class="device-settings-table">
        ${entries
          .map(([name, data]) => {
            const key =
              cleanDeviceText(
                data?.["option key"]
              );

            const value =
              cleanDeviceText(
                data?.value
              );

            return `
              <div class="device-setting-row">
                <div class="device-setting-name">
                  ${escapeHtml(name)}
                </div>

                <div class="device-setting-fields">
                  ${key
                    ? `
                      <div class="device-setting-field">
                        <span class="device-field-tag">Key</span>
                        <span class="device-field-value">
                          ${escapeHtml(key)}
                        </span>
                        <button
                          class="path-copy"
                          type="button"
                          data-copy="${escapeAttr(key)}"
                        >COPY</button>
                      </div>`
                    : ""}

                  ${value
                    ? `
                      <div class="device-setting-field">
                        <span class="device-field-tag">Val</span>
                        <span class="device-field-value">
                          ${escapeHtml(value)}
                        </span>
                        <button
                          class="path-copy"
                          type="button"
                          data-copy="${escapeAttr(value)}"
                        >COPY</button>
                      </div>`
                    : ""}
                </div>
              </div>`;
          })
          .join("")}
      </div>`;
  }

  function safeCatalogImageUrl(
    raw
  ) {
    try {
      const url =
        new URL(
          String(raw || ""),
          location.origin
        );

      const host =
        url.hostname
          .toLowerCase();

      const th3dry =
        host ===
          "raw.githubusercontent.com" &&
        url.pathname.startsWith(
          "/Th3DryZ69/FortniteToolsWeb/"
        );

      const fortniteApi =
        host ===
          "fortnite-api.com" ||
        host.endsWith(
          ".fortnite-api.com"
        );

      let apiOrigin =
        "";

      try {
        apiOrigin =
          API_ENDPOINT
            ? new URL(
                API_ENDPOINT,
                location.origin
              ).origin
            : "";
      } catch {}

      const allowed =
        url.origin ===
          location.origin ||
        (
          apiOrigin &&
          url.origin ===
            apiOrigin
        ) ||
        th3dry ||
        fortniteApi;

      if (
        !allowed ||
        url.username ||
        url.password ||
        (
          url.protocol !==
            "https:" &&
          !(
            url.protocol ===
              "http:" &&
            [
              "localhost",
              "127.0.0.1",
              "::1"
            ].includes(
              host
            )
          )
        )
      ) {
        return "";
      }

      url.hash = "";

      return url.toString();
    } catch {
      return "";
    }
  }

  function resolveCatalogImageUrl(
    value
  ) {
    const raw =
      String(value || "")
        .trim()
        .replace(/\\/g, "/");

    if (!raw) return "";

    if (/^https?:\/\//i.test(raw)) {
      return safeCatalogImageUrl(
        raw
      );
    }

    const marker =
      raw.toLowerCase()
        .lastIndexOf("/images/");

    let relative =
      marker >= 0
        ? raw.slice(
            marker +
            "/images/".length
          )
        : raw
            .replace(/^\.?\.\/images\//i, "")
            .replace(/^public\/images\//i, "")
            .replace(/^images\//i, "");

    relative =
      relative
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean)
        .map((part) =>
          encodeURIComponent(
            decodeURIComponentSafe(part)
          )
        )
        .join("/");

    return relative
      ? safeCatalogImageUrl(
          TH3DRY_IMAGE_BASE +
          relative
        )
      : "";
  }

  function decodeURIComponentSafe(
    value
  ) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function assetImageEndpoint(
    route,
    rawPath
  ) {
    const path =
      String(rawPath || "")
        .trim();

    const cleanRoute =
      String(route || "");

    if (
      !API_ENDPOINT ||
      !path ||
      ![
        "/image",
        "/nova/texture"
      ].includes(
        cleanRoute
      )
    ) {
      return "";
    }

    try {
      const base =
        new URL(
          API_ENDPOINT,
          location.origin
        );

      const url =
        new URL(
          cleanRoute,
          base.origin
        );

      if (
        url.origin !==
          base.origin
      ) {
        return "";
      }

      url.searchParams.set(
        "path",
        path
      );

      return safeCatalogImageUrl(
        url.toString()
      );
    } catch {
      return "";
    }
  }

  function catalogImageCandidates(
    item
  ) {
    const output = [];
    const seen = new Set();

    const add = (value) => {
      const clean =
        String(value || "")
          .trim();

      if (
        !clean ||
        seen.has(clean)
      ) {
        return;
      }

      seen.add(clean);
      output.push(clean);
    };

    add(
      resolveCatalogImageUrl(
        item?.image
      )
    );

    const path =
      cleanDeviceText(
        item?.path ||
        item?.playset ||
        item?.plot ||
        ""
      );

    if (path) {
      // Layer 2: the edge image route resolves Dilly direct images and icon
      // references. Layer 3: NovaSparx attempts a real texture decode.
      add(
        assetImageEndpoint(
          "/image",
          path
        )
      );

      add(
        assetImageEndpoint(
          "/nova/texture",
          path
        )
      );
    }

    return output;
  }

  function layeredImageMarkup(
    candidates,
    title,
    extraClass = ""
  ) {
    const list =
      [...new Set(
        (candidates || [])
          .map(
            safeCatalogImageUrl
          )
          .filter(Boolean)
      )];

    const first =
      list.shift() || "";

    const badge =
      String(title || "Asset")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 3)
        .toUpperCase() ||
      "AST";

    return `
      <span class="catalog-image-wrap">
        <img
          class="tool-card-image ${escapeAttr(extraClass)}"
          ${first ? `src="${escapeAttr(first)}"` : ""}
          alt="${escapeAttr(String(title || "Asset") + " preview")}"
          loading="lazy"
          decoding="async"
          data-layered-image
          data-image-fallbacks="${escapeAttr(JSON.stringify(list))}"
          ${first ? "" : "hidden"}
        />

        <span
          class="catalog-image-placeholder"
          data-image-placeholder
          ${first ? "hidden" : ""}
          aria-hidden="true"
        >${escapeHtml(badge)}</span>
      </span>`;
  }

  function bindImageFallbacks(root) {
    for (
      const image of root.querySelectorAll(
        "img[data-layered-image]"
      )
    ) {
      if (image.dataset.fallbackBound) {
        continue;
      }

      image.dataset.fallbackBound = "1";

      const placeholder =
        image.parentElement
          ?.querySelector(
            "[data-image-placeholder]"
          );

      let timeout = null;

      const clearImageTimeout =
        () => {
          if (timeout) {
            clearTimeout(
              timeout
            );

            timeout = null;
          }
        };

      const armImageTimeout =
        () => {
          clearImageTimeout();

          timeout =
            setTimeout(
              () => {
                timeout = null;

                if (
                  image.complete &&
                  image.naturalWidth > 0 &&
                  image.naturalHeight > 0
                ) {
                  return;
                }

                try {
                  image.removeAttribute(
                    "src"
                  );
                } catch {}

                next();
              },
              window.NovaSparxBrowserGuard
                ?.status?.()
                ?.isMobile
                ? 7_000
                : 10_000
            );
        };

      const next = () => {
        clearImageTimeout();

        let fallbacks = [];

        try {
          fallbacks =
            JSON.parse(
              image.dataset
                .imageFallbacks ||
              "[]"
            );
        } catch {
          fallbacks = [];
        }

        const candidate =
          safeCatalogImageUrl(
            fallbacks.shift() ||
            ""
          );

        image.dataset.imageFallbacks =
          JSON.stringify(
            fallbacks
              .map(
                safeCatalogImageUrl
              )
              .filter(Boolean)
          );

        if (candidate) {
          image.hidden = false;
          image.src = candidate;
          armImageTimeout();
          return;
        }

        image.hidden = true;
        image.removeAttribute(
          "src"
        );

        if (placeholder) {
          placeholder.hidden = false;
        }
      };

      image.addEventListener(
        "load",
        () => {
          clearImageTimeout();

          image.hidden = false;

          if (placeholder) {
            placeholder.hidden = true;
          }
        }
      );

      image.addEventListener(
        "error",
        () => {
          clearImageTimeout();
          next();
        }
      );

      if (!image.getAttribute("src")) {
        next();
      } else if (image.complete) {
        if (
          image.naturalWidth > 0 &&
          image.naturalHeight > 0
        ) {
          image.hidden = false;

          if (placeholder) {
            placeholder.hidden = true;
          }
        } else {
          next();
        }
      } else {
        armImageTimeout();
      }
    }
  }

  function assetLookupKeys(
    rawValue
  ) {
    let value =
      unwrapAssetPath(rawValue)
        .replace(/\\/g, "/")
        .trim();

    if (!value) return [];

    value = value
      .replace(/\.(?:uasset|uexp|ubulk)$/i, "")
      .replace(/\/+$/, "");

    const slash =
      value.lastIndexOf("/");

    const dot =
      value.lastIndexOf(".");

    if (dot > slash) {
      const left =
        value.slice(0, dot);

      const objectName =
        value.slice(dot + 1)
          .replace(/_C$/i, "");

      const packageName =
        left.slice(
          left.lastIndexOf("/") + 1
        );

      if (
        objectName.toLowerCase() ===
        packageName.toLowerCase()
      ) {
        value = left;
      }
    }

    const variants =
      new Set([
        value.toLowerCase()
      ]);

    if (
      /^FortniteGame\/Content\//i
        .test(value)
    ) {
      variants.add(
        (
          "/Game/" +
          value.slice(
            "FortniteGame/Content/"
              .length
          )
        ).toLowerCase()
      );
    }

    const plugin =
      value.match(
        /^(?:FortniteGame\/)?Plugins\/(?:GameFeatures\/)?([^/]+)\/Content\/(.+)$/i
      );

    if (plugin) {
      variants.add(
        `/${plugin[1]}/${plugin[2]}`
          .toLowerCase()
      );
    }

    if (/^\/Game\//i.test(value)) {
      variants.add(
        (
          "FortniteGame/Content/" +
          value.slice(6)
        ).toLowerCase()
      );
    }

    return [...variants];
  }

  function normalizeAssetLookupKey(
    value
  ) {
    return assetLookupKeys(value)[0] ||
      "";
  }

  // ---------------------------------------------------------------------------
  // Converters
  // ---------------------------------------------------------------------------

  function renderConverters() {
    const definitions = [
      [
        "Emote to Animation",
        "EID_DanceMoves",
        "emote-animation"
      ],
      [
        "Emote to Sequence",
        "EID_DanceMoves",
        "emote-sequence"
      ],
      [
        "Emote to Audio",
        "EID_DanceMoves",
        "emote-audio"
      ],
      [
        "Aura to VFX",
        "SparksAura_BoomBox",
        "aura-vfx"
      ],
      [
        "MusicPack to Audio",
        "MusicPack_001_Floss",
        "music-audio"
      ]
    ];

    content.innerHTML = `
      <div class="tool-section">
        <h2>Convert</h2>

        <p class="tool-note">
          Converters use current database paths and exported asset JSON.
        </p>

        <div class="converter-grid">
          ${definitions
            .map(
              ([title, placeholder, type]) => `
                <div class="converter-card">
                  <h3>${escapeHtml(title)}</h3>

                  <input
                    class="tool-input"
                    data-convert-input="${escapeAttr(type)}"
                    placeholder="${escapeAttr(placeholder)}"
                  />

                  <button
                    class="tool-button primary"
                    data-convert="${escapeAttr(type)}"
                    type="button"
                  >Convert</button>

                  <div
                    class="tool-result"
                    data-result="${escapeAttr(type)}"
                  >Ready.</div>
                </div>`
            )
            .join("")}
        </div>
      </div>`;

    for (
      const button of content.querySelectorAll(
        "[data-convert]"
      )
    ) {
      button.addEventListener(
        "click",
        () =>
          runConverter(
            button.dataset.convert
          )
      );
    }

    for (
      const input of content.querySelectorAll(
        "[data-convert-input]"
      )
    ) {
      input.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter") {
            runConverter(
              input.dataset.convertInput
            );
          }
        }
      );
    }
  }

  async function runConverter(type) {
    const input =
      content.querySelector(
        `[data-convert-input="${CSS.escape(type)}"]`
      );

    const result =
      content.querySelector(
        `[data-result="${CSS.escape(type)}"]`
      );

    const value =
      input?.value.trim();

    if (!value) {
      setResult(
        result,
        "Enter an ID or name.",
        "error"
      );

      return;
    }

    setResult(
      result,
      "Working...",
      "loading"
    );

    try {
      let data = null;

      if (type === "emote-animation") {
        data =
          await emoteToAnimation(value);
      }

      if (type === "emote-sequence") {
        data =
          await emoteToSequence(value);
      }

      if (type === "emote-audio") {
        data =
          await emoteToAudio(value);
      }

      if (type === "aura-vfx") {
        data =
          await auraToVfx(value);
      }

      if (type === "music-audio") {
        data =
          await musicToAudio(value);
      }

      if (
        !data ||
        (
          Array.isArray(data) &&
          !data.length
        )
      ) {
        setResult(
          result,
          "No data found.",
          "error"
        );

        return;
      }

      const text =
        Array.isArray(data)
          ? data.join("\n")
          : typeof data === "object"
            ? Object.entries(data)
                .map(
                  ([key, value]) =>
                    `${capitalize(key)}: ${value}`
                )
                .join("\n")
            : String(data);

      setResult(
        result,
        text
      );

      result.onclick =
        () => copy(text);

      result.title =
        "Tap to copy";
    } catch (error) {
      setResult(
        result,
        error?.message ||
        "Converter failed.",
        "error"
      );
    }
  }

  async function resolveLocalAsset(id) {
    const data =
      await window.FortniteAgent
        ?.searchDatabase?.(
          "all",
          id
        );

    const rows =
      Array.isArray(data?.results)
        ? data.results
        : [];

    if (!rows.length) {
      return null;
    }

    const target =
      String(id)
        .toLowerCase();

    const exact =
      rows.find((item) => {
        const name =
          assetTitle(item.path)
            .toLowerCase();

        return name === target;
      });

    return (
      exact ||
      rows[0]
    )?.path || null;
  }

  async function exportJson(
    path,
    options = {}
  ) {
    const key =
      String(path || "")
        .trim();

    const signal =
      options.signal ||
      null;

    throwIfActionAborted(
      signal
    );

    if (!key) {
      return null;
    }

    const cached =
      cachedExportJson(
        key
      );

    if (
      cached !==
        undefined
    ) {
      return cached;
    }

    const filePath =
      toFilePath(key);

    const url =
      `${EXPORT_BASE}` +
      `?path=${encodeURIComponent(filePath)}` +
      "&raw=true";

    const response =
      await fetchWithTimeout(
        url,
        {
          signal:
            signal ||
            undefined
        },
        24_000
      );

    throwIfActionAborted(
      signal
    );

    if (!response.ok) {
      throw new Error(
        `Export service returned ${response.status}`
      );
    }

    const guardState =
      window.NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    const declaredBytes =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    const payload =
      await readJsonResponseBounded(
        response,
        guardState.isMobile
          ? 12 * 1024 * 1024
          : 32 * 1024 * 1024,
        signal
      );

    throwIfActionAborted(
      signal
    );

    const output =
      payload?.jsonOutput ||
      [];

    rememberExportJson(
      key,
      output,
      declaredBytes
    );

    return output;
  }

  async function emoteToAnimation(id) {
    const asset =
      await resolveLocalAsset(id);

    if (!asset) return null;

    const data =
      await exportJson(asset);

    const properties =
      data?.[0]?.Properties;

    if (!properties) return null;

    return {
      male:
        properties.Animation
          ?.AssetPathName ||
        "None",

      female:
        properties.AnimationFemaleOverride
          ?.AssetPathName ||
        "None"
    };
  }

  async function emoteToSequence(id) {
    const animation =
      await emoteToAnimation(id);

    if (
      !animation ||
      animation.male === "None"
    ) {
      return null;
    }

    const data =
      await exportJson(
        animation.male
      );

    const raw =
      data?.[0]
        ?.Properties
        ?.CompositeSections
        ?.[0]
        ?.LinkedSequence
        ?.ObjectPath;

    return raw
      ? objectPath(raw)
      : null;
  }

  async function emoteToAudio(id) {
    const asset =
      await resolveLocalAsset(id);

    if (!asset) return null;

    const data =
      await exportJson(asset);

    const animation =
      data?.[0]
        ?.Properties
        ?.Animation
        ?.AssetPathName;

    if (!animation) {
      return null;
    }

    const animationData =
      await exportJson(animation);

    const sounds = [];

    walk(
      animationData,
      (node) => {
        if (
          node.Type ===
          "FortAnimNotifyState_EmoteSound"
        ) {
          const sound =
            node.Properties
              ?.EmoteSound1P
              ?.ObjectPath;

          if (sound) {
            sounds.push(sound);
          }
        }
      }
    );

    const output = [];

    for (
      const sound of [
        ...new Set(sounds)
      ]
    ) {
      const audio =
        await exportJson(sound);

      output.push(
        ...soundWaves(audio)
      );
    }

    return [
      ...new Set(output)
    ];
  }

  async function cosmeticApi(
    input,
    backendType = ""
  ) {
    const isId =
      /^[A-Za-z][A-Za-z0-9_-]+$/.test(
        input
      ) &&
      input.includes("_");

    const url =
      isId
        ? `${FORTNITE_API}/${encodeURIComponent(input)}?responseFlags=7`
        : `${FORTNITE_API}/search?name=${encodeURIComponent(input)}${backendType ? `&backendType=${encodeURIComponent(backendType)}` : ""}&responseFlags=7`;

    const response =
      await fetchWithTimeout(
        url,
        {
          cache: "force-cache"
        },
        14_000
      );

    if (!response.ok) {
      return null;
    }

    const payload =
      await readJsonResponseBounded(
        response,
        4 * 1024 * 1024
      );

    return payload?.data || null;
  }

  async function auraToVfx(input) {
    const api =
      await cosmeticApi(input);

    const path =
      api?.path ||
      await resolveLocalAsset(input);

    if (!path) return null;

    const data =
      await exportJson(path);

    const properties =
      data?.[0]?.Properties;

    if (!properties) {
      return null;
    }

    return {
      main:
        properties.SustainSystem
          ?.AssetPathName ||
        "None",

      start:
        properties.StartSystem
          ?.AssetPathName ||
        "None",

      stop:
        properties.StopSystem
          ?.AssetPathName ||
        "None"
    };
  }

  async function musicToAudio(input) {
    const api =
      await cosmeticApi(
        input,
        "AthenaMusicPack"
      );

    const path =
      api?.path ||
      await resolveLocalAsset(input);

    if (!path) return null;

    const data =
      await exportJson(path);

    const music =
      data?.[0]
        ?.Properties
        ?.FrontEndLobbyMusic
        ?.AssetPathName;

    if (!music) {
      return null;
    }

    return soundWaves(
      await exportJson(music)
    );
  }

  function soundWaves(data) {
    const output = [];

    walk(
      data,
      (node) => {
        if (
          String(node.ObjectName || "")
            .includes("SoundWave") &&
          node.ObjectPath
        ) {
          output.push(
            objectPath(
              node.ObjectPath
            )
          );
        }
      }
    );

    return [
      ...new Set(output)
    ];
  }

  // ---------------------------------------------------------------------------
  // Path modifier
  // ---------------------------------------------------------------------------

  function renderPathModifier() {
    content.innerHTML = `
      <div class="tool-section">
        <h2>${escapeHtml(
          t(
            "pathModifier",
            "Path Modifier"
          )
        )}</h2>

        <p class="tool-note">
          ${escapeHtml(
            t(
              "pathNote",
              "Convert Fortnite filesystem paths to mount-aware Unreal object paths."
            )
          )}
        </p>

        <textarea
          id="pathInput"
          class="tool-textarea"
          placeholder="FortniteGame/Content/.../Asset.uasset"
        ></textarea>

        <div class="tool-actions">
          <button
            id="formatPathBtn"
            class="tool-button primary"
            type="button"
          >${escapeHtml(
            t(
              "format",
              "Format"
            )
          )}</button>

          <button
            id="addClassPathBtn"
            class="tool-button"
            type="button"
          >${escapeHtml(
            t(
              "addClassAction",
              "Add _C"
            )
          )}</button>
        </div>

        <textarea
          id="pathOutput"
          class="tool-textarea"
          readonly
          placeholder="${escapeAttr(
            t(
              "convertedPath",
              "Converted path will appear here"
            )
          )}"
        ></textarea>

        <div
          id="pathModifierNote"
          class="tool-note"
        ></div>

        <div class="tool-actions">
          <button
            id="copyPathOutput"
            class="tool-button"
            type="button"
          >${escapeHtml(
            t(
              "copy",
              "Copy"
            )
          )}</button>
        </div>
      </div>`;

    const input =
      content.querySelector(
        "#pathInput"
      );

    const output =
      content.querySelector(
        "#pathOutput"
      );

    const note =
      content.querySelector(
        "#pathModifierNote"
      );

    content
      .querySelector("#formatPathBtn")
      .addEventListener(
        "click",
        () => {
          output.value =
            formatAssetPath(
              input.value,
              false
            );

          note.textContent = "";
        }
      );

    content
      .querySelector("#addClassPathBtn")
      .addEventListener(
        "click",
        () => {
          const compatible =
            isClassCompatibleAsset(
              input.value
            );

          output.value =
            formatAssetPath(
              input.value,
              compatible
            );

          note.textContent =
            compatible
              ? ""
              : "_C was not added because this path does not look class-compatible.";
        }
      );

    content
      .querySelector("#copyPathOutput")
      .addEventListener(
        "click",
        () => copy(output.value)
      );
  }

  function formatAssetPath(
    raw,
    addClass = false
  ) {
    if (
      window.NovaSparx
        ?.objectPath
    ) {
      const canonical =
        window.NovaSparx
          .objectPath(raw);

      if (canonical) {
        return addClass
          ? addClassSuffix(
              canonical
            )
          : canonical;
      }
    }

    let path =
      unwrapAssetPath(raw);

    if (!path) return "";

    path =
      path.replace(/\\/g, "/");

    path =
      path.replace(
        /^\.?\//,
        ""
      );

    path =
      path.replace(
        /\.(uasset|uexp|ubulk)$/i,
        ""
      );

    const objectDot =
      path.lastIndexOf(".");

    if (
      objectDot >
      path.lastIndexOf("/")
    ) {
      path =
        path.slice(
          0,
          objectDot
        );
    }

    if (
      /^FortniteGame\/Content\//i.test(path)
    ) {
      path =
        "/Game/" +
        path.slice(
          "FortniteGame/Content/".length
        );
    } else if (
      /^Engine\/Content\//i.test(path)
    ) {
      path =
        "/Engine/" +
        path.slice(
          "Engine/Content/".length
        );
    } else {
      const plugin =
        path.match(
          /^(?:FortniteGame\/)?Plugins\/(?:GameFeatures\/)?([^/]+)\/Content\/(.+)$/i
        );

      if (plugin) {
        path =
          `/${plugin[1]}/${plugin[2]}`;
      } else {
        const physicalMount =
          path.match(
            /^([^/]+)\/Content\/(.+)$/i
          );

        if (
          physicalMount &&
          physicalMount[1]
            .toLowerCase() !==
            "fortnitegame"
        ) {
          path =
            `/${physicalMount[1]}/${physicalMount[2]}`;
        } else if (
          !path.startsWith("/")
        ) {
          path = "/" + path;
        }
      }
    }

    const name =
      path.slice(
        path.lastIndexOf("/") + 1
      );

    if (!name) return path;

    path =
      `${path}.${name}`;

    return addClass
      ? addClassSuffix(path)
      : path;
  }

  function isClassCompatibleAsset(path) {
    return window.FNAAAssetDiagnosis?.diagnosePath(path).kind === "blueprint";
  }

  function addClassSuffix(path) {
    const value =
      String(path || "");

    if (!value) return value;

    if (value.endsWith("_C")) {
      return value;
    }

    return `${value}_C`;
  }

  function unwrapAssetPath(value) {
    let text =
      String(value || "")
        .trim();

    if (!text) return "";

    const wrapped =
      text.match(
        /^(?:[A-Za-z0-9_]+)?['"]([^'"]+)['"]$/
      );

    if (wrapped?.[1]) {
      text = wrapped[1];
    }

    return text;
  }

  function toFilePath(path) {
    let value =
      unwrapAssetPath(path)
        .replace(/\\/g, "/");

    if (!value) return value;

    if (
      /\.uasset$/i.test(value)
    ) {
      return value;
    }

    const dot =
      value.lastIndexOf(".");

    if (
      dot >
      value.lastIndexOf("/")
    ) {
      value =
        value.slice(0, dot);
    }

    if (
      /^FortniteGame\/Content\//i.test(value) ||
      /^FortniteGame\/Plugins\//i.test(value) ||
      /^Engine\/Content\//i.test(value)
    ) {
      return `${value}.uasset`;
    }

    if (
      value.startsWith("/Game/")
    ) {
      return (
        "FortniteGame/Content/" +
        value.slice(6) +
        ".uasset"
      );
    }

    if (
      value.startsWith("/Engine/")
    ) {
      return (
        "Engine/Content/" +
        value.slice(8) +
        ".uasset"
      );
    }

    const mount =
      value.match(
        /^\/([^/]+)\/(.+)$/
      );

    if (mount) {
      return (
        "FortniteGame/Plugins/GameFeatures/" +
        mount[1] +
        "/Content/" +
        mount[2] +
        ".uasset"
      );
    }

    return `${value}.uasset`;
  }

  function objectPath(path) {
    return formatAssetPath(
      path,
      false
    );
  }

  // ---------------------------------------------------------------------------
  // Cosmetic browser
  // ---------------------------------------------------------------------------

  function renderCosmeticsLegacy() {
    content.innerHTML = `
      <div class="tool-section">
        <h2>${escapeHtml(
          t(
            "cosmeticBrowser",
            "Cosmetic Browser"
          )
        )}</h2>

        <p class="tool-note">
          ${escapeHtml(
            t(
              "cosmeticNote",
              "Search local Fortnite paths for cosmetic assets."
            )
          )}
        </p>

        <div class="tool-searchbar">
          <input
            id="cosmeticSearch"
            placeholder="${escapeAttr(
              t(
                "cosmeticSearch",
                "Skin name, CID, character path..."
              )
            )}"
          />

          <button
            id="cosmeticBtn"
            class="tool-button primary"
            type="button"
          >Search</button>
        </div>

        <div
          id="cosmeticStatus"
          class="tool-empty"
        >Search for a cosmetic.</div>

        <div
          id="cosmeticGrid"
          class="cosmetic-grid"
        ></div>

        <div class="tool-actions">
          <button
            id="cosmeticMore"
            class="tool-button"
            type="button"
            hidden
          >Load more</button>
        </div>
      </div>`;

    const input =
      content.querySelector(
        "#cosmeticSearch"
      );

    const status =
      content.querySelector(
        "#cosmeticStatus"
      );

    const run = async () => {
      const query =
        input.value.trim();

      if (!query) return;

      status.hidden = false;
      status.textContent =
        "Searching...";

      const searches = [query];

      if (
        !query
          .toLowerCase()
          .includes("character")
      ) {
        searches.push(
          `${query} Characters`
        );
      }

      const merged = [];

      for (const search of searches) {
        const data =
          await window.FortniteAgent
            ?.searchDatabase?.(
              "all",
              search
            );

        for (
          const item of data?.results || []
        ) {
          if (
            !/cosmetic|character|cid_|outfit/i.test(
              item.path
            )
          ) {
            continue;
          }

          if (
            merged.some(
              (value) =>
                value.path ===
                item.path
            )
          ) {
            continue;
          }

          merged.push(item);
        }
      }

      cosmeticResults = merged;
      cosmeticShown = 0;

      status.textContent =
        merged.length
          ? `${merged.length} matching path${merged.length === 1 ? "" : "s"} found.`
          : "No matching cosmetic paths.";

      renderCosmeticPage(true);
    };

    content
      .querySelector("#cosmeticBtn")
      .addEventListener(
        "click",
        run
      );

    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          run();
        }
      }
    );

    content
      .querySelector("#cosmeticMore")
      .addEventListener(
        "click",
        () =>
          renderCosmeticPage(false)
      );
  }

  function renderCosmeticPage(reset) {
    const grid =
      content.querySelector(
        "#cosmeticGrid"
      );

    const more =
      content.querySelector(
        "#cosmeticMore"
      );

    if (!grid || !more) return;

    if (reset) {
      grid.innerHTML = "";
    }

    const slice =
      cosmeticResults.slice(
        cosmeticShown,
        cosmeticShown +
        COSMETIC_PAGE
      );

    cosmeticShown +=
      slice.length;

    const holder =
      document.createElement("div");

    holder.innerHTML =
      slice
        .map(cosmeticCard)
        .join("");

    while (holder.firstChild) {
      grid.append(
        holder.firstChild
      );
    }

    bindCopyButtons(grid);
    loadCosmeticIcons(grid);

    more.hidden =
      cosmeticShown >=
      cosmeticResults.length;
  }

  function cosmeticCard(item) {
    const path =
      String(item.path || "");

    const name =
      assetTitle(path) ||
      "Cosmetic";

    return `
      <article
        class="tool-card cosmetic-card"
        data-cosmetic-path="${escapeAttr(path)}"
      >
        <div class="tool-card-head">
          <img
            class="tool-card-image cosmetic-img"
            alt=""
            loading="lazy"
            hidden
          />

          <div style="min-width:0;flex:1">
            <div class="tool-card-title">
              ${escapeHtml(name)}
            </div>
          </div>
        </div>

        ${pathRow("PATH", path)}
      </article>`;
  }

  async function loadCosmeticIcons(root) {
    const cards =
      [
        ...root.querySelectorAll(
          ".cosmetic-card:not([data-icon-loaded])"
        )
      ].slice(0, 40);

    await Promise.allSettled(
      cards.map(
        async (card) => {
          card.dataset.iconLoaded = "1";

          try {
            const data =
              await exportJson(
                card.dataset.cosmeticPath
              );

            let icon = null;

            walk(
              data,
              (node) => {
                if (icon) return;

                icon =
                  node.LargeIcon
                    ?.AssetPathName ||
                  node.Icon
                    ?.AssetPathName ||
                  null;
              }
            );

            if (!icon) return;

            const image =
              card.querySelector(
                ".cosmetic-img"
              );

            image.src =
              `${EXPORT_BASE}` +
              `?path=${encodeURIComponent(
                String(icon)
                  .split(".")[0]
              )}` +
              "&raw=false";

            image.hidden = false;

            image.addEventListener(
              "error",
              () => {
                image.hidden = true;
              },
              { once: true }
            );
          } catch {
            // Missing cosmetic icon is non-fatal.
          }
        }
      )
    );
  }

  // Current cosmetic browser. The older local-path implementation above is
  // intentionally retained as an offline reference, but FNAA 1.0.2 uses the
  // public cosmetic catalogue so outfits, emotes and back blings all have
  // their own visible icon and canonical ID/path.
  function renderCosmetics() {
    cosmeticFilter = "all";

    content.innerHTML = `
      <div class="tool-section">
        <h2>${escapeHtml(
          t(
            "cosmeticBrowser",
            "Cosmetic Browser"
          )
        )}</h2>

        <p class="tool-note">
          ${escapeHtml(
            t(
              "cosmeticNote",
              "Search outfits, emotes and back blings with visible icons."
            )
          )}
        </p>

        <div class="tool-searchbar">
          <input
            id="cosmeticSearch"
            placeholder="${escapeAttr(
              t(
                "cosmeticSearch",
                "Skin, emote, back bling, CID_, EID_ or BID_..."
              )
            )}"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />

          <button
            id="cosmeticBtn"
            class="tool-button primary"
            type="button"
          >${escapeHtml(t("search", "Search"))}</button>
        </div>

        <div class="tool-subtabs fnaa-cosmetic-filters-v101">
          <button class="tool-subtab active" type="button" data-cosmetic-filter="all">All</button>
          <button class="tool-subtab" type="button" data-cosmetic-filter="outfit">Outfits</button>
          <button class="tool-subtab" type="button" data-cosmetic-filter="emote">Emotes</button>
          <button class="tool-subtab" type="button" data-cosmetic-filter="backpack">Back Blings</button>
        </div>

        <div
          id="cosmeticStatus"
          class="tool-empty"
        >Search for a cosmetic.</div>

        <div
          id="cosmeticGrid"
          class="cosmetic-grid"
        ></div>

        <div class="tool-actions">
          <button
            id="cosmeticMore"
            class="tool-button"
            type="button"
            hidden
          >${escapeHtml(t("loadMore", "Load more"))}</button>
        </div>
      </div>`;

    const input =
      content.querySelector(
        "#cosmeticSearch"
      );

    const status =
      content.querySelector(
        "#cosmeticStatus"
      );

    const searchButton =
      content.querySelector(
        "#cosmeticBtn"
      );

    let cosmeticSearchController =
      null;

    let cosmeticSearchRun =
      0;

    const run = async () => {
      const query =
        input.value.trim();

      if (!query) {
        status.hidden = false;
        status.textContent =
          "Type a cosmetic name or ID first.";
        return;
      }

      const runId =
        ++cosmeticSearchRun;

      try {
        cosmeticSearchController
          ?.abort(
            "replaced-by-new-cosmetic-search"
          );
      } catch {}

      const controller =
        new AbortController();

      cosmeticSearchController =
        controller;

      status.hidden = false;
      status.textContent =
        "Searching...";

      try {
        cosmeticResults =
          await searchCosmeticApi(
            query,
            controller.signal
          );

        if (
          runId !==
          cosmeticSearchRun
        ) {
          return;
        }

        cosmeticShown = 0;
        renderCosmeticApiPage(true);
      } catch (error) {
        if (
          controller.signal
            .aborted ||
          runId !==
            cosmeticSearchRun
        ) {
          return;
        }

        cosmeticResults = [];
        cosmeticShown = 0;

        status.textContent =
          error?.message ||
          "Cosmetic search failed.";

        content.querySelector(
          "#cosmeticGrid"
        ).replaceChildren();

        content.querySelector(
          "#cosmeticMore"
        ).hidden = true;
      } finally {
        if (
          cosmeticSearchController ===
          controller
        ) {
          cosmeticSearchController =
            null;
        }
      }
    };

    searchButton.addEventListener(
      "click",
      run
    );

    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          run();
        }
      }
    );

    content
      .querySelector("#cosmeticMore")
      .addEventListener(
        "click",
        () =>
          renderCosmeticApiPage(
            false
          )
      );

    for (
      const button of
      content.querySelectorAll(
        "[data-cosmetic-filter]"
      )
    ) {
      button.addEventListener(
        "click",
        () => {
          cosmeticFilter =
            button.dataset
              .cosmeticFilter ||
            "all";

          for (
            const item of
            content.querySelectorAll(
              "[data-cosmetic-filter]"
            )
          ) {
            item.classList.toggle(
              "active",
              item === button
            );
          }

          cosmeticShown = 0;
          renderCosmeticApiPage(true);
        }
      );
    }
  }

  async function searchCosmeticApi(
    query,
    signal = null
  ) {
    const cleanQuery =
      String(
        query || ""
      ).trim();

    const looksLikeId =
      /^(?:CID_|EID_|BID_|Pickaxe_|Glider_|Wrap_|MusicPack_|LSID_|Emoji_|Spray_|SparksAura_)/i
        .test(cleanQuery);

    if (
      !looksLikeId &&
      Array.from(cleanQuery)
        .length < 2
    ) {
      throw new Error(
        "Type at least two characters for a cosmetic name search."
      );
    }

    const params =
      new URLSearchParams();

    params.set(
      looksLikeId
        ? "id"
        : "name",
      cleanQuery.slice(
        0,
        160
      )
    );

    params.set(
      "matchMethod",
      "contains"
    );

    params.set(
      "language",
      "en"
    );

    params.set(
      "responseFlags",
      "7"
    );

    const response =
      await fetchWithTimeout(
        `${FORTNITE_API}/search/all?${params}`,
        {
          cache:
            "force-cache",
          signal:
            signal ||
            undefined
        },
        14_000
      );

    const guardState =
      window.NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    const payload =
      await readJsonResponseBounded(
        response,
        guardState.isMobile
          ? 8 * 1024 * 1024
          : 16 * 1024 * 1024,
        signal
      );

    if (!response.ok) {
      throw new Error(
        payload?.error ||
        payload?.message ||
        `Cosmetic API returned ${response.status}`
      );
    }

    if (Array.isArray(payload?.data)) {
      return payload.data
        .slice(
          0,
          500
        );
    }

    return payload?.data
      ? [payload.data]
      : [];
  }

  function cosmeticApiType(item) {
    return String(
      item?.type?.value ||
      item?.type?.displayValue ||
      item?.backendType ||
      ""
    ).toLowerCase();
  }

  function cosmeticApiMatchesFilter(
    item,
    filter
  ) {
    if (
      !filter ||
      filter === "all"
    ) {
      return true;
    }

    const type =
      cosmeticApiType(item);

    if (filter === "outfit") {
      return (
        type.includes("outfit") ||
        type.includes("character") ||
        String(item?.id || "")
          .toLowerCase()
          .startsWith("cid_")
      );
    }

    if (filter === "emote") {
      return (
        type.includes("emote") ||
        String(item?.id || "")
          .toLowerCase()
          .startsWith("eid_")
      );
    }

    if (filter === "backpack") {
      return (
        type.includes("backpack") ||
        type.includes("back bling") ||
        String(item?.id || "")
          .toLowerCase()
          .startsWith("bid_")
      );
    }

    return type.includes(filter);
  }

  function safeCosmeticImageUrl(
    raw
  ) {
    try {
      const url =
        new URL(
          String(raw || "")
        );

      const host =
        url.hostname
          .toLowerCase();

      if (
        url.protocol !==
          "https:" ||
        url.username ||
        url.password ||
        !(
          host ===
            "fortnite-api.com" ||
          host.endsWith(
            ".fortnite-api.com"
          )
        )
      ) {
        return "";
      }

      url.hash = "";

      return url.toString();
    } catch {
      return "";
    }
  }

  function cosmeticApiImage(item) {
    const images =
      item?.images || {};

    return safeCosmeticImageUrl(
      images.icon ||
      images.smallIcon ||
      images.featured ||
      images.other?.background ||
      images.other?.coverart ||
      ""
    );
  }

  function renderCosmeticApiPage(
    reset
  ) {
    const grid =
      content.querySelector(
        "#cosmeticGrid"
      );

    const more =
      content.querySelector(
        "#cosmeticMore"
      );

    const status =
      content.querySelector(
        "#cosmeticStatus"
      );

    if (!grid || !more || !status) {
      return;
    }

    const filtered =
      cosmeticResults.filter(
        (item) =>
          cosmeticApiMatchesFilter(
            item,
            cosmeticFilter
          )
      );

    if (reset) {
      cosmeticShown = 0;
      grid.replaceChildren();
    }

    const page =
      filtered.slice(
        cosmeticShown,
        cosmeticShown +
        COSMETIC_PAGE
      );

    cosmeticShown += page.length;

    grid.insertAdjacentHTML(
      "beforeend",
      page
        .map(cosmeticApiCard)
        .join("")
    );

    bindCopyButtons(grid);
    bindImageFallbacks(grid);

    status.hidden = false;
    status.textContent =
      filtered.length
        ? `${filtered.length} cosmetic${filtered.length === 1 ? "" : "s"} found.`
        : cosmeticResults.length
          ? "No cosmetics match this filter."
          : "No matching cosmetics.";

    more.hidden =
      cosmeticShown >=
      filtered.length;
  }

  function cosmeticApiCard(item) {
    const name =
      String(
        item?.name ||
        item?.id ||
        "Cosmetic"
      );

    const id =
      String(item?.id || "");

    const type =
      String(
        item?.type
          ?.displayValue ||
        item?.type?.value ||
        item?.backendType ||
        "Cosmetic"
      );

    const path =
      String(item?.path || "");

    const image =
      cosmeticApiImage(item);

    const badge =
      type
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 3)
        .toUpperCase() ||
      "COS";

    return `
      <article
        class="tool-card cosmetic-card fnaa-cosmetic-v101"
        data-cosmetic-id="${escapeAttr(id)}"
      >
        <div class="tool-card-head fnaa-cosmetic-head-v101">
          <span class="catalog-image-wrap cosmetic-image-wrap">
            <img
              class="tool-card-image cosmetic-img fnaa-cosmetic-img-v101"
              ${image ? `src="${escapeAttr(image)}"` : ""}
              alt="${escapeAttr(`${name} cosmetic icon`)}"
              loading="lazy"
              decoding="async"
              data-layered-image
              data-image-fallbacks="[]"
              ${image ? "" : "hidden"}
            />

            <span
              class="catalog-image-placeholder fnaa-cosmetic-placeholder-v101"
              data-image-placeholder
              ${image ? "hidden" : ""}
              aria-hidden="true"
            >${escapeHtml(badge)}</span>
          </span>

          <div class="fnaa-cosmetic-meta-v101">
            <div class="tool-card-title">
              ${escapeHtml(name)}
            </div>

            <div class="tool-note">
              ${escapeHtml(type)}
            </div>

            ${id
              ? `<code class="fnaa-cosmetic-id-v101">${escapeHtml(id)}</code>`
              : ""}
          </div>
        </div>

        ${id
          ? pathRow("ID", id)
          : ""}

        ${path
          ? pathRow("PATH", path)
          : ""}
      </article>`;
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  function idCard(item) {
    const title =
      item.name ||
      item.title ||
      item.id ||
      "Island";

    const rows = [];

    const images =
      catalogImageCandidates(
        item
      );

    for (const key of [
      "id",
      "plot",
      "playset",
      "path"
    ]) {
      const value =
        item[key];

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        continue;
      }

      rows.push(
        pathRow(
          key.toUpperCase(),
          String(value)
        )
      );
    }

    return `
      <article class="tool-card">
        <div class="tool-card-head">
          ${layeredImageMarkup(
            images,
            title,
            "island-image"
          )}

          <div style="min-width:0;flex:1">
            <div class="tool-card-title">
              ${escapeHtml(title)}
            </div>
          </div>
        </div>

        ${rows.join("")}
      </article>`;
  }

  function walkIdData(
    value,
    output,
    key = ""
  ) {
    if (
      !value ||
      typeof value !== "object"
    ) {
      return;
    }

    if (
      !Array.isArray(value) &&
      (
        "playset" in value ||
        "plot" in value ||
        "path" in value ||
        "id" in value
      )
    ) {
      output.push({
        name:
          value.name ||
          value.title ||
          key,
        ...value
      });
    }

    if (Array.isArray(value)) {
      value.forEach(
        (item, index) =>
          walkIdData(
            item,
            output,
            String(index)
          )
      );

      return;
    }

    for (
      const [childKey, child] of
      Object.entries(value)
    ) {
      walkIdData(
        child,
        output,
        childKey
      );
    }
  }

  function walk(node, callback) {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, callback);
      }

      return;
    }

    if (
      node &&
      typeof node === "object"
    ) {
      callback(node);

      for (
        const value of
        Object.values(node)
      ) {
        walk(
          value,
          callback
        );
      }
    }
  }

  function pathRow(label, value) {
    return `
      <div class="path-row">
        <span class="path-label">
          ${escapeHtml(label)}
        </span>

        <code
          class="path-value"
          title="${escapeAttr(value)}"
        >${escapeHtml(value)}</code>

        <button
          class="path-copy"
          type="button"
          data-copy="${escapeAttr(value)}"
        >COPY</button>
      </div>`;
  }

  function bindCopyButtons(root) {
    if (root.dataset.copyBound) {
      return;
    }

    root.dataset.copyBound = "1";

    root.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-copy]"
          );

        if (!button) return;

        copy(
          button.dataset.copy || ""
        );
      }
    );
  }

  async function copy(text) {
    const value =
      String(text || "");

    if (!value) return;

    try {
      await navigator.clipboard
        .writeText(value);

      window.FortniteAgent
        ?.toast?.("Copied");

      return;
    } catch {
      const textarea =
        document.createElement(
          "textarea"
        );

      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";

      document.body.append(
        textarea
      );

      textarea.select();

      document.execCommand(
        "copy"
      );

      textarea.remove();

      window.FortniteAgent
        ?.toast?.("Copied");
    }
  }

  function startSearchingAnimation(
    element
  ) {
    const base =
      t(
        "searching",
        "Searching"
      );

    const frames = [
      `${base}.`,
      `${base}..`,
      `${base}…`
    ];

    let index = 0;

    element.textContent =
      frames[0];

    const timer =
      setInterval(
        () => {
          index =
            (index + 1) %
            frames.length;

          element.textContent =
            frames[index];
        },
        350
      );

    return () =>
      clearInterval(timer);
  }

  async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs = 16_000
  ) {
    const controller =
      new AbortController();

    const externalSignal =
      options.signal ||
      null;

    const abortFromExternal =
      () => {
        try {
          controller.abort(
            externalSignal?.reason ||
            "replaced-by-new-request"
          );
        } catch {}
      };

    if (
      externalSignal?.aborted
    ) {
      abortFromExternal();
    } else {
      externalSignal
        ?.addEventListener?.(
          "abort",
          abortFromExternal,
          {
            once:
              true
          }
        );
    }

    const {
      signal:
        _externalSignal,
      ...fetchOptions
    } = options;

    const timer =
      setTimeout(
        () => {
          try {
            controller.abort(
              "request-timeout"
            );
          } catch {}
        },
        Math.max(
          1_000,
          Number(timeoutMs) ||
          16_000
        )
      );

    try {
      return await fetch(
        url,
        {
          ...fetchOptions,
          signal:
            controller.signal
        }
      );
    } finally {
      clearTimeout(timer);

      externalSignal
        ?.removeEventListener?.(
          "abort",
          abortFromExternal
        );
    }
  }

  async function readJsonResponseBounded(
    response,
    maxBytes,
    signal = null
  ) {
    throwIfActionAborted(
      signal
    );

    const declared =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      declared > 0 &&
      declared > maxBytes
    ) {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        "The response is too large for this device."
      );
    }

    if (
      !response.body ||
      typeof response.body
        .getReader !==
        "function"
    ) {
      const text =
        await response.text();

      throwIfActionAborted(
        signal
      );

      if (
        new TextEncoder()
          .encode(text)
          .byteLength >
        maxBytes
      ) {
        throw new Error(
          "The response is too large for this device."
        );
      }

      return JSON.parse(text);
    }

    const reader =
      response.body
        .getReader();

    const chunks = [];
    let total = 0;

    try {
      while (true) {
        throwIfActionAborted(
          signal
        );

        const {
          done,
          value
        } =
          await reader.read();

        if (done) break;

        if (!value?.byteLength) {
          continue;
        }

        total +=
          value.byteLength;

        if (
          total >
          maxBytes
        ) {
          try {
            await reader.cancel(
              "json-response-too-large"
            );
          } catch {}

          throw new Error(
            "The response is too large for this device."
          );
        }

        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    throwIfActionAborted(
      signal
    );

    const bytes =
      new Uint8Array(total);

    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(
        chunk,
        offset
      );

      offset +=
        chunk.byteLength;
    }

    return JSON.parse(
      new TextDecoder()
        .decode(bytes)
    );
  }

  async function fetchJson(
    url,
    timeoutMs =
      STATIC_DATA_TIMEOUT_MS
  ) {
    const response =
      await fetchWithTimeout(
        url,
        { cache: "force-cache" },
        timeoutMs
      );

    if (!response.ok) {
      throw new Error(
        `Request failed (${response.status})`
      );
    }

    return response.json();
  }

  async function apiJson(
    route,
    path,
    options = {}
  ) {
    const signal =
      options.signal ||
      null;

    throwIfActionAborted(
      signal
    );

    if (
      window.FortniteAgent
        ?.apiFetch
    ) {
      const response =
        await window.FortniteAgent
          .apiFetch(
            `${route}?path=${encodeURIComponent(path)}`,
            {
              method:
                "GET",
              signal:
                signal ||
                undefined
            }
          );

      throwIfActionAborted(
        signal
      );

      if (!response.ok) {
        throw new Error(
          `FNAA API returned ${response.status}`
        );
      }

      return response.json();
    }

    if (!API_ENDPOINT) {
      throw new Error(
        "FNAA API endpoint is not configured."
      );
    }

    const response =
      await fetchWithTimeout(
        `${API_ENDPOINT}${route}?path=${encodeURIComponent(path)}`,
        {
          headers: {
            "X-FNAA-Client":
              "web-v1"
          },
          signal:
            signal ||
            undefined
        },
        28_000
      );

    throwIfActionAborted(
      signal
    );

    if (!response.ok) {
      let message =
        `FNAA API returned ${response.status}`;

      try {
        const body =
          await response.json();

        if (body?.error) {
          message =
            body.error;
        }
      } catch {
        // Keep status message.
      }

      throw new Error(message);
    }

    return response.json();
  }

  function setResult(
    element,
    text,
    state = ""
  ) {
    if (!element) return;

    element.textContent =
      String(text || "");

    element.dataset.state =
      state;
  }

  function assetTitle(path) {
    const clean =
      unwrapAssetPath(path)
        .replace(/\\/g, "/");

    const file =
      clean
        .split("/")
        .pop() ||
      clean;

    return file
      .replace(
        /\.(uasset|uexp|ubulk)$/i,
        ""
      )
      .split(".")[0];
  }

  function shortPath(value) {
    const text =
      String(value || "");

    if (text.length <= 70) {
      return text;
    }

    return (
      text.slice(0, 32) +
      "…" +
      text.slice(-32)
    );
  }

  function capitalize(value) {
    const text =
      String(value || "");

    return text
      ? text[0].toUpperCase() +
        text.slice(1)
      : "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  const warmCatalogs =
    () =>
      loadStaticCatalogs()
        .catch(() => {});

  if (
    "requestIdleCallback" in
    window
  ) {
    window.requestIdleCallback(
      warmCatalogs,
      { timeout: 2_500 }
    );
  } else {
    setTimeout(
      warmCatalogs,
      800
    );
  }

  window.FortniteTools =
    Object.freeze({
      version: "1.6.7",
      open,
      close,
      formatAssetPath,
      isClassCompatibleAsset,
      toFilePath,
      findKnownImage
    });
})();
