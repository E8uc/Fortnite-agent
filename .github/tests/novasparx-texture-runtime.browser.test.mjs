import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const site =
  path.resolve(
    process.argv[2] ||
    "Fortnite-Ai-Agent-GitHub-Cloudflare"
  );

const TARGET =
  "FortniteGame/Plugins/GameFeatures/BRCosmetics/Content/Animation/Game/MainPlayer/Emotes/FaithPerch/FX/T_Emote_FaithPerch_SoftGlow.uasset";

const EXPECTED_SHA =
  "F2C39729F3CE99A7D5388F64A3AF4EEF7B5135C6D0276EE988AD05374760D6C7";

const RELAY_MAX_RANGE_BYTES =
  4 * 1024 * 1024;

const RELAY_ALLOWED_HOSTS =
  new Set([
    "egdownload.fastly-edge.com",
    "download.epicgames.com",
    "fortnite-direct.dillycdn.com",
    "stormforge.dillycdn.com"
  ]);

let relayRequests = 0;
let relayBytes = 0;

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".gz")) return "application/gzip";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function within(root, candidate) {
  const relative =
    path.relative(
      root,
      candidate
    );

  return (
    relative === "" ||
    (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    )
  );
}

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      try {
        const requestUrl =
          new URL(
            req.url,
            "http://127.0.0.1"
          );

        if (
          requestUrl.pathname ===
          "/nova-edge/range"
        ) {
          let target;

          try {
            target =
              new URL(
                requestUrl
                  .searchParams
                  .get(
                    "url"
                  ) ||
                ""
              );
          } catch {
            res.writeHead(400);
            res.end(
              "Invalid relay URL"
            );
            return;
          }

          const start =
            Number(
              requestUrl
                .searchParams
                .get(
                  "start"
                )
            );

          const end =
            Number(
              requestUrl
                .searchParams
                .get(
                  "end"
                )
            );

          if (
            target.protocol !==
              "https:" ||
            !RELAY_ALLOWED_HOSTS
              .has(
                target.hostname
                  .toLowerCase()
              ) ||
            !Number.isSafeInteger(
              start
            ) ||
            !Number.isSafeInteger(
              end
            ) ||
            start < 0 ||
            end < start ||
            end -
              start +
              1 >
              RELAY_MAX_RANGE_BYTES
          ) {
            res.writeHead(400);
            res.end(
              "Invalid relay range"
            );
            return;
          }

          const upstream =
            await fetch(
              target,
              {
                method:
                  "GET",
                redirect:
                  "error",
                headers: {
                  range:
                    `bytes=${start}-${end}`,
                  accept:
                    "application/octet-stream,*/*;q=0.8"
                }
              }
            );

          if (
            ![
              200,
              206
            ].includes(
              upstream.status
            )
          ) {
            res.writeHead(502);
            res.end(
              "Relay upstream HTTP " +
              upstream.status
            );
            return;
          }

          const bytes =
            new Uint8Array(
              await upstream
                .arrayBuffer()
            );

          const expected =
            end -
            start +
            1;

          if (
            bytes.byteLength < 1 ||
            bytes.byteLength >
              expected
          ) {
            res.writeHead(502);
            res.end(
              "Relay source exceeded requested byte window"
            );
            return;
          }

          relayRequests++;
          relayBytes +=
            bytes.byteLength;

          res.statusCode =
            upstream.status ===
              206
              ? 206
              : 200;

          res.setHeader(
            "Content-Type",
            upstream.headers
              .get(
                "content-type"
              ) ||
            "application/octet-stream"
          );

          res.setHeader(
            "Cache-Control",
            "no-store"
          );

          res.setHeader(
            "Accept-Ranges",
            "bytes"
          );

          res.setHeader(
            "Content-Length",
            String(
              bytes.byteLength
            )
          );

          const contentRange =
            upstream.headers
              .get(
                "content-range"
              );

          if (
            contentRange
          ) {
            res.setHeader(
              "Content-Range",
              contentRange
            );
          }

          res.end(
            Buffer.from(
              bytes
            )
          );

          return;
        }

        if (
          requestUrl.pathname ===
          "/"
        ) {
          const html =
            `<!doctype html>
<meta charset="utf-8">
<title>FNAA Layer 8 integration proof</title>
<script>
  window.FNAA_CONFIG = {
    apiEndpoint: location.origin
  };
</script>
<script src="/novasparx-texture-runtime.js"></script>`;

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8",
              "Cache-Control":
                "no-store"
            }
          );

          res.end(
            html
          );

          return;
        }

        const relative =
          decodeURIComponent(
            requestUrl.pathname
          )
            .replace(
              /^\/+/, ""
            );

        const file =
          path.resolve(
            site,
            relative
          );

        if (
          !within(
            site,
            file
          ) ||
          !fs.existsSync(
            file
          ) ||
          !fs.statSync(
            file
          ).isFile()
        ) {
          res.writeHead(404);
          res.end();
          return;
        }

        const bytes =
          fs.readFileSync(
            file
          );

        res.writeHead(
          200,
          {
            "Content-Type":
              mime(file),
            "Content-Length":
              String(
                bytes.byteLength
              ),
            "Cache-Control":
              "no-store"
          }
        );

        res.end(
          bytes
        );
      } catch (
        error
      ) {
        res.writeHead(500);
        res.end(
          String(
            error?.stack ||
            error
          )
        );
      }
    }
  );

