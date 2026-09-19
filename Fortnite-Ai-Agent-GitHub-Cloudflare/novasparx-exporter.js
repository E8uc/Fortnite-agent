(() => {
  "use strict";

  const GLB_MAGIC = 0x46546c67;
  const GLB_VERSION = 2;
  const CHUNK_JSON = 0x4e4f534a;
  const CHUNK_BIN = 0x004e4942;

  const FLOAT = 5126;
  const UNSIGNED_INT = 5125;
  const ARRAY_BUFFER = 34962;
  const ELEMENT_ARRAY_BUFFER = 34963;

  function exportAbortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx export was cancelled because a newer request replaced it."
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
      throw exportAbortError(
        signal
      );
    }
  }

  function align4(value) {
    return (Number(value) + 3) & ~3;
  }

  function cleanName(value, fallback = "NovaSparx_Asset") {
    const text = String(value || "")
      .split("/")
      .pop()
      ?.split(".")[0]
      ?.replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return text || fallback;
  }

  function guardStatus() {
    return globalThis.NovaSparxBrowserGuard?.status?.() || {};
  }

  function exportBudget() {
    const guard = guardStatus();

    if (guard.isIOS) {
      return {
        maxBinaryBytes: 18 * 1024 * 1024,
        maxTextureBytes: 6 * 1024 * 1024,
        maxSingleTextureBytes: 3 * 1024 * 1024,
        textureConcurrency: 1
      };
    }

    if (guard.isMobile) {
      return {
        maxBinaryBytes: 32 * 1024 * 1024,
        maxTextureBytes: 12 * 1024 * 1024,
        maxSingleTextureBytes: 5 * 1024 * 1024,
        textureConcurrency: 2
      };
    }

    return {
      maxBinaryBytes: 128 * 1024 * 1024,
      maxTextureBytes: 40 * 1024 * 1024,
      maxSingleTextureBytes: 12 * 1024 * 1024,
      textureConcurrency: 4
    };
  }

  function typedBytes(array) {
    return new Uint8Array(
      array.buffer,
      array.byteOffset,
      array.byteLength
    );
  }

  function transformPositions(
    input,
    signal = null
  ) {
    const source =
      input instanceof Float32Array
        ? input
        : new Float32Array(input);

    const out =
      new Float32Array(
        source.length
      );

    for (
      let index = 0;
      index + 2 < source.length;
      index += 3
    ) {
      if (
        (index & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }

      const x = source[index];
      const y = source[index + 1];
      const z = source[index + 2];

      out[index] = y * 0.01;
      out[index + 1] = z * 0.01;
      out[index + 2] = -x * 0.01;
    }

    return out;
  }

  function transformNormals(
    input,
    signal = null
  ) {
    if (!input) return null;

    const source =
      input instanceof Float32Array
        ? input
        : new Float32Array(input);

    const out =
      new Float32Array(
        source.length
      );

    for (
      let index = 0;
      index + 2 < source.length;
      index += 3
    ) {
      if (
        (index & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }

      const x = source[index];
      const y = source[index + 1];
      const z = source[index + 2];

      const tx = y;
      const ty = z;
      const tz = -x;

      const length =
        Math.hypot(
          tx,
          ty,
          tz
        ) || 1;

      out[index] = tx / length;
      out[index + 1] = ty / length;
      out[index + 2] = tz / length;
    }

    return out;
  }

  function transformIndices(
    input,
    signal = null
  ) {
    const source =
      input instanceof Uint32Array
        ? input
        : new Uint32Array(input);

    const out =
      new Uint32Array(
        source.length
      );

    for (
      let index = 0;
      index + 2 < source.length;
      index += 3
    ) {
      if (
        (index & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }

      out[index] = source[index];
      out[index + 1] = source[index + 2];
      out[index + 2] = source[index + 1];
    }

    return out;
  }

  function positionBounds(
    positions,
    signal = null
  ) {
    const min =
      [Infinity, Infinity, Infinity];

    const max =
      [-Infinity, -Infinity, -Infinity];

    for (
      let index = 0;
      index + 2 < positions.length;
      index += 3
    ) {
      if (
        (index & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }

      for (
        let axis = 0;
        axis < 3;
        axis++
      ) {
        const value =
          positions[index + axis];

        if (value < min[axis]) {
          min[axis] = value;
        }

        if (value > max[axis]) {
          max[axis] = value;
        }
      }
    }

    return { min, max };
  }

  function rgba(value, fallback) {
    const source =
      Array.isArray(value)
        ? value
        : fallback;

    return [
      0,
      1,
      2,
      3
    ].map(
      (index) => {
        const number =
          Number(
            source[index]
          );

        return Number.isFinite(number)
          ? number
          : fallback[index];
      }
    );
  }

  function clamp01(value, fallback) {
    const number =
      Number(value);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.max(
      0,
      Math.min(
        1,
        number
      )
    );
  }

  function makeBinaryBuilder() {
    const parts = [];
    let length = 0;

    return {
      push(bytes) {
        const data =
          bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(bytes);

        const aligned =
          align4(length);

        if (
          aligned > length
        ) {
          parts.push(
            new Uint8Array(
              aligned - length
            )
          );

          length = aligned;
        }

        const offset =
          length;

        parts.push(data);
        length += data.byteLength;

        return {
          byteOffset:
            offset,
          byteLength:
            data.byteLength
        };
      },

      finish() {
        const finalLength =
          align4(length);

        if (
          finalLength > length
        ) {
          parts.push(
            new Uint8Array(
              finalLength - length
            )
          );

          length = finalLength;
        }

        const output =
          new Uint8Array(
            length
          );

        let cursor = 0;

        for (
          const part of parts
        ) {
          output.set(
            part,
            cursor
          );

          cursor +=
            part.byteLength;
        }

        return output;
      },

      get length() {
        return length;
      }
    };
  }

  function addBufferView(
    gltf,
    builder,
    bytes,
    target = null
  ) {
    const range =
      builder.push(bytes);

    const view = {
      buffer: 0,
      byteOffset:
        range.byteOffset,
      byteLength:
        range.byteLength
    };

    if (target) {
      view.target =
        target;
    }

    gltf.bufferViews.push(
      view
    );

    return (
      gltf.bufferViews.length -
      1
    );
  }

  function addAccessor(
    gltf,
    options
  ) {
    const accessor = {
      bufferView:
        options.bufferView,
      byteOffset:
        options.byteOffset || 0,
      componentType:
        options.componentType,
      count:
        options.count,
      type:
        options.type
    };

    if (options.min) {
      accessor.min =
        options.min;
    }

    if (options.max) {
      accessor.max =
        options.max;
    }

    gltf.accessors.push(
      accessor
    );

    return (
      gltf.accessors.length -
      1
    );
  }

  function deadlineSignal(
    timeoutMs,
    parentSignal = null
  ) {
    const controller =
      new AbortController();

    const abortFromParent =
      () => {
        try {
          controller.abort(
            parentSignal?.reason ||
            "replaced-by-new-request"
          );
        } catch {}
      };

    if (
      parentSignal?.aborted
    ) {
      abortFromParent();
    } else {
      parentSignal
        ?.addEventListener?.(
          "abort",
          abortFromParent,
          {
            once:
              true
          }
        );
    }

    const timer =
      setTimeout(
        () => {
          try {
            controller.abort(
              "novasparx-export-timeout"
            );
          } catch {}
        },
        timeoutMs
      );

    return {
      signal:
        controller.signal,
      cleanup() {
        clearTimeout(
          timer
        );

        parentSignal
          ?.removeEventListener?.(
            "abort",
            abortFromParent
          );
      }
    };
  }

  async function readBytesBounded(
    response,
    maxBytes,
    signal = null
  ) {
    maxBytes =
      Math.max(
        1,
        Number(maxBytes) ||
        1
      );

    const declared =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      declared > 0 &&
      declared > maxBytes
    ) {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        "Texture response exceeded the safe browser export budget."
      );
    }

    if (
      !response.body ||
      typeof response.body
        .getReader !==
        "function"
    ) {
      const bytes =
        new Uint8Array(
          await response.arrayBuffer()
        );

      throwIfAborted(
        signal
      );

      if (
        bytes.byteLength >
        maxBytes
      ) {
        throw new Error(
          "Texture response exceeded the safe browser export budget."
        );
      }

      return bytes;
    }

    const reader =
      response.body
        .getReader();

    const chunks = [];
    let total = 0;

    try {
      while (true) {
        throwIfAborted(
          signal
        );

        const {
          done,
          value
        } =
          await reader.read();

        if (done) {
          break;
        }

        if (!value?.byteLength) {
          continue;
        }

        total +=
          value.byteLength;

        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {}

          throw new Error(
            "Texture response exceeded the safe browser export budget."
          );
        }

        chunks.push(
          value
        );
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    throwIfAborted(
      signal
    );

    const output =
      new Uint8Array(
        total
      );

    let offset = 0;

    for (const chunk of chunks) {
      output.set(
        chunk,
        offset
      );

      offset +=
        chunk.byteLength;
    }

    return output;
  }

  function textureFetchUrl(
    value
  ) {
    const raw =
      String(value || "")
        .trim();

    if (!raw) {
      return "";
    }

    let candidate =
      raw;

    if (
      !/^https?:\/\//i.test(
        raw
      )
    ) {
      candidate =
        globalThis.NovaSparx
          ?.textureUrl?.(
            raw
          ) ||
        raw;
    }

    try {
      const url =
        new URL(
          candidate,
          globalThis.location
            ?.href ||
          "https://invalid.local/"
        );

      const loopback =
        [
          "localhost",
          "127.0.0.1",
          "::1",
          "[::1]"
        ].includes(
          url.hostname
        );

      if (
        url.protocol !==
          "https:" &&
        !(
          url.protocol ===
            "http:" &&
          loopback
        )
      ) {
        return "";
      }

      if (
        url.username ||
        url.password
      ) {
        return "";
      }

      url.hash = "";

      return url.toString();
    } catch {
      return "";
    }
  }

  async function fetchImage(
    url,
    signal = null,
    maxBytes =
      exportBudget()
        .maxSingleTextureBytes
  ) {
    if (!url) {
      return null;
    }

    throwIfAborted(
      signal
    );

    const requestUrl =
      textureFetchUrl(
        url
      );

    if (!requestUrl) {
      return null;
    }

    const deadline =
      deadlineSignal(
        20_000,
        signal
      );

    try {
      const response =
        await fetch(
          requestUrl,
          {
            cache:
              "force-cache",
            credentials:
              "omit",
            signal:
              deadline.signal,
            headers: {
              Accept:
                "image/png,image/jpeg;q=0.9,image/*;q=0.6"
            }
          }
        );

      throwIfAborted(
        signal
      );

      if (!response.ok) {
        try {
          await response.body
            ?.cancel();
        } catch {}

        return null;
      }

      const mime =
        String(
          response.headers
            .get(
              "content-type"
            ) ||
          "image/png"
        )
          .split(";")[0]
          .trim()
          .toLowerCase();

      if (
        ![
          "image/png",
          "image/jpeg"
        ].includes(mime)
      ) {
        try {
          await response.body
            ?.cancel();
        } catch {}

        return null;
      }

      const bytes =
        await readBytesBounded(
          response,
          maxBytes,
          signal
        );

      throwIfAborted(
        signal
      );

      return {
        bytes,
        mime
      };
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw exportAbortError(
          signal
        );
      }

      return null;
    } finally {
      deadline.cleanup();
    }
  }

  async function mapLimit(
    values,
    limit,
    worker,
    signal = null
  ) {
    const output =
      new Array(
        values.length
      );

    let cursor = 0;

    const run =
      async () => {
        while (true) {
          throwIfAborted(
            signal
          );

          const index =
            cursor++;

          if (
            index >=
            values.length
          ) {
            return;
          }

          output[index] =
            await worker(
              values[index],
              index
            );
        }
      };

    await Promise.all(
      Array.from(
        {
          length:
            Math.min(
              Math.max(
                1,
                limit
              ),
              values.length ||
              1
            )
        },
        run
      )
    );

    throwIfAborted(
      signal
    );

    return output;
  }

  function materialTextureUrls(
    materials
  ) {
    const urls = [];

    for (
      const material of
      materials
    ) {
      for (
        const key of [
          "baseColorTexture",
          "normalTexture",
          "emissiveTexture"
        ]
      ) {
        const value =
          String(
            material?.[key] ||
            ""
          ).trim();

        if (
          value &&
          !urls.includes(value)
        ) {
          urls.push(value);
        }
      }
    }

    return urls;
  }

  async function embedImages(
    gltf,
    builder,
    materials,
    warnings,
    signal = null
  ) {
    throwIfAborted(
      signal
    );
    const urls =
      materialTextureUrls(
        materials
      );

    if (!urls.length) {
      return new Map();
    }

    const budget =
      exportBudget();

    let used = 0;

    const fetched =
      await mapLimit(
        urls,
        budget.textureConcurrency,
        async (url) => {
          const result =
            await fetchImage(
              url,
              signal,
              budget
                .maxSingleTextureBytes
            );

          if (!result) {
            warnings.push(
              "A material texture could not be embedded."
            );

            return {
              url,
              result: null
            };
          }

          return {
            url,
            result
          };
        },
        signal
      );

    throwIfAborted(
      signal
    );

    const map =
      new Map();

    for (
      const item of fetched
    ) {
      throwIfAborted(
        signal
      );
      if (!item.result) {
        continue;
      }

      if (
        used +
        item.result.bytes
          .byteLength >
        budget.maxTextureBytes
      ) {
        warnings.push(
          "Some textures were skipped to stay inside this device's safe export budget."
        );

        continue;
      }

      used +=
        item.result.bytes
          .byteLength;

      const bufferView =
        addBufferView(
          gltf,
          builder,
          item.result.bytes
        );

      gltf.images.push({
        bufferView,
        mimeType:
          item.result.mime
      });

      gltf.textures.push({
        source:
          gltf.images.length -
          1
      });

      map.set(
        item.url,
        gltf.textures.length -
          1
      );
    }

    return map;
  }

  function gltfMaterial(
    material,
    textureMap
  ) {
    const baseColor =
      rgba(
        material?.baseColor,
        [1, 1, 1, 1]
      );

    const emissive =
      rgba(
        material?.emissiveColor,
        [0, 0, 0, 1]
      );

    const pbr = {
      baseColorFactor:
        baseColor,
      metallicFactor:
        clamp01(
          material?.metallic,
          0
        ),
      roughnessFactor:
        clamp01(
          material?.roughness,
          0.62
        )
    };

    const baseTexture =
      textureMap.get(
        String(
          material
            ?.baseColorTexture ||
          ""
        )
      );

    if (
      Number.isInteger(
        baseTexture
      )
    ) {
      pbr.baseColorTexture = {
        index:
          baseTexture
      };
    }

    const output = {
      name:
        cleanName(
          material?.name,
          "Material"
        ),
      pbrMetallicRoughness:
        pbr,
      doubleSided:
        Boolean(
          material?.twoSided
        )
    };

    const normalTexture =
      textureMap.get(
        String(
          material
            ?.normalTexture ||
          ""
        )
      );

    if (
      Number.isInteger(
        normalTexture
      )
    ) {
      output.normalTexture = {
        index:
          normalTexture
      };
    }

    const emissiveTexture =
      textureMap.get(
        String(
          material
            ?.emissiveTexture ||
          ""
        )
      );

    if (
      Number.isInteger(
        emissiveTexture
      )
    ) {
      output.emissiveTexture = {
        index:
          emissiveTexture
      };
    }

    if (
      emissive.some(
        (value, index) =>
          index < 3 &&
          value > 0
      )
    ) {
      output.emissiveFactor =
        emissive.slice(
          0,
          3
        );
    }

    const opacity =
      clamp01(
        material?.opacity,
        1
      );

    const mode =
      String(
        material?.opacityMode ||
        "opaque"
      ).toLowerCase();

    if (
      mode.includes("mask")
    ) {
      output.alphaMode =
        "MASK";

      output.alphaCutoff =
        clamp01(
          material?.opacityCutoff,
          0.333
        );
    } else if (
      mode.includes("blend") ||
      opacity < 0.999
    ) {
      output.alphaMode =
        "BLEND";
    } else {
      output.alphaMode =
        "OPAQUE";
    }

    return output;
  }

  async function buildGlb(
    manifest,
    options = {}
  ) {
    const signal =
      options.signal ||
      null;

    throwIfAborted(
      signal
    );

    if (
      !manifest?.geometry
    ) {
      throw new Error(
        "NovaSparx export requires mesh geometry."
      );
    }

    const positions =
      transformPositions(
        manifest.geometry
          .positions,
        signal
      );

    const normals =
      transformNormals(
        manifest.geometry
          .normals,
        signal
      );

    const uv0 =
      manifest.geometry.uv0
        ? (
            manifest.geometry
              .uv0 instanceof
              Float32Array
              ? manifest.geometry
                  .uv0
              : new Float32Array(
                  manifest.geometry
                    .uv0
                )
          )
        : null;

    const indices =
      transformIndices(
        manifest.geometry
          .indices,
        signal
      );

    if (
      positions.length < 9 ||
      indices.length < 3 ||
      indices.length % 3 !==
        0
    ) {
      throw new Error(
        "NovaSparx mesh geometry is incomplete."
      );
    }

    const vertexCount =
      positions.length / 3;

    if (
      normals &&
      normals.length !==
        positions.length
    ) {
      throw new Error(
        "NovaSparx mesh normals do not match the vertex count."
      );
    }

    if (
      uv0 &&
      uv0.length !==
        vertexCount * 2
    ) {
      throw new Error(
        "NovaSparx mesh UVs do not match the vertex count."
      );
    }

    const budget =
      exportBudget();

    const geometryBytes =
      positions.byteLength +
      indices.byteLength +
      (
        normals?.byteLength ||
        0
      ) +
      (
        uv0?.byteLength ||
        0
      );

    if (
      geometryBytes >
      budget.maxBinaryBytes
    ) {
      throw new Error(
        "This mesh is too large for a safe browser export on this device."
      );
    }

    const gltf = {
      asset: {
        version:
          "2.0",
        generator:
          "NovaSparx Web Exporter 1.0"
      },
      scene: 0,
      scenes: [
        {
          nodes: [0]
        }
      ],
      nodes: [
        {
          name:
            cleanName(
              manifest.path,
              "NovaSparx_Asset"
            ),
          mesh: 0
        }
      ],
      meshes: [
        {
          name:
            cleanName(
              manifest.path,
              "NovaSparx_Asset"
            ),
          primitives: []
        }
      ],
      materials: [],
      textures: [],
      images: [],
      accessors: [],
      bufferViews: [],
      buffers: [
        {
          byteLength: 0
        }
      ],
      extras: {
        source:
          "NovaSparx",
        originalPath:
          String(
            manifest.path ||
            options.path ||
            ""
          ),
        sourceLayer:
          String(
            options.sourceLayer ||
            ""
          ),
        lod:
          Number(
            manifest.metadata?.lod ||
            0
          )
      }
    };

    const builder =
      makeBinaryBuilder();

    const positionView =
      addBufferView(
        gltf,
        builder,
        typedBytes(
          positions
        ),
        ARRAY_BUFFER
      );

    const bounds =
      positionBounds(
        positions,
        signal
      );

    const positionAccessor =
      addAccessor(
        gltf,
        {
          bufferView:
            positionView,
          componentType:
            FLOAT,
          count:
            vertexCount,
          type:
            "VEC3",
          min:
            bounds.min,
          max:
            bounds.max
        }
      );

    let normalAccessor =
      null;

    if (normals) {
      normalAccessor =
        addAccessor(
          gltf,
          {
            bufferView:
              addBufferView(
                gltf,
                builder,
                typedBytes(
                  normals
                ),
                ARRAY_BUFFER
              ),
            componentType:
              FLOAT,
            count:
              vertexCount,
            type:
              "VEC3"
          }
        );
    }

    let uvAccessor =
      null;

    if (uv0) {
      uvAccessor =
        addAccessor(
          gltf,
          {
            bufferView:
              addBufferView(
                gltf,
                builder,
                typedBytes(
                  uv0
                ),
                ARRAY_BUFFER
              ),
            componentType:
              FLOAT,
            count:
              vertexCount,
            type:
              "VEC2"
          }
        );
    }

    const indexView =
      addBufferView(
        gltf,
        builder,
        typedBytes(
          indices
        ),
        ELEMENT_ARRAY_BUFFER
      );

    const materials =
      Array.isArray(
        manifest.materials
      )
        ? manifest.materials
        : [];

    const warnings = [];

    const textureMap =
      options.embedTextures ===
        false
        ? new Map()
        : await embedImages(
            gltf,
            builder,
            materials,
            warnings,
            signal
          );

    throwIfAborted(
      signal
    );

    gltf.materials =
      materials.map(
        (material) =>
          gltfMaterial(
            material,
            textureMap
          )
      );

    if (
      !gltf.materials.length
    ) {
      gltf.materials.push(
        gltfMaterial(
          {},
          new Map()
        )
      );
    }

    const sections =
      Array.isArray(
        manifest.sections
      ) &&
      manifest.sections.length
        ? manifest.sections
        : [
            {
              firstIndex: 0,
              indexCount:
                indices.length,
              materialIndex: 0
            }
          ];

    for (
      const section of sections
    ) {
      throwIfAborted(
        signal
      );

      const firstIndex =
        Math.max(
          0,
          Number(
            section.firstIndex ||
            0
          ) || 0
        );

      let indexCount =
        Math.max(
          0,
          Number(
            section.indexCount ||
            0
          ) || 0
        );

      indexCount =
        Math.min(
          indexCount,
          indices.length -
            firstIndex
        );

      indexCount -=
        indexCount % 3;

      if (
        indexCount <= 0
      ) {
        continue;
      }

      const indexAccessor =
        addAccessor(
          gltf,
          {
            bufferView:
              indexView,
            byteOffset:
              firstIndex * 4,
            componentType:
              UNSIGNED_INT,
            count:
              indexCount,
            type:
              "SCALAR"
          }
        );

      const attributes = {
        POSITION:
          positionAccessor
      };

      if (
        Number.isInteger(
          normalAccessor
        )
      ) {
        attributes.NORMAL =
          normalAccessor;
      }

      if (
        Number.isInteger(
          uvAccessor
        )
      ) {
        attributes.TEXCOORD_0 =
          uvAccessor;
      }

      gltf.meshes[0]
        .primitives.push({
          attributes,
          indices:
            indexAccessor,
          material:
            Math.min(
              Math.max(
                0,
                Number(
                  section
                    .materialIndex ||
                  0
                ) || 0
              ),
              gltf.materials
                .length - 1
            ),
          mode: 4
        });
    }

    if (
      !gltf.meshes[0]
        .primitives.length
    ) {
      throw new Error(
        "NovaSparx mesh sections contain no triangles."
      );
    }

    throwIfAborted(
      signal
    );

    const binary =
      builder.finish();

    throwIfAborted(
      signal
    );

    if (
      binary.byteLength >
      budget.maxBinaryBytes
    ) {
      throw new Error(
        "The UEFN-ready GLB exceeded this device's safe export budget."
      );
    }

    gltf.buffers[0]
      .byteLength =
      binary.byteLength;

    throwIfAborted(
      signal
    );

    const jsonBytes =
      new TextEncoder()
        .encode(
          JSON.stringify(
            gltf
          )
        );

    const jsonLength =
      align4(
        jsonBytes.byteLength
      );

    const binLength =
      align4(
        binary.byteLength
      );

    const totalLength =
      12 +
      8 +
      jsonLength +
      8 +
      binLength;

    const output =
      new ArrayBuffer(
        totalLength
      );

    const view =
      new DataView(
        output
      );

    const bytes =
      new Uint8Array(
        output
      );

    view.setUint32(
      0,
      GLB_MAGIC,
      true
    );

    view.setUint32(
      4,
      GLB_VERSION,
      true
    );

    view.setUint32(
      8,
      totalLength,
      true
    );

    view.setUint32(
      12,
      jsonLength,
      true
    );

    view.setUint32(
      16,
      CHUNK_JSON,
      true
    );

    bytes.fill(
      0x20,
      20,
      20 + jsonLength
    );

    bytes.set(
      jsonBytes,
      20
    );

    const binHeader =
      20 + jsonLength;

    view.setUint32(
      binHeader,
      binLength,
      true
    );

    view.setUint32(
      binHeader + 4,
      CHUNK_BIN,
      true
    );

    bytes.set(
      binary,
      binHeader + 8
    );

    throwIfAborted(
      signal
    );

    return {
      buffer:
        output,
      blob:
        new Blob(
          [output],
          {
            type:
              "model/gltf-binary"
          }
        ),
      filename:
        cleanName(
          manifest.path ||
          options.path
        ) + ".glb",
      mimeType:
        "model/gltf-binary",
      warnings
    };
  }

  function kindOf(
    classification
  ) {
    return String(
      classification?.kind ||
      classification
        ?.capabilities
        ?.kind ||
      ""
    ).toLowerCase();
  }

  function supports(
    classification
  ) {
    return [
      "texture",
      "staticmesh",
      "blueprint-visual"
    ].includes(
      kindOf(
        classification
      )
    );
  }

  async function meshTarget(
    path,
    classification,
    signal = null
  ) {
    throwIfAborted(
      signal
    );
    if (
      kindOf(
        classification
      ) !==
        "blueprint-visual"
    ) {
      return path;
    }

    const visual =
      await globalThis
        .NovaSparxAssociations
        ?.resolveVisual?.(
          path,
          null,
          {
            signal
          }
        );

    throwIfAborted(
      signal
    );

    return (
      visual?.visualPath ||
      path
    );
  }

  function buildObj(
    manifest,
    options = {}
  ) {
    const signal =
      options.signal ||
      null;

    throwIfAborted(
      signal
    );

    if (!manifest?.geometry) {
      throw new Error(
        "NovaSparx OBJ export requires mesh geometry."
      );
    }

    const positions =
      transformPositions(
        manifest.geometry
          .positions,
        signal
      );

    const normals =
      transformNormals(
        manifest.geometry
          .normals,
        signal
      );

    const uv0 =
      manifest.geometry.uv0
        ? (
            manifest.geometry
              .uv0 instanceof
              Float32Array
              ? manifest.geometry
                  .uv0
              : new Float32Array(
                  manifest.geometry
                    .uv0
                )
          )
        : null;

    const indices =
      transformIndices(
        manifest.geometry
          .indices,
        signal
      );

    if (
      positions.length < 9 ||
      indices.length < 3 ||
      indices.length % 3 !==
        0
    ) {
      throw new Error(
        "NovaSparx mesh geometry is incomplete."
      );
    }

    const vertexCount =
      positions.length / 3;

    if (
      normals &&
      normals.length !==
        positions.length
    ) {
      throw new Error(
        "NovaSparx mesh normals do not match the vertex count."
      );
    }

    if (
      uv0 &&
      uv0.length !==
        vertexCount * 2
    ) {
      throw new Error(
        "NovaSparx mesh UVs do not match the vertex count."
      );
    }

    const type =
      String(
        manifest.assetType ||
        ""
      ).toLowerCase();

    if (
      type.includes(
        "skeletalmesh"
      )
    ) {
      throw new Error(
        "OBJ download is disabled for SkeletalMesh because OBJ cannot preserve its skinning."
      );
    }

    const lines = [
      "# NovaSparx OBJ export",
      `# Original path: ${String(
        manifest.path ||
        options.path ||
        ""
      )}`,
      `# Source layer: ${String(
        options.sourceLayer ||
        ""
      )}`,
      "# Coordinates: glTF/UEFN-friendly meters",
      `o ${cleanName(
        manifest.path ||
        options.path,
        "NovaSparx_Asset"
      )}`
    ];

    for (
      let index = 0;
      index < positions.length;
      index += 3
    ) {
      if (
        (index & 12287) === 0
      ) {
        throwIfAborted(
          signal
        );
      }

      lines.push(
        `v ${positions[index]} ${positions[index + 1]} ${positions[index + 2]}`
      );
    }

    if (uv0) {
      for (
        let index = 0;
        index < uv0.length;
        index += 2
      ) {
        if (
          (index & 8191) === 0
        ) {
          throwIfAborted(
            signal
          );
        }

        lines.push(
          `vt ${uv0[index]} ${uv0[index + 1]}`
        );
      }
    }

    if (normals) {
      for (
        let index = 0;
        index < normals.length;
        index += 3
      ) {
        if (
          (index & 12287) === 0
        ) {
          throwIfAborted(
            signal
          );
        }

        lines.push(
          `vn ${normals[index]} ${normals[index + 1]} ${normals[index + 2]}`
        );
      }
    }

    const materials =
      Array.isArray(
        manifest.materials
      )
        ? manifest.materials
        : [];

    const sections =
      Array.isArray(
        manifest.sections
      ) &&
      manifest.sections.length
        ? manifest.sections
        : [
            {
              firstIndex: 0,
              indexCount:
                indices.length,
              materialIndex: 0
            }
          ];

    const faceToken =
      (rawIndex) => {
        const value =
          Number(rawIndex) +
          1;

        if (
          uv0 &&
          normals
        ) {
          return (
            value +
            "/" +
            value +
            "/" +
            value
          );
        }

        if (uv0) {
          return (
            value +
            "/" +
            value
          );
        }

        if (normals) {
          return (
            value +
            "//" +
            value
          );
        }

        return String(
          value
        );
      };

    for (
      let sectionIndex = 0;
      sectionIndex <
        sections.length;
      sectionIndex++
    ) {
      throwIfAborted(
        signal
      );

      const section =
        sections[sectionIndex] ||
        {};

      const firstIndex =
        Math.max(
          0,
          Number(
            section.firstIndex ||
            0
          ) || 0
        );

      let indexCount =
        Math.max(
          0,
          Number(
            section.indexCount ||
            0
          ) || 0
        );

      indexCount =
        Math.min(
          indexCount,
          indices.length -
            firstIndex
        );

      indexCount -=
        indexCount % 3;

      if (
        indexCount <= 0
      ) {
        continue;
      }

      const materialIndex =
        Math.min(
          Math.max(
            0,
            Number(
              section.materialIndex ||
              0
            ) || 0
          ),
          Math.max(
            0,
            materials.length -
              1
          )
        );

      const materialName =
        cleanName(
          materials[
            materialIndex
          ]?.name ||
          materials[
            materialIndex
          ]?.path ||
          `Material_${materialIndex}`,
          `Material_${materialIndex}`
        );

      lines.push(
        `g Section_${sectionIndex}`,
        `usemtl ${materialName}`
      );

      const end =
        firstIndex +
        indexCount;

      for (
        let index = firstIndex;
        index + 2 < end;
        index += 3
      ) {
        if (
          (index & 8191) === 0
        ) {
          throwIfAborted(
            signal
          );
        }

        lines.push(
          `f ${faceToken(indices[index])} ${faceToken(indices[index + 1])} ${faceToken(indices[index + 2])}`
        );
      }
    }

    throwIfAborted(
      signal
    );

    const text =
      lines.join("\n") +
      "\n";

    const bytes =
      new TextEncoder()
        .encode(text);

    if (
      bytes.byteLength >
      exportBudget()
        .maxBinaryBytes
    ) {
      throw new Error(
        "The OBJ exceeded this device's safe export budget."
      );
    }

    return {
      text,
      blob:
        new Blob(
          [bytes],
          {
            type:
              "text/plain;charset=utf-8"
          }
        ),
      filename:
        cleanName(
          manifest.path ||
          options.path
        ) +
        ".obj",
      mimeType:
        "text/plain",
      warnings: [
        "OBJ preserves geometry, normals, UV0 and material slot names, but does not embed textures."
      ]
    };
  }

  async function exportObj(
    path,
    options = {}
  ) {
    const target =
      await meshTarget(
        path,
        options.classification,
        options.signal ||
          null
      );

    throwIfAborted(
      options.signal
    );

    const resolved =
      await globalThis
        .NovaSparxLayers
        ?.resolveMesh?.(
          target,
          {
            preferHQ:
              true,
            signal:
              options.signal
          }
        );

    throwIfAborted(
      options.signal
    );

    if (
      !resolved?.manifest
    ) {
      throw new Error(
        "NovaSparx could not resolve this mesh for OBJ export."
      );
    }

    return buildObj(
      resolved.manifest,
      {
        path:
          target,
        sourceLayer:
          resolved.layer ||
          "",
        signal:
          options.signal ||
          null
      }
    );
  }

  async function exportGlb(
    path,
    options = {}
  ) {
    const target =
      await meshTarget(
        path,
        options.classification,
        options.signal ||
          null
      );

    throwIfAborted(
      options.signal
    );

    const resolved =
      await globalThis
        .NovaSparxLayers
        ?.resolveMesh?.(
          target,
          {
            preferHQ: true,
            signal:
              options.signal
          }
        );

    throwIfAborted(
      options.signal
    );

    if (
      !resolved?.manifest
    ) {
      throw new Error(
        "NovaSparx could not resolve this mesh for export."
      );
    }

    const type =
      String(
        resolved.manifest
          .assetType ||
        ""
      ).toLowerCase();

    if (
      type.includes(
        "skeletalmesh"
      )
    ) {
      throw new Error(
        "Skeletal UEFN export is not enabled until bones and skin weights are preserved."
      );
    }

    return buildGlb(
      resolved.manifest,
      {
        path:
          target,
        sourceLayer:
          resolved.layer ||
          "",
        embedTextures:
          options.embedTextures !==
          false,
        signal:
          options.signal ||
          null
      }
    );
  }

  async function exportTexture(
    path,
    options = {}
  ) {
    const signal =
      options.signal ||
      null;

    throwIfAborted(
      signal
    );

    const url =
      globalThis.NovaSparx
        ?.textureUrl?.(
          path
        );

    if (!url) {
      throw new Error(
        "NovaSparx texture export is unavailable."
      );
    }

    const requestUrl =
      textureFetchUrl(
        url
      );

    if (!requestUrl) {
      throw new Error(
        "NovaSparx texture export URL is invalid."
      );
    }

    const response =
      await fetch(
        requestUrl,
        {
          cache:
            "force-cache",
          credentials:
            "omit",
          signal:
            signal ||
            undefined,
          headers: {
            Accept:
              "image/png,image/*;q=0.8"
          }
        }
      );

    throwIfAborted(
      signal
    );

    if (!response.ok) {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        `Texture export returned HTTP ${response.status}.`
      );
    }

    const mime =
      String(
        response.headers.get(
          "content-type"
        ) ||
        "image/png"
      )
        .split(";")[0]
        .trim()
        .toLowerCase();

    if (mime !== "image/png") {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        "NovaSparx texture export did not return PNG data."
      );
    }

    const bytes =
      await readBytesBounded(
        response,
        exportBudget()
          .maxSingleTextureBytes,
        signal
      );

    const blob =
      new Blob(
        [bytes],
        {
          type:
            "image/png"
        }
      );

    throwIfAborted(
      signal
    );

    return {
      blob,
      filename:
        cleanName(path) +
        ".png",
      mimeType:
        "image/png",
      warnings: []
    };
  }

  async function exportUEFN(
    path,
    classification,
    options = {}
  ) {
    const kind =
      kindOf(
        classification
      );

    if (
      kind === "texture"
    ) {
      return exportTexture(
        path,
        options
      );
    }

    if (
      [
        "staticmesh",
        "blueprint-visual"
      ].includes(kind)
    ) {
      return exportGlb(
        path,
        {
          ...options,
          classification
        }
      );
    }

    throw new Error(
      "UEFN-ready export is not available for this asset type yet."
    );
  }

  globalThis.NovaSparxExporter =
    Object.freeze({
      version:
        "1.3.0",
      supports,
      buildGlb,
      buildObj,
      exportGlb,
      exportObj,
      exportTexture,
      exportUEFN
    });
})();
