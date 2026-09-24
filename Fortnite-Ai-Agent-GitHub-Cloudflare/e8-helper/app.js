const API_BASE = "https://e8helper.a39328122.workers.dev";
const BOT_INSTALL_URL = "https://discord.com/oauth2/authorize?client_id=1551891287442071562&scope=bot%20applications.commands&permissions=84992&integration_type=0";
const STORAGE_KEY = "e8-helper-dashboard-session";
const PENDING_GUILD_KEY = "e8-helper-pending-guild";

const $ = (id) => document.getElementById(id);
const ui = {
  landing: $("landing"),
  app: $("app"),
  signOut: $("signOutBtn"),
  saveState: $("saveState"),
  guildSelect: $("guildSelect"),
  loading: $("loadingPanel"),
  install: $("installPanel"),
  dashboard: $("dashboard"),
  installBot: $("installBotBtn"),
  refreshInstall: $("refreshInstallBtn"),
  serverTitle: $("serverTitle"),
  setupBadge: $("setupBadge"),
  aiFeature: $("aiFeatureCard"),
  pathFeature: $("pathFeatureCard"),
  aiStatus: $("aiStatus"),
  pathStatus: $("pathStatus"),
  aiDisabled: $("aiDisabled"),
  aiSettings: $("aiSettings"),
  pathDisabled: $("pathDisabled"),
  pathSettings: $("pathSettings"),
  aiChannel: $("aiChannel"),
  pathChannel: $("pathChannel"),
  pathEveryone: $("pathEveryone"),
  pathRoles: $("pathRoles"),
  pathRoleBox: $("pathRoleBox"),
  pathRoleList: $("pathRoleList"),
  managerRoleList: $("managerRoleList"),
  supportChannel: $("supportChannel"),
  supportRole: $("supportRole"),
  ticketUrl: $("ticketUrl"),
  timezone: $("timezone"),
  wakeTime: $("wakeTime"),
  sleepTime: $("sleepTime"),
  openrouterCard: $("openrouterCard"),
  openrouterTitle: $("openrouterTitle"),
  openrouterText: $("openrouterText"),
  openrouterBtn: $("openrouterBtn"),
  disconnectOpenrouterWrap: $("disconnectOpenrouterWrap"),
  disconnectOpenrouterBtn: $("disconnectOpenrouterBtn"),
  selectedEmojiList: $("selectedEmojiList"),
  emojiEmpty: $("emojiEmpty"),
  addEmoji: $("addEmojiBtn"),
  emojiDialog: $("emojiDialog"),
  closeEmojiDialog: $("closeEmojiDialog"),
  emojiPickerGrid: $("emojiPickerGrid"),
  emojiPickerEmpty: $("emojiPickerEmpty"),
  conversationMemory: $("conversationMemoryToggle"),
  finishBtn: $("finishBtn"),
  finishTitle: $("finishTitle"),
  finishHint: $("finishHint"),
  toast: $("toast"),
};

const state = {
  session: localStorage.getItem(STORAGE_KEY) || "",
  me: null,
  guildId: "",
  resources: null,
  config: null,
  openrouterConnected: false,
  saveTimer: null,
  saving: false,
  dirtyWhileSaving: false,
};

function toast(message, error = false) {
  ui.toast.textContent = message;
  ui.toast.classList.remove("hidden", "error");
  if (error) ui.toast.classList.add("error");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.add("hidden"), 3400);
}

function setSaveState(label, kind = "") {
  ui.saveState.textContent = label;
  ui.saveState.className = "save-state";
  if (kind) ui.saveState.classList.add(kind);
}

function getInitialGuildFromUrl() {
  const url = new URL(location.href);
  return url.searchParams.get("guild") ||
    localStorage.getItem(PENDING_GUILD_KEY) ||
    "";
}

function captureSessionFromHash() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const params = new URLSearchParams(raw);
  const session = params.get("session");
  if (!session) return;
  localStorage.setItem(STORAGE_KEY, session);
  state.session = session;
  history.replaceState({}, "", location.pathname + location.search);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.session) headers.set("Authorization", `Bearer ${state.session}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(API_BASE + path, {
    ...options,
    headers,
  });

  let body = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    body = await response.json().catch(() => ({}));
  } else {
    body = await response.text().catch(() => "");
  }

  if (!response.ok) {
    const error = new Error(
      body?.message || body?.error || `Request failed (${response.status})`,
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function signOut() {
  if (state.session) {
    api("/dashboard/api/logout", { method: "POST" }).catch(() => {});
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PENDING_GUILD_KEY);
  state.session = "";
  location.href = "./";
}

function iconUrl(guild) {
  if (!guild?.icon) return "";
  const ext = String(guild.icon).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=64`;
}

