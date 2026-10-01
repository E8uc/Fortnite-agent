import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute production request orchestration and Worker validation; replace only
// metadata IO and PNG encoding so races are deterministic without live services.
const workers = [], pending = new Map();
let source = fs.readFileSync(new URL('./novasparx-texture-runtime.js', import.meta.url), 'utf8');
source = source.replace('  function clearCaches() {', `
  locate = (path, options) =>
    globalThis.testLocate(
      normalizeInput(path),
      options
    );
  locatePackage = globalThis.testLocatePackage;
  currentManifestUrl = async () => 'https://example.test/live.manifest';
  canvasBlob = async () => new Blob(['pixels']);
  sha256Hex = async () => 'test-hash';
  globalThis.testNormalize = normalizeInput;
  function clearCaches() {`);
const context = {
  URL, AbortController, ArrayBuffer, Uint8Array, Float32Array, Uint32Array, Blob, setTimeout, clearTimeout,
  WebAssembly, document: {
    baseURI: 'https://example.test/',
    currentScript: {
      src: 'https://example.test/novasparx-texture-runtime.js?v=108'
    }
  },
  FNAA_CONFIG: { apiEndpoint: 'https://example.test' },
  testLocate(path, { signal }) {
    return new Promise(resolve => pending.set(path, { signal, resolve: () => resolve({ key: path, toc: 'test.utoc', shard: '00' }) }));
  },
  async testLocatePackage(id) {
    return {
      key: 'material-' + String(id).toLowerCase() + '.uasset',
      toc: 'test.utoc',
      shard: '00'
    };
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
assert.equal(
  workers[0].url.searchParams.get('runtimeRevision'),
  '108',
  'browser runtime must version the Worker URL with the deployed script revision'
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


// A successful Mesh View Image must become visible after the Mesh worker,
// then upgrade the same preview with Texture + Material through the existing
// browser Texture runtime. One BaseColor package should produce one extra
// Texture worker and one final textured render.
const renderCalls = [];
context.NovaSparxRenderer = {
  render: async manifest => {
    renderCalls.push(manifest);
    return {
      blob: new Blob(['mesh']),
      triangleCount: 1,
      materialFidelity: manifest.metadata?.materialFidelity || 'unknown'
    };
  }
};

const beforeProgressiveWorkers = workers.length;
const progressiveMesh = runtime.resolveMeshImage('mesh2.uasset');
pending.get('mesh2.uasset').resolve();
await tick();

const progressiveMeshWorker = workers.at(-1);
progressiveMeshWorker.send({
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
      name: 'PM_Diffuse',
      path: '/Game/Textures/T_Inherited.T_Inherited',
      packageId: ''
    }]
  }]
});
progressiveMeshWorker.send({
  type: 'done',
  exitCode: 0
});

const firstFrame = await progressiveMesh;
assert.equal(firstFrame.previewMode, 'geometry-first');
assert.equal(typeof firstFrame.materialPromise?.then, 'function');

const inheritedTexturePath =
  'FortniteGame/Content/Textures/T_Inherited.uasset';

assert.ok(
  pending.has(inheritedTexturePath),
  'PM_Diffuse inherited path must be routed through the normal asset location index'
);

pending.get(inheritedTexturePath).resolve();
await tick();

assert.equal(
  workers.length,
  beforeProgressiveWorkers + 2,
  'Texture + Material upgrade should reuse the existing Texture engine in one bounded follow-up worker'
);

const materialWorker = workers.at(-1);
assert.equal(
  materialWorker.path,
  inheritedTexturePath
);

materialWorker.send({
  type: 'pixels',
  path: inheritedTexturePath,
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4)
});
materialWorker.send({
  type: 'done',
  exitCode: 0
});