await new Promise(
  resolve =>
    server.listen(
      0,
      "127.0.0.1",
      resolve
    )
);

const address =
  server.address();

assert.ok(
  address &&
  typeof address ===
    "object"
);

const origin =
  `http://127.0.0.1:${address.port}`;

const browser =
  await chromium.launch({
    headless:
      true
  });

try {
  const page =
    await browser.newPage();

  page.setDefaultTimeout(
    300_000
  );

  const consoleLines = [];

  page.on(
    "console",
    message =>
      consoleLines.push(
        message.text()
      )
  );

  page.on(
    "pageerror",
    error =>
      consoleLines.push(
        "PAGE_ERROR " +
        String(
          error?.stack ||
          error
        )
      )
  );

  await page.goto(
    origin,
    {
      waitUntil:
        "domcontentloaded"
    }
  );

  await page.waitForFunction(
    () =>
      typeof globalThis
        .NovaSparxTextureRuntime
        ?.resolveTexture ===
        "function"
  );

  const result =
    await page.evaluate(
      async target => {
        const output =
          await globalThis
            .NovaSparxTextureRuntime
            .resolveTexture(
              target.toLowerCase(),
              {
                maxSize:
                  512
              }
            );

        return {
          path:
            output.path,
          requestedPath:
            output.requestedPath,
          width:
            output.width,
          height:
            output.height,
          pixelsSha256:
            output.pixelsSha256,
          pngBytes:
            output.blob.size,
          toc:
            output.toc,
          shard:
            output.shard,
          source:
            output.source
        };
      },
      TARGET
    );

  assert.equal(
    result.path,
    TARGET,
    "FNAA Layer 8 must restore the canonical IoStore path casing"
  );

  assert.equal(
    result.width,
    256
  );

  assert.equal(
    result.height,
    256
  );

  assert.equal(
    result.pixelsSha256,
    EXPECTED_SHA,
    "FNAA Layer 8 pixels differ from the established CUE4Parse reference"
  );

  assert.equal(
    result.source,
    "browser-wasm"
  );

  assert.ok(
    result.pngBytes >
      0,
    "FNAA Layer 8 produced no PNG bytes"
  );

  assert.ok(
    /\.utoc$/i.test(
      result.toc
    ),
    "FNAA Layer 8 did not resolve an IoStore container"
  );

  assert.ok(
    relayRequests >
      0,
    "FNAA Layer 8 never used the bounded range relay"
  );

  assert.ok(
    relayBytes >
      0,
    "FNAA Layer 8 relay transferred no bytes"
  );

  const proof = {
    result,
    relay: {
      requests:
        relayRequests,
      bytes:
        relayBytes
    },
    console:
      consoleLines.slice(
        -80
      )
  };

  fs.writeFileSync(
    "fnaa-layer8-browser-proof.json",
    JSON.stringify(
      proof,
      null,
      2
    )
  );

  console.log(
    "FNAA_LAYER8_BROWSER_PROVEN",
    JSON.stringify(
      {
        path:
          result.path,
        width:
          result.width,
        height:
          result.height,
        pixelsSha256:
          result.pixelsSha256,
        pngBytes:
          result.pngBytes,
        relay:
          proof.relay
      }
    )
  );
} finally {
  await browser.close();
  await new Promise(
    resolve =>
      server.close(
        resolve
      )
  );
}