function option(value, label, selected = false) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  el.selected = selected;
  return el;
}

function fillChannelSelect(select, value, optional = false) {
  select.innerHTML = "";
  select.append(option("", optional ? "Not set" : "Choose a channel…"));
  for (const channel of state.resources?.channels || []) {
    select.append(option(channel.id, `# ${channel.name}`, channel.id === value));
  }
  select.value = value || "";
}

function fillRoleSelect(select, value) {
  select.innerHTML = "";
  select.append(option("", "Not set"));
  for (const role of state.resources?.roles || []) {
    if (role.managed) continue;
    select.append(option(role.id, `@ ${role.name}`, role.id === value));
  }
  select.value = value || "";
}

function roleChoices(container, selected, onChange) {
  const selectedSet = new Set(selected || []);
  container.innerHTML = "";

  const roles = (state.resources?.roles || []).filter((role) => !role.managed);
  if (!roles.length) {
    container.innerHTML = '<div class="empty-state">No selectable roles found.</div>';
    return;
  }

  for (const role of roles) {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedSet.has(role.id);
    input.addEventListener("change", () => {
      const values = [...container.querySelectorAll('input[type="checkbox"]:checked')]
        .map((item) => item.value);
      onChange(values);
    });
    input.value = role.id;
    const span = document.createElement("span");
    span.textContent = "@" + role.name;
    label.append(input, span);
    container.append(label);
  }
}

function minuteToTime(value) {
  const minute = Math.max(0, Math.min(1439, Number(value) || 0));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function timeToMinute(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function populateTimezones(selected) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [
      "America/New_York",
      "Asia/Baghdad",
      "Europe/London",
      "Europe/Paris",
      "Asia/Dubai",
      "Asia/Riyadh",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
  }
  if (selected && !zones.includes(selected)) zones.unshift(selected);
  ui.timezone.innerHTML = "";
  for (const zone of zones) ui.timezone.append(option(zone, zone, zone === selected));
  ui.timezone.value = selected;
}

function normalizeNewConfig(config) {
  if (config.setupComplete) return config;
  if (!config.ai.timezone || config.ai.timezone === "America/New_York") {
    config.ai.timezone = localTimezone();
  }
  if (!Number.isInteger(Number(config.ai.wakeMinute))) config.ai.wakeMinute = 14 * 60;
  if (!Number.isInteger(Number(config.ai.sleepMinute))) config.ai.sleepMinute = 23 * 60;
  return config;
}

function renderFeatureState() {
  const ai = Boolean(state.config?.ai?.enabled);
  const path = Boolean(state.config?.pathFinder?.enabled);

  ui.aiFeature.classList.toggle("enabled", ai);
  ui.pathFeature.classList.toggle("enabled", path);
  ui.aiStatus.textContent = ai ? "Enabled" : "Disabled";
  ui.pathStatus.textContent = path ? "Enabled" : "Disabled";
  ui.aiStatus.className = ai ? "badge good" : "badge muted";
  ui.pathStatus.className = path ? "badge good" : "badge muted";
  ui.aiDisabled.classList.toggle("hidden", ai);
  ui.aiSettings.classList.toggle("hidden", !ai);
  ui.pathDisabled.classList.toggle("hidden", path);
  ui.pathSettings.classList.toggle("hidden", !path);
}

function renderOpenRouter() {
  const external = state.config?.ai?.provider !== "workers-ai";
  const connected = state.openrouterConnected;

  ui.openrouterCard.classList.toggle("connected", connected);
  ui.openrouterTitle.textContent = connected ? "OpenRouter connected" : "Connect OpenRouter";
  ui.openrouterText.textContent = connected
    ? "AI is ready. E8 handles the free model automatically."
    : "Sign in once and approve E8 Helper. No API keys or model settings.";
  ui.openrouterBtn.textContent = connected ? "Connected ✓" : "Continue with OpenRouter";
  ui.openrouterBtn.disabled = connected;
  ui.openrouterCard.classList.toggle("hidden", !external);
  ui.disconnectOpenrouterWrap.classList.toggle("hidden", !external || !connected);
}

function renderAccessMode() {
  const roles = state.config.pathFinder.access === "roles";
  ui.pathEveryone.classList.toggle("active", !roles);
  ui.pathRoles.classList.toggle("active", roles);
  ui.pathRoleBox.classList.toggle("hidden", !roles);
}

function renderEmojiList() {
  const list = state.config.customEmojis || [];
  ui.selectedEmojiList.innerHTML = "";
  ui.emojiEmpty.classList.toggle("hidden", list.length > 0);

  for (const item of list) {
    const source = (state.resources?.emojis || []).find((emoji) => emoji.id === item.id);
    const card = document.createElement("div");
    card.className = "emoji-card";

    const img = document.createElement("img");
    img.src = source?.imageUrl ||
      `https://cdn.discordapp.com/emojis/${item.id}.${item.animated ? "gif" : "png"}?size=96&quality=lossless`;
    img.alt = item.name;

    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = ":" + item.name + ":";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 180;
    input.placeholder = "What should this emoji mean?";
    input.value = item.description || "";
    input.addEventListener("input", () => {
      item.description = input.value;
      markDirty();
    });
    body.append(name, input);

    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove emoji");
    remove.addEventListener("click", () => {
      state.config.customEmojis = state.config.customEmojis.filter((emoji) => emoji.id !== item.id);
      renderEmojiList();
      markDirty();
    });

    card.append(img, body, remove);
    ui.selectedEmojiList.append(card);
  }
}

function renderEmojiPicker() {
  const selected = new Set((state.config.customEmojis || []).map((emoji) => emoji.id));
  const emojis = (state.resources?.emojis || []).filter((emoji) => emoji.available && !selected.has(emoji.id));
  ui.emojiPickerGrid.innerHTML = "";
  ui.emojiPickerEmpty.classList.toggle("hidden", emojis.length > 0);

  for (const emoji of emojis) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-pick";
    const img = document.createElement("img");
    img.src = emoji.imageUrl;
    img.alt = emoji.name;
    const name = document.createElement("span");
    name.textContent = ":" + emoji.name + ":";
    button.append(img, name);
    button.addEventListener("click", () => {
      state.config.customEmojis.push({
        id: emoji.id,
        name: emoji.name,
        animated: emoji.animated,
        description: "",
      });
      ui.emojiDialog.close();
      renderEmojiList();
      markDirty();
      setTimeout(() => {
        const inputs = ui.selectedEmojiList.querySelectorAll("input");
        inputs[inputs.length - 1]?.focus();
      }, 0);
    });
    ui.emojiPickerGrid.append(button);
  }
}

