import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute production request orchestration and Worker validation; replace only
// metadata IO and PNG encoding so races are deterministic without live services.
const workers = [], pending = new Map();
const releaseBuild = '++Fortnite+Release-42.30-CL-58557680-Windows';
const pinnedLive = 'https://fortnite-direct.dillycdn.com/manifests/pinned-live.manifest';
const pinnedStudio = 'https://fortnite-direct.dillycdn.com/manifests/pinned-studio.manifest';
const releaseFixture = () => ({
  schema: 'fnaa.browser-release.v1', fortniteBuild: releaseBuild,
  manifestSources: {
    live: { url: pinnedLive, id: 'pinned-live', fullBuild: releaseBuild, hash: 'a'.repeat(40), size: 100 },
    studio: { url: pinnedStudio, id: 'pinned-studio', fullBuild: releaseBuild, hash: 'b'.repeat(40), size: 100 }
  }
});
let browserRelease = releaseFixture(), liveBuild = releaseBuild, studioBuild = releaseBuild;
let releaseGate = null;
const metadataRequests = [];
let source = fs.readFileSync(new URL('./novasparx-texture-runtime.js', import.meta.url), 'utf8');
source = source.replace('  function clearCaches() {', `
  locate = (path, options) =>
    globalThis.testLocate(
      normalizeInput(path),
      options
    );
  locatePackage = globalThis.testLocatePackage;
  globalThis.testManifestForLocation = manifestForLocation;
  globalThis.testMaterialValueFallback = materialValueFallback;
  canvasBlob = async () => new Blob(['pixels']);
  sha256Hex = async () => 'test-hash';
  globalThis.testNormalize = normalizeInput;
  function clearCaches() {`);
