(() => {
  "use strict";

  const BUNDLE_ROOT =
    "./novasparx-wasm/";

  const LOCATION_ROOT =
    "https://raw.githubusercontent.com/E8uc/NovaSparx/main/web/location-index/";

  const MANIFEST_API =
    "https://export-service-new.dillyapis.com/v1/manifest";

  const AES_API =
    "https://export-service-new.dillyapis.com/v1/aes";

  const MAPPINGS_API =
    "https://api.fortniteapi.com/v1/mappings";

  const CHUNK_BASE =
    "https://download.epicgames.com/Builds/Fortnite/CloudDir/ChunksV4/";

  const MAX_PREVIEW_SIZE =
    1024;

  let activeWorker =
    null;

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx Texture request was replaced by a newer request."
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

  function normalizePhysicalPath(
    raw
  ) {
    let value =
      String(raw || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^["']|["']$/g, "");

    const wrapped =
      value.match(
        /^(?:(?:\/Script\/[^.'"\s]+\.)?[A-Za-z0-9_]+)?['"]([^'"]+)['"]$/
      );

    if (wrapped) {
      value =
        wrapped[1];
    }

    value =
      value.replace(
        /\.(?:uexp|ubulk|uptnl)$/i,
        ".uasset"
      );

    const slash =
      value.lastIndexOf("/");

    const dot =
      value.lastIndexOf(".");

    if (
      dot > slash &&
      !/\.(?:uasset|umap)$/i.test(
        value
      )
    ) {
      const left =
        value.slice(
          0,
          dot
        );

      const objectName =
        value.slice(
          dot + 1
        )
          .replace(
            /_C$/i,
            ""
          );

      const packageName =
        left.slice(
          left.lastIndexOf("/") +
          1
        );

      if (
        objectName
          .toLowerCase() ===
        packageName
          .toLowerCase()
      ) {
        value =
          left;
      }
    }

    if (
      /^\/Game\//i.test(
        value
      )
    ) {
      value =
        "FortniteGame/Content/" +
        value.slice(
          "/Game/".length
        );
    } else if (
      /^\/Engine\//i.test(
        value
      )
    ) {
      value =
        "Engine/Content/" +
        value.slice(
          "/Engine/".length
        );
    } else if (
      value.startsWith("/")
    ) {
      const parts =
        value
          .slice(1)
          .split("/")
          .filter(Boolean);

      if (
        parts.length >=
        2
      ) {
        const mount =
          parts.shift();

        value =
          "FortniteGame/Plugins/GameFeatures/" +
          mount +
          "/Content/" +
          parts.join("/");
      }
    }

    value =
      value
        .replace(
          /^\/+/, ""
        )
        .replace(
          /\/{2,}/g,
          "/"
        );

    if (
      !/\.(?:uasset|umap)$/i.test(
        value
      )
    ) {
      value +=
        ".uasset";
    }

    return value
      .toLowerCase();
  }

  function shardFor(
    value
  ) {
    const bytes =
      new TextEncoder()
        .encode(
          String(value || "")
            .toLowerCase()
        );

    let hash =
      2166136261 >>> 0;

    for (
      const byte of bytes
    ) {
      hash ^=
        byte;

      hash =
        Math.imul(
          hash,
          16777619
        ) >>> 0;
    }

    return (
      hash & 0xff
    )
      .toString(16)
      .padStart(
        2,
        "0"
      );
  }

  async function locateContainer(
    path,
    signal
  ) {
    const physical =
      normalizePhysicalPath(
        path
      );

    if (!physical) {
      throw new Error(
        "NovaSparx Texture path is empty."
      );
    }

    const shard =
      shardFor(
        physical
      );

    const response =
      await fetch(
        LOCATION_ROOT +
        shard +
        ".json.gz",
        {
          signal,
          cache:
            "force-cache",
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        "NovaSparx location shard returned HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    if (
      data?.schema !==
        "novasparx.asset-locations.v1" ||
      data?.valueProperty !==
        "toc" ||
      !data.items ||
      typeof data.items !==
        "object"
    ) {
      throw new Error(
        "NovaSparx location shard has an unsupported schema."
      );
    }

    const toc =
      String(
        data.items[
          physical
        ] ||
        ""
      ).trim();

    if (!toc) {
      const error =
        new Error(
          "NovaSparx location index does not contain this Texture package."
        );

      error.code =
        "NOVASPARX_TEXTURE_LOCATION_NOT_FOUND";

      throw error;
    }

    return {
      physical,
      toc
    };
  }

  function terminateActive() {
    try {
      activeWorker
        ?.terminate?.();
    } catch {}

    activeWorker =
      null;
  }

  async function resolveTexture(
    path,
    options = {}
  ) {
    const signal =
      options.signal ||
      null;

    if (signal?.aborted) {
      throw abortError(
        signal
      );
    }

    const location =
      await locateContainer(
        path,
        signal
      );

    if (signal?.aborted) {
      throw abortError(
        signal
      );
    }

    terminateActive();

    const params =
      new URLSearchParams({
        test:
          "resolve-texture-relay",
        path:
          location.physical,
        toc:
          location.toc,
        manifest:
          MANIFEST_API,
        chunkBase:
          CHUNK_BASE,
        mappingsApi:
          MAPPINGS_API,
        aesApi:
          AES_API,
        maxSize:
          String(
            MAX_PREVIEW_SIZE
          ),
        relay:
          String(
            globalThis
              .FORTNITE_AI_API_ENDPOINT ||
            ""
          )
            .replace(
              /\/+$/,
              ""
            ) +
          "/edge/range"
      });

    const worker =
      new Worker(
        BUNDLE_ROOT +
        "worker.js?" +
        params.toString(),
        {
          type:
            "module"
        }
      );

    activeWorker =
      worker;

    return await new Promise(
      (resolve, reject) => {
        let pixels =
          null;

        let finished =
          false;

        const cleanup =
          () => {
            signal
              ?.removeEventListener?.(
                "abort",
                onAbort
              );

            try {
              worker
                .terminate();
            } catch {}

            if (
              activeWorker ===
              worker
            ) {
              activeWorker =
                null;
            }
          };

        const fail =
          error => {
            if (finished) {
              return;
            }

            finished =
              true;

            cleanup();

            reject(
              error instanceof
                Error
                ? error
                : new Error(
                    String(error)
                  )
            );
          };

        const onAbort =
          () => {
            fail(
              abortError(
                signal
              )
            );
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
          event => {
            fail(
              new Error(
                event.message ||
                "NovaSparx Texture Worker failed."
              )
            );
          };

        worker.onmessage =
          event => {
            const message =
              event.data ||
              {};

            if (
              message.type ===
              "error"
            ) {
              fail(
                new Error(
                  message.error ||
                    "NovaSparx Texture Worker failed."
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

              if (
                !Number.isInteger(
                  width
                ) ||
                !Number.isInteger(
                  height
                ) ||
                width <= 0 ||
                height <= 0 ||
                width > 2048 ||
                height > 2048 ||
                !(
                  message.pixels instanceof
                  ArrayBuffer
                ) ||
                message
                  .pixels
                  .byteLength !==
                  width *
                  height *
                  4
              ) {
                fail(
                  new Error(
                    "NovaSparx Texture Worker returned invalid RGBA pixels."
                  )
                );
                return;
              }

              pixels = {
                path:
                  String(
                    message.path ||
                    location.physical
                  ),
                width,
                height,
                pixels:
                  message.pixels
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
                fail(
                  new Error(
                    "NovaSparx Texture Worker exited with code " +
                    message.exitCode
                  )
                );
                return;
              }

              if (!pixels) {
                fail(
                  new Error(
                    "NovaSparx Texture Worker completed without pixels."
                  )
                );
                return;
              }

              if (finished) {
                return;
              }

              finished =
                true;

              cleanup();

              resolve(
                pixels
              );
            }
          };
      }
    );
  }

  async function bundleAvailable() {
    try {
      const response =
        await fetch(
          BUNDLE_ROOT +
          "worker.js",
          {
            method:
              "HEAD",
            cache:
              "no-store"
          }
        );

      return response.ok;
    } catch {
      return false;
    }
  }

  (async () => {
    if (
      !globalThis
        .NovaSparxLocalParser
        ?.register ||
      !(
        await bundleAvailable()
      )
    ) {
      return;
    }

    globalThis
      .NovaSparxLocalParser
      .register({
        name:
          "NovaSparx Browser Texture Runtime",
        version:
          "1.0.0",
        requiresBootstrap:
          false,
        resolveTexture,
        reset:
          terminateActive
      });
  })().catch(
    error => {
      console.warn(
        "NovaSparx Texture engine registration:",
        error
      );
    }
  );
})();