function updateFinishState() {
  if (!state.config) return;
  const ai = state.config.ai.enabled;
  const path = state.config.pathFinder.enabled;
  let issue = "";

  if (!ai && !path) issue = "Choose at least one feature to continue.";
  else if (ai && !state.config.ai.channelId) issue = "Choose an AI Chat channel.";
  else if (ai && state.config.ai.provider !== "workers-ai" && !state.openrouterConnected) {
    issue = "Connect OpenRouter to finish AI Chat setup.";
  } else if (path && !state.config.pathFinder.channelId) {
    issue = "Choose a Path Finder channel.";
  } else if ((state.config.customEmojis || []).some((emoji) => !emoji.description.trim())) {
    issue = "Add a short meaning for each custom emoji.";
  }

  ui.finishBtn.disabled = Boolean(issue);
  ui.finishHint.textContent = issue || "Everything looks ready.";
  ui.finishTitle.textContent = state.config.setupComplete ? "E8 Helper is configured" : "Finish setup";
  ui.finishBtn.textContent = state.config.setupComplete ? "Save now" : "Finish setup";
  ui.setupBadge.textContent = state.config.setupComplete ? "Configured" : "Setup in progress";
  ui.setupBadge.className = state.config.setupComplete ? "badge good" : "badge";
}

function renderDashboard() {
  if (!state.config || !state.resources) return;

  ui.serverTitle.textContent = state.resources.guild?.name || "E8 Helper";
  renderFeatureState();
  renderOpenRouter();

  fillChannelSelect(ui.aiChannel, state.config.ai.channelId, false);
  fillChannelSelect(ui.pathChannel, state.config.pathFinder.channelId, false);
  fillChannelSelect(ui.supportChannel, state.config.support.channelId, true);
  fillRoleSelect(ui.supportRole, state.config.support.roleId);

  ui.ticketUrl.value = state.config.support.ticketUrl || "";

  renderAccessMode();
  roleChoices(ui.pathRoleList, state.config.pathFinder.roleIds, (values) => {
    state.config.pathFinder.roleIds = values;
    markDirty();
  });
  roleChoices(ui.managerRoleList, state.config.managers.roleIds, (values) => {
    state.config.managers.roleIds = values;
    markDirty();
  });

  populateTimezones(state.config.ai.timezone || localTimezone());
  ui.wakeTime.value = minuteToTime(state.config.ai.wakeMinute);
  ui.sleepTime.value = minuteToTime(state.config.ai.sleepMinute);

  ui.conversationMemory.classList.toggle("on", state.config.ai.conversationMemory !== false);

  renderEmojiList();
  updateFinishState();
}

