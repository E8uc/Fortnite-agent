import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const source = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8")
  .replace('import "../asset-diagnosis.js";', "")
  .replace("export default", "const workerDefault =");

function harness(upstream) {
  const calls = [];
  const context = vm.createContext({
    URL, Map, Set, Headers, Request, Response, AbortController,
    TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (init.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return typeof upstream === "function" ? upstream(init) : upstream;
    }
  });
  vm.runInContext(source + "\nglobalThis.handleRange = handleNovaEdgeRange;", context);
  return {
    calls,
    async relay(start, end, { signal, target = "https://download.epicgames.com/file.bin" } = {}) {
      const url = new URL("https://edge.test/nova-edge/range");
      url.searchParams.set("url", target);
      url.searchParams.set("start", String(start));
      url.searchParams.set("end", String(end));
      const request = new Request(url, { signal });
      return context.handleRange(request, {}, url);
    }
  };
}

function response(status, contentRange, bodyLength, contentLength) {
  const headers = new Headers({ "content-type": "application/octet-stream" });
  if (contentRange !== undefined) headers.set("content-range", contentRange);
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Response(Uint8Array.from({ length: bodyLength }, (_, i) => i), { status, headers });
}

const invalid = [
  ["nonzero whole response", 4, 7, 200, undefined, 4, 4],
  ["reversed interval", 4, 7, 206, "bytes 4-3/12", 1, 1],
  ["premature short interval", 4, 7, 206, "bytes 4-5/12", 2, 2],
  ["short body", 4, 7, 206, "bytes 4-7/12", 3, 3],
  ["body larger than final interval", 4, 7, 206, "bytes 4-5/6", 3, 3],
  ["wrong start", 4, 7, 206, "bytes 3-6/12", 4, 4],
  ["end past requested window", 4, 7, 206, "bytes 4-8/12", 5, 5],
  ["unknown total", 4, 7, 206, "bytes 4-7/*", 4, 4],
  ["zero total", 4, 7, 206, "bytes 4-7/0", 4, 4],
  ["end at total", 4, 7, 206, "bytes 4-7/7", 4, 4],
  ["unsafe total", 4, 7, 206, "bytes 4-7/9007199254740992", 4, 4],
  ["unsafe start", 4, 7, 206, "bytes 9007199254740992-9007199254740995/9007199254740996", 4, 4],
  ["nondecimal total", 4, 7, 206, "bytes 4-7/1e2", 4, 4],
  ["missing interval", 4, 7, 206, undefined, 4, 4],
  ["mismatched declared span", 4, 7, 206, "bytes 4-7/12", 4, 3],
  ["malformed declared length", 4, 7, 206, "bytes 4-7/12", 4, "NaN"],
  ["whole response missing length", 0, 7, 200, undefined, 4, undefined],
  ["whole response short body", 0, 7, 200, undefined, 3, 4],
  ["whole response longer body", 0, 7, 200, undefined, 5, 4],
  ["whole response nondecimal length", 0, 7, 200, undefined, 4, "4e0"],
  ["whole response negative length", 0, 7, 200, undefined, 4, -1],
  ["whole response carrying a partial interval", 0, 7, 200, "bytes 4-7/12", 4, 4],
  ["whole response empty body", 0, 7, 200, undefined, 0, 0],
  ["whole response beyond window", 0, 3, 200, undefined, 5, 5]
];

for (const [name, start, end, status, interval, length, declared] of invalid) {
  test(`rejects ${name}`, async () => {
    const relay = harness(response(status, interval, length, declared));
    const result = await relay.relay(start, end);
    assert.equal(result.status, 502, name);
    assert.equal((await result.json()).state, "error");
  });
}

for (const [name, start, end, interval, length, declared] of [
  ["exact window", 4, 7, "bytes 4-7/12", 4, 4],
  ["chunked exact window", 4, 7, "bytes 4-7/12", 4, undefined],
  ["final short window", 10, 15, "bytes 10-11/12", 2, 2],
  ["single final byte", 11, 15, "bytes 11-11/12", 1, undefined]
]) {
  test(`accepts ${name}`, async () => {
    const relay = harness(response(206, interval, length, declared));
    const result = await relay.relay(start, end);
    assert.equal(result.status, 206);
    assert.equal(result.headers.get("content-range"), interval);
    assert.equal(result.headers.get("content-length"), String(length));
    assert.equal((await result.arrayBuffer()).byteLength, length);
    assert.equal(relay.calls.length, 1);
    assert.equal(relay.calls[0].init.redirect, "error");
    assert.equal(relay.calls[0].init.headers.Range, `bytes=${start}-${end}`);
  });
}

test("accepts a bounded full response from start zero", async () => {
  const result = await harness(response(200, undefined, 4, 4)).relay(0, 7);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-range"), null);
  assert.equal((await result.arrayBuffer()).byteLength, 4);
});

test("cancels malformed interval bodies without reading them", async () => {
  let cancelled = false;
  let read = false;
  const body = new ReadableStream({
    pull(controller) {
      read = true;
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const result = await harness(new Response(body, {
    status: 206, headers: { "content-range": "bytes 4-3/12" }
  })).relay(4, 7);
  assert.equal(result.status, 502);
  assert.equal(cancelled, true);
  assert.equal(read, false);
});

test("cancels a chunked body at the exact interval cap", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(3));
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const result = await harness(new Response(body, {
    status: 206, headers: { "content-range": "bytes 4-7/12" }
  })).relay(4, 7);
  assert.equal(result.status, 502);
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
});

test("rejects an untrusted target before fetch", async () => {
  const relay = harness(response(206, "bytes 0-3/12", 4, 4));
  for (const target of [
    "https://evil.example/file.bin",
    "http://download.epicgames.com/file.bin",
    "https://user:pass@download.epicgames.com/file.bin",
    "https://download.epicgames.com:444/file.bin"
  ]) {
    assert.equal((await relay.relay(0, 3, { target })).status, 400);
  }
  assert.equal(relay.calls.length, 0);
});

test("cancels the streaming body when the request aborts", { timeout: 1000 }, async () => {
  let cancelled = false;
  const controller = new AbortController();
  let markReading;
  const reading = new Promise(resolve => { markReading = resolve; });
  const body = new ReadableStream({
    pull() { markReading(); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const relay = harness(new Response(body, {
    status: 206, headers: { "content-range": "bytes 0-3/12" }
  }));
  const pending = relay.relay(0, 3, { signal: controller.signal });
  await reading;
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(cancelled, true);
  assert.equal(relay.calls.length, 1);
});

test("a preaborted request does not follow up with another fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  const relay = harness(response(206, "bytes 0-3/12", 4, 4));
  await assert.rejects(relay.relay(0, 3, { signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(relay.calls.length, 1);
});

test("cancels a response when the request aborts at the header boundary", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const relay = harness(() => {
    controller.abort();
    return new Response(body, {
      status: 206, headers: { "content-range": "bytes 0-3/12" }
    });
  });
  await assert.rejects(relay.relay(0, 3, { signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(cancelled, true);
});
