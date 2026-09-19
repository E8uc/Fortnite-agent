(() => {
  "use strict";

  const CORE = () => globalThis.NovaSparx;
  const CACHE_NAME =
    "novasparx-device-mesh-v2";
  const IS_MOBILE =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
  const MAX_DEVICE_BYTES =
    globalThis.NovaSparxBrowserGuard
      ?.status?.()
      ?.packageLimitBytes ||
    (IS_MOBILE ? 12 : 24) * 1024 * 1024;
  const MAX_DEVICE_ENTRIES =
    IS_MOBILE ? 3 : 8;
  const MAX_MEMORY_ENTRIES =
    IS_MOBILE ? 1 : 4;

  const memory = new Map();
  let lastTrace = [];

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx request was cancelled because a newer request replaced it."
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

  function shouldAbort(
    error,
    signal
  ) {
    return Boolean(
      signal?.aborted ||
      error?.name ===
        "AbortError"
    );
  }

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
    const cacheKey =
      key(path);

    const url =
      new URL(
        `__novasparx_cache__/v2/${hash(cacheKey)}.mesh`,
        document.baseURI
      );

    // Keep the canonical path in the CacheStorage key as well as the short
    // hash. A 32-bit hash alone can collide and must never return a different
    // asset's geometry.
    url.searchParams.set(
      "path",
      cacheKey
    );

    return new Request(
      url.toString(),
      {
        method:
          "GET"
      }
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

  async function readDeviceCache(
    path,
    signal = null
  ) {
    const core = CORE();
    if (!core?.parseClientMesh) return null;

    const cache = await openDeviceCache();
    if (!cache) return null;

    try {
      const request = cacheRequest(path);
      const response = await cache.match(request);

      if (!response) return null;

      const buffer = await response.arrayBuffer();

      throwIfAborted(
        signal
      );

      if (
        buffer.byteLength < 16 ||
        buffer.byteLength > MAX_DEVICE_BYTES
      ) {
        await cache.delete(request);
        return null;
      }

      const manifest = core.parseClientMesh(buffer, path);

      globalThis.NovaSparxBrowserGuard
        ?.assertManifestBudget?.(
          manifest
        );

      return {
        manifest,
        layer: "device-cache",
        sourceLabel: "NovaSparx • device cache"
      };
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

      try {
        await cache.delete(
          cacheRequest(path)
        );
      } catch {}

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

  async function writeDeviceCache(
    path,
    buffer,
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    if (
      !(buffer instanceof ArrayBuffer) ||
      buffer.byteLength < 16 ||
      buffer.byteLength > MAX_DEVICE_BYTES
    ) {
      return;
    }

    const cache = await openDeviceCache();
    if (!cache) return;

    if (
      !await globalThis.NovaSparxBrowserGuard
        ?.canPersist?.(buffer.byteLength)
    ) {
      return;
    }

    try {
      throwIfAborted(
        signal
      );

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

      // Storage quota/private browsing must never break previews.
    }
  }

  function localParser() {
    const adapter =
      globalThis
        .NovaSparxLocalParser;

    if (
      adapter &&
      typeof adapter.resolveMesh ===
        "function"
    ) {
      try {
        const state =
          typeof adapter.status ===
            "function"
            ? adapter.status()
            : null;

        if (
          state?.registered !==
            false
        ) {
          return adapter;
        }
      } catch {}
    }

    const wasm =
      globalThis
        .NovaSparxWasm;

    if (
      wasm &&
      typeof wasm.resolveMesh ===
        "function"
    ) {
      return wasm;
    }

    return null;
  }

  async function fromLocalParser(path, options) {
    throwIfAborted(
      options?.signal
    );

    const parser = localParser();
    if (!parser) return null;

    const core = CORE();
    const result = await parser.resolveMesh(path, {
      quality: options?.preferHQ === false ? "normal" : "hq",
      transport: globalThis.NovaSparxBrowserTransport || null,
      signal: options?.signal || null
    });

    throwIfAborted(
      options?.signal
    );

    if (!result) return null;

    let manifest;

    if (result instanceof ArrayBuffer) {
      manifest = core.parseClientMesh(result, path);

      throwIfAborted(
        options?.signal
      );

      await writeDeviceCache(
        path,
        result,
        options?.signal ||
          null
      );
    } else {
      manifest = core.normalizeManifest(result, path);
    }

    globalThis.NovaSparxBrowserGuard
      ?.assertManifestBudget?.(
        manifest
      );

    return {
      manifest,
      layer: "browser-wasm",
      sourceLabel: "NovaSparx • browser parser"
    };
  }

  async function fromBackendBinary(path, options) {
    throwIfAborted(
      options?.signal
    );

    const core = CORE();
    if (!core?.clientMeshBuffer || !core?.parseClientMesh) return null;

    const buffer = await core.clientMeshBuffer(path, options);

    throwIfAborted(
      options?.signal
    );

    const manifest =
      core.parseClientMesh(
        buffer,
        path
      );

    throwIfAborted(
      options?.signal
    );

    globalThis.NovaSparxBrowserGuard
      ?.assertManifestBudget?.(
        manifest
      );

    // Store a local copy only after the package passed all validation.
    await writeDeviceCache(
      path,
      buffer,
      options?.signal ||
        null
    );

    return {
      manifest,
      layer: "backend-binary",
      sourceLabel: "NovaSparx • streamed mesh"
    };
  }

  async function fromBackendJson(path, options) {
    throwIfAborted(
      options?.signal
    );

    const core = CORE();
    if (!core?.resolve) return null;

    const manifest = await core.resolve(path, options);

    throwIfAborted(
      options?.signal
    );

    globalThis.NovaSparxBrowserGuard
      ?.assertManifestBudget?.(
        manifest
      );

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
    throwIfAborted(
      options.signal
    );

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
      throwIfAborted(
        options.signal
      );

      const cachedDevice =
        await readDeviceCache(
          cleanPath,
          options.signal ||
            null
        );

      throwIfAborted(
        options.signal
      );

      if (cachedDevice) {
        remember(cleanPath, cachedDevice.manifest, cachedDevice.layer);
        trace.push({ layer: cachedDevice.layer, state: "ready" });
        lastTrace = trace;
        return { ...cachedDevice, trace };
      }

      trace.push({ layer: "device-cache", state: "miss" });
    }

    if (options.local !== false) {
      throwIfAborted(
        options.signal
      );

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
          if (
            shouldAbort(
              error,
              options.signal
            )
          ) {
            throw abortError(
              options.signal
            );
          }

          traceError(
            trace,
            "browser-wasm",
            error
          );
        }
      } else {
        trace.push({ layer: "browser-wasm", state: "unavailable" });
      }
    }

    if (options.backend !== false) {
      throwIfAborted(
        options.signal
      );

      try {
        const binary = await fromBackendBinary(cleanPath, options);

        if (binary?.manifest) {
          remember(cleanPath, binary.manifest, binary.layer);
          trace.push({ layer: binary.layer, state: "ready" });
          lastTrace = trace;
          return { ...binary, trace };
        }
      } catch (error) {
        if (
          shouldAbort(
            error,
            options.signal
          )
        ) {
          throw abortError(
            options.signal
          );
        }

        traceError(
          trace,
          "backend-binary",
          error
        );
      }

      if (
        options.backendJson !==
          false
      ) {
        throwIfAborted(
          options.signal
        );

        try {
          const json =
            await fromBackendJson(
              cleanPath,
              options
            );

          if (json?.manifest) {
            remember(
              cleanPath,
              json.manifest,
              json.layer
            );

            trace.push({
              layer:
                json.layer,
              state:
                "ready"
            });

            lastTrace =
              trace;

            return {
              ...json,
              trace
            };
          }
        } catch (error) {
          if (
            shouldAbort(
              error,
              options.signal
            )
          ) {
            throw abortError(
              options.signal
            );
          }

          traceError(
            trace,
            "backend-json",
            error
          );
        }
      } else {
        trace.push({
          layer:
            "backend-json",
          state:
            "skipped"
        });
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

  function releaseMemory() {
    memory.clear();
  }

  async function clearDeviceCache() {
    releaseMemory();

    if ("caches" in globalThis) {
      try {
        await caches.delete(CACHE_NAME);
      } catch {}
    }
  }

  function capabilities() {
    return {
      version: "2.4.0",
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
          id: "edge-metadata-range",
          available:
            Boolean(
              globalThis
                .NovaSparxBrowserTransport
                ?.fetchRange
            ) &&
            Boolean(
              globalThis
                .NovaSparxBrowserTransport
                ?.bootstrap
            ),
          purpose: "Provide cached AES/manifest metadata and bounded byte ranges to the device parser."
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
        cacheStorage: "caches" in globalThis,
        edgeTransport:
          typeof globalThis
            .NovaSparxBrowserTransport
            ?.fetchRange ===
          "function",
        edgeBootstrap:
          typeof globalThis
            .NovaSparxBrowserTransport
            ?.bootstrap ===
          "function"
      }
    };
  }

  globalThis.NovaSparxLayers = Object.freeze({
    version: "2.4.0",
    resolveMesh,
    capabilities,
    clearDeviceCache,
    releaseMemory,
    lastTrace: () => lastTrace.map((item) => ({ ...item }))
  });
})();