function canTurnOff(feature) {
  if (!state.config?.setupComplete) return true;
  const ai = feature === "ai" ? false : state.config.ai.enabled;
  const path = feature === "path" ? false : state.config.pathFinder.enabled;
  if (!ai && !path) {
    toast("E8 Helper needs at least one feature enabled.", true);
    return false;
  }
  return true;
}

function toggleFeature(feature) {
  if (feature === "ai") {
    if (state.config.ai.enabled && !canTurnOff("ai")) return;
    state.config.ai.enabled = !state.config.ai.enabled;
    state.config.features.aiChat = state.config.ai.enabled;
  } else {
    if (state.config.pathFinder.enabled && !canTurnOff("path")) return;
    state.config.pathFinder.enabled = !state.config.pathFinder.enabled;
    state.config.features.pathFinder = state.config.pathFinder.enabled;
  }
  renderFeatureState();
  updateFinishState();
  markDirty();
}

function markDirty() {
  if (!state.config || !state.resources?.botInstalled) return;
  updateFinishState();
  setSaveState("Saving…", "saving");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveConfig(false), 750);
}

async function saveConfig(forceComplete = false) {
  if (!state.config || !state.guildId || !state.resources?.botInstalled) return;
  if (state.saving) {
    state.dirtyWhileSaving = true;
    return;
  }

  const originalComplete = state.config.setupComplete;
  if (forceComplete) state.config.setupComplete = true;

  state.saving = true;
  setSaveState("Saving…", "saving");

  try {
    const body = await api(`/dashboard/api/guild/${state.guildId}/config`, {
      method: "PUT",
      body: JSON.stringify(state.config),
    });
    state.config = body.config;
    state.openrouterConnected = Boolean(body.openrouterConnected);
    setSaveState("Saved", "saved");
    renderOpenRouter();
    updateFinishState();
    if (forceComplete) toast("E8 Helper is ready for this server.");
  } catch (error) {
    if (forceComplete) state.config.setupComplete = originalComplete;
    setSaveState("Couldn't save", "error");
    toast(error.message || "Couldn't save your settings.", true);
  } finally {
    state.saving = false;
    if (state.dirtyWhileSaving) {
      state.dirtyWhileSaving = false;
      markDirty();
    }
  }
}

async function loadGuild(guildId) {
  state.guildId = guildId;
  localStorage.setItem(PENDING_GUILD_KEY, guildId);
  const url = new URL(location.href);
  url.searchParams.set("guild", guildId);
  history.replaceState({}, "", url.pathname + url.search);

  ui.loading.classList.remove("hidden");
  ui.install.classList.add("hidden");
  ui.dashboard.classList.add("hidden");

  try {
    const resources = await api(`/dashboard/api/guild/${guildId}/resources`);
    state.resources = resources;

    if (!resources.botInstalled) {
      ui.installBot.href = resources.installUrl;
      ui.loading.classList.add("hidden");
      ui.install.classList.remove("hidden");
      return;
    }

    const data = await api(`/dashboard/api/guild/${guildId}/config`);
    state.config = normalizeNewConfig(data.config);
    state.openrouterConnected = Boolean(data.openrouterConnected);

    ui.loading.classList.add("hidden");
    ui.dashboard.classList.remove("hidden");
    renderDashboard();

    if (!state.config.setupComplete) markDirty();
  } catch (error) {
    ui.loading.classList.add("hidden");
    toast(error.message || "Couldn't load this server.", true);
  }
}

async function connectOpenRouter() {
  try {
    ui.openrouterBtn.disabled = true;
    ui.openrouterBtn.textContent = "Opening…";
    await saveConfig(false);
    const result = await api(`/dashboard/api/guild/${state.guildId}/openrouter/start`, {
      method: "POST",
    });
    if (result.connected) {
      state.openrouterConnected = true;
      renderOpenRouter();
      updateFinishState();
      return;
    }
    if (!result.authorizeUrl) throw new Error("OpenRouter connection is unavailable.");
    location.href = result.authorizeUrl;
  } catch (error) {
    toast(error.message || "Couldn't connect OpenRouter.", true);
    renderOpenRouter();
  }
}

async function disconnectOpenRouter() {
  if (!confirm("Disconnect OpenRouter from this server?")) return;
  try {
    await api(`/dashboard/api/guild/${state.guildId}/openrouter`, { method: "DELETE" });
    state.openrouterConnected = false;
    renderOpenRouter();
    updateFinishState();
    toast("OpenRouter disconnected.");
  } catch (error) {
    toast(error.message || "Couldn't disconnect OpenRouter.", true);
  }
}

