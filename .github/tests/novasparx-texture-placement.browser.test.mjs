import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const engine = process.env.FNAA_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const profile = process.env.FNAA_MOBILE_PROFILE;
const options = profile === 'ios' ? devices['iPhone 13'] : profile === 'android' ? devices['Pixel 5'] : {};
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage(options);
  await page.setContent('<html><body></body></html>');
  const corners = [255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255];
  const png = await page.evaluate(pixels => {
    const image = document.createElement('canvas'); image.width = image.height = 2;
    image.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), 2, 2), 0, 0);
    return image.toDataURL('image/png');
  }, corners);
  const bitmapUrl = 'https://textures.example.test/native-uv.png';
  await page.route(bitmapUrl, route => route.fulfill({
    contentType: 'image/png', body: Buffer.from(png.split(',')[1], 'base64')
  }));
  await page.addScriptTag({ content: fs.readFileSync(new URL('../../Fortnite-Ai-Agent-GitHub-Cloudflare/novasparx-renderer.js', import.meta.url), 'utf8') });
  const results = await page.evaluate(async ({ corners, png, bitmapUrl }) => {
    // Native Unreal V=0 refers to the first decoded image row. An asymmetric
    // image exposes vertical inversion that a solid or symmetric texture hides.
    const pixels = new Uint8Array(corners);
    const originalBitmap = window.createImageBitmap;
    const results = [];
    for (const input of ['rgba', 'bitmap', 'html']) {
      let bitmapCalls = 0, bitmapDecodes = 0;
      if (input === 'bitmap') window.createImageBitmap = async (...args) => {
        bitmapCalls++;
        const bitmap = await originalBitmap.apply(window, args);
        bitmapDecodes++;
        return bitmap;
      };
      if (input === 'html') window.createImageBitmap = undefined;
      const host = document.createElement('div'); host.style.cssText = 'width:320px;height:240px'; document.body.append(host);
      const material = { roughness: 1, metallic: 0, specular: 0 };
      if (input === 'rgba') material.baseColorFrame = { width: 2, height: 2, pixels: pixels.buffer };
      else material.baseColorTexture = input === 'bitmap' ? bitmapUrl : png;
      const manifest = {
        geometry: {
          positions: new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]),
          indices: new Uint32Array([0,1,2, 0,2,3]),
          uv0: new Float32Array([0,1, 1,1, 1,0, 0,0])
        }, sections: [{ firstIndex: 0, indexCount: 6, materialIndex: 0 }], materials: [material]
      };
      const matrices = new WeakMap();
      const undo = [];
      for (const Type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
        const proto = Type.prototype, location = proto.getUniformLocation, matrix = proto.uniformMatrix4fv;
        const names = new WeakMap();
        proto.getUniformLocation = function(program, name) { const value = location.call(this, program, name); if (value) names.set(value, name); return value; };
        proto.uniformMatrix4fv = function(value, transpose, data) { if (names.get(value) === 'uMVP') matrices.set(this.canvas, Array.from(data)); return matrix.call(this, value, transpose, data); };
        undo.push(() => { proto.getUniformLocation = location; proto.uniformMatrix4fv = matrix; });
      }
      let controller;
      try {
        controller = await window.NovaSparxRenderer.mount(manifest, host, { ground: false });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const canvas = controller.canvas, gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const m = matrices.get(canvas), samples = [];
        for (const [x,y] of [[-.5,.5],[.5,.5],[-.5,-.5],[.5,-.5]]) {
          const w = m[3]*x+m[7]*y+m[15];
          const px = Math.floor(((m[0]*x+m[4]*y+m[12])/w+1)*canvas.width/2);
          const py = Math.floor(((m[1]*x+m[5]*y+m[13])/w+1)*canvas.height/2);
          const pixel = new Uint8Array(4); gl.readPixels(px,py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel); samples.push(Array.from(pixel));
        }
        results.push({ input, textured: controller.textured, bitmapCalls, bitmapDecodes, samples });
      } finally {
        controller?.dispose(); host.remove(); undo.forEach(fn => fn()); window.createImageBitmap = originalBitmap;
      }
    }
    return results;
  }, { corners, png, bitmapUrl });
  for (const { input, textured, bitmapCalls, bitmapDecodes, samples: [red,green,blue,yellow] } of results) {
    assert.equal(textured, true, input + ': production texture loader must succeed');
    assert.equal(bitmapCalls, input === 'bitmap' ? 1 : 0, input + ': expected native image decoder branch must run');
    assert.equal(bitmapDecodes, input === 'bitmap' ? 1 : 0, input + ': native bitmap decode cannot silently fall back to HTML');
    assert.ok(red[0] > red[1]*2 && red[0] > red[2]*2, input + ': native UV top-left must sample first-row red');
    assert.ok(green[1] > green[0]*2 && green[1] > green[2]*2, input + ': top-right must sample first-row green');
    assert.ok(blue[2] > blue[0]*2 && blue[2] > blue[1]*2, input + ': bottom-left must sample second-row blue');
    assert.ok(yellow[0] > yellow[2]*2 && yellow[1] > yellow[2]*2, input + ': bottom-right must sample second-row yellow');
  }
  console.log('Native UV texture placement: ' + JSON.stringify(results));
} finally { await browser.close(); }
