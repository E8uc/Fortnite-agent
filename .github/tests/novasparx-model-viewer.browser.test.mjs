import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium, webkit, devices } from "playwright";

// Reuse the established live BuildPatch/range relay and static-site bootstrap.
// The bounded prefix starts no browser and runs none of the old regression matrix.
const previousHarness = fs.readFileSync(new URL("./novasparx-texture-runtime.browser.test.mjs", import.meta.url), "utf8");
const bootstrapEnd = previousHarness.indexOf("const browser =\n");
assert.ok(bootstrapEnd > 0, "Existing browser proof bootstrap anchor changed");
let bootstrapSource = previousHarness.slice(0, bootstrapEnd).replace(/^import .*;\n/gm, "");
// Match the production viewport so phone proofs exercise the actual narrow UI.
bootstrapSource = bootstrapSource.replace('<meta charset="utf-8">',
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">');
if (process.env.FNAA_RUNTIME_SOURCE) {
  const runtimeSource = new URL(process.env.FNAA_RUNTIME_SOURCE);
  assert.equal(runtimeSource.protocol, "https:", "Published runtime source must use HTTPS");
  const staticCheck = "        if (\n          !within(\n            site,\n            file\n          ) ||";
  assert.ok(bootstrapSource.includes(staticCheck), "Existing static server anchor changed");
  bootstrapSource = bootstrapSource.replace(staticCheck, `
        if (requestUrl.pathname.startsWith('/novasparx-runtime/') && within(site, file) && !fs.existsSync(file)) {
          const upstreamUrl = new URL(requestUrl.pathname.slice('/novasparx-runtime/'.length), ${JSON.stringify(runtimeSource.href)});
          const upstream = await fetch(upstreamUrl);
          if (!upstream.ok) throw new Error('Published runtime returned HTTP ' + upstream.status + ': ' + upstreamUrl);
          const bytes = Buffer.from(await upstream.arrayBuffer());
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const temporary = file + '.' + process.pid + '.tmp';
          fs.writeFileSync(temporary, bytes);
          fs.renameSync(temporary, file);
        }
${staticCheck}`);
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const bootstrap = new AsyncFunction("assert", "fs", "http", "path", "chromium", "webkit", "devices", `${bootstrapSource}\nreturn { server, origin, BROWSER_TYPE, BROWSER_ENGINE, MOBILE_PROFILE, PAGE_OPTIONS, counters: () => ({relayRequests, relayBytes, chunkRelayRequests, chunkRelayBytes, manifestRelayRequests, manifestRelayBytes, exactImageRequests, legacyTextureRequests}) };`);
const setup = await bootstrap(assert, fs, http, path, chromium, webkit, devices);
const profile = `${setup.BROWSER_ENGINE}-${setup.MOBILE_PROFILE || "desktop"}`;
const output = path.resolve(process.env.FNAA_PROOF_OUTPUT_DIR || `fnaa-model-proof-${profile}`);
fs.mkdirSync(output, { recursive: true });

const cases = [
  { name: "volcano", path: "FortniteGame/Content/Environments/World/Backgrounds/Locales/Temperate/Meshes/SM_STW_Volcano_BG.uasset" },
  { name: "small", path: "FortniteGame/Plugins/GameFeatures/Juno/FigureCosmetics/Content/Props/Emote/CallWaiting/Mesh/SM_CallWaiting.uasset" },
  { name: "stw", path: "FortniteGame/Plugins/GameFeatures/SaveTheWorld/Content/Environments/Sets/STW_Spring/Meshes/Foliage/SM_STW_Tree_Medium.uasset", textured: true },
  { name: "br", path: "FortniteGame/Content/Environments/Apollo/Props/LazyLakeSign/Mesh/SM_LazyLakeLodge_Sign.uasset", textured: true }
];
const selection = String(process.env.FNAA_MODEL_PROOF_CASE || "volcano").toLowerCase();
if (process.env.FNAA_MODEL_PROOF_PATH) cases.push({ name: 'multi', path: process.env.FNAA_MODEL_PROOF_PATH, textured: true });
const selectedCases = selection === "all" ? cases : cases.filter(asset => asset.name === selection);
assert.ok(selectedCases.length, `Unknown FNAA_MODEL_PROOF_CASE ${selection}`);
const texturePath = "FortniteGame/Plugins/GameFeatures/BRCosmetics/Content/Animation/Game/MainPlayer/Emotes/FaithPerch/FX/T_Emote_FaithPerch_SoftGlow.uasset";
const browser = await setup.BROWSER_TYPE.launch({ headless: true });
const proof = { profile, case: selection, meshes: [], console: [] };
let page;

try {
  page = await browser.newPage(setup.PAGE_OPTIONS);
  if (process.env.FNAA_DISABLE_MANIFEST_CACHE === '1') {
    page.on('worker', worker => worker.evaluate(() => {
      Object.defineProperty(globalThis, 'caches', { configurable: true, get() { throw new Error('CacheStorage unavailable in this targeted fallback proof'); } });
    }).catch(error => proof.console.push('CACHE_SIMULATION_ERROR ' + error.message)));
    proof.cacheStorageDisabled = true;
  }
  page.setDefaultTimeout(30_000);
  page.on("console", message => { if (proof.console.length < 80) proof.console.push(message.text()); });
  page.on("pageerror", error => proof.console.push(`PAGE_ERROR ${error.stack || error}`));
  // Relay only bytes through Node's configured proxy/CA; decoding stays here.
  await page.route("https://**/*", async route => {
    try {
      const request = route.request();
      const response = await fetch(request.url(), {
        method: request.method(), headers: request.headers(),
        body: request.postDataBuffer() || undefined,
        signal: AbortSignal.timeout(60_000)
      });
      const headers = Object.fromEntries(response.headers);
      delete headers['content-encoding'];
      delete headers['content-length'];
      headers['access-control-allow-origin'] = '*';
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    } catch (error) {
      proof.console.push(`HTTPS_RELAY ${error.message}`);
      await route.abort();
    }
  });
  await page.goto(setup.origin, { waitUntil: "domcontentloaded" });
  if (setup.MOBILE_PROFILE) assert.equal(await page.evaluate(() => window.innerWidth), setup.PAGE_OPTIONS.viewport.width, 'Mobile proof must use the device viewport');
  await page.addStyleTag({ url: "/style.css" });
  await page.addStyleTag({ url: "/fnaa-v101.css" });
  await page.addScriptTag({ url: "/novasparx-renderer.js" });
  await page.addScriptTag({ url: "/asset-diagnosis.js" });
  await page.addScriptTag({ url: "/novasparx-associations.js" });

  // Observe real runtime results and WebGL matrices. No geometry, material,
  // worker, decode, renderer, or preview result is replaced with a fixture.
  await page.evaluate(() => {
    const observation = window.__modelProof = { resolutions: [], mounts: [], frames: [], uniformNames: new WeakMap() };
    const originalRuntime = window.NovaSparxTextureRuntime;
    window.NovaSparxTextureRuntime = {
      ...originalRuntime,
      async resolveMeshImage(assetPath, options) {
        const startedAt = performance.now();
        const record = { path: assetPath, options: { interactive: options?.interactive, maxMaterialSize: options?.maxMaterialSize }, first: null, final: null, error: null };
        observation.resolutions.push(record);
        try {
          const result = await originalRuntime.resolveMeshImage(assetPath, options);
          record.geometryReadyMs = Math.round(performance.now() - startedAt);
          record.first = result;
          record.geometry = result.manifest?.geometry;
          result.materialPromise?.then(final => { record.final = final; record.materialsReadyMs = Math.round(performance.now() - startedAt); }, error => { record.error = String(error); });
          return result;
        } catch (error) { record.error = String(error); throw error; }
      }
    };
    for (const Constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
      const prototype = Constructor.prototype;
      const originalLocation = prototype.getUniformLocation;
      const originalMatrix = prototype.uniformMatrix4fv;
      const originalUpload = prototype.texImage2D;
      const originalMipmap = prototype.generateMipmap;
      prototype.texImage2D = function (...args) {
        const stats = this.canvas.__modelProofTextures ||= { uploads: 0, mipmaps: 0 };
        stats.uploads++;
        return originalUpload.apply(this, args);
      };
      prototype.generateMipmap = function (...args) {
        const stats = this.canvas.__modelProofTextures ||= { uploads: 0, mipmaps: 0 };
        stats.mipmaps++;
        return originalMipmap.apply(this, args);
      };
      prototype.getUniformLocation = function (program, name) {
        const location = originalLocation.call(this, program, name);
        if (location) observation.uniformNames.set(location, name);
        return location;
      };
      prototype.uniformMatrix4fv = function (location, transpose, matrix, ...rest) {
        if (observation.uniformNames.get(location) === "uMVP") this.canvas.__modelProofMvp = Array.from(matrix);
        return originalMatrix.call(this, location, transpose, matrix, ...rest);
      };
    }
    const originalRenderer = window.NovaSparxRenderer;
    window.NovaSparxRenderer = {
      ...originalRenderer,
      async mount(manifest, host, options) {
        const controller = await originalRenderer.mount(manifest, host, options);
        const record = { manifest, controller, host, disposed: false };
        observation.mounts.push(record);
        const originalDispose = controller.dispose.bind(controller);
        controller.dispose = () => { record.disposed = true; originalDispose(); };
        return controller;
      }
    };
    observation.active = () => observation.mounts.findLast(record => !record.disposed && record.controller.canvas.isConnected);
    observation.snapshot = async record => {
      record ||= observation.active();
      if (!record) throw new Error("No live real Mesh canvas");
      // Measure Mesh pixels independently so the new Grid cannot hide a blank Mesh.
      const groundWasVisible = record.controller.groundVisible;
      if (groundWasVisible) {
        record.controller.setGroundVisible(false);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const { canvas } = record.controller;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let opaque = 0, edgePixels = 0;
      const colors = new Set();
      const pixelBounds = { minX: canvas.width, minY: canvas.height, maxX: -1, maxY: -1 };
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const offset = (y * canvas.width + x) * 4;
        if (pixels[offset + 3] > 8) {
          opaque++;
          if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) edgePixels++;
          pixelBounds.minX = Math.min(pixelBounds.minX, x); pixelBounds.maxX = Math.max(pixelBounds.maxX, x);
          pixelBounds.minY = Math.min(pixelBounds.minY, y); pixelBounds.maxY = Math.max(pixelBounds.maxY, y);
          if (colors.size < 512) colors.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
        }
      }
      const matrix = canvas.__modelProofMvp;
      if (!matrix) throw new Error("Real draw did not upload an MVP matrix");
      const projected = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      const positions = record.manifest.geometry.positions;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        const px = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
        const py = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
        projected.minX = Math.min(projected.minX, px); projected.maxX = Math.max(projected.maxX, px);
        projected.minY = Math.min(projected.minY, py); projected.maxY = Math.max(projected.maxY, py);
      }
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)), byte => byte.toString(16).padStart(2, "0")).join("");
      const perspective = Math.hypot(matrix[3], matrix[7], matrix[11]) > 0;
      if (groundWasVisible) {
        record.controller.setGroundVisible(true);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      return { width: canvas.width, height: canvas.height, opaque, colors: colors.size, edgePixels, pixelBounds, projected, sha256, perspective, textured: record.controller.textured, materialFidelity: record.controller.materialFidelity };
    };
    // The only search fixture is its exact result path. Classification and all
    // asset loading below use the production code and current Fortnite data.
    window.FortniteAgent = { isSignedIn: () => true, beginGuestToolSlowmode: () => {} };
    window.requestIdleCallback = () => 0;
  });

  const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = () => page.evaluate(() => window.__modelProof.snapshot());
  const assertPixels = (frame, label) => {
    assert.ok(frame.opaque > 30, `${label}: blank real WebGL canvas`);
    assert.ok(frame.colors > 4, `${label}: no shaded geometry pixels`);
  };
  const assertFramed = (frame, label) => {
    assertPixels(frame, label);
    assert.equal(frame.edgePixels, 0, `${label}: geometry touches canvas edges`);
    for (const [axis, value] of Object.entries(frame.projected)) assert.ok(Math.abs(value) < 1, `${label}: ${axis}=${value} clips real decoded vertices`);
  };
  const search = async assetPath => {
    await page.evaluate(assetPath => {
      window.FortniteAgent.searchDatabase = async () => ({ results: [{ path: `StaticMesh'${assetPath}'`, source: "live-model-proof", match: "exact" }], total: 1 });
      window.FortniteTools.open("assets");
      document.querySelector("#assetQuery").value = assetPath.split("/").at(-1);
      document.querySelector("#assetSearch").click();
    }, assetPath);
    await page.waitForFunction(() => {
      const card = document.querySelector(".asset-result-card");
      const button = card?.querySelector('[data-asset-action="model"]');
      return card?.dataset.assetClassified === "1" && button && !button.disabled;
    });
  };
  const waitFinalModel = async () => {
    await page.waitForFunction(() => {
      const proof = window.__modelProof;
      const last = proof.resolutions.at(-1), active = proof.active();
      return last?.error || document.querySelector('.asset-result-card .mesh-image-status[data-state="error"]') ||
        (last?.final?.manifest && active?.manifest === last.final.manifest && document.querySelector('.asset-result-card [data-asset-panel] [data-preview-state="live-3d"]'));
    }, null, { timeout: 180_000 });
    const error = await page.evaluate(() => window.__modelProof.resolutions.at(-1)?.error || document.querySelector('.asset-result-card .mesh-image-status[data-state="error"]')?.textContent);
    assert.ok(!error, `Real Mesh preview failed: ${error}`);
    await nextFrame();
  };

  for (const asset of selectedCases) {
    console.log(`MODEL_PROOF ${profile} ${asset.name}: search`);
    const resolutionStart = await page.evaluate(() => window.__modelProof.resolutions.length);
    await search(asset.path);
    const modelButton = page.locator('.asset-result-card [data-asset-action="model"]');
    const imageButton = page.locator('.asset-result-card [data-asset-action="preview"]');
    assert.equal(await modelButton.textContent(), "View 3D");
    assert.equal(await imageButton.textContent(), "View Image");
    assert.equal(await page.locator('.asset-result-card [data-asset-action="uefn"]').isVisible(), false, 'View 3D must replace the UEFN action for Mesh assets');
    await modelButton.click();
    console.log(`MODEL_PROOF ${profile} ${asset.name}: browser decode`);
    await waitFinalModel();
    const contract = await page.evaluate(() => {
      const record = window.__modelProof.resolutions.at(-1);
      const first = record.first, final = record.final, geometry = final.manifest.geometry;
      const positions = geometry.positions, indices = geometry.indices, uv0 = geometry.uv0;
      const vertices = positions.length / 3;
      const frames = final.manifest.materials.flatMap(material => material.baseColorFrame ? [material.baseColorFrame] : []);
      const frameBytes = frame => frame.pixels instanceof ArrayBuffer ? frame.pixels.byteLength : frame.pixels?.byteLength;
      const usedSlots = new Set(final.manifest.sections.filter(section => section.indexCount > 0).map(section => section.materialIndex));
      const card = document.querySelector(".asset-result-card");
      return {
        path: final.path, source: final.source, interactive: record.options.interactive, maxMaterialSize: record.options.maxMaterialSize,
        geometryReadyMs: record.geometryReadyMs, materialsReadyMs: record.materialsReadyMs,
        textureUploads: { ...window.__modelProof.active().controller.canvas.__modelProofTextures },
        vertexCount: vertices, indexCount: indices.length,
        finitePositions: Array.from(positions).every(Number.isFinite),
        validIndices: Array.from(indices).every(index => Number.isInteger(index) && index >= 0 && index < vertices),
        uvCount: uv0.length / 2, sameGeometry: first.manifest.geometry === final.manifest.geometry && geometry === record.geometry,
        sections: final.manifest.sections.map(section => ({ ...section })),
        materialCount: final.manifest.materials.length,
        runtimeStats: final.manifest.metadata.runtimeStats,
        unusedDecodedMaps: final.manifest.materials.filter((material, slot) => material.baseColorFrame && !usedSlots.has(slot)).length,
        rgbaFrames: frames.map(frame => ({ width: frame.width, height: frame.height, byteLength: frameBytes(frame) })),
        uniqueDecodedMaps: new Set(frames.map(frame => frame.pixels)).size,
        decodedTextureBytes: Array.from(new Set(frames.map(frame => frame.pixels))).reduce((sum, pixels) => sum + pixels.byteLength, 0),
        previewMode: final.previewMode, meta: card.querySelector(".mesh-image-meta")?.textContent,
        metaHidden: card.querySelector(".mesh-image-meta")?.hidden,
        metaLevel: card.querySelector(".mesh-image-meta")?.dataset.level,
        materialDiagnostics: final.materialDiagnostics || [],
        imageHidden: card.querySelector(".mesh-preview-image")?.hidden,
        controlsHidden: card.querySelector(".novasparx-viewer-controls")?.hidden,
        modelLabel: card.querySelector('[data-asset-action="model"]')?.textContent
      };
    });
    assert.equal(contract.source, "browser-wasm");
    assert.equal(contract.interactive, true);
    assert.equal(contract.maxMaterialSize, 2048);
    assert.ok(contract.decodedTextureBytes <= 64 * 1024 * 1024);
    assert.equal(contract.unusedDecodedMaps, 0, 'Runtime decoded maps unused by the current Mesh LOD');
    assert.ok(contract.vertexCount > 0 && contract.indexCount > 0 && contract.indexCount % 3 === 0);
    assert.equal(contract.finitePositions, true); assert.equal(contract.validIndices, true);
    assert.equal(contract.uvCount, contract.vertexCount); assert.equal(contract.sameGeometry, true);
    assert.ok(contract.sections.length > 0);
    for (const section of contract.sections) {
      assert.ok(section.firstIndex >= 0 && section.firstIndex + section.indexCount <= contract.indexCount);
      assert.ok(section.materialIndex >= 0 && section.materialIndex < contract.materialCount);
    }
    assert.equal(contract.imageHidden, true); assert.equal(contract.controlsHidden, false); assert.equal(contract.modelLabel, "Hide");
    assert.equal(contract.metaHidden, false, 'Model must expose material fidelity while keeping geometry visible');
    assert.match(contract.meta, /^Materials: /);
    assert.ok(contract.meta.length <= 180, 'Material status must stay concise beside the model controls');
    if (contract.materialDiagnostics.length || /partial|geometry-only/.test(contract.previewMode)) {
      assert.equal(contract.metaLevel, 'partial', 'Missing/unsupported slots must expose partial status');
      assert.ok(contract.indexCount >= 3, 'Partial materials must retain visible geometry');
      if (contract.materialDiagnostics.length) assert.match(contract.meta, /slot \d+: /);
    }
    if (asset.textured) assert.ok(contract.rgbaFrames.length > 0, `${asset.name}: actual browser Texture decode missing`);
    if (asset.name === 'multi') assert.ok(contract.uniqueDecodedMaps >= Number(process.env.FNAA_EXPECT_TEXTURE_MAPS || 2),
      'Multi-map proof needs at least two distinct decoded material maps');
    for (const frame of contract.rgbaFrames) assert.equal(frame.byteLength, frame.width * frame.height * 4);

    const initial = await snapshot();
    assertFramed(initial, asset.name);
    assert.equal(initial.perspective, true, 'Interactive view must have natural perspective depth');
    const initialView = await page.evaluate(() => window.__modelProof.active().controller.getView());
    assert.ok(initialView.yaw === 0 || initialView.yaw === -Math.PI / 2, 'Initial view must face a native axis instead of a diagonal');
    assert.ok(initialView.pitch === 0 || initialView.pitch === Math.PI / 2, 'Initial camera must be front or top instead of forced tilted');
    const ground = await page.evaluate(() => {
      const controller = window.__modelProof.active().controller;
      const { bounds } = controller;
      return { visible: controller.groundVisible, height: controller.groundHeight, bottom: -bounds.sizeZ / (2 * bounds.radius) };
    });
    assert.equal(ground.visible, true); assert.ok(Math.abs(ground.height - ground.bottom) < 0.003, 'Grid must be at the Mesh base');
    const canvas = page.locator('.asset-result-card canvas.novasparx-viewer-canvas');
    await canvas.screenshot({ path: path.join(output, `${asset.name}-initial.png`) });
    await page.locator('.asset-result-card .mesh-image-panel').screenshot({ path: path.join(output, `${asset.name}-controls.png`) });
    const resolution = await canvas.evaluate(element => ({ cssWidth: element.clientWidth, cssHeight: element.clientHeight, width: element.width, height: element.height, dpr: window.devicePixelRatio }));
    assert.ok(resolution.width * resolution.height <= 4 * 1024 * 1024);
    assert.ok(Math.abs(resolution.width / resolution.height - resolution.cssWidth / resolution.cssHeight) < 0.01, 'Framebuffer distorted the Mesh aspect ratio');
    assert.ok(resolution.width >= resolution.cssWidth * Math.min(2, resolution.dpr) - 2, 'Viewer lost high DPI sharpness');
    const view = () => page.evaluate(() => window.__modelProof.active().controller.getView());
    const stick = page.locator('[data-novasparx-stick]');
    assert.equal(await page.locator('[data-novasparx-orbit]').count(), 0);
    const stickBox = await stick.boundingBox();
    assert.ok(stickBox && stickBox.width >= 80 && stickBox.height >= 80);
    const center = { x: stickBox.x + stickBox.width / 2, y: stickBox.y + stickBox.height / 2 };
    const input = (type, point = center) => stick.dispatchEvent(type, { pointerId: 31, pointerType: setup.MOBILE_PROFILE ? 'touch' : 'mouse', isPrimary: true, clientX: point.x, clientY: point.y, button: 0, buttons: 1 });
    await input('pointerdown');
    await input('pointermove', { x: center.x + stickBox.width * 0.4, y: center.y - stickBox.height * 0.3 });
    const stickFrames = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        samples.push({ ...window.__modelProof.active().controller.getView(), time: performance.now() });
      }
      return samples;
    });
    assert.ok(stickFrames.at(-1).yaw > stickFrames[0].yaw && stickFrames.at(-1).pitch >= stickFrames[0].pitch, 'Stick did not continuously orbit the Mesh');
    if (initialView.pitch === 0) assert.ok(stickFrames.at(-1).pitch > stickFrames[0].pitch, 'Stick did not orbit upward');
    assert.ok(stickFrames.slice(1).filter((frame, index) => frame.yaw > stickFrames[index].yaw).length >= 8, 'Stick only moved on input events');
    for (let i = 1; i < stickFrames.length; i++) assert.ok(Math.abs(stickFrames[i].yaw - stickFrames[i - 1].yaw) < 0.15, 'Stick made a sudden rotation jump');
    await input('pointerup'); await nextFrame();
    const releasedView = await view(); await nextFrame();
    assert.deepEqual(await view(), releasedView, 'Stick kept moving after release');
    await stick.locator('[data-novasparx-stick-knob]').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const centeredKnob = await stick.locator('[data-novasparx-stick-knob]').evaluate(element => {
      const knob = element.getBoundingClientRect(), pad = element.parentElement.getBoundingClientRect();
      return { x: knob.x + knob.width / 2 - pad.x - pad.width / 2, y: knob.y + knob.height / 2 - pad.y - pad.height / 2 };
    });
    assert.ok(Math.hypot(centeredKnob.x, centeredKnob.y) < 1, 'Stick did not return to center');
    await input('pointerdown', { x: center.x - stickBox.width * 0.3, y: center.y });
    await nextFrame(); await input('pointercancel'); await nextFrame();
    const cancelledView = await view(); await nextFrame(); assert.deepEqual(await view(), cancelledView, 'Cancelled stick kept moving');
    await stick.focus(); await stick.press('ArrowLeft'); await nextFrame();
    const keyboardReleasedView = await view(); await nextFrame(); assert.deepEqual(await view(), keyboardReleasedView, 'Released keyboard stick kept moving');
    assertPixels(await snapshot(), `${asset.name} stick orbit`);
    await page.locator('[data-novasparx-reset]').click(); await nextFrame();
    const belowGround = await page.evaluate(async () => {
      const controller = window.__modelProof.active().controller;
      controller.rotateBy(0, -Math.PI / 2 - controller.getView().pitch);
      const hash = async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = controller.canvas, gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), byte => byte.toString(16).padStart(2, '0')).join('');
      };
      const visible = await hash();
      controller.setGroundVisible(false);
      const hidden = await hash();
      controller.setGroundVisible(true); controller.reset();
      return { visible, hidden };
    });
    assert.equal(belowGround.visible, belowGround.hidden, 'Ground underside must not hide the Mesh during downward orbit');
    await nextFrame();
    const slider = page.locator('[data-novasparx-zoom]');
    const assertZoomSync = async () => {
      const percent = Math.round((await view()).zoom * 100);
      assert.equal(await slider.inputValue(), String(percent));
      assert.equal(await page.locator('[data-novasparx-zoom-output]').textContent(), `${percent}%`);
      assert.equal(await slider.getAttribute('aria-valuetext'), `${percent}%`);
    };
    await slider.evaluate(element => { element.value = '135'; element.dispatchEvent(new Event('input', { bubbles: true })); }); await nextFrame();
    assert.equal((await view()).zoom, 1.35); await assertZoomSync();
    assert.notEqual((await snapshot()).sha256, initial.sha256, 'Zoom slider did not change real Mesh pixels');
    await slider.press('ArrowRight'); await nextFrame(); await assertZoomSync();
    await page.locator('[data-novasparx-reset]').click(); await nextFrame(); await assertZoomSync();
    // Dispatch the same pointer/wheel events used by browser input. Mobile
    // profiles also exercise the viewer's two-touch pinch/pan handlers below.
    await canvas.dispatchEvent("pointerdown", { pointerId: 11, pointerType: setup.MOBILE_PROFILE ? "touch" : "mouse", clientX: 150, clientY: 150, button: 0, buttons: 1 });
    await canvas.dispatchEvent("pointermove", { pointerId: 11, pointerType: setup.MOBILE_PROFILE ? "touch" : "mouse", clientX: 197, clientY: 170, button: 0, buttons: 1 });
    await canvas.dispatchEvent("pointerup", { pointerId: 11, clientX: 197, clientY: 170 });
    await nextFrame();
    const rotated = await snapshot(); assertPixels(rotated, `${asset.name} rotated`); assert.notEqual(rotated.sha256, initial.sha256, "Orbit did not change real Mesh pixels");
    await canvas.screenshot({ path: path.join(output, `${asset.name}-rotated.png`) });
    await canvas.dispatchEvent("wheel", { deltaY: -130 }); await nextFrame();
    const zoomed = await snapshot(); assertPixels(zoomed, `${asset.name} zoomed`); assert.notEqual(zoomed.sha256, rotated.sha256, "Zoom did not change real Mesh pixels");
    await assertZoomSync();
    await canvas.dispatchEvent("pointerdown", { pointerId: 12, clientX: 150, clientY: 150, button: 2, buttons: 2 });
    await canvas.dispatchEvent("pointermove", { pointerId: 12, clientX: 168, clientY: 159, button: 2, buttons: 2 });
    await canvas.dispatchEvent("pointerup", { pointerId: 12, clientX: 168, clientY: 159 }); await nextFrame();
    const panned = await snapshot(); assertPixels(panned, `${asset.name} panned`); assert.notEqual(panned.sha256, zoomed.sha256, "Pan did not change real Mesh pixels");
    await canvas.screenshot({ path: path.join(output, `${asset.name}-panned.png`) });
    if (setup.MOBILE_PROFILE) {
      for (const [id, x] of [[21, 100], [22, 190]]) await canvas.dispatchEvent("pointerdown", { pointerId: id, pointerType: "touch", clientX: x, clientY: 160, button: 0, buttons: 1 });
      await canvas.dispatchEvent("pointermove", { pointerId: 21, pointerType: "touch", clientX: 101, clientY: 160, buttons: 1 });
      await canvas.dispatchEvent("pointermove", { pointerId: 22, pointerType: "touch", clientX: 219, clientY: 171, buttons: 1 });
      for (const id of [21, 22]) await canvas.dispatchEvent("pointerup", { pointerId: id, pointerType: "touch" });
      await nextFrame();
      assert.notEqual((await snapshot()).sha256, panned.sha256, "Two-touch gesture did not change Mesh pixels");
      await assertZoomSync();
    }
    await page.evaluate(() => window.__modelProof.active().controller.reset()); await nextFrame();
    await assertZoomSync();
    assertFramed(await snapshot(), `${asset.name} reset`);
    await canvas.dispatchEvent('pointerdown', { pointerId: 13, clientX: 100, clientY: 100, button: 2, buttons: 2 });
    await canvas.dispatchEvent('pointermove', { pointerId: 13, clientX: 100000, clientY: 100000, button: 2, buttons: 2 });
    await canvas.dispatchEvent('pointerup', { pointerId: 13 }); await nextFrame();
    assertPixels(await snapshot(), `${asset.name} bounded pan`);
    await page.locator('[data-novasparx-reset]').click(); await nextFrame();

    const auxiliary = await page.evaluate(async () => {
      const proof = window.__modelProof, current = proof.active();
      const original = await proof.snapshot(current);
      const rect = current.host.getBoundingClientRect();
      const host = document.createElement("div");
      host.style.cssText = `position:fixed;left:0;top:0;width:${rect.width}px;height:${rect.height}px;`;
      document.body.append(host);
      const measurements = {};
      const measure = async (name, manifest) => {
        const controller = await window.NovaSparxRenderer.mount(manifest, host);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const record = proof.mounts.at(-1);
        measurements[name] = await proof.snapshot(record);
        controller.dispose();
      };
      const manifest = current.manifest;
      await measure("fallback", { ...manifest, materials: manifest.materials.map(({ baseColorFrame, baseColorTexture, ...material }) => material) });
      for (const factor of [0.001, 1000]) await measure(String(factor), { ...manifest, geometry: { ...manifest.geometry, positions: Float32Array.from(manifest.geometry.positions, value => value * factor) } });
      host.style.width = "220px"; host.style.height = "640px";
      await measure("portrait", manifest);
      host.remove();
      return { original, ...measurements };
    });
    assertFramed(auxiliary.portrait, `${asset.name} tall portrait`);
    for (const factor of ["0.001", "1000"]) {
      assertFramed(auxiliary[factor], `${asset.name} scale ${factor}`);
      for (const axis of Object.keys(initial.projected)) assert.ok(Math.abs(auxiliary[factor].projected[axis] - auxiliary.original.projected[axis]) < 0.002, `${asset.name} scale-dependent ${axis}`);
    }
    if (contract.rgbaFrames.length) {
      assert.equal(initial.textured, true); assert.equal(auxiliary.fallback.textured, false);
      assert.notEqual(auxiliary.original.sha256, auxiliary.fallback.sha256, "Decoded material Texture made no visible pixel difference");
    }

    // A real view switch uses the same decoded Mesh and final RGBA materials.
    await imageButton.click();
    await page.waitForFunction(() => { const image = document.querySelector('.asset-result-card .mesh-preview-image'); return image && !image.hidden && image.complete && image.naturalWidth > 0; });
    const meshImage = await page.evaluate(() => {
      const image = document.querySelector('.asset-result-card .mesh-preview-image');
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.equal(meshImage.width, await page.evaluate(() => window.NovaSparxBrowserGuard.renderPolicy(window.__modelProof.resolutions.at(-1).final.manifest).size), 'Mesh image did not use the existing device quality policy');
    assert.equal(await page.locator('.asset-result-card canvas').count(), 0, "Image switch leaked live canvas");
    await modelButton.click(); await waitFinalModel();
    assert.equal(await page.evaluate(() => window.__modelProof.resolutions.length), resolutionStart + 1, "Image/model switch reparsed the same asset");
    assertFramed(await snapshot(), `${asset.name} reopened`);

    // A rapid pair of real card actions leaves only the latest Model request.
    // The first Image completion must not overwrite or release its live canvas.
    await page.evaluate(() => {
      const card = document.querySelector('.asset-result-card');
      card.querySelector('[data-asset-action="preview"]').click();
      card.querySelector('[data-asset-action="model"]').click();
    });
    await waitFinalModel();
    await nextFrame();
    const latest = await page.evaluate(() => ({
      canvases: document.querySelectorAll('.asset-result-card canvas').length,
      activeMounts: window.__modelProof.mounts.filter(record => !record.disposed).length,
      modelLabel: document.querySelector('.asset-result-card [data-asset-action="model"]')?.textContent,
      imageHidden: document.querySelector('.asset-result-card .mesh-preview-image')?.hidden,
      resolves: window.__modelProof.resolutions.length
    }));
    assert.equal(latest.canvases, 1); assert.equal(latest.activeMounts, 1);
    assert.equal(latest.modelLabel, "Hide"); assert.equal(latest.imageHidden, true);
    assert.equal(latest.resolves, resolutionStart + 1, "Latest action reparsed the same asset");

    // Resize the actual panel after mount; the ResizeObserver must retain all
    // decoded vertices in the viewport, including portrait dimensions.
    await page.evaluate(() => {
      const host = window.__modelProof.active().host;
      host.style.width = "220px"; host.style.height = "640px";
      host.style.minHeight = "640px"; host.style.maxHeight = "none";
    });
    await page.waitForFunction(() => { const { canvas } = window.__modelProof.active().controller; return canvas.height / canvas.width > 2; });
    await nextFrame();
    const resized = await snapshot(); assertFramed(resized, `${asset.name} resized portrait`);
    await page.locator('.asset-result-card canvas').screenshot({ path: path.join(output, `${asset.name}-portrait.png`) });
    await page.evaluate(() => {
      const stick = document.querySelector('[data-novasparx-stick]'), rect = stick.getBoundingClientRect();
      window.__heldClosingController = window.__modelProof.active().controller;
      stick.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 32, pointerType: 'touch', isPrimary: true, clientX: rect.x + rect.width * 0.8, clientY: rect.y + rect.height / 2, button: 0, buttons: 1, bubbles: true }));
    });
    await nextFrame();
    await modelButton.click(); await nextFrame();
    const disposedView = await page.evaluate(() => window.__heldClosingController.getView()); await nextFrame();
    assert.deepEqual(await page.evaluate(() => window.__heldClosingController.getView()), disposedView, 'Closed viewer kept a held stick animation alive');
    const closed = await page.evaluate(() => ({
      canvases: document.querySelectorAll('.asset-result-card canvas').length,
      activeMounts: window.__modelProof.mounts.filter(record => !record.disposed).length,
      retainedResult: window.__modelProof.resolutions.at(-1).first?.manifest,
      retainedFinal: window.__modelProof.resolutions.at(-1).final?.manifest,
      label: document.querySelector('.asset-result-card [data-asset-action="model"]')?.textContent
    }));
    assert.equal(closed.canvases, 0); assert.equal(closed.activeMounts, 0);
    assert.equal(closed.retainedResult, null); assert.equal(closed.retainedFinal, null);
    assert.equal(closed.label, "View 3D");
    proof.meshes.push({ name: asset.name, contract, resolution, initialView, ground, belowGround, stickFrames, initial, rotated, zoomed, panned, auxiliary, meshImage, latest, resized, closed });
    console.log("FNAA_REAL_INTERACTIVE_MODEL_PROVEN", JSON.stringify({ profile, name: asset.name, vertices: contract.vertexCount, triangles: contract.indexCount / 3, rgbaFrames: contract.rgbaFrames.length, projected: initial.projected, screenshots: output }));
  }

  if (selection === "all") {
    // One existing live Texture proves the separate image action still uses
    // browser CUE4Parse after the new Mesh action and lifecycle transitions.
    await page.evaluate(texturePath => {
      window.FortniteAgent.searchDatabase = async () => ({ results: [{ path: texturePath, source: "live-texture-proof", match: "exact" }], total: 1 });
      window.FortniteTools.open("assets"); document.querySelector("#assetQuery").value = "SoftGlow"; document.querySelector("#assetSearch").click();
    }, texturePath);
    await page.waitForFunction(() => document.querySelector('.asset-result-card')?.dataset.assetKind === "texture" && !document.querySelector('.asset-result-card [data-asset-action="preview"]').disabled);
    const textureButton = page.locator('.asset-result-card [data-asset-action="preview"]');
    assert.equal(await textureButton.textContent(), "View Image"); await textureButton.click();
    await page.waitForFunction(() => { const image = document.querySelector('.asset-result-card .mesh-preview-image'); return image && !image.hidden && image.complete && image.naturalWidth > 0; });
    proof.texture = await page.evaluate(() => { const card = document.querySelector('.asset-result-card'), image = card.querySelector('.mesh-preview-image'); return { width: image.naturalWidth, height: image.naturalHeight, src: image.src, meta: card.querySelector('.mesh-image-meta')?.textContent, canvasCount: card.querySelectorAll('canvas').length }; });
    assert.ok(proof.texture.src.startsWith("blob:")); assert.match(proof.texture.meta, /browser CUE4Parse/i); assert.equal(proof.texture.canvasCount, 0);
  }
  if (process.env.FNAA_MODEL_PROOF_AUDIO === '1') {
    proof.audio = await page.evaluate(async () => {
      const path = 'FortniteGame/Plugins/GameFeatures/Train/Content/Sound/Waves/Locomotion/S28/Train_Proto_Bells_Close.uasset';
      const startedAt = performance.now();
      const result = await window.NovaSparxTextureRuntime.resolveAudio(path);
      const context = new (window.AudioContext || window.webkitAudioContext)();
      try {
        const buffer = await context.decodeAudioData(result.bytes.slice(0));
        return { path: result.path, source: result.source, format: result.format, bytes: result.bytes.byteLength,
          duration: buffer.duration, channels: buffer.numberOfChannels, readyMs: Math.round(performance.now() - startedAt) };
      } finally { await context.close(); }
    });
    assert.equal(proof.audio.source, 'browser-wasm');
    assert.ok(proof.audio.bytes > 12 && proof.audio.duration > 0 && proof.audio.channels > 0, 'Real sound was not browser-decodable');
    console.log('FNAA_REAL_AUDIO_PROVEN', JSON.stringify(proof.audio));
  }
  proof.network = setup.counters();
  assert.equal(proof.network.legacyTextureRequests, 0, "Hosted legacy Texture decode was used");
  assert.ok(proof.network.chunkRelayRequests > 0 && proof.network.chunkRelayBytes > 0, "Real Fortnite BuildPatch bytes were not fetched");
  assert.equal(proof.console.filter(line => line.startsWith("PAGE_ERROR")).length, 0, "Unhandled browser error");
  fs.writeFileSync(path.join(output, "proof.json"), JSON.stringify(proof, null, 2));
  console.log("FNAA_MODEL_BROWSER_PROOF_PASSED", JSON.stringify({ profile, cases: proof.meshes.map(mesh => mesh.name), output }));
} catch (error) {
  proof.error = String(error?.stack || error);
  if (page) {
    proof.failureState = await page.evaluate(() => ({
      status: document.querySelector('.mesh-image-status')?.textContent,
      meta: document.querySelector('.mesh-image-meta')?.textContent,
      kind: document.querySelector('.asset-result-card')?.dataset.assetKind,
      resolutions: window.__modelProof?.resolutions.map(record => ({ path: record.path, error: record.error, first: !!record.first, final: !!record.final })),
      mounts: window.__modelProof?.mounts.map(record => ({ path: record.manifest.path, disposed: record.disposed, connected: record.controller.canvas.isConnected }))
    })).catch(() => null);
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  fs.writeFileSync(path.join(output, "proof-failed.json"), JSON.stringify(proof, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => setup.server.close(resolve));
}
