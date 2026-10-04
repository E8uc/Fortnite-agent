import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// Read-only production proof: no routes, local byte relay, response rewriting,
// fixture results, or browser security overrides. TLS uses the browser CA store.
// PLAYWRIGHT_BROWSERS_PATH=... FNAA_PROOF_OUTPUT_DIR=... node <this file>
// In a managed environment, HTTPS_PROXY is passed to Chromium unchanged.
const site = new URL(process.env.FNAA_PRODUCTION_URL || "https://e8uc.github.io/Fortnite-agent/");
assert.equal(site.protocol, "https:", "Production smoke requires HTTPS");
const dataPin = JSON.parse(fs.readFileSync(new URL("../novasparx-data.json", import.meta.url)));
const runtimePin = JSON.parse(fs.readFileSync(new URL("../novasparx-runtime.json", import.meta.url)));
const expected = {
  fortniteBuild: process.env.FNAA_EXPECTED_BUILD || dataPin.fortniteBuild,
  runtimeSourceRevision: process.env.FNAA_EXPECTED_RUNTIME_REVISION || runtimePin.sourceRevision,
  dataManifestSha256: process.env.FNAA_EXPECTED_DATA_SHA256 || dataPin.sha256
};
const assetPath = "FortniteGame/Content/Environments/Apollo/Props/LazyLakeSign/Mesh/SM_LazyLakeLodge_Sign.uasset";
const output = path.resolve(process.env.FNAA_PROOF_OUTPUT_DIR || "fnaa-production-smoke");
fs.mkdirSync(output, { recursive: true });
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxy = proxyUrl ? new URL(proxyUrl) : null;
const proof = {
  site: site.href, expected, assetPath, startedAt: new Date().toISOString(),
  profile: "chromium-desktop", physicalDevice: false,
  transport: "normal browser CORS and TLS; no interception or security overrides",
  fidelityScope: "Native base-color/value preview; Unreal shader evaluation is not reproduced.",
  checks: [], responses: [], requestFailures: [], console: []
};
let browser, page, stage = "browser-start", apiOrigin;
const responseTasks = [];
const check = (condition, message, category) => {
  if (!condition) throw Object.assign(new Error(message), { category });
  proof.checks.push(message);
};
const relevant = url => url.startsWith(site.href) || (apiOrigin && url.startsWith(apiOrigin)) || /dilly(?:apis|cdn)\.com/.test(url);

