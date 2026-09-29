(() => {
  "use strict";

  const VERSION =
    "1.0.0";

  const SCRIPT_REVISION =
    (() => {
      try {
        const source =
          document.currentScript
            ?.src ||
          document.baseURI;

        return (
          new URL(
            source,
            document.baseURI
          )
            .searchParams
            .get("v") ||
          VERSION
        );
      } catch {
        return VERSION;
      }
    })();

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

  const STUDIO_LOCATION_BASE =
    new URL(
      "studio-location-index/",
      RUNTIME_BASE
    );

  const MANIFEST_ENDPOINT =
    "https://export-service-new.dillyapis.com/v1/manifests";

  const DIRECT_CHUNK_BASE =
    "https://egdownload.fastly-edge.com/Builds/Fortnite/CloudDir/";

  const MAPPINGS_API =
    new URL(
      "mappings/current.usmap",
      RUNTIME_BASE
    ).href;

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

  let studioLocationManifest =
    null;

  let studioLocationManifestTask =
    null;

  const shardCache =
    new Map();

  const studioShardCache =
    new Map();

  let rawManifestCache =
    null;

  let rawManifestTask =
    null;

  let studioRawManifestCache =
    null;

  let studioRawManifestTask =
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

  function locationBase(
    family
  ) {
    return family ===
      "studio"
      ? STUDIO_LOCATION_BASE
      : LOCATION_BASE;
  }

  async function getLocationManifest(
    options = {},
    family = "live"
  ) {
    const studio =
      family ===
      "studio";

    const cached =
      studio
        ? studioLocationManifest
        : locationManifest;

    const pending =
      studio
        ? studioLocationManifestTask
        : locationManifestTask;

    if (
      cached &&
      !options.refresh
    ) {
      return cached;
    }

    if (
      pending &&
      !options.signal &&
      !options.refresh
    ) {
      return await pending;
    }

    const request =
      (async () => {
        const data =
          await fetchJson(
            new URL(
              "manifest.json",
              locationBase(
                family
              )
            ),
            128 * 1024,
            studio
              ? "NovaSparx Fortnite Studio location manifest"
              : "NovaSparx asset location manifest",
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

        if (studio) {
          studioLocationManifest =
            data;
        } else {
          locationManifest =
            data;
        }

        return data;
      })();

    if (studio) {
      studioLocationManifestTask =
        request;
    } else {
      locationManifestTask =
        request;
    }

    try {
      return await request;
    } finally {
      if (
        studio &&
        studioLocationManifestTask ===
          request
      ) {
        studioLocationManifestTask =
          null;
      }

      if (
        !studio &&
        locationManifestTask ===
          request
      ) {
        locationManifestTask =
          null;
      }
    }
  }

  function trimShardCache(
    cache
  ) {
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
      cache.size >
      limit
    ) {
      const key =
        cache
          .keys()
          .next()
          .value;

      if (!key) {
        break;
      }

      cache.delete(
        key
      );
    }
  }

  async function getShard(
    shard,
    options = {},
    family = "live"
  ) {
    const studio =
      family ===
      "studio";

    const cache =
      studio
        ? studioShardCache
        : shardCache;

    if (
      cache.has(
        shard
      ) &&
      !options.refresh
    ) {
      const value =
        cache.get(
          shard
        );

      cache.delete(
        shard
      );

      cache.set(
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
          locationBase(
            family
          )
        ),
        MAX_SHARD_GZIP_BYTES,
        studio
          ? "NovaSparx Fortnite Studio location shard"
          : "NovaSparx asset location shard",
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
        studio
          ? "NovaSparx expanded Fortnite Studio location shard"
          : "NovaSparx expanded asset location shard",
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

    cache.set(
      shard,
      data
    );

    trimShardCache(
      cache
    );

    return data;
  }

  async function locate(
    path,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    for (
      const family of [
        "live",
        "studio"
      ]
    ) {
      let manifest;

      try {
        manifest =
          await getLocationManifest(
            options,
            family
          );
      } catch (error) {
        if (
          family ===
            "live" ||
          error?.name ===
            "AbortError"
        ) {
          throw error;
        }

        continue;
      }

      if (
        !manifest ||
        Number(
          manifest.entries ||
          0
        ) < 1
      ) {
        continue;
      }

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
            options,
            family
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
          shard,
          manifestFamily:
            family
        };
      }
    }

    const error =
      new Error(
        "This Fortnite asset is not present in the current NovaSparx core or Fortnite Studio location index."
      );

    error.code =
      "NOVASPARX_TEXTURE_LOCATION_MISSING";

    throw error;
  }

  function collectManifestCandidates(
    root,
    family = "live"
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

        const studioCandidate =
          objectText.includes(
            "studio"
          ) ||
          objectText.includes(
            "uefn"
          );

        if (
          family ===
            "studio"
        ) {
          baseScore +=
            studioCandidate
              ? 140
              : -120;
        } else if (
          studioCandidate
        ) {
          baseScore -=
            80;
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
    depth = 0,
    family = "live"
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
        data,
        family
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
          depth + 1,
          family
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
          depth + 1,
          family
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
    const family =
      options.family ===
        "studio"
        ? "studio"
        : "live";

    const studio =
      family ===
        "studio";

    const now =
      Date.now();

    const cached =
      studio
        ? studioRawManifestCache
        : rawManifestCache;

    const pending =
      studio
        ? studioRawManifestTask
        : rawManifestTask;

    if (
      cached &&
      !options.refresh &&
      now -
        cached.at <
        MANIFEST_TTL_MS
    ) {
      return cached.url;
    }

    if (
      pending &&
      !options.signal &&
      !options.refresh
    ) {
      return await pending;
    }

    const request =
      (async () => {
        const url =
          await resolveRawManifestUrl(
            MANIFEST_ENDPOINT,
            options,
            new Set(),
            0,
            family
          );

        const value = {
          at:
            Date.now(),
          url
        };

        if (studio) {
          studioRawManifestCache =
            value;
        } else {
          rawManifestCache =
            value;
        }

        return url;
      })();

    if (studio) {
      studioRawManifestTask =
        request;
    } else {
      rawManifestTask =
        request;
    }

    try {
      return await request;
    } finally {
      if (
        studio &&
        studioRawManifestTask ===
          request
      ) {
        studioRawManifestTask =
          null;
      }

      if (
        !studio &&
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

  function chunkBaseUrl() {
    const base =
      apiBase();

    return base
      ? base +
          "/nova-edge/chunk/"
      : DIRECT_CHUNK_BASE;
  }

  function manifestRelayUrl(
    manifest
  ) {
    const base =
      apiBase();

    if (!base) {
      return manifest;
    }

    const url =
      new URL(
        base +
        "/nova-edge/manifest"
      );

    url.searchParams.set(
      "url",
      manifest
    );

    return url.href;
  }

  function workerUrl(
    location,
    manifest,
    maxSize,
    mode = "texture"
  ) {
    const url =
      new URL(
        "worker.js",
        RUNTIME_BASE
      );

    url.searchParams.set(
      "test",
      mode === "mesh" ? "resolve-mesh-relay" : "resolve-texture-relay"
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
      manifestRelayUrl(
        manifest
      )
    );

    url.searchParams.set(
      "chunkBase",
      chunkBaseUrl()
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

    url.searchParams.set(
      "runtimeRevision",
      SCRIPT_REVISION
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
          maxSize,
          options.mode
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

            if (message.type === "mesh" && options.mode === "mesh") {
              const count = message.positions?.byteLength / 12;
              if (pixelsResult || normalizeInput(message.path).toLowerCase() !== location.key.toLowerCase() ||
                  !(message.positions instanceof ArrayBuffer) || !(message.indices instanceof ArrayBuffer) ||
                  !(message.uv0 instanceof ArrayBuffer) || !Number.isInteger(count) || count < 3 || count > 250000 ||
                  message.indices.byteLength < 12 || message.indices.byteLength > 6000000 || message.indices.byteLength % 12 ||
                  message.uv0.byteLength !== count * 8 || !Array.isArray(message.sections) || message.sections.length > 64 ||
                  !Array.isArray(message.materialMetadata) || message.materialMetadata.length > 24) {
                finish(new Error("Invalid or mismatched Mesh output")); return;
              }
              const positions = new Float32Array(message.positions), indices = new Uint32Array(message.indices), uv0 = new Float32Array(message.uv0);
              if (positions.some(v => !Number.isFinite(v)) || uv0.some(v => !Number.isFinite(v)) || indices.some(v => v >= count) ||
                  message.sections.some(s => !Number.isInteger(s.firstIndex) || !Number.isInteger(s.numTriangles) || s.firstIndex < 0 || s.numTriangles < 0 || s.firstIndex+s.numTriangles*3>indices.length)) {
                finish(new Error("Mesh geometry bounds are invalid")); return;
              }
              pixelsResult = message; return;
            }
            if (message.type === "pixels" && options.mode === "mesh") { finish(new Error("Mesh request returned unrelated pixels")); return; }
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

  async function locatePackage(id, options) {
    const key = String(id || '').toLowerCase();
    if (!/^[a-f0-9]{16}$/.test(key)) throw new Error('Invalid material Texture package ID');
    const base = new URL('package-id-index/', RUNTIME_BASE);
    const [meta, paths] = await Promise.all([
      fetchJson(new URL('manifest.json', base), 128*1024, 'Package ID manifest', options), getLocationManifest(options)
    ]);
    if (meta.schema !== 'novasparx.package-locations.v1' || meta.hash !== 'package-id-low-byte' ||
        meta.valueProperty !== 'path-tab-toc' || meta.fortniteVersion !== paths.fortniteVersion)
      throw new Error('Material index build or schema mismatch');
    const compressed = await fetchBytes(new URL(key.slice(-2)+'.json.gz', base), MAX_SHARD_GZIP_BYTES, 'Package ID shard', options);
    const expanded = await readBounded(new Response(new Response(compressed).body.pipeThrough(new DecompressionStream('gzip'))), MAX_SHARD_JSON_BYTES, 'Expanded package ID shard', options.signal);
    const data = JSON.parse(new TextDecoder().decode(expanded));
    if (data.schema !== meta.schema || data.valueProperty !== meta.valueProperty) throw new Error('Invalid package ID shard');
    const value = data.items?.[key];
    if (typeof value !== 'string') throw new Error('Material Texture is absent from package index');
    const [path, toc, extra] = value.split('\t');
    if (extra || !path?.endsWith('.uasset') || !toc?.endsWith('.utoc') || path.includes('..') || toc.includes('..')) throw new Error('Invalid material Texture location');
    return {key:path, toc};
  }

  function baseColorParameter(material) {
    const ranked =
      (material?.textureParameters || [])
        .filter(parameter =>
          /^[a-f0-9]{16}$/i.test(
            String(parameter?.packageId || "")
          ) ||
          Boolean(
            String(parameter?.path || "")
              .trim()
          )
        )
        .map(parameter => {
          const name =
            String(parameter?.name || "")
              .trim()
              .toLowerCase();

          let score =
            -1;

          if (
            /lut|lookup/.test(name) ||
            /normal/.test(name) ||
            /emissive/.test(name) ||
            /opacity|mask/.test(name) ||
            /rough|metal|spec/.test(name)
          ) {
            score =
              -1;
          } else if (
            name === "pm_diffuse"
          ) {
            // CUE4Parse/FModel canonical effective diffuse fallback.
            score =
              140;
          } else if (
            /^(base[ _]?colou?r|diffuse|albedo)([ _]?texture)?$/.test(name)
          ) {
            score =
              120;
          } else if (
            name.includes("decorator")
          ) {
            score =
              95;
          } else if (
            name.includes("color") ||
            name.includes("colour")
          ) {
            score =
              85;
          }

          return {
            parameter,
            score,
            name
          };
        })
        .filter(item =>
          item.score >=
          85
        )
        .sort((left, right) =>
          right.score -
            left.score ||
          left.name.localeCompare(
            right.name
          ) ||
          String(
            left.parameter
              ?.packageId ||
            ""
          ).localeCompare(
            String(
              right.parameter
                ?.packageId ||
              ""
            )
          )
        );

    return ranked[0]
      ?.parameter ||
      null;
  }

  async function resolveMeshImage(path, options = {}) {
    throwIfAborted(options.signal);
    activeRequest?.abort('replaced-by-new-mesh');

    const controller = new AbortController();
    activeRequest = controller;

    const onAbort = () =>
      controller.abort(
        options.signal?.reason
      );

    options.signal?.addEventListener(
      'abort',
      onAbort,
      {once:true}
    );

    const request = {
      ...options,
      signal:
        controller.signal
    };

    let requestFinished =
      false;

    const finishRequest =
      reason => {
        if (requestFinished) {
          return;
        }

        requestFinished =
          true;

        controller.abort(
          reason ||
          'mesh-request-finished'
        );

        options.signal
          ?.removeEventListener(
            'abort',
            onAbort
          );

        if (
          activeRequest ===
          controller
        ) {
          activeRequest =
            null;
        }
      };

    try {
      const [
        location,
        manifest
      ] =
        await Promise.all([
          locate(
            path,
            request
          ),
          currentManifestUrl(
            request
          )
        ]);

      throwIfAborted(
        request.signal
      );

      const mesh =
        await runWorker(
          location,
          manifest,
          {
            ...request,
            mode:
              'mesh'
          }
        );

      throwIfAborted(
        request.signal
      );

      if (
        !globalThis
          .NovaSparxRenderer
          ?.render
      ) {
        throw new Error(
          'Mesh image renderer is unavailable'
        );
      }

      const materialCount =
        Array.isArray(
          mesh.materialMetadata
        )
          ? mesh
              .materialMetadata
              .length
          : 0;

      const geometry = {
        positions:
          new Float32Array(
            mesh.positions
          ),
        indices:
          new Uint32Array(
            mesh.indices
          ),
        uv0:
          new Float32Array(
            mesh.uv0
          )
      };

      const sections =
        mesh.sections.map(
          section => ({
            ...section,
            indexCount:
              section.numTriangles *
              3
          })
        );

      // First frame: show the verified CUE4Parse Mesh immediately.
      // Texture + Material fidelity is upgraded below using the same
      // browser Texture runtime that powers normal 2D Texture previews.
      const firstFrame =
        await globalThis
          .NovaSparxRenderer
          .render(
            {
              geometry,
              sections,
              materials:
                Array.from(
                  {
                    length:
                      materialCount
                  },
                  () => ({})
                ),
              metadata: {
                materialFidelity:
                  'geometry-first'
              }
            },
            {
              signal:
                request.signal,
              size:
                512
            }
          );

      throwIfAborted(
        request.signal
      );

      const materialPromise =
        (async () => {
          const objectUrls = [];
          const resolvedByPackage =
            new Map();

          try {
            const materials = [];
            const missingMaterials = [];

            for (
              let index = 0;
              index <
                materialCount;
              index++
            ) {
              throwIfAborted(
                request.signal
              );

              const metadata =
                mesh
                  .materialMetadata[
                    index
                  ];

              const parameter =
                baseColorParameter(
                  metadata
                );

              const packageId =
                String(
                  parameter
                    ?.packageId ||
                  ""
                )
                  .trim()
                  .toLowerCase();

              const texturePath =
                String(
                  parameter
                    ?.path ||
                  ""
                )
                  .trim();

              if (
                !/^[a-f0-9]{16}$/.test(
                  packageId
                ) &&
                !texturePath
              ) {
                materials.push(
                  {}
                );

                missingMaterials
                  .push(
                    index
                  );

                continue;
              }

              const materialKey =
                /^[a-f0-9]{16}$/.test(
                  packageId
                )
                  ? "id:" +
                    packageId
                  : "path:" +
                    normalizeInput(
                      texturePath
                    )
                      .toLowerCase();

              let material =
                resolvedByPackage
                  .get(
                    materialKey
                  );

              if (!material) {
                const textureLocation =
                  /^[a-f0-9]{16}$/.test(
                    packageId
                  )
                    ? await locatePackage(
                        packageId,
                        request
                      )
                    : await locate(
                        texturePath,
                        request
                      );

                const texture =
                  await runWorker(
                    textureLocation,
                    manifest,
                    {
                      ...request,
                      mode:
                        'texture',
                      maxSize:
                        512
                    }
                  );

                throwIfAborted(
                  request.signal
                );

                // The Texture Worker already returned validated RGBA.
                // Keep it raw so the renderer can upload it straight to WebGL;
                // PNG/blob/Image re-decoding was the failure point on a subset
                // of iOS/Android devices.
                material = {
                  baseColorPixels: {
                    width:
                      texture.width,
                    height:
                      texture.height,
                    pixels:
                      new Uint8Array(
                        texture.pixels
                      )
                  }
                };

                resolvedByPackage
                  .set(
                    materialKey,
                    material
                  );
              }

              materials.push(
                material
              );
            }

            throwIfAborted(
              request.signal
            );

            const rendered =
              await globalThis
                .NovaSparxRenderer
                .render(
                  {
                    geometry,
                    sections,
                    materials,
                    metadata: {
                      materialFidelity:
                        missingMaterials
                          .length
                          ? 'base-color-partial'
                          : 'base-color-preview'
                    }
                  },
                  {
                    signal:
                      request.signal,
                    size:
                      512
                  }
                );

            throwIfAborted(
              request.signal
            );

            return {
              ...rendered,
              path:
                mesh.path,
              source:
                'browser-wasm',
              missingMaterials,
              previewMode:
                missingMaterials
                  .length
                  ? 'base-color-partial'
                  : 'base-color-preview'
            };
          } finally {
            for (
              const url of
              objectUrls
            ) {
              try {
                URL.revokeObjectURL(
                  url
                );
              } catch {}
            }

            finishRequest(
              'mesh-materials-finished'
            );
          }
        })();

      return {
        ...firstFrame,
        path:
          mesh.path,
        source:
          'browser-wasm',
        missingMaterials:
          Array.from(
            {
              length:
                materialCount
            },
            (_, index) =>
              index
          ),
        previewMode:
          'geometry-first',
        materialPromise
      };
    } catch (error) {
      finishRequest(
        'mesh-request-failed'
      );

      throw error;
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
      resolveMeshImage,
      locate,
      status,
      clearCaches
    });
})();
