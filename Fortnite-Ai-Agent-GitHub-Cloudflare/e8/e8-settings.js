(() => {
  "use strict";

  const id = document.getElementById("accountId");
  const plan = document.getElementById("plan");
  const status = document.getElementById("status");
  const expire = document.getElementById("expire");
  const apiState = document.getElementById("apiState");
  const copy = document.getElementById("copyId");
  const accountButton = document.getElementById("accountButton");

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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
  }

  copy.addEventListener("click", async () => {
    const value = String(id.textContent || "").trim();
    if (!/^E8[A-Za-z0-9]{15}uC$/.test(value)) return;
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy ID"; }, 1200);
    } catch {}
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
