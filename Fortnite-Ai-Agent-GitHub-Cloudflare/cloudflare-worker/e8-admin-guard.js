const ADMIN_PATHS = new Set([
  "/e8/admin/subscription",
  "/e8/admin/subscription/revoke"
]);
const E8_CLASS = "E8Account";
const E8_ID_RE = /^E8[A-Za-z0-9]{15}uC$/;
const OPERATION_RE = /^e8op_[A-Za-z0-9_-]{20,80}$/;
const RESULT_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 2 * 60 * 1000;
const LEASE_SETTLE_MS = 150;
const MAX_RESULTS = 500;
const MAX_HISTORY = 12;
const ADMIN_BODY_MAX_BYTES = 16_384;

const completed = new Map();
const inFlight = new Map();
let lastSweep = 0;

function allowedOrigins(env) {
  const set = new Set([
    "https://e8uc.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ]);
  String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => set.add(value));
  return set;
}

function configuredAdminTokens(env) {
  return [
    ...String(env.E8_ADMIN_PANEL_TOKENS || "").split(","),
    String(env.E8_ADMIN_PANEL_SECRET || "")
  ]
    .map((value) => value.trim())
    .filter((value) => value.length >= 32);
}

function responseHeaders(request, env) {
  const origin = String(request.headers.get("Origin") || "");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Vary": "Origin"
  });
  if (allowedOrigins(env).has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request, env)
  });
}

function jsonError(request, env, message, status) {
  return jsonResponse(request, env, { error: message }, status);
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
    cache: "no-store",
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

async function findAccount(env, e8Id) {
  const where = encodeURIComponent(JSON.stringify({ e8Id }));
  const data = await db(env, `/classes/${encodeURIComponent(E8_CLASS)}?where=${where}&limit=1`);
  return Array.isArray(data.results) && data.results.length ? data.results[0] : null;
}

async function readAccount(env, objectId) {
  return db(env, `/classes/${encodeURIComponent(E8_CLASS)}/${encodeURIComponent(objectId)}`);
}

async function updateAccount(env, objectId, body) {
  return db(env, `/classes/${encodeURIComponent(E8_CLASS)}/${encodeURIComponent(objectId)}`, {
    method: "PUT",
    body
  });
}

function normalizePlan(value) {
  const plan = String(value || "free").trim().toLowerCase();
  return plan === "plus" || plan === "premium" ? plan : "free";
}

function accountSummary(record) {
  const plan = normalizePlan(record?.plan);
  const expiresMs = record?.expiresAt ? new Date(record.expiresAt).getTime() : 0;
  const subscribed = plan !== "free";
  const active = subscribed && Number.isFinite(expiresMs) && expiresMs > Date.now();
  return {
    id: E8_ID_RE.test(String(record?.e8Id || "")) ? String(record.e8Id) : null,
    plan: plan === "premium" ? "Premium" : plan === "plus" ? "Plus" : "Free",
    effectivePlan: active ? plan : "free",
    status: subscribed ? (active ? "Active" : "Expired") : "Active",
    expiresAt: subscribed && Number.isFinite(expiresMs) && expiresMs > 0 ? new Date(expiresMs).toISOString() : null,
    selectedTools: Array.isArray(record?.selectedTools) ? record.selectedTools.slice(0, 5) : []
  };
}

function sweep(now = Date.now()) {
  if (now - lastSweep < 60_000 && completed.size <= MAX_RESULTS) return;
  lastSweep = now;
  for (const [key, record] of completed) {
    if (!record || now - record.createdAt > RESULT_TTL_MS) completed.delete(key);
  }
  while (completed.size > MAX_RESULTS) {
    const first = completed.keys().next().value;
    if (!first) break;
    completed.delete(first);
  }
}

function normalizedOperationBody(path, body) {
  const id = String(body?.id || "").trim();
  if (path === "/e8/admin/subscription/revoke") {
    return JSON.stringify({ path, id });
  }
  return JSON.stringify({
    path,
    id,
    plan: String(body?.plan || "").trim().toLowerCase(),
    durationDays: Number(body?.durationDays)
  });
}

function durableOperationIsValid(path, body) {
  const e8Id = String(body?.id || "").trim();
  if (!E8_ID_RE.test(e8Id)) return false;
  if (path === "/e8/admin/subscription/revoke") return true;
  const plan = String(body?.plan || "").trim().toLowerCase();
  const days = Number(body?.durationDays);
  return (plan === "plus" || plan === "premium") && Number.isInteger(days) && days >= 1 && days <= 730;
}

async function digestBytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return new Uint8Array(digest);
}

