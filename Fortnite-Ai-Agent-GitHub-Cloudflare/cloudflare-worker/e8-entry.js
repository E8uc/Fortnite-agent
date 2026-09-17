import legacyWorker from "./worker.js";

const SITE_ORIGIN = "https://e8uc.github.io";
const E8_CLASS = "E8Account";
const E8_ID_RE = /^E8[A-Za-z0-9]{15}uC$/;
const E8_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SESSION_RE = /^or_sess_v1\.[A-Za-z0-9_-]{12,64}\.[A-Za-z0-9_-]{40,2200}$/;
const AUTH_AAD = "FNAA-STATELESS-OPENROUTER-AUTH";
const ABUSE_WINDOW_MS = 60_000;
const ABUSE_MAX = 60;
const ADMIN_ABUSE_MAX = 12;
const BUCKETS = new Map();

function allowedOrigins(env) {
  const set = new Set([SITE_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"]);
  String(env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => set.add(value));
  return set;
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-FNAA-Client",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Vary": "Origin"
  };
  if (allowedOrigins(env).has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(request, env), ...extra } });
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return !!origin && allowedOrigins(env).has(origin);
}

function requestIp(request) {
  return String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 96);
}

function allow(request, max = ABUSE_MAX) {
  const key = `${requestIp(request)}:${new URL(request.url).pathname}`;
  const now = Date.now();
  const record = BUCKETS.get(key);
  if (!record || now - record.startedAt >= ABUSE_WINDOW_MS) {
    BUCKETS.set(key, { startedAt: now, count: 1 });
    return true;
  }
  record.count += 1;
  return record.count <= max;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function vaultSecret(env) {
  const secret = String(env.API_VAULT_MASTER_KEY || "");
  if (secret.length < 32) throw new Error("E8_VAULT_UNAVAILABLE");
  return secret;
}

async function deriveSessionKey(env) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", encoder.encode(vaultSecret(env)), "HKDF", false, ["deriveKey"]);
  const salt = await crypto.subtle.digest("SHA-256", encoder.encode("FNAA Stateless OpenRouter Auth v1"));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("purpose:session") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function readLegacySession(env, token) {
  token = String(token || "").trim();
  if (!SESSION_RE.test(token)) return null;
  const sealed = token.slice("or_sess_".length);
  const match = sealed.match(/^v1\.([A-Za-z0-9_-]{12,64})\.([A-Za-z0-9_-]{20,2200})$/);
  if (!match) return null;

  try {
    const key = await deriveSessionKey(env);
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(match[1]),
        additionalData: new TextEncoder().encode(`${AUTH_AAD}:session:v1`),
        tagLength: 128
      },
      key,
      base64UrlToBytes(match[2])
    );
    const record = JSON.parse(new TextDecoder().decode(clear));
    if (!record || typeof record.uid !== "string" || typeof record.apiKey !== "string" || Number(record.expiresAt || 0) <= Date.now()) return null;
    return { uid: record.uid, apiKey: record.apiKey, expiresAt: Number(record.expiresAt || 0) };
  } catch {
    return null;
  }
}

async function identity(request, env) {
  const auth = String(request.headers.get("Authorization") || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return readLegacySession(env, match[1]);
}

async function validateOpenRouterKey(apiKey) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const userId = String(data?.data?.creator_user_id || "").trim();
      return /^user_[A-Za-z0-9_-]{6,160}$/.test(userId)
        ? { valid: true, userId }
        : { valid: false, temporary: true, status: 502 };
    }
    if (response.status === 401 || response.status === 403) return { valid: false, status: response.status, permanent: true };
    return { valid: false, status: response.status, temporary: true };
  } catch {
    return { valid: false, status: 503, temporary: true };
  }
}

function back4app(env) {
  const appId = String(env.BACK4APP_APP_ID || "").trim();
  const masterKey = String(env.BACK4APP_MASTER_KEY || "").trim();
  const baseUrl = String(env.BACK4APP_SERVER_URL || "https://parseapi.back4app.com").trim().replace(/\/+$/, "");
  return { appId, masterKey, baseUrl, configured: !!(appId && masterKey) };
}

async function db(env, path, init = {}) {
  const config = back4app(env);
  if (!config.configured) throw new Error("E8_STORAGE_UNAVAILABLE");
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      "X-Parse-Application-Id": config.appId,
      "X-Parse-Master-Key": config.masterKey,
      "Content-Type": "application/json"
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Storage request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function fingerprint(apiKey) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(apiKey || "")));
  return bytesToBase64Url(new Uint8Array(digest));
}

function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let middle = "";
  for (const byte of bytes) middle += E8_ALPHABET[byte % E8_ALPHABET.length];
  return `E8${middle}uC`;
}

function normalizePlan(value) {
  const plan = String(value || "free").toLowerCase();
  return plan === "plus" || plan === "premium" ? plan : "free";
}

