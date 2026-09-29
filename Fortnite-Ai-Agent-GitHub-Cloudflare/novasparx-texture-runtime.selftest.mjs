import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute production request orchestration and Worker validation; replace only
// metadata IO and PNG encoding so races are deterministic without live services.
const workers = [], pending = new Map();
let source = fs.readFileSync(new URL('./novasparx-texture-runtime.js', import.meta.url), 'utf8');
source = source.replace('  function clearCaches() {', `
  locate = globalThis.testLocate;
  currentManifestUrl = async () => 'https://example.test/live.manifest';
  canvasBlob = async () => new Blob(['pixels']);
  sha256Hex = async () => 'test-hash';
  globalThis.testNormalize = normalizeInput;
  function clearCaches() {`);
const context = {
  URL, AbortController, ArrayBuffer, Uint8Array, Float32Array, Uint32Array, Blob, setTimeout, clearTimeout,
  WebAssembly, document: { baseURI: 'https://example.test/' },
  FNAA_CONFIG: { apiEndpoint: 'https://example.test' },
  testLocate(path, { signal }) {
    return new Promise(resolve => pending.set(path, { signal, resolve: () => resolve({ key: path, toc: 'test.utoc', shard: '00' }) }));
  },
  Worker: class {
    constructor(url) {
      this.url = url;
      this.path = url.searchParams.get('path');
      workers.push(this);
    }
    terminate() { this.terminated = true; }
    send(data) { this.onmessage({ data }); }
  }
};
vm.runInNewContext(source, context);
const runtime = context.NovaSparxTextureRuntime;
const tick = () => new Promise(resolve => setImmediate(resolve));
assert.equal(context.testNormalize("Texture2D'/Game/Textures/T_Test.T_Test'"), 'FortniteGame/Content/Textures/T_Test.uasset');
assert.equal(context.testNormalize('FortniteGame/Content/T_Test.uasset'), 'FortniteGame/Content/T_Test.uasset');
const a = runtime.resolveTexture('a.uasset');
const rejectedA = assert.rejects(a, { name: 'AbortError' });
const b = runtime.resolveTexture('b.uasset');
const rejectedB = assert.rejects(b, /mismatched/);
assert.equal(pending.get('a.uasset').signal.aborted, true);
pending.get('b.uasset').resolve(); await tick();
pending.get('a.uasset').resolve(); await rejectedA;
assert.equal(workers.length, 1, 'old metadata must not spawn or replace a Worker');
assert.equal(
  workers[0].url.searchParams.get('chunkBase'),
  'https://example.test/nova-edge/chunk/',
  'browser runtime must keep Epic BuildPatch chunk fetches on the controlled Nova edge'
);
workers[0].send({ type: 'pixels', path: 'other.uasset', width: 1, height: 1, pixels: new ArrayBuffer(4) });
await rejectedB;
assert.equal(workers[0].terminated, true);
const controller = new AbortController();
const c = runtime.resolveTexture('c.uasset', { signal: controller.signal });
const rejectedC = assert.rejects(c, { name: 'AbortError' });
pending.get('c.uasset').resolve(); await tick(); controller.abort(); await rejectedC;
assert.equal(workers[1].terminated, true);
const d = runtime.resolveTexture('d.uasset');
const rejectedD = assert.rejects(d, { name: 'AbortError' });
runtime.clearCaches(); assert.equal(pending.get('d.uasset').signal.aborted, true);
pending.get('d.uasset').resolve(); await rejectedD;
const e = runtime.resolveTexture('e.uasset');
pending.get('e.uasset').resolve(); await tick();
workers[2].send({ type: 'pixels', path: 'E.uasset', width: 1, height: 1, pixels: new ArrayBuffer(4) });
workers[2].send({ type: 'done', exitCode: 0 });
assert.equal((await e).source, 'browser-wasm');
assert.equal(workers[2].terminated, true);
console.log('Texture runtime: metadata race, caller abort, reset, path identity and cleanup passed.');

// A Mesh request cannot accept a Texture frame, and must release its Worker.
context.NovaSparxRenderer = {render:async()=>({blob:new Blob(['mesh']),triangleCount:1})};
const meshRequest=runtime.resolveMeshImage('mesh.uasset');
const meshRejected=assert.rejects(meshRequest,/unrelated pixels/);
pending.get('mesh.uasset').resolve();await tick();
workers.at(-1).send({type:'pixels',path:'mesh.uasset',width:1,height:1,pixels:new ArrayBuffer(4)});
await meshRejected;assert.equal(workers.at(-1).terminated,true);


// A successful Mesh View Image must stop after the verified geometry worker.
// Material metadata may advertise a base-color Texture, but first-image latency
// must never launch serial Texture workers.
const beforeFastMeshWorkers = workers.length;
const fastMesh = runtime.resolveMeshImage('mesh2.uasset');
pending.get('mesh2.uasset').resolve();
await tick();
const fastMeshWorker = workers.at(-1);
fastMeshWorker.send({
  type: 'mesh',
  path: 'mesh2.uasset',
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ]).buffer,
  indices: new Uint32Array([0, 1, 2]).buffer,
  uv0: new Float32Array([
    0, 0,
    1, 0,
    0, 1
  ]).buffer,
  sections: [{
    firstIndex: 0,
    numTriangles: 1,
    materialIndex: 0
  }],
  materialMetadata: [{
    textureParameters: [{
      name: 'BaseColor',
      packageId: '0123456789abcdef'
    }]
  }]
});
fastMeshWorker.send({ type: 'done', exitCode: 0 });
const fastMeshResult = await fastMesh;
assert.equal(
  workers.length,
  beforeFastMeshWorkers + 1,
  'Mesh View Image must not launch a second Worker for material Textures'
);
assert.equal(fastMeshResult.previewMode, 'geometry-first');
assert.equal(fastMeshResult.missingMaterials.length, 1);
assert.equal(fastMeshWorker.terminated, true);
console.log('Mesh View Image: geometry-first result uses one Worker and does not block on material Textures.');