function equalDigest(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function digestHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorizedScope(request, env) {
  const provided = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (provided.length < 32) return null;

  const configured = configuredAdminTokens(env);
  if (!configured.length) return null;

  const providedDigest = await digestBytes(provided);
  let scope = null;
  for (let index = 0; index < configured.length; index += 1) {
    const candidateDigest = await digestBytes(configured[index]);
    if (equalDigest(providedDigest, candidateDigest) && scope === null) scope = `staff-${index}`;
  }
  return scope;
}

async function fingerprint(value) {
  return digestHex(await digestBytes(value));
}

function replay(record) {
  return new Response(record.body, {
    status: record.status,
    headers: new Headers(record.headers)
  });
}

async function capture(response) {
  const body = await response.clone().text();
  return {
    createdAt: Date.now(),
    status: response.status,
    headers: [...response.headers.entries()],
    body
  };
}

function makeLeaseId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function operationHistory(record) {
  return (Array.isArray(record?.adminOperationHistory) ? record.adminOperationHistory : [])
    .filter((item) => item && OPERATION_RE.test(String(item.id || "")))
    .slice(0, MAX_HISTORY);
}

function historyMatch(history, operationId) {
  return history.find((item) => String(item.id || "") === operationId) || null;
}

function operationMatches(record, operationId, operationFingerprint, path, authScope) {
  return String(record?.lastAdminOperationId || "") === operationId &&
    String(record?.lastAdminOperationFingerprint || "") === operationFingerprint &&
    String(record?.lastAdminOperationPath || "") === path &&
    String(record?.lastAdminOperationScope || "") === authScope;
}

function recentPending(record) {
  if (String(record?.lastAdminOperationStatus || "") !== "pending") return false;
  const startedAt = new Date(record?.lastAdminOperationStartedAt || 0).getTime();
  return Number.isFinite(startedAt) && Date.now() - startedAt < PENDING_TTL_MS;
}

async function beginDurableOperation(request, env, path, body, operationId, operationFingerprint, authScope) {
  if (!durableOperationIsValid(path, body)) return { enabled: false };

  let account;
  try {
    account = await findAccount(env, String(body.id).trim());
  } catch (error) {
    console.error("E8 durable operation lookup:", error);
    return { response: jsonError(request, env, "Subscription safety check is temporarily unavailable.", 503) };
  }
  if (!account?.objectId) return { enabled: false };

  const history = operationHistory(account);
  const old = historyMatch(history, operationId);
  if (old) {
    const same = String(old.fingerprint || "") === operationFingerprint &&
      String(old.path || "") === path &&
      String(old.scope || "") === authScope;
    if (!same) return { response: jsonError(request, env, "Operation ID was already used for a different request.", 409) };
    return { response: jsonResponse(request, env, { ok: true, account: accountSummary(account), replayed: true }) };
  }

  if (recentPending(account)) {
    if (String(account.lastAdminOperationId || "") === operationId) {
      if (!operationMatches(account, operationId, operationFingerprint, path, authScope)) {
        return { response: jsonError(request, env, "Operation ID is already being used for a different request.", 409) };
      }
      return { response: jsonError(request, env, "This subscription operation is already in progress.", 409) };
    }
    return { response: jsonError(request, env, "Another subscription operation is already in progress for this account.", 409) };
  }

  const leaseId = makeLeaseId();
  const startedAt = new Date().toISOString();
  try {
    await updateAccount(env, account.objectId, {
      lastAdminOperationId: operationId,
      lastAdminOperationFingerprint: operationFingerprint,
      lastAdminOperationPath: path,
      lastAdminOperationScope: authScope,
      lastAdminOperationStatus: "pending",
      lastAdminOperationLease: leaseId,
      lastAdminOperationStartedAt: startedAt,
      lastAdminOperationCompletedAt: null
    });

    await new Promise((resolve) => setTimeout(resolve, LEASE_SETTLE_MS));
    const lease = await readAccount(env, account.objectId);
    const ownsLease = operationMatches(lease, operationId, operationFingerprint, path, authScope) &&
      String(lease?.lastAdminOperationStatus || "") === "pending" &&
      String(lease?.lastAdminOperationLease || "") === leaseId;
    if (!ownsLease) {
      return { response: jsonError(request, env, "Subscription operation safety lease was lost. Try again.", 409) };
    }
  } catch (error) {
    console.error("E8 durable operation lease:", error);
    return { response: jsonError(request, env, "Subscription safety check is temporarily unavailable.", 503) };
  }

  return {
    enabled: true,
    objectId: account.objectId,
    leaseId,
    operationId,
    operationFingerprint,
    path,
    authScope
  };
}

async function finishDurableOperation(env, state, response) {
  if (!state?.enabled || !state.objectId) return;
  try {
    const current = await readAccount(env, state.objectId);
    const ownsLease = operationMatches(current, state.operationId, state.operationFingerprint, state.path, state.authScope) &&
      String(current?.lastAdminOperationLease || "") === state.leaseId;
    if (!ownsLease) return;

    const completedAt = new Date().toISOString();
    if (!response.ok) {
      await updateAccount(env, state.objectId, {
        lastAdminOperationStatus: "failed",
        lastAdminOperationCompletedAt: completedAt
      });
      return;
    }

    const history = operationHistory(current).filter((item) => String(item.id || "") !== state.operationId);
    history.unshift({
      id: state.operationId,
      fingerprint: state.operationFingerprint,
      path: state.path,
      scope: state.authScope,
      completedAt
    });
    await updateAccount(env, state.objectId, {
      adminOperationHistory: history.slice(0, MAX_HISTORY),
      lastAdminOperationStatus: "completed",
      lastAdminOperationCompletedAt: completedAt
    });
  } catch (error) {
    // The mutation response must not be turned into an error after the mutation
    // may already have succeeded. The pending marker and in-memory cache still
    // reduce accidental retries while storage recovers.
    console.error("E8 durable operation finalize:", error);
  }
}

export async function withAdminReplayGuard(request, env, handler) {
  const url = new URL(request.url);
  if (request.method !== "POST" || !ADMIN_PATHS.has(url.pathname)) {
    return handler(request);
  }

  const origin = String(request.headers.get("Origin") || "");
  if (!allowedOrigins(env).has(origin)) return handler(request);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > ADMIN_BODY_MAX_BYTES) return handler(request);

  const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return handler(request);

  let body;
  try {
    body = await request.clone().json();
  } catch {
    return handler(request);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return handler(request);

  const operationId = String(body.operationId || "").trim();
  if (!OPERATION_RE.test(operationId)) {
    return jsonError(request, env, "A valid operation ID is required.", 400);
  }

  // Never serve a cached administrative response until the current bearer token
  // has been matched against the currently configured staff credentials.
  const authScope = await authorizedScope(request, env);
  if (!authScope) return handler(request);

  sweep();
  const cacheKey = `${authScope}:${operationId}`;
  const operationFingerprint = await fingerprint(normalizedOperationBody(url.pathname, body));
  const done = completed.get(cacheKey);
  if (done) {
    if (done.fingerprint !== operationFingerprint) {
      return jsonError(request, env, "Operation ID was already used for a different request.", 409);
    }
    return replay(done);
  }

  const active = inFlight.get(cacheKey);
  if (active) {
    if (active.fingerprint !== operationFingerprint) {
      return jsonError(request, env, "Operation ID is already being used for a different request.", 409);
    }
    const record = await active.promise;
    return replay(record);
  }

  const durable = await beginDurableOperation(
    request,
    env,
    url.pathname,
    body,
    operationId,
    operationFingerprint,
    authScope
  );
  if (durable.response) return durable.response;

  const promise = (async () => {
    const response = await handler(request);
    const record = await capture(response);
    record.fingerprint = operationFingerprint;
    if (response.ok) completed.set(cacheKey, record);
    await finishDurableOperation(env, durable, response);
    return record;
  })();
  inFlight.set(cacheKey, { fingerprint: operationFingerprint, promise });

  try {
    const record = await promise;
    return replay(record);
  } finally {
    const current = inFlight.get(cacheKey);
    if (current?.promise === promise) inFlight.delete(cacheKey);
  }
}
