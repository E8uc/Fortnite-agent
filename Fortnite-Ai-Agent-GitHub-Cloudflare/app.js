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
    new URL(".", document.baseURI)
      .pathname;

  const CURRENT_FN_VERSION =
    CONFIG.fortniteVersion ||
    "42.20";

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

  const USAGE_KEY =
    "fortniteAiAgent.usage.v1";

  const DAILY_CHAT_LIMIT =
    Math.max(
      1,
      Math.min(
        500,
        Number(
          CONFIG.dailyChatLimit ||
          50
        ) || 50
      )
    );

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
    newChatTop: $("newChatTop"),
    chatMenuButton: $("chatMenuButton"),
    moreToolsBtn: $("moreToolsBtn"),
    settingsBtn: $("settingsBtn"),

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
      $("accountActionButton"),

    usageTitle:
      $("e8UsageTitle"),

    usageSummary:
      $("e8UsageSummary"),

    usageProgress:
      $("e8UsageProgress"),

    usageReset:
      $("e8UsageReset")
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

  let editingUserMessageIndex = -1;

  let newChatTransitioning = false;

  let activeChatController =
    null;

  let activeChatRun =
    0;

  let chatUiModule =
    null;

  let chatUiPromise =
    null;

  let toastTimer = null;

  let dbWorker = null;
  let dbSeq = 0;

  let slowmodeTimer = null;

  let usageTimer = null;

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
  syncChatChromeLabels();
  renderAll();
  ensureGuestLoginButton();
  ensureSettingsApiCard();

  maybeShowLoginGate();
  syncVisualViewport();
  syncGuestSlowmodeUI();
  syncUsageUI();

  queueMicrotask(
    applyCurrentRoute
  );

  window.addEventListener(
    "pageshow",
    () => {
      resetOpenRouterButton();
      syncGuestSlowmodeUI();
      syncUsageUI();
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
    closeChatUiIfLoaded();

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

  function e8ActionIconMarkup(
    name,
    size = 20
  ) {
    const icons = {
      copy:
        '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path>',

      feedback:
        '<path d="M3 11h3v7H3z"></path><path d="M6 11l2.3-5A2 2 0 0 1 10.1 5H11v6h3.2a1.8 1.8 0 0 1 1.7 2.4L14.7 17H9.3A3.3 3.3 0 0 1 6 13.7Z"></path><path d="M29 13h-3V6h3z"></path><path d="M26 13l-2.3 5a2 2 0 0 1-1.8 1H21v-6h-3.2a1.8 1.8 0 0 1-1.7-2.4L17.3 7h5.4A3.3 3.3 0 0 1 26 10.3Z"></path>',

      pin:
        '<path d="M12 17v5"></path><path d="m5 17 5-5"></path><path d="M15 3l6 6-4 1-5 5-3-3 5-5Z"></path>'
    };

    const viewBox =
      name === "feedback"
        ? "0 0 32 24"
        : "0 0 24 24";

    return `<svg aria-hidden="true" viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;
  }

  async function loadChatUi() {
    if (chatUiModule) {
      return chatUiModule;
    }

    if (!chatUiPromise) {
      chatUiPromise =
        import(
          `${SITE_BASE_PATH}e8-chat-ui.js?v=2`
        )
          .then(
            (module) => {
              chatUiModule =
                module;

              return module;
            }
          )
          .catch(
            (error) => {
              chatUiPromise =
                null;

              throw error;
            }
          );
    }

    return chatUiPromise;
  }

  function closeChatUiIfLoaded() {
    chatUiModule
      ?.close?.();
  }

  async function startNewChat() {
    if (newChatTransitioning) {
      return;
    }

    newChatTransitioning = true;

    try {
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
    closeChatUiIfLoaded();

    editingUserMessageIndex =
      -1;

    const reducedMotion =
      window.matchMedia
        ?.("(prefers-reduced-motion: reduce)")
        ?.matches === true;

    if (
      !reducedMotion &&
      els.chat
    ) {
      els.chat.classList.add(
        "e8-new-chat-leave"
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            90
          )
      );
    }

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

    if (els.chat) {
      els.chat.classList.remove(
        "e8-new-chat-leave"
      );

      if (!reducedMotion) {
        els.chat.classList.add(
          "e8-new-chat-enter"
        );

        setTimeout(
          () =>
            els.chat
              ?.classList.remove(
                "e8-new-chat-enter"
              ),
          220
        );
      }
    }
    } finally {
      newChatTransitioning = false;
    }
  }
  function togglePinChat() {
    const chat =
      currentChat();

    if (!chat) return;

    chat.pinned =
      !chat.pinned;

    chat.updatedAt =
      Date.now();

    saveChats();
    renderRecents();

    showToast(
      chat.pinned
        ? copyText(
            "Chat pinned",
            "Discussion épinglée",
            "تم تثبيت المحادثة"
          )
        : copyText(
            "Chat unpinned",
            "Discussion désépinglée",
            "تم إلغاء تثبيت المحادثة"
          )
    );
  }

  function renameActiveChat(
    next
  ) {
    const chat =
      currentChat();

    const clean =
      String(next || "")
        .replace(
          /\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          96
        );

    if (
      !chat ||
      !clean
    ) {
      return;
    }

    chat.title =
      clean;

    chat.updatedAt =
      Date.now();

    saveChats();
    renderRecents();

    showToast(
      copyText(
        "Chat renamed",
        "Discussion renommée",
        "تمت إعادة تسمية المحادثة"
      )
    );
  }

  function deleteActiveChat() {
    if (!activeId) return;

    try {
      activeChatController
        ?.abort(
          "delete-chat"
        );
    } catch {}

    activeChatController =
      null;

    activeChatRun++;

    setBusy(false);
    removeTypingIndicator();

    editingUserMessageIndex =
      -1;

    delete chats[activeId];

    const next =
      Object.values(chats)
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) -
              Number(Boolean(a.pinned)) ||
            b.updatedAt -
              a.updatedAt
        )[0];

    activeId =
      next?.id ||
      createChat(false);

    saveChats();
    renderAll();

    navigate(
      ROUTES.chat,
      {
        replace: true,
        apply: true
      }
    );

    showToast(
      copyText(
        "Chat deleted",
        "Discussion supprimée",
        "تم حذف المحادثة"
      )
    );
  }

  function flashFoundMessage(
    index
  ) {
    const target =
      els.messages
        .querySelector(
          `[data-message-index="${index}"]`
        );

    if (!target) return;

    target.classList.add(
      "find-target"
    );

    target.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    setTimeout(
      () =>
        target.classList.remove(
          "find-target"
        ),
      1600
    );
  }

  function chatUiLabels() {
    return {
      close:
        copyText(
          "Close",
          "Fermer",
          "إغلاق"
        ),

      cancel:
        copyText(
          "Cancel",
          "Annuler",
          "إلغاء"
        ),

      save:
        copyText(
          "Save",
          "Enregistrer",
          "حفظ"
        ),

      delete:
        copyText(
          "Delete",
          "Supprimer",
          "حذف"
        ),

      pinChat:
        copyText(
          "Pin chat",
          "Épingler la discussion",
          "تثبيت المحادثة"
        ),

      unpinChat:
        copyText(
          "Unpin chat",
          "Désépingler la discussion",
          "إلغاء تثبيت المحادثة"
        ),

      findInChat:
        copyText(
          "Find in chat",
          "Rechercher dans la discussion",
          "بحث في المحادثة"
        ),

      rename:
        copyText(
          "Rename",
          "Renommer",
          "إعادة التسمية"
        ),

      renameChat:
        copyText(
          "Rename chat",
          "Renommer la discussion",
          "إعادة تسمية المحادثة"
        ),

      deleteChat:
        copyText(
          "Delete chat",
          "Supprimer la discussion",
          "حذف المحادثة"
        ),

      deleteChatQuestion:
        copyText(
          "Delete chat?",
          "Supprimer la discussion ?",
          "حذف المحادثة؟"
        ),

      deleteCannotUndo:
        copyText(
          "This action cannot be undone.",
          "Cette action est irréversible.",
          "لا يمكن التراجع عن هذا الإجراء."
        ),

      searchMessages:
        copyText(
          "Search messages",
          "Rechercher des messages",
          "ابحث في الرسائل"
        ),

      noResults:
        copyText(
          "No results",
          "Aucun résultat",
          "لا توجد نتائج"
        ),

      you:
        copyText(
          "You",
          "Vous",
          "أنت"
        ),

      copy:
        copyText(
          "Copy",
          "Copier",
          "نسخ"
        ),

      edit:
        copyText(
          "Edit",
          "Modifier",
          "تعديل"
        ),

      send:
        copyText(
          "Send",
          "Envoyer",
          "إرسال"
        ),

      goodResponse:
        copyText(
          "Good response",
          "Bonne réponse",
          "إجابة جيدة"
        ),

      badResponse:
        copyText(
          "Bad response",
          "Mauvaise réponse",
          "إجابة سيئة"
        )
    };
  }

  async function openChatMenu() {
    const chat =
      currentChat();

    if (
      !chat ||
      !els.chatMenuButton
    ) {
      return;
    }

    try {
      const ui =
        await loadChatUi();

      await ui.openChatMenu({
        anchor:
          els.chatMenuButton,

        pinned:
          chat.pinned === true,

        title:
          chat.title || "",

        messages:
          chat.messages || [],

        labels:
          chatUiLabels(),

        onTogglePin:
          togglePinChat,

        onRename:
          renameActiveChat,

        onDelete:
          deleteActiveChat,

        onFindSelect:
          (index) =>
            requestAnimationFrame(
              () =>
                flashFoundMessage(
                  index
                )
            )
      });
    } catch {
      showToast(
        copyText(
          "Couldn't open chat menu",
          "Impossible d’ouvrir le menu",
          "تعذر فتح قائمة المحادثة"
        ),
        true
      );
    }
  }

  function setAssistantFeedback(
    message,
    rating,
    sourceButton
  ) {
    message.feedback =
      rating;

    saveChats();

    sourceButton
      ?.classList.add(
        "active"
      );

    sourceButton
      ?.setAttribute(
        "aria-pressed",
        "true"
      );

    showToast(
      copyText(
        "Thank you for your feedback",
        "Merci pour votre retour",
        "شكراً لملاحظتك"
      )
    );
  }

  async function openFeedbackMenu(
    anchor,
    message
  ) {
    try {
      const ui =
        await loadChatUi();

      await ui.openFeedbackMenu({
        anchor,

        currentRating:
          message.feedback || "",

        labels:
          chatUiLabels(),

        onRate:
          (rating) =>
            setAssistantFeedback(
              message,
              rating,
              anchor
            )
      });
    } catch {
      showToast(
        copyText(
          "Couldn't open feedback",
          "Impossible d’ouvrir l’évaluation",
          "تعذر فتح التقييم"
        ),
        true
      );
    }
  }

  function beginUserMessageEdit(
    messageIndex
  ) {
    if (
      busy ||
      activeChatController
    ) {
      showToast(
        copyText(
          "Stop the current response first.",
          "Arrêtez d’abord la réponse en cours.",
          "أوقف الرد الحالي أولاً."
        ),
        true
      );

      return;
    }

    const chat =
      currentChat();

    const message =
      chat?.messages?.[
        messageIndex
      ];

    if (
      !message ||
      message.role !== "user"
    ) {
      return;
    }

    editingUserMessageIndex =
      messageIndex;

    closeChatUiIfLoaded();
    renderMessages();
  }

  function cancelUserMessageEdit() {
    editingUserMessageIndex =
      -1;

    renderMessages();
  }

  async function commitUserMessageEdit(
    messageIndex,
    nextText
  ) {
    const clean =
      String(
        nextText || ""
      ).trim();

    if (
      !clean ||
      busy ||
      activeChatController
    ) {
      return;
    }

    if (
      usageBlocks(
        clean
      )
    ) {
      syncUsageUI();

      showToast(
        `${copyText(
          "Usage limit reached",
          "Limite d’utilisation atteinte",
          "وصلت لحد الاستخدام"
        )} • ${usageResetLabel(
          usageSnapshot()
        )}`,
        true
      );

      return;
    }

    const chat =
      currentChat();

    if (
      !chat ||
      chat.messages?.[
        messageIndex
      ]?.role !== "user"
    ) {
      editingUserMessageIndex =
        -1;

      renderMessages();
      return;
    }

    chat.messages =
      chat.messages.slice(
        0,
        messageIndex
      );

    if (
      messageIndex === 0
    ) {
      chat.title =
        titleFromMessage(
          clean
        );
    }

    chat.updatedAt =
      Date.now();

    editingUserMessageIndex =
      -1;

    saveChats();
    renderAll();

    await sendTextMessage(
      clean,
      {
        skipRoute: true
      }
    );
  }

  async function openUserMessageMenu(
    anchor,
    message,
    messageIndex
  ) {
    try {
      const ui =
        await loadChatUi();

      await ui.openUserMessageMenu({
        anchor,

        labels:
          chatUiLabels(),

        onCopy:
          async () => {
            try {
              await copyTextToClipboard(
                message.content
              );

              showToast(
                copyText(
                  "Copied",
                  "Copié",
                  "تم النسخ"
                )
              );
            } catch {
              showToast(
                copyText(
                  "Copy failed",
                  "Échec de la copie",
                  "فشل النسخ"
                ),
                true
              );
            }
          },

        onEdit:
          () =>
            beginUserMessageEdit(
              messageIndex
            )
      });
    } catch {
      showToast(
        copyText(
          "Couldn't open message menu",
          "Impossible d’ouvrir le menu du message",
          "تعذر فتح قائمة الرسالة"
        ),
        true
      );
    }
  }

  function attachUserMessageHold(
    bubble,
    message,
    messageIndex
  ) {
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let opened = false;

    const clear =
      () => {
        if (timer) {
          clearTimeout(
            timer
          );

          timer = 0;
        }
      };

    bubble.addEventListener(
      "pointerdown",
      (event) => {
        if (
          event.button !== 0 &&
          event.pointerType ===
            "mouse"
        ) {
          return;
        }

        startX =
          event.clientX;

        startY =
          event.clientY;

        opened = false;
        clear();

        timer =
          setTimeout(
            () => {
              timer = 0;
              opened = true;

              openUserMessageMenu(
                bubble,
                message,
                messageIndex
              );
            },
            430
          );
      }
    );

    bubble.addEventListener(
      "pointermove",
      (event) => {
        if (
          Math.abs(
            event.clientX -
            startX
          ) > 10 ||
          Math.abs(
            event.clientY -
            startY
          ) > 10
        ) {
          clear();
        }
      }
    );

    bubble.addEventListener(
      "pointerup",
      clear
    );

    bubble.addEventListener(
      "pointercancel",
      clear
    );

    bubble.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
        clear();

        openUserMessageMenu(
          bubble,
          message,
          messageIndex
        );
      }
    );

    bubble.addEventListener(
      "click",
      (event) => {
        if (opened) {
          event.preventDefault();
          event.stopPropagation();
          opened = false;
        }
      }
    );
  }

  function syncChatChromeLabels() {
    if (els.newChatTop) {
      const label =
        copyText(
          "New chat",
          "Nouvelle discussion",
          "محادثة جديدة"
        );

      els.newChatTop
        .setAttribute(
          "aria-label",
          label
        );

      els.newChatTop.title =
        label;
    }

    if (els.chatMenuButton) {
      const label =
        copyText(
          "Chat menu",
          "Menu de discussion",
          "قائمة المحادثة"
        );

      els.chatMenuButton
        .setAttribute(
          "aria-label",
          label
        );

      els.chatMenuButton.title =
        label;
    }
  }

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
        startNewChat
      );

    els.newChatTop
      ?.addEventListener(
        "click",
        startNewChat
      );

    els.chatMenuButton
      ?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          openChatMenu();
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
      "keydown",
      (event) => {
        if (
          event.key ===
            "Escape"
        ) {
          closeChatUiIfLoaded();
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
        syncUsageUI();
        closeChatUiIfLoaded();
        syncChatChromeLabels();
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

          if (
            !busy &&
            !els.send.disabled
          ) {
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

        if (
          event.key ===
          USAGE_KEY
        ) {
          syncUsageUI();
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

    if (
      role === "assistant" &&
      (
        value.feedback === "good" ||
        value.feedback === "bad"
      )
    ) {
      message.feedback =
        value.feedback;
    }

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
              Boolean(
                right[1]
                  ?.pinned
              )
            ) -
              Number(
                Boolean(
                  left[1]
                    ?.pinned
                )
              ) ||
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
        pinned:
          chat.pinned ===
          true,
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
      pinned: false,
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
          Number(Boolean(b.pinned)) -
            Number(Boolean(a.pinned)) ||
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

          if (chat.pinned) {
            const pin =
              document.createElement(
                "span"
              );

            pin.className =
              "recent-item-pin";

            pin.innerHTML =
              e8ActionIconMarkup(
                "pin",
                13
              );

            button.appendChild(
              pin
            );
          }

          const label =
            document.createElement(
              "span"
            );

          label.className =
            "recent-item-label";

          label.textContent =
            chat.title;

          button.appendChild(
            label
          );

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

    chat.messages
      .forEach(
        (
          message,
          index
        ) => {
          els.messages
            .appendChild(
              createMessageNode(
                message,
                index
              )
            );
        }
      );

    requestAnimationFrame(
      scrollToBottom
    );
  }

  function createMessageNode(
    message,
    messageIndex = -1
  ) {
    const outer =
      document.createElement(
        "article"
      );

    outer.className =
      `message ${message.role}`;

    if (
      Number.isInteger(
        messageIndex
      ) &&
      messageIndex >= 0
    ) {
      outer.dataset.messageIndex =
        String(
          messageIndex
        );
    }

    if (
      message.role === "user"
    ) {
      if (
        messageIndex ===
        editingUserMessageIndex
      ) {
        const editor =
          document.createElement(
            "div"
          );

        editor.className =
          "user-edit-card";

        const input =
          document.createElement(
            "textarea"
          );

        input.className =
          "user-edit-input";

        input.value =
          message.content;

        input.rows = 2;
        input.maxLength =
          6_000;

        const actions =
          document.createElement(
            "div"
          );

        actions.className =
          "user-edit-actions";

        const cancel =
          document.createElement(
            "button"
          );

        cancel.type =
          "button";

        cancel.className =
          "user-edit-button";

        cancel.textContent =
          chatUiLabels()
            .cancel;

        cancel.addEventListener(
          "click",
          cancelUserMessageEdit
        );

        const send =
          document.createElement(
            "button"
          );

        send.type =
          "button";

        send.className =
          "user-edit-button primary";

        send.textContent =
          chatUiLabels()
            .send;

        const commit =
          () =>
            commitUserMessageEdit(
              messageIndex,
              input.value
            );

        send.addEventListener(
          "click",
          commit
        );

        input.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key ===
                "Escape"
            ) {
              event.preventDefault();
              cancelUserMessageEdit();
              return;
            }

            if (
              event.key ===
                "Enter" &&
              !event.shiftKey &&
              !event.isComposing &&
              !isMobileComposerDevice()
            ) {
              event.preventDefault();
              commit();
            }
          }
        );

        actions.append(
          cancel,
          send
        );

        editor.append(
          input,
          actions
        );

        outer.appendChild(
          editor
        );

        requestAnimationFrame(
          () => {
            input.focus();

            input.setSelectionRange(
              input.value.length,
              input.value.length
            );
          }
        );

        return outer;
      }

      const bubble =
        document.createElement(
          "div"
        );

      bubble.className =
        "user-bubble";

      bubble.textContent =
        message.content;

      attachUserMessageHold(
        bubble,
        message,
        messageIndex
      );

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
      "E8 Helper";

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

    if (message.streaming) {
      body.classList.add(
        "e8-streaming-response"
      );
    }

    renderMarkdown(
      body,
      message.content
    );

    wrap.append(
      name,
      body
    );

    if (message.streaming) {
      outer.appendChild(
        wrap
      );

      return outer;
    }

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "assistant-actions";

    const copyButton =
      document.createElement(
        "button"
      );

    copyButton.type =
      "button";

    copyButton.className =
      "assistant-action";

    copyButton.innerHTML =
      e8ActionIconMarkup(
        "copy",
        19
      );

    copyButton.title =
      copyText(
        "Copy response",
        "Copier la réponse",
        "نسخ الإجابة"
      );

    copyButton.setAttribute(
      "aria-label",
      copyButton.title
    );

    copyButton.addEventListener(
      "click",
      async () => {
        try {
          await copyTextToClipboard(
            message.content
          );

          showToast(
            copyText(
              "Copied",
              "Copié",
              "تم النسخ"
            )
          );
        } catch {
          showToast(
            copyText(
              "Copy failed",
              "Échec de la copie",
              "فشل النسخ"
            ),
            true
          );
        }
      }
    );

    const feedback =
      document.createElement(
        "button"
      );

    feedback.type =
      "button";

    feedback.className =
      `assistant-action feedback-action${message.feedback ? " active" : ""}`;

    feedback.innerHTML =
      e8ActionIconMarkup(
        "feedback",
        22
      );

    feedback.title =
      copyText(
        "Rate response",
        "Évaluer la réponse",
        "تقييم الإجابة"
      );

    feedback.setAttribute(
      "aria-label",
      feedback.title
    );

    feedback.setAttribute(
      "aria-haspopup",
      "menu"
    );

    feedback.setAttribute(
      "aria-expanded",
      "false"
    );

    feedback.setAttribute(
      "aria-pressed",
      message.feedback
        ? "true"
        : "false"
    );

    feedback.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        openFeedbackMenu(
          feedback,
          message
        );
      }
    );

    actions.append(
      copyButton,
      feedback
    );

    wrap.appendChild(
      actions
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
    if (busy) {
      stopActiveResponse();
      return;
    }

    const text =
      els.input.value.trim();

    if (!text) {
      return;
    }

    if (
      usageBlocks(
        text
      )
    ) {
      const snapshot =
        usageSnapshot();

      showToast(
        `${copyText(
          "Usage limit reached",
          "Limite d’utilisation atteinte",
          "وصلت لحد الاستخدام"
        )} • ${usageResetLabel(snapshot)}`,
        true
      );

      syncUsageUI();
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

  function revealBatchSize(
    length
  ) {
    if (length <= 420) return 1;
    if (length <= 1200) return 2;
    if (length <= 3000) return 4;
    if (length <= 6500) return 7;
    return 12;
  }

  function revealUnits(
    text
  ) {
    return (
      String(text || "")
        .match(/\S+\s*/g) ||
      [String(text || "")]
    );
  }

  function chatNearBottom() {
    if (!els.chat) {
      return true;
    }

    return (
      els.chat.scrollHeight -
        els.chat.scrollTop -
        els.chat.clientHeight <
      140
    );
  }

  function waitForRevealStep(
    signal,
    delay = 24
  ) {
    if (signal?.aborted) {
      return Promise.reject(
        chatAbortError(
          signal
        )
      );
    }

    return new Promise(
      (
        resolve,
        reject
      ) => {
        let settled = false;

        const finish =
          (callback) => {
            if (settled) {
              return;
            }

            settled = true;

            signal
              ?.removeEventListener?.(
                "abort",
                onAbort
              );

            callback();
          };

        const timer =
          setTimeout(
            () =>
              finish(resolve),
            delay
          );

        const onAbort =
          () => {
            clearTimeout(
              timer
            );

            finish(
              () =>
                reject(
                  chatAbortError(
                    signal
                  )
                )
            );
          };

        signal
          ?.addEventListener?.(
            "abort",
            onAbort,
            {
              once: true
            }
          );
      }
    );
  }

  function updateStreamingMessage(
    messageIndex,
    content
  ) {
    const article =
      els.messages
        ?.querySelector(
          `[data-message-index="${messageIndex}"]`
        );

    const body =
      article
        ?.querySelector(
          ".assistant-content"
        );

    if (!body) {
      return;
    }

    const stick =
      chatNearBottom();

    renderMarkdown(
      body,
      content
    );

    body.classList.add(
      "e8-streaming-response"
    );

    if (stick) {
      scrollToBottom();
    }
  }

  async function revealAssistantReply(
    chat,
    reply,
    signal,
    runId,
    controller
  ) {
    const fullText =
      String(
        reply || ""
      ).trim() ||
      "No response.";

    removeTypingIndicator();

    const message = {
      role:
        "assistant",
      content: "",
      streaming: true
    };

    chat.messages.push(
      message
    );

    const messageIndex =
      chat.messages.length -
      1;

    renderMessages();

    const reducedMotion =
      window.matchMedia
        ?.("(prefers-reduced-motion: reduce)")
        ?.matches === true;

    if (reducedMotion) {
      message.content =
        fullText;

      message.streaming =
        false;

      renderMessages();

      return message;
    }

    const units =
      revealUnits(
        fullText
      );

    const batchSize =
      revealBatchSize(
        fullText.length
      );

    let cursor = 0;

    try {
      while (
        cursor <
        units.length
      ) {
        throwIfChatStale(
          runId,
          controller
        );

        if (signal?.aborted) {
          throw chatAbortError(
            signal
          );
        }

        cursor =
          Math.min(
            units.length,
            cursor +
              batchSize
          );

        message.content =
          units
            .slice(
              0,
              cursor
            )
            .join("");

        updateStreamingMessage(
          messageIndex,
          message.content
        );

        if (
          cursor <
          units.length
        ) {
          await waitForRevealStep(
            signal
          );
        }
      }
    } catch (error) {
      if (
        message.content
          .trim()
      ) {
        message.streaming =
          false;

        chat.updatedAt =
          Date.now();

        saveChats();
        renderMessages();
      } else {
        chat.messages.splice(
          messageIndex,
          1
        );

        renderMessages();
      }

      throw error;
    }

    message.content =
      fullText;

    message.streaming =
      false;

    renderMessages();

    return message;
  }

  async function sendTextMessage(
    text,
    options = {}
  ) {
    const clean =
      String(text || "")
        .trim();

    if (!clean) return;

    if (
      busy ||
      activeChatController
    ) {
      showToast(
        "Stop the current response first.",
        true
      );

      return {
        blocked: true,
        busy: true
      };
    }

    const {
      assetPath = "",
      skipRoute = false
    } = options;

    if (
      usageBlocks(
        clean,
        {
          assetPath
        }
      )
    ) {
      const snapshot =
        usageSnapshot();

      showToast(
        `${copyText(
          "Usage limit reached",
          "Limite d’utilisation atteinte",
          "وصلت لحد الاستخدام"
        )} • ${usageResetLabel(snapshot)}`,
        true
      );

      syncUsageUI();

      return {
        blocked: true,
        usage: true,
        resetAt:
          snapshot.resetAt
      };
    }

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
        await runPathSearchGuide(
          chat,
          plugin.query ||
            clean,
          signal,
          runId,
          controller
        );

        throwIfChatStale(
          runId,
          controller
        );
      } else if (
        !assetPath &&
        isDirectPathLookupRequest(
          clean
        )
      ) {
        await runPathSearchGuide(
          chat,
          clean,
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

        incrementUsage();

        await revealAssistantReply(
          chat,
          response.reply,
          signal,
          runId,
          controller
        );
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

    const userContext =
      buildUserChatContext();

    if (userContext) {
      body.user_context =
        userContext;
    }

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
      isDirectPathLookupRequest(
        userText
      )
    ) {
      return null;
    }

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

  function responseStyleFeatures(
    content
  ) {
    const text =
      String(content || "");

    const lines =
      text.split("\n");

    return {
      chars:
        text.length,

      lists:
        lines.some(
          (line) =>
            /^\s*(?:[-+*]|\d+[.)])\s+/
              .test(line)
        ),

      codeBlocks:
        text.includes(
          "```"
        ),

      headings:
        lines.some(
          (line) =>
            /^\s*#{1,3}\s+/
              .test(line)
        )
    };
  }

  function styleFeaturePreference(
    good,
    bad,
    key
  ) {
    const goodRate =
      good.length
        ? good.filter(
            (item) =>
              item[key]
          ).length /
          good.length
        : 0;

    const badRate =
      bad.length
        ? bad.filter(
            (item) =>
              item[key]
          ).length /
          bad.length
        : 0;

    if (
      good.length &&
      bad.length
    ) {
      const difference =
        goodRate -
        badRate;

      if (difference >= 0.25) {
        return "prefer";
      }

      if (difference <= -0.25) {
        return "avoid";
      }

      return "neutral";
    }

    if (
      good.length &&
      goodRate >= 0.6
    ) {
      return "prefer";
    }

    if (
      bad.length &&
      badRate >= 0.6
    ) {
      return "avoid";
    }

    return "neutral";
  }

  function buildFeedbackStyleProfile() {
    const rated = [];

    const orderedChats =
      Object.values(chats)
        .sort(
          (a, b) =>
            Number(
              b?.updatedAt || 0
            ) -
            Number(
              a?.updatedAt || 0
            )
        );

    for (
      const chat of
      orderedChats
    ) {
      const messages =
        Array.isArray(
          chat?.messages
        )
          ? chat.messages
          : [];

      for (
        let index =
          messages.length - 1;

        index >= 0 &&
        rated.length < 40;

        index--
      ) {
        const message =
          messages[index];

        if (
          message?.role !==
            "assistant" ||
          ![
            "good",
            "bad"
          ].includes(
            message?.feedback
          )
        ) {
          continue;
        }

        rated.push({
          rating:
            message.feedback,

          ...responseStyleFeatures(
            message.content
          )
        });
      }

      if (
        rated.length >= 40
      ) {
        break;
      }
    }

    if (!rated.length) {
      return null;
    }

    const good =
      rated.filter(
        (item) =>
          item.rating ===
          "good"
      );

    const bad =
      rated.filter(
        (item) =>
          item.rating ===
          "bad"
      );

    let preferredLength =
      "neutral";

    if (good.length) {
      const average =
        good.reduce(
          (
            total,
            item
          ) =>
            total +
            item.chars,
          0
        ) /
        good.length;

      preferredLength =
        average <= 500
          ? "concise"
          : average <= 1400
            ? "balanced"
            : "detailed";
    }

    return {
      rated:
        rated.length,

      good:
        good.length,

      bad:
        bad.length,

      preferred_length:
        preferredLength,

      lists:
        styleFeaturePreference(
          good,
          bad,
          "lists"
        ),

      code_blocks:
        styleFeaturePreference(
          good,
          bad,
          "codeBlocks"
        ),

      headings:
        styleFeaturePreference(
          good,
          bad,
          "headings"
        )
    };
  }

  function buildUserChatContext() {
    const username =
      String(
        accountState.profile
          ?.username ||
        ""
      )
        .replace(
          /[\u0000-\u001f\u007f]/g,
          " "
        )
        .trim()
        .slice(
          0,
          32
        );

    const language =
      window.FortniteI18n
        ?.getLanguage?.() ||
      "en";

    const feedbackStyle =
      buildFeedbackStyleProfile();

    if (
      !username &&
      !feedbackStyle &&
      !language
    ) {
      return null;
    }

    return {
      username,
      language,
      feedback_style:
        feedbackStyle
    };
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
        "E8 API endpoint is not configured."
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
        "E8 API request target is not allowed."
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

  function looksLikeCosmeticQuestion(
    text
  ) {
    return /\b(skin|outfit|cosmetic|character|emote|back\s*bling|pickaxe|glider|wrap|music\s*pack|cid_|eid_|bid_|pickaxe_|glider_)\b|(?:^|[\s/._-])character_|\b(tenue|cosm[eé]tique|personnage|emote|émote|pioche|planeur)\b|سكن|سكين|كوزمتك|كوسمتك|شخصية|ايموت|إيموت|رقصة|باك\s*بلنغ|بيكاكس|مظلة/i
      .test(
        String(
          text || ""
        )
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
      looksLikeCosmeticQuestion(
        text
      ) ||
      /\b(path|asset path|mesh|staticmesh|static mesh|skeletalmesh|texture|material|icon|uasset|fortnite files|sm_|sk_|mi_|m_)\b|\b(chemin|asset|fichier|mesh|texture|mat[eé]riau)\b|مسار|باث|ميش|تكستشر|ماتيريال|ملفات اللعبة|ملفات فورتنايت/i
        .test(
          String(
            text || ""
          )
        )
    );
  }

  function isDirectPathLookupRequest(
    text
  ) {
    const value =
      String(text || "")
        .trim();

    if (!value) {
      return false;
    }

    if (
      /^\s*@SearchForPath\b/i
        .test(value)
    ) {
      return true;
    }

    if (
      /\b(describe|description|explain|what is|what does)\b|\b(d[eé]cris|description|explique)\b|اشرح|وصف|اوصف|شنو هذا|شنو هاذا/i
        .test(value)
    ) {
      return false;
    }

    const explicitPath =
      /\b(path|asset path|uasset|file path|filesystem path)\b|\b(chemin|chemin d['’]asset|fichier)\b|مسار|باث|ملف/i
        .test(value);

    const asksToFind =
      /\b(find|search|show|lookup|locate|get me|give me|where is)\b|\b(cherche|trouve|montre|recherche|localise|donne[- ]moi)\b|شوفلي|شوفيلي|دورلي|دوريلي|طلعلي|طلعيلي|جيبلي|جيبيلي|لكيلي|لقيلِي|ابحث|أبحث|اريد ابحث|أريد أبحث/i
        .test(value);

    return (
      explicitPath ||
      (
        asksToFind &&
        (
          looksLikeCosmeticQuestion(
            value
          ) ||
          /\b(asset|mesh|texture|material|icon|fortnite file)\b|\b(asset|mesh|texture|mat[eé]riau)\b|ميش|تكستشر|ماتيريال|ملفات فورتنايت/i
            .test(value)
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
          /\b(give|me|the|a|an|for|of|please|pls|find|search|show|lookup|locate|get|where|what|whats|what's|is|path|asset|mesh|static|skeletal|fortnite|files?|current|latest|new|describe|skin|outfit|cosmetic|character|emote|back\s*bling|pickaxe|glider|wrap|music\s*pack)\b/gi,
          " "
        )
        .replace(
          /\b(trouve|chercher|cherche|recherche|montre|localise|donne|moi|le|la|les|un|une|pour|de|du|des|chemin|fichier|fortnite|tenue|cosm[eé]tique|personnage|emote|émote|pioche|planeur)\b/gi,
          " "
        )
        .replace(
          /(انطيني|اعطيني|أعطيني|اريد|أريد|شوفلي|شوفيلي|دورلي|دوريلي|طلعلي|طلعيلي|جيبلي|جيبيلي|لكيلي|لقيلِي|ابحث|أبحث|شنو|شسم|مسار|باث|مال|ملفات|فورتنايت|الميش|ميش|سكن|سكين|كوزمتك|كوسمتك|شخصية|ايموت|إيموت|رقصة|باك\s*بلنغ|بيكاكس|مظلة)/g,
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

  function pathGuideLanguage(
    text
  ) {
    const value =
      String(text || "");

    if (
      /[\u0600-\u06ff]/
        .test(value)
    ) {
      return "ar";
    }

    if (
      /\b(cherche|trouve|chemin|tenue|cosm[eé]tique|personnage|montre|recherche)\b/i
        .test(value)
    ) {
      return "fr";
    }

    const selected =
      window.FortniteI18n
        ?.getLanguage?.();

    return [
      "en",
      "fr",
      "ar"
    ].includes(selected)
      ? selected
      : "en";
  }

  function pathSearchGuideText(
    userText
  ) {
    const language =
      pathGuideLanguage(
        userText
      );

    if (language === "ar") {
      return [
        "أكيد. افتح القائمة وروح إلى **More Fortnite Tools** وبعدها **Search**.",
        "اكتب اسم الـasset أو الـID أو جزء من المسار، وE8 Search راح يعرضلك النتائج المؤكدة من الداتابيس."
      ].join("\n\n");
    }

    if (language === "fr") {
      return [
        "Bien sûr. Ouvre le menu, puis **More Fortnite Tools** → **Search**.",
        "Entre le nom de l’asset, son ID ou une partie du chemin pour afficher les résultats vérifiés de la base E8."
      ].join("\n\n");
    }

    return [
      "Sure. Open the menu, then go to **More Fortnite Tools** → **Search**.",
      "Enter the asset name, ID, or part of the path to see verified results from the E8 database."
    ].join("\n\n");
  }

  async function runPathSearchGuide(
    chat,
    userText,
    signal,
    runId,
    controller
  ) {
    throwIfChatStale(
      runId,
      controller
    );

    if (signal?.aborted) {
      throw chatAbortError(
        signal
      );
    }

    await revealAssistantReply(
      chat,
      pathSearchGuideText(
        userText
      ),
      signal,
      runId,
      controller
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
        .test(value) ||
      isDirectPathLookupRequest(
        value
      )
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

  function usageDayKey(
    date = new Date()
  ) {
    return [
      date.getFullYear(),
      String(
        date.getMonth() + 1
      ).padStart(2, "0"),
      String(
        date.getDate()
      ).padStart(2, "0")
    ].join("-");
  }

  function nextUsageResetAt(
    now = new Date()
  ) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    ).getTime();
  }

  function readUsageRecord() {
    const today =
      usageDayKey();

    let parsed = null;

    try {
      parsed =
        JSON.parse(
          safeStorageGet(
            USAGE_KEY
          ) || "null"
        );
    } catch {}

    if (
      !parsed ||
      parsed.day !== today
    ) {
      return {
        day: today,
        count: 0
      };
    }

    return {
      day: today,
      count:
        Math.max(
          0,
          Math.min(
            DAILY_CHAT_LIMIT,
            Number(
              parsed.count || 0
            ) || 0
          )
        )
    };
  }

  function writeUsageRecord(
    record
  ) {
    safeStorageSet(
      USAGE_KEY,
      JSON.stringify({
        day:
          record.day,
        count:
          record.count
      })
    );
  }

  function usageSnapshot() {
    const record =
      readUsageRecord();

    const remaining =
      Math.max(
        0,
        DAILY_CHAT_LIMIT -
          record.count
      );

    return {
      ...record,
      limit:
        DAILY_CHAT_LIMIT,
      remaining,
      exhausted:
        remaining <= 0,
      resetAt:
        nextUsageResetAt()
    };
  }

  function messageUsesAi(
    text,
    options = {}
  ) {
    if (options.assetPath) {
      return true;
    }

    const clean =
      String(
        text || ""
      ).trim();

    if (!clean) {
      return false;
    }

    const plugin =
      parsePlugin(
        clean
      );

    if (
      plugin?.id ===
        "path" ||
      isDirectPathLookupRequest(
        clean
      )
    ) {
      return false;
    }

    return true;
  }

  function usageBlocks(
    text,
    options = {}
  ) {
    return (
      messageUsesAi(
        text,
        options
      ) &&
      usageSnapshot()
        .exhausted
    );
  }

  function formatUsageResetTime(
    resetAt
  ) {
    const language =
      window.FortniteI18n
        ?.getLanguage?.() ||
      "en";

    const locale =
      language === "ar"
        ? "ar-IQ"
        : language === "fr"
          ? "fr-FR"
          : "en-US";

    try {
      return new Intl.DateTimeFormat(
        locale,
        {
          hour:
            "numeric",
          minute:
            "2-digit"
        }
      ).format(
        new Date(
          resetAt
        )
      );
    } catch {
      return "00:00";
    }
  }

  function usageResetLabel(
    snapshot
  ) {
    const time =
      formatUsageResetTime(
        snapshot.resetAt
      );

    return copyText(
      `Resets at ${time}`,
      `Réinitialisation à ${time}`,
      `يتجدد الساعة ${time}`
    );
  }

  function ensureUsageBanner() {
    let banner =
      $("e8UsageBanner");

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
      "e8UsageBanner";

    banner.className =
      "e8-usage-banner";

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

  function syncUsageUI() {
    const snapshot =
      usageSnapshot();

    const percent =
      Math.min(
        100,
        Math.round(
          (
            snapshot.count /
            snapshot.limit
          ) * 100
        )
      );

    if (els.usageTitle) {
      els.usageTitle.textContent =
        copyText(
          "Usage",
          "Utilisation",
          "الاستخدام"
        );
    }

    if (els.usageSummary) {
      els.usageSummary.textContent =
        copyText(
          `${snapshot.count} of ${snapshot.limit} AI messages used today`,
          `${snapshot.count} sur ${snapshot.limit} messages IA utilisés aujourd’hui`,
          `تم استخدام ${snapshot.count} من ${snapshot.limit} رسالة ذكاء اصطناعي اليوم`
        );
    }

    if (els.usageProgress) {
      els.usageProgress.style.width =
        `${percent}%`;

      const track =
        els.usageProgress
          .parentElement;

      track?.setAttribute(
        "aria-valuemax",
        String(
          snapshot.limit
        )
      );

      track?.setAttribute(
        "aria-valuenow",
        String(
          snapshot.count
        )
      );
    }

    if (els.usageReset) {
      els.usageReset.textContent =
        usageResetLabel(
          snapshot
        );
    }

    const banner =
      ensureUsageBanner();

    if (snapshot.exhausted) {
      document.documentElement
        .classList.add(
          "e8-usage-limit-active"
        );

      if (banner) {
        banner.hidden = false;

        banner.textContent =
          `${copyText(
            "You've reached today's E8 usage limit.",
            "Vous avez atteint la limite E8 d’aujourd’hui.",
            "وصلت لحد استخدام E8 لليوم."
          )} ${usageResetLabel(snapshot)}`;
      }

      if (!usageTimer) {
        usageTimer =
          setInterval(
            syncUsageUI,
            30_000
          );
      }
    } else {
      document.documentElement
        .classList.remove(
          "e8-usage-limit-active"
        );

      if (banner) {
        banner.hidden = true;
        banner.textContent = "";
      }

      if (usageTimer) {
        clearInterval(
          usageTimer
        );

        usageTimer = null;
      }
    }

    updateSendState();
  }

  function incrementUsage() {
    const current =
      usageSnapshot();

    const next = {
      day:
        current.day,
      count:
        Math.min(
          current.limit,
          current.count + 1
        )
    };

    writeUsageRecord(
      next
    );

    syncUsageUI();
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
      "E8";

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
    if (busy) {
      els.send.disabled =
        false;

      els.send.textContent =
        "■";

      els.send.classList.add(
        "stop"
      );

      els.send.setAttribute(
        "aria-label",
        "Stop generating"
      );

      els.send.title =
        "Stop generating";

      return;
    }

    const text =
      els.input.value.trim();

    const blocked =
      text &&
      (
        guestSlowmodeBlocks(
          text
        ) ||
        usageBlocks(
          text
        )
      );

    els.send.textContent =
      "↑";

    els.send.classList.remove(
      "stop"
    );

    els.send.setAttribute(
      "aria-label",
      "Send"
    );

    els.send.title =
      "Send";

    els.send.disabled =
      !text ||
      blocked;
  }

  function setBusy(value) {
    busy =
      Boolean(value);

    updateSendState();
  }

  function stopActiveResponse() {
    const controller =
      activeChatController;

    if (!controller) {
      setBusy(false);
      removeTypingIndicator();
      return false;
    }

    try {
      controller.abort(
        "user-stopped"
      );
    } catch {}

    activeChatRun++;

    activeChatController =
      null;

    setBusy(false);
    removeTypingIndicator();

    els.input.focus({
      preventScroll: true
    });

    return true;
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
          <span>E8 Helper</span>
        </div>

        <div class="assistant-content">
          <p class="e8-thinking" aria-label="Thinking">Thinking</p>
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
    closeChatUiIfLoaded();

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
    syncUsageUI();

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
    syncUsageUI();
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
          <span>E8 Helper</span>
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
            "Guest uses E8 access + 15s slow mode.",
            "L’invité utilise l’accès E8 + mode lent 15 s.",
            "الضيف يستخدم E8 + سلو مود 15 ثانية."
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
      version: "1.0.12",

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
