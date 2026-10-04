const assert = (await import("node:assert/strict")).default;
const fs = await import("node:fs");
const vm = await import("node:vm");

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

const transportSource = fs.readFileSync(new URL('./novasparx-browser-transport.js', import.meta.url), 'utf8');

function isolatedTransport(reply) {
  const calls = [];
  const context = {
    URL, Uint8Array, Response, Headers, Number, String, Error, DOMException,
    setTimeout() {},
    FNAA_CONFIG: { apiEndpoint: 'https://edge.test' },
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const range = new Headers(init.headers).get('range');
      const [start, end] = range ? range.slice(6).split('-').map(Number) :
        [Number(url.searchParams.get('start')), Number(url.searchParams.get('end'))];
      calls.push({ start, end });
      return reply({ start, end, index: calls.length });
    }
  };
  vm.runInNewContext(transportSource, context);
  return { transport: context.NovaSparxBrowserTransport, calls };
}

for (const options of [{ relay: false }, { direct: false }]) {
  for (const [name, status, contentRange, body, declared] of [
    ['wrong start', 206, 'bytes 3-6/12', [2, 3, 4, 5]],
    ['reversed interval', 206, 'bytes 2-1/12', [2]],
    ['short interval before EOF', 206, 'bytes 2-4/12', [2, 3, 4]],
    ['short body', 206, 'bytes 2-5/12', [2, 3, 4]],
    ['end outside total', 206, 'bytes 2-5/5', [2, 3, 4, 5]],
    ['unknown total', 206, 'bytes 2-5/*', [2, 3, 4, 5]],
    ['unsafe total', 206, 'bytes 2-5/9007199254740993', [2, 3, 4, 5]],
    ['nonzero 200', 200, null, [2, 3, 4, 5], '4']
  ]) {
    const { transport } = isolatedTransport(() => new Response(new Uint8Array(body), {
      status,
      headers: {
        ...(contentRange ? { 'content-range': contentRange } : {}),
        ...(declared ? { 'content-length': declared } : {})
      }
    }));
    await assert.rejects(transport.fetchRange('https://download.epicgames.com/file.bin', 2, 5, options), undefined, name);
  }

  const { transport } = isolatedTransport(() => new Response(new Uint8Array([9, 10, 11]), {
    status: 206, headers: { 'content-range': 'bytes 9-11/12' }
  }));
  const final = await transport.fetchRange('https://download.epicgames.com/file.bin', 9, 50, options);
  assert.deepEqual(Array.from(new Uint8Array(final.buffer)), [9, 10, 11]);

  const whole = isolatedTransport(() => new Response(new Uint8Array([0, 1, 2, 3]), {
    headers: { 'content-length': '4' }
  }));
  const complete = await whole.transport.fetchRange('https://download.epicgames.com/file.bin', 0, 7, options);
  assert.deepEqual(Array.from(new Uint8Array(complete.buffer)), [0, 1, 2, 3]);

  for (const [bodyLength, declared] of [[3, '4'], [4, null], [4, '4e0'], [4, '-4']]) {
    const invalidWhole = isolatedTransport(() => new Response(new Uint8Array(bodyLength), {
      headers: declared === null ? {} : { 'content-length': declared }
    }));
    await assert.rejects(invalidWhole.transport.fetchRange('https://download.epicgames.com/file.bin', 0, 7, options));
  }
}

for (const problem of ['changing total', 'changing etag', 'changing last-modified']) {
  const { transport } = isolatedTransport(({ start, end, index }) => new Response(sourceBytes.slice(start, end + 1), {
    status: 206, headers: {
      'content-range': `bytes ${start}-${end}/${index > 1 && problem === 'changing total' ? 13 : 12}`,
      etag: index > 1 && problem === 'changing etag' ? '"second"' : '"first"',
      'last-modified': index > 1 && problem === 'changing last-modified' ? 'Sat, 03 Oct 2026 12:01:00 GMT' : 'Sat, 03 Oct 2026 12:00:00 GMT'
    }
  }));
  await assert.rejects(transport.fetchFile('https://download.epicgames.com/file.bin', { maxBytes: 64, relay: false }), undefined, problem);
}

const controller = new AbortController();
let cancelled = false;
const aborted = isolatedTransport(() => new Response(new ReadableStream({
  pull(stream) { stream.enqueue(new Uint8Array([0])); controller.abort(); },
  cancel() { cancelled = true; }
}, { highWaterMark: 0 }), { status: 206, headers: { 'content-range': 'bytes 0-0/1' } }));
await assert.rejects(aborted.transport.fetchRange('https://download.epicgames.com/file.bin', 0, 0, {
  relay: false, signal: controller.signal
}));
assert.equal(cancelled, true, 'aborting a range read cancels its stream');

console.log('NovaSparx browser transport self-test passed.');
