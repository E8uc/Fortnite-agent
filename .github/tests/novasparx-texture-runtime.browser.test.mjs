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

const BUILDPATCH_MAX_CHUNK_BYTES =
  8 * 1024 * 1024;

const BUILDPATCH_CHUNK_BASE =
  new URL(
    "https://egdownload.fastly-edge.com/Builds/Fortnite/CloudDir/"
  );

const RELAY_ALLOWED_HOSTS =
  new Set([
    "egdownload.fastly-edge.com",
    "download.epicgames.com",
    "export-service-new.dillyapis.com",
    "fortnite-direct.dillycdn.com",
    "stormforge.dillycdn.com"
  ]);

let relayRequests = 0;
let relayBytes = 0;
let chunkRelayRequests = 0;
let chunkRelayBytes = 0;
let manifestRelayRequests = 0;
let manifestRelayBytes = 0;
let exactImageRequests = 0;
let legacyTextureRequests = 0;

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
          "/image"
        ) {
          exactImageRequests++;

          res.writeHead(
            404,
            {
              "Content-Type":
                "text/plain; charset=utf-8",
              "Cache-Control":
                "no-store"
            }
          );

          res.end(
            "No direct image in the Layer 8 UI proof."
          );

          return;
        }

        if (
          requestUrl.pathname ===
          "/nova/texture"
        ) {
          legacyTextureRequests++;

          res.writeHead(
            500,
            {
              "Content-Type":
                "text/plain; charset=utf-8",
              "Cache-Control":
                "no-store"
            }
          );

          res.end(
            "Legacy Texture fallback must not be used by the Layer 8 UI proof."
          );

          return;
        }

        if (
          requestUrl.pathname ===
          "/nova-edge/manifest"
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
              "Invalid manifest relay URL"
            );
            return;
          }

          if (
            target.protocol !==
              "https:" ||
            !RELAY_ALLOWED_HOSTS
              .has(
                target.hostname
                  .toLowerCase()
              )
          ) {
            res.writeHead(400);
            res.end(
              "Invalid manifest relay target"
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
                  "follow",
                headers: {
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
              "Manifest relay upstream HTTP " +
              upstream.status
            );
            return;
          }

          const bytes =
            new Uint8Array(
              await upstream
                .arrayBuffer()
            );

          if (
            bytes.byteLength < 32 ||
            bytes.byteLength >
              64 *
              1024 *
              1024
          ) {
            res.writeHead(502);
            res.end(
              "Manifest relay payload exceeded byte budget"
            );
            return;
          }

          manifestRelayRequests++;
          manifestRelayBytes +=
            bytes.byteLength;

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/octet-stream",
              "Content-Length":
                String(
                  bytes.byteLength
                ),
              "Cache-Control":
                "no-store"
            }
          );

          res.end(
            Buffer.from(
              bytes
            )
          );

          return;
        }

        if (
          requestUrl.pathname.startsWith(
            "/nova-edge/chunk/"
          )
        ) {
          let relative;

          try {
            relative =
              decodeURIComponent(
                requestUrl.pathname.slice(
                  "/nova-edge/chunk/".length
                )
              );
          } catch {
            res.writeHead(400);
            res.end(
              "Invalid BuildPatch chunk path"
            );
            return;
          }

          if (
            !relative ||
            relative.includes("..") ||
            relative.includes("\\") ||
            !relative
              .toLowerCase()
              .endsWith(
                ".chunk"
              )
          ) {
            res.writeHead(400);
            res.end(
              "Invalid BuildPatch chunk path"
            );
            return;
          }

          const target =
            new URL(
              relative,
              BUILDPATCH_CHUNK_BASE
            );

          if (
            !target
              .toString()
              .startsWith(
                BUILDPATCH_CHUNK_BASE
                  .toString()
              )
          ) {
            res.writeHead(400);
            res.end(
              "Invalid BuildPatch chunk target"
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
              "BuildPatch chunk upstream HTTP " +
              upstream.status
            );
            return;
          }

          const bytes =
            new Uint8Array(
              await upstream
                .arrayBuffer()
            );

          if (
            bytes.byteLength < 32 ||
            bytes.byteLength >
              BUILDPATCH_MAX_CHUNK_BYTES
          ) {
            res.writeHead(502);
            res.end(
              "BuildPatch chunk exceeded byte budget"
            );
            return;
          }

          chunkRelayRequests++;
          chunkRelayBytes +=
            bytes.byteLength;

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/octet-stream",
              "Content-Length":
                String(
                  bytes.byteLength
                ),
              "Cache-Control":
                "no-store"
            }
          );

          res.end(
            Buffer.from(
              bytes
            )
          );

          return;
        }

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
<div id="toolsOverlay" hidden aria-hidden="true">
  <button id="toolsBackBtn" type="button">Back</button>
  <div id="toolsTabs"></div>
  <div id="toolsContent"></div>