async function boot() {
  captureSessionFromHash();

  const pendingGuild = getInitialGuildFromUrl();
  if (pendingGuild) localStorage.setItem(PENDING_GUILD_KEY, pendingGuild);

  const query = new URL(location.href).searchParams;
  if (query.get("openrouter") === "connected") {
    toast("OpenRouter connected.");
    query.delete("openrouter");
    const clean = new URL(location.href);
    clean.search = query.toString();
    history.replaceState({}, "", clean.pathname + (clean.search ? "?" + clean.search : ""));
  }

  if (!state.session) {
    ui.landing.classList.remove("hidden");
    ui.app.classList.add("hidden");
    return;
  }

  try {
    state.me = await api("/dashboard/api/me");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    state.session = "";
    ui.landing.classList.remove("hidden");
    ui.app.classList.add("hidden");
    return;
  }

  ui.landing.classList.add("hidden");
  ui.app.classList.remove("hidden");
  ui.signOut.classList.remove("hidden");
  ui.saveState.classList.remove("hidden");

  ui.guildSelect.innerHTML = "";
  for (const guild of state.me.guilds || []) {
    ui.guildSelect.append(option(guild.id, guild.name));
  }

  if (!(state.me.guilds || []).length) {
    ui.loading.innerHTML = '<div class="empty-state">No servers you can manage were found.</div>';
    return;
  }

  const preferred = getInitialGuildFromUrl();
  const available = (state.me.guilds || []).some((guild) => guild.id === preferred)
    ? preferred
    : state.me.guilds[0].id;
  ui.guildSelect.value = available;
  await loadGuild(available);
}

$("discordLoginBtn").addEventListener("click", () => {
  location.href = BOT_INSTALL_URL;
});
ui.signOut.addEventListener("click", signOut);
ui.guildSelect.addEventListener("change", () => loadGuild(ui.guildSelect.value));
ui.refreshInstall.addEventListener("click", () => loadGuild(state.guildId));
ui.aiFeature.addEventListener("click", () => toggleFeature("ai"));
ui.pathFeature.addEventListener("click", () => toggleFeature("path"));

ui.aiChannel.addEventListener("change", () => {
  state.config.ai.channelId = ui.aiChannel.value;
  markDirty();
});
ui.pathChannel.addEventListener("change", () => {
  state.config.pathFinder.channelId = ui.pathChannel.value;
  markDirty();
});
ui.supportChannel.addEventListener("change", () => {
  state.config.support.channelId = ui.supportChannel.value;
  markDirty();
});
ui.supportRole.addEventListener("change", () => {
  state.config.support.roleId = ui.supportRole.value;
  markDirty();
});
ui.ticketUrl.addEventListener("input", () => {
  state.config.support.ticketUrl = ui.ticketUrl.value;
  markDirty();
});

ui.pathEveryone.addEventListener("click", () => {
  state.config.pathFinder.access = "everyone";
  renderAccessMode();
  markDirty();
});
ui.pathRoles.addEventListener("click", () => {
  state.config.pathFinder.access = "roles";
  renderAccessMode();
  markDirty();
});

ui.timezone.addEventListener("change", () => {
  state.config.ai.timezone = ui.timezone.value;
  markDirty();
});
ui.wakeTime.addEventListener("change", () => {
  state.config.ai.wakeMinute = timeToMinute(ui.wakeTime.value, 14 * 60);
  markDirty();
});
ui.sleepTime.addEventListener("change", () => {
  state.config.ai.sleepMinute = timeToMinute(ui.sleepTime.value, 23 * 60);
  markDirty();
});

ui.openrouterBtn.addEventListener("click", connectOpenRouter);
ui.disconnectOpenrouterBtn.addEventListener("click", disconnectOpenRouter);

ui.addEmoji.addEventListener("click", () => {
  renderEmojiPicker();
  ui.emojiDialog.showModal();
});
ui.closeEmojiDialog.addEventListener("click", () => ui.emojiDialog.close());
ui.emojiDialog.addEventListener("click", (event) => {
  if (event.target === ui.emojiDialog) ui.emojiDialog.close();
});

ui.conversationMemory.addEventListener("click", () => {
  state.config.ai.conversationMemory = !(state.config.ai.conversationMemory !== false);
  ui.conversationMemory.classList.toggle("on", state.config.ai.conversationMemory);
  markDirty();
});

ui.finishBtn.addEventListener("click", () => saveConfig(true));

document.querySelectorAll(".nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

boot();