function summary(record) {
  const plan = normalizePlan(record?.plan);
  const expiresMs = record?.expiresAt ? new Date(record.expiresAt).getTime() : 0;
  const active = plan !== "free" && Number.isFinite(expiresMs) && expiresMs > Date.now();
  return {
    id: E8_ID_RE.test(String(record?.e8Id || "")) ? String(record.e8Id) : null,
    plan: plan === "premium" ? "Premium" : plan === "plus" ? "Plus" : "Free",
    effectivePlan: active ? plan : "free",
    status: plan === "free" ? "Active" : active ? "Active" : "Expired",
    expiresAt: plan !== "free" && Number.isFinite(expiresMs) && expiresMs > 0 ? new Date(expiresMs).toISOString() : null,
    selectedTools: Array.isArray(record?.selectedTools) ? record.selectedTools.slice(0, 5) : []
  };
}

async function findBy(env, field, value) {
  const where = encodeURIComponent(JSON.stringify({ [field]: String(value || "") }));
  const data = await db(env, `/classes/${encodeURIComponent(E8_CLASS)}?where=${where}&limit=1`);
  return Array.isArray(data.results) && data.results.length ? data.results[0] : null;
}

async function ensureAccount(env, session) {
  const uid = String(session.uid || "").slice(0, 220);
  const fp = await fingerprint(session.apiKey);
  let record = await findBy(env, "openRouterUid", uid);

  if (record) {
    const oldFp = String(record.apiFingerprint || "");
    const apiChanged = !!(oldFp && oldFp !== fp);
    const missingId = !E8_ID_RE.test(String(record.e8Id || ""));
    const current = summary(record);
    const clearTools = current.status === "Expired" && current.selectedTools.length > 0;
    if (apiChanged || missingId || !oldFp || clearTools) {
      const patch = { apiState: "connected", apiFingerprint: fp };
      if (apiChanged || missingId) patch.e8Id = makeId();
      if (clearTools) patch.selectedTools = [];
      await db(env, `/classes/${encodeURIComponent(E8_CLASS)}/${encodeURIComponent(record.objectId)}`, { method: "PUT", body: patch });
      record = { ...record, ...patch };
    }
    return record;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const e8Id = makeId();
    if (await findBy(env, "e8Id", e8Id)) continue;
    const body = {
      openRouterUid: uid,
      e8Id,
      apiFingerprint: fp,
      plan: "free",
      status: "active",
      expiresAt: null,
      selectedTools: [],
      apiState: "connected",
      ACL: {}
    };
    const created = await db(env, `/classes/${encodeURIComponent(E8_CLASS)}`, { method: "POST", body });
    return { ...body, objectId: created.objectId };
  }
  throw new Error("E8_ID_GENERATION_FAILED");
}

async function invalidateAccountId(env, uid) {
  try {
    const record = await findBy(env, "openRouterUid", uid);
    if (!record?.objectId) return;
    await db(env, `/classes/${encodeURIComponent(E8_CLASS)}/${encodeURIComponent(record.objectId)}`, {
      method: "PUT",
      body: {
        e8Id: { __op: "Delete" },
        apiFingerprint: { __op: "Delete" },
        selectedTools: [],
        apiState: "invalid"
      }
    });
  } catch {}
}

async function liveAccount(request, env) {
  const session = await identity(request, env);
  if (!session) return { error: "Log in first.", status: 401 };
  const validation = await validateOpenRouterKey(session.apiKey);
  if (!validation.valid) {
    if (validation.permanent) {
      await invalidateAccountId(env, session.uid);
      return { error: "OpenRouter authorization is no longer valid.", status: 401, code: "OPENROUTER_INVALID" };
    }
    return { error: "OpenRouter couldn't be verified right now.", status: 503 };
  }
  const record = await ensureAccount(env, session);
  return { session, record, account: summary(record) };
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right || "")))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < aa.length; index += 1) diff |= aa[index] ^ bb[index];
  return diff === 0;
}

async function adminAuthorized(request, env) {
  const tokens = [
    ...String(env.E8_ADMIN_PANEL_TOKENS || "").split(","),
    String(env.E8_ADMIN_PANEL_SECRET || "")
  ].map((value) => value.trim()).filter((value) => value.length >= 32);
  if (!tokens.length) return false;
  const provided = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (provided.length < 32) return false;
  for (const token of tokens) if (await secureEqual(provided, token)) return true;
  return false;
}

async function activate(env, e8Id, plan, days) {
  const record = await findBy(env, "e8Id", e8Id);
  if (!record?.objectId) return null;
  const normalized = normalizePlan(plan);
  if (normalized === "free") throw new Error("INVALID_PLAN");
  const durationDays = Number(days);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 730) throw new Error("INVALID_DURATION");
  const current = record.expiresAt ? new Date(record.expiresAt).getTime() : 0;
  const start = Number.isFinite(current) && current > Date.now() ? current : Date.now();
  const expiresAt = new Date(start + durationDays * 86_400_000).toISOString();
  await db(env, `/classes/${encodeURIComponent(E8_CLASS)}/${encodeURIComponent(record.objectId)}`, {
    method: "PUT",
    body: { plan: normalized, status: "active", expiresAt }
  });
  return summary({ ...record, plan: normalized, status: "active", expiresAt });
}

