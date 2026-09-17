(() => {
  "use strict";

  const HISTORY_KEY = "e8.ai.localHistory.v1";
  const MAX_HISTORY = 20;
  const MAX_MESSAGES = 12;
  const MAX_MESSAGE_CHARS = 6000;
  const MAX_TOTAL_CHARS = 24000;
  const SUGGESTION_LIMIT = 5;

  const suggestionGroups = Object.freeze({
    Fortnite: Object.freeze([
      "How To make The mesh Method",
      "How To Get The dev inventory",
      "How To copy the Orange and the White Copy props",
      "What is The Mesh Method",
      "What is the Dev inventory",
      "What Is the Orange and White copy props",
      "Is the paks bandable?",
      "What is NovaSparx",
      "Is NovaSparx for free?"
    ]),
    More: Object.freeze([
      "Who made you",
      "How to use Braille Tool",
      "Why is somethings not for free",
      "How To make my own CNC",
      "Credits"
    ])
  });

  const suggestionPool = Object.entries(suggestionGroups).flatMap(([category, values]) =>
    values.map((text) => ({ category, text }))
  );

  const els = {
    welcome: document.getElementById("welcome"),
    welcomeComposer: document.getElementById("welcomeComposer"),
    welcomeInput: document.getElementById("welcomeInput"),
    grid: document.getElementById("suggestionGrid"),
    chat: document.getElementById("chat"),
    chatComposer: document.getElementById("chatComposer"),
    chatInput: document.getElementById("chatInput"),
    chatSend: document.getElementById("chatSend"),
    newChat: document.getElementById("newChatButton"),
    login: document.getElementById("loginButton"),
    recentList: document.getElementById("recentList"),
    searchButton: document.getElementById("searchButton"),
    searchPanel: document.getElementById("searchPanel"),
    searchInput: document.getElementById("searchInput"),
    searchResults: document.getElementById("searchResults")
  };

  let messages = [];
  let busy = false;
  let activeId = "";
  let activeRequest = null;
  let conversationGeneration = 0;

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function cleanStoredMessages(input) {
    if (!Array.isArray(input)) return [];
    return input
      .filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, MAX_MESSAGE_CHARS)
      }))
      .filter((message) => message.content.trim())
      .slice(-MAX_MESSAGES);
  }

  function readHistory() {
    try {
      const parsed = safeParse(localStorage.getItem(HISTORY_KEY), []);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_HISTORY).map((item) => ({
        id: String(item?.id || "").slice(0, 120),
        title: String(item?.title || "Chat").replace(/\s+/g, " ").trim().slice(0, 54) || "Chat",
        updatedAt: Number(item?.updatedAt || 0),
        messages: cleanStoredMessages(item?.messages)
      }));
    } catch { return []; }
  }

  function writeHistory(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch {}
  }

  function randomUint32() {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  function randomSuggestions() {
    const copy = suggestionPool.map((item) => ({ ...item }));
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomUint32() % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, SUGGESTION_LIMIT);
  }

  function makeSuggestionButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "e8-suggestion";
    button.textContent = text;
    button.title = text;
    button.addEventListener("click", () => startNewChat(text));
    return button;
  }

  function renderSuggestions() {
    els.grid.replaceChildren();
    const selected = randomSuggestions();

    for (const category of Object.keys(suggestionGroups)) {
      const items = selected.filter((item) => item.category === category);
      if (!items.length) continue;

      const group = document.createElement("section");
      group.className = "e8-suggestion-group";
      group.setAttribute("aria-label", `${category} suggestions`);

      const label = document.createElement("div");
      label.className = "e8-suggestion-category";
      label.textContent = `${category} :`;

      const list = document.createElement("div");
      list.className = "e8-suggestion-items";
      for (const item of items) list.append(makeSuggestionButton(item.text));

      group.append(label, list);
      els.grid.append(group);
    }
  }

  function setChatMode(enabled) {
    els.welcome.hidden = enabled;
    els.chat.hidden = !enabled;
    els.chatComposer.hidden = !enabled;
    if (enabled) requestAnimationFrame(() => els.chatInput.focus());
  }

  function appendMessage(role, content, extraClass = "") {
    const node = document.createElement("article");
    node.className = `e8-message ${role} ${extraClass}`.trim();
    node.textContent = content;
    els.chat.append(node);
    node.scrollIntoView({ block: "end", behavior: "smooth" });
    return node;
  }

  function conversationTitle() {
    const first = messages.find((item) => item.role === "user")?.content || "New chat";
    return first.replace(/\s+/g, " ").trim().slice(0, 54) || "New chat";
  }

  function saveConversation() {
    if (!messages.length) return;
    if (!activeId) activeId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const history = readHistory().filter((item) => item.id !== activeId);
    history.unshift({ id: activeId, title: conversationTitle(), updatedAt: Date.now(), messages: cleanStoredMessages(messages) });
    writeHistory(history);
    renderRecents();
  }

  function renderRecents(filter = "", targetOverride = null) {
    const query = filter.trim().toLowerCase();
    const items = readHistory().filter((item) => !query || item.title.toLowerCase().includes(query));
    const target = targetOverride || els.recentList;
    target.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "e8-search-result";
      button.textContent = item.title;
      button.addEventListener("click", () => loadConversation(item));
      target.append(button);
    }
    if (!items.length && target === els.searchResults) {
      const empty = document.createElement("div");
      empty.className = "e8-muted";
      empty.textContent = query ? "No matching chats." : "No chats yet.";
      target.append(empty);
    }
  }

  function cancelPendingRequest() {
    conversationGeneration += 1;
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    busy = false;
    els.chatSend.disabled = false;
  }

  function closeDrawer() {
    window.E8Shell?.closeDrawer?.({ restoreFocus: false });
  }

  function loadConversation(item) {
    cancelPendingRequest();
    activeId = String(item.id || "").slice(0, 120);
    messages = cleanStoredMessages(item.messages);
    els.chat.replaceChildren();
    for (const message of messages) appendMessage(message.role, message.content);
    setChatMode(true);
    closeSearch();
    closeDrawer();
  }

  function resetChat() {
    cancelPendingRequest();
    messages = [];
    activeId = "";
    els.chat.replaceChildren();
    els.welcomeInput.value = "";
    els.chatInput.value = "";
    setChatMode(false);
    renderSuggestions();
    closeSearch();
    closeDrawer();
  }

  function totalChars(nextUserText) {
    return messages.reduce((sum, item) => sum + item.content.length, 0) + nextUserText.length;
  }

  async function send(text) {
    const content = String(text || "").trim();
    if (!content || busy) return;
    if (content.length > 12000 || totalChars(content) > MAX_TOTAL_CHARS) {
      if (!els.chat.hidden) appendMessage("assistant", "This chat is getting too long. Start a new chat.", "error");
      return;
    }

    if (els.chat.hidden) setChatMode(true);
    messages.push({ role: "user", content });
    appendMessage("user", content);
    busy = true;
    els.chatSend.disabled = true;
    const thinking = appendMessage("assistant", "Thinking…");
    const generation = conversationGeneration;
    const controller = new AbortController();
    activeRequest = controller;

    try {
      await window.E8Auth.ready;
      if (generation !== conversationGeneration) return;

      const headers = {
        "Content-Type": "application/json",
        "X-FNAA-Client": "web-v6",
        "X-E8-Client": "hub-v1"
      };
      const token = window.E8Auth.getSessionToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const clientContext = window.E8Database
        ? await window.E8Database.buildClientContext(content)
        : null;
      if (generation !== conversationGeneration) return;

      const body = { messages: messages.slice(-MAX_MESSAGES), mode: "chat" };
      if (clientContext) body.client_context = clientContext;

      const response = await fetch(window.E8Auth.API_ENDPOINT, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (generation !== conversationGeneration) return;
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

      const answer = String(data.reply || data.answer || data.message || data.choices?.[0]?.message?.content || "").trim();
      if (!answer) throw new Error("E8AI returned an empty response.");
      thinking.textContent = answer;
      messages.push({ role: "assistant", content: answer.slice(0, MAX_MESSAGE_CHARS) });
      saveConversation();
    } catch (error) {
      if (controller.signal.aborted || generation !== conversationGeneration) {
        thinking.remove();
        return;
      }
      thinking.classList.add("error");
      thinking.textContent = error?.message || "Couldn't reach E8AI. Try again.";
    } finally {
      if (activeRequest === controller) activeRequest = null;
      if (generation === conversationGeneration) {
        busy = false;
        els.chatSend.disabled = false;
        if (!els.chatComposer.hidden) els.chatInput.focus();
      }
    }
  }

  function startNewChat(text) {
    resetChat();
    send(text);
  }

  function openSearch() {
    els.searchPanel.hidden = false;
    els.searchInput.value = "";
    renderRecents("", els.searchResults);
    requestAnimationFrame(() => els.searchInput.focus());
  }

  function closeSearch() {
    els.searchPanel.hidden = true;
  }

  function updateLoginButton() {
    const state = window.E8Auth.getState();
    els.login.firstElementChild.textContent = state.connected ? "Log out" : "Log in";
  }

  function submitOnEnter(textarea, callback) {
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      callback();
    });
  }

  els.welcomeComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.welcomeInput.value;
    els.welcomeInput.value = "";
    startNewChat(value);
  });
  els.chatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.chatInput.value;
    els.chatInput.value = "";
    send(value);
  });
  submitOnEnter(els.welcomeInput, () => els.welcomeComposer.requestSubmit());
  submitOnEnter(els.chatInput, () => els.chatComposer.requestSubmit());

  els.newChat.addEventListener("click", resetChat);
  els.searchButton.addEventListener("click", () => els.searchPanel.hidden ? openSearch() : closeSearch());
  els.searchInput.addEventListener("input", () => renderRecents(els.searchInput.value, els.searchResults));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.searchPanel.hidden) closeSearch(); });
  els.login.addEventListener("click", async () => {
    await window.E8Auth.ready;
    if (window.E8Auth.getState().connected) await window.E8Auth.signOut();
    else window.E8Auth.signIn();
    updateLoginButton();
    closeDrawer();
  });
  window.addEventListener("e8-auth-changed", updateLoginButton);
  window.addEventListener("pagehide", cancelPendingRequest);

  renderSuggestions();
  renderRecents();
  window.E8Auth.ready.then(updateLoginButton);
})();
