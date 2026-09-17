import test from "node:test";
import assert from "node:assert/strict";

const gatewayModule = await import(`./e8-gateway.js?test=${Date.now()}-${Math.random()}`);
const gateway = gatewayModule.default;

function oauthRequest(returnTo) {
  const url = new URL("https://worker.example/auth/openrouter/start");
  if (returnTo) url.searchParams.set("return_to", returnTo);
  return new Request(url, { method: "GET" });
}

test("E8 gateway blocks localhost OAuth redirects unless development explicitly enables them", async () => {
  const blocked = await gateway.fetch(
    oauthRequest("http://localhost:3000/E8Hub/"),
    {},
    {}
  );
  assert.equal(blocked.status, 403);
  assert.match(await blocked.text(), /Local OAuth redirects are disabled/i);

  const blockedLoopback = await gateway.fetch(
    oauthRequest("https://127.0.0.1:3000/E8Hub/"),
    {},
    {}
  );
  assert.equal(blockedLoopback.status, 403);
});

test("E8 gateway rejects an unsafe Back4App base URL before E8 request handling", async () => {
  const request = new Request("https://worker.example/e8/health", {
    method: "GET",
    headers: { Origin: "https://e8uc.github.io" }
  });

  const response = await gateway.fetch(
    request,
    { BACK4APP_SERVER_URL: "http://parseapi.back4app.com" },
    {}
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "E8 storage configuration is invalid." });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://e8uc.github.io");
});

test("E8 gateway rejects Back4App URLs with embedded credentials or URL metadata", async () => {
  for (const unsafeUrl of [
    "https://user:pass@parseapi.back4app.com",
    "https://parseapi.back4app.com?redirect=1",
    "https://parseapi.back4app.com#fragment"
  ]) {
    const response = await gateway.fetch(
      new Request("https://worker.example/e8/health", {
        method: "GET",
        headers: { Origin: "https://e8uc.github.io" }
      }),
      { BACK4APP_SERVER_URL: unsafeUrl },
      {}
    );
    assert.equal(response.status, 503, unsafeUrl);
  }
});
