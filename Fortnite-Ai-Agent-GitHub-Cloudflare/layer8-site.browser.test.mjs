import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const SITE_ROOT =
  path.resolve(
    process.argv[2] ||
    "Fortnite-Ai-Agent-GitHub-Cloudflare"
  );

const TEST_PATH =
  "FortniteGame/Plugins/GameFeatures/BRCosmetics/Content/Animation/Game/MainPlayer/Emotes/FaithPerch/FX/T_Emote_FaithPerch_SoftGlow.uasset";

const EXPECTED_SHA =
  "F2C39729F3CE99A7D5388F64A3AF4EEF7B5135C6D0276EE988AD05374760D6C7";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".gz", "application/gzip"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

assert.ok(
  fs.existsSync(
    path.join(
      SITE_ROOT,
      "index.html"
    )
  ),
  "Pass the prepared FNAA site directory"
);

assert.ok(
  fs.existsSync(
    path.join(
      SITE_ROOT,
      "novasparx-runtime",
      "worker.js"
    )
  ),
  "NovaSparx Worker bundle is missing"
);

assert.ok(
  fs.existsSync(
    path.join(
      SITE_ROOT,
      "novasparx-location-index",
      "manifest.json"
    )
  ),
  "NovaSparx location index is missing"
);

function safeFile(
  requestUrl
) {
  const url =
    new URL(
      requestUrl,
      "http://127.0.0.1"
    );

  let pathname =
    decodeURIComponent(
      url.pathname
    );

  const prefix =
    "/Fortnite-agent/";

  if (
    pathname ===
    "/Fortnite-agent"
  ) {
    pathname =
      prefix;
  }

  if (
    !pathname.startsWith(
      prefix
    )
  ) {
    return null;
  }

  let relative =
    pathname.slice(
      prefix.length
    );

  if (!relative) {
    relative =
      "index.html";
  }

  const target =
    path.resolve(
      SITE_ROOT,
      relative
    );

  const root =
    SITE_ROOT.endsWith(
      path.sep
    )
      ? SITE_ROOT
      : SITE_ROOT +
        path.sep;

  if (
    target !==
      SITE_ROOT &&
    !target.startsWith(
      root
    )
  ) {
    return null;
  }

  return target;
}

const server =
  http.createServer(
    (req, res) => {
      const file =
        safeFile(
          req.url ||
          "/"
        );

      if (!file) {
        res.writeHead(
          404
        );

        res.end();
        return;
      }

      let target =
        file;

      try {
        if (
          fs.statSync(
            target
          )
            .isDirectory()
        ) {
          target =
            path.join(
              target,
              "index.html"
            );
        }

        const bytes =
          fs.readFileSync(
            target
          );

        res.statusCode =
          200;

        res.setHeader(
          "Content-Type",
          MIME.get(
            path.extname(
              target
            )
              .toLowerCase()
          ) ||
          "application/octet-stream"
        );

        res.setHeader(
          "Content-Length",
          String(
            bytes.length
          )
        );

        res.setHeader(
          "Cache-Control",
          "no-store"
        );

        res.end(
          bytes
        );
      } catch {
        res.writeHead(
          404
        );

        res.end();
      }
    }
  );

await new Promise(
  (resolve) =>
    server.listen(
      3000,
      "127.0.0.1",
      resolve
    )
);

let browser;