</div>
<div id="guestLoginBanner" hidden></div>
<button id="guestLoginBtn" type="button" hidden>Login</button>
<script>
  window.FNAA_CONFIG = {
    apiEndpoint: location.origin
  };

  const textureCapabilities = {
    kind: "texture",
    eligibleView3D: false,
    eligibleViewImage: true,
    canPreview: true,
    canView3D: false,
    canViewImage: true,
    previewMode: "image",
    canListen: false,
    canDownload: true,
    canExportUEFN: false,
    downloadFormats: ["json"],
    tags: ["TEXTURE"]
  };

  window.NovaSparxAssociations = {
    diagnosePath: () => ({
      family: "texture",
      kind: "texture",
      source: "typed-path",
      confidence: 100
    }),
    family: () => "texture",
    capabilityProfile: () => ({ ...textureCapabilities }),
    classify: async () => ({
      family: "texture",
      kind: "texture",
      source: "typed-path",
      confidence: 100,
      capabilities: { ...textureCapabilities },
      tags: ["TEXTURE"]
    }),
    allowDirectImage: () => false,
    allowTextureDecode: () => true
  };

  window.NovaSparxBrowserGuard = {
    status: () => ({
      isMobile: true,
      isIOS: true,
      recoveryMode: false
    })
  };

  window.requestIdleCallback = () => 0;
