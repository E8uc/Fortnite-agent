const ADMIN_PATHS = new Set([
  "/e8/admin/subscription",
  "/e8/admin/subscription/revoke"
]);
const OPERATION_RE = /^e8op_[A-Za-z0-9_-]{20,80}$/;
const RESULT_TTL_MS = 10 * 60 * 1000;
const MAX_RESULTS = 500;
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

function jsonError(request, env, message, status) {
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
  return new Response(JSON.stringify({ error: message }), { status, headers });
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
  let authorized = false;
  for (const candidate of configured) {
    const candidateDigest = await digestBytes(candidate);
    if (equalDigest(providedDigest, candidateDigest)) authorized = true;
  }
  return authorized ? digestHex(providedDigest) : null;
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

  const promise = (async () => {
    const response = await handler(request);
    const record = await capture(response);
    record.fingerprint = operationFingerprint;
    if (response.ok) completed.set(cacheKey, record);
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