const finalFrame = await firstFrame.materialPromise;
assert.equal(finalFrame.previewMode, 'base-color-preview');
assert.equal(finalFrame.missingMaterials.length, 0);
assert.equal(renderCalls.length >= 2, true);
assert.equal(
  renderCalls.at(-1).materials[0].baseColorFrame.width,
  1
);
assert.equal(
  renderCalls.at(-1).materials[0].baseColorFrame.height,
  1
);
assert.ok(
  renderCalls.at(-1).materials[0].baseColorFrame.pixels instanceof ArrayBuffer,
  'Mesh material must pass decoded RGBA pixels directly to the renderer'
);
assert.equal(progressiveMeshWorker.terminated, true);
assert.equal(materialWorker.terminated, true);
console.log('Mesh View Image: FModel-style PM_Diffuse parent Texture path resolves through the existing Texture runtime.');

// Environment materials often expose a world-space/layered diffuse parameter
// alongside generic color/gradient textures. Prefer the actual diffuse source
// so large Props/Walls/Floors do not receive the wrong material texture.
const rankedMesh = runtime.resolveMeshImage('mesh3.uasset');
pending.get('mesh3.uasset').resolve();
await tick();

const rankedMeshWorker = workers.at(-1);
rankedMeshWorker.send({
  type: 'mesh',
  path: 'mesh3.uasset',
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
    textureParameters: [
      {
        name: 'ColorGradient_Standard',
        path: '/Game/Textures/T_ColorGradient.T_ColorGradient',
        packageId: ''
      },
      {
        name: 'WS Diffuse',
        path: '/Game/Textures/T_WorldDiffuse.T_WorldDiffuse',
        packageId: ''
      }
    ]
  }]
});
rankedMeshWorker.send({
  type: 'done',
  exitCode: 0
});

const rankedFirstFrame = await rankedMesh;
const worldDiffusePath =
  'FortniteGame/Content/Textures/T_WorldDiffuse.uasset';
const colorGradientPath =
  'FortniteGame/Content/Textures/T_ColorGradient.uasset';

assert.ok(
  pending.has(worldDiffusePath),
  'Environment Mesh material did not prefer WS Diffuse'
);
assert.equal(
  pending.has(colorGradientPath),
  false,
  'Environment Mesh material incorrectly preferred a generic color gradient over WS Diffuse'
);

pending.get(worldDiffusePath).resolve();
await tick();

const rankedTextureWorker = workers.at(-1);
assert.equal(
  rankedTextureWorker.path,
  worldDiffusePath
);
rankedTextureWorker.send({
  type: 'pixels',
  path: worldDiffusePath,
  width: 2,
  height: 2,
  pixels: new ArrayBuffer(16)
});
rankedTextureWorker.send({
  type: 'done',
  exitCode: 0
});

const rankedFinalFrame =
  await rankedFirstFrame.materialPromise;
assert.equal(
  rankedFinalFrame.missingMaterials.length,
  0
);
console.log('Mesh View Image: environment material ranking prefers WS/layer diffuse over generic color textures.');

// Texture-less Fortnite materials must preserve CUE4Parse parameter values
// instead of being mislabeled as a failed Texture application.
const beforeValueWorkers = workers.length;
const valueMesh = runtime.resolveMeshImage('water-mesh.uasset');
pending.get('water-mesh.uasset').resolve();
await tick();

const valueMeshWorker = workers.at(-1);
valueMeshWorker.send({
  type: 'mesh',
  path: 'water-mesh.uasset',
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
    textureParameters: [],
    vectorParameterValues: [{
      name: 'BaseColor',
      r: 0.02,
      g: 0.18,
      b: 0.31,
      a: 1
    }],
    scalarParameterValues: []
  }]
});
valueMeshWorker.send({
  type: 'done',
  exitCode: 0
});

const valueFirstFrame = await valueMesh;
const valueFinalFrame =
  await valueFirstFrame.materialPromise;