</script>
<script src="/novasparx-texture-runtime.js"></script>
<script src="/preview.js"></script>
<script src="/tools.js"></script>`;

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
                // Match the established 256×256 desktop/browser reference
                // so the integration proof compares the exact same mip.
                maxSize:
                  256
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
    chunkRelayRequests >
      0,
    "FNAA Layer 8 never used the controlled BuildPatch chunk relay"
  );

  assert.ok(
    chunkRelayBytes >
      0,
    "FNAA Layer 8 BuildPatch chunk relay transferred no bytes"
  );

  assert.ok(
    manifestRelayRequests >
      0 &&
    manifestRelayBytes >
      0,
    "FNAA Layer 8 did not fetch the Fortnite manifest through the metadata relay"
  );

  const uiChunkBefore = {
    requests:
      chunkRelayRequests,
    bytes:
      chunkRelayBytes
  };

  const ui =
    await page.evaluate(
      async target => {
        if (
          typeof globalThis
            .FortnitePreview
            ?.render !==
            "function"
        ) {
          throw new Error(
            "FortnitePreview.render is unavailable."
          );
        }

        const host =
          document.createElement(
            "div"
          );

        host.id =
          "layer8-view-image-proof";

        document.body.append(
          host
        );

        const rendered =
          await globalThis
            .FortnitePreview
            .render(
              host,
              target.toLowerCase(),
              null,
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

        const status =
          host.querySelector(
            ".mesh-image-status"
          );

        if (!image) {
          throw new Error(
            "View Image did not create its image element."
          );
        }

        return {
          state:
            rendered?.state || "",
          kind:
            rendered?.kind || "",
          imageHidden:
            image.hidden,
          imageSrc:
            image.currentSrc ||
            image.src ||
            "",
          naturalWidth:
            image.naturalWidth,
          naturalHeight:
            image.naturalHeight,
          meta:
            meta?.textContent ||
            "",
          statusHidden:
            status?.hidden ??
            false,
          status:
            status?.textContent ||
            ""
        };
      },
      TARGET
    );

  const uiChunk = {
    requests:
      chunkRelayRequests -
      uiChunkBefore.requests,
    bytes:
      chunkRelayBytes -
      uiChunkBefore.bytes
  };

  assert.equal(
    ui.state,
    "ready",
    "View Image did not reach the ready state"
  );

  assert.equal(
    ui.kind,
    "texture",
    "View Image did not resolve through the Texture route"
  );

  assert.equal(
    ui.imageHidden,
    false,
    "View Image kept the decoded Texture hidden"
  );

  assert.ok(
    ui.imageSrc.startsWith(
      "blob:"
    ),
    "View Image did not render the browser-decoded PNG blob"
  );

  assert.ok(
    ui.naturalWidth >
      0 &&
    ui.naturalHeight >
      0 &&
    ui.naturalWidth <=
      512 &&
    ui.naturalHeight <=
      512,
    "View Image returned invalid browser preview dimensions"
  );

  assert.match(
    ui.meta,
    /browser CUE4Parse/i,
    "View Image metadata does not identify the browser Layer 8 path"
  );

  assert.ok(
    exactImageRequests >
      0,
    "View Image did not exercise the exact-image miss before Layer 8"
  );

  assert.equal(
    legacyTextureRequests,
    0,
    "View Image fell back to the legacy Texture backend"
  );

  assert.ok(
    uiChunk.requests >
      0 &&
    uiChunk.bytes >
      0,
    "View Image did not use the controlled BuildPatch chunk relay"
  );

  console.log(
    "FNAA_VIEW_IMAGE_LAYER8_PROVEN",
    JSON.stringify({
      state:
        ui.state,
      kind:
        ui.kind,
      size:
        ui.naturalWidth +
        "x" +
        ui.naturalHeight,
      meta:
        ui.meta,
      exactImageRequests,
      legacyTextureRequests,
      chunkRelay:
        uiChunk
    })
  );

  const cardCountersBefore = {
    relayRequests,
    relayBytes,
    chunkRelayRequests,
    chunkRelayBytes,
    exactImageRequests,
    legacyTextureRequests
  };

  const cardStart = await page.evaluate(async target => {
    window.FortniteAgent = {
      searchDatabase: async () => ({
        results: [
          {
            path: target,
            source: "layer8-proof",
            match: "exact"
          }
        ],
        total: 1,
        source: "layer8-proof"
      }),
      isSignedIn: () => true,
      beginGuestToolSlowmode: () => {}
    };

    window.FortniteTools.open("assets");

    const input = document.querySelector("#assetQuery");
    const search = document.querySelector("#assetSearch");

    if (!input || !search) {
      throw new Error("FNAA asset search UI did not render.");
    }

    input.value = "layer8-proof";
    search.click();

    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      const card = document.querySelector(".asset-result-card");
      const button = card?.querySelector('[data-asset-action="preview"]');

      if (
        card?.dataset.assetClassified === "1" &&
        button &&
        !button.disabled
      ) {
        const initialLabel = button.textContent || "";
        button.click();

        return {
          initialLabel,
          assetKind: card.dataset.assetKind || "",
          path: card.dataset.assetPath || ""
        };
      }

      await new Promise(resolve => setTimeout(resolve, 20));
    }

    throw new Error("Texture View Image card never became actionable.");
  }, TARGET);

  await page.waitForFunction(() => {
    const card = document.querySelector(".asset-result-card");
    const image = card?.querySelector(".mesh-preview-image");

    return Boolean(
      image &&
      !image.hidden &&
      (image.currentSrc || image.src || "").startsWith("blob:") &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0
    );
  });

  const cardUi = await page.evaluate(() => {
    const card = document.querySelector(".asset-result-card");
    const button = card?.querySelector('[data-asset-action="preview"]');
    const image = card?.querySelector(".mesh-preview-image");
    const meta = card?.querySelector(".mesh-image-meta");
    const status = card?.querySelector(".mesh-image-status");
    const panel = card?.querySelector("[data-asset-panel]");

    return {
      buttonLabel: button?.textContent || "",
      panelHidden: panel?.hidden ?? true,
      imageHidden: image?.hidden ?? true,
      imageSrc: image?.currentSrc || image?.src || "",
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
      meta: meta?.textContent || "",
      status: status?.textContent || ""
    };
  });

  const cardNetwork = {
    relayRequests: relayRequests - cardCountersBefore.relayRequests,
    relayBytes: relayBytes - cardCountersBefore.relayBytes,
    chunkRelayRequests: chunkRelayRequests - cardCountersBefore.chunkRelayRequests,
    chunkRelayBytes: chunkRelayBytes - cardCountersBefore.chunkRelayBytes,
    exactImageRequests: exactImageRequests - cardCountersBefore.exactImageRequests,
    legacyTextureRequests: legacyTextureRequests - cardCountersBefore.legacyTextureRequests
  };

  assert.equal(cardStart.initialLabel, "View Image");
  assert.equal(cardStart.assetKind, "texture");
  assert.equal(cardStart.path, TARGET);
  assert.equal(cardUi.panelHidden, false);
  assert.equal(cardUi.imageHidden, false);
  assert.ok(cardUi.imageSrc.startsWith("blob:"));
  assert.ok(cardUi.naturalWidth > 0 && cardUi.naturalHeight > 0);
  assert.match(cardUi.meta, /browser CUE4Parse/i);
  assert.ok(cardNetwork.exactImageRequests > 0);
  assert.equal(cardNetwork.legacyTextureRequests, 0);
  assert.ok(cardNetwork.chunkRelayRequests > 0 && cardNetwork.chunkRelayBytes > 0);

  console.log(
    "FNAA_TEXTURE_CARD_LAYER8_PROVEN",
    JSON.stringify({
      cardStart,
      cardUi: {
        buttonLabel: cardUi.buttonLabel,
        size: cardUi.naturalWidth + "x" + cardUi.naturalHeight,
        meta: cardUi.meta
      },
      network: cardNetwork
    })
  );

  await page.addScriptTag({url:'/novasparx-renderer.js'});
  await page.addScriptTag({url:'/asset-diagnosis.js'});
  await page.addScriptTag({url:'/novasparx-associations.js'});
  const meshPath = "StaticMesh'FortniteGame/Plugins/GameFeatures/Juno/FigureCosmetics/Content/Props/Emote/CallWaiting/Mesh/SM_CallWaiting.uasset'";
  await page.evaluate(meshPath => {
    window.FortniteAgent.searchDatabase = async () => ({results:[{path:meshPath,source:'live-mesh-proof',match:'exact'}],total:1});
    window.FortniteTools.open('assets');
    document.querySelector('#assetQuery').value='CallWaiting';
    document.querySelector('#assetSearch').click();
  },meshPath);
  const meshButton=page.locator('.asset-result-card [data-asset-action="preview"]');
  await page.waitForFunction(()=>{
    const c=document.querySelector('.asset-result-card');
    return c?.dataset.assetKind==='staticmesh' && !c.querySelector('[data-asset-action="preview"]').disabled;
  });
  assert.equal(await meshButton.textContent(),'View Image');
  await meshButton.click();
  await page.waitForFunction(()=>{
    const image=document.querySelector('.asset-result-card .mesh-preview-image');
    return image && !image.hidden && image.complete && image.naturalWidth>0;
  },null,{timeout:240000});
  await page.waitForFunction(()=>{
    const meta=document.querySelector('.asset-result-card .mesh-image-meta')?.textContent || '';
    return /Mesh \+ Texture \+ Material/.test(meta);
  },null,{timeout:240000});
  const meshUi=await page.evaluate(()=>{
    const card=document.querySelector('.asset-result-card'),image=card.querySelector('.mesh-preview-image');
    return {width:image.naturalWidth,height:image.naturalHeight,src:image.src,meta:card.querySelector('.mesh-image-meta')?.textContent};
  });
  assert.ok(meshUi.src.startsWith('blob:'));
  assert.equal(meshUi.width,512);assert.equal(meshUi.height,512);
  assert.match(meshUi.meta,/44 triangles/);
  assert.match(meshUi.meta,/Mesh \+ Texture \+ Material/,'Verified Mesh View Image must finish with the existing Texture engine applied to the material');
  assert.doesNotMatch(meshUi.meta,/unsupported/i);
  assert.equal(legacyTextureRequests,0);
  await page.locator('.asset-result-card .mesh-preview-image').screenshot({path:'fnaa-real-mesh.png'});
  fs.writeFileSync('fnaa-mesh-proof.json',JSON.stringify({path:meshPath,...meshUi},null,2));
  console.log('FNAA_REAL_MESH_BUTTON_IMAGE_PROVEN',JSON.stringify(meshUi));

  // Large Apollo container proof: this is the asset that succeeds at the
  // low-level Mesh parser but previously stopped before Texture + Material in
  // the real FNAA View Image flow.
  const lazyMeshPath =
    "StaticMesh'FortniteGame/Content/Environments/Apollo/Props/LazyLakeSign/Mesh/SM_LazyLakeLodge_Sign.uasset'";

  await page.evaluate(lazyMeshPath => {
    window.FortniteAgent.searchDatabase =
      async () => ({
        results: [{
          path: lazyMeshPath,
          source: 'live-lazy-lake-proof',
          match: 'exact'
        }],
        total: 1
      });

    window.FortniteTools.open('assets');
    document.querySelector('#assetQuery').value =
      'LazyLakeLodge';
    document.querySelector('#assetSearch').click();
  }, lazyMeshPath);

  const lazyButton =
    page.locator(
      '.asset-result-card [data-asset-action="preview"]'
    );

  await page.waitForFunction(() => {
    const card =
      document.querySelector(
        '.asset-result-card'
      );

    return (
      card?.dataset.assetKind ===
        'staticmesh' &&
      !card
        .querySelector(
          '[data-asset-action="preview"]'
        )
        .disabled
    );
  });

  assert.equal(
    await lazyButton.textContent(),
    'View Image'
  );

  await lazyButton.click();

  await page.waitForFunction(() => {
    const image =
      document.querySelector(
        '.asset-result-card .mesh-preview-image'
      );

    return (
      image &&
      !image.hidden &&
      image.complete &&
      image.naturalWidth > 0
    );
  }, null, {timeout: 240000});

  await page.waitForFunction(() => {
    const card =
      document.querySelector(
        '.asset-result-card'
      );

    const meta =
      card
        ?.querySelector(
          '.mesh-image-meta'
        )
        ?.textContent ||
      '';

    const status =
      card
        ?.querySelector(
          '.mesh-image-status'
        )
        ?.textContent ||
      '';

    return (
      /Mesh \+ Texture \+ Material/.test(meta) ||
      /Texture \+ Material unavailable|decoded but not applied|View Image unavailable/i
        .test(meta + ' ' + status)
    );
  }, null, {timeout: 240000});

  const lazyUi =
    await page.evaluate(() => {
      const card =
        document.querySelector(
          '.asset-result-card'
        );

      const image =
        card.querySelector(
          '.mesh-preview-image'
        );

      return {
        width:
          image.naturalWidth,
        height:
          image.naturalHeight,
        src:
          image.src,
        meta:
          card
            .querySelector(
              '.mesh-image-meta'
            )
            ?.textContent ||
          '',
        status:
          card
            .querySelector(
              '.mesh-image-status'
            )
            ?.textContent ||
          ''
      };
    });

  console.log(
    'FNAA_LAZY_LAKE_MESH_IMAGE_RESULT',
    JSON.stringify(lazyUi)
  );

  assert.ok(
    lazyUi.src.startsWith('blob:')
  );

  assert.equal(
    lazyUi.width,
    512
  );

  assert.equal(
    lazyUi.height,
    512
  );

  assert.match(
    lazyUi.meta,
    /60 triangles/
  );

  assert.match(
    lazyUi.meta,
    /Mesh \+ Texture \+ Material/,
    'Lazy Lake View Image must finish with its Diffuse Texture and Material applied: ' +
      JSON.stringify(lazyUi)
  );

  assert.doesNotMatch(
    lazyUi.meta + ' ' +
      lazyUi.status,
    /unavailable|not applied|error/i
  );

  await page
    .locator(
      '.asset-result-card .mesh-preview-image'
    )
    .screenshot({
      path:
        'fnaa-lazy-lake-mesh.png'
    });

  console.log(
    'FNAA_LAZY_LAKE_MESH_IMAGE_PROVEN',
    JSON.stringify(lazyUi)
  );

  const failedPreview = await page.evaluate(async target => {
    const original = globalThis.NovaSparxTextureRuntime;
    globalThis.NovaSparxTextureRuntime = {
      resolveTexture: async () => { throw new DOMException("forced native decode failure", "NotSupportedError"); }
    };
    try {
      const host = document.createElement("div");
      document.body.append(host);
      const result = await globalThis.FortnitePreview.render(host, target.toLowerCase(), null, { assetKind: "texture" });
      return { result, hidden: host.querySelector(".mesh-preview-image")?.hidden,
        status: host.querySelector(".mesh-image-status")?.textContent };
    } finally { globalThis.NovaSparxTextureRuntime = original; }
  }, TARGET);
  assert.equal(failedPreview.result.state, "error");
  assert.equal(failedPreview.hidden, true);
  assert.match(failedPreview.status, /forced native decode failure/);
  assert.equal(legacyTextureRequests, 0, "Native failure must not invoke hosted Texture decoding");

  const proof = {
    result,
    ui,
    cardStart,
    cardUi,
    cardNetwork,
    exactImageRequests,
    legacyTextureRequests,
    relay: {
      requests:
        relayRequests,
      bytes:
        relayBytes
    },
    chunkRelay: {
      requests:
        chunkRelayRequests,
      bytes:
        chunkRelayBytes
    },
    manifestRelay: {
      requests:
        manifestRelayRequests,
      bytes:
        manifestRelayBytes
    },
    uiChunk,
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
        chunkRelay:
          proof.chunkRelay,
        relay:
          proof.relay,
        manifestRelay:
          proof.manifestRelay
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
