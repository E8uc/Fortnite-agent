(() => {
  "use strict";

  const MAX_RANGE_BYTES =
    4 * 1024 * 1024;

  const MAX_BOOTSTRAP_BYTES =
    2 * 1024 * 1024;

  const BOOTSTRAP_TTL_MS =
    5 * 60 * 1000;

  const ALLOWED_RANGE_HOSTS =
    Object.freeze([
      "egdownload.fastly-edge.com",
      "download.epicgames.com",
      "export-service-new.dillyapis.com"
    ]);

  let bootstrapCache =
    null;

  let bootstrapTask =
    null;

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx network work was cancelled because a newer request replaced it."
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

  function edgeEndpoint(
    route
  ) {
    const base =
      apiBase();

    if (!base) {
      return "";
    }

    return (
      base +
      String(route || "")
    );
  }

  function validateRange(
    start,
    end
  ) {
    start =
      Number(start);

    end =
      Number(end);

    if (
      !Number.isSafeInteger(
        start
      ) ||
      !Number.isSafeInteger(
        end
      ) ||
      start < 0 ||
      end < start ||
      end - start + 1 >
        MAX_RANGE_BYTES
    ) {
      throw new Error(
        "NovaSparx browser range must be between 1 byte and 4 MiB."
      );
    }

    return {
      start,
      end,
      length:
        end - start + 1
    };
  }

  function targetUrl(
    raw
  ) {
    const target =
      new URL(
        String(raw || "")
      );

    const loopback =
      (
        target.hostname ===
          "localhost" ||
        target.hostname ===
          "127.0.0.1" ||
        target.hostname ===
          "[::1]" ||
        target.hostname ===
          "::1"
      );

    if (
      target.protocol !==
        "https:" &&
      !(
        target.protocol ===
          "http:" &&
        loopback
      )
    ) {
      throw new Error(
        "NovaSparx browser transport requires HTTPS outside localhost."
      );
    }

    if (
      target.username ||
      target.password
    ) {
      throw new Error(
        "NovaSparx browser transport does not allow URL credentials."
      );
    }

    const host =
      target.hostname
        .toLowerCase();

    const allowedHost =
      loopback ||
      ALLOWED_RANGE_HOSTS
        .some(
          (allowed) =>
            host ===
              allowed ||
            host.endsWith(
              "." + allowed
            )
        );

    if (!allowedHost) {
      throw new Error(
        "NovaSparx browser transport rejected an untrusted range host."
      );
    }

    target.hash = "";

    return target;
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
        label +
        " exceeded the browser memory guard."
      );
    }

    if (
      !response.body ||
      typeof response.body
        .getReader !==
        "function"
    ) {
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
        throw new Error(
          label +
          " exceeded the browser memory guard."
        );
      }

      return buffer;
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

        if (
          total >
          maxBytes
        ) {
          try {
            await reader.cancel();
          } catch {}

          throw new Error(
            label +
            " exceeded the browser memory guard."
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

    return output.buffer;
  }

  function rangeResult(
    response,
    buffer,
    source
  ) {
    return {
      buffer,
      source,
      status:
        response.status,
      contentRange:
        response.headers.get(
          "content-range"
        ),
      contentLength:
        Number(
          response.headers.get(
            "content-length"
          ) ||
          buffer.byteLength
        ),
      etag:
        response.headers.get(
          "etag"
        ),
      lastModified:
        response.headers.get(
          "last-modified"
        )
    };
  }

  async function fetchDirectRange(
    target,
    range,
    options
  ) {
    const response =
      await fetch(
        target.toString(),
        {
          method:
            "GET",
          mode:
            "cors",
          credentials:
            "omit",
          cache:
            options.cache ||
            "force-cache",
          signal:
            options.signal ||
            undefined,
          headers: {
            Range:
              "bytes=" +
              range.start +
              "-" +
              range.end,
            Accept:
              "application/octet-stream,*/*;q=0.8"
          }
        }
      );

    const declared =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    const valid200 =
      response.status ===
        200 &&
      range.start === 0 &&
      declared > 0 &&
      declared <=
        range.length;

    if (
      response.status !==
        206 &&
      !valid200
    ) {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        "NovaSparx direct range source returned HTTP " +
        response.status +
        " without a usable byte range."
      );
    }

    const buffer =
      await readBounded(
        response,
        range.length,
        "NovaSparx direct range",
        options.signal ||
          null
      );

    return rangeResult(
      response,
      buffer,
      "direct"
    );
  }

  async function fetchRelayRange(
    target,
    range,
    options
  ) {
    const base =
      edgeEndpoint(
        "/nova-edge/range"
      );

    if (!base) {
      const error =
        new Error(
          "NovaSparx edge relay is not configured."
        );

      error.code =
        "NOVASPARX_EDGE_UNCONFIGURED";

      throw error;
    }

    const url =
      new URL(base);

    url.searchParams.set(
      "url",
      target.toString()
    );

    url.searchParams.set(
      "start",
      String(
        range.start
      )
    );

    url.searchParams.set(
      "end",
      String(
        range.end
      )
    );

    const response =
      await fetch(
        url.toString(),
        {
          method:
            "GET",
          mode:
            "cors",
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
              "application/octet-stream,*/*;q=0.8"
          }
        }
      );

    if (
      ![
        200,
        206
      ].includes(
        response.status
      )
    ) {
      const message =
        await response
          .json()
          .then(
            (data) =>
              data?.error ||
              ""
          )
          .catch(
            () => ""
          );

      throw new Error(
        message ||
        (
          "NovaSparx edge relay returned HTTP " +
          response.status +
          "."
        )
      );
    }

    const buffer =
      await readBounded(
        response,
        range.length,
        "NovaSparx relayed range",
        options.signal ||
          null
      );

    return rangeResult(
      response,
      buffer,
      "edge-relay"
    );
  }

  async function fetchRange(
    url,
    start,
    end,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    const range =
      validateRange(
        start,
        end
      );

    const target =
      targetUrl(url);

    let directError =
      null;

    if (
      options.direct !==
      false
    ) {
      try {
        return await fetchDirectRange(
          target,
          range,
          options
        );
      } catch (error) {
        if (
          options.signal
            ?.aborted
        ) {
          throw abortError(
            options.signal
          );
        }

        directError =
          error;
      }
    }

    if (
      options.relay ===
      false
    ) {
      throw (
        directError ||
        new Error(
          "NovaSparx range relay is disabled."
        )
      );
    }

    throwIfAborted(
      options.signal
    );

    try {
      return await fetchRelayRange(
        target,
        range,
        options
      );
    } catch (relayError) {
      if (!directError) {
        throw relayError;
      }

      const error =
        new Error(
          "NovaSparx range failed directly and through the edge relay. " +
          "Direct: " +
          (
            directError?.message ||
            directError
          ) +
          " | Relay: " +
          (
            relayError?.message ||
            relayError
          )
        );

      error.code =
        "NOVASPARX_RANGE_UNAVAILABLE";

      throw error;
    }
  }

  async function bootstrap(
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    const now =
      Date.now();

    if (
      !options.refresh &&
      bootstrapCache &&
      now -
      bootstrapCache.at <
        BOOTSTRAP_TTL_MS
    ) {
      return bootstrapCache
        .value;
    }

    const requestSignal =
      options.signal ||
      null;

    if (
      !options.refresh &&
      bootstrapTask &&
      (
        bootstrapTask.signal ===
          null ||
        bootstrapTask.signal ===
          requestSignal
      )
    ) {
      return bootstrapTask
        .promise;
    }

    const endpoint =
      edgeEndpoint(
        "/nova-edge/bootstrap"
      );

    if (!endpoint) {
      const error =
        new Error(
          "NovaSparx edge metadata is not configured."
        );

      error.code =
        "NOVASPARX_EDGE_UNCONFIGURED";

      throw error;
    }

    const request =
      (async () => {
        throwIfAborted(
          requestSignal
        );

        const response =
          await fetch(
            endpoint,
            {
              method:
                "GET",
              mode:
                "cors",
              credentials:
                "omit",
              cache:
                options.refresh
                  ? "no-store"
                  : "force-cache",
              signal:
                requestSignal ||
                undefined,
              headers: {
                Accept:
                  "application/json"
              }
            }
          );

        const buffer =
          await readBounded(
            response,
            MAX_BOOTSTRAP_BYTES,
            "NovaSparx edge metadata",
            requestSignal
          );

        let data;

        try {
          data =
            JSON.parse(
              new TextDecoder()
                .decode(buffer)
            );
        } catch {
          throw new Error(
            "NovaSparx edge metadata could not be decoded."
          );
        }

        throwIfAborted(
          requestSignal
        );

        if (
          !response.ok ||
          data?.schema !==
            "novasparx.edge-bootstrap.v1"
        ) {
          throw new Error(
            data?.error ||
            (
              "NovaSparx edge metadata returned HTTP " +
              response.status +
              "."
            )
          );
        }

        bootstrapCache = {
          at:
            Date.now(),
          value:
            data
        };

        return data;
      })();

    bootstrapTask = {
      promise:
        request,
      signal:
        requestSignal
    };

    try {
      return await request;
    } finally {
      if (
        bootstrapTask
          ?.promise ===
        request
      ) {
        bootstrapTask =
          null;
      }
    }
  }

  async function probe(
    url,
    options = {}
  ) {
    try {
      const result =
        await fetchRange(
          url,
          0,
          0,
          {
            ...options,
            cache:
              "no-store"
          }
        );

      return {
        reachable:
          true,
        status:
          result.status,
        acceptsRanges:
          result.status ===
            206,
        source:
          result.source
      };
    } catch (error) {
      return {
        reachable:
          false,
        status:
          0,
        acceptsRanges:
          false,
        source:
          null,
        error:
          error?.message ||
          String(error)
      };
    }
  }

  function parseTotalLength(
    contentRange
  ) {
    const match =
      String(
        contentRange || ""
      ).match(
        /^bytes\s+\d+-\d+\/(\d+)$/i
      );

    if (!match) {
      return 0;
    }

    const total =
      Number(
        match[1]
      );

    return (
      Number.isSafeInteger(
        total
      ) &&
      total > 0
        ? total
        : 0
    );
  }

  function defaultFileLimit() {
    const guard =
      globalThis
        .NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    if (guard.isIOS) {
      return (
        12 * 1024 * 1024
      );
    }

    if (guard.isMobile) {
      return (
        20 * 1024 * 1024
      );
    }

    return (
      64 * 1024 * 1024
    );
  }

  function transferProfile() {
    const guard =
      globalThis
        .NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    if (guard.isIOS) {
      return {
        chunkBytes:
          512 * 1024,
        concurrency:
          1
      };
    }

    if (guard.isMobile) {
      return {
        chunkBytes:
          1024 * 1024,
        concurrency:
          2
      };
    }

    return {
      chunkBytes:
        2 * 1024 * 1024,
      concurrency:
        4
    };
  }

  async function fetchFile(
    url,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

    const profile =
      transferProfile();

    const maxBytes =
      Math.max(
        1,
        Number(
          options.maxBytes ||
          defaultFileLimit()
        ) || 0
      );

    const chunkBytes =
      Math.min(
        MAX_RANGE_BYTES,
        Math.max(
          64 * 1024,
          Number(
            options.chunkBytes ||
            profile.chunkBytes
          ) || 0
        )
      );

    const concurrency =
      Math.max(
        1,
        Math.min(
          6,
          Number(
            options.concurrency ||
            profile.concurrency
          ) || 1
        )
      );

    const first =
      await fetchRange(
        url,
        0,
        0,
        options
      );

    throwIfAborted(
      options.signal
    );

    const total =
      parseTotalLength(
        first.contentRange
      );

    if (!total) {
      throw new Error(
        "NovaSparx source did not expose a bounded total size."
      );
    }

    if (
      total >
      maxBytes
    ) {
      throw new Error(
        "NovaSparx file exceeds this device's safe fetch budget."
      );
    }

    const output =
      new Uint8Array(
        total
      );

    output.set(
      new Uint8Array(
        first.buffer
      ),
      0
    );

    let loaded =
      first.buffer
        .byteLength;

    options.onProgress?.({
      loaded,
      total
    });

    const ranges = [];

    for (
      let start = loaded;
      start < total;
      start += chunkBytes
    ) {
      ranges.push({
        start,
        end:
          Math.min(
            total - 1,
            start +
            chunkBytes -
            1
          )
      });
    }

    let cursor = 0;

    const fixedTransport =
      first.source ===
        "edge-relay"
        ? {
            direct:
              false
          }
        : first.source ===
            "direct"
          ? {
              relay:
                false
            }
          : {};

    const worker =
      async () => {
        while (true) {
          throwIfAborted(
            options.signal
          );

          const index =
            cursor++;

          if (
            index >=
            ranges.length
          ) {
            return;
          }

          const range =
            ranges[index];

          const part =
            await fetchRange(
              url,
              range.start,
              range.end,
              {
                ...options,
                ...fixedTransport
              }
            );

          throwIfAborted(
            options.signal
          );

          const bytes =
            new Uint8Array(
              part.buffer
            );

          const expected =
            range.end -
            range.start +
            1;

          if (
            bytes.byteLength !==
            expected
          ) {
            throw new Error(
              "NovaSparx source returned an incomplete byte range."
            );
          }

          output.set(
            bytes,
            range.start
          );

          loaded +=
            bytes.byteLength;

          options.onProgress?.({
            loaded:
              Math.min(
                loaded,
                total
              ),
            total
          });
        }
      };

    await Promise.all(
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              Math.max(
                1,
                ranges.length
              )
            )
        },
        worker
      )
    );

    throwIfAborted(
      options.signal
    );

    return {
      buffer:
        output.buffer,
      byteLength:
        total,
      source:
        first.source,
      etag:
        first.etag,
      lastModified:
        first.lastModified
    };
  }

  async function manifestSources(
    options = {}
  ) {
    const data =
      await bootstrap(
        options
      );

    const output = [];
    const seen =
      new Set();

    const add =
      (raw) => {
        let url;

        try {
          url =
            targetUrl(
              String(raw || "")
            )
              .toString();
        } catch {
          return;
        }

        if (
          seen.has(url)
        ) {
          return;
        }

        seen.add(url);
        output.push(url);
      };

    for (
      const candidate of
      (
        Array.isArray(
          data?.manifest
            ?.candidates
        )
          ? data.manifest
              .candidates
          : []
      )
    ) {
      add(
        candidate?.url
      );
    }

    const detailsBase =
      String(
        data?.manifest
          ?.detailsBase ||
        ""
      )
        .trim()
        .replace(
          /\/+$/,
          ""
        );

    if (detailsBase) {
      for (
        const id of
        (
          Array.isArray(
            data?.manifest
              ?.ids
          )
            ? data.manifest
                .ids
            : []
        )
      ) {
        const clean =
          String(id || "")
            .trim();

        if (!clean) {
          continue;
        }

        add(
          detailsBase +
          "/" +
          encodeURIComponent(
            clean
          )
        );
      }
    }

    return output;
  }

  function clearBootstrapCache() {
    bootstrapCache =
      null;

    bootstrapTask =
      null;
  }

  function status() {
    return {
      version:
        "2.5.0",
      apiConfigured:
        Boolean(
          apiBase()
        ),
      maxRangeBytes:
        MAX_RANGE_BYTES,
      maxBootstrapBytes:
        MAX_BOOTSTRAP_BYTES,
      bootstrapCached:
        Boolean(
          bootstrapCache
        ),
      architecture:
        "direct-cdn-first-edge-relay"
    };
  }

  const warmBootstrap =
    () => {
      if (!apiBase()) {
        return;
      }

      bootstrap()
        .catch(
          () => {}
        );
    };

  if (
    typeof globalThis
      .requestIdleCallback ===
      "function"
  ) {
    globalThis
      .requestIdleCallback(
        warmBootstrap,
        {
          timeout:
            800
        }
      );
  } else {
    setTimeout(
      warmBootstrap,
      250
    );
  }

  globalThis.NovaSparxBrowserTransport =
    Object.freeze({
      version:
        "2.5.0",
      maxRangeBytes:
        MAX_RANGE_BYTES,
      fetchRange,
      fetchFile,
      manifestSources,
      bootstrap,
      probe,
      status,
      clearBootstrapCache
    });
})();
