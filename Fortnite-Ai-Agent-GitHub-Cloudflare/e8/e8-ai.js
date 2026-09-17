(() => {
  "use strict";

  const HISTORY_KEY = "e8.ai.localHistory.v1";
  const MAX_HISTORY = 20;
  const MAX_MESSAGES = 12;
  const MAX_TOTAL_CHARS = 24000;

  const suggestionPool = [
    "How To make The mesh Method",
    "How To Get The dev inventory",
    "How To copy the Orange and the White Copy props",
    "What is The Mesh Method",
    "What is the Dev inventory",
    "What Is the Orange and White copy props",
    "Is the paks bandable?",
    "What is NovaSparx",
    "Is NovaSparx for free?",
    "Who made you",
    "How to use Braille Tool",
    "Why is somethings not for free",
    "How To make my own CNC",
    "Credits"
  ];

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

  function safeParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function readHistory() {
    try {
      const parsed = safeParse(localStorage.getItem(HISTORY_KEY), []);
      return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
    } catch { return []; }
  }

  function writeHistory(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch {}
  }

  function randomSuggestions() {
    const copy = [...suggestionPool];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
      const j = Math.floor(random * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, 5);
  }

  function renderSuggestions() {
    els.grid.replaceChildren();
    for (const text of randomSuggestions()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "e8-suggestion";
      button.textContent = text;
      button.title = text;
      button.addEventListener("click", () => startNewChat(text));
      els.grid.append(button);
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
    history.unshift({ id: activeId, title: conversationTitle(), updatedAt: Date.now(), messages: messages.slice(-MAX_MESSAGES) });
    writeHistory(history);
    renderRecents();
  }

  function renderRecents(filter = "") {
    const query = filter.trim().toLowerCase();
    const items = readHistory().filter((item) => !query || String(item.title || "").toLowerCase().includes(query));
    const target = filter ? els.searchResults : els.recentList;
    target.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "e8-search-result";
      button.textContent = item.title || "Chat";
      button.addEventListener("click", () => loadConversation(item));
      target.append(button);
    }
    if (!items.length && filter) {
      const empty = document.createElement("div");
      empty.className = "e8-muted";
      empty.textContent = "No matching chats.";
      target.append(empty);
    }
  }

  function loadConversation(item) {
    activeId = String(item.id || "");
    messages = Array.isArray(item.messages) ? item.messages.filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").slice(-MAX_MESSAGES) : [];
    els.chat.replaceChildren();
    for (const message of messages) appendMessage(message.role, message.content);
    setChatMode(true);
    closeSearch();
  }

  function resetChat() {
    messages = [];
    activeId = "";
    els.chat.replaceChildren();
    els.welcomeInput.value = "";
    els.chatInput.value = "";
    setChatMode(false);
    renderSuggestions();
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

    try {
      await window.E8Auth.ready;
      const headers = { "Content-Type": "application/json", "X-FNAA-Client": "e8-web-v1" };
      const token = window.E8Auth.getSessionToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const clientContext = window.E8Database
        ? await window.E8Database.buildClientContext(content)
        : null;
      const body = { messages: messages.slice(-MAX_MESSAGES), mode: "chat" };
      if (clientContext) body.client_context = clientContext;

      const response = await fetch(window.E8Auth.API_ENDPOINT, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers,
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

      const answer = String(data.reply || data.answer || data.message || data.choices?.[0]?.message?.content || "").trim();
      if (!answer) throw new Error("E8AI returned an empty response.");
      thinking.textContent = answer;
      messages.push({ role: "assistant", content: answer });
      saveConversation();
    } catch (error) {
      thinking.classList.add("error");
      thinking.textContent = error?.message || "Couldn't reach E8AI. Try again.";
    } finally {
      busy = false;
      els.chatSend.disabled = false;
      els.chatInput.focus();
    }
  }

  function startNewChat(text) {
    resetChat();
    send(text);
  }

  function openSearch() {
    els.searchPanel.hidden = false;
    els.searchInput.value = "";
    renderRecents("");
    requestAnimationFrame(() => els.searchInput.focus());
  }

  function closeSearch() {
    els.searchPanel.hidden = true;
  }

  function updateLoginButton() {
    const state = window.E8Auth.getState();
    els.login.firstElementChild.textContent = state.connected ? "Log out" : "Log in";
  }

  els.welcomeComposer.addEventListener("submit", (event) => { event.preventDefault(); const value = els.welcomeInput.value; els.welcomeInput.value = ""; startNewChat(value); });
  els.chatComposer.addEventListener("submit", (event) => { event.preventDefault(); const value = els.chatInput.value; els.chatInput.value = ""; send(value); });
  els.newChat.addEventListener("click", resetChat);
  els.searchButton.addEventListener("click", () => els.searchPanel.hidden ? openSearch() : closeSearch());
  els.searchInput.addEventListener("input", () => renderRecents(els.searchInput.value));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.searchPanel.hidden) closeSearch(); });
  els.login.addEventListener("click", async () => { await window.E8Auth.ready; if (window.E8Auth.getState().connected) await window.E8Auth.signOut(); else window.E8Auth.signIn(); updateLoginButton(); });
  window.addEventListener("e8-auth-changed", updateLoginButton);

  renderSuggestions();
  renderRecents();
  window.E8Auth.ready.then(updateLoginButton);
})();
