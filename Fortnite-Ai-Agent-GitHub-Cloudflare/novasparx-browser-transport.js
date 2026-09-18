(() => {
  "use strict";

  const MAX_RANGE_BYTES = 4 * 1024 * 1024;

  function validateRange(start, end) {
    start = Number(start);
    end = Number(end);

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end - start + 1 > MAX_RANGE_BYTES
    ) {
      throw new Error("NovaSparx browser range must be between 1 byte and 4 MiB.");
    }

    return { start, end };
  }

  async function fetchRange(url, start, end, options = {}) {
    const range = validateRange(start, end);
    const target = new URL(String(url || ""));

    if (!/^https?:$/.test(target.protocol)) {
      throw new Error("NovaSparx browser transport requires HTTP(S).");
    }

    const response = await fetch(target.toString(), {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: options.cache || "force-cache",
      signal: options.signal || undefined,
      headers: {
        Range: `bytes=${range.start}-${range.end}`,
        Accept: "application/octet-stream,*/*;q=0.8"
      }
    });

    if (!(response.status === 206 || response.status === 200)) {
      throw new Error(
        `NovaSparx range source returned HTTP ${response.status}.`
      );
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_RANGE_BYTES) {
      throw new Error("NovaSparx range source exceeded the browser memory guard.");
    }

    return {
      buffer,
      status: response.status,
      contentRange: response.headers.get("content-range"),
      contentLength: Number(response.headers.get("content-length") || buffer.byteLength),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified")
    };
  }

  async function probe(url, options = {}) {
    const target = new URL(String(url || ""));

    try {
      const response = await fetch(target.toString(), {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        signal: options.signal || undefined,
        headers: {
          Range: "bytes=0-0"
        }
      });

      try {
        await response.body?.cancel();
      } catch {}

      return {
        reachable: response.ok || response.status === 206,
        status: response.status,
        acceptsRanges:
          response.status === 206 ||
          /bytes/i.test(response.headers.get("accept-ranges") || "")
      };
    } catch (error) {
      return {
        reachable: false,
        status: 0,
        acceptsRanges: false,
        error: error?.message || String(error)
      };
    }
  }

  globalThis.NovaSparxBrowserTransport = Object.freeze({
    version: "1.0.0",
    maxRangeBytes: MAX_RANGE_BYTES,
    fetchRange,
    probe
  });
})();