const context = {
  URL, AbortController, ArrayBuffer, Uint8Array, Float32Array, Uint32Array, Blob, TextDecoder, Response, setTimeout, clearTimeout,
  async fetch(input) {
    const url = String(input);
    metadataRequests.push(url);
    if (url.endsWith('/novasparx-runtime/release.json')) {
      if (releaseGate) return await releaseGate();
      return browserRelease === null ? new Response('', { status: 404 }) : Response.json(browserRelease);
    }
    if (url.endsWith('/location-index/manifest.json')) return Response.json({
      schema: 'novasparx.asset-locations.v1', hash: 'fnv1a32-low-byte', fortniteVersion: liveBuild
    });
    if (url.endsWith('/studio-location-index/manifest.json')) return Response.json({
      schema: 'novasparx.asset-locations.v1', hash: 'fnv1a32-low-byte', fortniteVersion: studioBuild
    });
    if (url === 'https://export-service-new.dillyapis.com/v1/manifests') return Response.json([
      { appName: 'Fortnite', labelName: 'Live-Windows', downloadUrl: 'https://fortnite-direct.dillycdn.com/manifests/newer-live.manifest' },
      { appName: 'Fortnite_Studio', labelName: 'Live-Windows', downloadUrl: 'https://fortnite-direct.dillycdn.com/manifests/newer-studio.manifest' }
    ]);
    throw new Error('Unexpected runtime metadata URL: ' + url);
  },
  WebAssembly, document: {
    baseURI: 'https://example.test/',
    currentScript: {
      src: 'https://example.test/novasparx-texture-runtime.js?v=108'
    }
  },
  FNAA_CONFIG: { apiEndpoint: 'https://example.test' },
  testLocate(path, { signal }) {
    return new Promise(resolve => pending.set(path, { signal, resolve: () => resolve({
      key: path, toc: 'test.utoc', shard: '00', manifestKind: path === 'studio-pin.uasset' ? 'studio' : 'live'
    }) }));
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

assert.equal(await context.testManifestForLocation({ manifestKind: 'live' }), pinnedLive, 'Live must use the packaged pinned manifest');
assert.equal(await context.testManifestForLocation({ manifestKind: 'studio' }), pinnedStudio, 'Studio must use the packaged pinned manifest');
assert.equal(metadataRequests.filter(url => url.endsWith('/release.json')).length, 1, 'Both families share one cached release descriptor');
assert.equal(metadataRequests.some(url => url.includes('/v1/manifests')), false, 'Runtime must not discover a newer manifest');

for (const family of ['live', 'studio']) {
  runtime.clearCaches();
  if (family === 'live') liveBuild = '++Fortnite+Release-43.00-CL-99999999-Windows';
  else studioBuild = '++Fortnite+Release-43.00-CL-99999999-Windows';
  await assert.rejects(context.testManifestForLocation({ manifestKind: family }), /release.*build.*mismatch/i);
  liveBuild = studioBuild = releaseBuild;
}

for (const alter of [
  release => { release.schema = 'unknown'; },
  release => { release.fortniteBuild = '42.30'; },
  release => { release.manifestSources.live.fullBuild = 'different-build'; },
  release => { release.manifestSources.studio.url = 'https://unapproved.test/wrong.manifest'; },
  release => { release.manifestSources.live.url = pinnedLive.replace('https:', 'http:'); },
  release => { delete release.manifestSources.live.id; },
  release => { release.manifestSources.studio.size = 0; }
]) {
  runtime.clearCaches();
  browserRelease = releaseFixture(); alter(browserRelease);
  await assert.rejects(context.testManifestForLocation({ manifestKind: 'live' }), /release descriptor.*invalid/i);
}
runtime.clearCaches(); browserRelease = null;
await assert.rejects(context.testManifestForLocation({ manifestKind: 'live' }), /release descriptor.*HTTP 404/i);
assert.equal(metadataRequests.some(url => url.includes('/v1/manifests')), false, 'Invalid or missing release must fail without newer-build fallback');

runtime.clearCaches(); browserRelease = releaseFixture();
let resolveOldRelease;
releaseGate = () => new Promise(resolve => { resolveOldRelease = resolve; });
const staleReleaseController = new AbortController();
const staleRelease = context.testManifestForLocation({ manifestKind: 'live' }, { signal: staleReleaseController.signal });
const staleRejected = assert.rejects(staleRelease, { name: 'AbortError' });
await tick();
releaseGate = null;
browserRelease.manifestSources.live.url = pinnedLive.replace('pinned-live', 'latest-pinned-live');
assert.equal(await context.testManifestForLocation({ manifestKind: 'live' }), browserRelease.manifestSources.live.url);
staleReleaseController.abort('replaced-by-new-texture');
resolveOldRelease(Response.json(releaseFixture())); await staleRejected;
assert.equal(await context.testManifestForLocation({ manifestKind: 'live' }), browserRelease.manifestSources.live.url, 'Aborted descriptor fetch must not overwrite the latest cache');

runtime.clearCaches();
releaseGate = () => new Promise(resolve => { resolveOldRelease = resolve; });
const beforeReset = context.testManifestForLocation({ manifestKind: 'live' });
const resetRejected = assert.rejects(beforeReset, { name: 'AbortError' });
await tick(); runtime.clearCaches(); releaseGate = null;
resolveOldRelease(Response.json(releaseFixture())); await resetRejected;
browserRelease = releaseFixture();
assert.equal(await context.testManifestForLocation({ manifestKind: 'live' }), pinnedLive, 'clearCaches resets the release descriptor and pending work');
console.log('Runtime release: pinned Live/Studio URLs, mixed-build rejection, missing/invalid release, cancellation and cache reset passed.');

runtime.clearCaches(); liveBuild = '++Fortnite+Release-43.00-CL-99999999-Windows';
const mixedWorker = runtime.resolveTexture('mixed-release.uasset');
const mixedWorkerRejected = assert.rejects(mixedWorker, /release.*build.*mismatch/i);
pending.get('mixed-release.uasset').resolve(); await mixedWorkerRejected;
assert.equal(workers.length, 0, 'A mixed release must fail before spawning a decode Worker');
liveBuild = releaseBuild; runtime.clearCaches();

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
assert.equal(new URL(workers[0].url.searchParams.get('manifest')).searchParams.get('url'), pinnedLive,
  'Worker manifest relay must receive the pinned Live URL');
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
      name: 'EmissiveColor',
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

// The interactive consumer gets the original streams without PNG rendering.
// A failed Texture slot must not discard the next slot or the geometry.
const rendersBefore3d = renderCalls.length;
const viewerRequest = runtime.resolveMeshImage('viewer.uasset', { interactive: true });
pending.get('viewer.uasset').resolve();
await tick();
const viewerWorker = workers.at(-1);
const viewerPositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer;
viewerWorker.send({
  type: 'mesh', path: 'viewer.uasset', positions: viewerPositions,
  indices: new Uint32Array([0, 1, 2, 0, 2, 1]).buffer,
  uv0: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
  sections: [
    { firstIndex: 0, numTriangles: 1, materialIndex: 0 },
    { firstIndex: 3, numTriangles: 1, materialIndex: 1 }
  ],
  materialMetadata: [
    { textureParameters: [{ name: 'BaseColor', path: '/Game/Textures/T_Broken.T_Broken' }] },
    { vectorParameterValues: [{ name: 'BaseColor', r: 0.1, g: 0.2, b: 0.3, a: 1 }] },
    { textureParameters: [{ name: 'BaseColor', path: '/Game/Textures/T_Unused.T_Unused' }] }
  ]
});
viewerWorker.send({ type: 'done', exitCode: 0 });
const viewerResult = await viewerRequest;
assert.ok(viewerResult.manifest, 'Interactive Mesh must expose its renderer manifest');
assert.equal(viewerResult.manifest.geometry.positions.buffer, viewerPositions, 'Reuse the transferred Mesh buffer');
assert.equal(viewerResult.manifest.sections[0].indexCount, 3);
pending.get('FortniteGame/Content/Textures/T_Broken.uasset').resolve();
await tick();
assert.equal(workers.at(-1).url.searchParams.get('maxSize'), '2048', 'Interactive materials should request full 2K decoding');
workers.at(-1).send({ type: 'error', error: 'Texture unavailable' });
const viewerMaterials = await viewerResult.materialPromise;
assert.equal(viewerMaterials.manifest.geometry, viewerResult.manifest.geometry);
assert.equal(viewerMaterials.manifest.materials.length, 3);
assert.equal(viewerMaterials.missingMaterials[0], 0);
assert.equal(viewerMaterials.manifest.materials[1].baseColor[2], 0.3);
assert.equal(pending.has('FortniteGame/Content/Textures/T_Unused.uasset'), false, 'Unused Mesh slots must not resolve or decode textures');
assert.equal(renderCalls.length, rendersBefore3d, 'Interactive Mesh must not render redundant PNG frames');
assert.equal(workers.at(-1).terminated, true);
console.log('Mesh viewer: stream reuse, per-slot fallback and no redundant still rendering passed.');

// The cache owns decoded frames only. Each slot keeps its own supported values.
const sharedPath = 'FortniteGame/Content/Textures/T_SharedTint.uasset';
const sharedRequest = runtime.resolveMeshImage('shared-tints.uasset', { interactive: true });
pending.get('shared-tints.uasset').resolve(); await tick();
const sharedMeshWorker = workers.at(-1);
sharedMeshWorker.send({
  type: 'mesh', path: 'shared-tints.uasset',
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
  indices: new Uint32Array([0, 1, 2, 0, 2, 1]).buffer,
  uv0: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
  sections: [
    { firstIndex: 0, numTriangles: 1, materialIndex: 0 },
    { firstIndex: 3, numTriangles: 1, materialIndex: 1 }
  ],
  materialMetadata: [0, 1].map(slot => ({
    textureParameters: [
      { name: 'PM_Diffuse', path: '/Game/Textures/T_SharedTint.T_SharedTint' },
      { name: 'Diffuse', path: '/Game/Textures/T_SharedTint.T_SharedTint' }
    ],
    vectorParameterValues: [
      { name: 'BaseColor', r: slot ? 0.2 : 0.8, g: 0.4, b: slot ? 0.9 : 0.1, a: 1 },
      { name: 'Emissive', r: slot ? 0.3 : 0, g: 0, b: 0, a: 1 }
    ],
    scalarParameterValues: [
      { name: 'Roughness', value: slot ? 0.25 : 0.75 },
      { name: 'Opacity', value: slot ? 0.5 : 1 }
    ]
  }))
});
sharedMeshWorker.send({ type: 'done', exitCode: 0 });
const sharedFirst = await sharedRequest;
pending.get(sharedPath).resolve(); await tick();
const sharedTextureWorker = workers.at(-1);
sharedTextureWorker.send({ type: 'pixels', path: sharedPath, width: 1, height: 1, pixels: new ArrayBuffer(4) });
sharedTextureWorker.send({ type: 'done', exitCode: 0 });
const sharedFinal = await sharedFirst.materialPromise;
const [warmSlot, coolSlot] = sharedFinal.manifest.materials;
assert.notEqual(warmSlot, coolSlot, 'Shared texture cannot share mutable per-slot material values');
assert.deepEqual(Array.from(warmSlot.baseColor), [0.8, 0.4, 0.1, 1]);
assert.deepEqual(Array.from(coolSlot.baseColor), [0.2, 0.4, 0.9, 1]);
assert.equal(warmSlot.roughness, 0.75); assert.equal(coolSlot.roughness, 0.25);
assert.equal(warmSlot.opacity, 1); assert.equal(coolSlot.opacity, 0.5);
assert.equal(coolSlot.emissiveColor[0], 0.3);
assert.equal(warmSlot.baseColorFrame, coolSlot.baseColorFrame, 'Slots must reuse the decoded frame');
assert.equal(workers.filter(worker => worker.path === sharedPath).length, 1, 'Shared map must decode once');
const graphColor = context.testMaterialValueFallback({ vectorParameterValues: [
  { name: 'GradientColor', r: 0.1, g: 0.2, b: 0.3, a: 1 }
] }, true);
assert.equal(graphColor.material.baseColor, undefined, 'An unrelated graph color cannot tint a supported diffuse texture');

// A lexical winner is not evidence of the material graph's effective diffuse.
for (const [suffix, textureParameters, reason] of [
  ['equal-diffuse', [
    { name: 'Layer1_Diffuse', path: '/Game/Textures/T_LayerA.T_LayerA' },
    { name: 'Layer2_Diffuse', path: '/Game/Textures/T_LayerB.T_LayerB' }
  ], 'ambiguous-diffuse'],
  ['fallback-cannot-hide-layers', [
    { name: 'PM_Diffuse', path: '/Game/Textures/T_LayerB.T_LayerB' },
    { name: 'Layer1_Diffuse', path: '/Game/Textures/T_LayerA.T_LayerA' },
    { name: 'Layer2_Diffuse', path: '/Game/Textures/T_LayerB.T_LayerB' }
  ], 'ambiguous-diffuse'],
  ['equal-base-albedo', [
    { name: 'BaseColor', path: '/Game/Textures/T_BaseA.T_BaseA' },
    { name: 'Albedo', path: '/Game/Textures/T_BaseB.T_BaseB' }
  ], 'ambiguous-diffuse'],
  ['lego-decorator', [
    { name: 'LEGO_Decorator', path: '/Game/Textures/T_Decorator.T_Decorator' },
    { name: 'ColorGradient_Standard', path: '/Game/Textures/T_Gradient.T_Gradient' }
  ], 'unsupported-decorator'],
  ['lego-fallback-cannot-hide-decorator', [
    { name: 'PM_Diffuse', path: '/Game/Textures/T_Brick.T_Brick' },
    { name: 'LEGO_Decorator', path: '/Game/Textures/T_Decorator.T_Decorator' }
  ], 'unsupported-decorator'],
  ['missing-material', [], 'material-unavailable']
]) {
  const casePath = suffix + '.uasset';
  const before = workers.length;
  const task = runtime.resolveMeshImage(casePath, { interactive: true });
  pending.get(casePath).resolve(); await tick();
  const meshWorker = workers.at(-1);
  meshWorker.send({
    type: 'mesh', path: casePath,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
    indices: new Uint32Array([0, 1, 2]).buffer,
    uv0: new Float32Array([0, 0, 1, 0, 0, 1]).buffer,
    sections: [{ firstIndex: 0, numTriangles: 1, materialIndex: 0 }],
    materialMetadata: [{ textureParameters }]
  });
  meshWorker.send({ type: 'done', exitCode: 0 });
  const first = await task, final = await first.materialPromise;
  assert.equal(final.manifest.geometry, first.manifest.geometry, 'Unsupported material keeps visible geometry');
  assert.equal(final.materialFidelity, 'geometry-only');
  assert.equal(final.missingMaterials[0], 0);
  assert.equal(final.materialDiagnostics[0].reason, reason);
  assert.equal(final.manifest.metadata.materialDiagnostics, final.materialDiagnostics);
  assert.equal(final.manifest.materials[0].baseColorFrame, undefined);
  assert.equal(workers.length, before + 1, 'Ambiguous/unsupported maps must not spawn a guessed decode');
}
assert.equal(viewerMaterials.materialDiagnostics[0].reason, 'texture-unavailable');
assert.match(viewerMaterials.materialDiagnostics[0].detail, /Texture unavailable/);
assert.ok(viewerMaterials.materialDiagnostics.every(item => !item.detail || item.detail.length <= 160));
console.log('Mesh materials: frame-only sharing, distinct slot values, diffuse ambiguity, decorators and bounded missing-material reasons passed.');

// Execute the small production UI formatter without invoking the full page.
const previewSource = fs.readFileSync(new URL('./preview.js', import.meta.url), 'utf8');
const materialUi = {};
vm.runInNewContext(previewSource.slice(previewSource.indexOf('  function setMeta('),
  previewSource.indexOf('  function bindOrbitStick(')), materialUi);
const meta = { dataset: {}, hidden: true, textContent: '' };
assert.equal(materialUi.setMeshMaterialStatus(meta, viewerMaterials.materialFidelity,
  viewerMaterials.materialDiagnostics), true);
assert.equal(meta.hidden, false); assert.equal(meta.dataset.level, 'partial');
assert.match(meta.textContent, /partial material values.*slot 1: texture unavailable/);
const limitedSlots = Array.from({ length: 24 }, (_, slot) => ({ slot, reason: 'ambiguous-diffuse' }));
assert.equal(materialUi.setMeshMaterialStatus(meta, 'geometry-only', limitedSlots), true);
assert.match(meta.textContent, /geometry only.*ambiguous diffuse/);
assert.match(meta.textContent, /\+22 slots/); assert.ok(meta.textContent.length <= 180);
assert.equal(materialUi.setMeshMaterialStatus(meta, sharedFinal.materialFidelity, []), false);
assert.equal(meta.dataset.level, 'preview'); assert.match(meta.textContent, /base color preview/);
console.log('Mesh material UI: visible partial reasons and bounded fidelity labels passed.');
