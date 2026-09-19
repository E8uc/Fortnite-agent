(() => {
  "use strict";

  const TRANSPARENT = [0, 0, 0, 0];

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx render was cancelled because a newer request replaced it."
      );

    error.name =
      "AbortError";

    error.code =
      "NOVASPARX_REQUEST_REPLACED";

    error.reason =
      signal?.reason ||
      "cancelled";

    return error;
  }

  function throwIfAborted(
    signal
  ) {
    if (signal?.aborted) {
      throw abortError(
        signal
      );
    }
  }

  function asTyped(value, Type) {
    return value instanceof Type ? value : new Type(value);
  }

  function calculateNormals(
    positions,
    indices,
    signal = null
  ) {
    const normals = new Float32Array(positions.length);

    for (let i = 0; i + 2 < indices.length; i += 3) {
      if (
        (i & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;

      const abx = positions[b] - positions[a];
      const aby = positions[b + 1] - positions[a + 1];
      const abz = positions[b + 2] - positions[a + 2];

      const acx = positions[c] - positions[a];
      const acy = positions[c + 1] - positions[a + 1];
      const acz = positions[c + 2] - positions[a + 2];

      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;

      for (const offset of [a, b, c]) {
        normals[offset] += nx;
        normals[offset + 1] += ny;
        normals[offset + 2] += nz;
      }
    }

    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }

    return normals;
  }

  function getBounds(
    positions,
    signal = null
  ) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      if (
        (i & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);

      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;

    const sizeX = maxX - minX || 1;
    const sizeY = maxY - minY || 1;
    const sizeZ = maxZ - minZ || 1;

    return {
      centerX,
      centerY,
      centerZ,
      sizeX,
      sizeY,
      sizeZ,
      radius: Math.hypot(sizeX, sizeY, sizeZ) * 0.5 || 1
    };
  }

  function identity() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);

    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }

    return out;
  }

  function translation(x, y, z) {
    const matrix = identity();
    matrix[12] = x;
    matrix[13] = y;
    matrix[14] = z;
    return matrix;
  }

  function uniformScale(scale) {
    const matrix = identity();
    matrix[0] = scale;
    matrix[5] = scale;
    matrix[10] = scale;
    return matrix;
  }

  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];

    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length;
    zy /= length;
    zz /= length;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;

    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length;
    xy /= length;
    xz /= length;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }

  function orthographic(left, right, bottom, top, near, far) {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);

    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr,
      (top + bottom) * bt,
      (far + near) * nf,
      1
    ]);
  }

  function chooseCamera(bounds) {
    const horizontal = Math.max(bounds.sizeX, bounds.sizeY);
    const flatness = bounds.sizeZ / horizontal;
    const tallness = bounds.sizeZ / Math.max(Math.min(bounds.sizeX, bounds.sizeY), 1e-6);

    if (flatness < 0.13) return [2.25, -2.25, 4.2];
    if (tallness > 4.5) return [3.15, -3.15, 2.15];
    if (bounds.sizeX / bounds.sizeY > 4 || bounds.sizeY / bounds.sizeX > 4) {
      return [2.75, -2.75, 2.85];
    }

    return [2.85, -2.85, 2.65];
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compilation failed.";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function createProgram(gl) {
    const vertexSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aUV;
      attribute vec4 aColor;
      attribute vec4 aTangent;

      uniform mat4 uMVP;
      uniform mat4 uModel;
      uniform vec2 uUVScale;
      uniform vec2 uUVOffset;

      varying vec3 vNormal;
      varying vec3 vTangent;
      varying float vTangentSign;
      varying vec2 vUV;
      varying vec4 vColor;

      void main() {
        gl_Position = uMVP * vec4(aPosition, 1.0);
        vNormal = normalize(mat3(uModel) * aNormal);
        vTangent = normalize(mat3(uModel) * aTangent.xyz);
        vTangentSign = aTangent.w;
        vUV = aUV * uUVScale + uUVOffset;
        vColor = aColor;
      }
    `;

    const fragmentSource = `
      precision highp float;

      varying vec3 vNormal;
      varying vec3 vTangent;
      varying float vTangentSign;
      varying vec2 vUV;
      varying vec4 vColor;

      uniform vec4 uBaseColor;
      uniform vec4 uEmissiveColor;
      uniform float uRoughness;
      uniform float uMetallic;
      uniform float uSpecular;
      uniform float uOpacity;
      uniform float uCutoff;
      uniform int uAlphaMode;
      uniform int uUseVertexColor;

      uniform int uHasBase;
      uniform int uHasNormal;
      uniform int uHasEmissive;
      uniform int uHasOpacity;
      uniform int uHasPacked;

      uniform int uAOChannel;
      uniform int uRoughnessChannel;
      uniform int uMetallicChannel;

      uniform sampler2D uBaseMap;
      uniform sampler2D uNormalMap;
      uniform sampler2D uEmissiveMap;
      uniform sampler2D uOpacityMap;
      uniform sampler2D uPackedMap;

      float channelValue(vec4 value, int channel) {
        if (channel == 0) return value.r;
        if (channel == 1) return value.g;
        if (channel == 2) return value.b;
        if (channel == 3) return value.a;
        return 1.0;
      }

      vec3 toLinear(vec3 color) {
        return pow(max(color, vec3(0.0)), vec3(2.2));
      }

      vec3 toSrgb(vec3 color) {
        return pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
      }

      void main() {
        vec4 base = uBaseColor;

        if (uHasBase == 1) {
          vec4 texel = texture2D(uBaseMap, vUV);
          base.rgb *= toLinear(texel.rgb);
          base.a *= texel.a;
        } else {
          base.rgb = toLinear(base.rgb);
        }

        if (uUseVertexColor == 1) {
          base.rgb *= toLinear(vColor.rgb);
          base.a *= vColor.a;
        }

        float alpha = base.a * uOpacity;

        if (uHasOpacity == 1) {
          alpha *= texture2D(uOpacityMap, vUV).r;
        }

        if (uAlphaMode == 1 && alpha < uCutoff) discard;
        if (alpha < 0.003) discard;

        vec3 normal = normalize(vNormal);

        if (uHasNormal == 1) {
          vec3 tangent = normalize(vTangent);
          vec3 bitangent = normalize(cross(normal, tangent)) * vTangentSign;
          vec3 sampledNormal = texture2D(uNormalMap, vUV).xyz * 2.0 - 1.0;
          normal = normalize(mat3(tangent, bitangent, normal) * sampledNormal);
        }

        float roughness = uRoughness;
        float metallic = uMetallic;
        float ao = 1.0;

        if (uHasPacked == 1) {
          vec4 packed = texture2D(uPackedMap, vUV);

          if (uRoughnessChannel >= 0) {
            roughness = channelValue(packed, uRoughnessChannel);
          }
          if (uMetallicChannel >= 0) {
            metallic = channelValue(packed, uMetallicChannel);
          }
          if (uAOChannel >= 0) {
            ao = channelValue(packed, uAOChannel);
          }
        }

        roughness = clamp(roughness, 0.04, 1.0);
        metallic = clamp(metallic, 0.0, 1.0);

        vec3 keyLight = normalize(vec3(0.46, -0.55, 0.75));
        vec3 fillLight = normalize(vec3(-0.7, 0.25, 0.55));
        vec3 viewDirection = normalize(vec3(0.45, -0.45, 0.75));

        float key = max(dot(normal, keyLight), 0.0);
        float fill = max(dot(normal, fillLight), 0.0);
        float hemi = 0.29 + 0.18 * (normal.z * 0.5 + 0.5);

        vec3 halfVector = normalize(keyLight + viewDirection);
        float specPower = mix(120.0, 7.0, roughness);
        float specularTerm = pow(max(dot(normal, halfVector), 0.0), specPower);

        vec3 f0 = mix(vec3(0.04 * uSpecular), base.rgb, metallic);

        vec3 color =
          base.rgb * (hemi * ao + key * 0.64 + fill * 0.16) +
          f0 * specularTerm * mix(0.18, 0.72, 1.0 - roughness);

        vec3 emissive = toLinear(uEmissiveColor.rgb) * uEmissiveColor.a;

        if (uHasEmissive == 1) {
          emissive *= toLinear(texture2D(uEmissiveMap, vUV).rgb);
        }

        color += emissive;

        gl_FragColor = vec4(toSrgb(color), alpha);
      }
    `;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Shader program failed to link.");
    }

    return program;
  }

  function createBuffer(gl, data, target = gl.ARRAY_BUFFER) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  }

  function setAttribute(gl, program, name, buffer, size, fallback) {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;

    if (buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      return;
    }

    gl.disableVertexAttribArray(location);

    if (size === 2) gl.vertexAttrib2f(location, fallback[0], fallback[1]);
    else if (size === 3) gl.vertexAttrib3f(location, fallback[0], fallback[1], fallback[2]);
    else gl.vertexAttrib4f(location, fallback[0], fallback[1], fallback[2], fallback[3]);
  }

  function createSolidTexture(gl, rgba) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba)
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return texture;
  }

  async function loadTexture(gl, url, fallbackTexture, options = {}) {
    if (!url) return { texture: fallbackTexture, loaded: false };

    const signal =
      options.signal ||
      null;

    throwIfAborted(
      signal
    );

    try {
      const response = await fetch(
        url,
        {
          cache:
            "force-cache",
          signal:
            signal ||
            undefined
        }
      );
      if (!response.ok) throw new Error(`Texture HTTP ${response.status}`);

      const bitmap = await createImageBitmap(
        await response.blob(),
        {
          premultiplyAlpha:
            "none"
        }
      );

      throwIfAborted(
        signal
      );

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap
      );

      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        options.mipmaps === false
          ? gl.LINEAR
          : gl.LINEAR_MIPMAP_LINEAR
      );

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

      if (options.mipmaps !== false) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      bitmap.close?.();

      return { texture, loaded: true };
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw abortError(
          signal
        );
      }

      return {
        texture:
          fallbackTexture,
        loaded:
          false
      };
    }
  }

  function alphaMode(mode) {
    const value = String(mode || "").toLowerCase();
    if (value.includes("mask")) return 1;
    if (value.includes("blend") || value.includes("transluc")) return 2;
    return 0;
  }

  function canvasToBlob(
    canvas,
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    return new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (
              signal?.aborted
            ) {
              reject(
                abortError(
                  signal
                )
              );
              return;
            }

            if (blob) {
              resolve(blob);
              return;
            }

            reject(
              new Error(
                "PNG encoding failed."
              )
            );
          },
          "image/png"
        );
      }
    );
  }

  async function render(manifest, options = {}) {
    if (!manifest?.geometry) throw new Error("NovaSparx manifest has no geometry.");

    const guard =
      window.NovaSparxBrowserGuard;

    const signal =
      options.signal ||
      guard?.activeSignal?.() ||
      null;

    throwIfAborted(
      signal
    );

    guard
      ?.assertManifestBudget?.(
        manifest
      );

    const policy =
      guard
        ?.renderPolicy?.(
          manifest
        ) || {};

    const geometry = manifest.geometry;

    const positions = asTyped(geometry.positions, Float32Array);
    const indices32 = asTyped(geometry.indices, Uint32Array);

    const vertexCount = positions.length / 3;

    const normals = geometry.normals
      ? asTyped(geometry.normals, Float32Array)
      : calculateNormals(
          positions,
          indices32,
          signal
        );

    const uv0 = geometry.uv0
      ? asTyped(geometry.uv0, Float32Array)
      : null;

    const colors = geometry.colors
      ? asTyped(geometry.colors, Float32Array)
      : null;

    const tangents = geometry.tangents
      ? asTyped(geometry.tangents, Float32Array)
      : null;

    const requestedSize =
      Number(options.size) ||
      Number(policy.size) ||
      (
        vertexCount < 100000 ? 1024 :
        vertexCount < 280000 ? 896 :
        768
      );

    const size =
      Math.max(
        384,
        Math.min(
          policy.size || 1024,
          requestedSize
        )
      );

    const supersample =
      policy.supersample === false
        ? 1
        : (
            vertexCount < 240000
              ? 2
              : 1
          );

    const renderSize =
      Math.min(
        policy.supersample === false
          ? size
          : 2048,
        size * supersample
      );

    const canvas = document.createElement("canvas");
    canvas.width = renderSize;
    canvas.height = renderSize;

    let webglContextLost = false;

    canvas.addEventListener(
      "webglcontextlost",
      () => {
        webglContextLost = true;

        guard?.setPressure?.(
          "high",
          "webgl-context-lost"
        );
      },
      { once: true }
    );

    throwIfAborted(
      signal
    );

    const gl =
      canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        depth: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference:
          policy.powerPreference ||
          "high-performance"
      }) ||
      canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        depth: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      });

    if (!gl) throw new Error("WebGL is unavailable on this device.");

    try {

    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext;

    const supportsUintIndices =
      isWebGL2 || !!gl.getExtension("OES_element_index_uint");

    if (!supportsUintIndices && vertexCount > 65535) {
      throw new Error("This device cannot render this mesh because 32-bit indices are unavailable.");
    }

    const indices = supportsUintIndices ? indices32 : new Uint16Array(indices32);
    const indexType = supportsUintIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const bytesPerIndex = supportsUintIndices ? 4 : 2;

    const program = createProgram(gl);
    gl.useProgram(program);

    const positionBuffer = createBuffer(gl, positions);
    const normalBuffer = createBuffer(gl, normals);
    const uvBuffer = uv0 ? createBuffer(gl, uv0) : null;
    const colorBuffer = colors ? createBuffer(gl, colors) : null;
    const tangentBuffer = tangents ? createBuffer(gl, tangents) : null;
    const indexBuffer = createBuffer(gl, indices, gl.ELEMENT_ARRAY_BUFFER);

    setAttribute(gl, program, "aPosition", positionBuffer, 3, [0, 0, 0, 1]);
    setAttribute(gl, program, "aNormal", normalBuffer, 3, [0, 0, 1, 1]);
    setAttribute(gl, program, "aUV", uvBuffer, 2, [0, 0, 0, 1]);
    setAttribute(gl, program, "aColor", colorBuffer, 4, [1, 1, 1, 1]);
    setAttribute(gl, program, "aTangent", tangentBuffer, 4, [1, 0, 0, 1]);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    const bounds =
      getBounds(
        positions,
        signal
      );
    const model = multiply(
      uniformScale(1 / bounds.radius),
      translation(-bounds.centerX, -bounds.centerY, -bounds.centerZ)
    );

    const view = lookAt(chooseCamera(bounds), [0, 0, 0], [0, 0, 1]);
    const projection = orthographic(-1.1, 1.1, -1.1, 1.1, 0.01, 20);
    const mvp = multiply(projection, multiply(view, model));

    gl.uniformMatrix4fv(gl.getUniformLocation(program, "uModel"), false, model);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "uMVP"), false, mvp);

    const white = createSolidTexture(gl, [255, 255, 255, 255]);
    const flatNormal = createSolidTexture(gl, [128, 128, 255, 255]);
    const black = createSolidTexture(gl, [0, 0, 0, 255]);

    const materials =
      (
        manifest.materials?.length
          ? manifest.materials
          : [{}]
      ).slice(
        0,
        Number(policy.maxMaterials) ||
        24
      );

    const loadedMaterials = [];

    const textureModes =
      new Set(
        policy.textureModes ||
        [
          "base",
          "normal",
          "emissive",
          "opacity",
          "packed"
        ]
      );

    let remainingTextureLoads =
      Number(policy.maxTextureLoads) ||
      40;

    const guardedTexture = async (
      mode,
      url,
      fallbackTexture
    ) => {
      if (
        !url ||
        !textureModes.has(mode) ||
        remainingTextureLoads <= 0
      ) {
        return {
          texture:
            fallbackTexture,
          loaded:
            false
        };
      }

      remainingTextureLoads--;

      return loadTexture(
        gl,
        url,
        fallbackTexture,
        {
          mipmaps:
            policy.mipmaps !== false,
          signal
        }
      );
    };

    for (const material of materials) {
      throwIfAborted(
        signal
      );

      const maps = await Promise.all([
        guardedTexture("base", material.baseColorTexture, white),
        guardedTexture("normal", material.normalTexture, flatNormal),
        guardedTexture("emissive", material.emissiveTexture, black),
        guardedTexture("opacity", material.opacityTexture, white),
        guardedTexture("packed", material.packedTexture, white)
      ]);

      throwIfAborted(
        signal
      );

      loadedMaterials.push({ material, maps });
    }

    throwIfAborted(
      signal
    );

    gl.viewport(0, 0, renderSize, renderSize);

    const background = options.background || TRANSPARENT;
    gl.clearColor(...background);
    gl.clearDepth(1);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.disable(gl.CULL_FACE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const sections = manifest.sections?.length
      ? manifest.sections
      : [{
          firstIndex: 0,
          indexCount: indices.length,
          materialIndex: 0
        }];

    for (const section of sections) {
      throwIfAborted(
        signal
      );

      const loaded =
        loadedMaterials[Math.min(section.materialIndex || 0, loadedMaterials.length - 1)] ||
        loadedMaterials[0];

      const material = loaded.material || {};
      const baseColor = material.baseColor || [1, 1, 1, 1];
      const emissiveColor = material.emissiveColor || [0, 0, 0, 1];

      gl.uniform4f(
        gl.getUniformLocation(program, "uBaseColor"),
        ...baseColor
      );

      gl.uniform4f(
        gl.getUniformLocation(program, "uEmissiveColor"),
        ...emissiveColor
      );

      gl.uniform1f(
        gl.getUniformLocation(program, "uRoughness"),
        Number(material.roughness ?? 0.62)
      );

      gl.uniform1f(
        gl.getUniformLocation(program, "uMetallic"),
        Number(material.metallic ?? 0)
      );

      gl.uniform1f(
        gl.getUniformLocation(program, "uSpecular"),
        Number(material.specular ?? 0.5)
      );

      gl.uniform1f(
        gl.getUniformLocation(program, "uOpacity"),
        Number(material.opacity ?? 1)
      );

      gl.uniform1f(
        gl.getUniformLocation(program, "uCutoff"),
        Number(material.opacityCutoff ?? 0.333)
      );

      gl.uniform1i(
        gl.getUniformLocation(program, "uAlphaMode"),
        alphaMode(material.opacityMode)
      );

      gl.uniform1i(
        gl.getUniformLocation(program, "uUseVertexColor"),
        colors && material.useVertexColor ? 1 : 0
      );

      const uvScale = material.uvScale || [1, 1];
      const uvOffset = material.uvOffset || [0, 0];

      gl.uniform2f(
        gl.getUniformLocation(program, "uUVScale"),
        Number(uvScale[0] ?? 1),
        Number(uvScale[1] ?? 1)
      );

      gl.uniform2f(
        gl.getUniformLocation(program, "uUVOffset"),
        Number(uvOffset[0] ?? 0),
        Number(uvOffset[1] ?? 0)
      );

      const textureBindings = [
        ["uBaseMap", "uHasBase", 0, !!(uv0 && loaded.maps[0].loaded)],
        ["uNormalMap", "uHasNormal", 1, !!(uv0 && tangents && loaded.maps[1].loaded)],
        ["uEmissiveMap", "uHasEmissive", 2, !!(uv0 && loaded.maps[2].loaded)],
        ["uOpacityMap", "uHasOpacity", 3, !!(uv0 && loaded.maps[3].loaded)],
        ["uPackedMap", "uHasPacked", 4, !!(uv0 && loaded.maps[4].loaded)]
      ];

      textureBindings.forEach(([samplerName, flagName, unit, enabled]) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, loaded.maps[unit].texture);
        gl.uniform1i(gl.getUniformLocation(program, samplerName), unit);
        gl.uniform1i(gl.getUniformLocation(program, flagName), enabled ? 1 : 0);
      });

      gl.uniform1i(
        gl.getUniformLocation(program, "uAOChannel"),
        Number(material.packedChannels?.ao ?? -1)
      );

      gl.uniform1i(
        gl.getUniformLocation(program, "uRoughnessChannel"),
        Number(material.packedChannels?.roughness ?? -1)
      );

      gl.uniform1i(
        gl.getUniformLocation(program, "uMetallicChannel"),
        Number(material.packedChannels?.metallic ?? -1)
      );

      const firstIndex = Math.max(
        0,
        Math.min(indices.length, Number(section.firstIndex) || 0)
      );

      let count = Math.max(
        0,
        Math.min(
          indices.length - firstIndex,
          Number(section.indexCount) || 0
        )
      );

      count -= count % 3;

      if (count > 0) {
        gl.drawElements(
          gl.TRIANGLES,
          count,
          indexType,
          firstIndex * bytesPerIndex
        );
      }
    }

    throwIfAborted(
      signal
    );

    gl.finish();

    throwIfAborted(
      signal
    );

    if (
      webglContextLost ||
      gl.isContextLost?.()
    ) {
      throw new Error(
        "NovaSparx stopped this render because the browser lost its WebGL context."
      );
    }

    let outputCanvas = canvas;

    if (renderSize !== size) {
      outputCanvas = document.createElement("canvas");
      outputCanvas.width = size;
      outputCanvas.height = size;

      const context = outputCanvas.getContext("2d", { alpha: true });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(canvas, 0, 0, size, size);
    }

    const blob =
      await canvasToBlob(
        outputCanvas,
        signal
      );

    throwIfAborted(
      signal
    );

    const textured = loadedMaterials.some((item) => item.maps[0].loaded);
    const normalMapped = loadedMaterials.some((item) => item.maps[1].loaded);

    for (const item of loadedMaterials) {
      for (const map of item.maps) {
        if (map.loaded) gl.deleteTexture(map.texture);
      }
    }

    gl.deleteTexture(white);
    gl.deleteTexture(flatNormal);
    gl.deleteTexture(black);

    for (const buffer of [
      positionBuffer,
      normalBuffer,
      uvBuffer,
      colorBuffer,
      tangentBuffer,
      indexBuffer
    ]) {
      if (buffer) gl.deleteBuffer(buffer);
    }

    gl.deleteProgram(program);

    try {
      gl.getExtension(
        "WEBGL_lose_context"
      )?.loseContext();
    } catch {}

    // Release large framebuffer allocations immediately instead of waiting for
    // mobile Safari's GC heuristics.
    canvas.width = 1;
    canvas.height = 1;

    if (outputCanvas !== canvas) {
      outputCanvas.width = 1;
      outputCanvas.height = 1;
    }

    return {
      blob,
      width: size,
      height: size,
      vertexCount,
      triangleCount: indices.length / 3,
      materialCount: materials.length,
      textured,
      normalMapped,
      bounds,
      materialFidelity: manifest.metadata?.materialFidelity || "unknown"
    };
    } catch (error) {
      // One-shot previews should never leave a failed GPU context alive.
      // This matters especially on mobile Safari, where a failed WebGL render
      // can otherwise keep a large drawing buffer until the tab is reclaimed.
      try {
        gl.getExtension(
          "WEBGL_lose_context"
        )?.loseContext();
      } catch {}

      canvas.width = 1;
      canvas.height = 1;

      throw error;
    }
  }

  window.NovaSparxRenderer = Object.freeze({
    version: "1.2.0",
    render
  });
})();
