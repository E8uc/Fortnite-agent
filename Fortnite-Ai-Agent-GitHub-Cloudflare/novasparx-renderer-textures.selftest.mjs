import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./novasparx-renderer.js', import.meta.url), 'utf8');

class GL {
  constructor() {
    this.uploads = [];
    this.deleted = [];
    this.draws = [];
    this.uniforms = new Map();
    for (const name of ['TEXTURE_2D', 'RGBA', 'UNSIGNED_BYTE', 'TEXTURE_MIN_FILTER',
      'TEXTURE_MAG_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'LINEAR',
      'LINEAR_MIPMAP_LINEAR', 'REPEAT', 'CLAMP_TO_EDGE', 'ARRAY_BUFFER',
      'ELEMENT_ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'UNSIGNED_INT', 'UNSIGNED_SHORT',
      'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS',
      'MAX_RENDERBUFFER_SIZE', 'TRIANGLES', 'LINES']) this[name] = name;
    this.NO_ERROR = 0;
  }
  createShader() { return {}; }
  shaderSource() {}
  compileShader() {}
  getShaderParameter() { return true; }
  createProgram() { return {}; }
  attachShader() {}
  linkProgram() {}
  getProgramParameter() { return true; }
  useProgram() {}
  createBuffer() { return {}; }
  bindBuffer() {}
  bufferData() {}
  getAttribLocation(_program, name) { return ['aPosition', 'aNormal', 'aUV', 'aColor', 'aTangent'].indexOf(name); }
  enableVertexAttribArray() {}
  disableVertexAttribArray() {}
  vertexAttribPointer() {}
  vertexAttrib2f() {}
  vertexAttrib3f() {}
  vertexAttrib4f() {}
  createTexture() { return { parameters: new Map(), mipmaps: false }; }
  bindTexture(_target, texture) { this.boundTexture = texture; }
  texImage2D(...args) {
    if (args.length === 9) this.uploads.push({ texture: this.boundTexture, width: args[3], height: args[4] });
  }
  texParameteri(_target, name, value) { this.boundTexture.parameters.set(name, value); }
  generateMipmap() {
    if (this.failMipmaps) this.error = 1285;
    else this.boundTexture.mipmaps = true;
  }
  getError() { const error = this.error || 0; this.error = 0; return error; }
  getExtension(name) { return name === 'OES_element_index_uint' ? {} : null; }
  getParameter() { return 2560; }
  getUniformLocation(_program, name) { return name; }
  uniformMatrix4fv() {}
  uniform4f() {}
  uniform3f() {}
  uniform2f() {}
  uniform1f() {}
  uniform1i(name, value) { this.uniforms.set(name, value); }
  drawElements() { this.draws.push({ base: this.uniforms.get('uHasBase'), normal: this.uniforms.get('uHasNormal') }); }
  drawArrays() {}
  deleteTexture(texture) { this.deleted.push(texture); }
  deleteShader() {}
  deleteProgram() {}
  deleteBuffer() {}
  pixelStorei() {}
  viewport() {}
  clearColor() {}
  clearDepth() {}
  enable() {}
  disable() {}
  depthFunc() {}
  blendFunc() {}
  clear() {}
  activeTexture() {}
  isContextLost() { return false; }
  finish() {}
}
class GL2 extends GL {}

function setup({ webgl2 = true, policy = {}, failMipmaps = false } = {}) {
  const contexts = [];
  const document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      const gl = webgl2 ? new GL2() : new GL();
      gl.failMipmaps = failMipmaps;
      const canvas = {
        width: 1, height: 1, clientWidth: 400, clientHeight: 320,
        setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {},
        getContext(name) { return name === 'webgl2' && !webgl2 ? null : name === '2d' ? { drawImage() {} } : gl; },
        toBlob(callback) { callback(new Blob(['png'], { type: 'image/png' })); }
      };
      gl.canvas = canvas;
      contexts.push(gl);
      return canvas;
    }
  };
  const window = {
    devicePixelRatio: 1, addEventListener() {}, removeEventListener() {},
    NovaSparxBrowserGuard: { assertManifestBudget() {}, renderPolicy: () => policy }
  };
  vm.runInNewContext(source, {
    window, document, ArrayBuffer, Float32Array, Uint32Array, Uint16Array, Uint8Array,
    Blob, WebGL2RenderingContext: GL2, requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}, ResizeObserver: class { observe() {} disconnect() {} }
  });
  const host = { replaceChildren() {}, getBoundingClientRect: () => ({ width: 400, height: 320 }) };
  return { renderer: window.NovaSparxRenderer, host, contexts };
}

function frame(width = 4, height = 4) {
  return { width, height, pixels: new ArrayBuffer(width * height * 4) };
}
function manifest(materials) {
  return {
    geometry: {
      positions: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]), uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
      tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])
    },
    materials, sections: materials.map((_material, materialIndex) => ({ firstIndex: 0, indexCount: 3, materialIndex }))
  };
}
const decodedUploads = gl => gl.uploads.filter(upload => upload.width > 1 || upload.height > 1);