try {
  browser = await chromium.launch({ headless: true, ...(proxy && { proxy: {
    server: proxy.origin,
    ...(proxy.username && { username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password) })
  } }) });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  page.on("console", message => {
    if (proof.console.length < 80 && ["error", "warning"].includes(message.type())) proof.console.push(message.text());
  });
  page.on("pageerror", error => proof.console.push(`PAGE_ERROR ${error.message}`));
  page.on("requestfailed", request => {
    if (relevant(request.url())) proof.requestFailures.push({ url: request.url(), error: request.failure()?.errorText });
  });
  page.on("response", response => {
    if (!relevant(response.url()) || proof.responses.length >= 500) return;
    const headers = response.headers();
    const record = { url: response.url(), status: response.status(),
      acao: headers["access-control-allow-origin"], contentRange: headers["content-range"] };
    proof.responses.push(record);
    if (/\/nova-edge\/(?:range|chunk)(?:\/|\?)/.test(response.url()) && response.ok()) {
      responseTasks.push(response.finished().then(() => response.request().sizes())
        .then(sizes => { record.responseBodyBytes = sizes.responseBodySize; }).catch(() => {}));
    }
    if (response.status() >= 400) responseTasks.push(response.text()
      .then(body => { record.errorBody = body.slice(0, 1000); }).catch(() => {}));
  });

  stage = "deployment";
  const navigation = await page.goto(site.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check(navigation?.ok(), `Production document HTTP ${navigation?.status()}`, "deployment");
  await page.waitForFunction(() => window.FNAA_CONFIG && window.FortniteTools && window.NovaSparxTextureRuntime && window.NovaSparxRenderer);
  apiOrigin = await page.evaluate(() => window.FNAA_CONFIG.apiEndpoint);
  check(new URL(apiOrigin).protocol === "https:", "Production Cloudflare API uses HTTPS", "deployment");
  proof.apiEndpoint = apiOrigin;
  // fetch() runs in the page, so a cross-origin result must satisfy real CORS.
  const release = await page.evaluate(async () => {
    const response = await fetch("novasparx-runtime/release.json", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Runtime release descriptor HTTP ${response.status}`);
    return response.json();
  });
  proof.release = release;
  check(release.schema === "fnaa.browser-release.v1", "Deployed release schema matches", "deployment");
  for (const [key, value] of Object.entries(expected)) check(release[key] === value,
    `Deployed ${key}: expected ${value}, received ${release[key]}`, "deployment");
  const builds = await page.evaluate(async () => Promise.all([
    "location-index/manifest.json", "studio-location-index/manifest.json", "package-id-index/manifest.json"
  ].map(async name => {
    const response = await fetch(`novasparx-runtime/${name}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    const value = await response.json();
    return { name, fortniteBuild: value.fortniteVersion || value.fortniteBuild };
  })));
  proof.indexBuilds = builds;
  for (const index of builds) check(index.fortniteBuild === release.fortniteBuild,
    `${index.name} agrees with the deployed build`, "deployment");

  stage = "cloudflare-bootstrap";
  const bootstrap = await page.evaluate(async endpoint => {
    const response = await fetch(`${endpoint}/nova-edge/bootstrap`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const value = await response.json();
    return { status: response.status, schema: value.schema, aesOk: value.aes?.ok,
      manifestOk: value.manifest?.ok, transport: value.transport, error: value.error };
  }, apiOrigin);
  proof.bootstrap = bootstrap;
  check(bootstrap.status === 200 && bootstrap.schema === "novasparx.edge-bootstrap.v1",
    `Cloudflare bootstrap is readable with real CORS (HTTP ${bootstrap.status})`, "cloudflare");
  check(bootstrap.aesOk === true && bootstrap.manifestOk === true,
    "Cloudflare bootstrap can read Dilly AES and manifest metadata", "upstream");

  stage = "search";
  if (await page.locator("#loginGuest").isVisible()) await page.locator("#loginGuest").click();
  // Only observe pass-through calls; results, geometry, materials and rendering
  // remain the production implementation and bytes from its normal transport.
  await page.evaluate(() => {
    const observation = window.__productionSmoke = { resolutions: [], mounts: [] };
    const runtime = window.NovaSparxTextureRuntime;
    window.NovaSparxTextureRuntime = { ...runtime, async resolveMeshImage(...args) {
      const record = { startedAt: performance.now() };
      observation.resolutions.push(record);
      try {
        const result = await runtime.resolveMeshImage(...args);
        record.first = result;
        Promise.resolve(result.materialPromise || result).then(final => {
          record.final = final; record.readyMs = Math.round(performance.now() - record.startedAt);
        }, error => { record.error = String(error); });
        return result;
      } catch (error) { record.error = String(error); throw error; }
    } };
    const renderer = window.NovaSparxRenderer;
    window.NovaSparxRenderer = { ...renderer, async mount(...args) {
      const controller = await renderer.mount(...args);
      observation.mounts.push({ manifest: args[0], controller });
      return controller;
    } };
    window.FortniteTools.open("assets");
  });
  await page.locator("#assetQuery").fill("SM_LazyLakeLodge_Sign");
  await page.locator("#assetSearch").click();
  const card = page.locator(".asset-result-card").filter({ hasText: assetPath });
  await card.waitFor();
  await card.locator('[data-asset-action="model"]:not([disabled])').waitFor();
  check(await card.count() === 1, "Real deployed search found the exact Lazy Lake mesh");
  await card.locator('[data-asset-action="model"]').click();

  stage = "native-preview";
  await page.waitForFunction(() => {
    const observation = window.__productionSmoke, result = observation.resolutions.at(-1);
    return result?.error || document.querySelector('.mesh-image-status[data-state="error"]') ||
      (result?.final?.manifest && observation.mounts.some(item =>
        item.manifest === result.final.manifest && item.controller.canvas.isConnected));
  }, null, { timeout: 240_000 });
  const result = await page.evaluate(async () => {
    const observation = window.__productionSmoke, record = observation.resolutions.at(-1);
    const error = record?.error || document.querySelector('.mesh-image-status[data-state="error"]')?.textContent;
    if (error) return { error };
    const final = record.final, active = observation.mounts.findLast(item => item.controller.canvas.isConnected);
    const { controller, manifest } = active, canvas = controller.canvas;
    const frames = final.manifest.materials.flatMap(material => material.baseColorFrame ? [material.baseColorFrame] : []);
    // Disable the ground through the public controller while measuring, so a
    // grid cannot pass the generated-mesh pixel assertion.
    const groundVisible = controller.groundVisible;
    controller.setGroundVisible(false);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let opaque = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 8) {
      opaque++; if (colors.size < 512) colors.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
    }
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    controller.setGroundVisible(groundVisible);
    return { path: final.path, source: final.source, readyMs: record.readyMs,
      vertexCount: manifest.geometry.positions.length / 3, triangleCount: manifest.geometry.indices.length / 3,
      textured: controller.textured, fidelity: final.materialFidelity || final.previewMode || manifest.metadata?.materialFidelity,
      missingMaterials: final.missingMaterials,
      rgbaFrames: frames.map(frame => ({ width: frame.width, height: frame.height, bytes: frame.pixels.byteLength })),
      pixels: { width: canvas.width, height: canvas.height, opaque, colors: colors.size, sha256 },
      uiState: document.querySelector('[data-preview-state="live-3d"]')?.dataset.previewState };
  });
  proof.result = result;
  check(!result.error, `Native Lazy Lake preview completed${result.error ? `: ${result.error}` : ""}`);
  check(result.source === "browser-wasm" && result.path?.toLowerCase() === assetPath.toLowerCase(), "Lazy Lake is decoded by production browser WASM");
  check(result.vertexCount > 0 && result.triangleCount > 0, "Real native geometry is present");
  check(result.textured && result.rgbaFrames.length > 0, "Real native base-color texture frames are applied");
  check(result.rgbaFrames.every(frame => frame.bytes === frame.width * frame.height * 4), "Decoded frames contain complete RGBA pixels");
  check(/^base-color-(preview|partial)$/.test(result.fidelity), `Material fidelity is reported honestly: ${result.fidelity}`);
  check(result.pixels.opaque > 30 && result.pixels.colors > 4, "Mesh-only WebGL framebuffer contains generated shaded pixels");
  check(result.uiState === "live-3d", "Production UI displays the live 3D result");
  await Promise.allSettled(responseTasks);
  const relays = proof.responses.filter(response => response.url.startsWith(`${apiOrigin}/nova-edge/`) &&
    /\/(?:range|chunk)(?:\/|\?)/.test(new URL(response.url).pathname + new URL(response.url).search));
  check(relays.some(response => (response.status === 200 || response.status === 206) && response.responseBodyBytes > 0),
    "Actual Cloudflare range/chunk relay returned a nonempty browser response body");
  check(proof.responses.some(response => /\/novasparx-runtime\/.*\.wasm(?:\?|$)/.test(response.url) && response.status === 200),
    "Deployed WASM runtime loaded successfully", "deployment");
  await card.screenshot({ path: path.join(output, "lazy-lake.png") });
  proof.status = "passed";
} catch (error) {
  await Promise.allSettled(responseTasks);
  const runtimeFailure = proof.responses.find(response => response.status >= 400 &&
    response.url.startsWith(new URL("novasparx-runtime/", site).href)) ||
    proof.requestFailures.find(request => request.url.startsWith(new URL("novasparx-runtime/", site).href));
  const failedResponse = proof.responses.findLast(response => response.status >= 400 &&
    (/\/nova-edge\/(range|chunk|manifest)/.test(response.url) || /dilly(?:apis|cdn)\.com/.test(response.url)));
  let category = error.category;
  if (!category && /ERR_CERT|ERR_PROXY|ERR_TUNNEL|ENOTFOUND/.test(String(error))) category = "environment";
  if (!category && /CORS policy|cross-origin/i.test(proof.console.join("\n"))) category = "cors";
  if (!category && runtimeFailure) category = "deployment";
  if (!category && failedResponse && (/dilly(?:apis|cdn)\.com/.test(new URL(failedResponse.url).hostname) ||
    /upstream|AES.*unavailable|manifest.*unavailable/i.test(failedResponse.errorBody || ""))) category = "upstream";
  if (!category && failedResponse?.url.startsWith(apiOrigin)) category = "cloudflare";
  category ||= stage === "deployment" ? "deployment" : stage === "cloudflare-bootstrap" ? "cloudflare" : "app";
  proof.status = "failed";
  proof.failure = { category, stage, message: error.message, response: runtimeFailure || failedResponse,
    action: {
      environment: "Check browser proxy and CA trust; keep TLS and browser security enabled.",
      deployment: "Check Pages release identity and assembled runtime/index files against the selected pins.",
      cloudflare: "Check the deployed Cloudflare bootstrap endpoint and its configuration/status.",
      cors: "Check actual response CORS headers for the Pages origin on the failing endpoint.",
      upstream: "Check Dilly availability/AES/build metadata and Cloudflare upstream error details before changing the app.",
      app: "Inspect production preview/search errors and the request evidence; run isolated parser correctness tests separately."
    }[category] };
  if (page) {
    proof.uiFailure = await page.locator("#assetResults").innerText().catch(() => null);
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await Promise.allSettled(responseTasks);
  proof.finishedAt = new Date().toISOString();
  fs.rmSync(path.join(output, proof.status === "passed" ? "failure.png" : "lazy-lake.png"), { force: true });
  fs.writeFileSync(path.join(output, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  await browser?.close();
  console.log(JSON.stringify({ status: proof.status, output, failure: proof.failure,
    release: proof.release?.fortniteBuild, pixels: proof.result?.pixels, fidelity: proof.result?.fidelity }));
}
