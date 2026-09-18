(() => {
  "use strict";

  const CORE = () => globalThis.NovaSparx;
  const CACHE_NAME = "novasparx-device-mesh-v1";
  const IS_MOBILE =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
  const MAX_DEVICE_BYTES =
    (IS_MOBILE ? 12 : 24) * 1024 * 1024;
  const MAX_DEVICE_ENTRIES =
    IS_MOBILE ? 3 : 8;
  const MAX_MEMORY_ENTRIES =
    IS_MOBILE ? 1 : 4;

  const memory = new Map();
  let lastTrace = [];

  function clean(path) {
    return CORE()?.cleanPath?.(path) || String(path || "").trim();
  }

  function key(path) {
    return clean(path).toLowerCase();
  }

  function hash(text) {
    let value = 2166136261;

    for (const byte of new TextEncoder().encode(String(text || ""))) {
      value ^= byte;
      value = Math.imul(value, 16777619);
    }

    return (value >>> 0).toString(16).padStart(8, "0");
  }

  function cacheRequest(path) {
    return new Request(
      new URL(
        `__novasparx_cache__/${hash(key(path))}.mesh`,
        document.baseURI
      ).toString(),
      { method: "GET" }
    );
  }

  function remember(path, manifest, layer) {
    const cacheKey = key(path);
    if (!cacheKey || !manifest) return;

    if (memory.has(cacheKey)) memory.delete(cacheKey);

    memory.set(cacheKey, {
      manifest,
      layer,
      at: Date.now()
    });

    while (memory.size > MAX_MEMORY_ENTRIES) {
      const oldest = memory.keys().next().value;
      memory.delete(oldest);
    }
  }

  function fromMemory(path) {
    const cacheKey = key(path);
    const item = memory.get(cacheKey);
    if (!item) return null;

    memory.delete(cacheKey);
    memory.set(cacheKey, item);

    return {
      manifest: item.manifest,
      layer: "device-memory",
      sourceLabel: "NovaSparx • device memory"
    };
  }

  async function openDeviceCache() {
    if (!("caches" in globalThis)) return null;

    try {
      return await caches.open(CACHE_NAME);
    } catch {
      return null;
    }
  }

  async function readDeviceCache(path) {
    const core = CORE();
    if (!core?.parseClientMesh) return null;

    const cache = await openDeviceCache();
    if (!cache) return null;

    try {
      const request = cacheRequest(path);
      const response = await cache.match(request);

      if (!response) return null;

      const buffer = await response.arrayBuffer();

      if (
        buffer.byteLength < 16 ||
        buffer.byteLength > MAX_DEVICE_BYTES
      ) {
        await cache.delete(request);
        return null;
      }

      const manifest = core.parseClientMesh(buffer, path);

      return {
        manifest,
        layer: "device-cache",
        sourceLabel: "NovaSparx • device cache"
      };
    } catch {
      return null;
    }
  }

  async function pruneDeviceCache(cache) {
    try {
      const requests = await cache.keys();

      while (requests.length > MAX_DEVICE_ENTRIES) {
        const oldest = requests.shift();
        if (oldest) await cache.delete(oldest);
      }
    } catch {
      // Cache pruning is best-effort.
    }
  }

  async function writeDeviceCache(path, buffer) {
    if (
      !(buffer instanceof ArrayBuffer) ||
      buffer.byteLength < 16 ||
      buffer.byteLength > MAX_DEVICE_BYTES
    ) {
      return;
    }

    const cache = await openDeviceCache();
    if (!cache) return;

    try {
      await cache.put(
        cacheRequest(path),
        new Response(buffer, {
          headers: {
            "content-type": "application/vnd.novasparx.mesh-v1",
            "cache-control": "private, max-age=604800",
            "x-novasparx-cached-at": String(Date.now())
          }
        })
      );

      await pruneDeviceCache(cache);
    } catch {
      // Storage quota/private browsing must never break previews.
    }
  }

  function localParser() {
    const candidate =
      globalThis.NovaSparxWasm ||
      globalThis.NovaSparxLocalParser;

    if (
      !candidate ||
      typeof candidate.resolveMesh !== "function"
    ) {
      return null;
    }

    if (
      typeof candidate.status === "function"
    ) {
      try {
        const state = candidate.status();

        if (state?.registered === false) {
          return null;
        }
      } catch {
        return null;
      }
    }

    return candidate;
  }

  async function fromLocalParser(path, options) {
    const parser = localParser();
    if (!parser) return null;

    const core = CORE();
    const result = await parser.resolveMesh(path, {
      quality: options?.preferHQ === false ? "normal" : "hq",
      transport: globalThis.NovaSparxBrowserTransport || null,
      signal: options?.signal || null
    });

    if (!result) return null;

    let manifest;

    if (result instanceof ArrayBuffer) {
      manifest = core.parseClientMesh(result, path);
      await writeDeviceCache(path, result);
    } else {
      manifest = core.normalizeManifest(result, path);
    }

    return {
      manifest,
      layer: "browser-wasm",
      sourceLabel: "NovaSparx • browser parser"
    };
  }

  async function fromBackendBinary(path, options) {
    const core = CORE();
    if (!core?.clientMeshBuffer || !core?.parseClientMesh) return null;

    const buffer = await core.clientMeshBuffer(path, options);
    const manifest = core.parseClientMesh(buffer, path);

    // Store a local copy only after the package passed all validation.
    await writeDeviceCache(path, buffer);

    return {
      manifest,
      layer: "backend-binary",
      sourceLabel: "NovaSparx • streamed mesh"
    };
  }

  async function fromBackendJson(path, options) {
    const core = CORE();
    if (!core?.resolve) return null;

    const manifest = await core.resolve(path, options);

    return {
      manifest,
      layer: "backend-json",
      sourceLabel: "NovaSparx • compatibility mesh"
    };
  }

  function traceError(trace, layer, error) {
    trace.push({
      layer,
      state: "error",
      error:
        error?.message ||
        String(error || "Unknown NovaSparx layer error.")
    });
  }

  async function resolveMesh(path, options = {}) {
    const cleanPath = clean(path);

    if (!cleanPath) {
      throw new Error("NovaSparx requires an asset path.");
    }

    const trace = [];

    const cachedMemory = fromMemory(cleanPath);
    if (cachedMemory) {
      trace.push({ layer: cachedMemory.layer, state: "ready" });
      lastTrace = trace;
      return { ...cachedMemory, trace };
    }

    if (options.deviceCache !== false) {
      const cachedDevice = await readDeviceCache(cleanPath);

      if (cachedDevice) {
        remember(cleanPath, cachedDevice.manifest, cachedDevice.layer);
        trace.push({ layer: cachedDevice.layer, state: "ready" });
        lastTrace = trace;
        return { ...cachedDevice, trace };
      }

      trace.push({ layer: "device-cache", state: "miss" });
    }

    if (options.local !== false) {
      if (localParser()) {
        try {
          const local = await fromLocalParser(cleanPath, options);

          if (local?.manifest) {
            remember(cleanPath, local.manifest, local.layer);
            trace.push({ layer: local.layer, state: "ready" });
            lastTrace = trace;
            return { ...local, trace };
          }

          trace.push({ layer: "browser-wasm", state: "miss" });
        } catch (error) {
          traceError(trace, "browser-wasm", error);
        }
      } else {
        trace.push({ layer: "browser-wasm", state: "unavailable" });
      }
    }

    if (options.backend !== false) {
      try {
        const binary = await fromBackendBinary(cleanPath, options);

        if (binary?.manifest) {
          remember(cleanPath, binary.manifest, binary.layer);
          trace.push({ layer: binary.layer, state: "ready" });
          lastTrace = trace;
          return { ...binary, trace };
        }
      } catch (error) {
        traceError(trace, "backend-binary", error);
      }

      try {
        const json = await fromBackendJson(cleanPath, options);

        if (json?.manifest) {
          remember(cleanPath, json.manifest, json.layer);
          trace.push({ layer: json.layer, state: "ready" });
          lastTrace = trace;
          return { ...json, trace };
        }
      } catch (error) {
        traceError(trace, "backend-json", error);
      }
    }

    lastTrace = trace;

    const errors = trace
      .filter((item) => item.state === "error")
      .map((item) => `${item.layer}: ${item.error}`);

    const error = new Error(
      errors.length
        ? errors.join(" | ")
        : "No NovaSparx mesh layer could resolve this asset."
    );

    error.code = "NOVASPARX_LAYERS_EXHAUSTED";
    error.trace = trace;
    throw error;
  }

  async function clearDeviceCache() {
    memory.clear();

    if ("caches" in globalThis) {
      try {
        await caches.delete(CACHE_NAME);
      } catch {}
    }
  }

  function capabilities() {
    return {
      version: "2.0.0",
      layers: [
        {
          id: "device-memory",
          available: true,
          purpose: "Reuse the current page's validated mesh."
        },
        {
          id: "device-cache",
          available: "caches" in globalThis,
          purpose: "Reuse validated mesh packages from this device."
        },
        {
          id: "browser-wasm",
          available: Boolean(localParser()),
          purpose: "Parse Fortnite data on the user's device when a local parser is installed."
        },
        {
          id: "backend-binary",
          available: Boolean(CORE()?.clientMeshBuffer),
          purpose: "Stream a compact mesh package and render it on the user's device."
        },
        {
          id: "backend-json",
          available: Boolean(CORE()?.resolve),
          purpose: "Compatibility fallback for older NovaSparx backends."
        }
      ],
      browser: {
        webAssembly: typeof WebAssembly === "object",
        webWorker: typeof Worker === "function",
        transferableArrayBuffer: typeof ArrayBuffer === "function",
        cacheStorage: "caches" in globalThis
      }
    };
  }

  globalThis.NovaSparxLayers = Object.freeze({
    version: "2.0.0",
    resolveMesh,
    capabilities,
    clearDeviceCache,
    lastTrace: () => lastTrace.map((item) => ({ ...item }))
  });
})();