function toolCatalog(env) {
  const values = String(env.E8_PLUS_TOOL_CATALOG || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value));
  return [...new Set(values)].slice(0, 200);
}

async function handleE8(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request, env)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors(request, env) });
  }

  if (!isAllowedOrigin(request, env)) return json(request, env, { error: "Origin not allowed." }, 403);
  if (!allow(request)) return json(request, env, { error: "Too many requests. Try again shortly." }, 429, { "Retry-After": "60" });

  if (request.method === "GET" && url.pathname === "/e8/health") {
    return json(request, env, {
      ok: true,
      service: "E8 account layer",
      storageConfigured: back4app(env).configured,
      adminConfigured: String(env.E8_ADMIN_PANEL_TOKENS || env.E8_ADMIN_PANEL_SECRET || "").trim().length >= 32,
      enhancedModelConfigured: !!String(env.E8_ENHANCED_MODEL || "").trim()
    });
  }

  if (request.method === "GET" && url.pathname === "/e8/account") {
    const live = await liveAccount(request, env);
    if (live.error) return json(request, env, { error: live.error, code: live.code }, live.status);
    return json(request, env, { ...live.account, api: "Connected" });
  }

  if (request.method === "GET" && url.pathname === "/e8/tools") {
    const live = await liveAccount(request, env);
    if (live.error) return json(request, env, { error: live.error, code: live.code }, live.status);
    const catalog = toolCatalog(env);
    const plan = live.account.effectivePlan;
    return json(request, env, {
      plan,
      selectableLimit: plan === "plus" ? 5 : 0,
      selected: plan === "plus" ? live.account.selectedTools.filter((tool) => catalog.includes(tool)) : [],
      catalog: plan === "plus" || plan === "premium" ? catalog : []
    });
  }

  if (request.method === "POST" && url.pathname === "/e8/account/tools") {
    const live = await liveAccount(request, env);
    if (live.error) return json(request, env, { error: live.error, code: live.code }, live.status);
    if (live.account.effectivePlan !== "plus") return json(request, env, { error: "Plus subscription required." }, 403);

    let body = null;
    try { body = await request.json(); } catch { return json(request, env, { error: "Invalid request." }, 400); }
    const catalog = toolCatalog(env);
    const selected = Array.isArray(body?.tools)
      ? [...new Set(body.tools.map((tool) => String(tool || "").trim().toLowerCase()))]
      : [];
    if (selected.length > 5 || selected.some((tool) => !catalog.includes(tool))) return json(request, env, { error: "Choose up to 5 valid tools." }, 400);

    await db(env, `/classes/${encodeURIComponent(E8_CLASS)}/${encodeURIComponent(live.record.objectId)}`, {
      method: "PUT",
      body: { selectedTools: selected }
    });
    return json(request, env, { ok: true, selected });
  }

  if (request.method === "POST" && url.pathname === "/e8/admin/subscription") {
    if (!allow(request, ADMIN_ABUSE_MAX)) return json(request, env, { error: "Too many admin attempts." }, 429, { "Retry-After": "60" });
    if (!(await adminAuthorized(request, env))) return json(request, env, { error: "Unauthorized." }, 401);

    let body = null;
    try { body = await request.json(); } catch { return json(request, env, { error: "Invalid request." }, 400); }
    const e8Id = String(body?.id || "").trim();
    const plan = String(body?.plan || "").trim().toLowerCase();
    const days = Number(body?.durationDays);
    if (!E8_ID_RE.test(e8Id)) return json(request, env, { error: "Invalid E8 ID." }, 400);
    if (plan !== "plus" && plan !== "premium") return json(request, env, { error: "Plan must be Plus or Premium." }, 400);
    if (!Number.isInteger(days) || days < 1 || days > 730) return json(request, env, { error: "Duration must be between 1 and 730 days." }, 400);

    try {
      const account = await activate(env, e8Id, plan, days);
      if (!account) return json(request, env, { error: "E8 ID was not found." }, 404);
      return json(request, env, { ok: true, account });
    } catch {
      return json(request, env, { error: "Couldn't update the subscription." }, 503);
    }
  }

  return json(request, env, { error: "Not found." }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/e8/health" || pathname === "/e8/account" || pathname === "/e8/tools" || pathname === "/e8/account/tools" || pathname === "/e8/admin/subscription") {
      return handleE8(request, env, ctx);
    }
    return legacyWorker.fetch(request, env, ctx);
  }
};
