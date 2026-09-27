import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
const source = fs.readFileSync(new URL('./novasparx-texture-runtime.js', import.meta.url), 'utf8');
const schema = 'novasparx.asset-locations.v1';
const a = 'fortnitegame/content/textures/t_slow.uasset';
const b = 'fortnitegame/content/textures/t_fast.uasset';
const shard = p => { let h = 2166136261; for (const n of new TextEncoder().encode(p)) h = Math.imul(h ^ n, 16777619) >>> 0; return (h & 255).toString(16).padStart(2, '0'); };
assert.notEqual(shard(a), shard(b));
const pending = new Map();
const workers = [];
let manifestCalls = 0;
const context = vm.createContext({
  URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, Response, DecompressionStream,
  AbortController, DOMException, WebAssembly, setTimeout, clearTimeout,
  document: { baseURI: 'https://example.test/' },
  fetch: (url, options) => {
    if (String(url).endsWith('manifest.json')) {
      manifestCalls++;
      return Promise.resolve(new Response(JSON.stringify({ schema, hash: 'fnv1a32-low-byte', entries: 2 })));
    }
    return new Promise(resolve => pending.set(new URL(url).pathname.split('/').pop(), { resolve, signal: options.signal }));
  },
  Worker: class {
    constructor(url) { this.url = new URL(url); this.terminated = 0; workers.push(this); }
    terminate() { this.terminated++; }
  }
});
vm.runInContext(source, context);
const runtime = context.NovaSparxTextureRuntime;
const state = { manifestUrl: 'https://fortnite-direct.dillycdn.com/current.manifest', relay: 'https://edge.example/nova-edge/range' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw new Error('Test operation never started'); }
function release(path) {
  const entry = pending.get(shard(path) + '.json.gz');
  assert.ok(entry);
  entry.resolve(new Response(gzipSync(JSON.stringify({ schema, items: { [path]: 'FortniteGame/Content/Paks/pakchunk1002-WindowsClient.utoc' } }))));
}
// A delayed network response must never start an obsolete Worker after B.
const first = runtime.resolveTexture(a, { parserState: state }).catch(e => e);
await until(() => pending.has(shard(a) + '.json.gz'));
const cancelB = new AbortController();
const second = runtime.resolveTexture(b, { parserState: state, signal: cancelB.signal }).catch(e => e);
await until(() => pending.has(shard(b) + '.json.gz'));
assert.equal(pending.get(shard(a) + '.json.gz').signal.aborted, true);
release(b);
await until(() => workers.length === 1);
release(a);
assert.equal((await first).name, 'AbortError');
assert.equal(workers.length, 1);
assert.equal(workers[0].url.searchParams.get('path'), b);
cancelB.abort();
assert.equal((await second).name, 'AbortError');
assert.ok(workers[0].terminated > 0);
assert.equal(runtime.status().active, false);
// Reset also aborts metadata work, not just an already-created Worker.
runtime.reset();
pending.clear();
const resetRequest = runtime.resolveTexture(a, { parserState: state }).catch(e => e);
await until(() => pending.has(shard(a) + '.json.gz'));
runtime.reset();
assert.equal(pending.get(shard(a) + '.json.gz').signal.aborted, true);
release(a);
assert.equal((await resetRequest).name, 'AbortError');
assert.equal(workers.length, 1);
assert.ok(manifestCalls >= 2);
console.log('Texture runtime: delayed A cannot replace B; AbortSignal and reset terminate workers and metadata requests.');

// Even valid RGBA must not be accepted for another asset.
pending.clear();
const wrongAsset = runtime.resolveTexture(b, { parserState: state }).catch(e => e);
await until(() => pending.has(shard(b) + '.json.gz'));
release(b);
await until(() => workers.length === 2);
workers[1].onmessage({ data: { type: 'pixels', path: a, width: 1, height: 1, pixels: new ArrayBuffer(4) } });
assert.equal((await wrongAsset).code, 'NOVASPARX_TEXTURE_PIXELS_INVALID');
assert.ok(workers[1].terminated > 0);
console.log('Texture runtime rejects correctly sized pixels belonging to another asset.');
