(() => {
  "use strict";

  const CONFIG = window.FNAA_CONFIG || {};
  const API_ENDPOINT = String(
    CONFIG.apiEndpoint ||
    window.FORTNITE_AI_API_ENDPOINT ||
    ""
  ).trim().replace(/\/+$/, "");

  const DB_CONFIG =
    CONFIG.database ||
    window.FORTNITE_AI_DB ||
    {};

  const ROUTES = {
    chat:
      CONFIG.routes?.chat ||
      "/Main/Chat",

    paths:
      CONFIG.routes?.paths ||
      "/ManualSearch/Paths",

    assets:
      CONFIG.routes?.assets ||
      "/ManualSearch/Assets",

    settings:
      CONFIG.routes?.settings ||
      "/Settings"
  };

  const SITE_BASE_PATH =
    CONFIG.siteBasePath ||
    "/Fortnite-agent/";

  const CURRENT_FN_VERSION =
    CONFIG.fortniteVersion ||
    "42.00";

  const LOGIN_MODE_SESSION =
    "fortniteAiAgent.loginMode.session";

  const STORAGE_KEY =
    "fortniteAiAgent.chats.v4";

  const ACTIVE_KEY =
    "fortniteAiAgent.active.v4";

  const THEME_KEY =
    "fortniteAiAgent.theme.v1";

  const GUEST_ID_KEY =
    "fortniteAiAgent.guestId.v1";

  const GUEST_NEXT_AT =
    "fortniteAiAgent.guestNextAt.v1";

  const GUEST_SLOWMODE_MS =
    15_000;

  const MAX_STORED_CHATS =
    30;

  const MAX_STORED_MESSAGES_PER_CHAT =
    120;

  const MAX_STORED_MESSAGE_CHARS =
    24_000;

  const MAX_STORED_ATTACHMENT_CHARS =
    160_000;

  const MAX_STORED_TOTAL_CHARS =
    2_000_000;

  const GENERATED_FILE_NAME =
    "Subscribe to my YT channel @27lf.txt";

  const DEFAULT_USER_AVATAR =
    `${SITE_BASE_PATH}assets/default-user-avatar.jpeg`;

  const FNAA_CLIENT =
    "web-v1";

  function safeStorageGet(
    key
  ) {
    try {
      return window.localStorage
        .getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(
    key,
    value
  ) {
    try {
      window.localStorage
        .setItem(
          key,
          value
        );

      return true;
    } catch {
      return false;
    }
  }

  function safeStorageRemove(
    key
  ) {
    try {
      window.localStorage
        .removeItem(key);

      return true;
    } catch {
      return false;
    }
  }

  const PLUGINS = [
    {
      id: "path",
      label: "SearchForPath",
      command: "@SearchForPath",
      description: "Search Fortnite asset paths",
      icon: "PATH"
    },
    {
      id: "setup-mesh",
      label: "SetupMeshMethod",
      command: "@SetupMeshMethod",
      description: "Android setup",
      icon: "SET"
    },
    {
      id: "setup-orange",
      label: "SetupOrangeCopy",
      command: "@SetupOrangeCopy",
      description: "Android setup",
      icon: "SET"
    },
    {
      id: "setup-dev",
      label: "SetupDevInventory",
      command: "@SetupDevInventory",
      description: "Android setup",
      icon: "SET"
    }
  ];

  const $ =
    (id) =>
      document.getElementById(id);

  const els = {
    sidebar: $("sidebar"),
    scrim: $("scrim"),
    openSidebar: $("openSidebar"),
    closeSidebar: $("closeSidebar"),

    newChatBtn: $("newChatBtn"),
    moreToolsBtn: $("moreToolsBtn"),
    settingsBtn: $("settingsBtn"),
    discordTop: $("discordTop"),

    recentList: $("recentList"),
    chat: $("chat"),
    welcome: $("welcome"),
    messages: $("messages"),

    composer: $("composer"),
    input: $("messageInput"),
    send: $("sendButton"),
    toast: $("toast"),

    loginGate: $("loginGate"),

    settingsOverlay: $("settingsOverlay"),
    settingsBackBtn: $("settingsBackBtn"),

    profileAvatarButton:
      $("profileAvatarButton"),

    profileAvatar:
      $("profileAvatar"),

    profileUsernameButton:
      $("profileUsernameButton"),

    profileAccountType:
      $("profileAccountType"),

    profileAvatarInput:
      $("profileAvatarInput"),

    accountActionButton:
      $("accountActionButton")
  };

  if (
    !els.composer ||
    !els.input ||
    !els.send ||
    !els.messages
  ) {
    console.error(
      "FNAA 1.0: required application nodes are missing."
    );

    return;
  }

  const pluginMenu =
    document.createElement("div");

  pluginMenu.className =
    "plugin-menu";

  pluginMenu.hidden = true;

  els.composer.appendChild(
    pluginMenu
  );

  let chats =
    loadChats();

  let activeId =
    safeStorageGet(
      ACTIVE_KEY
    ) || null;

  let busy = false;

  let activeChatController =
    null;

  let activeChatRun =
    0;

  let toastTimer = null;

  let dbWorker = null;
  let dbSeq = 0;

  let slowmodeTimer = null;

  let accountState = {
    configured: false,
    user: null,
    profile: null,
    error: null
  };

  let pendingSetupAvatar = "";

  const dbPending =
    new Map();

  if (
    !activeId ||
    !chats[activeId]
  ) {
    activeId =
      createChat(false);
  }

  restoreGitHubPagesRoute();
  applyTheme(
    safeStorageGet(
      THEME_KEY
    ) || "fortnite"
  );

  setupEvents();
  renderAll();
  ensureGuestLoginButton();
  ensureSettingsApiCard();

  maybeShowLoginGate();
  syncVisualViewport();
  syncGuestSlowmodeUI();

  queueMicrotask(
    applyCurrentRoute
  );

  window.addEventListener(
    "pageshow",
    () => {
      resetOpenRouterButton();
      syncGuestSlowmodeUI();
    }
  );

  window.addEventListener(
    "pagehide",
    () => {
      try {
        activeChatController
          ?.abort(
            "page-hidden"
          );
      } catch {}

      activeChatController =
        null;

      for (
        const pending of
        dbPending.values()
      ) {
        clearTimeout(
          pending.timer
        );

        pending.signal
          ?.removeEventListener?.(
            "abort",
            pending.abortHandler
          );

        pending.reject(
          new Error(
            "Database search stopped because the page was hidden."
          )
        );
      }

      dbPending.clear();

      dbWorker?.terminate();
      dbWorker = null;
    }
  );

  // ---------------------------------------------------------------------------
  // Boot / routing
  // ---------------------------------------------------------------------------

  function restoreGitHubPagesRoute() {
    let stored = "";

    try {
      stored =
        sessionStorage.getItem(
          "fnaa:github-pages-route"
        ) || "";

      sessionStorage.removeItem(
        "fnaa:github-pages-route"
      );
    } catch {
      return;
    }

    if (!stored) return;

    const prefix =
      SITE_BASE_PATH.endsWith("/")
        ? SITE_BASE_PATH.slice(0, -1)
        : SITE_BASE_PATH;

    if (
      stored.startsWith(prefix)
    ) {
      history.replaceState(
        null,
        "",
        stored
      );
    }
  }

  function currentRoute() {
    const prefix =
      SITE_BASE_PATH.endsWith("/")
        ? SITE_BASE_PATH.slice(0, -1)
        : SITE_BASE_PATH;

    let path =
      location.pathname || "/";

    if (
      path === prefix ||
      path === `${prefix}/`
    ) {
      return ROUTES.chat;
    }

    if (
      path.startsWith(
        `${prefix}/`
      )
    ) {
      path =
        path.slice(
          prefix.length
        );
    }

    if (!path.startsWith("/")) {
      path = "/" + path;
    }

    return path;
  }

  function routeUrl(route) {
    const raw =
      String(route || ROUTES.chat)
        .trim();

    const [pathPart, suffix = ""] =
      raw.split(/(?=[?#])/);

    let internal =
      pathPart || ROUTES.chat;

    const prefix =
      SITE_BASE_PATH.endsWith("/")
        ? SITE_BASE_PATH.slice(0, -1)
        : SITE_BASE_PATH;

    if (
      internal.startsWith(
        `${prefix}/`
      )
    ) {
      return internal + suffix;
    }

    if (!internal.startsWith("/")) {
      internal = "/" + internal;
    }

    return (
      prefix +
      internal +
      suffix
    );
  }

  function navigate(
    route,
    options = {}
  ) {
    const {
      replace = false,
      apply = false
    } = options;

    const next =
      routeUrl(route);

    if (replace) {
      history.replaceState(
        null,
        "",
        next
      );
    } else {
      history.pushState(
        null,
        "",
        next
      );
    }

    if (apply) {
      applyCurrentRoute();
    }
  }

  function applyCurrentRoute() {
    const route =
      currentRoute();

    if (
      route === ROUTES.settings
    ) {
      closeSidebar();
      closeToolsOnly();
      openSettings(false);
      return;
    }

    if (
      route === ROUTES.paths ||
      route === ROUTES.assets
    ) {
      closeSidebar();
      closeSettingsOnly();

      window.FortniteTools
        ?.open?.("assets");

      return;
    }

    closeSettingsOnly();
    closeToolsOnly();
  }

  window.addEventListener(
    "popstate",
    applyCurrentRoute
  );

  // ---------------------------------------------------------------------------
  // Global events / UI
  // ---------------------------------------------------------------------------

  function setupEvents() {
    els.openSidebar
      ?.addEventListener(
        "click",
        openSidebar
      );

    els.closeSidebar
      ?.addEventListener(
        "click",
        closeSidebar
      );

    els.scrim
      ?.addEventListener(
        "click",
        closeSidebar
      );

    els.newChatBtn
      ?.addEventListener(
        "click",
        () => {
          try {
            activeChatController
              ?.abort(
                "new-chat"
              );
          } catch {}

          activeChatController =
            null;

          activeChatRun++;

          setBusy(false);
          removeTypingIndicator();

          activeId =
            createChat(true);

          renderAll();
          closeSidebar();

          navigate(
            ROUTES.chat,
            {
              apply: true
            }
          );
        }
      );

    els.moreToolsBtn
      ?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          closeSidebar();

          navigate(
            ROUTES.paths,
            {
              apply: true
            }
          );
        }
      );

    els.settingsBtn
      ?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          closeSidebar();

          navigate(
            ROUTES.settings,
            {
              apply: true
            }
          );
        }
      );

    els.settingsBackBtn
      ?.addEventListener(
        "click",
        () => {
          closeSettingsOnly();

          navigate(
            ROUTES.chat,
            {
              replace: true
            }
          );
        }
      );

    $("toolsBackBtn")
      ?.addEventListener(
        "click",
        () => {
          navigate(
            ROUTES.chat,
            {
              replace: true
            }
          );
        }
      );

    els.discordTop
      ?.addEventListener(
        "click",
        async () => {
          try {
            await navigator
              .clipboard
              .writeText(
                "@its.swag"
              );

            showToast(
              "Copied @its.swag"
            );
          } catch {
            showToast(
              "@its.swag"
            );
          }
        }
      );

    els.profileUsernameButton
      ?.addEventListener(
        "click",
        () => {
          if (!accountState.user) {
            showWelcomeGate();
            return;
          }

          showUsernameEditor();
        }
      );

    els.profileAvatarButton
      ?.addEventListener(
        "click",
        () => {
          if (!accountState.user) {
            showWelcomeGate();
            return;
          }

          els.profileAvatarInput
            ?.click();
        }
      );

    els.profileAvatarInput
      ?.addEventListener(
        "change",
        async () => {
          const file =
            els.profileAvatarInput
              ?.files?.[0];

          if (els.profileAvatarInput) {
            els.profileAvatarInput.value = "";
          }

          if (!file) return;

          try {
            const dataUrl =
              await processAvatarFile(file);

            await window.FortniteAuth
              ?.saveAvatar?.(
                dataUrl
              );

            showToast(
              "Profile picture updated"
            );
          } catch (error) {
            showToast(
              String(
                error?.message ||
                error
              ),
              true
            );
          }
        }
      );

    els.accountActionButton
      ?.addEventListener(
        "click",
        async () => {
          if (!accountState.user) {
            closeSettingsOnly();
            showWelcomeGate();
            return;
          }

          try {
            await window.FortniteAuth
              ?.signOut?.();

            sessionStorage
              .removeItem(
                LOGIN_MODE_SESSION
              );

            closeSettingsOnly();
            showWelcomeGate();
          } catch (error) {
            showToast(
              String(
                error?.message ||
                error
              ),
              true
            );
          }
        }
      );

    document.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-theme-choice]"
          );

        if (!button) return;

        applyTheme(
          button.dataset
            .themeChoice
        );
      }
    );

    window.addEventListener(
      "fortnite-auth-changed",
      (event) => {
        handleAuthState(
          event.detail || {}
        );
      }
    );

    window.addEventListener(
      "fortnite-language-changed",
      () => {
        syncSettingsApiCard();
      }
    );

    window.addEventListener(
      "fnaa-describe-path",
      (event) => {
        const path =
          String(
            event.detail?.path ||
            ""
          ).trim();

        if (path) {
          describePath(path);
        }
      }
    );

    els.input.addEventListener(
      "input",
      () => {
        resizeTextarea();
        updateSendState();
        updatePluginMenu();
      }
    );

    els.input.addEventListener(
      "focus",
      updatePluginMenu
    );

    els.input.addEventListener(
      "click",
      updatePluginMenu
    );

    els.input.addEventListener(
      "keydown",
      (event) => {
        if (
          !pluginMenu.hidden
        ) {
          if (
            event.key ===
            "Escape"
          ) {
            pluginMenu.hidden = true;
            return;
          }

          if (
            event.key ===
            "ArrowDown" ||
            event.key ===
            "ArrowUp"
          ) {
            event.preventDefault();

            movePluginSelection(
              event.key ===
              "ArrowDown"
                ? 1
                : -1
            );

            return;
          }

          if (
            event.key ===
            "Enter" &&
            !event.shiftKey &&
            !event.isComposing
          ) {
            const selected =
              pluginMenu
                .querySelector(
                  ".plugin-option.selected"
                );

            if (selected) {
              event.preventDefault();

              selectPlugin(
                selected.dataset
                  .command || ""
              );

              return;
            }
          }
        }

        // On phones, Enter stays a native newline. The visible Send button is
        // the only submit control. Desktop Enter sends, Shift+Enter adds line.
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing &&
          !isMobileComposerDevice()
        ) {
          event.preventDefault();

          if (!els.send.disabled) {
            els.composer
              .requestSubmit();
          }
        }
      }
    );

    els.composer.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        await sendCurrentInput();
      }
    );

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !pluginMenu.hidden &&
          !pluginMenu.contains(
            event.target
          ) &&
          event.target !==
          els.input
        ) {
          pluginMenu.hidden = true;
        }
      }
    );

    const viewportChange = () => {
      syncVisualViewport();
      positionPluginMenu();
    };

    window.addEventListener(
      "resize",
      viewportChange
    );

    window.addEventListener(
      "orientationchange",
      () =>
        setTimeout(
          viewportChange,
          120
        )
    );

    if (
      window.visualViewport
    ) {
      visualViewport.addEventListener(
        "resize",
        viewportChange
      );

      visualViewport.addEventListener(
        "scroll",
        viewportChange
      );
    }

    window.addEventListener(
      "storage",
      (event) => {
        if (
          event.key ===
          GUEST_NEXT_AT
        ) {
          syncGuestSlowmodeUI();
        }
      }
    );
  }

  function syncVisualViewport() {
    const viewport =
      window.visualViewport;

    const height =
      Math.round(
        viewport?.height ||
        window.innerHeight
      );

    const top =
      Math.round(
        viewport?.offsetTop ||
        0
      );

    document.documentElement
      .style
      .setProperty(
        "--app-height",
        `${height}px`
      );

    document.documentElement
      .style
      .setProperty(
        "--app-top",
        `${top}px`
      );
  }

  function isMobileComposerDevice() {
    return (
      /Android|iPhone|iPad|iPod/i
        .test(
          navigator.userAgent ||
          ""
        ) ||
      window.matchMedia
        ?.("(pointer: coarse)")
        ?.matches === true
    );
  }

  // ---------------------------------------------------------------------------
  // Chat persistence / rendering
  // ---------------------------------------------------------------------------

  function cleanStoredMessage(
    value
  ) {
    if (
      !value ||
      typeof value !==
        "object" ||
      Array.isArray(value)
    ) {
      return null;
    }

    const role =
      value.role === "user"
        ? "user"
        : value.role ===
            "assistant"
          ? "assistant"
          : "";

    if (!role) {
      return null;
    }

    const message = {
      role,
      content:
        String(
          value.content ||
          ""
        ).slice(
          0,
          MAX_STORED_MESSAGE_CHARS
        )
    };

    const attachment =
      value.attachment;

    if (
      attachment &&
      typeof attachment ===
        "object" &&
      !Array.isArray(
        attachment
      ) &&
      typeof attachment.content ===
        "string" &&
      attachment.content
    ) {
      message.attachment = {
        name:
          String(
            attachment.name ||
            GENERATED_FILE_NAME
          ).slice(
            0,
            120
          ),

        content:
          attachment.content
            .slice(
              0,
              MAX_STORED_ATTACHMENT_CHARS
            )
      };
    }

    return message;
  }

  function sanitizeChats(
    value
  ) {
    const output =
      Object.create(null);

    if (
      !value ||
      typeof value !==
        "object" ||
      Array.isArray(value)
    ) {
      return output;
    }

    const entries =
      Object.entries(value)
        .filter(
          ([id, chat]) =>
            /^[A-Za-z0-9_.-]{1,128}$/
              .test(
                String(id || "")
              ) &&
            chat &&
            typeof chat ===
              "object" &&
            !Array.isArray(chat)
        )
        .sort(
          (left, right) =>
            Number(
              right[1]
                ?.updatedAt ||
              0
            ) -
            Number(
              left[1]
                ?.updatedAt ||
              0
            )
        )
        .slice(
          0,
          MAX_STORED_CHATS
        );

    let remaining =
      MAX_STORED_TOTAL_CHARS;

    for (
      const [id, chat] of
      entries
    ) {
      if (
        remaining <= 0
      ) {
        break;
      }

      const rawMessages =
        Array.isArray(
          chat.messages
        )
          ? chat.messages
              .slice(
                -MAX_STORED_MESSAGES_PER_CHAT
              )
          : [];

      const messages = [];

      for (
        let index =
          rawMessages.length - 1;
        index >= 0;
        index--
      ) {
        const message =
          cleanStoredMessage(
            rawMessages[index]
          );

        if (!message) {
          continue;
        }

        const cost =
          message.content.length +
          (
            message.attachment
              ?.content
              ?.length ||
            0
          ) +
          256;

        if (
          cost >
          remaining
        ) {
          continue;
        }

        remaining -=
          cost;

        messages.unshift(
          message
        );
      }

      output[id] = {
        id,
        title:
          String(
            chat.title ||
            "New chat"
          ).slice(
            0,
            96
          ),
        createdAt:
          Number.isFinite(
            Number(
              chat.createdAt
            )
          )
            ? Number(
                chat.createdAt
              )
            : Date.now(),
        updatedAt:
          Number.isFinite(
            Number(
              chat.updatedAt
            )
          )
            ? Number(
                chat.updatedAt
              )
            : Date.now(),
        messages
      };
    }

    return output;
  }

  function loadChats() {
    try {
      return sanitizeChats(
        JSON.parse(
          safeStorageGet(
            STORAGE_KEY
          ) ||
          "{}"
        )
      );
    } catch {
      return Object.create(
        null
      );
    }
  }

  function saveChats() {
    const snapshot =
      sanitizeChats(
        chats
      );

    safeStorageSet(
      STORAGE_KEY,
      JSON.stringify(
        snapshot
      )
    );

    safeStorageSet(
      ACTIVE_KEY,
      activeId
    );
  }

  function createChat(
    focus = true
  ) {
    const id =
      crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    chats[id] = {
      id,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };

    activeId = id;

    saveChats();

    if (focus) {
      setTimeout(
        () =>
          els.input.focus(),
        0
      );
    }

    return id;
  }

  function currentChat() {
    return chats[activeId];
  }

  function titleFromMessage(text) {
    const clean =
      String(text)
        .replace(/\s+/g, " ")
        .trim();

    return clean.length > 42
      ? clean.slice(0, 42) +
        "..."
      : clean ||
        "New chat";
  }

  function renderAll() {
    renderMessages();
    renderRecents();
    updateSendState();
  }

  function renderRecents() {
    if (!els.recentList) return;

    els.recentList
      .replaceChildren();

    Object.values(chats)
      .filter(
        (chat) =>
          chat.messages.length
      )
      .sort(
        (a, b) =>
          b.updatedAt -
          a.updatedAt
      )
      .slice(0, 30)
      .forEach(
        (chat) => {
          const button =
            document.createElement(
              "button"
            );

          button.type =
            "button";

          button.className =
            `recent-item${chat.id === activeId ? " current" : ""}`;

          button.textContent =
            chat.title;

          button.addEventListener(
            "click",
            () => {
              activeId =
                chat.id;

              saveChats();
              renderAll();
              closeSidebar();

              navigate(
                ROUTES.chat,
                {
                  apply: true
                }
              );

              scrollToBottom();
            }
          );

          els.recentList
            .appendChild(button);
        }
      );
  }

  function renderMessages() {
    const chat =
      currentChat();

    els.messages
      .replaceChildren();

    const hasMessages =
      chat?.messages
        ?.length > 0;

    if (els.welcome) {
      els.welcome.hidden =
        hasMessages;
    }

    if (!hasMessages) {
      return;
    }

    for (
      const message of
      chat.messages
    ) {
      els.messages
        .appendChild(
          createMessageNode(
            message
          )
        );
    }

    requestAnimationFrame(
      scrollToBottom
    );
  }

  function createMessageNode(
    message
  ) {
    const outer =
      document.createElement(
        "article"
      );

    outer.className =
      `message ${message.role}`;

    if (
      message.role === "user"
    ) {
      const bubble =
        document.createElement(
          "div"
        );

      bubble.className =
        "user-bubble";

      bubble.textContent =
        message.content;

      outer.appendChild(
        bubble
      );

      return outer;
    }

    const wrap =
      document.createElement(
        "div"
      );

    wrap.className =
      "assistant-wrap";

    const name =
      document.createElement(
        "div"
      );

    name.className =
      "assistant-name assistant-brand";

    const avatar =
      document.createElement(
        "img"
      );

    avatar.className =
      "assistant-avatar";

    avatar.src =
      `${SITE_BASE_PATH}assets/fnaa-avatar.jpeg`;

    avatar.alt = "";

    const brand =
      document.createElement(
        "span"
      );

    brand.textContent =
      "Fortnite Ai Agent";

    name.append(
      avatar,
      brand
    );

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "assistant-content";

    renderMarkdown(
      body,
      message.content
    );

    wrap.append(
      name,
      body
    );

    if (
      message.attachment
        ?.content
    ) {
      appendGeneratedFile(
        wrap,
        message.attachment
      );
    }

    outer.appendChild(
      wrap
    );

    return outer;
  }

  // ---------------------------------------------------------------------------
  // Safe small markdown renderer
  // ---------------------------------------------------------------------------

  function renderMarkdown(
    container,
    source
  ) {
    container
      .replaceChildren();

    const lines =
      String(source || "")
        .replace(
          /\r\n?/g,
          "\n"
        )
        .split("\n");

    let index = 0;

    while (
      index < lines.length
    ) {
      const line =
        lines[index];

      if (/^```/.test(line)) {
        const language =
          line
            .replace(/^```/, "")
            .trim() ||
          "text";

        const code = [];

        index++;

        while (
          index < lines.length &&
          !/^```/.test(
            lines[index]
          )
        ) {
          code.push(
            lines[index++]
          );
        }

        if (
          index < lines.length
        ) {
          index++;
        }

        appendCodeBlock(
          container,
          code.join("\n"),
          language
        );

        continue;
      }

      if (!line.trim()) {
        index++;
        continue;
      }

      const heading =
        line.match(
          /^(#{1,3})\s+(.+)$/
        );

      if (heading) {
        const element =
          document.createElement(
            `h${heading[1].length}`
          );

        appendInline(
          element,
          heading[2]
        );

        container.appendChild(
          element
        );

        index++;
        continue;
      }

      if (
        /^\s*[-+*]\s+/.test(
          line
        )
      ) {
        const list =
          document.createElement(
            "ul"
          );

        while (
          index < lines.length &&
          /^\s*[-+*]\s+/.test(
            lines[index]
          )
        ) {
          const item =
            document.createElement(
              "li"
            );

          appendInline(
            item,
            lines[index]
              .replace(
                /^\s*[-+*]\s+/,
                ""
              )
          );

          list.appendChild(
            item
          );

          index++;
        }

        container.appendChild(
          list
        );

        continue;
      }

      const paragraph =
        document.createElement(
          "p"
        );

      appendInline(
        paragraph,
        line
      );

      container.appendChild(
        paragraph
      );

      index++;
    }
  }

  function appendInline(
    parent,
    text
  ) {
    const pattern =
      /(`[^`\n]+`|\*\*[^*\n]+\*\*|#[^#\n]+#\(https?:\/\/[^\s)]+\)|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

    let last = 0;
    let match;

    while (
      (
        match =
          pattern.exec(text)
      ) !== null
    ) {
      if (
        match.index > last
      ) {
        parent.append(
          document.createTextNode(
            text.slice(
              last,
              match.index
            )
          )
        );
      }

      const token =
        match[0];

      if (
        token.startsWith("`")
      ) {
        const code =
          document.createElement(
            "code"
          );

        code.className =
          "inline-code";

        code.textContent =
          token.slice(
            1,
            -1
          );

        parent.append(code);
      } else if (
        token.startsWith("**")
      ) {
        const strong =
          document.createElement(
            "strong"
          );

        strong.textContent =
          token.slice(
            2,
            -2
          );

        parent.append(strong);
      } else if (
        token.startsWith("#")
      ) {
        const link =
          token.match(
            /^#([^#\n]+)#\((https?:\/\/[^\s)]+)\)$/
          );

        if (link) {
          const anchor =
            document.createElement(
              "a"
            );

          anchor.className =
            "fnaa-masked-link";

          anchor.textContent =
            link[1];

          anchor.href =
            link[2];

          anchor.target =
            "_blank";

          anchor.rel =
            "noopener noreferrer";

          parent.append(anchor);
        }
      } else {
        const link =
          token.match(
            /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/
          );

        if (link) {
          const anchor =
            document.createElement(
              "a"
            );

          anchor.textContent =
            link[1];

          anchor.href =
            link[2];

          anchor.target =
            "_blank";

          anchor.rel =
            "noopener noreferrer";

          parent.append(anchor);
        }
      }

      last =
        pattern.lastIndex;
    }

    if (
      last < text.length
    ) {
      parent.append(
        document.createTextNode(
          text.slice(last)
        )
      );
    }
  }

  function appendCodeBlock(
    container,
    code,
    language
  ) {
    const box =
      document.createElement(
        "div"
      );

    box.className =
      "code-block";

    const head =
      document.createElement(
        "div"
      );

    head.className =
      "code-head";

    const lang =
      document.createElement(
        "span"
      );

    lang.textContent =
      language || "text";

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "copy-button";

    button.textContent =
      "Copy";

    button.addEventListener(
      "click",
      async () => {
        try {
          await navigator
            .clipboard
            .writeText(code);

          button.textContent =
            "Copied";

          setTimeout(
            () => {
              button.textContent =
                "Copy";
            },
            900
          );
        } catch {
          // Copy failure is not fatal.
        }
      }
    );

    const pre =
      document.createElement(
        "pre"
      );

    const codeElement =
      document.createElement(
        "code"
      );

    codeElement.textContent =
      code;

    pre.appendChild(
      codeElement
    );

    head.append(
      lang,
      button
    );

    box.append(
      head,
      pre
    );

    container.appendChild(
      box
    );
  }

  function appendGeneratedFile(
    parent,
    attachment
  ) {
    const card =
      document.createElement(
        "div"
      );

    card.className =
      "generated-file-card";

    const icon =
      document.createElement(
        "div"
      );

    icon.className =
      "generated-file-icon";

    icon.textContent =
      "TXT";

    const meta =
      document.createElement(
        "div"
      );

    meta.className =
      "generated-file-meta";

    const name =
      document.createElement(
        "div"
      );

    name.className =
      "generated-file-name";

    name.textContent =
      attachment.name ||
      GENERATED_FILE_NAME;

    const type =
      document.createElement(
        "div"
      );

    type.className =
      "generated-file-type";

    type.textContent =
      "Text file";

    const download =
      document.createElement(
        "button"
      );

    download.type =
      "button";

    download.className =
      "generated-file-download";

    download.textContent =
      "Download";

    download.addEventListener(
      "click",
      () => {
        const blob =
          new Blob(
            [
              attachment.content
            ],
            {
              type:
                "text/plain;charset=utf-8"
            }
          );

        const url =
          URL.createObjectURL(
            blob
          );

        const anchor =
          document.createElement(
            "a"
          );

        anchor.href = url;

        anchor.download =
          attachment.name ||
          GENERATED_FILE_NAME;

        document.body
          .appendChild(anchor);

        anchor.click();
        anchor.remove();

        setTimeout(
          () =>
            URL.revokeObjectURL(
              url
            ),
          1200
        );
      }
    );

    meta.append(
      name,
      type
    );

    card.append(
      icon,
      meta,
      download
    );

    parent.appendChild(
      card
    );
  }

  // ---------------------------------------------------------------------------
  // Chat send pipeline
  // ---------------------------------------------------------------------------

  async function sendCurrentInput() {
    const text =
      els.input.value.trim();

    if (!text) {
      return;
    }

    if (
      guestSlowmodeBlocks(
        text
      )
    ) {
      const seconds =
        Math.max(
          1,
          Math.ceil(
            guestSlowmodeRemainingMs() /
            1000
          )
        );

      showToast(
        `Slow mode enabled • ${seconds}s`,
        true
      );

      syncGuestSlowmodeUI();
      return;
    }

    els.input.value = "";
    resizeTextarea();

    await sendTextMessage(
      text
    );
  }

  function chatAbortError(
    signal
  ) {
    const error =
      new Error(
        "Chat request was replaced by a newer request."
      );

    error.name =
      "AbortError";

    error.code =
      "CHAT_REQUEST_REPLACED";

    error.reason =
      signal?.reason ||
      "cancelled";

    return error;
  }

  function chatRequestCurrent(
    runId,
    controller
  ) {
    return Boolean(
      runId ===
        activeChatRun &&
      activeChatController ===
        controller &&
      !controller.signal
        .aborted
    );
  }

  function throwIfChatStale(
    runId,
    controller
  ) {
    if (
      !chatRequestCurrent(
        runId,
        controller
      )
    ) {
      throw chatAbortError(
        controller.signal
      );
    }
  }

  async function sendTextMessage(
    text,
    options = {}
  ) {
    const clean =
      String(text || "")
        .trim();

    if (!clean) return;

    const {
      assetPath = "",
      skipRoute = false
    } = options;

    // Check the guest gate before changing routes. Description is allowed to
    // flash "X sec left" inside Tools without unexpectedly jumping to Chat.
    if (
      guestSlowmodeBlocks(
        clean
      )
    ) {
      const seconds =
        Math.max(
          1,
          Math.ceil(
            guestSlowmodeRemainingMs() /
            1000
          )
        );

      syncGuestSlowmodeUI();

      return {
        blocked: true,
        retryAfterSeconds: seconds
      };
    }

    try {
      activeChatController
        ?.abort(
          "replaced-by-new-chat-request"
        );
    } catch {}

    const controller =
      new AbortController();

    const runId =
      ++activeChatRun;

    activeChatController =
      controller;

    const signal =
      controller.signal;

    // Start the shared guest deadline on the accepted click, not after the AI
    // finishes. New Chat therefore cannot reset or bypass the active limit.
    if (
      !getPublicAuthState()
        ?.user &&
      !isSlowmodeExempt(clean)
    ) {
      startGuestSlowmode();
    }

    if (
      !skipRoute &&
      currentRoute() !==
      ROUTES.chat
    ) {
      navigate(
        ROUTES.chat,
        {
          replace: true,
          apply: true
        }
      );
    }

    const chat =
      currentChat();

    if (
      !chat.messages.length
    ) {
      chat.title =
        titleFromMessage(clean);
    }

    chat.messages.push({
      role: "user",
      content: clean
    });

    chat.updatedAt =
      Date.now();

    saveChats();

    pluginMenu.hidden = true;

    renderAll();

    setBusy(true);
    addTypingIndicator();

    const plugin =
      parsePlugin(clean);

    try {
      if (
        plugin?.id ===
        "path"
      ) {
        await runLocalPathCommand(
          chat,
          plugin,
          signal,
          runId,
          controller
        );

        throwIfChatStale(
          runId,
          controller
        );
      } else {
        const assetContext =
          assetPath
            ? await getAssetContext(
                assetPath,
                signal
              )
            : null;

        const clientContext =
          assetPath
            ? null
            : await buildClientContext(
                clean,
                signal
              );

        throwIfChatStale(
          runId,
          controller
        );

        const response =
          await requestChat(
            chat,
            {
              assetContext,
              clientContext
            },
            signal
          );

        throwIfChatStale(
          runId,
          controller
        );

        removeTypingIndicator();

        chat.messages.push({
          role: "assistant",
          content:
            String(
              response.reply ||
              ""
            ).trim() ||
            "No response."
        });
      }

      throwIfChatStale(
        runId,
        controller
      );

      chat.updatedAt =
        Date.now();

      saveChats();
      renderAll();
    } catch (error) {
      if (
        signal.aborted ||
        error?.name ===
          "AbortError" ||
        !chatRequestCurrent(
          runId,
          controller
        )
      ) {
        return {
          aborted:
            true
        };
      }

      removeTypingIndicator();

      chat.messages.push({
        role: "assistant",
        content:
          "I couldn't complete that request.\n\n" +
          `\`${String(
            error?.message ||
            error
          )}\``
      });

      chat.updatedAt =
        Date.now();

      saveChats();
      renderAll();
    } finally {
      if (
        activeChatController ===
          controller
      ) {
        activeChatController =
          null;

        setBusy(false);

        removeTypingIndicator();

        els.input.focus({
          preventScroll:
            true
        });
      }
    }
  }

  async function runLocalPathCommand(
    chat,
    plugin,
    signal,
    runId,
    controller
  ) {
    if (!plugin.query) {
      throwIfChatStale(
        runId,
        controller
      );
      chat.messages.push({
        role: "assistant",
        content:
          `Type what u want to search after \`${plugin.command}\`.`
      });

      return;
    }

    const result =
      await searchDatabase(
        "all",
        plugin.query,
        signal
      );

    throwIfChatStale(
      runId,
      controller
    );

    const reply =
      formatDatabaseResult(
        plugin,
        result
      );

    const message = {
      role: "assistant",
      content: reply.content
    };

    if (reply.attachment) {
      message.attachment =
        reply.attachment;
    }

    chat.messages.push(
      message
    );
  }

  async function requestChat(
    chat,
    context,
    signal = null
  ) {
    const loggedIn =
      !!getPublicAuthState()
        ?.user;

    const body = {
      mode: "chat",
      messages:
        compactHistoryForApi(
          chat.messages
        )
    };

    if (
      context.clientContext
    ) {
      body.client_context =
        context.clientContext;
    }

    if (
      context.assetContext
        ?.path
    ) {
      // The Worker deliberately rebuilds NovaSparx evidence server-side.
      // Never ask it to trust arbitrary browser-supplied inspection JSON.
      body.asset_context = {
        path:
          context.assetContext
            .path
      };
    }

    const response =
      await apiFetch(
        "/",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify(body),
          signal:
            signal ||
            undefined
        },
        45_000
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (signal?.aborted) {
      throw chatAbortError(
        signal
      );
    }

    if (
      !loggedIn &&
      response.status === 429
    ) {
      const retry =
        Math.max(
          1,
          Number(
            response.headers.get(
              "Retry-After"
            ) || 15
          )
        );

      const until =
        Date.now() +
        retry * 1000;

      const current =
        Number(
          safeStorageGet(
            GUEST_NEXT_AT
          ) || 0
        );

      safeStorageSet(
        GUEST_NEXT_AT,
        String(
          Math.max(
            current,
            until
          )
        )
      );

      syncGuestSlowmodeUI();
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Request failed (${response.status})`
      );
    }

    return data;
  }

  async function describePath(path) {
    const clean =
      String(path || "")
        .trim();

    if (!clean) return;

    const visible =
      `Describe this path: ${clean}`;

    return sendTextMessage(
      visible,
      {
        assetPath: clean
      }
    );
  }

  async function getAssetContext(
    path,
    signal = null
  ) {
    const clean =
      String(path || "")
        .trim();

    if (!clean) return null;

    try {
      const response =
        await apiFetch(
          `/asset/context?path=${encodeURIComponent(clean)}`,
          {
            method:
              "GET",
            signal:
              signal ||
              undefined
          },
          30_000
        );

      const data =
        await response
          .json()
          .catch(
            () => ({})
          );

      if (
        response.ok &&
        data &&
        typeof data === "object"
      ) {
        return data;
      }
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw chatAbortError(
          signal
        );
      }

      // A context lookup failure must never cause the model to invent evidence.
    }

    return {
      state: "ready",
      path: clean,
      evidence: false,
      basis: "path-only",
      facts: {},
      references: []
    };
  }

  async function buildClientContext(
    userText,
    signal = null
  ) {
    if (
      !looksLikeAssetQuestion(
        userText
      )
    ) {
      return null;
    }

    const query =
      coreSearchQuery(
        userText
      );

    if (!query) return null;

    try {
      const result =
        await searchDatabase(
          searchScope(
            userText
          ),
          query,
          signal
        );

      if (signal?.aborted) {
        throw chatAbortError(
          signal
        );
      }

      const rows =
        Array.isArray(
          result?.results
        )
          ? result.results
              .slice(0, 12)
          : [];

      return {
        version:
          CURRENT_FN_VERSION,

        requestedVersion:
          extractVersion(
            userText
          ),

        query,

        results:
          rows.map(
            (row) => ({
              path:
                String(
                  row?.path ||
                  ""
                ).slice(
                  0,
                  900
                ),

              match:
                String(
                  row?.match ||
                  "result"
                ),

              source:
                String(
                  row?.source ||
                  "database"
                )
            })
          )
      };
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw chatAbortError(
          signal
        );
      }

      return {
        version:
          CURRENT_FN_VERSION,

        requestedVersion:
          extractVersion(
            userText
          ),

        query,
        results: []
      };
    }
  }

  function compactHistoryForApi(
    messages
  ) {
    const source =
      Array.isArray(messages)
        ? messages
        : [];

    const output = [];

    let budget =
      15_000;

    for (
      let index =
        source.length - 1;

      index >= 0 &&
      output.length < 8 &&
      budget > 0;

      index--
    ) {
      const item =
        source[index];

      if (
        !item ||
        ![
          "user",
          "assistant"
        ].includes(
          item.role
        )
      ) {
        continue;
      }

      let content =
        String(
          item.content ||
          ""
        ).trim();

      if (!content) continue;

      content =
        content.slice(
          0,
          Math.min(
            3500,
            budget
          )
        );

      budget -=
        content.length;

      output.push({
        role: item.role,
        content
      });
    }

    return output.reverse();
  }

  function lastUserMessage(
    messages
  ) {
    const list =
      Array.isArray(messages)
        ? messages
        : [];

    for (
      let index =
        list.length - 1;

      index >= 0;

      index--
    ) {
      if (
        list[index]?.role ===
        "user"
      ) {
        return String(
          list[index].content ||
          ""
        ).trim();
      }
    }

    return "";
  }

  function parsePlugin(text) {
    const value =
      String(text || "")
        .trim();

    for (
      const plugin of
      PLUGINS
    ) {
      if (
        value
          .toLowerCase()
          .startsWith(
            plugin.command
              .toLowerCase()
          )
      ) {
        return {
          id: plugin.id,
          command:
            plugin.command,
          query:
            value
              .slice(
                plugin.command
                  .length
              )
              .trim()
        };
      }
    }

    return null;
  }

  function formatDatabaseResult(
    plugin,
    result
  ) {
    if (
      !result?.results
        ?.length
    ) {
      return {
        content:
          `I searched the Fortnite database for \`${plugin.query}\` and couldn't find a matching path.`
      };
    }

    const exact =
      result.results
        .filter(
          (row) =>
            row.match ===
            "exact"
        )
        .length;

    let content =
      exact
        ? `Found **${result.total}** result${result.total === 1 ? "" : "s"}.\n\n`
        : `No exact match for \`${plugin.query}\`, but i found close results:\n\n`;

    content +=
      result.results
        .slice(0, 22)
        .map(
          (row) =>
            `${row.source === "json" ? "**JSON reference**\n" : ""}` +
            "```text\n" +
            row.path +
            "\n```"
        )
        .join("\n\n");

    let attachment = null;

    if (
      result.makeFile &&
      result.allResults?.length
    ) {
      content +=
        "\n\nFull result list:";

      attachment = {
        name:
          GENERATED_FILE_NAME,

        content:
          result.allResults
            .map(
              (row, index) =>
                `${index + 1}. [${String(row.match || "result").toUpperCase()}] [${row.source}] ${row.path}`
            )
            .join("\n")
      };
    }

    return {
      content,
      attachment
    };
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  async function apiFetch(
    route,
    init = {},
    timeoutMs = 30_000
  ) {
    if (!API_ENDPOINT) {
      throw new Error(
        "FNAA API endpoint is not configured."
      );
    }

    const apiBase =
      new URL(
        API_ENDPOINT,
        location.origin
      );

    const url =
      /^https?:\/\//i.test(
        String(route || "")
      )
        ? new URL(
            String(route)
          )
        : new URL(
            `${API_ENDPOINT}${String(route || "/").startsWith("/") ? "" : "/"}${route || ""}`
          );

    if (
      url.origin !==
        apiBase.origin ||
      (
        url.protocol !==
          "https:" &&
        ![
          "localhost",
          "127.0.0.1",
          "::1"
        ].includes(
          url.hostname
        )
      ) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "FNAA API request target is not allowed."
      );
    }

    const controller =
      new AbortController();

    const externalSignal =
      init.signal ||
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

    const timeout =
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
          30_000
        )
      );

    const headers =
      new Headers(
        init.headers || {}
      );

    headers.set(
      "X-FNAA-Client",
      FNAA_CLIENT
    );

    headers.set(
      "X-FNAA-Guest-ID",
      guestId()
    );

    const token =
      String(
        window.FortniteAuth
          ?.getSessionToken?.() ||
        ""
      );

    if (
      accountState.user &&
      token
    ) {
      headers.set(
        "Authorization",
        `Bearer ${token}`
      );
    }

    const {
      signal:
        _externalSignal,
      ...fetchInit
    } = init;

    try {
      const response =
        await fetch(
          url.toString(),
          {
            ...fetchInit,
            headers,
            signal:
              controller.signal
          }
        );

      if (
        accountState.user &&
        response.status ===
          401
      ) {
        try {
          await window
            .FortniteAuth
            ?.signOut?.();
        } catch {
          // Auth state event will sync UI if available.
        }
      }

      return response;
    } finally {
      clearTimeout(
        timeout
      );

      externalSignal
        ?.removeEventListener?.(
          "abort",
          abortFromExternal
        );
    }
  }

  function guestId() {
    const existing =
      safeStorageGet(
        GUEST_ID_KEY
      );

    if (
      existing &&
      /^[A-Za-z0-9_-]{16,128}$/
        .test(existing)
    ) {
      return existing;
    }

    const value =
      (
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(36).slice(2)}`
      )
        .replace(
          /[^A-Za-z0-9_-]/g,
          "_"
        );

    safeStorageSet(
      GUEST_ID_KEY,
      value
    );

    return value;
  }

  // ---------------------------------------------------------------------------
  // Database worker
  // ---------------------------------------------------------------------------

  function ensureDbWorker() {
  if (dbWorker) {
    return dbWorker;
  }

  dbWorker =
    new Worker(
      "/Fortnite-agent/database-worker.js?v=9"
    );
    dbWorker.addEventListener(
      "message",
      (event) => {
        const {
          id,
          ok,
          data,
          error,
          code
        } =
          event.data || {};

        const pending =
          dbPending.get(id);

        if (!pending) return;

        dbPending.delete(
          id
        );

        clearTimeout(
          pending.timer
        );

        pending.signal
          ?.removeEventListener?.(
            "abort",
            pending.abortHandler
          );

        if (ok) {
          pending.resolve(
            data
          );
        } else {
          const workerError =
            new Error(
              error ||
              "Database worker error"
            );

          if (
            code ===
            "SEARCH_REPLACED"
          ) {
            workerError.name =
              "AbortError";

            workerError.code =
              "SEARCH_REPLACED";
          }

          pending.reject(
            workerError
          );
        }
      }
    );

    dbWorker.addEventListener(
      "error",
      (event) => {
        for (
          const pending of
          dbPending.values()
        ) {
          clearTimeout(
            pending.timer
          );

          pending.signal
            ?.removeEventListener?.(
              "abort",
              pending.abortHandler
            );

          pending.reject(
            new Error(
              event.message ||
              "Database worker crashed"
            )
          );
        }

        dbPending.clear();

        dbWorker
          ?.terminate();

        dbWorker = null;
      }
    );

    return dbWorker;
  }

  function searchDatabase(
    scope,
    query,
    signal = null
  ) {
    const cleanQuery =
      String(
        query || ""
      )
        .trim()
        .slice(
          0,
          512
        );

    if (signal?.aborted) {
      const error =
        new Error(
          "Database search was cancelled."
        );

      error.name =
        "AbortError";

      return Promise.reject(
        error
      );
    }

    if (!cleanQuery) {
      return Promise.resolve({
        total:
          0,
        results: [],
        allResults: [],
        makeFile:
          false,
        source:
          "none"
      });
    }

    const worker =
      ensureDbWorker();

    const id =
      ++dbSeq;

    return new Promise(
      (resolve, reject) => {
        const cleanup =
          () => {
            const pending =
              dbPending.get(
                id
              );

            if (pending) {
              clearTimeout(
                pending.timer
              );

              pending.signal
                ?.removeEventListener?.(
                  "abort",
                  pending.abortHandler
                );

              dbPending.delete(
                id
              );
            }
          };

        const abortHandler =
          () => {
            cleanup();

            try {
              worker.postMessage({
                type:
                  "cancel",
                id
              });
            } catch {}

            const error =
              new Error(
                "Database search was cancelled."
              );

            error.name =
              "AbortError";

            error.code =
              "SEARCH_REPLACED";

            reject(error);
          };

        const timer =
          setTimeout(
            () => {
              cleanup();

              try {
                worker.postMessage({
                  type:
                    "cancel",
                  id
                });
              } catch {}

              reject(
                new Error(
                  "Database search timed out."
                )
              );
            },
            30_000
          );

        dbPending.set(
          id,
          {
            resolve,
            reject,
            timer,
            signal,
            abortHandler
          }
        );

        signal
          ?.addEventListener?.(
            "abort",
            abortHandler,
            {
              once:
                true
            }
          );

        worker.postMessage({
          id,
          type:
            "search",
          scope,
          query:
            cleanQuery,
          config:
            DB_CONFIG
        });
      }
    );
  }

  function looksLikeAssetQuestion(
    text
  ) {
    return (
      /^\s*@SearchForPath\b/i
        .test(
          String(
            text || ""
          )
        ) ||
      /\b(path|asset path|mesh|staticmesh|static mesh|skeletalmesh|texture|material|icon|uasset|fortnite files|sm_|sk_|mi_|m_)\b|مسار|باث|ميش|تكستشر|ماتيريال|ملفات اللعبة|ملفات فورتنايت/i
        .test(
          String(
            text || ""
          )
        )
    );
  }

  function extractVersion(
    text
  ) {
    const match =
      String(
        text || ""
      ).match(
        /\bv?(\d{1,2}\.\d{1,2})\b/i
      );

    return match
      ? match[1]
      : "";
  }

  function searchScope(text) {
    const lower =
      String(text || "")
        .toLowerCase();

    if (
      /(^|[\s/._-])sm_/
        .test(lower) ||
      /static\s*mesh/
        .test(lower)
    ) {
      return "sm";
    }

    if (
      /(^|[\s/._-])(m_|mi_)/
        .test(lower) ||
      /\bmaterial/
        .test(lower)
    ) {
      return "m";
    }

    if (
      /(^|[\s/._-])sk_/
        .test(lower) ||
      /\b(mesh|meshes|skeletalmesh)\b|ميش/
        .test(lower)
    ) {
      return "meshes";
    }

    return "all";
  }

  function coreSearchQuery(
    text
  ) {
    const raw =
      String(text || "")
        .trim()
        .replace(
          /^@SearchForPath\b/i,
          " "
        )
        .trim();

    const id =
      raw.match(
        /\b(?:SM|SK|M|MI|T|S|A|BP|NS)_[A-Za-z0-9_]+\b/i
      );

    if (id) {
      return id[0];
    }

    const quoted =
      raw.match(
        /["“”']([^"“”']{2,100})["“”']/
      );

    if (quoted) {
      return quoted[1];
    }

    const cleaned =
      raw
        .replace(
          /\bv?\d{1,2}\.\d{1,2}\b/gi,
          " "
        )
        .replace(
          /\b(give|me|the|a|an|for|of|please|find|search|what|whats|what's|is|path|asset|mesh|static|skeletal|fortnite|files?|current|latest|new|describe)\b/gi,
          " "
        )
        .replace(
          /(انطيني|اعطيني|اريد|أريد|شنو|شسم|مسار|باث|مال|ملفات|فورتنايت|الميش|ميش)/g,
          " "
        )
        .replace(
          /[^A-Za-z0-9_\u0600-\u06FF]+/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    return (
      cleaned.slice(0, 100) ||
      raw.slice(0, 100)
    );
  }

  // ---------------------------------------------------------------------------
  // Guest slow mode
  // ---------------------------------------------------------------------------

  function getPublicAuthState() {
    return (
      window.FortniteAuth
        ?.getState?.() ||
      accountState ||
      {}
    );
  }

  function isSlowmodeExempt(
    text
  ) {
    const value =
      String(text || "");

    if (
      /^\s*@SearchForPath\b/i
        .test(value)
    ) {
      return true;
    }

    return isNaturalSetupRequest(
      value
    );
  }

  function isNaturalSetupRequest(
    text
  ) {
    const value =
      String(text || "")
        .toLowerCase();

    const asksHow =
      /\b(how|how to|setup|set up|install|do|use|teach|guide|tutorial|where|put|place)\b/i
        .test(value) ||
      /شلون|طريقة|سيتب|تنصيب|ثبت|وين|حط|شرح/
        .test(value);

    if (!asksHow) {
      return false;
    }

    return (
      /\bmesh\s*method\b|\borange\s*white\s*copy\b|\borange\/white\s*copy\b|\borange\s*copy\b|\bdev\s*inventory\b|\bdeveloper\s*inventory\b|طريقة\s*الميش|اورنج\s*وايت|ديف\s*انفنتوري/
        .test(value)
    );
  }

  function guestSlowmodeRemainingMs() {
    if (
      getPublicAuthState()
        ?.user
    ) {
      return 0;
    }

    return Math.max(
      0,
      Number(
        safeStorageGet(
          GUEST_NEXT_AT
        ) || 0
      ) -
      Date.now()
    );
  }

  function guestSlowmodeBlocks(
    text
  ) {
    return (
      !getPublicAuthState()
        ?.user &&
      !isSlowmodeExempt(text) &&
      guestSlowmodeRemainingMs() >
        0
    );
  }

  function ensureGuestSlowmodeBanner() {
    let banner =
      $("fnaaGuestSlowmodeBanner");

    if (banner) {
      return banner;
    }

    const inner =
      els.composer
        ?.querySelector(
          ".composer-inner"
        );

    if (
      !els.composer ||
      !inner
    ) {
      return null;
    }

    banner =
      document.createElement(
        "div"
      );

    banner.id =
      "fnaaGuestSlowmodeBanner";

    banner.className =
      "fnaa-guest-slowmode-banner";

    banner.hidden = true;

    banner.setAttribute(
      "role",
      "status"
    );

    banner.setAttribute(
      "aria-live",
      "polite"
    );

    els.composer.insertBefore(
      banner,
      inner
    );

    return banner;
  }

  function syncGuestSlowmodeUI() {
    const banner =
      ensureGuestSlowmodeBanner();

    const loggedIn =
      !!getPublicAuthState()
        ?.user;

    const remaining =
      loggedIn
        ? 0
        : guestSlowmodeRemainingMs();

    if (
      remaining > 0
    ) {
      const seconds =
        Math.max(
          1,
          Math.ceil(
            remaining /
            1000
          )
        );

      document.documentElement
        .classList
        .add(
          "fnaa-guest-slowmode-active"
        );

      if (banner) {
        banner.hidden = false;

        banner.textContent =
          `Slow mode enabled • ${seconds}s`;
      }

      if (!slowmodeTimer) {
        slowmodeTimer =
          setInterval(
            syncGuestSlowmodeUI,
            200
          );
      }

      updateSendState();
      return;
    }

    if (slowmodeTimer) {
      clearInterval(
        slowmodeTimer
      );

      slowmodeTimer = null;
    }

    document.documentElement
      .classList
      .remove(
        "fnaa-guest-slowmode-active"
      );

    if (banner) {
      banner.hidden = true;
      banner.textContent = "";
    }

    updateSendState();
  }

  function startGuestSlowmode() {
    if (
      getPublicAuthState()
        ?.user
    ) {
      return;
    }

    safeStorageSet(
      GUEST_NEXT_AT,
      String(
        Date.now() +
        GUEST_SLOWMODE_MS
      )
    );

    syncGuestSlowmodeUI();
  }

  // ---------------------------------------------------------------------------
  // Composer / plugins / typing
  // ---------------------------------------------------------------------------

  function updatePluginMenu() {
    const value =
      String(
        els.input.value ||
        ""
      );

    const caret =
      els.input
        .selectionStart ??
      value.length;

    const before =
      value.slice(
        0,
        caret
      );

    const at =
      before.lastIndexOf("@");

    if (at < 0) {
      pluginMenu.hidden = true;
      return;
    }

    const between =
      before.slice(
        at + 1
      );

    if (/\s/.test(between)) {
      pluginMenu.hidden = true;
      return;
    }

    const query =
      between.toLowerCase();

    const visible =
      PLUGINS.filter(
        (plugin) =>
          !query ||
          `${plugin.label} ${plugin.command} ${plugin.description}`
            .toLowerCase()
            .includes(query)
      );

    if (!visible.length) {
      pluginMenu.hidden = true;
      return;
    }

    pluginMenu
      .replaceChildren();

    const header =
      document.createElement(
        "div"
      );

    header.className =
      "plugin-panel-header";

    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      "Commands";

    const badge =
      document.createElement(
        "span"
      );

    badge.className =
      "plugin-panel-badge";

    badge.textContent =
      "FNAA";

    header.append(
      title,
      badge
    );

    pluginMenu.appendChild(
      header
    );

    visible.forEach(
      (plugin, index) => {
        const button =
          document.createElement(
            "button"
          );

        button.type =
          "button";

        button.className =
          `plugin-option${index === 0 ? " selected" : ""}`;

        button.dataset.command =
          plugin.command;

        const icon =
          document.createElement(
            "span"
          );

        icon.className =
          "plugin-icon";

        icon.textContent =
          plugin.icon;

        const info =
          document.createElement(
            "span"
          );

        info.className =
          "plugin-info";

        const name =
          document.createElement(
            "span"
          );

        name.className =
          "plugin-title";

        name.textContent =
          `@${plugin.label}`;

        const description =
          document.createElement(
            "small"
          );

        description.textContent =
          plugin.description;

        info.append(
          name,
          description
        );

        button.append(
          icon,
          info
        );

        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            selectPlugin(
              plugin.command
            );
          }
        );

        pluginMenu
          .appendChild(button);
      }
    );

    pluginMenu.hidden = false;

    requestAnimationFrame(
      positionPluginMenu
    );
  }

  function positionPluginMenu() {
    if (
      pluginMenu.hidden
    ) {
      return;
    }

    const viewport =
      window.visualViewport;

    const visibleHeight =
      viewport?.height ||
      window.innerHeight;

    const maxHeight =
      Math.max(
        150,
        Math.min(
          320,
          visibleHeight *
          0.46
        )
      );

    pluginMenu.style.maxHeight =
      `${maxHeight}px`;
  }

  function movePluginSelection(
    direction
  ) {
    const options =
      [
        ...pluginMenu.querySelectorAll(
          ".plugin-option"
        )
      ];

    if (!options.length) {
      return;
    }

    let index =
      options.findIndex(
        (item) =>
          item.classList
            .contains(
              "selected"
            )
      );

    if (index < 0) {
      index = 0;
    }

    options[index]
      .classList
      .remove("selected");

    index =
      (
        index +
        direction +
        options.length
      ) %
      options.length;

    options[index]
      .classList
      .add("selected");

    options[index]
      .scrollIntoView({
        block: "nearest"
      });
  }

  function selectPlugin(
    command
  ) {
    const value =
      els.input.value;

    const caret =
      els.input
        .selectionStart ??
      value.length;

    const before =
      value.slice(
        0,
        caret
      );

    const after =
      value.slice(
        caret
      );

    const at =
      before.lastIndexOf("@");

    const start =
      at >= 0
        ? at
        : caret;

    const next =
      before.slice(
        0,
        start
      ) +
      command +
      " " +
      after;

    els.input.value =
      next;

    const position =
      before.slice(
        0,
        start
      ).length +
      command.length +
      1;

    els.input
      .setSelectionRange(
        position,
        position
      );

    pluginMenu.hidden = true;

    resizeTextarea();
    updateSendState();

    els.input.focus({
      preventScroll: true
    });
  }

  function resizeTextarea() {
    els.input.style.height =
      "auto";

    els.input.style.height =
      `${Math.min(
        140,
        els.input.scrollHeight
      )}px`;

    if (
      !pluginMenu.hidden
    ) {
      requestAnimationFrame(
        positionPluginMenu
      );
    }
  }

  function updateSendState() {
    const text =
      els.input.value.trim();

    const blocked =
      text &&
      guestSlowmodeBlocks(
        text
      );

    els.send.disabled =
      !text ||
      blocked;
  }

  function setBusy(value) {
    busy =
      Boolean(value);

    updateSendState();
  }

  function addTypingIndicator() {
    removeTypingIndicator();

    const article =
      document.createElement(
        "article"
      );

    article.id =
      "typingIndicator";

    article.className =
      "message assistant";

    article.innerHTML = `
      <div class="assistant-wrap">
        <div class="assistant-name assistant-brand">
          <img
            class="assistant-avatar"
            src="${SITE_BASE_PATH}assets/fnaa-avatar.jpeg"
            alt=""
          />
          <span>Fortnite Ai Agent</span>
        </div>

        <div class="assistant-content">
          <p>Thinking...</p>
        </div>
      </div>`;

    els.messages
      .appendChild(article);

    scrollToBottom();
  }

  function removeTypingIndicator() {
    $("typingIndicator")
      ?.remove();
  }

  function scrollToBottom() {
    if (!els.chat) return;

    els.chat.scrollTop =
      els.chat.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Sidebar / overlays / toast
  // ---------------------------------------------------------------------------

  function openSidebar() {
    els.sidebar
      ?.classList
      .add("open");

    els.scrim
      ?.classList
      .add("show");

    els.sidebar
      ?.setAttribute(
        "aria-hidden",
        "false"
      );
  }

  function closeSidebar() {
    els.sidebar
      ?.classList
      .remove("open");

    els.scrim
      ?.classList
      .remove("show");

    els.sidebar
      ?.setAttribute(
        "aria-hidden",
        "true"
      );
  }

  function openSettings(
    updateRoute = true
  ) {
    renderAccountUI();
    syncThemeButtons();
    syncSettingsApiCard();

    els.settingsOverlay.hidden =
      false;

    document.body.classList.add(
      "fnaa-settings-open"
    );

    els.settingsOverlay
      .setAttribute(
        "aria-hidden",
        "false"
      );

    window.FortniteI18n
      ?.apply?.(
        els.settingsOverlay
      );

    if (updateRoute) {
      navigate(
        ROUTES.settings,
        {
          replace: true
        }
      );
    }
  }

  function closeSettingsOnly() {
    if (!els.settingsOverlay) {
      return;
    }

    els.settingsOverlay.hidden =
      true;

    document.body.classList.remove(
      "fnaa-settings-open"
    );

    els.settingsOverlay
      .setAttribute(
        "aria-hidden",
        "true"
      );
  }

  function closeToolsOnly() {
    window.FortniteTools
      ?.close?.();
  }

  function showToast(
    text,
    isError = false
  ) {
    if (!els.toast) return;

    clearTimeout(
      toastTimer
    );

    els.toast.textContent =
      text;

    els.toast.classList
      .toggle(
        "error",
        isError
      );

    els.toast.classList
      .add("show");

    toastTimer =
      setTimeout(
        () =>
          els.toast
            .classList
            .remove("show"),
        1900
      );
  }

  // ---------------------------------------------------------------------------
  // Authentication / profile
  // ---------------------------------------------------------------------------

  async function maybeShowLoginGate() {
    const guestMode =
      sessionStorage.getItem(
        LOGIN_MODE_SESSION
      ) === "guest";

    if (guestMode) {
      handleAuthState({
        configured: true,
        user: null,
        profile: null
      });

      return;
    }

    try {
      await Promise.race([
        window.FORTNITE_AUTH_READY,

        new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              5000
            )
        )
      ]);
    } catch {
      // Auth startup failure is displayed by the gate.
    }

    const state =
      window.FortniteAuth
        ?.getState?.() ||
      {};

    handleAuthState(
      state
    );

    if (state.user) {
      els.loginGate.hidden =
        true;

      if (
        state.profile &&
        state.profile
          .setupComplete ===
          false
      ) {
        window.FortniteAuth
          ?.skipSetup?.()
          .catch(
            () => {}
          );
      }

      return;
    }

    showWelcomeGate();
  }

  function handleAuthState(
    detail
  ) {
    accountState = {
      configured:
        detail.configured !==
        false,

      user:
        detail.user ||
        null,

      profile:
        detail.profile ||
        null,

      error:
        detail.error ||
        null
    };

    if (
      accountState.user
    ) {
      sessionStorage.setItem(
        LOGIN_MODE_SESSION,
        "openrouter"
      );

      if (els.loginGate) {
        els.loginGate.hidden =
          true;
      }

      if (
        accountState.profile
          ?.setupComplete ===
        false
      ) {
        window.FortniteAuth
          ?.skipSetup?.()
          .catch(
            () => {}
          );
      }
    } else if (
      sessionStorage.getItem(
        LOGIN_MODE_SESSION
      ) === "openrouter"
    ) {
      sessionStorage.removeItem(
        LOGIN_MODE_SESSION
      );

      if (
        els.loginGate?.hidden
      ) {
        showWelcomeGate();
      }
    }

    renderAccountUI();
    syncGuestUI();
    syncGuestSlowmodeUI();
    syncSettingsApiCard();

    window.dispatchEvent(
      new Event(
        "fortnite-login-mode-changed"
      )
    );
  }

  function continueAsGuest() {
    sessionStorage.setItem(
      LOGIN_MODE_SESSION,
      "guest"
    );

    accountState = {
      configured: true,
      user: null,
      profile: null,
      error: null
    };

    els.loginGate.hidden =
      true;

    renderAccountUI();
    syncGuestUI();
    syncGuestSlowmodeUI();

    window.dispatchEvent(
      new Event(
        "fortnite-login-mode-changed"
      )
    );
  }

  function showWelcomeGate() {
    if (!els.loginGate) {
      return;
    }

    els.loginGate.hidden =
      false;

    els.loginGate.innerHTML = `
      <div class="login-card login-card-polished fnaa-login-simple">
        <h1 class="login-brand brand-with-avatar">
          <img
            class="brand-avatar login-brand-avatar"
            src="${SITE_BASE_PATH}assets/fnaa-avatar.jpeg"
            alt=""
          />
          <span>Fortnite Ai Agent</span>
        </h1>

        <div class="fnaa-login-actions">
          <button
            class="login-primary openrouter-login-button"
            id="loginMain"
            type="button"
          >Log in</button>

          <button
            class="login-secondary openrouter-create-button"
            id="createAccountMain"
            type="button"
          >Create New</button>
        </div>

        <div
          id="openRouterLoginStatus"
          class="fnaa-login-status"
          role="status"
          aria-live="polite"
        ></div>

        <div class="login-inline-text login-guest-line">
          <span>Account for free or continue as a</span>

          <button
            class="login-link-button"
            id="loginGuest"
            type="button"
          >guest</button>
        </div>
      </div>`;

    window.FortniteI18n
      ?.apply?.(
        els.loginGate
      );

    $("loginMain")
      ?.addEventListener(
        "click",
        () =>
          showOpenRouterLogin(
            "login"
          )
      );

    $("createAccountMain")
      ?.addEventListener(
        "click",
        () =>
          showOpenRouterLogin(
            "create"
          )
      );

    $("loginGuest")
      ?.addEventListener(
        "click",
        continueAsGuest
      );

    const authState =
      window.FortniteAuth
        ?.getState?.() ||
      {};

    if (authState.error) {
      const status =
        $("openRouterLoginStatus");

      if (status) {
        status.textContent =
          friendlyAuthError(
            authState.error
          );

        status.classList
          .add("error");
      }
    }
  }

  function resetOpenRouterButton() {
    const loginButton =
      $("loginMain");

    const createButton =
      $("createAccountMain");

    if (loginButton) {
      loginButton.disabled =
        false;

      loginButton.textContent =
        "Log in";
    }

    if (createButton) {
      createButton.disabled =
        false;

      createButton.textContent =
        "Create New";
    }
  }

  async function showOpenRouterLogin(
    mode = "login"
  ) {
    const auth =
      window.FortniteAuth;

    const loginButton =
      $("loginMain");

    const createButton =
      $("createAccountMain");

    const activeButton =
      mode === "create"
        ? createButton
        : loginButton;

    const status =
      $("openRouterLoginStatus");

    if (!auth?.configured) {
      if (status) {
        status.textContent =
          "Account login is temporarily unavailable.";

        status.classList
          .add("error");
      }

      return;
    }

    if (loginButton) {
      loginButton.disabled = true;
    }

    if (createButton) {
      createButton.disabled = true;
    }

    if (activeButton) {
      activeButton.textContent =
        mode === "create"
          ? "Opening account setup…"
          : "Opening login…";
    }

    if (status) {
      status.classList
        .remove("error");

      status.textContent =
        "";
    }

    try {
      // OpenRouter's authorization page handles both existing-account login
      // and creating a new free account. FNAA keeps two clear entry buttons
      // while using one secure provider flow.
      await auth
        .signInDefault();
    } catch (error) {
      resetOpenRouterButton();

      if (status) {
        status.textContent =
          friendlyAuthError(
            error
          );

        status.classList
          .add("error");
      } else {
        showToast(
          friendlyAuthError(
            error
          ),
          true
        );
      }
    }
  }

  function showGoogleLogin() {
    return showOpenRouterLogin();
  }

  function friendlyAuthError(
    error
  ) {
    const raw =
      String(
        error?.message ||
        error ||
        ""
      );

    if (/cancel/i.test(raw)) {
      return (
        "OpenRouter authorization was cancelled."
      );
    }

    if (/expired/i.test(raw)) {
      return (
        "OpenRouter login expired. Try again."
      );
    }

    if (
      /timeout|AbortError|LOGIN_TIMEOUT/i
        .test(raw)
    ) {
      return (
        "OpenRouter took too long to respond. Try again."
      );
    }

    return (
      "OpenRouter login is temporarily unavailable. Try again or continue as guest."
    );
  }

  function ensureGuestLoginButton() {
    let button =
      $("fnaaGuestQuickLogin");

    if (button) {
      return button;
    }

    const topbar =
      document.querySelector(
        ".topbar"
      );

    if (!topbar) {
      return null;
    }

    button =
      document.createElement(
        "button"
      );

    button.id =
      "fnaaGuestQuickLogin";

    button.type =
      "button";

    button.className =
      "fnaa-guest-login";

    button.textContent =
      "Log in";

    button.addEventListener(
      "click",
      () => {
        if (
          accountState.user
        ) {
          navigate(
            ROUTES.settings,
            {
              apply: true
            }
          );
        } else {
          showWelcomeGate();
        }
      }
    );

    topbar.appendChild(
      button
    );

    return button;
  }

  function syncGuestUI() {
    const loggedIn =
      !!accountState.user;

    const quick =
      ensureGuestLoginButton();

    if (quick) {
      quick.hidden =
        loggedIn;
    }

    const guestBanner =
      $("guestLoginBanner");

    if (
      guestBanner &&
      loggedIn
    ) {
      guestBanner.hidden =
        true;
    }
  }

  function ensureSettingsApiCard() {
    let card =
      $("fnaaSettingsApiCard");

    if (card) {
      return card;
    }

    const settingsContent =
      document.querySelector(
        ".settings-content"
      );

    if (!settingsContent) {
      return null;
    }

    card =
      document.createElement(
        "section"
      );

    card.id =
      "fnaaSettingsApiCard";

    card.className =
      "settings-card settings-stack-card fnaa-api-settings-card";

    card.innerHTML = `
      <div class="settings-card-icon">API</div>

      <div class="settings-card-main">
        <h2 data-fnaa-api-title>
          OpenRouter Account
        </h2>

        <p id="fnaaSettingsApiState"></p>

        <div class="fnaa-api-actions">
          <button
            id="fnaaSettingsApiSave"
            class="tool-button primary"
            type="button"
          ></button>

          <button
            id="fnaaSettingsApiRemove"
            class="tool-button"
            type="button"
          ></button>
        </div>
      </div>`;

    const owner =
      settingsContent.querySelector(
        ".owner-settings-card"
      );

    if (owner) {
      settingsContent.insertBefore(
        card,
        owner
      );
    } else {
      settingsContent.appendChild(
        card
      );
    }

    card
      .querySelector(
        "#fnaaSettingsApiSave"
      )
      ?.addEventListener(
        "click",
        () =>
          showOpenRouterLogin(
            "login"
          )
      );

    card
      .querySelector(
        "#fnaaSettingsApiRemove"
      )
      ?.addEventListener(
        "click",
        async () => {
          try {
            await window.FortniteAuth
              ?.signOut?.();

            showToast(
              "Signed out"
            );
          } catch (error) {
            showToast(
              String(
                error?.message ||
                error
              ),
              true
            );
          }
        }
      );

    return card;
  }

  function syncSettingsApiCard() {
    const card =
      ensureSettingsApiCard();

    if (!card) return;

    const state =
      card.querySelector(
        "#fnaaSettingsApiState"
      );

    const connect =
      card.querySelector(
        "#fnaaSettingsApiSave"
      );

    const remove =
      card.querySelector(
        "#fnaaSettingsApiRemove"
      );

    const loggedIn =
      !!accountState.user;

    if (!loggedIn) {
      if (state) {
        state.textContent =
          copyText(
            "Guest uses FNAA access + 15s slow mode.",
            "L’invité utilise l’accès FNAA + mode lent 15 s.",
            "الضيف يستخدم FNAA + سلو مود 15 ثانية."
          );
      }

      if (connect) {
        connect.textContent =
          "Continue with OpenRouter";

        connect.disabled =
          false;
      }

      if (remove) {
        remove.hidden = true;
      }

      return;
    }

    if (state) {
      state.textContent =
        copyText(
          "OpenRouter account connected.",
          "Compte OpenRouter connecté.",
          "حساب OpenRouter مربوط."
        );
    }

    if (connect) {
      connect.textContent =
        copyText(
          "Reconnect",
          "Reconnecter",
          "إعادة الربط"
        );

      connect.disabled =
        false;
    }

    if (remove) {
      remove.textContent =
        copyText(
          "Sign out",
          "Se déconnecter",
          "تسجيل الخروج"
        );

      remove.hidden =
        false;
    }
  }

  function copyText(
    en,
    fr,
    ar
  ) {
    const language =
      window.FortniteI18n
        ?.getLanguage?.() ||
      "en";

    if (language === "ar") {
      return ar;
    }

    if (language === "fr") {
      return fr;
    }

    return en;
  }

  function renderAccountUI() {
    if (
      !els.profileAvatar
    ) {
      return;
    }

    const loggedIn =
      !!accountState.user;

    const username =
      loggedIn
        ? (
            accountState.profile
              ?.username ||
            "User"
          )
        : "Guest";

    els.profileAvatar.src =
      loggedIn
        ? profileAvatarSrc()
        : DEFAULT_USER_AVATAR;

    els.profileUsernameButton
      .textContent =
      `@${username}`;

    els.profileAccountType
      .textContent =
      loggedIn
        ? "OpenRouter account"
        : "Guest";

    els.accountActionButton
      .textContent =
      loggedIn
        ? "Sign out"
        : "Log in";

    els.profileAvatarButton
      .classList
      .toggle(
        "profile-locked",
        !loggedIn
      );

    els.profileUsernameButton
      .classList
      .toggle(
        "profile-locked",
        !loggedIn
      );
  }

  function profileAvatarSrc() {
    return (
      accountState.profile
        ?.avatar ||
      DEFAULT_USER_AVATAR
    );
  }

  function showUsernameEditor() {
    if (!accountState.user) {
      showWelcomeGate();
      return;
    }

    const current =
      accountState.profile
        ?.username ||
      "";

    els.loginGate.hidden =
      false;

    els.loginGate.innerHTML = `
      <div class="login-card login-card-polished username-edit-card">
        <button
          class="login-back"
          id="usernameBack"
          type="button"
          aria-label="Back"
        >‹</button>

        <h1 data-i18n="changeUsername">
          Change username
        </h1>

        <p data-i18n="usernameHint">
          Type Whatever u want — 9 characters max.
        </p>

        <input
          id="usernameEditInput"
          class="profile-username-input"
          value="${escapeAttr(current)}"
          placeholder="Type Whatever u want"
          maxlength="9"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />

        <div class="username-counter">
          <span id="usernameEditCount">
            ${Array.from(current).length}
          </span>/9
        </div>

        <button
          id="usernameSave"
          class="login-primary"
          type="button"
          data-i18n="save"
        >Save</button>
      </div>`;

    window.FortniteI18n
      ?.apply?.(
        els.loginGate
      );

    const input =
      $("usernameEditInput");

    const counter =
      $("usernameEditCount");

    enforceNineChars(
      input,
      counter
    );

    $("usernameBack")
      ?.addEventListener(
        "click",
        () => {
          els.loginGate.hidden =
            true;
        }
      );

    $("usernameSave")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await window.FortniteAuth
              ?.saveUsername?.(
                input.value
              );

            els.loginGate.hidden =
              true;

            renderAccountUI();

            showToast(
              "Username updated"
            );
          } catch (error) {
            showToast(
              String(
                error?.message ||
                error
              ),
              true
            );
          }
        }
      );
  }

  function enforceNineChars(
    input,
    counter
  ) {
    if (
      !input ||
      !counter
    ) {
      return;
    }

    input.addEventListener(
      "input",
      () => {
        const chars =
          Array.from(
            input.value
          );

        if (
          chars.length > 9
        ) {
          input.value =
            chars
              .slice(0, 9)
              .join("");
        }

        counter.textContent =
          String(
            Array.from(
              input.value
            ).length
          );
      }
    );
  }

  async function processAvatarFile(
    file
  ) {
    if (!file) {
      throw new Error(
        "Choose an image first."
      );
    }

    const allowed =
      new Set([
        "image/jpeg",
        "image/png",
        "image/webp"
      ]);

    if (
      !allowed.has(
        file.type
      )
    ) {
      throw new Error(
        "Use JPG, PNG or WEBP only."
      );
    }

    if (
      file.size >
      3 * 1024 * 1024
    ) {
      throw new Error(
        "Image must be 3 MB or less."
      );
    }

    const url =
      URL.createObjectURL(
        file
      );

    try {
      const image =
        await new Promise(
          (
            resolve,
            reject
          ) => {
            const img =
              new Image();

            img.onload =
              () =>
                resolve(img);

            img.onerror =
              () =>
                reject(
                  new Error(
                    "Couldn't read that image."
                  )
                );

            img.src = url;
          }
        );

      if (
        !image.naturalWidth ||
        !image.naturalHeight
      ) {
        throw new Error(
          "Invalid image."
        );
      }

      if (
        image.naturalWidth >
          6000 ||
        image.naturalHeight >
          6000
      ) {
        throw new Error(
          "Image dimensions are too large."
        );
      }

      const size =
        Math.min(
          image.naturalWidth,
          image.naturalHeight
        );

      const sourceX =
        Math.floor(
          (
            image.naturalWidth -
            size
          ) /
          2
        );

      const sourceY =
        Math.floor(
          (
            image.naturalHeight -
            size
          ) /
          2
        );

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width = 256;
      canvas.height = 256;

      const context =
        canvas.getContext(
          "2d",
          {
            alpha: false
          }
        );

      if (!context) {
        throw new Error(
          "Image processing isn't available."
        );
      }

      context.drawImage(
        image,
        sourceX,
        sourceY,
        size,
        size,
        0,
        0,
        256,
        256
      );

      let dataUrl =
        canvas.toDataURL(
          "image/jpeg",
          0.84
        );

      if (
        dataUrl.length >
        175_000
      ) {
        dataUrl =
          canvas.toDataURL(
            "image/jpeg",
            0.68
          );
      }

      if (
        dataUrl.length >
        180_000
      ) {
        throw new Error(
          "Image is still too large after processing."
        );
      }

      return dataUrl;
    } finally {
      URL.revokeObjectURL(
        url
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  function applyTheme(theme) {
    const allowed =
      new Set([
        "black",
        "white",
        "fortnite"
      ]);

    const next =
      allowed.has(theme)
        ? theme
        : "fortnite";

    document.documentElement
      .dataset.theme =
      next;

    safeStorageSet(
      THEME_KEY,
      next
    );

    const meta =
      document.querySelector(
        'meta[name="theme-color"]'
      );

    if (meta) {
      meta.setAttribute(
        "content",
        next === "white"
          ? "#f5f5f5"
          : next === "fortnite"
            ? "#0a0524"
            : "#000000"
      );
    }

    syncThemeButtons();
  }

  function syncThemeButtons() {
    const current =
      document.documentElement
        .dataset.theme ||
      "fortnite";

    for (
      const button of
      document.querySelectorAll(
        "[data-theme-choice]"
      )
    ) {
      button.classList
        .toggle(
          "active",
          button.dataset
            .themeChoice ===
          current
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Misc
  // ---------------------------------------------------------------------------

  function copyTextToClipboard(
    value
  ) {
    return navigator.clipboard
      .writeText(
        String(value || "")
      );
  }

  function escapeAttr(value) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[character]
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.FortniteAgent =
    Object.freeze({
      version: "1.0.2",

      searchDatabase,
      describePath,
      apiFetch,
      navigate,

      showApiLogin:
        showWelcomeGate,

      showOpenRouterLogin,
      showGoogleLogin,

      showToast,

      getRoute:
        currentRoute,

      getGuestSlowmodeRemainingSeconds:
        () =>
          Math.max(
            0,
            Math.ceil(
              guestSlowmodeRemainingMs() /
              1000
            )
          ),

      beginGuestToolSlowmode:
        () => {
          if (
            getPublicAuthState()
              ?.user
          ) {
            return 0;
          }

          startGuestSlowmode();

          return Math.max(
            1,
            Math.ceil(
              guestSlowmodeRemainingMs() /
              1000
            )
          );
        },

      isSignedIn:
        () =>
          !!getPublicAuthState()
            ?.user,

      getAccountState:
        () => ({
          ...accountState
        })
    });

  console.info(
    "FNAA 1.0 loaded."
  );
})();