assert.equal(
  valueFinalFrame.previewMode,
  'material-value-preview'
);
assert.equal(
  valueFinalFrame.materialApplied,
  true
);
assert.equal(
  valueFinalFrame.missingMaterials.length,
  0
);
assert.deepEqual(
  Array.from(
    renderCalls.at(-1).materials[0].baseColor
  ),
  [0.02, 0.18, 0.31, 1]
);
assert.equal(
  workers.length,
  beforeValueWorkers + 1,
  'Vector-only material must not spawn a fake Texture worker'
);

const beforeEmissiveWorkers = workers.length;
const emissiveMesh = runtime.resolveMeshImage('pirate-mesh.uasset');
pending.get('pirate-mesh.uasset').resolve();
await tick();

const emissiveMeshWorker = workers.at(-1);
emissiveMeshWorker.send({
  type: 'mesh',
  path: 'pirate-mesh.uasset',
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
    textureParameters: [],
    vectorParameterValues: [{
      name: 'Emissive',
      r: 0.7,
      g: 0.25,
      b: 0.08,
      a: 1
    }],
    scalarParameterValues: [{
      name: 'Day',
      value: 1
    }]
  }]
});
emissiveMeshWorker.send({
  type: 'done',
  exitCode: 0
});

const emissiveFirstFrame =
  await emissiveMesh;
const emissiveFinalFrame =
  await emissiveFirstFrame.materialPromise;

assert.equal(
  emissiveFinalFrame.previewMode,
  'material-value-preview'
);
assert.equal(
  emissiveFinalFrame.materialApplied,
  true
);
assert.deepEqual(
  Array.from(
    renderCalls.at(-1).materials[0].baseColor
  ),
  [0, 0, 0, 1]
);
assert.deepEqual(
  Array.from(
    renderCalls.at(-1).materials[0].emissiveColor
  ),
  [0.7, 0.25, 0.08, 1]
);
assert.equal(
  workers.length,
  beforeEmissiveWorkers + 1,
  'Procedural emissive material must not spawn a fake Texture worker'
);
console.log('Mesh View Image: vector-only and procedural material values render without fake Texture failures.');




// Listen: Audio requests must use the dedicated worker mode, validate path
// identity, keep raw bytes bounded, and transfer a successful SoundWave result.
const beforeAudioWorkers =
  workers.length;

const audioRequest =
  runtime.resolveAudio(
    'SW_Test.uasset'
  );

pending.get(
  'SW_Test.uasset'
).resolve();

await tick();

assert.equal(
  workers.length,
  beforeAudioWorkers + 1
);

const audioWorker =
  workers.at(-1);

assert.equal(
  audioWorker.url.searchParams.get(
    'test'
  ),
  'resolve-audio-relay'
);

audioWorker.send({
  type: 'audio',
  path: 'SW_Test.uasset',
  format: 'OGG',
  bytes:
    new Uint8Array([
      0x4f,
      0x67,
      0x67,
      0x53,
      1,
      2,
      3,
      4
    ]).buffer
});

audioWorker.send({
  type: 'done',
  exitCode: 0
});

const audioResult =
  await audioRequest;

assert.equal(
  audioResult.format,
  'OGG'
);

assert.equal(
  audioResult.bytes
    .byteLength,
  8
);

assert.equal(
  audioResult.path,
  'SW_Test.uasset'
);

assert.equal(
  audioWorker.terminated,
  true
);

const badAudio =
  runtime.resolveAudio(
    'SW_Bad.uasset'
  );

pending.get(
  'SW_Bad.uasset'
).resolve();

await tick();

const badAudioWorker =
  workers.at(-1);

const rejectedAudio =
  assert.rejects(
    badAudio,
    /mismatched Audio/
  );

badAudioWorker.send({
  type: 'audio',
  path: 'SW_Other.uasset',
  format: 'OGG',
  bytes:
    new ArrayBuffer(8)
});

await rejectedAudio;

assert.equal(
  badAudioWorker.terminated,
  true
);

console.log(
  'Listen: audio worker mode, bounded bytes, path identity and cleanup passed.'
);
