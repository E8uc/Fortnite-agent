(() => {
  "use strict";

  const API_ENDPOINT = "https://fortnite-ai-agent-api.a39328122.workers.dev";
  const SESSION_KEY = "fortniteAiAgent.openrouterSession.v3";
  const TOKEN_RE = /^or_sess_v1\.[A-Za-z0-9_-]{12,64}\.[A-Za-z0-9_-]{40,2200}$/;

  let sessionToken = "";
  let state = Object.freeze({ mode: "guest", connected: false, user: null, account: null, error: null });

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch {}
    try { return sessionStorage.getItem(key); } catch {}
    return null;
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); return; } catch {}
    try { sessionStorage.setItem(key, value); } catch {}
  }

  function removeStorage(key) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }

  function cleanToken(value) {
    const token = String(value || "").trim();
    return TOKEN_RE.test(token) ? token : "";
  }

  function publish(next) {
    state = Object.freeze({ ...state, ...next });
    window.dispatchEvent(new CustomEvent("e8-auth-changed", { detail: state }));
    return state;
  }

  function consumeCallback() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const token = cleanToken(hash.get("or_session"));
    const status = String(hash.get("or_login") || "").trim().toLowerCase();
    if (token) {
      sessionToken = token;
      writeStorage(SESSION_KEY, token);
    }
    if (token || status) history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (status && status !== "success") publish({ error: status });
  }

  async function request(path, options = {}) {
    const headers = { "X-FNAA-Client": "e8-web-v1", ...(options.headers || {}) };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API_ENDPOINT}${path}`, {
      method: options.method || "GET",
      mode: "cors",
      cache: "no-store",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function refresh() {
    if (!sessionToken) return publish({ mode: "guest", connected: false, user: null, account: null, error: null });
    try {
      const data = await request("/auth/session");
      let account = null;
      try {
        account = await request("/e8/account");
      } catch (accountError) {
        if (accountError.status === 401) {
          sessionToken = "";
          removeStorage(SESSION_KEY);
          return publish({ mode: "guest", connected: false, user: null, account: null, error: null });
        }
      }
      return publish({ mode: "authenticated", connected: true, user: data.user || null, account, error: null });
    } catch (error) {
      if (error.status === 401) {
        sessionToken = "";
        removeStorage(SESSION_KEY);
        return publish({ mode: "guest", connected: false, user: null, account: null, error: null });
      }
      return publish({ error: error.message || "Login check failed" });
    }
  }

  function signIn() {
    const returnTo = `${location.origin}${location.pathname}`;
    const url = new URL(`${API_ENDPOINT}/auth/openrouter/start`);
    url.searchParams.set("return_to", returnTo);
    location.assign(url.toString());
  }

  async function signOut() {
    const old = sessionToken;
    sessionToken = "";
    removeStorage(SESSION_KEY);
    publish({ mode: "guest", connected: false, user: null, account: null, error: null });
    if (!old) return;
    sessionToken = old;
    try { await request("/auth/logout", { method: "POST", body: {} }); } catch {}
    sessionToken = "";
  }

  async function boot() {
    consumeCallback();
    if (!sessionToken) sessionToken = cleanToken(readStorage(SESSION_KEY));
    await refresh();
    return state;
  }

  window.E8Auth = Object.freeze({
    API_ENDPOINT,
    getState: () => state,
    getSessionToken: () => sessionToken,
    request,
    refresh,
    signIn,
    signOut,
    ready: boot()
  });
})();
