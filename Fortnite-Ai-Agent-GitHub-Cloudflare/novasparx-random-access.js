(() => {
  "use strict";

  const MAX_SAFE_OFFSET =
    Number.MAX_SAFE_INTEGER;

  function transport() {
    const value =
      globalThis
        .NovaSparxBrowserTransport;

    if (
      !value ||
      typeof value.fetchRange !==
        "function"
    ) {
      throw new Error(
        "NovaSparx browser transport is unavailable."
      );
    }

    return value;
  }

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx random-access request was cancelled."
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

  function safeOffset(
    value,
    label
  ) {
    if (
      typeof value ===
        "bigint"
    ) {
      if (
        value < 0n ||
        value >
          BigInt(
            MAX_SAFE_OFFSET
          )
      ) {
        throw new RangeError(
          label +
          " is outside the browser-safe integer range."
        );
      }

      return Number(
        value
      );
    }

    const number =
      Number(value);

    if (
      !Number.isSafeInteger(
        number
      ) ||
      number < 0
    ) {
      throw new RangeError(
        label +
        " must be a non-negative safe integer."
      );
    }

    return number;
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

  function normalizeUrl(
    raw
  ) {
    const value =
      String(raw || "")
        .trim();

    if (!value) {
      throw new Error(
        "NovaSparx random-access source requires a URL."
      );
    }

    const url =
      new URL(
        value
      );

    if (
      url.protocol !==
        "https:"
    ) {
      throw new Error(
        "NovaSparx random-access sources must use HTTPS."
      );
    }

    if (
      url.username ||
      url.password
    ) {
      throw new Error(
        "NovaSparx random-access URLs cannot include credentials."
      );
    }

    url.hash = "";

    return url.toString();
  }

  function create(
    rawUrl,
    defaults = {}
  ) {
    const url =
      normalizeUrl(
        rawUrl
      );

    let knownSize =
      null;

    async function size(
      options = {}
    ) {
      throwIfAborted(
        options.signal
      );

      if (
        knownSize !==
          null
      ) {
        return knownSize;
      }

      const result =
        await transport()
          .fetchRange(
            url,
            0,
            0,
            {
              ...defaults,
              ...options,
              signal:
                options.signal ||
                defaults.signal ||
                null
            }
          );

      throwIfAborted(
        options.signal ||
        defaults.signal
      );

      const total =
        parseTotalLength(
          result.contentRange
        ) ||
        (
          result.status ===
            200 &&
          Number.isSafeInteger(
            result.contentLength
          )
            ? result.contentLength
            : 0
        );

      if (
        !total ||
        total < 1
      ) {
        throw new Error(
          "NovaSparx could not determine the random-access source size."
        );
      }

      knownSize =
        BigInt(total);

      return knownSize;
    }

    async function read(
      offset,
      length,
      options = {}
    ) {
      const signal =
        options.signal ||
        defaults.signal ||
        null;

      throwIfAborted(
        signal
      );

      const start =
        safeOffset(
          offset,
          "offset"
        );

      const count =
        safeOffset(
          length,
          "length"
        );

      if (count < 1) {
        return new ArrayBuffer(
          0
        );
      }

      const max =
        Number(
          transport()
            .maxRangeBytes ||
          4 * 1024 * 1024
        );

      if (
        count > max
      ) {
        throw new RangeError(
          "NovaSparx random-access read exceeds the transport range limit."
        );
      }

      const end =
        start +
        count -
        1;

      if (
        !Number.isSafeInteger(
          end
        )
      ) {
        throw new RangeError(
          "NovaSparx random-access read end is unsafe."
        );
      }

      const result =
        await transport()
          .fetchRange(
            url,
            start,
            end,
            {
              ...defaults,
              ...options,
              signal
            }
          );

      throwIfAborted(
        signal
      );

      const buffer =
        result.buffer;

      if (
        !(buffer instanceof
          ArrayBuffer) ||
        buffer.byteLength !==
          count
      ) {
        throw new Error(
          "NovaSparx random-access source returned an unexpected byte count."
        );
      }

      return buffer;
    }

    async function readBytes(
      offset,
      length,
      options = {}
    ) {
      return new Uint8Array(
        await read(
          offset,
          length,
          options
        )
      );
    }

    return Object.freeze({
      url,
      size,
      read,
      readBytes,
      status() {
        return {
          url,
          size:
            knownSize
              ?.toString() ||
            null,
          maxReadBytes:
            Number(
              transport()
                .maxRangeBytes ||
              0
            )
        };
      }
    });
  }

  globalThis.NovaSparxRandomAccess =
    Object.freeze({
      version:
        "1.0.0",
      create
    });
})();
