(() => {
  "use strict";

  const CONFIG = window.FNAA_CONFIG || {};
  const BASE = String(CONFIG.siteBasePath || "/Fortnite-agent/");
  const API = String(
    CONFIG.apiEndpoint ||
    window.FORTNITE_AI_API_ENDPOINT ||
    ""
  ).trim().replace(/\/+$/, "");

  const LOGIN_MODE_SESSION =
    "fortniteAiAgent.loginMode.session";

  const LOGIN_PENDING_KEY =
    "fortniteAiAgent.openrouterLoginPending.v3";

  const DEFAULT_LABELS = Object.freeze({
    preview: "View Image",
    json: "View JSON",
    references: "View References"
  });

  const HIDE_LABELS = Object.freeze({
    preview: "Hide Image",
    json: "Hide JSON",
    references: "Hide References"
  });

  function absoluteSite(path) {
    const raw = String(path || "").trim();

    if (!raw) return raw;

    if (
      /^(?:https?:|data:|blob:)/i.test(raw)
    ) {
      return raw;
    }

    if (raw.startsWith(BASE)) {
      return raw;
    }

    if (raw.startsWith("./")) {
      return BASE + raw.slice(2);
    }

    if (raw.startsWith("assets/")) {
      return BASE + raw;
    }

    if (raw.startsWith("database/")) {
      return BASE + raw;
    }

    return raw;
  }

  function ensureBase() {
    let base =
      document.head.querySelector(
        'base[data-fnaa-base]'
      );

    if (!base) {
      base =
        document.createElement("base");

      base.dataset.fnaaBase = "1";

      document.head.insertBefore(
        base,
        document.head.firstChild
      );
    }

    base.href = BASE;
  }

  function normalizeImage(image) {
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    const raw =
      image.getAttribute("src") || "";

    const next =
      absoluteSite(raw);

    if (
      next &&
      next !== raw
    ) {
      image.setAttribute(
        "src",
        next
      );
    }
  }

  function normalizeImages(root = document) {
    if (
      root instanceof HTMLImageElement
    ) {
      normalizeImage(root);
    }

    if (
      !root?.querySelectorAll
    ) {
      return;
    }

    for (
      const image of
      root.querySelectorAll("img[src]")
    ) {
      normalizeImage(image);
    }
  }

  function syncPathModifierLabel() {
    const button =
      document.querySelector(
        '.tools-tab[data-tool="path"]'
      );

    if (!button) return;

    button.removeAttribute(
      "data-i18n"
    );

    if (
      button.textContent.trim() !==
      "Path Modifier"
    ) {
      button.textContent =
        "Path Modifier";
    }
  }

  function accountMode() {
    const state =
      window.FortniteAuth
        ?.getState?.() || {};

    if (state.user) {
      return "user";
    }

    if (
      sessionStorage.getItem(
        LOGIN_MODE_SESSION
      ) === "guest"
    ) {
      return "guest";
    }

    return "visitor";
  }

  function syncAccountMode() {
    const mode =
      accountMode();

    document.documentElement
      .dataset
      .accountMode = mode;

    document.body
      ?.setAttribute(
        "data-account-mode",
        mode
      );

    const guestBanner =
      document.getElementById(
        "guestLoginBanner"
      );

    if (
      guestBanner &&
      mode === "user"
    ) {
      guestBanner.hidden = true;
    }

    const quick =
      document.getElementById(
        "fnaaGuestQuickLogin"
      );

    if (
      quick &&
      mode === "user"
    ) {
      quick.hidden = true;
    }
  }

  async function waitForAuth() {
    try {
      if (
        window.FORTNITE_AUTH_READY
      ) {
        await window
          .FORTNITE_AUTH_READY;
      }
    } catch {}

    for (
      let attempt = 0;
      attempt < 80;
      attempt++
    ) {
      if (
        window.FortniteAuth
      ) {
        return window.FortniteAuth;
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            50
          )
      );
    }

    return null;
  }

  async function patchAuth() {
    const auth =
      await waitForAuth();

    if (!auth) return;

    const startLogin =
      async () => {
        if (
          !API ||
          !auth.configured
        ) {
          throw new Error(
            "LOGIN_UNAVAILABLE"
          );
        }

        if (
          auth.checkLoginService
        ) {
          await auth
            .checkLoginService();
        }

        // Never let an old guest flag win over a freshly completed login.
        try {
          sessionStorage.removeItem(
            LOGIN_MODE_SESSION
          );

          localStorage.setItem(
            LOGIN_PENDING_KEY,
            String(Date.now())
          );
        } catch {}

        const returnTo =
          new URL(
            BASE,
            location.origin
          ).toString();

        const loginUrl =
          new URL(
            `${API}/auth/openrouter/start`
          );

        loginUrl.searchParams.set(
          "return_to",
          returnTo
        );

        location.assign(
          loginUrl.toString()
        );
      };

    auth.signInDefault =
      startLogin;

    auth.signInAnother =
      startLogin;

    // auth.js can finish before app.js subscribes to its event.
    // Re-publish once so the app always sees the real signed-in state.
    const state =
      auth.getState?.();

    if (state) {
      window.dispatchEvent(
        new CustomEvent(
          "fortnite-auth-changed",
          {
            detail: state
          }
        )
      );
    }

    syncAccountMode();
  }

  function resetCardActionButtons(
    card,
    except = null
  ) {
    if (!card) return;

    for (
      const button of
      card.querySelectorAll(
        "[data-asset-action]"
      )
    ) {
      const action =
        button.dataset
          .assetAction;

      if (
        !DEFAULT_LABELS[action] ||
        button === except
      ) {
        continue;
      }

      delete button.dataset
        .fnaaOpen;

      button.textContent =
        DEFAULT_LABELS[action];
    }
  }

  function hideInlinePanel(
    card,
    button
  ) {
    const panel =
      card?.querySelector(
        "[data-asset-panel]"
      );

    if (!panel) return;

    panel.hidden = true;

    delete button.dataset
      .fnaaOpen;

    const action =
      button.dataset
        .assetAction;

    button.textContent =
      DEFAULT_LABELS[action] ||
      button.textContent;
  }

  function syncActionButton(
    button
  ) {
    const action =
      button?.dataset
        ?.assetAction;

    if (
      !DEFAULT_LABELS[action]
    ) {
      return;
    }

    const card =
      button.closest(
        ".asset-result-card"
      );

    const panel =
      card?.querySelector(
        "[data-asset-panel]"
      );

    if (
      !card ||
      !panel ||
      panel.hidden
    ) {
      delete button.dataset
        .fnaaOpen;

      button.textContent =
        DEFAULT_LABELS[action];

      return;
    }

    resetCardActionButtons(
      card,
      button
    );

    button.dataset
      .fnaaOpen = "1";

    button.textContent =
      HIDE_LABELS[action];
  }

  function normalizeAssetActionLabels(root = document) {
    if (!root?.querySelectorAll) {
      return;
    }

    for (
      const button of
      root.querySelectorAll(
        "[data-asset-action]"
      )
    ) {
      const action =
        button.dataset
          .assetAction;

      if (
        !DEFAULT_LABELS[action] ||
        button.dataset
          .fnaaOpen === "1"
      ) {
        continue;
      }

      button.textContent =
        DEFAULT_LABELS[action];
    }
  }

  function installToolToggleFix() {
    document.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-asset-action]"
          );

        if (!button) return;

        const action =
          button.dataset
            .assetAction;

        if (
          !DEFAULT_LABELS[action]
        ) {
          return;
        }

        const card =
          button.closest(
            ".asset-result-card"
          );

        if (!card) return;

        if (
          button.dataset
            .fnaaOpen === "1"
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();

          hideInlinePanel(
            card,
            button
          );

          return;
        }

        resetCardActionButtons(
          card,
          button
        );

        // Let tools.js do the actual opening/fetching.
        // Then only change the button state/label.
        setTimeout(
          () =>
            syncActionButton(
              button
            ),
          80
        );

        setTimeout(
          () =>
            syncActionButton(
              button
            ),
          450
        );
      },
      true
    );
  }

  function patchNovaSparx() {
    const install = () => {
      const core =
        window.NovaSparx;

      if (
        !core ||
        !API ||
        core.__fnaaV101
      ) {
        return false;
      }

      const request =
        async (
          route,
          path,
          options = {}
        ) => {
          const query =
            new URLSearchParams();

          query.set(
            "path",
            String(path || "")
          );

          if (
            route ===
            "/nova/resolve"
          ) {
            query.set(
              "quality",
              options
                .preferHQ === false
                ? "normal"
                : "hq"
            );
          }

          const controller =
            new AbortController();

          const timer =
            setTimeout(
              () => controller.abort(),
              30_000
            );

          let response;

          try {
            response =
              await fetch(
                `${API}${route}?${query.toString()}`,
                {
                  cache:
                    options.noCache
                      ? "no-store"
                      : "force-cache",
                  headers: {
                    Accept:
                      "application/json",
                    "X-FNAA-Client":
                      "web-v1"
                  },
                  signal:
                    controller.signal
                }
              );
          } finally {
            clearTimeout(timer);
          }

          const data =
            await response
              .json()
              .catch(
                () => ({})
              );

          return {
            response,
            data
          };
        };

      const resolve =
        async (
          path,
          options = {}
        ) => {
          const {
            response,
            data
          } =
            await request(
              "/nova/resolve",
              path,
              options
            );

          if (
            !response.ok ||
            data.state !== "ready"
          ) {
            const error =
              new Error(
                data.error ||
                `NovaSparx resolver returned HTTP ${response.status}.`
              );

            error.code =
              data.code ||
              (
                response.status === 404
                  ? "NOVA_MISSING"
                  : "NOVA_ERROR"
              );

            error.details =
              data;

            throw error;
          }

          return core
            .normalizeManifest(
              data,
              path
            );
        };

      const inspect =
        async (
          path,
          options = {}
        ) => {
          const {
            response,
            data
          } =
            await request(
              "/nova/inspect",
              path,
              {
                ...options,
                noCache: true
              }
            );

          if (!response.ok) {
            const error =
              new Error(
                data.error ||
                `NovaSparx inspect returned HTTP ${response.status}.`
              );

            error.code =
              data.code ||
              "NOVA_INSPECT_ERROR";

            error.details =
              data;

            throw error;
          }

          return data;
        };

      window.NovaSparx =
        Object.freeze({
          ...core,
          resolve,
          inspect,
          __fnaaV101: true
        });

      return true;
    };

    if (install()) return;

    let attempts = 0;

    const timer =
      setInterval(
        () => {
          attempts++;

          if (
            install() ||
            attempts > 100
          ) {
            clearInterval(
              timer
            );
          }
        },
        50
      );
  }

  const cosmeticState = {
    rows: [],
    shown: 0,
    filter: "all"
  };

  let cosmeticSearchController =
    null;

  let cosmeticSearchGeneration =
    0;


  function cosmeticType(item) {
    return String(
      item?.type?.value ||
      item?.type?.displayValue ||
      item?.backendType ||
      ""
    ).toLowerCase();
  }

  function cosmeticMatchesFilter(
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
      cosmeticType(item);

    if (filter === "outfit") {
      return (
        type.includes("outfit") ||
        type.includes("character")
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

    if (
      filter === "backpack"
    ) {
      return (
        type.includes("backpack") ||
        type.includes("back bling") ||
        String(item?.id || "")
          .toLowerCase()
          .startsWith("bid_")
      );
    }

    return type.includes(
      filter
    );
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

  function cosmeticImage(item) {
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }

  function copyText(value) {
    const text =
      String(value || "");

    if (!text) return;

    navigator.clipboard
      ?.writeText(text)
      .catch(() => {});
  }

  function cosmeticCardV2(
    item
  ) {
    const image =
      cosmeticImage(item);

    const id =
      String(item?.id || "");

    const name =
      String(
        item?.name ||
        id ||
        "Cosmetic"
      );

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

    return `
      <article
        class="tool-card cosmetic-card fnaa-cosmetic-v101"
        data-cosmetic-id="${escapeHtml(id)}"
      >
        <div class="tool-card-head fnaa-cosmetic-head-v101">
          ${
            image
              ? `
                <img
                  class="tool-card-image cosmetic-img fnaa-cosmetic-img-v101"
                  src="${escapeHtml(image)}"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />`
              : `
                <div class="fnaa-cosmetic-placeholder-v101">
                  ${escapeHtml(type.slice(0, 3).toUpperCase())}
                </div>`
          }

          <div class="fnaa-cosmetic-meta-v101">
            <div class="tool-card-title">
              ${escapeHtml(name)}
            </div>

            <div class="tool-note">
              ${escapeHtml(type)}
            </div>

            <code class="fnaa-cosmetic-id-v101">
              ${escapeHtml(id)}
            </code>
          </div>
        </div>

        ${
          path
            ? `
              <div class="path-row">
                <span class="path-label">PATH</span>
                <code class="path-value">${escapeHtml(path)}</code>
                <button
                  class="path-copy"
                  type="button"
                  data-fnaa-copy="${escapeHtml(path)}"
                >COPY</button>
              </div>`
            : ""
        }
      </article>`;
  }

  function drawCosmeticsV2(
    reset = false
  ) {
    const grid =
      document.getElementById(
        "fnaaCosmeticGridV101"
      );

    const more =
      document.getElementById(
        "fnaaCosmeticMoreV101"
      );

    const status =
      document.getElementById(
        "fnaaCosmeticStatusV101"
      );

    if (
      !grid ||
      !more
    ) {
      return;
    }

    const filtered =
      cosmeticState.rows
        .filter(
          (item) =>
            cosmeticMatchesFilter(
              item,
              cosmeticState.filter
            )
        );

    if (reset) {
      cosmeticState.shown = 0;
      grid.innerHTML = "";
    }

    const page =
      filtered.slice(
        cosmeticState.shown,
        cosmeticState.shown + 48
      );

    cosmeticState.shown +=
      page.length;

    grid.insertAdjacentHTML(
      "beforeend",
      page
        .map(
          cosmeticCardV2
        )
        .join("")
    );

    if (status) {
      status.hidden = false;

      status.textContent =
        filtered.length
          ? `${filtered.length} cosmetic${filtered.length === 1 ? "" : "s"} found.`
          : "No matching cosmetics.";
    }

    more.hidden =
      cosmeticState.shown >=
      filtered.length;

    normalizeImages(grid);
  }

  async function readJsonResponseBoundedV101(
    response,
    maxBytes,
    signal = null
  ) {
    if (signal?.aborted) {
      const error =
        new Error(
          "Cosmetic search was cancelled."
        );

      error.name =
        "AbortError";

      throw error;
    }

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
        "The cosmetic response is too large for this device."
      );
    }

    const text =
      await response.text();

    if (signal?.aborted) {
      const error =
        new Error(
          "Cosmetic search was cancelled."
        );

      error.name =
        "AbortError";

      throw error;
    }

    if (
      new TextEncoder()
        .encode(text)
        .byteLength >
      maxBytes
    ) {
      throw new Error(
        "The cosmetic response is too large for this device."
      );
    }

    return JSON.parse(text);
  }

  async function searchCosmeticsV2() {
    const input =
      document.getElementById(
        "fnaaCosmeticSearchV101"
      );

    const status =
      document.getElementById(
        "fnaaCosmeticStatusV101"
      );

    const query =
      input?.value.trim() || "";

    if (!query) {
      if (status) {
        status.textContent =
          "Search for a skin, emote, back bling, ID or cosmetic name.";
      }

      return;
    }

    const looksLikeId =
      /^(?:CID_|EID_|BID_|Pickaxe_|Glider_|Wrap_|MusicPack_|LSID_|Emoji_|Spray_|SparksAura_)/i
        .test(query);

    if (
      !looksLikeId &&
      Array.from(query)
        .length < 2
    ) {
      if (status) {
        status.textContent =
          "Type at least two characters for a cosmetic name search.";
      }

      return;
    }

    const generation =
      ++cosmeticSearchGeneration;

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

    const timer =
      setTimeout(
        () => {
          try {
            controller.abort(
              "cosmetic-search-timeout"
            );
          } catch {}
        },
        14_000
      );

    if (status) {
      status.hidden = false;
      status.textContent =
        "Searching...";
    }

    const params =
      new URLSearchParams();

    params.set(
      looksLikeId
        ? "id"
        : "name",
      query.slice(
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

    try {
      const response =
        await fetch(
          `https://fortnite-api.com/v2/cosmetics/br/search/all?${params.toString()}`,
          {
            cache:
              "force-cache",
            signal:
              controller.signal
          }
        );

      if (!response.ok) {
        throw new Error(
          `Cosmetic API returned ${response.status}.`
        );
      }

      const guardState =
        window.NovaSparxBrowserGuard
          ?.status?.() ||
        {};

      const payload =
        await readJsonResponseBoundedV101(
          response,
          guardState.isMobile
            ? 8 * 1024 * 1024
            : 16 * 1024 * 1024,
          controller.signal
        );

      if (
        controller.signal
          .aborted ||
        generation !==
          cosmeticSearchGeneration
      ) {
        return;
      }

      const rows =
        Array.isArray(
          payload?.data
        )
          ? payload.data
              .slice(
                0,
                500
              )
          : [];

      cosmeticState.rows =
        rows;

      cosmeticState.shown = 0;

      drawCosmeticsV2(
        true
      );
    } catch (error) {
      if (
        controller.signal
          .aborted ||
        generation !==
          cosmeticSearchGeneration
      ) {
        return;
      }

      cosmeticState.rows = [];

      if (status) {
        status.textContent =
          error?.message ||
          "Cosmetic search failed.";
      }
    } finally {
      clearTimeout(
        timer
      );

      if (
        cosmeticSearchController ===
          controller
      ) {
        cosmeticSearchController =
          null;
      }
    }
  }

  function renderCosmeticsV2() {
    const toolsContent =
      document.getElementById(
        "toolsContent"
      );

    if (!toolsContent) {
      return;
    }

    toolsContent.innerHTML = `
      <div class="tool-section fnaa-cosmetics-v101">
        <div class="tool-section-head">
          <div>
            <h2>Cosmetic Browser</h2>
            <p class="tool-note">
              Search outfits, emotes, back blings and other Battle Royale cosmetics with visible icons.
            </p>
          </div>
        </div>

        <div class="tool-searchbar">
          <input
            id="fnaaCosmeticSearchV101"
            autocomplete="off"
            spellcheck="false"
            placeholder="Skin, EID_, BID_, emote, back bling..."
          />

          <button
            id="fnaaCosmeticSearchBtnV101"
            class="tool-button primary"
            type="button"
          >Search</button>
        </div>

        <div class="tool-subtabs fnaa-cosmetic-filters-v101">
          <button class="tool-subtab active" type="button" data-fnaa-cosmetic-filter="all">All</button>
          <button class="tool-subtab" type="button" data-fnaa-cosmetic-filter="outfit">Outfits</button>
          <button class="tool-subtab" type="button" data-fnaa-cosmetic-filter="emote">Emotes</button>
          <button class="tool-subtab" type="button" data-fnaa-cosmetic-filter="backpack">Back Blings</button>
        </div>

        <div
          id="fnaaCosmeticStatusV101"
          class="tool-empty"
        >Search for a cosmetic.</div>

        <div
          id="fnaaCosmeticGridV101"
          class="cosmetic-grid"
        ></div>

        <div class="tool-actions">
          <button
            id="fnaaCosmeticMoreV101"
            class="tool-button"
            type="button"
            hidden
          >Load more</button>
        </div>
      </div>`;

    const input =
      document.getElementById(
        "fnaaCosmeticSearchV101"
      );

    document
      .getElementById(
        "fnaaCosmeticSearchBtnV101"
      )
      ?.addEventListener(
        "click",
        searchCosmeticsV2
      );

    input?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();
          searchCosmeticsV2();
        }
      }
    );

    document
      .getElementById(
        "fnaaCosmeticMoreV101"
      )
      ?.addEventListener(
        "click",
        () =>
          drawCosmeticsV2(
            false
          )
      );

    if (
      !toolsContent.dataset
        .fnaaCosmeticBound
    ) {
      toolsContent.dataset
        .fnaaCosmeticBound = "1";

      toolsContent.addEventListener(
        "click",
        (event) => {
          const filterButton =
          event.target.closest(
            "[data-fnaa-cosmetic-filter]"
          );

        if (filterButton) {
          cosmeticState.filter =
            filterButton.dataset
              .fnaaCosmeticFilter ||
            "all";

          for (
            const button of
            toolsContent.querySelectorAll(
              "[data-fnaa-cosmetic-filter]"
            )
          ) {
            button.classList
              .toggle(
                "active",
                button ===
                  filterButton
              );
          }

          drawCosmeticsV2(
            true
          );

          return;
        }

        const copyButton =
          event.target.closest(
            "[data-fnaa-copy]"
          );

          if (copyButton) {
            copyText(
              copyButton.dataset
                .fnaaCopy
            );
          }
        }
      );
    }
  }

  function installCosmeticOverride() {
    document.addEventListener(
      "click",
      (event) => {
        const tab =
          event.target.closest(
            '.tools-tab[data-tool="cosmetic"]'
          );

        if (!tab) return;

        setTimeout(
          renderCosmeticsV2,
          0
        );
      }
    );

    window.addEventListener(
      "fortnite-language-changed",
      () => {
        const active =
          document.querySelector(
            '.tools-tab.active[data-tool="cosmetic"]'
          );

        if (active) {
          setTimeout(
            renderCosmeticsV2,
            0
          );
        }
      }
    );
  }

  function warmStaticData() {
    const run =
      () => {
        const urls = [
          `${BASE}database/id.json`,
          `${BASE}database/devicemeshs.json`
        ];

        for (const url of urls) {
          fetch(
            url,
            {
              cache:
                "force-cache"
            }
          ).catch(
            () => {}
          );
        }
      };

    if (
      "requestIdleCallback" in
      window
    ) {
      window.requestIdleCallback(
        run,
        {
          timeout: 2500
        }
      );
    } else {
      setTimeout(
        run,
        800
      );
    }
  }

  function installGlitchPulse() {
    if (
      window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      )?.matches
    ) {
      return;
    }

    const pulse =
      () => {
        document.documentElement
          .classList
          .add(
            "fnaa-glitch-pulse"
          );

        setTimeout(
          () =>
            document.documentElement
              .classList
              .remove(
                "fnaa-glitch-pulse"
              ),
          170
        );

        setTimeout(
          pulse,
          6500 +
          Math.floor(
            Math.random() *
            5500
          )
        );
      };

    setTimeout(
      pulse,
      4200
    );
  }

  function installObserver() {
    const observer =
      new MutationObserver(
        (records) => {
          for (
            const record of
            records
          ) {
            for (
              const node of
              record.addedNodes
            ) {
              if (
                node.nodeType !==
                Node.ELEMENT_NODE
              ) {
                continue;
              }

              normalizeImages(
                node
              );

              normalizeAssetActionLabels(
                node
              );
            }
          }

          syncPathModifierLabel();
          normalizeAssetActionLabels();
          syncAccountMode();
        }
      );

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );
  }

  ensureBase();
  normalizeImages();
  // v1.0.2 owns tool toggles, cosmetics and labels inside tools.js. Keeping
  // those old interception patches enabled causes duplicate requests.
  patchNovaSparx();
  patchAuth();
  installGlitchPulse();
  syncAccountMode();

  window.addEventListener(
    "fortnite-auth-changed",
    syncAccountMode
  );

  window.addEventListener(
    "fortnite-login-mode-changed",
    syncAccountMode
  );

  window.addEventListener(
    "pageshow",
    () => {
      normalizeImages();
      syncAccountMode();
    }
  );
})();
