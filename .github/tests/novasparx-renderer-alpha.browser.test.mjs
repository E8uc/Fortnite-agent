import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

// Compile and draw the production shader. No live asset or network IO is needed.
const source = fs.readFileSync(new URL("../../Fortnite-Ai-Agent-GitHub-Cloudflare/novasparx-renderer.js", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  await page.addScriptTag({ content: source });
  const results = await page.evaluate(async () => {
    const cases = [
      { name: "opaque-low-opacity", opacityMode: "opaque", opacity: 0.15, baseAlpha: 1, textureAlpha: 255 },
      { name: "opaque-zero-alpha", opacityMode: "opaque", opacity: 0, baseAlpha: 0, textureAlpha: 0 },
      { name: "masked-below-cutoff", opacityMode: "masked", opacity: 0.15, baseAlpha: 1, textureAlpha: 255 },
      { name: "masked-visible", opacityMode: "masked", opacity: 0.75, baseAlpha: 1, textureAlpha: 255 },
      { name: "translucent-half", opacityMode: "translucent", opacity: 0.5, baseAlpha: 1, textureAlpha: 255 },
      { name: "translucent-zero-texture-alpha", opacityMode: "translucent", opacity: 1, baseAlpha: 1, textureAlpha: 0 }
    ];
    const results = [];
    for (const test of cases) {
      const host = document.createElement("div");
      host.style.cssText = "width:320px;height:240px";
      document.body.append(host);
      const manifest = {
        geometry: {
          positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          uv0: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
        },
        sections: [{ firstIndex: 0, indexCount: 6, materialIndex: 0 }],
        materials: [{
          baseColor: [1, 1, 1, test.baseAlpha], opacity: test.opacity,
          opacityMode: test.opacityMode, opacityCutoff: 0.333,
          baseColorFrame: { width: 1, height: 1,
            pixels: new Uint8Array([200, 140, 100, test.textureAlpha]).buffer }
        }]
      };
      const controller = await window.NovaSparxRenderer.mount(manifest, host, { ground: false });
      try {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = controller.canvas;
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0, maxAlpha = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i]) count++;
          maxAlpha = Math.max(maxAlpha, pixels[i]);
        }
        results.push({ name: test.name, count, maxAlpha });
      } finally {
        controller.dispose();
        host.remove();
      }
    }
    return results;
  });
  const byName = Object.fromEntries(results.map(result => [result.name, result]));
  for (const name of ["opaque-low-opacity", "opaque-zero-alpha"]) {
    assert.ok(byName[name].count > 100, `${name}: opaque geometry must remain visible`);
    assert.equal(byName[name].maxAlpha, 255, `${name}: alpha inputs cannot fade opaque materials`);
  }
  assert.equal(byName["masked-below-cutoff"].count, 0, "Masked opacity below its cutoff must discard pixels");
  assert.ok(byName["masked-visible"].count > 100, "Masked opacity above its cutoff must remain visible");
  assert.ok(byName["masked-visible"].maxAlpha > 0 && byName["masked-visible"].maxAlpha < 255,
    "Masked alpha must retain its existing behavior");
  assert.ok(byName["translucent-half"].count > 100, "Translucent geometry must remain visible");
  assert.ok(byName["translucent-half"].maxAlpha > 0 && byName["translucent-half"].maxAlpha < 255,
    "Translucent opacity must remain effective");
  assert.equal(byName["translucent-zero-texture-alpha"].count, 0, "Translucent texture alpha must remain effective");
  console.log("Renderer alpha modes: " + JSON.stringify(results));
} finally {
  await browser.close();
}