for (const method of ['mount', 'render']) {
  const { renderer, host, contexts } = setup({ policy: { maxTextureLoads: 1 } });
  const shared = frame();
  const mesh = manifest([{ baseColorFrame: shared }, { baseColorFrame: { ...shared } }]);
  const result = method === 'mount' ? await renderer.mount(mesh, host, { ground: false }) : await renderer.render(mesh, { size: 384 });
  const gl = contexts[0];
  assert.deepEqual(gl.draws.map(draw => draw.base), [1, 1], `${method}: repeated map must survive the unique-load limit`);
  assert.equal(decodedUploads(gl).length, 1, `${method}: one upload for a shared decoded map`);
  if (method === 'mount') { result.dispose(); result.dispose(); }
  const texture = decodedUploads(gl)[0].texture;
  assert.equal(gl.deleted.filter(deleted => deleted === texture).length, 1, `${method}: shared map deleted exactly once`);
}

{
  const { renderer, host, contexts } = setup({ policy: { maxTextureLoads: 1 } });
  const shared = frame();
  const result = await renderer.mount(manifest([{
    baseColorFrame: shared, normalTexture: { ...shared, pixels: new Uint8Array(shared.pixels) }
  }]), host, { ground: false });
  const gl = contexts[0];
  assert.equal(decodedUploads(gl).length, 1, 'Concurrent maps referencing the same decoded pixels share one upload');
  assert.deepEqual(gl.draws, [{ base: 1, normal: 1 }]);
  result.dispose();
  assert.equal(gl.deleted.filter(texture => texture === decodedUploads(gl)[0].texture).length, 1);
  const second = await renderer.mount(manifest([{ baseColorFrame: shared }]), host, { ground: false });
  assert.equal(decodedUploads(contexts[1]).length, 1, 'A new GL context owns its own upload');
  second.dispose();
}

{
  const { renderer, host, contexts } = setup();
  const pixels = new ArrayBuffer(128);
  const result = await renderer.mount(manifest([
    { baseColorFrame: { width: 4, height: 4, pixels: new Uint8Array(pixels, 0, 64) } },
    { baseColorFrame: { width: 4, height: 4, pixels: new Uint8Array(pixels, 64, 64) } }
  ]), host, { ground: false });
  assert.equal(decodedUploads(contexts[0]).length, 2, 'Distinct byte ranges in one buffer remain distinct decoded maps');
  result.dispose();
}

for (const { webgl2, width, height, mipmaps, expected } of [
  { webgl2: true, width: 3, height: 5, expected: true },
  { webgl2: false, width: 4, height: 8, expected: true },
  { webgl2: false, width: 3, height: 5, expected: false },
  { webgl2: true, width: 4, height: 4, mipmaps: false, expected: false }
]) {
  const { renderer, host, contexts } = setup({ webgl2, policy: { mipmaps } });
  const result = await renderer.mount(manifest([{ baseColorFrame: frame(width, height) }]), host, { ground: false });
  const gl = contexts[0], { texture } = decodedUploads(gl)[0];
  assert.equal(texture.mipmaps, expected, `safe mipmaps for WebGL${webgl2 ? 2 : 1} ${width}x${height}`);
  assert.equal(texture.parameters.get(gl.TEXTURE_MIN_FILTER), expected ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  if (!webgl2 && width === 3) assert.equal(texture.parameters.get(gl.TEXTURE_WRAP_S), gl.CLAMP_TO_EDGE);
  result.dispose();
}

{
  const { renderer, host, contexts } = setup({ failMipmaps: true });
  const result = await renderer.mount(manifest([{ baseColorFrame: frame() }]), host, { ground: false });
  const gl = contexts[0], { texture } = decodedUploads(gl)[0];
  assert.equal(result.textured, true, 'A failed mipmap allocation must retain the valid base map');
  assert.equal(texture.parameters.get(gl.TEXTURE_MIN_FILTER), gl.LINEAR);
  assert.equal(gl.deleted.filter(deleted => deleted === texture).length, 0);
  result.dispose();
  assert.equal(gl.deleted.filter(deleted => deleted === texture).length, 1);
}

for (const count of [3, 4]) {
  const { renderer, host, contexts } = setup();
  const result = await renderer.mount(manifest(Array.from({ length: count }, () => ({ baseColorFrame: frame(2048, 2048) }))), host, { ground: false });
  const gl = contexts[0], uploads = decodedUploads(gl);
  assert.equal(uploads.length, count, 'Mipmap allowance must preserve every base map');
  let bytes = 0;
  for (const { texture, width, height } of uploads) {
    let w = width, h = height;
    bytes += w * h * 4;
    if (texture.mipmaps) while (w > 1 || h > 1) {
      w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
      bytes += w * h * 4;
    }
  }
  assert.ok(bytes <= 64 * 1024 * 1024, 'Decoded GPU maps including mip levels must stay within 64 MiB');
  assert.equal(uploads.filter(upload => upload.texture.mipmaps).length, count === 3 ? 3 : 0);
  result.dispose();
}

console.log('FNAA renderer decoded texture upload, cleanup, filter and GPU budget checks passed');
