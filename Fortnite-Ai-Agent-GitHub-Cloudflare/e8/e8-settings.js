(() => {
  "use strict";

  const id = document.getElementById("accountId");
  const plan = document.getElementById("plan");
  const status = document.getElementById("status");
  const expire = document.getElementById("expire");
  const apiState = document.getElementById("apiState");
  const copy = document.getElementById("copyId");
  const accountButton = document.getElementById("accountButton");
  const plusToolsCard = document.getElementById("plusToolsCard");
  const plusToolsList = document.getElementById("plusToolsList");
  const plusToolCount = document.getElementById("plusToolCount");
  const savePlusTools = document.getElementById("savePlusTools");
  const plusToolsStatus = document.getElementById("plusToolsStatus");

  let toolCatalog = [];
  let selectedTools = new Set();
  let toolsLoadVersion = 0;

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function displayToolName(toolId) {
    return String(toolId || "")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function updateToolCount() {
    plusToolCount.textContent = String(selectedTools.size);
  }

  function clearToolsUi() {
    toolCatalog = [];
    selectedTools = new Set();
    plusToolsList.replaceChildren();
    plusToolsStatus.textContent = "";
    updateToolCount();
  }

  function renderTools() {
    plusToolsList.replaceChildren();
    for (const tool of toolCatalog) {
      const label = document.createElement("label");
      label.className = "e8-tool-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = tool;
      input.checked = selectedTools.has(tool);
      input.addEventListener("change", () => {
        if (input.checked && selectedTools.size >= 5) {
          input.checked = false;
          plusToolsStatus.textContent = "You can choose up to 5 tools.";
          return;
        }
        if (input.checked) selectedTools.add(tool);
        else selectedTools.delete(tool);
        plusToolsStatus.textContent = "";
        updateToolCount();
      });
      const text = document.createElement("span");
      text.textContent = displayToolName(tool);
      label.append(input, text);
      plusToolsList.append(label);
    }
    updateToolCount();
  }

  async function loadPlusTools() {
    const loadVersion = ++toolsLoadVersion;
    const state = window.E8Auth.getState();
    const isPlus = state.connected && state.account?.effectivePlan === "plus";
    plusToolsCard.hidden = !isPlus;

    if (!isPlus) {
      clearToolsUi();
      return;
    }

    plusToolsStatus.textContent = "Loading…";
    try {
      const data = await window.E8Auth.request("/e8/tools");
      if (loadVersion !== toolsLoadVersion) return;
      const current = window.E8Auth.getState();
      if (!current.connected || current.account?.effectivePlan !== "plus") return;

      toolCatalog = Array.isArray(data.catalog) ? data.catalog : [];
      selectedTools = new Set(Array.isArray(data.selected) ? data.selected.slice(0, 5) : []);
      renderTools();
      plusToolsStatus.textContent = toolCatalog.length ? "" : "No selectable tools are configured yet.";
    } catch (error) {
      if (loadVersion !== toolsLoadVersion) return;
      plusToolsStatus.textContent = error?.message || "Couldn't load Plus tools.";
    }
  }

  function render() {
    const state = window.E8Auth.getState();
    const account = state.account || {};
    id.textContent = account.id || "—";
    plan.textContent = account.plan || (state.connected ? "Free" : "Guest");
    status.textContent = account.status || (state.connected ? "Active" : "Guest");
    expire.textContent = formatDate(account.expiresAt);
    apiState.textContent = state.connected ? "Connected" : "Not connected";
    copy.disabled = !account.id;
    accountButton.textContent = state.connected ? "Log out" : "Log in";
    void loadPlusTools();
  }

  copy.addEventListener("click", async () => {
    const value = String(id.textContent || "").trim();
    if (!/^E8[A-Za-z0-9]{15}uC$/.test(value)) return;
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy ID"; }, 1200);
    } catch {
      copy.textContent = "Copy failed";
      setTimeout(() => { copy.textContent = "Copy ID"; }, 1200);
    }
  });

  savePlusTools.addEventListener("click", async () => {
    const state = window.E8Auth.getState();
    if (!state.connected || state.account?.effectivePlan !== "plus" || selectedTools.size > 5) return;

    savePlusTools.disabled = true;
    plusToolsStatus.textContent = "Saving…";
    try {
      const data = await window.E8Auth.request("/e8/account/tools", {
        method: "POST",
        body: { tools: [...selectedTools] }
      });
      selectedTools = new Set(Array.isArray(data.selected) ? data.selected.slice(0, 5) : []);
      renderTools();
      plusToolsStatus.textContent = "Saved.";
    } catch (error) {
      plusToolsStatus.textContent = error?.message || "Couldn't save the tool selection.";
    } finally {
      savePlusTools.disabled = false;
    }
  });

  accountButton.addEventListener("click", async () => {
    await window.E8Auth.ready;
    if (window.E8Auth.getState().connected) await window.E8Auth.signOut();
    else window.E8Auth.signIn();
    render();
  });

  window.addEventListener("e8-auth-changed", render);
  window.E8Auth.ready.then(render);
})();
