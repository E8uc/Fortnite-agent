const assert = (await import("node:assert/strict")).default;

globalThis.FNAA_CONFIG = {
  apiEndpoint: "https://edge.test"
};

const sourceBytes = Uint8Array.from(
  { length: 12 },
  (_, index) => index
);

function rangeResponse(start, end) {
  const body = sourceBytes.slice(start, end + 1);

  return new Response(body, {
    status: 206,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.byteLength),
      "content-range":
        "bytes " +
        start +
        "-" +
        end +
        "/" +
        sourceBytes.byteLength
    }
  });
}

globalThis.fetch = async (rawUrl, init = {}) => {
  const url = new URL(String(rawUrl));

  if (
    url.toString() ===
    "https://edge.test/nova-edge/bootstrap"
  ) {
    return new Response(
      JSON.stringify({
        ok: true,
        schema: "novasparx.edge-bootstrap.v1",
        aes: {
          ok: true,
          data: {
            mainKey: "test"
          }
        },
        manifest: {
          ok: true,
          candidates: [
            {
              url:
                "https://download.epicgames.com/current.manifest",
              score: 100
            },
            {
              url:
                "https://evil.example/untrusted.manifest",
              score: 99
            }
          ],
          ids: ["manifest-id"],
          detailsBase:
            "https://export-service-new.dillyapis.com/v1/manifests"
        },
        transport: {
          maxRangeBytes:
            4 * 1024 * 1024
        }
      }),
      {
        status: 200,
        headers: {
          "content-type":
            "application/json"
        }
      }
    );
  }

  if (
    url.origin ===
      "https://download.epicgames.com" ||
    url.origin ===
      "https://egdownload.fastly-edge.com"
  ) {
    if (
      url.pathname ===
      "/relay-only.bin"
    ) {
      throw new TypeError(
        "simulated browser CORS failure"
      );
    }

    const headers =
      new Headers(
        init.headers ||
        {}
      );

    const rawRange =
      String(
        headers.get("range") ||
        ""
      );

    assert.ok(
      rawRange.startsWith(
        "bytes="
      ),
      "direct CDN request must include Range header"
    );

    const parts =
      rawRange
        .slice(6)
        .split("-")
        .map(Number);

    const start =
      parts[0];

    const end =
      parts[1];

    assert.ok(
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end)
    );

    return rangeResponse(
      start,
      end
    );
  }

  if (
    url.toString()
      .startsWith(
        "https://edge.test/nova-edge/range?"
      )
  ) {
    const target =
      new URL(
        url.searchParams
          .get("url")
      );

    assert.equal(
      target.hostname,
      "download.epicgames.com"
    );

    return rangeResponse(
      Number(
        url.searchParams
          .get("start")
      ),
      Number(
        url.searchParams
          .get("end")
      )
    );
  }

  throw new Error(
    "Unexpected test fetch: " +
    url.toString()
  );
};

await import(
  "./novasparx-browser-transport.js?selftest=1"
);

const transport =
  globalThis
    .NovaSparxBrowserTransport;

assert.ok(
  transport,
  "browser transport should register"
);

assert.equal(
  transport.version,
  "2.5.0"
);

const direct =
  await transport.fetchRange(
    "https://download.epicgames.com/file.bin",
    2,
    5,
    {
      relay: false
    }
  );

assert.equal(
  direct.source,
  "direct"
);

assert.deepEqual(
  Array.from(
    new Uint8Array(
      direct.buffer
    )
  ),
  [2, 3, 4, 5]
);

const relayed =
  await transport.fetchRange(
    "https://download.epicgames.com/relay-only.bin",
    4,
    6
  );

assert.equal(
  relayed.source,
  "edge-relay"
);

assert.deepEqual(
  Array.from(
    new Uint8Array(
      relayed.buffer
    )
  ),
  [4, 5, 6]
);

await assert.rejects(
  () =>
    transport.fetchRange(
      "https://evil.example/file.bin",
      0,
      0
    ),
  /untrusted range host/i
);

await assert.rejects(
  () =>
    transport.fetchRange(
      "https://download.epicgames.com/file.bin",
      0,
      4 * 1024 * 1024
    ),
  /4 MiB/i
);

const sources =
  await transport
    .manifestSources({
      refresh: true
    });

assert.deepEqual(
  sources,
  [
    "https://download.epicgames.com/current.manifest",
    "https://export-service-new.dillyapis.com/v1/manifests/manifest-id"
  ]
);

const file =
  await transport.fetchFile(
    "https://egdownload.fastly-edge.com/file.bin",
    {
      maxBytes: 64,
      chunkBytes: 3,
      concurrency: 2
    }
  );

assert.equal(
  file.byteLength,
  sourceBytes.byteLength
);

assert.deepEqual(
  Array.from(
    new Uint8Array(
      file.buffer
    )
  ),
  Array.from(
    sourceBytes
  )
);

console.log(
  "NovaSparx browser transport self-test passed."
);
