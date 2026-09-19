(() => {
  "use strict";

  const API_ENDPOINT = String(window.FORTNITE_AI_API_ENDPOINT || "").trim().replace(/\/+$/, "");
  const SITE_BASE_PATH = String(window.FNAA_CONFIG?.siteBasePath || "/Fortnite-agent/");
  const SESSION_KEY = "fortniteAiAgent.openrouterSession.v3";
  const LOGIN_PENDING_KEY = "fortniteAiAgent.openrouterLoginPending.v3";
  const LOGIN_PENDING_TTL_MS =
    15 * 60 * 1000;
  const PROFILE_PREFIX = "fortniteAiAgent.openrouterProfile.v3.";
  const DEFAULT_AVATAR = `${SITE_BASE_PATH}assets/default-user-avatar.jpeg`;
  const MAX_USERNAME_CHARS = 9;
  const MAX_AVATAR_DATA_URL = 180000;

  if (!window.FORTNITE_AUTH_READY) {
    window.FORTNITE_AUTH_READY = new Promise((resolve) => {
      window.__resolveFortniteAuthReady = resolve;
    });
  }

  let configured = !!API_ENDPOINT;
  let sessionToken = "";
  let currentUser = null;
  let currentProfile = null;
  let lastError = null;

  let lastLoginStatus = "";

  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch {
      try { return sessionStorage.getItem(key); }
      catch { return null; }
    }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch {
      try { sessionStorage.setItem(key, value); return true; }
      catch { return false; }
    }
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }

  function sessionStorageGet(
    key
  ) {
    try {
      return sessionStorage
        .getItem(key);
    } catch {
      return null;
    }
  }

  function sessionStorageSet(
    key,
    value
  ) {
    try {
      sessionStorage
        .setItem(
          key,
          value
        );

      return true;
    } catch {
      return false;
    }
  }

  function sessionStorageRemove(
    key
  ) {
    try {
      sessionStorage
        .removeItem(key);
    } catch {}
  }

  function profileStorageKey(uid) {
    return `${PROFILE_PREFIX}${String(uid || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180)}`;
  }

  function defaultLocalProfile(uid) {
    const suffix = String(uid || "").replace(/[^A-Za-z0-9]/g, "").slice(-4) || String(Math.floor(1000 + Math.random() * 9000));
    return {
      username: `user${suffix}`.slice(0, 9),
      avatar: "",
      setupComplete: true
    };
  }

  function loadLocalProfile(uid, fallback = null) {
    const base = safeProfile(fallback || defaultLocalProfile(uid));
    try {
      const raw = storageGet(profileStorageKey(uid));
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      return safeProfile({
        username: parsed?.username ?? base.username,
        avatar: parsed?.avatar ?? base.avatar,
        setupComplete: parsed?.setupComplete !== false
      });
    } catch {
      return base;
    }
  }

  function saveLocalProfile(uid, profile) {
    const clean = safeProfile(profile || {});
    storageSet(profileStorageKey(uid), JSON.stringify(clean));
    return clean;
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 6500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkLoginService() {
    if (!API_ENDPOINT) throw new Error("LOGIN_UNAVAILABLE");
    try {
      const { response, data } = await fetchJsonWithTimeout(`${API_ENDPOINT}/health`, {
        method: "GET",
        mode: "cors",
        cache: "no-store"
      }, 6500);
      if (!response.ok || data?.ok !== true || data?.authConfigured !== true) {
        throw new Error("LOGIN_UNAVAILABLE");
      }
      return true;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("LOGIN_TIMEOUT");
      throw new Error(error?.message === "LOGIN_TIMEOUT" ? "LOGIN_TIMEOUT" : "LOGIN_UNAVAILABLE");
    }
  }

  function normalizeUsername(input) {
    let value = String(input ?? "").normalize("NFKC");
    value = value.replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "");
    value = value.replace(/^@+/, "").replace(/\s+/g, " ").trim();
    const chars = Array.from(value);
    if (!chars.length) throw new Error("Username can't be empty.");
    if (chars.length > MAX_USERNAME_CHARS) throw new Error("Username must be 9 characters or less.");
    return chars.join("");
  }

  function safeProfile(raw) {
    const username = (() => {
      try { return normalizeUsername(raw?.username || "User"); }
      catch { return "User"; }
    })();
    const rawAvatar = typeof raw?.avatar === "string" ? raw.avatar : "";
    const avatar = rawAvatar.startsWith("data:image/jpeg;base64,") && rawAvatar.length <= MAX_AVATAR_DATA_URL ? rawAvatar : "";
    return {
      username,
      avatar,
      setupComplete: raw?.setupComplete === true
    };
  }

  function safeUser(raw) {
    if (!raw?.uid) return null;
    return {
      uid: String(raw.uid),
      displayName: String(raw.displayName || currentProfile?.username || ""),
      email: "",
      photoURL: ""
    };
  }

  function getState() {
    return {
      configured,
      user: currentUser ? { ...currentUser } : null,
      profile: currentProfile ? { ...currentProfile } : null,
      error: lastError ? String(lastError.message || lastError) : null,
      defaultAvatar: DEFAULT_AVATAR,
      provider: currentUser ? "openrouter" : null,
      loginStatus: lastLoginStatus
    };
  }

  function publish() {
    const detail = getState();
    window.dispatchEvent(new CustomEvent("fortnite-auth-changed", { detail }));
    return detail;
  }

  function cleanSessionToken(value) {
    const token = String(value || "").trim();
    return /^or_sess_v1\.[A-Za-z0-9_-]{12,64}\.[A-Za-z0-9_-]{40,1800}$/.test(token) ? token : "";
  }

  function persistSession(token) {
    sessionToken =
      cleanSessionToken(
        token
      );

    // Bearer credentials must never survive in localStorage. This limits
    // exposure if a future DOM bug is introduced and also avoids leaving a
    // reusable token behind after the tab/browser session ends.
    try {
      localStorage
        .removeItem(
          SESSION_KEY
        );
    } catch {}

    if (sessionToken) {
      sessionStorageSet(
        SESSION_KEY,
        sessionToken
      );
    } else {
      sessionStorageRemove(
        SESSION_KEY
      );
    }
  }

  function clearLoginFragment() {
    const url = new URL(location.href);
    if (!url.hash) return;
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (!params.has("or_session") && !params.has("or_login")) return;
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function consumeLoginRedirect() {
    const params =
      new URLSearchParams(
        location.hash
          .replace(
            /^#/,
            ""
          )
      );

    const token =
      cleanSessionToken(
        params.get(
          "or_session"
        )
      );

    const status =
      String(
        params.get(
          "or_login"
        ) ||
        ""
      )
        .trim()
        .toLowerCase();

    const pendingAt =
      Number(
        storageGet(
          LOGIN_PENDING_KEY
        ) ||
        0
      );

    const now =
      Date.now();

    const pendingFresh =
      Number.isFinite(
        pendingAt
      ) &&
      pendingAt > 0 &&
      pendingAt <=
        now + 60_000 &&
      now - pendingAt <=
        LOGIN_PENDING_TTL_MS;

    lastLoginStatus =
      status;

    lastError =
      null;

    if (token) {
      if (pendingFresh) {
        persistSession(
          token
        );
      } else {
        lastLoginStatus =
          "failed";

        lastError =
          new Error(
            "Login response was not started from this browser."
          );
      }
    } else if (
      status ===
      "success"
    ) {
      lastLoginStatus =
        "failed";

      lastError =
        new Error(
          "Login response did not contain a valid session."
        );
    }

    if (
      status &&
      status !==
        "success"
    ) {
      const friendly = {
        cancelled:
          "OpenRouter authorization was cancelled.",
        unavailable:
          "OpenRouter login is temporarily unavailable. Try again or continue as guest.",
        expired:
          "OpenRouter login expired. Try again.",
        failed:
          "OpenRouter login couldn't finish. Try again."
      };

      lastError =
        new Error(
          friendly[status] ||
          friendly.failed
        );
    }

    if (
      token ||
      status
    ) {
      storageRemove(
        LOGIN_PENDING_KEY
      );

      clearLoginFragment();
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    if (!API_ENDPOINT) throw new Error("FNAA API endpoint is not configured.");
    const headers = { "X-FNAA-Client": "web-v6" };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${API_ENDPOINT}${path}`, {
      method,
      mode: "cors",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function refreshSession() {
    if (!sessionToken) {
      currentUser = null;
      currentProfile = null;
      publish();
      return false;
    }
    try {
      const data = await api("/auth/session");
      const rawUser = data.user || { uid: data.uid, displayName: "" };
      const uid = String(rawUser?.uid || data.uid || "");
      if (!uid) throw new Error("Invalid OpenRouter account session.");
      currentProfile = loadLocalProfile(uid, data.profile || defaultLocalProfile(uid));
      currentUser = safeUser({ uid, displayName: currentProfile.username });
      lastError = null;
      publish();
      return !!currentUser;
    } catch (error) {
      persistSession("");
      currentUser = null;
      currentProfile = null;
      lastError = error?.status === 401 ? null : error;
      publish();
      return false;
    }
  }

  async function signInOpenRouter() {
    if (!configured) throw new Error("LOGIN_UNAVAILABLE");

    // OAuth always returns to the stable app root. The SPA restores its own
    // route afterwards, while the callback fragment remains visible to boot().
    const returnTo = new URL(SITE_BASE_PATH, location.origin).toString();
    const url = new URL(`${API_ENDPOINT}/auth/openrouter/start`);
    url.searchParams.set("return_to", returnTo);

    lastLoginStatus = "starting";
    storageSet(LOGIN_PENDING_KEY, String(Date.now()));
    publish();

    // Same-tab navigation is intentional:
    // no popup blockers, no third-party-cookie dependency, consistent on Safari/Chrome/Firefox.
    location.assign(url.toString());
  }

  async function saveProfile(patch) {
    if (!currentUser || !sessionToken) throw new Error("Log in first.");
    const next = {
      ...(currentProfile || defaultLocalProfile(currentUser.uid))
    };

    if (Object.prototype.hasOwnProperty.call(patch || {}, "username")) {
      next.username = normalizeUsername(patch.username);
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "avatar")) {
      const avatar = String(patch.avatar || "");
      if (avatar && (!avatar.startsWith("data:image/jpeg;base64,") || avatar.length > MAX_AVATAR_DATA_URL)) {
        throw new Error("The avatar is invalid or too large.");
      }
      next.avatar = avatar;
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, "setupComplete")) {
      next.setupComplete = patch.setupComplete === true;
    }

    currentProfile = saveLocalProfile(currentUser.uid, next);
    currentUser = safeUser({ uid: currentUser.uid, displayName: currentProfile.username });
    publish();
    return { ...currentProfile };
  }

  async function saveUsername(rawUsername) {
    const username = normalizeUsername(rawUsername);
    await saveProfile({ username });
    return username;
  }

  async function saveAvatar(dataUrl) {
    const avatar = String(dataUrl || "");
    if (!avatar.startsWith("data:image/jpeg;base64,")) throw new Error("Only processed JPEG avatars are accepted.");
    if (avatar.length > MAX_AVATAR_DATA_URL) throw new Error("That image is too large after processing.");
    await saveProfile({ avatar });
    return avatar;
  }

  async function finishSetup({ username, avatar = "" } = {}) {
    const nextUsername = normalizeUsername(username ?? currentProfile?.username ?? "User");
    const nextAvatar = avatar ? String(avatar) : String(currentProfile?.avatar || "");
    if (nextAvatar && (!nextAvatar.startsWith("data:image/jpeg;base64,") || nextAvatar.length > MAX_AVATAR_DATA_URL)) {
      throw new Error("The avatar is invalid or too large.");
    }
    return saveProfile({ username: nextUsername, avatar: nextAvatar, setupComplete: true });
  }

  async function skipSetup() {
    return saveProfile({ setupComplete: true });
  }

  async function signOutUser() {
    const token = sessionToken;
    persistSession("");
    currentUser = null;
    currentProfile = null;
    lastError = null;
    publish();
    if (token) {
      try {
        sessionToken = token;
        await api("/auth/logout", { method: "POST", body: {} });
      } catch {}
      finally { sessionToken = ""; }
    }
  }

  async function boot() {
    consumeLoginRedirect();
    // Delete any token left by older builds, then restore only the
    // current tab-scoped session token.
    let legacySessionToken = "";

    try {
      legacySessionToken =
        cleanSessionToken(
          localStorage
            .getItem(
              SESSION_KEY
            )
        );

      localStorage
        .removeItem(
          SESSION_KEY
        );
    } catch {}

    sessionToken =
      cleanSessionToken(
        sessionStorageGet(
          SESSION_KEY
        ) ||
        legacySessionToken
      );

    if (sessionToken) {
      // One-time migration from legacy localStorage into sessionStorage.
      sessionStorageSet(
        SESSION_KEY,
        sessionToken
      );
    }
    window.FortniteAuth = {
      configured,
      provider: "openrouter",
      defaultAvatar: DEFAULT_AVATAR,
      maxUsernameChars: MAX_USERNAME_CHARS,
      normalizeUsername,
      getState,
      getSessionToken: () => sessionToken,
      checkLoginService,
      refresh: refreshSession,
      signInDefault: signInOpenRouter,
      signInAnother: signInOpenRouter,
      saveUsername,
      saveAvatar,
      finishSetup,
      skipSetup,
      signOut: signOutUser
    };

    if (sessionToken) await refreshSession();
    else publish();

    window.__resolveFortniteAuthReady?.(window.FortniteAuth);
  }

  boot().catch((error) => {
    lastError = error;
    currentUser = null;
    currentProfile = null;
    publish();
    window.__resolveFortniteAuthReady?.(window.FortniteAuth);
  });
})();
