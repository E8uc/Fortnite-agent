import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
const build = '++Fortnite+Release-42.30-CL-58557680-Windows';
let currentBuild = build;
const counts = { manifest: 0, shards: 0 };
const ids = ['00000000000000aa','10000000000000aa','00000000000000bb'];
const schema = 'novasparx.package-locations.v1';
let source = fs.readFileSync(new URL('../../Fortnite-Ai-Agent-GitHub-Cloudflare/novasparx-texture-runtime.js', import.meta.url), 'utf8');
source = source.replace('  function clearCaches() {', `
  globalThis.sessionFactory = typeof createAssetContext === 'function' ? createAssetContext : null;
  globalThis.packageLookup = locatePackage;
  function clearCaches() {`);
const context = { URL, Response, Request, Headers, Uint8Array, TextDecoder, DecompressionStream,
  AbortController, WebAssembly, setTimeout, clearTimeout,
  document: { baseURI: 'https://example.test/', currentScript: { src: 'https://example.test/novasparx-texture-runtime.js?v=121' } },
  async fetch(input) {
    const url = String(input);
    if (url.endsWith('/location-index/manifest.json')) return Response.json({
      schema:'novasparx.asset-locations.v1', hash:'fnv1a32-low-byte', fortniteVersion:currentBuild });
    if (url.endsWith('/package-id-index/manifest.json')) { counts.manifest++; return Response.json({
      schema, hash:'package-id-low-byte',valueProperty:'path-tab-toc',fortniteVersion:currentBuild }); }
    const match = url.match(/package-id-index\/([a-f0-9]{2})\.json\.gz$/);
    if (match) { counts.shards++; return new Response(gzipSync(JSON.stringify({ schema,valueProperty:'path-tab-toc',
      items:Object.fromEntries(ids.filter(id=>id.endsWith(match[1])).map(id=>[id,`FortniteGame/${id}.uasset\tgame.utoc`])) }))); }
    throw new Error('Unexpected IO '+url);
  }
};
vm.runInNewContext(source, context);
assert.equal(typeof context.sessionFactory, 'function', 'Active assets need bounded package-index reuse');
const session = context.sessionFactory();
const options = { assetContext:session };
assert.equal((await context.packageLookup(ids[0],options)).key,`FortniteGame/${ids[0]}.uasset`);
assert.equal((await context.packageLookup(ids[1],options)).key,`FortniteGame/${ids[1]}.uasset`);
assert.equal(counts.manifest,1,'Two material maps share one package manifest parse');
assert.equal(counts.shards,1,'Same shard is fetched/decompressed/parsed once per asset');
assert.equal(session.metrics.packageShardHits,1);
assert.ok(session.packageBytes > 0 && session.packageBytes <= 4*1024*1024);
const aborted = new AbortController(); aborted.abort('asset-closed');
await assert.rejects(context.packageLookup(ids[0],{...options,signal:aborted.signal}),{name:'AbortError'});
assert.equal(counts.shards,1,'Cancellation cannot start another metadata read');
session.release();
assert.equal(session.packageShards.size,0);
assert.equal(session.packageBytes,0,'Close releases retained parsed metadata');
const other = context.sessionFactory();
await context.packageLookup(ids[0],{assetContext:other});
assert.equal(counts.shards,2,'A replacement asset cannot inherit an old session');
context.NovaSparxTextureRuntime.clearCaches(); currentBuild='different-build';
await assert.rejects(context.packageLookup(ids[0],{assetContext:other}),/build.*mismatch/i);
other.release();
console.log('Package session: one parse per shard, per-asset identity, abort, bounded retention and cleanup passed.');