try {
  browser =
    await chromium.launch({
      headless:
        true
    });

  const page =
    await browser.newPage();

  const logs = [];

  page.on(
    "console",
    (message) => {
      const line =
        message.text();

      logs.push(
        line
      );

      console.log(
        line
      );
    }
  );

  page.on(
    "pageerror",
    (error) => {
      logs.push(
        "PAGE_ERROR: " +
        (
          error?.stack ||
          error
        )
      );
    }
  );

  await page.goto(
    "http://127.0.0.1:3000/Fortnite-agent/index.html",
    {
      waitUntil:
        "domcontentloaded",
      timeout:
        120000
    }
  );

  await page.waitForFunction(
    () =>
      globalThis
        .NovaSparxLocalParser
        ?.status?.()
        ?.texture ===
      true,
    null,
    {
      timeout:
        120000
    }
  );

  const runtimeStatus =
    await page.evaluate(
      () => ({
        parser:
          globalThis
            .NovaSparxLocalParser
            ?.status?.() ||
          null,
        texture:
          globalThis
            .NovaSparxTextureRuntime
            ?.status?.() ||
          null,
        transport:
          globalThis
            .NovaSparxBrowserTransport
            ?.status?.() ||
          null
      })
    );

  assert.equal(
    runtimeStatus
      .parser
      ?.texture,
    true,
    "FNAA did not register the browser Texture engine"
  );

  assert.equal(
    runtimeStatus
      .texture
      ?.texture,
    true,
    "FNAA Texture runtime did not report its capability"
  );

  const cancellation =
    await page.evaluate(
      async (assetPath) => {
        const controller =
          new AbortController();

        controller.abort(
          "site-test-pre-abort"
        );

        try {
          await globalThis
            .NovaSparxLocalParser
            .resolveTexture(
              assetPath,
              {
                signal:
                  controller.signal,
                maxPreviewSize:
                  256
              }
            );

          return {
            rejected:
              false
          };
        } catch (
          error
        ) {
          return {
            rejected:
              true,
            name:
              error?.name ||
              "",
            code:
              error?.code ||
              ""
          };
        }
      },
      TEST_PATH
    );

  assert.equal(
    cancellation.rejected,
    true,
    "A pre-aborted Texture request unexpectedly succeeded"
  );

  assert.equal(
    cancellation.name,
    "AbortError",
    "Cancelled Texture request did not preserve AbortError"
  );

  const direct =
    await page.evaluate(
      async (assetPath) => {
        const result =
          await globalThis
            .NovaSparxLocalParser
            .resolveTexture(
              assetPath,
              {
                maxPreviewSize:
                  256
              }
            );

        if (
          !(
            result?.pixels instanceof
            ArrayBuffer
          )
        ) {
          throw new Error(
            "FNAA browser Texture runtime returned no RGBA ArrayBuffer"
          );
        }

        const hash =
          await crypto.subtle
            .digest(
              "SHA-256",
              result.pixels
            );

        const sha256 =
          Array.from(
            new Uint8Array(
              hash
            ),
            (value) =>
              value
                .toString(16)
                .padStart(
                  2,
                  "0"
                )
          )
            .join("")
            .toUpperCase();

        return {
          path:
            result.path,
          width:
            result.width,
          height:
            result.height,
          sha256,
          blobSize:
            result.blob?.size ||
            0,
          container:
            result.container ||
            "",
          source:
            result.source ||
            ""
        };
      },
      TEST_PATH
    );

  assert.equal(
    direct.width,
    256
  );

  assert.equal(
    direct.height,
    256
  );

  assert.equal(
    direct.sha256,
    EXPECTED_SHA,
    "FNAA site runtime pixels differ from desktop CUE4Parse reference"
  );

  assert.ok(
    direct.blobSize >
      0,
    "FNAA site runtime produced no PNG Blob"
  );

  assert.equal(
    direct.source,
    "browser-wasm"
  );

  assert.match(
    direct.container,
    /\.utoc$/i
  );

  console.log(
    "FNAA_LAYER8_DIRECT_PROVEN",
    JSON.stringify(
      direct
    )
  );

  const preview =
    await page.evaluate(
      async (assetPath) => {
        const host =
          document.createElement(
            "div"
          );

        host.id =
          "layer8-site-preview-host";

        const button =
          document.createElement(
            "button"
          );

        button.type =
          "button";

        button.textContent =
          "View Image";

        document.body.append(
          button,
          host
        );

        const result =
          await globalThis
            .FortnitePreview
            .toggle(
              host,
              assetPath,
              button,
              {
                assetKind:
                  "texture"
              }
            );

        const image =
          host.querySelector(
            ".mesh-preview-image"
          );

        const meta =
          host.querySelector(
            ".mesh-image-meta"
          );

        if (!image) {
          throw new Error(
            "FNAA preview host created no image element"
          );
        }

        if (
          !image.complete ||
          image.naturalWidth <=
            0 ||
          image.naturalHeight <=
            0 ||
          image.hidden
        ) {
          throw new Error(
            "FNAA Layer 8 preview image is not visibly loaded"
          );
        }

        return {
          result,
          naturalWidth:
            image.naturalWidth,
          naturalHeight:
            image.naturalHeight,
          imageSource:
            image.src,
          meta:
            meta?.textContent ||
            "",
          buttonText:
            button.textContent ||
            ""
        };
      },
      TEST_PATH
    );

  assert.equal(
    preview.result
      ?.state,
    "ready"
  );

  assert.equal(
    preview.result
      ?.kind,
    "browser-texture",
    "Texture preview did not use the native Layer 8 path"
  );

  assert.equal(
    preview.naturalWidth,
    256
  );

  assert.equal(
    preview.naturalHeight,
    256
  );

  assert.match(
    preview.imageSource,
    /^blob:/,
    "Layer 8 preview did not render the locally decoded PNG Blob"
  );

  assert.match(
    preview.meta,
    /browser CUE4Parse/i,
    "Layer 8 preview metadata does not identify browser CUE4Parse"
  );

  assert.ok(
    !logs.some(
      (line) =>
        line.startsWith(
          "PAGE_ERROR:"
        )
    ),
    "The FNAA site emitted an uncaught page error"
  );

  console.log(
    "FNAA_LAYER8_PREVIEW_PROVEN",
    JSON.stringify(
      preview
    )
  );

  fs.writeFileSync(
    "fnaa-layer8-site-proof.json",
    JSON.stringify(
      {
        runtimeStatus,
        cancellation,
        direct,
        preview,
        logs
      },
      null,
      2
    )
  );

  await page
    .locator(
      "#layer8-site-preview-host .mesh-image-stage"
    )
    .screenshot({
      path:
        "fnaa-layer8-site-preview.png"
    });
} finally {
  await browser
    ?.close();

  await new Promise(
    (resolve) =>
      server.close(
        resolve
      )
  );
}
