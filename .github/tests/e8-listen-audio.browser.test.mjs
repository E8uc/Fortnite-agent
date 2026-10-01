import fs from "node:fs";
import vm from "node:vm";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { chromium, webkit, devices } from "playwright";

const site =
  process.argv[2] ||
  "Fortnite-Ai-Agent-GitHub-Cloudflare";

globalThis.window =
  globalThis;

vm.runInThisContext(
  fs.readFileSync(
    `${site}/asset-diagnosis.js`,
    "utf8"
  ),
  {
    filename:
      "asset-diagnosis.js"
  }
);

const diagnosis =
  globalThis
    .FNAAAssetDiagnosis;

if (!diagnosis) {
  throw new Error(
    "FNAAAssetDiagnosis did not load."
  );
}

function assetLeaf(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(
      /\.uasset$/i,
      ""
    ) || "";
}

const candidates = [];
const input =
  fs.createReadStream(
    `${site}/database/fortnite_assets.gz`
  )
    .pipe(
      createGunzip()
    );

const lines =
  createInterface({
    input,
    crlfDelay:
      Infinity
  });

for await (
  const raw of lines
) {
  const path =
    String(raw || "")
      .trim();

  if (
    !path ||
    !/^FortniteGame\//i
      .test(path)
  ) {
    continue;
  }

  const leaf =
    assetLeaf(path);

  if (
    !/^(?:SW_|USW_|SoundWave_)/i
      .test(leaf)
  ) {
    continue;
  }

  if (
    diagnosis
      .diagnosePath(path)
      .kind !==
    "audio"
  ) {
    continue;
  }

  candidates.push(path);

  if (
    candidates.length >= 16
  ) {
    break;
  }
}

lines.close();
input.destroy();

if (!candidates.length) {
  throw new Error(
    "No real SoundWave-style audio paths were found in the current database."
  );
}

function unwrap(value) {
  let text =
    String(value || "")
      .trim();

  const wrapped =
    text.match(
      /^(?:[A-Za-z0-9_]+)?['"]([^'"]+)['"]$/
    );

  if (wrapped?.[1]) {
    text =
      wrapped[1];
  }

  return text.replace(
    /\\/g,
    "/"
  );
}

function objectPath(raw) {
  let value =
    unwrap(raw)
      .replace(
        /\.(?:uasset|uexp|ubulk)$/i,
        ""
      );

  const dot =
    value.lastIndexOf(".");

  if (
    dot >
    value.lastIndexOf("/")
  ) {
    value =
      value.slice(0, dot);
  }

  if (
    /^FortniteGame\/Content\//i
      .test(value)
  ) {
    return (
      "/Game/" +
      value.slice(
        "FortniteGame/Content/"
          .length
      )
    );
  }

  if (
    /^Engine\/Content\//i
      .test(value)
  ) {
    return (
      "/Engine/" +
      value.slice(
        "Engine/Content/"
          .length
      )
    );
  }

  const plugin =
    value.match(
      /^(?:FortniteGame\/)?Plugins\/(?:GameFeatures\/)?([^/]+)\/Content\/(.+)$/i
    );

  if (plugin) {
    return (
      "/" +
      plugin[1] +
      "/" +
      plugin[2]
    );
  }

  return value;
}

function filePath(raw) {
  let value =
    unwrap(raw);

  if (
    /\.uasset$/i
      .test(value)
  ) {
    return value;
  }

  const dot =
    value.lastIndexOf(".");

  if (
    dot >
    value.lastIndexOf("/")
  ) {
    value =
      value.slice(0, dot);
  }

  if (
    /^FortniteGame\/(?:Content|Plugins)\//i
      .test(value) ||
    /^Engine\/Content\//i
      .test(value)
  ) {
    return (
      value +
      ".uasset"
    );
  }

  if (
    value.startsWith(
      "/Game/"
    )
  ) {
    return (
      "FortniteGame/Content/" +
      value.slice(6) +
      ".uasset"
    );
  }

  if (
    value.startsWith(
      "/Engine/"
    )
  ) {
    return (
      "Engine/Content/" +
      value.slice(8) +
      ".uasset"
    );
  }

  const mount =
    value.match(
      /^\/([^/]+)\/(.+)$/
    );

  if (mount) {
    return (
      "FortniteGame/Plugins/GameFeatures/" +
      mount[1] +
      "/Content/" +
      mount[2] +
      ".uasset"
    );
  }

  return (
    value +
    ".uasset"
  );
}

