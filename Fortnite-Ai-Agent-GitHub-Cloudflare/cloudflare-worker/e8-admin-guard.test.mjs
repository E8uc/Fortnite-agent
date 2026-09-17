import test from "node:test";
import assert from "node:assert/strict";

const STAFF_TOKEN = "S".repeat(64);
const WRONG_TOKEN = "W".repeat(64);
const E8_ID = "E8AbCdEfGh1234567uC";
const BASE_URL = "https://parseapi.back4app.com";

function freshAccount() {
  return {
    objectId: "account-1",
    e8Id: E8_ID,
    plan: "free",
    status: "active",
    expiresAt: null,
    selectedTools: [],
    ACL: {},
    updatedAt: new Date().toISOString()
  };
}

function makeEnv() {
  return {
    BACK4APP_APP_ID: "test-app",
    BACK4APP_MASTER_KEY: "test-master-key",
    BACK4APP_SERVER_URL: BASE_URL,
    E8_ADMIN_PANEL_SECRET: STAFF_TOKEN
  };
}

function operationId(letter) {
  return `e8op_${letter.repeat(24)}`;
}

function adminRequest({
  id = E8_ID,
  op = operationId("A"),
  token = STAFF_TOKEN,
  plan = "plus",
  durationDays = 30,
  path = "/e8/admin/subscription"
} = {}) {
  const body = path.endsWith("/revoke")
    ? { id, operationId: op }
    : { id, plan, durationDays, operationId: op };

  return new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://e8uc.github.io",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function installBack4AppMock(state) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin !== BASE_URL) {
      throw new Error(`Unexpected external fetch in test: ${url}`);
    }

    const method = String(init.method || "GET").toUpperCase();
    if (url.pathname === "/classes/E8Account" && method === "GET") {
      const where = JSON.parse(url.searchParams.get("where") || "{}");
      const result = where.e8Id === state.account.e8Id ? [structuredClone(state.account)] : [];
      return jsonResponse({ results: result });
    }

    if (url.pathname === `/classes/E8Account/${state.account.objectId}` && method === "GET") {
      return jsonResponse(structuredClone(state.account));
    }

    if (url.pathname === `/classes/E8Account/${state.account.objectId}` && method === "PUT") {
      const patch = JSON.parse(String(init.body || "{}"));
      state.account = {
        ...state.account,
        ...structuredClone(patch),
        updatedAt: new Date().toISOString()
      };
      return jsonResponse({ updatedAt: state.account.updatedAt });
    }

    throw new Error(`Unexpected Back4App request in test: ${method} ${url}`);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function successfulActivationHandler(state, calls) {
  return async (request) => {
    calls.count += 1;
    const body = await request.clone().json();
    const start = state.account.expiresAt && new Date(state.account.expiresAt).getTime() > Date.now()
      ? new Date(state.account.expiresAt).getTime()
      : Date.now();
    const expiresAt = new Date(start + Number(body.durationDays) * 86_400_000).toISOString();
    state.account = {
      ...state.account,
      plan: body.plan,
      status: "active",
      expiresAt,
      updatedAt: new Date().toISOString()
    };
    return jsonResponse({
      ok: true,
      account: {
        id: state.account.e8Id,
        plan: body.plan === "premium" ? "Premium" : "Plus",
        effectivePlan: body.plan,
        status: "Active",
        expiresAt,
        selectedTools: []
      }
    });
  };
}

async function freshGuard(tag) {
  return import(`./e8-admin-guard.js?test=${encodeURIComponent(tag)}-${Date.now()}-${Math.random()}`);
}

test("E8 admin guard keeps subscription mutations idempotent across isolates", async () => {
  const state = { account: freshAccount() };
  const restoreFetch = installBack4AppMock(state);
  const env = makeEnv();

  try {
    const calls = { count: 0 };
    const op = operationId("A");

    const firstGuard = await freshGuard("first");
    const first = await firstGuard.withAdminReplayGuard(
      adminRequest({ op }),
      env,
      successfulActivationHandler(state, calls)
    );
    assert.equal(first.status, 200);
    assert.equal(calls.count, 1);
    assert.equal(state.account.plan, "plus");
    assert.equal(state.account.adminOperationHistory?.[0]?.id, op);

    const secondGuard = await freshGuard("second-isolate");
    const second = await secondGuard.withAdminReplayGuard(
      adminRequest({ op }),
      env,
      async () => {
        calls.count += 1;
        return jsonResponse({ error: "duplicate handler should not run" }, 500);
      }
    );
    assert.equal(second.status, 200);
    const replayed = await second.json();
    assert.equal(replayed.replayed, true);
    assert.equal(calls.count, 1);

    const conflictingGuard = await freshGuard("conflict");
    const conflict = await conflictingGuard.withAdminReplayGuard(
      adminRequest({ op, durationDays: 60 }),
      env,
      async () => jsonResponse({ error: "conflicting handler should not run" }, 500)
    );
    assert.equal(conflict.status, 409);

    const unauthorizedGuard = await freshGuard("unauthorized");
    let unauthorizedHandlerCalls = 0;
    const unauthorized = await unauthorizedGuard.withAdminReplayGuard(
      adminRequest({ op, token: WRONG_TOKEN }),
      env,
      async () => {
        unauthorizedHandlerCalls += 1;
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorizedHandlerCalls, 1);
  } finally {
    restoreFetch();
  }
});

test("E8 admin guard serializes a second operation while one is pending", async () => {
  const state = { account: freshAccount() };
  const restoreFetch = installBack4AppMock(state);
  const env = makeEnv();

  try {
    const firstGuard = await freshGuard("pending-first");
    const secondGuard = await freshGuard("pending-second");
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

    const firstPromise = firstGuard.withAdminReplayGuard(
      adminRequest({ op: operationId("C") }),
      env,
      async (request) => {
        await firstGate;
        return successfulActivationHandler(state, { count: 0 })(request);
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 220));

    let secondHandlerCalls = 0;
    const second = await secondGuard.withAdminReplayGuard(
      adminRequest({ op: operationId("D"), plan: "premium" }),
      env,
      async () => {
        secondHandlerCalls += 1;
        return jsonResponse({ ok: true });
      }
    );
    assert.equal(second.status, 409);
    assert.equal(secondHandlerCalls, 0);

    releaseFirst();
    const first = await firstPromise;
    assert.equal(first.status, 200);
  } finally {
    restoreFetch();
  }
});
