(() => {
  "use strict";

  const VERSION =
    "1.0.0";

  const RUNTIME_BASE =
    new URL(
      "novasparx-runtime/",
      document.baseURI
    );

  const LOCATION_BASE =
    new URL(
      "location-index/",
      RUNTIME_BASE
    );

  const MANIFEST_ENDPOINT =
    "https://export-service-new.dillyapis.com/v1/manifests";

  const CHUNK_BASE =
    "https://egdownload.fastly-edge.com/Builds/Fortnite/CloudDir/";

  const MAPPINGS_API =
    "https://api.fortniteapi.com/v1/mappings";

  const AES_API =
    "https://export-service-new.dillyapis.com/v1/aes";

  const MAX_METADATA_BYTES =
    4 * 1024 * 1024;

  const MAX_SHARD_GZIP_BYTES =
    3 * 1024 * 1024;

  const MAX_SHARD_JSON_BYTES =
    24 * 1024 * 1024;

  const MANIFEST_TTL_MS =
    5 * 60 * 1000;

  let locationManifest =
    null;

  let locationManifestTask =
    null;

  const shardCache =
    new Map();

  let rawManifestCache =
    null;

  let rawManifestTask =
    null;

  let activeRun =
    null;

  let activeRequest = null;

  function abortError(
    signal,
    reason =
      "cancelled"
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
      signal?.reason ||
      reason;

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

  async function readBounded(
    response,
    maxBytes,
    label,
    signal
  ) {
    if (!response.ok) {
      throw new Error(
        label +
        " returned HTTP " +
        response.status +
        "."
      );
    }

    const declared =
      Number(
        response.headers
          .get(
            "content-length"
          ) ||
        0
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
        label +
        " exceeded its byte budget."
      );
    }

    const reader =
      response.body
        ?.getReader?.();

    if (!reader) {
      const bytes =
        new Uint8Array(
          await response
            .arrayBuffer()
        );

      if (
        bytes.byteLength >
        maxBytes
      ) {
        throw new Error(
          label +
          " exceeded its byte budget."
        );
      }

      return bytes;
    }

    const chunks = [];
    let size = 0;

    try {
      for (;;) {
        throwIfAborted(
          signal
        );

        const {
          value,
          done
        } =
          await reader.read();

        if (done) {
          break;
        }

        if (!value?.byteLength) {
          continue;
        }

        size +=
          value.byteLength;

        if (
          size > maxBytes
        ) {
          throw new Error(
            label +
            " exceeded its byte budget."
          );
        }

        chunks.push(
          value
        );
      }
    } finally {
      try {
        await reader
          .cancel();
      } catch {}

      try {
        reader
          .releaseLock();
      } catch {}
    }

    const output =
      new Uint8Array(
        size
      );

    let offset = 0;

    for (
      const chunk of
      chunks
    ) {
      output.set(
        chunk,
        offset
      );

      offset +=
        chunk.byteLength;
    }

    return output;
  }

  async function fetchBytes(
    url,
    maxBytes,
    label,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    const response =
      await fetch(
        url,
        {
          method:
            "GET",
          credentials:
            "omit",
          cache:
            options.cache ||
            "force-cache",
          signal:
            options.signal ||
            undefined,
          headers: {
            Accept:
              options.accept ||
              "application/json,application/octet-stream,*/*;q=0.8"
          }
        }
      );

    return await readBounded(
      response,
      maxBytes,
      label,
      options.signal
    );
  }

  async function fetchJson(
    url,
    maxBytes,
    label,
    options = {}
  ) {
    const bytes =
      await fetchBytes(
        url,
        maxBytes,
        label,
        options
      );

    try {
      return JSON.parse(
        new TextDecoder()
          .decode(
            bytes
          )
      );
    } catch {
      throw new Error(
        label +
        " could not be decoded."
      );
    }
  }

  function normalizeInput(
    value
  ) {
    let path =
      String(
        value || ""
      )
        .trim()
        .replace(
          /\\/g,
          "/"
        );

    const quoted =
      path.match(
        /^[A-Za-z0-9_]+['"](.+)['"]$/
      );

    if (quoted?.[1]) {
      path =
        quoted[1];
    }

    path =
      path.replace(
        /^\/+/, ""
      );

    const packageMatch =
      path.match(
        /^(.+?\.(?:uasset|umap))(?:\..*)?$/i
      );

    if (
      packageMatch?.[1]
    ) {
      path =
        packageMatch[1];
    }

    // Strip Unreal object suffixes, preserving package file extensions.
    if (!packageMatch) path = path.replace(/\.[^/.]+$/, "");

    if (
      /^Game\//i.test(
        path
      )
    ) {
      path =
        "FortniteGame/Content/" +
        path.slice(
          "Game/".length
        );
    }

    if (
      !/\.(?:uasset|umap)$/i
        .test(
          path
        )
    ) {
      path +=
        ".uasset";
    }

    return path;
  }

  function lookupCandidates(
    value
  ) {
    const clean =
      normalizeInput(
        value
      );

    const output = [];
    const seen =
      new Set();

    const add =
      candidate => {
        const normalized =
          String(
            candidate || ""
          )
            .replace(
              /\\/g,
              "/"
            )
            .replace(
              /^\/+/, ""
            );

        if (
          !normalized ||
          seen.has(
            normalized.toLowerCase()
          )
        ) {
          return;
        }

        seen.add(
          normalized.toLowerCase()
        );

        output.push(
          normalized
        );
      };

    add(clean);

    if (
      /^FortniteGame\//i
        .test(
          clean
        ) === false &&
      /^Content\//i
        .test(
          clean
        )
    ) {
      add(
        "FortniteGame/" +
        clean
      );
    }

    return output;
  }

  function fnvShard(
    key
  ) {
    let hash =
      2166136261;

    const bytes =
      new TextEncoder()
        .encode(
          String(
            key || ""
          ).toLowerCase()
        );

    for (
      const byte of
      bytes
    ) {
      hash =
        Math.imul(
          hash ^ byte,
          16777619
        ) >>>
        0;
    }

    return (
      hash &
      255
    )
      .toString(
        16
      )
      .padStart(
        2,
        "0"
      );
  }

  async function getLocationManifest(
    options = {}
  ) {
    if (
      locationManifest &&
      !options.refresh
    ) {
      return locationManifest;
    }

    if (
      locationManifestTask &&
      !options.signal &&
      !options.refresh
    ) {
      return await locationManifestTask;
    }

    const request =
      (async () => {
        const data =
          await fetchJson(
            new URL(
              "manifest.json",
              LOCATION_BASE
            ),
            128 * 1024,
            "NovaSparx asset location manifest",
            {
              signal:
                options.signal,
              cache:
                options.refresh
                  ? "no-store"
                  : "force-cache"
            }
          );

        if (
          data?.schema !==
            "novasparx.asset-locations.v1" ||
          data?.hash !==
            "fnv1a32-low-byte"
        ) {
          throw new Error(
            "NovaSparx asset location index is incompatible with this runtime."
          );
        }

        locationManifest =
          data;

        return data;
      })();

    locationManifestTask =
      request;

    try {
      return await request;
    } finally {
      if (
        locationManifestTask ===
        request
      ) {
        locationManifestTask =
          null;
      }
    }
  }

  function trimShardCache() {
    const state =
      globalThis
        .NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    const limit =
      state.isIOS
        ? 2
        : state.isMobile
          ? 4
          : 8;

    while (
      shardCache.size >
      limit
    ) {
      const key =
        shardCache
          .keys()
          .next()
          .value;

      if (!key) {
        break;
      }

      shardCache.delete(
        key
      );
    }
  }

  async function getShard(
    shard,
    options = {}
  ) {
    if (
      shardCache.has(
        shard
      ) &&
      !options.refresh
    ) {
      const value =
        shardCache.get(
          shard
        );

      shardCache.delete(
        shard
      );

      shardCache.set(
        shard,
        value
      );

      return value;
    }

    if (
      typeof DecompressionStream !==
      "function"
    ) {
      const error =
        new Error(
          "This browser does not support the gzip stream required by NovaSparx Layer 8."
        );

      error.code =
        "NOVASPARX_GZIP_UNSUPPORTED";

      throw error;
    }

    const compressed =
      await fetchBytes(
        new URL(
          shard +
          ".json.gz",
          LOCATION_BASE
        ),
        MAX_SHARD_GZIP_BYTES,
        "NovaSparx asset location shard",
        {
          signal:
            options.signal,
          cache:
            options.refresh
              ? "no-store"
              : "force-cache",
          accept:
            "application/gzip,application/octet-stream,*/*;q=0.8"
        }
      );

    throwIfAborted(
      options.signal
    );

    const stream =
      new Response(
        compressed
      )
        .body
        .pipeThrough(
          new DecompressionStream(
            "gzip"
          )
        );

    const expanded =
      await readBounded(
        new Response(
          stream
        ),
        MAX_SHARD_JSON_BYTES,
        "NovaSparx expanded asset location shard",
        options.signal
      );

    let data;

    try {
      data =
        JSON.parse(
          new TextDecoder()
            .decode(
              expanded
            )
        );
    } catch {
      throw new Error(
        "NovaSparx asset location shard could not be decoded."
      );
    }

    if (
      data?.schema !==
        "novasparx.asset-locations.v1" ||
      data?.valueProperty !==
        "toc" ||
      !data?.items ||
      typeof data.items !==
        "object"
    ) {
      throw new Error(
        "NovaSparx asset location shard is invalid."
      );
    }

    shardCache.set(
      shard,
      data
    );

    trimShardCache();

    return data;
  }

  async function locate(
    path,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    await getLocationManifest(
      options
    );

    for (
      const candidate of
      lookupCandidates(
        path
      )
    ) {
      const key =
        candidate
          .toLowerCase();

      const shard =
        fnvShard(
          key
        );

      const data =
        await getShard(
          shard,
          options
        );

      throwIfAborted(
        options.signal
      );

      if (
        !Object.hasOwn(
          data.items,
          key
        )
      ) {
        continue;
      }

      const toc =
        data.items[
          key
        ];

      if (
        typeof toc !==
          "string" ||
        !/\.utoc$/i.test(
          toc
        ) ||
        toc.includes(
          ".."
        )
      ) {
        throw new Error(
          "NovaSparx asset location entry is invalid."
        );
      }

      return {
        key,
        toc:
          toc.replace(
            /\\/g,
            "/"
          ),
        shard
      };
    }

    const error =
      new Error(
        "This Fortnite asset is not present in the current NovaSparx location index."
      );

    error.code =
      "NOVASPARX_TEXTURE_LOCATION_MISSING";

    throw error;
  }

  function collectManifestCandidates(
    root
  ) {
    const urls =
      new Map();

    const ids =
      new Map();

    const addUrl =
      (
        value,
        score
      ) => {
        try {
          const url =
            new URL(
              String(
                value || ""
              )
            );

          if (
            url.protocol !==
            "https:"
          ) {
            return;
          }

          const key =
            url.toString();

          urls.set(
            key,
            Math.max(
              urls.get(
                key
              ) ??
              -Infinity,
              score
            )
          );
        } catch {}
      };

    const addId =
      (
        value,
        score
      ) => {
        const id =
          String(
            value ??
            ""
          ).trim();

        if (
          !id ||
          id.length >
            240
        ) {
          return;
        }

        ids.set(
          id,
          Math.max(
            ids.get(
              id
            ) ??
            -Infinity,
            score
          )
        );
      };

    const walk =
      node => {
        if (
          Array.isArray(
            node
          )
        ) {
          for (
            const item of
            node
          ) {
            walk(
              item
            );
          }

          return;
        }

        if (
          !node ||
          typeof node !==
            "object"
        ) {
          return;
        }

        const objectText =
          JSON.stringify(
            node
          )
            .toLowerCase();

        let baseScore = 0;

        if (
          objectText.includes(
            "windows"
          )
        ) {
          baseScore +=
            40;
        }

        if (
          objectText.includes(
            "fortnite"
          )
        ) {
          baseScore +=
            25;
        }

        if (
          objectText.includes(
            "live"
          ) ||
          objectText.includes(
            "latest"
          )
        ) {
          baseScore +=
            10;
        }

        if (
          objectText.includes(
            "android"
          ) ||
          objectText.includes(
            "ios"
          ) ||
          objectText.includes(
            "mac"
          )
        ) {
          baseScore -=
            40;
        }

        if (
          objectText.includes(
            "studio"
          ) ||
          objectText.includes(
            "uefn"
          )
        ) {
          baseScore -=
            15;
        }

        for (
          const [
            rawKey,
            value
          ] of
          Object.entries(
            node
          )
        ) {
          const key =
            rawKey
              .toLowerCase();

          if (
            typeof value ===
              "string"
          ) {
            const lower =
              value
                .toLowerCase();

            if (
              lower.includes(
                ".manifest"
              ) ||
              key.includes(
                "manifest"
              ) ||
              key.includes(
                "download"
              )
            ) {
              addUrl(
                value,
                baseScore +
                (
                  lower.includes(
                    ".manifest"
                  )
                    ? 80
                    : 0
                )
              );
            }

            if (
              key ===
                "manifestid" ||
              key ===
                "manifest_id" ||
              key ===
                "id"
            ) {
              addId(
                value,
                baseScore
              );
            }
          } else if (
            typeof value ===
              "number" &&
            (
              key ===
                "manifestid" ||
              key ===
                "manifest_id" ||
              key ===
                "id"
            )
          ) {
            addId(
              value,
              baseScore
            );
          }

          walk(
            value
          );
        }
      };

    walk(
      root
    );

    return {
      urls:
        [
          ...urls
            .entries()
        ]
          .map(
            ([
              url,
              score
            ]) => ({
              url,
              score
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              b.score -
              a.score
          ),
      ids:
        [
          ...ids
            .entries()
        ]
          .map(
            ([
              id,
              score
            ]) => ({
              id,
              score
            })
          )
          .sort(
            (
              a,
              b
            ) =>
              b.score -
              a.score
          )
    };
  }

  async function resolveRawManifestUrl(
    url =
      MANIFEST_ENDPOINT,
    options = {},
    visited =
      new Set(),
    depth = 0
  ) {
    throwIfAborted(
      options.signal
    );

    if (
      depth > 5
    ) {
      throw new Error(
        "NovaSparx manifest recursion limit reached."
      );
    }

    const normalized =
      new URL(
        url
      )
        .toString();

    if (
      /\.manifest(?:$|[?#])/i
        .test(
          normalized
        )
    ) {
      return normalized;
    }

    if (
      visited.has(
        normalized
      )
    ) {
      throw new Error(
        "NovaSparx manifest source loop detected."
      );
    }

    visited.add(
      normalized
    );

    const data =
      await fetchJson(
        normalized,
        MAX_METADATA_BYTES,
        "NovaSparx manifest metadata",
        {
          signal:
            options.signal,
          cache:
            "no-store"
        }
      );

    const candidates =
      collectManifestCandidates(
        data
      );

    for (
      const candidate of
      candidates.urls
    ) {
      if (
        /\.manifest(?:$|[?#])/i
          .test(
            candidate.url
          )
      ) {
        return candidate.url;
      }
    }

    for (
      const candidate of
      candidates.urls
    ) {
      if (
        candidate.url ===
        normalized
      ) {
        continue;
      }

      try {
        return await resolveRawManifestUrl(
          candidate.url,
          options,
          visited,
          depth + 1
        );
      } catch (
        error
      ) {
        if (
          error?.name ===
          "AbortError"
        ) {
          throw error;
        }
      }
    }

    const base =
      normalized.replace(
        /\/+$/,
        ""
      );

    for (
      const candidate of
      candidates.ids
    ) {
      try {
        return await resolveRawManifestUrl(
          base +
          "/" +
          encodeURIComponent(
            candidate.id
          ),
          options,
          visited,
          depth + 1
        );
      } catch (
        error
      ) {
        if (
          error?.name ===
          "AbortError"
        ) {
          throw error;
        }
      }
    }

    throw new Error(
      "NovaSparx could not resolve the current raw Fortnite manifest."
    );
  }

  async function currentManifestUrl(
    options = {}
  ) {
    const now =
      Date.now();

    if (
      rawManifestCache &&
      !options.refresh &&
      now -
        rawManifestCache.at <
        MANIFEST_TTL_MS
    ) {
      return rawManifestCache
        .url;
    }

    if (
      rawManifestTask &&
      !options.signal &&
      !options.refresh
    ) {
      return await rawManifestTask;
    }

    const request =
      (async () => {
        const url =
          await resolveRawManifestUrl(
            MANIFEST_ENDPOINT,
            options
          );

        rawManifestCache = {
          at:
            Date.now(),
          url
        };

        return url;
      })();

    rawManifestTask =
      request;

    try {
      return await request;
    } finally {
      if (
        rawManifestTask ===
        request
      ) {
        rawManifestTask =
          null;
      }
    }
  }

  function apiBase() {
    return String(
      globalThis
        .FNAA_CONFIG
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

  function relayEndpoint() {
    const base =
      apiBase();

    if (!base) {
      const error =
        new Error(
          "NovaSparx range relay is not configured."
        );

      error.code =
        "NOVASPARX_EDGE_UNCONFIGURED";

      throw error;
    }

    return (
      base +
      "/nova-edge/range"
    );
  }

  function workerUrl(
    location,
    manifest,
    maxSize
  ) {
    const url =
      new URL(
        "worker.js",
        RUNTIME_BASE
      );

    url.searchParams.set(
      "test",
      "resolve-texture-relay"
    );

    url.searchParams.set(
      "path",
      location.key
    );

    url.searchParams.set(
      "toc",
      location.toc
    );

    url.searchParams.set(
      "manifest",
      manifest
    );

    url.searchParams.set(
      "chunkBase",
      CHUNK_BASE
    );

    url.searchParams.set(
      "mappingsApi",
      MAPPINGS_API
    );

    url.searchParams.set(
      "aesApi",
      AES_API
    );

    url.searchParams.set(
      "maxSize",
      String(
        maxSize
      )
    );

    url.searchParams.set(
      "relay",
      relayEndpoint()
    );

    return url;
  }

  function normalizeMaxSize(
    value
  ) {
    const number =
      Math.floor(
        Number(
          value
        ) ||
        1024
      );

    return Math.max(
      128,
      Math.min(
        1024,
        number
      )
    );
  }

  function sha256Hex(
    buffer
  ) {
    if (
      !globalThis.crypto
        ?.subtle
    ) {
      return Promise.resolve(
        ""
      );
    }

    return globalThis.crypto
      .subtle
      .digest(
        "SHA-256",
        buffer
      )
      .then(
        hash =>
          Array.from(
            new Uint8Array(
              hash
            ),
            byte =>
              byte
                .toString(
                  16
                )
                .padStart(
                  2,
                  "0"
                )
          )
            .join("")
            .toUpperCase()
      );
  }

  function canvasBlob(
    width,
    height,
    pixels
  ) {
    const imageData =
      new ImageData(
        new Uint8ClampedArray(
          pixels
        ),
        width,
        height
      );

    if (
      typeof OffscreenCanvas ===
      "function"
    ) {
      const canvas =
        new OffscreenCanvas(
          width,
          height
        );

      const context =
        canvas.getContext(
          "2d"
        );

      if (!context) {
        throw new Error(
          "NovaSparx could not create an offscreen Texture canvas."
        );
      }

      context.putImageData(
        imageData,
        0,
        0
      );

      return canvas
        .convertToBlob({
          type:
            "image/png"
        });
    }

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
        "2d"
      );

    if (!context) {
      throw new Error(
        "NovaSparx could not create a Texture canvas."
      );
    }

    context.putImageData(
      imageData,
      0,
      0
    );

    return new Promise(
      (
        resolve,
        reject
      ) => {
        canvas.toBlob(
          blob => {
            if (blob) {
              resolve(
                blob
              );
            } else {
              reject(
                new Error(
                  "NovaSparx PNG encoding failed."
                )
              );
            }
          },
          "image/png"
        );
      }
    );
  }

  function runWorker(
    location,
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
      typeof Worker !==
        "function" ||
      typeof WebAssembly !==
        "object"
    ) {
      const error =
        new Error(
          "This browser does not support the NovaSparx WebAssembly Texture runtime."
        );

      error.code =
        "NOVASPARX_WASM_UNSUPPORTED";

      throw error;
    }

    const maxSize =
      normalizeMaxSize(
        options.maxSize
      );

    if (
      activeRun
    ) {
      try {
        activeRun.cancel(
          "replaced-by-new-texture"
        );
      } catch {}
    }

    const worker =
      new Worker(
        workerUrl(
          location,
          manifest,
          maxSize
        ),
        {
          type:
            "module"
        }
      );

    return new Promise(
      (
        resolve,
        reject
      ) => {
        let settled =
          false;

        let pixelsResult =
          null;

        const timeout =
          setTimeout(
            () => {
              finish(
                new Error(
                  "NovaSparx browser Texture runtime timed out."
                )
              );
            },
            120_000
          );

        const onAbort =
          () => {
            finish(
              abortError(
                signal
              )
            );
          };

        const cleanup =
          () => {
            clearTimeout(
              timeout
            );

            try {
              signal?.removeEventListener(
                "abort",
                onAbort
              );
            } catch {}

            try {
              worker.terminate();
            } catch {}

            if (
              activeRun
                ?.worker ===
              worker
            ) {
              activeRun =
                null;
            }
          };

        const finish =
          (
            error,
            value
          ) => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            cleanup();

            if (error) {
              reject(
                error
              );
            } else {
              resolve(
                value
              );
            }
          };

        activeRun = {
          worker,
          cancel:
            reason =>
              finish(
                abortError(
                  signal,
                  reason
                )
              )
        };

        signal?.addEventListener(
          "abort",
          onAbort,
          {
            once:
              true
          }
        );

        worker.onerror =
          event => {
            finish(
              new Error(
                event.message ||
                "NovaSparx Texture worker failed."
              )
            );
          };

        worker.onmessage =
          event => {
            if (settled) return;
            const message =
              event.data ||
              {};

            if (
              message.type ===
              "error"
            ) {
              finish(
                new Error(
                  message.error ||
                  "NovaSparx Texture worker failed."
                )
              );

              return;
            }

            if (
              message.type ===
              "pixels"
            ) {
              const width =
                Number(
                  message.width
                );

              const height =
                Number(
                  message.height
                );

              const pixels =
                message.pixels;

              if (
                pixelsResult ||
                typeof message.path !== "string" ||
                normalizeInput(message.path).toLowerCase() !== location.key.toLowerCase() ||
                !Number.isInteger(
                  width
                ) ||
                !Number.isInteger(
                  height
                ) ||
                width <= 0 ||
                height <= 0 ||
                width >
                  2048 ||
                height >
                  2048 ||
                !(
                  pixels instanceof
                  ArrayBuffer
                ) ||
                pixels.byteLength !==
                  width *
                  height *
                  4
              ) {
                finish(
                  new Error(
                    "NovaSparx Texture worker returned invalid or mismatched RGBA pixels."
                  )
                );

                return;
              }

              pixelsResult = {
                path:
                  String(
                    message.path ||
                    location.key
                  ),
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
                  new Error(
                    "NovaSparx Texture worker exited with code " +
                    message.exitCode +
                    "."
                  )
                );

                return;
              }

              if (
                !pixelsResult
              ) {
                finish(
                  new Error(
                    "NovaSparx Texture worker completed without pixels."
                  )
                );

                return;
              }

              finish(
                null,
                pixelsResult
              );
            }
          };
      }
    );
  }

  async function resolveTextureRequest(
    path,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    const [
      location,
      manifest
    ] =
      await Promise.all([
        locate(
          path,
          options
        ),
        currentManifestUrl(
          options
        )
      ]);

    throwIfAborted(
      options.signal
    );

    const result =
      await runWorker(
        location,
        manifest,
        options
      );

    throwIfAborted(
      options.signal
    );

    const [
      pixelsSha256,
      blob
    ] =
      await Promise.all([
        sha256Hex(
          result.pixels
        ),
        canvasBlob(
          result.width,
          result.height,
          result.pixels
        )
      ]);

    throwIfAborted(
      options.signal
    );

    return {
      path:
        result.path,
      requestedPath:
        String(
          path || ""
        ),
      width:
        result.width,
      height:
        result.height,
      pixelsSha256,
      blob,
      toc:
        location.toc,
      shard:
        location.shard,
      source:
        "browser-wasm"
    };
  }

  async function resolveTexture(path, options = {}) {
    throwIfAborted(options.signal);
    activeRequest?.abort("replaced-by-new-texture");
    const controller = new AbortController();
    activeRequest = controller;
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await resolveTextureRequest(path, { ...options, signal: controller.signal });
    } finally {
      controller.abort("texture-request-finished");
      options.signal?.removeEventListener("abort", onAbort);
      if (activeRequest === controller) activeRequest = null;
    }
  }

  function clearCaches() {
    activeRequest?.abort("texture-cache-reset");
    locationManifest =
      null;

    locationManifestTask =
      null;

    shardCache.clear();

    rawManifestCache =
      null;

    rawManifestTask =
      null;
  }

  function status() {
    return {
      version:
        VERSION,
      webAssembly:
        typeof WebAssembly ===
          "object",
      worker:
        typeof Worker ===
          "function",
      gzip:
        typeof DecompressionStream ===
          "function",
      active:
        Boolean(
          activeRun
        ),
      locationManifestCached:
        Boolean(
          locationManifest
        ),
      rawManifestCached:
        Boolean(
          rawManifestCache
        ),
      runtimeBase:
        RUNTIME_BASE
          .toString()
    };
  }

  globalThis
    .NovaSparxTextureRuntime =
    Object.freeze({
      version:
        VERSION,
      resolveTexture,
      locate,
      status,
      clearCaches
    });
})();