const exportBase =
  "https://export-service-new.dillyapis.com/v1/export";

const attempts = [];

for (
  const path of
  candidates
) {
  for (
    const value of
    [
      objectPath(path),
      filePath(path)
    ]
  ) {
    if (!value) continue;

    const url =
      exportBase +
      "?path=" +
      encodeURIComponent(
        value
      ) +
      "&raw=false";

    if (
      !attempts.some(
        (item) =>
          item.url === url
      )
    ) {
      attempts.push({
        path,
        value,
        url
      });
    }
  }
}

const engine =
  process.env
    .FNAA_BROWSER_ENGINE ||
  "chromium";

const browserType =
  engine === "webkit"
    ? webkit
    : chromium;

const browser =
  await browserType.launch({
    headless: true
  });

try {
  const profile =
    process.env
      .FNAA_MOBILE_PROFILE ===
        "ios"
      ? devices[
          "iPhone 13"
        ]
      : {};

  const context =
    await browser.newContext(
      profile
    );

  const page =
    await context.newPage();

  await page.setContent(
    "<!doctype html><meta name=\"viewport\" content=\"width=device-width\"><body></body>"
  );

  const result =
    await page.evaluate(
      async ({
        attempts
      }) => {
        const audio =
          document.createElement(
            "audio"
          );

        audio.preload =
          "metadata";

        audio.setAttribute(
          "playsinline",
          ""
        );

        document.body
          .appendChild(audio);

        const errors = [];

        for (
          const attempt of
          attempts
        ) {
          const probe =
            await new Promise(
              (resolve) => {
                let done =
                  false;

                let timer =
                  null;

                const finish =
                  (ok, reason) => {
                    if (done) {
                      return;
                    }

                    done = true;

                    clearTimeout(
                      timer
                    );

                    audio.onloadedmetadata =
                      null;

                    audio.oncanplay =
                      null;

                    audio.onerror =
                      null;

                    resolve({
                      ok,
                      reason,
                      duration:
                        Number.isFinite(
                          audio.duration
                        )
                          ? audio.duration
                          : null,
                      readyState:
                        audio.readyState,
                      networkState:
                        audio.networkState
                    });
                  };

                audio.onloadedmetadata =
                  () =>
                    finish(
                      true,
                      "loadedmetadata"
                    );

                audio.oncanplay =
                  () =>
                    finish(
                      true,
                      "canplay"
                    );

                audio.onerror =
                  () =>
                    finish(
                      false,
                      "media-error-" +
                        String(
                          audio.error
                            ?.code ||
                          "unknown"
                        )
                    );

                timer =
                  setTimeout(
                    () =>
                      finish(
                        false,
                        "timeout"
                      ),
                    12_000
                  );

                audio.src =
                  attempt.url;

                try {
                  audio.load();
                } catch (error) {
                  finish(
                    false,
                    String(
                      error?.message ||
                      error
                    )
                  );
                }
              }
            );

          if (probe.ok) {
            return {
              ok: true,
              attempt,
              probe
            };
          }

          errors.push({
            path:
              attempt.path,
            value:
              attempt.value,
            reason:
              probe.reason
          });
        }

        return {
          ok: false,
          errors
        };
      },
      {
        attempts
      }
    );

  if (!result.ok) {
    console.error(
      JSON.stringify(
        {
          engine,
          candidates:
            candidates.slice(
              0,
              16
            ),
          result
        },
        null,
        2
      )
    );

    throw new Error(
      "No current E8 SoundWave candidate produced browser-playable Dilly audio."
    );
  }

  console.log(
    JSON.stringify(
      {
        engine,
        mobile:
          process.env
            .FNAA_MOBILE_PROFILE ||
          "desktop",
        verifiedPath:
          result.attempt.path,
        exportPath:
          result.attempt.value,
        duration:
          result.probe
            .duration,
        readyState:
          result.probe
            .readyState
      },
      null,
      2
    )
  );

  await context.close();
} finally {
  await browser.close();
}
