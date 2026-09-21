(() => {
  "use strict";

  const LOCATION_ROOT =
    new URL(
      "novasparx-location-index/",
      document.baseURI
    );

  const WORKER_URL =
    new URL(
      "novasparx-runtime/worker.js",
      document.baseURI
    );

  const CHUNK_BASE =
    "https://egdownload.fastly-edge.com/Builds/Fortnite/CloudDir/";

  const MAPPINGS_API =
    "https://api.fortniteapi.com/v1/mappings";

  const AES_API =
    "https://export-service-new.dillyapis.com/v1/aes";

  const MAX_SHARD_BYTES =
    3 * 1024 * 1024;

  const MAX_SHARD_TEXT_BYTES =
    24 * 1024 * 1024;

  const DEFAULT_MAX_SIZE =
    1024;

  let locationManifest =
    null;

  let locationManifestTask =
    null;

  let preparedState =
    null;

  let activeRequest =
    null;

  let generation =
    0;

  const shardCache =
    new Map();

  function abortError(
    reason = "replaced"
  ) {
    const error =
      new Error(
        "NovaSparx Texture request was cancelled because a newer request replaced it."
      );

    error.name =
      "AbortError";

    error.code =
      "NOVASPARX_REQUEST_REPLACED";

    error.reason =
      reason;

    return error;
  }

  function throwIfAborted(
    signal
  ) {
    if (signal?.aborted) {
      throw abortError(
        signal.reason ||
        "cancelled"
      );
    }
  }

  function runtimeError(
    message,
    code
  ) {
    const error =
      new Error(message);

    error.code =
      code;

    return error;
  }

  function apiBase() {
    return String(
      globalThis.FNAA_CONFIG
        ?.apiEndpoint ||
      globalThis
        .FORTNITE_AI_API_ENDPOINT ||
      ""
    )
      .trim()
      .replace(
        /\/+$/,
        ""
      );
  }

  function relayUrl() {
    const base =
      apiBase();

    if (!base) {
      throw runtimeError(
        "NovaSparx edge relay is not configured.",
        "NOVASPARX_EDGE_UNCONFIGURED"
      );
    }

    return (
      base +
      "/nova-edge/range"
    );
  }

  function maxPreviewSize(
    requested = 0
  ) {
    const guard =
      globalThis
        .NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    const deviceDefault =
      guard.isIOS
        ? 512
        : guard.isMobile
          ? 768
          : DEFAULT_MAX_SIZE;

    return Math.max(
      64,
      Math.min(
        2048,
        Number(
          requested ||
          deviceDefault
        ) ||
        deviceDefault
      )
    );
  }

  function normalizePath(
    path
  ) {
    let value =
      String(path || "")
        .trim();

    if (!value) {
      return "";
    }

    const tools =
      globalThis
        .FortniteTools;

    if (
      typeof tools
        ?.toFilePath ===
      "function"
    ) {
      value =
        tools.toFilePath(
          value
        );
    }

    value =
      String(value || "")
        .replace(
          /\\/g,
          "/"
        )
        .trim();

    if (!value) {
      return "";
    }

    if (
      !/\.uasset$/i.test(
        value
      )
    ) {
      const wrapper =
        value.match(
          /^(?:[A-Za-z0-9_]+)?['"]([^'"]+)['"]$/
        );

      if (wrapper?.[1]) {
        value =
          wrapper[1];
      }

      const dot =
        value.lastIndexOf(
          "."
        );

      if (
        dot >
        value.lastIndexOf(
          "/"
        )
      ) {
        value =
          value.slice(
            0,
            dot
          );
      }

      if (
        value.startsWith(
          "/Game/"
        )
      ) {
        value =
          "FortniteGame/Content/" +
          value.slice(6);
      }

      value +=
        ".uasset";
    }

    return value
      .replace(
        /^\/+/, 
        ""
      )
      .toLowerCase();
  }

  function fnvShard(
    value
  ) {
    let hash =
      0x811c9dc5;

    const bytes =
      new TextEncoder()
        .encode(
          String(value || "")
            .toLowerCase()
        );

    for (
      const byte of
      bytes
    ) {
      hash ^=
        byte;

      hash =
        Math.imul(
          hash,
          0x01000193
        ) >>> 0;
    }

    return (
      hash &
      0xff
    )
      .toString(16)
      .padStart(
        2,
        "0"
      );
  }

  async function readBounded(
    response,
    maxBytes,
    label,
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    if (!response.ok) {
      throw runtimeError(
        label +
        " returned HTTP " +
        response.status +
        ".",
        "NOVASPARX_LOCATION_INDEX_UNAVAILABLE"
      );
    }

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

      throw runtimeError(
        label +
        " exceeded its browser memory budget.",
        "NOVASPARX_LOCATION_INDEX_TOO_LARGE"
      );
    }

    const buffer =
      await response
        .arrayBuffer();

    throwIfAborted(
      signal
    );

    if (
      buffer.byteLength >
      maxBytes
    ) {
      throw runtimeError(
        label +
        " exceeded its browser memory budget.",
        "NOVASPARX_LOCATION_INDEX_TOO_LARGE"
      );
    }

    return buffer;
  }

  async function decodeShard(
    buffer,
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    const bytes =
      new Uint8Array(
        buffer
      );

    let text;

    if (
      bytes.length >= 2 &&
      bytes[0] === 0x1f &&
      bytes[1] === 0x8b
    ) {
      if (
        typeof DecompressionStream !==
        "function"
      ) {
        throw runtimeError(
          "This browser cannot decompress the NovaSparx location index.",
          "NOVASPARX_GZIP_UNSUPPORTED"
        );
      }

      const stream =
        new Blob(
          [buffer]
        )
          .stream()
          .pipeThrough(
            new DecompressionStream(
              "gzip"
            )
          );

      const expanded =
        await new Response(
          stream
        )
          .arrayBuffer();

      throwIfAborted(
        signal
      );

      if (
        expanded.byteLength >
        MAX_SHARD_TEXT_BYTES
      ) {
        throw runtimeError(
          "NovaSparx location shard expanded beyond its browser memory budget.",
          "NOVASPARX_LOCATION_INDEX_TOO_LARGE"
        );
      }

      text =
        new TextDecoder()
          .decode(
            expanded
          );
    } else {
      if (
        bytes.byteLength >
        MAX_SHARD_TEXT_BYTES
      ) {
        throw runtimeError(
          "NovaSparx location shard exceeded its browser memory budget.",
          "NOVASPARX_LOCATION_INDEX_TOO_LARGE"
        );
      }

      text =
        new TextDecoder()
          .decode(
            bytes
          );
    }

    return JSON.parse(
      text
    );
  }

  async function loadLocationManifest(
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    if (locationManifest) {
      return locationManifest;
    }

    if (locationManifestTask) {
      return locationManifestTask;
    }

    const task =
      (async () => {
        const response =
          await fetch(
            new URL(
              "manifest.json",
              LOCATION_ROOT
            ),
            {
              cache:
                "force-cache",
              credentials:
                "same-origin",
              signal:
                signal ||
                undefined
            }
          );

        const buffer =
          await readBounded(
            response,
            128 * 1024,
            "NovaSparx location manifest",
            signal
          );

        const data =
          JSON.parse(
            new TextDecoder()
              .decode(
                buffer
              )
          );

        if (
          data?.schema !==
            "novasparx.asset-locations.v1" ||
          data?.hash !==
            "fnv1a32-low-byte" ||
          Number(
            data?.entries ||
            0
          ) < 1
        ) {
          throw runtimeError(
            "NovaSparx location index metadata is invalid.",
            "NOVASPARX_LOCATION_INDEX_INVALID"
          );
        }

        locationManifest =
          data;

        return data;
      })();

    locationManifestTask =
      task;

    try {
      return await task;
    } finally {
      if (
        locationManifestTask ===
        task
      ) {
        locationManifestTask =
          null;
      }
    }
  }

  function shardLimit() {
    const guard =
      globalThis
        .NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    return guard.isIOS
      ? 3
      : guard.isMobile
        ? 5
        : 10;
  }

  function rememberShard(
    key,
    value
  ) {
    shardCache.delete(
      key
    );

    shardCache.set(
      key,
      value
    );

    while (
      shardCache.size >
      shardLimit()
    ) {
      const oldest =
        shardCache.keys()
          .next()
          .value;

      shardCache.delete(
        oldest
      );
    }
  }

  async function loadShard(
    shard,
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    if (
      shardCache.has(
        shard
      )
    ) {
      const cached =
        shardCache.get(
          shard
        );

      rememberShard(
        shard,
        cached
      );

      return cached;
    }

    const response =
      await fetch(
        new URL(
          shard +
          ".json.gz",
          LOCATION_ROOT
        ),
        {
          cache:
            "force-cache",
          credentials:
            "same-origin",
          signal:
            signal ||
            undefined
        }
      );

    const buffer =
      await readBounded(
        response,
        MAX_SHARD_BYTES,
        "NovaSparx location shard",
        signal
      );

    const data =
      await decodeShard(
        buffer,
        signal
      );

    if (
      data?.schema !==
        "novasparx.asset-locations.v1" ||
      !data?.items ||
      typeof data.items !==
        "object"
    ) {
      throw runtimeError(
        "NovaSparx location shard is invalid.",
        "NOVASPARX_LOCATION_INDEX_INVALID"
      );
    }

    rememberShard(
      shard,
      data.items
    );

    return data.items;
  }

  async function locate(
    path,
    signal = null
  ) {
    const key =
      normalizePath(
        path
      );

    if (!key) {
      throw runtimeError(
        "Texture path is empty.",
        "NOVASPARX_TEXTURE_PATH_INVALID"
      );
    }

    await loadLocationManifest(
      signal
    );

    const shard =
      fnvShard(
        key
      );

    const items =
      await loadShard(
        shard,
        signal
      );

    const toc =
      String(
        items[key] ||
        ""
      )
        .trim();

    if (!toc) {
      throw runtimeError(
        "This Texture is not present in the current NovaSparx IoStore location index.",
        "NOVASPARX_TEXTURE_LOCATION_NOT_FOUND"
      );
    }

    return {
      path:
        key,
      toc:
        toc.replace(
          /\\/g,
          "/"
        )
    };
  }

  function looksLikeJson(
    buffer
  ) {
    const bytes =
      new Uint8Array(
        buffer
      );

    for (
      const byte of
      bytes
    ) {
      if (
        byte === 9 ||
        byte === 10 ||
        byte === 13 ||
        byte === 32
      ) {
        continue;
      }

      return (
        byte === 0x7b ||
        byte === 0x5b
      );
    }

    return true;
  }

  async function resolveManifestUrl(
    transport,
    signal = null
  ) {
    if (
      typeof transport
        ?.manifestSources !==
      "function" ||
      typeof transport
        ?.fetchRange !==
      "function"
    ) {
      throw runtimeError(
        "NovaSparx browser transport cannot resolve the current Fortnite manifest.",
        "NOVASPARX_MANIFEST_TRANSPORT_UNAVAILABLE"
      );
    }

    const sources =
      await transport
        .manifestSources({
          signal
        });

    throwIfAborted(
      signal
    );

    const unique =
      [
        ...new Set(
          (
            Array.isArray(
              sources
            )
              ? sources
              : []
          )
            .map(
              value =>
                String(
                  value || ""
                ).trim()
            )
            .filter(Boolean)
        )
      ].slice(
        0,
        16
      );

    let lastError =
      null;

    for (
      const source of
      unique
    ) {
      throwIfAborted(
        signal
      );

      try {
        const probe =
          await transport
            .fetchRange(
              source,
              0,
              63,
              {
                signal,
                cache:
                  "no-store"
              }
            );

        if (
          probe?.buffer instanceof
            ArrayBuffer &&
          probe.buffer.byteLength >=
            16 &&
          !looksLikeJson(
            probe.buffer
          )
        ) {
          return source;
        }
      } catch (error) {
        if (
          signal?.aborted ||
          error?.name ===
            "AbortError"
        ) {
          throw abortError(
            signal?.reason ||
            "cancelled"
          );
        }

        lastError =
          error;
      }
    }

    throw runtimeError(
      "NovaSparx could not resolve a current raw Fortnite BuildPatch manifest." +
      (
        lastError?.message
          ? " " +
            lastError.message
          : ""
      ),
      "NOVASPARX_MANIFEST_UNAVAILABLE"
    );
  }

  async function rgbaToPng(
    width,
    height,
    pixels,
    signal = null
  ) {
    throwIfAborted(
      signal
    );

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      width;

    canvas.height =
      height;

    const context =
      canvas.getContext(
        "2d",
        {
          alpha:
            true,
          willReadFrequently:
            false
        }
      );

    if (!context) {
      throw runtimeError(
        "The browser could not create a Texture canvas.",
        "NOVASPARX_CANVAS_UNAVAILABLE"
      );
    }

    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(
          pixels
        ),
        width,
        height
      ),
      0,
      0
    );

    const blob =
      await new Promise(
        (resolve) =>
          canvas.toBlob(
            resolve,
            "image/png"
          )
      );

    throwIfAborted(
      signal
    );

    if (
      !(blob instanceof Blob) ||
      blob.size < 1
    ) {
      throw runtimeError(
        "The browser could not encode the decoded Texture.",
        "NOVASPARX_PNG_ENCODE_FAILED"
      );
    }

    return blob;
  }

  function cancelActive(
    reason =
      "replaced"
  ) {
    const current =
      activeRequest;

    if (!current) {
      return;
    }

    activeRequest =
      null;

    try {
      current.worker
        ?.terminate?.();
    } catch {}

    try {
      current.reject?.(
        abortError(
          reason
        )
      );
    } catch {}
  }

  async function prepare(
    context = {}
  ) {
    throwIfAborted(
      context.signal
    );

    if (
      typeof WebAssembly !==
        "object" ||
      typeof Worker !==
        "function"
    ) {
      throw runtimeError(
        "This browser does not provide the WebAssembly Worker runtime required by NovaSparx.",
        "NOVASPARX_WASM_UNAVAILABLE"
      );
    }

    const transport =
      context.transport ||
      globalThis
        .NovaSparxBrowserTransport ||
      null;

    const [
      index,
      manifestUrl
    ] =
      await Promise.all([
        loadLocationManifest(
          context.signal ||
          null
        ),
        resolveManifestUrl(
          transport,
          context.signal ||
          null
        )
      ]);

    throwIfAborted(
      context.signal
    );

    const state = {
      manifestUrl,
      locationVersion:
        String(
          index.fortniteVersion ||
          ""
        ),
      relay:
        relayUrl(),
      chunkBase:
        CHUNK_BASE
    };

    preparedState =
      state;

    return state;
  }

  async function resolveTexture(
    path,
    options = {}
  ) {
    const signal =
      options.signal ||
      null;

    throwIfAborted(
      signal
    );

    const parserState =
      options.parserState ||
      preparedState ||
      await prepare({
        ...options,
        transport:
          options.transport ||
          globalThis
            .NovaSparxBrowserTransport ||
          null,
        signal
      });

    const location =
      await locate(
        path,
        signal
      );

    throwIfAborted(
      signal
    );

    const thisGeneration =
      ++generation;

    cancelActive(
      "replaced-by-new-texture"
    );

    const workerUrl =
      new URL(
        WORKER_URL
      );

    workerUrl.searchParams.set(
      "test",
      "resolve-texture-relay"
    );

    workerUrl.searchParams.set(
      "path",
      location.path
    );

    workerUrl.searchParams.set(
      "toc",
      location.toc
    );

    workerUrl.searchParams.set(
      "manifest",
      parserState.manifestUrl
    );

    workerUrl.searchParams.set(
      "chunkBase",
      parserState.chunkBase ||
      CHUNK_BASE
    );

    workerUrl.searchParams.set(
      "mappingsApi",
      MAPPINGS_API
    );

    workerUrl.searchParams.set(
      "aesApi",
      AES_API
    );

    workerUrl.searchParams.set(
      "maxSize",
      String(
        maxPreviewSize(
          options.maxPreviewSize
        )
      )
    );

    workerUrl.searchParams.set(
      "relay",
      parserState.relay ||
      relayUrl()
    );

    const worker =
      new Worker(
        workerUrl,
        {
          type:
            "module"
        }
      );

    return await new Promise(
      (resolve, reject) => {
        let settled =
          false;

        let pixelsResult =
          null;

        const timeoutMs =
          globalThis
            .NovaSparxBrowserGuard
            ?.status?.()
            ?.isMobile
            ? 240_000
            : 300_000;

        const finish =
          (
            error,
            value
          ) => {
            if (settled) {
              return;
            }

            settled =
              true;

            clearTimeout(
              timer
            );

            signal
              ?.removeEventListener?.(
                "abort",
                onAbort
              );

            try {
              worker.terminate();
            } catch {}

            if (
              activeRequest
                ?.generation ===
              thisGeneration
            ) {
              activeRequest =
                null;
            }

            if (error) {
              reject(error);
            } else {
              resolve(value);
            }
          };

        const onAbort =
          () =>
            finish(
              abortError(
                signal?.reason ||
                "cancelled"
              )
            );

        const timer =
          setTimeout(
            () =>
              finish(
                runtimeError(
                  "NovaSparx Texture parsing timed out.",
                  "NOVASPARX_TEXTURE_TIMEOUT"
                )
              ),
            timeoutMs
          );

        activeRequest = {
          generation:
            thisGeneration,
          worker,
          reject:
            (error) =>
              finish(error)
        };

        signal
          ?.addEventListener?.(
            "abort",
            onAbort,
            {
              once:
                true
            }
          );

        worker.onerror =
          (event) =>
            finish(
              runtimeError(
                event.message ||
                "NovaSparx Texture Worker failed.",
                "NOVASPARX_TEXTURE_WORKER_FAILED"
              )
            );

        worker.onmessage =
          (event) => {
            const message =
              event.data ||
              {};

            if (
              activeRequest
                ?.generation !==
              thisGeneration
            ) {
              return;
            }

            if (
              message.type ===
              "error"
            ) {
              finish(
                runtimeError(
                  message.error ||
                  "NovaSparx Texture Worker failed.",
                  "NOVASPARX_TEXTURE_PARSE_FAILED"
                )
              );

              return;
            }

            if (
              message.type ===
              "pixels"
            ) {
              const {
                path:
                  returnedPath,
                width,
                height,
                pixels
              } =
                message;

              if (
                !(
                  pixels instanceof
                  ArrayBuffer
                ) ||
                width <= 0 ||
                height <= 0 ||
                width > 2048 ||
                height > 2048 ||
                pixels.byteLength !==
                  width *
                  height *
                  4
              ) {
                finish(
                  runtimeError(
                    "NovaSparx Texture Worker returned an invalid RGBA frame.",
                    "NOVASPARX_TEXTURE_PIXELS_INVALID"
                  )
                );

                return;
              }

              pixelsResult = {
                path:
                  returnedPath ||
                  location.path,
                width,
                height,
                pixels
              };

              return;
            }

            if (
              message.type ===
              "done"
            ) {
              if (
                Number(
                  message.exitCode
                ) !== 0
              ) {
                finish(
                  runtimeError(
                    "NovaSparx Texture Worker exited before producing a valid image.",
                    "NOVASPARX_TEXTURE_PARSE_FAILED"
                  )
                );

                return;
              }

              if (
                !pixelsResult
              ) {
                finish(
                  runtimeError(
                    "NovaSparx Texture Worker completed without pixels.",
                    "NOVASPARX_TEXTURE_PIXELS_MISSING"
                  )
                );

                return;
              }

              Promise.resolve()
                .then(
                  async () => {
                    const blob =
                      await rgbaToPng(
                        pixelsResult.width,
                        pixelsResult.height,
                        pixelsResult.pixels,
                        signal
                      );

                    throwIfAborted(
                      signal
                    );

                    finish(
                      null,
                      {
                        ...pixelsResult,
                        blob,
                        container:
                          location.toc,
                        source:
                          "browser-wasm"
                      }
                    );
                  }
                )
                .catch(
                  (error) =>
                    finish(
                      error
                    )
                );
            }
          };
      }
    );
  }

  function reset() {
    generation++;

    cancelActive(
      "runtime-reset"
    );

    preparedState =
      null;

    locationManifest =
      null;

    locationManifestTask =
      null;

    shardCache.clear();
  }

  function status() {
    return {
      version:
        "1.0.0",
      ready:
        Boolean(
          preparedState
        ),
      texture:
        true,
      worker:
        typeof Worker ===
        "function",
      webAssembly:
        typeof WebAssembly ===
        "object",
      locationShards:
        shardCache.size,
      active:
        Boolean(
          activeRequest
        )
    };
  }

  const engine =
    Object.freeze({
      name:
        "NovaSparx Browser Texture Runtime",
      version:
        "1.0.0",
      requiresBootstrap:
        true,
      prepare,
      resolveTexture,
      reset,
      status
    });

  globalThis
    .NovaSparxTextureRuntime =
    Object.freeze({
      version:
        "1.0.0",
      prepare,
      resolveTexture,
      locate,
      reset,
      status
    });

  if (
    typeof globalThis
      .NovaSparxLocalParser
      ?.register ===
    "function"
  ) {
    globalThis
      .NovaSparxLocalParser
      .register(
        engine
      );
  }
})();
