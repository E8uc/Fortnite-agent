const workerModuleUrl =
  new URL(import.meta.url);

const runtimeRevision =
  String(
    workerModuleUrl
      .searchParams
      .get("runtimeRevision") ||
    ""
  )
    .trim()
    .slice(0, 64);

const dotnetModuleUrl =
  new URL(
    "./_framework/dotnet.js",
    workerModuleUrl
  );

if (runtimeRevision) {
  dotnetModuleUrl
    .searchParams
    .set(
      "v",
      runtimeRevision
    );
}

const { dotnet } =
  await import(
    dotnetModuleUrl.href
  );

const relayAllowedHosts =
  new Set([
    "egdownload.fastly-edge.com",
    "download.epicgames.com",
    "fortnite-direct.dillycdn.com",
    "stormforge.dillycdn.com"
  ]);

function installRangeRelayFetch(relayEndpoint, assetSession = false) {
  if (!relayEndpoint) return () => {};

  const nativeFetch =
    globalThis.fetch.bind(globalThis);

  const relayUrl =
    new URL(relayEndpoint, globalThis.location.href);

  const maxRangeBytes =
    4 * 1024 * 1024;

  const maxFileBytes =
    64 * 1024 * 1024;

  const maxManifestBytes =
    64 * 1024 * 1024;

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input?.url || "";
  }

  function requestSignal(input, init) {
    return init?.signal || input?.signal || undefined;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw signal.reason ||
        new DOMException("The operation was aborted.", "AbortError");
    }
  }

  async function cancelResponse(response) {
    try { await response.body?.cancel(); } catch {}
  }

  function parseContentRange(value) {
    const match = String(value || "").match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    const [start, end, total] = match ? match.slice(1).map(Number) : [];
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(total) ||
      start < 0 || end < start || total <= end || total > maxFileBytes
    ) {
      throw new Error("Relay returned an invalid Content-Range");
    }
    return { start, end, total, length: end - start + 1 };
  }

  async function readBytesBounded(response, maxBytes, label, signal) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error(label + " returned an empty body");
    const chunks = [];
    let total = 0;
    const abort = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        throwIfAborted(signal);
        if (done) break;
        if (!value?.byteLength) continue;
        if (value.byteLength > maxBytes - total) {
          throw new Error(label + " exceeded the browser byte budget");
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } catch (error) {
      try { await reader.cancel(); } catch {}
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async function relayRange(target, start, end, signal) {
    throwIfAborted(signal);
    const url =
      new URL(relayUrl);

    url.searchParams.set("url", target.toString());
    url.searchParams.set("start", String(start));
    url.searchParams.set("end", String(end));

    const response =
      await nativeFetch(
        url,
        {
          method: "GET",
          signal,
          cache: "no-store",
          headers: {
            accept:
              "application/octet-stream,*/*;q=0.8"
          }
        }
      );

    try {
      throwIfAborted(signal);
      const rawLength = response.headers.get("content-length");
      const declared = rawLength === null ? null : Number(rawLength);
      if (rawLength !== null && (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(declared) || declared < 1)) {
        throw new Error("Relay returned an invalid Content-Length");
      }
      let interval;
      if (response.status === 206) {
        interval = parseContentRange(response.headers.get("content-range"));
        if (interval.start !== start || interval.end !== Math.min(end, interval.total - 1)) {
          throw new Error("Relay returned an unexpected byte window");
        }
      } else if (
        response.status === 200 && start === 0 && declared > 0 &&
        declared <= end + 1 && !response.headers.has("content-range")
      ) {
        interval = { start: 0, end: declared - 1, total: declared, length: declared };
      } else {
        throw new Error("Relay returned HTTP " + response.status + " without a usable byte range");
      }
      if (declared !== null && declared !== interval.length) {
        throw new Error("Relay returned an incomplete file segment");
      }
      const bytes = await readBytesBounded(response, interval.length, "Relay", signal);
      if (bytes.byteLength !== interval.length) {
        throw new Error("Relay returned an incomplete file segment");
      }
      return {
        bytes,
        interval,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        contentType: response.headers.get("content-type") || "application/octet-stream"
      };
    } catch (error) {
      await cancelResponse(response);
      throw error;
    }
  }

  const manifestCacheName =
    "novasparx-manifest-v1";

  async function openManifestCache() {
    try {
      if (
        typeof caches ===
          "undefined" ||
        typeof caches.open !==
          "function"
      ) {
        return null;
      }

      return await caches.open(
        manifestCacheName
      );
    } catch {
      return null;
    }
  }

  async function bufferManifestRelay(input, init) {
    const signal = requestSignal(input, init);
    throwIfAborted(signal);
    const key =
      new Request(
        requestUrl(input),
        {
          method: "GET"
        }
      );

    const cache =
      await openManifestCache();
    throwIfAborted(signal);

    if (cache) {
      try {
        const cached =
          await cache.match(
            key
          );
        throwIfAborted(signal);

        if (cached) {
          const declared =
            Number(
              cached.headers.get(
                "content-length"
              ) || 0
            );

          if (
            declared >= 32 &&
            declared <=
              maxManifestBytes
          ) {
            return cached;
          }

          await cache.delete(
            key
          );
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }

    throwIfAborted(signal);
    const response =
      assetSession ? new Response(await requestAssetManifest(requestUrl(input), signal)) : await nativeFetch(
        input,
        init
      );

    if (!response.ok) {
      return response;
    }

    const declared =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (declared > maxManifestBytes) {
      await cancelResponse(response);
      throw new Error(
        "Manifest relay exceeded the browser byte budget"
      );
    }

    const bytes = await readBytesBounded(response, maxManifestBytes, "Manifest relay", signal);

    if (
      bytes.byteLength < 32 ||
      bytes.byteLength >
        maxManifestBytes
    ) {
      throw new Error(
        "Manifest relay returned an invalid payload"
      );
    }

    const buffered =
      new Response(
        bytes,
        {
          status: response.status,
          headers: {
            "content-type":
              response.headers.get(
                "content-type"
              ) ||
              "application/octet-stream",
            "content-length":
              String(
                bytes.byteLength
              ),
            "x-novasparx-fetch-source":
              "manifest-buffer"
          }
        }
      );

    if (cache) {
      try {
        const keys =
          await cache.keys();

        await Promise.all(
          keys
            .filter(
              request =>
                request.url !==
                  key.url
            )
            .map(
              request =>
                cache.delete(
                  request
                )
            )
        );

        await cache.put(
          key,
          buffered.clone()
        );
      } catch {}
    }

    return buffered;
  }

  let manifestRequestId = 0;
  function requestAssetManifest(url, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const requestId = ++manifestRequestId;
      const cleanup = () => {
        globalThis.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => { cleanup(); reject(new DOMException('Asset manifest request cancelled', 'AbortError')); };
      const onMessage = event => {
        const message = event.data;
        if (message?.type !== 'manifest-bytes' || message.requestId !== requestId) return;
        cleanup();
        if (message.error) return reject(new Error(String(message.error)));
        if (!(message.bytes instanceof ArrayBuffer) || message.bytes.byteLength < 32 || message.bytes.byteLength > maxManifestBytes)
          return reject(new Error('Invalid asset manifest response'));
        resolve(new Uint8Array(message.bytes));
      };
      globalThis.addEventListener('message', onMessage);
      signal?.addEventListener('abort', onAbort, { once: true });
      try { postMessage({ type: 'manifest-request', requestId, url }); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  async function relayWhole(target, input, init) {
    const signal =
      requestSignal(input, init);

    const first =
      await relayRange(
        target,
        0,
        maxRangeBytes - 1,
        signal
      );

    if (signal?.aborted) {
      throw signal.reason ||
        new DOMException(
          "The operation was aborted.",
          "AbortError"
        );
    }

    const total = first.interval.total;

    if (
      first.bytes.byteLength !==
        Math.min(total, maxRangeBytes)
    ) {
      throw new Error(
        "Relay returned an incomplete file segment"
      );
    }

    const output =
      new Uint8Array(total);

    output.set(first.bytes, 0);

    let offset =
      first.bytes.byteLength;

    while (offset < total) {
      if (signal?.aborted) {
        throw signal.reason ||
          new DOMException(
            "The operation was aborted.",
            "AbortError"
          );
      }

      const end =
        Math.min(
          total - 1,
          offset +
            maxRangeBytes -
            1
        );

      const part =
        await relayRange(
          target,
          offset,
          end,
          signal
        );

      const expected =
        end - offset + 1;

      if (
        part.interval.total !== total ||
        part.etag !== first.etag ||
        part.lastModified !== first.lastModified ||
        part.bytes.byteLength !==
        expected
      ) {
        throw new Error(
          "Relay returned an incomplete file segment"
        );
      }

      output.set(
        part.bytes,
        offset
      );

      offset +=
        part.bytes.byteLength;
    }

    return new Response(
      output,
      {
        status: 200,
        headers: {
          "content-type":
            first.contentType,
          "content-length":
            String(total),
          "x-novasparx-fetch-source":
            "range-relay"
        }
      }
    );
  }

  globalThis.fetch =
    async (input, init = {}) => {
      const raw =
        requestUrl(input);

      let target;

      try {
        target =
          new URL(
            raw,
            globalThis.location.href
          );
      } catch {
        return nativeFetch(input, init);
      }

      const method =
        String(
          init?.method ||
          input?.method ||
          "GET"
        ).toUpperCase();

      if (
        method === "GET" &&
        target.origin ===
          relayUrl.origin &&
        target.pathname ===
          "/nova-edge/manifest"
      ) {
        return bufferManifestRelay(
          input,
          init
        );
      }

      const relayHost =
        relayAllowedHosts.has(
          target.hostname.toLowerCase()
        );

      if (
        method === "GET" &&
        relayHost &&
        target.pathname
          .toLowerCase()
          .endsWith(".chunk")
      ) {
        return relayWhole(
          target,
          input,
          init
        );
      }

      if (
        method !== "GET" ||
        target.origin ===
          globalThis.location.origin ||
        !relayHost
      ) {
        return nativeFetch(input, init);
      }

      try {
        return await nativeFetch(
          input,
          init
        );
      } catch (directError) {
        if (
          requestSignal(
            input,
            init
          )?.aborted
        ) {
          throw directError;
        }

        return await relayWhole(
          target,
          input,
          init
        );
      }
    };

  return () => {
    globalThis.fetch =
      nativeFetch;
  };
}

function fail(error) {
  try {
    postMessage({
      type: "error",
      error: String(error?.stack || error || "Unknown worker error")
    });
  } catch {}
}

try {
  const runtimeBootStartedAt = Date.now();
  const { runMain, getConfig, setModuleImports } =
    await dotnet.withDiagnosticTracing(false).create();
  postMessage({ type: 'runtime-ready', bootMs: Date.now() - runtimeBootStartedAt });

  setModuleImports("texture-view", {
    render(width, height, encoded, path) {
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width * height > 2048 * 2048
      ) {
        throw new Error("Texture pixel budget exceeded");
      }

      const raw = Uint8Array.from(
        atob(encoded),
        character => character.charCodeAt(0)
      );

      if (raw.byteLength !== width * height * 4) {
        throw new Error("RGBA byte count mismatch");
      }

      const buffer = raw.buffer;

      postMessage(
        {
          type: "pixels",
          path,
          width,
          height,
          pixels: buffer
        },
        [buffer]
      );
    }
  });

  setModuleImports("mesh-view", {
    render(encoded) {
      if (typeof encoded !== "string" || encoded.length > 24 * 1024 * 1024)
        throw new Error("Mesh output budget exceeded");
      const mesh = JSON.parse(encoded);
      if (!Array.isArray(mesh.positions) || !Array.isArray(mesh.indices) ||
          mesh.positions.length < 9 || mesh.positions.length > 750000 || mesh.positions.length % 3 ||
          mesh.indices.length < 3 || mesh.indices.length > 1500000 || mesh.indices.length % 3 ||
          mesh.positions.some(v => !Number.isFinite(v)) ||
          mesh.indices.some(v => !Number.isInteger(v) || v < 0 || v >= mesh.positions.length / 3) ||
          !Array.isArray(mesh.uv0) || mesh.uv0.length !== mesh.positions.length / 3 * 2 ||
          mesh.uv0.some(v => !Number.isFinite(v)) ||
          !Number.isInteger(mesh.materialSlotCount) || mesh.materialSlotCount < 0 || mesh.materialSlotCount > 256 ||
          !Array.isArray(mesh.materialPaths) || mesh.materialPaths.length !== mesh.materialSlotCount ||
          mesh.materialPaths.some(value => typeof value !== "string" || value.length > 1024) ||
          !Array.isArray(mesh.materialMetadata) || mesh.materialMetadata.length !== mesh.materialSlotCount ||
          mesh.materialMetadata.some(material =>
            !material || typeof material !== "object" ||
            typeof material.exportType !== "string" || material.exportType.length > 128 ||
            !Array.isArray(material.textureParameters) || material.textureParameters.length > 128 ||
            material.textureParameters.some(parameter =>
              !parameter || typeof parameter !== "object" ||
              typeof parameter.name !== "string" || parameter.name.length > 256 ||
              typeof parameter.path !== "string" || parameter.path.length > 1024 ||
              typeof parameter.packageId !== "string" || parameter.packageId.length > 16 ||
              (parameter.packageId && !/^[0-9a-f]{16}$/i.test(parameter.packageId)) ||
              !Number.isInteger(parameter.index) ||
              typeof parameter.isImport !== "boolean") ||
            !Array.isArray(material.vectorParameters) || material.vectorParameters.length > 128 ||
            material.vectorParameters.some(name => typeof name !== "string" || name.length > 256) ||
            !Array.isArray(material.scalarParameters) || material.scalarParameters.length > 256 ||
            material.scalarParameters.some(name => typeof name !== "string" || name.length > 256)))
        throw new Error("Invalid Mesh geometry or material metadata");
      const positions = new Float32Array(mesh.positions).buffer;
      const indices = new Uint32Array(mesh.indices).buffer;
      const uv0 = new Float32Array(mesh.uv0).buffer;
      postMessage({ ...mesh, type: "mesh", positions, indices, uv0 }, [positions, indices, uv0]);
    }
  });

  setModuleImports("audio-view", {
    render(format, encoded, path) {
      const cleanFormat =
        String(format || "")
          .trim()
          .toUpperCase();

      if (
        !/^[A-Z0-9_-]{2,16}$/.test(cleanFormat) ||
        typeof encoded !== "string" ||
        encoded.length < 8 ||
        encoded.length > 34 * 1024 * 1024 ||
        typeof path !== "string" ||
        !path ||
        path.length > 1024
      ) {
        throw new Error("Invalid browser audio output");
      }

      let raw;

      try {
        raw =
          Uint8Array.from(
            atob(encoded),
            character =>
              character.charCodeAt(0)
          );
      } catch {
        throw new Error(
          "Browser audio output is not valid base64"
        );
      }

      if (
        raw.byteLength < 4 ||
        raw.byteLength > 24 * 1024 * 1024 + 44
      ) {
        throw new Error(
          "Browser audio byte budget exceeded"
        );
      }

      const bytes =
        raw.buffer;

      postMessage(
        {
          type: "audio",
          path,
          format: cleanFormat,
          bytes
        },
        [bytes]
      );
    }
  });

  const workerUrl =
    new URL(
      globalThis.location.href
    );

  const requestedTest =
    workerUrl.searchParams
      .get("test");

  const meshMode =
    requestedTest ===
      "resolve-mesh-relay";

  const audioMode =
    requestedTest ===
      "resolve-audio-relay";

  const test =
    meshMode ||
    audioMode
      ? "resolve-texture-relay"
      : requestedTest;

  let restoreFetch =
    () => {};

  if (
    test ===
      "live-texture-relay" ||
    test ===
      "resolve-texture-relay"
  ) {
    restoreFetch =
      installRangeRelayFetch(
        workerUrl.searchParams
          .get("relay") ||
        "./edge/range",
        workerUrl.searchParams.get('assetSession') === '1'
      );
  }

  const liveBase =
    new URL("./live/", globalThis.location.href).toString();

  const args =
    test === "live-buildpatch"
      ? [
          "--live-buildpatch-base=" +
          liveBase
        ]
      : test === "live-texture"
        ? [
            "--live-texture-base=" +
            liveBase
          ]
        : test ===
            "live-texture-relay"
          ? [
              "--live-texture-base=" +
                liveBase,
              "--live-texture-manifest-url=" +
                String(
                  workerUrl.searchParams
                    .get("manifest") ||
                  ""
                ),
              "--live-texture-chunk-base=" +
                String(
                  workerUrl.searchParams
                    .get("chunkBase") ||
                  ""
                )
            ]
          : test ===
              "resolve-texture-relay"
            ? [
                "--resolve-texture-path=" +
                  String(
                    workerUrl.searchParams
                      .get("path") ||
                    ""
                  ),
                "--resolve-texture-toc=" +
                  String(
                    workerUrl.searchParams
                      .get("toc") ||
                    ""
                  ),
                "--resolve-texture-manifest-url=" +
                  String(
                    workerUrl.searchParams
                      .get("manifest") ||
                    ""
                  ),
                "--resolve-texture-chunk-base=" +
                  String(
                    workerUrl.searchParams
                      .get("chunkBase") ||
                    ""
                  ),
                "--resolve-texture-mappings-api=" +
                  String(
                    workerUrl.searchParams
                      .get("mappingsApi") ||
                    "https://api.fortniteapi.com/v1/mappings"
                  ),
                "--resolve-texture-aes-api=" +
                  String(
                    workerUrl.searchParams
                      .get("aesApi") ||
                    "https://export-service-new.dillyapis.com/v1/aes"
                  ),
                "--resolve-texture-package-index-base=" +
                  String(
                    workerUrl.searchParams
                      .get("packageIndexBase") ||
                    new URL(
                      "./package-id-index/",
                      globalThis.location.href
                    ).toString()
                  ),
                "--resolve-texture-max-size=" +
                  String(
                    workerUrl.searchParams
                      .get("maxSize") ||
                    "1024"
                  )
              ]
            : [];

  const mappedArgs =
    meshMode
      ? args.map(
          argument =>
            argument.replace(
              "--resolve-texture-",
              "--resolve-mesh-"
            )
        )
      : audioMode
        ? args.map(
            argument =>
              argument.replace(
                "--resolve-texture-",
                "--resolve-audio-"
              )
          )
        : args;

  const exitCode =
    await runMain(
      getConfig().mainAssemblyName,
      mappedArgs
    );

  restoreFetch?.();

  postMessage({
    type: "done",
    exitCode
  });
} catch (error) {
  fail(error);
}
