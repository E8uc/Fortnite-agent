(() => {
  "use strict";

  const API = String(
    window.FNAA_CONFIG?.apiEndpoint ||
    window.FORTNITE_AI_API_ENDPOINT ||
    ""
  ).trim().replace(/\/+$/, "");

  const objectUrls = new Map();

  const viewerSessions =
    new Map();

  function objectUrlLimit() {
    const state =
      window.NovaSparxBrowserGuard
        ?.status?.() ||
      {};

    if (state.isIOS) {
      return 2;
    }

    if (state.isMobile) {
      return 3;
    }

    return 8;
  }

  function rememberObjectUrl(
    path,
    url
  ) {
    const key =
      String(path || "")
        .trim();

    if (!key || !url) {
      return;
    }

    release(key);

    objectUrls.set(
      key,
      url
    );

    const limit =
      objectUrlLimit();

    while (
      objectUrls.size >
      limit
    ) {
      const oldestKey =
        objectUrls.keys()
          .next()
          .value;

      if (!oldestKey) {
        break;
      }

      const oldestUrl =
        objectUrls.get(
          oldestKey
        );

      try {
        if (oldestUrl) {
          URL.revokeObjectURL(
            oldestUrl
          );
        }
      } catch {}

      objectUrls.delete(
        oldestKey
      );
    }
  }

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx preview was cancelled because a newer request replaced it."
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

  const t = (key, fallback = "") =>
    window.FortniteI18n?.t?.(key) ||
    fallback ||
    key;

  function release(path) {
    const key =
      String(path || "")
        .trim();

    if (!key) return;

    const session =
      viewerSessions.get(
        key
      );

    if (session) {
      try {
        session.controller
          ?.dispose?.();
      } catch {}

      try {
        session.host
          ?.replaceChildren?.();
      } catch {}

      if (session.host) {
        session.host.hidden =
          true;
      }

      if (session.controls) {
        session.controls.hidden =
          true;
      }

      if (
        session.panel
          ?.dataset
          ?.viewerPath ===
        key
      ) {
        delete session.panel
          .dataset.viewerPath;
      }

      viewerSessions.delete(
        key
      );
    }

    const old =
      objectUrls.get(
        key
      );

    if (old) {
      try {
        URL.revokeObjectURL(
          old
        );
      } catch {}

      objectUrls.delete(
        key
      );
    }
  }

  function endpoint(
    route,
    path,
    retry = false
  ) {
    if (!API || !path) {
      return "";
    }

    const url =
      new URL(
        `${API}${route}`
      );

    url.searchParams.set(
      "path",
      String(path).trim()
    );

    if (retry) {
      url.searchParams.set(
        "retry",
        String(Date.now())
      );
    }

    return url.toString();
  }

  function loadImage(
    image,
    url,
    timeoutMs = 18_000,
    signal =
      window.NovaSparxBrowserGuard
        ?.activeSignal?.() ||
      null
  ) {
    return new Promise(
      (resolve, reject) => {
        if (!url) {
          resolve(false);
          return;
        }

        throwIfAborted(
          signal
        );

        let finished = false;
        let timer = null;

        const cleanup =
          () => {
            if (timer) {
              clearTimeout(
                timer
              );
            }

            image.onload =
              null;

            image.onerror =
              null;

            signal
              ?.removeEventListener?.(
                "abort",
                onAbort
              );
          };

        const done =
          (ok) => {
            if (finished) {
              return;
            }

            finished =
              true;

            cleanup();

            resolve(
              Boolean(ok)
            );
          };

        const onAbort =
          () => {
            if (finished) {
              return;
            }

            finished =
              true;

            cleanup();

            try {
              image.removeAttribute(
                "src"
              );
            } catch {}

            reject(
              abortError(
                signal
              )
            );
          };

        timer =
          setTimeout(
            () =>
              done(false),
            timeoutMs
          );

        signal
          ?.addEventListener?.(
            "abort",
            onAbort,
            {
              once:
                true
            }
          );

        image.onload =
          () =>
            done(
              image.naturalWidth > 0 &&
              image.naturalHeight > 0
            );

        image.onerror =
          () =>
            done(false);

        image.src = url;
      }
    );
  }

  async function inspect(
    path,
    options = {}
  ) {
    try {
      return (
        await window.NovaSparx
          ?.inspect?.(
            path,
            options
          )
      ) || null;
    } catch (error) {
      if (
        options.signal
          ?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw abortError(
          options.signal
        );
      }

      return null;
    }
  }

  function assetType(
    info,
    path
  ) {
    const explicit =
      String(
        info?.assetType ||
        info?.type ||
        info?.objectType ||
        info?.className ||
        ""
      ).toLowerCase();

    if (explicit) {
      return explicit;
    }

    const name =
      String(path || "")
        .split("/")
        .pop()
        ?.split(".")[0]
        ?.toLowerCase() ||
      "";

    if (
      /^(t_|tex_|icon_|ui_)/.test(
        name
      )
    ) {
      return "texture2d";
    }

    if (
      /^(mi_|m_)/.test(
        name
      )
    ) {
      return "material";
    }

    if (
      /^(ns_|ps_|vfx_|fx_)/.test(
        name
      )
    ) {
      return "niagara";
    }

    if (
      /^sm_/.test(name)
    ) {
      return "staticmesh";
    }

    if (
      /^sk_/.test(name)
    ) {
      return "skeletalmesh";
    }

    return "";
  }

  function firstMaterial(
    info
  ) {
    if (
      info?.material &&
      typeof info.material ===
      "object"
    ) {
      return info.material;
    }

    if (
      Array.isArray(
        info?.materials
      ) &&
      info.materials.length
    ) {
      return info.materials[0];
    }

    if (
      Array.isArray(
        info?.Materials
      ) &&
      info.Materials.length
    ) {
      return info.Materials[0];
    }

    return null;
  }

  function firstMaterialTexture(
    info
  ) {
    const material =
      firstMaterial(info);

    if (!material) {
      return "";
    }

    for (
      const key of [
        "baseColorTexture",
        "BaseColorTexture",

        "diffuseTexture",
        "DiffuseTexture",

        "emissiveTexture",
        "EmissiveTexture",

        "normalTexture",
        "NormalTexture",

        "opacityTexture",
        "OpacityTexture",

        "packedTexture",
        "PackedTexture"
      ]
    ) {
      const value =
        material[key];

      if (
        typeof value ===
          "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }

    return "";
  }

  function materialFidelity(
    info
  ) {
    return String(
      info?.materialFidelity ||
      info?.MaterialFidelity ||
      firstMaterial(info)
        ?.fidelity ||
      firstMaterial(info)
        ?.Fidelity ||
      "unknown"
    ).toLowerCase();
  }

  function setMeta(
    meta,
    text,
    fidelity = ""
  ) {
    if (!meta) return;

    meta.textContent =
      text || "";

    meta.hidden =
      !text;

    if (fidelity) {
      meta.dataset.level =
        fidelity;
    } else {
      delete meta.dataset.level;
    }
  }

  function setStatus(
    status,
    text,
    state = ""
  ) {
    status.hidden =
      false;

    status.textContent =
      String(text || "");

    if (state) {
      status.dataset.state =
        state;
    } else {
      delete status.dataset.state;
    }
  }

  function createHostUi(
    host
  ) {
    host.innerHTML = `
      <div class="mesh-image-panel fnaa-preview-panel">
        <div class="mesh-image-panel-head">
          <span>PREVIEW</span>
          <span class="fnaa-preview-engine">
            NovaSparx 2.0
          </span>
        </div>

        <div class="mesh-image-stage">
          <div
            class="mesh-image-status"
            aria-live="polite"
          ></div>

          <div
            class="novasparx-live-viewer"
            data-novasparx-viewer
            hidden
          ></div>

          <img
            class="mesh-preview-image"
            alt=""
            decoding="async"
            hidden
          />
        </div>

        <div
          class="novasparx-viewer-controls"
          data-novasparx-controls
          hidden
          aria-label="3D viewer controls"
        >
          <button
            class="json-view-button"
            type="button"
            data-novasparx-reset
          >Reset</button>

          <button
            class="json-view-button"
            type="button"
            data-novasparx-wireframe
            aria-pressed="false"
          >Wireframe</button>

          <button
            class="json-view-button"
            type="button"
            data-novasparx-capture
          >Capture PNG</button>

          <button
            class="json-view-button"
            type="button"
            data-novasparx-fullscreen
          >Fullscreen</button>
        </div>

        <div
          class="mesh-image-meta"
          hidden
        ></div>
      </div>`;

    return {
      hostMode: true,
      panel:
        host.querySelector(
          ".mesh-image-panel"
        ),

      stage:
        host.querySelector(
          ".mesh-image-stage"
        ),

      status:
        host.querySelector(
          ".mesh-image-status"
        ),

      meta:
        host.querySelector(
          ".mesh-image-meta"
        ),

      image:
        host.querySelector(
          ".mesh-preview-image"
        ),

      viewer:
        host.querySelector(
          "[data-novasparx-viewer]"
        ),

      controls:
        host.querySelector(
          "[data-novasparx-controls]"
        )
    };
  }

  function resolveUi(
    target
  ) {
    if (!target) {
      return null;
    }

    const existingPanel =
      target.matches?.(
        ".mesh-image-panel"
      )
        ? target
        : target.querySelector?.(
            ".mesh-image-panel"
          );

    if (existingPanel) {
      return {
        hostMode: false,
        panel:
          existingPanel,

        stage:
          existingPanel.querySelector(
            ".mesh-image-stage"
          ),

        status:
          existingPanel.querySelector(
            ".mesh-image-status"
          ),

        meta:
          existingPanel.querySelector(
            ".mesh-image-meta"
          ),

        image:
          existingPanel.querySelector(
            ".mesh-preview-image"
          ),

        viewer:
          existingPanel.querySelector(
            "[data-novasparx-viewer]"
          ),

        controls:
          existingPanel.querySelector(
            "[data-novasparx-controls]"
          )
      };
    }

    return createHostUi(
      target
    );
  }

  function resetUi(
    ui
  ) {
    if (
      !ui?.panel ||
      !ui?.status ||
      !ui?.image
    ) {
      return;
    }

    const mountedPath =
      String(
        ui.panel.dataset
          .viewerPath ||
        ""
      ).trim();

    if (mountedPath) {
      release(
        mountedPath
      );
    }

    ui.panel.hidden = false;

    if (ui.stage) {
      delete ui.stage.dataset
        .previewState;
    }

    if (ui.viewer) {
      ui.viewer.hidden =
        true;

      ui.viewer
        .replaceChildren();
    }

    if (ui.controls) {
      ui.controls.hidden =
        true;
    }

    ui.image.hidden = true;

    ui.image.removeAttribute(
      "src"
    );

    setStatus(
      ui.status,
      "Finding the best verified preview…"
    );

    setMeta(
      ui.meta,
      ""
    );
  }

  async function tryKnownCatalogImage(
    path,
    ui
  ) {
    if (
      !window.FortniteTools
        ?.findKnownImage
    ) {
      return false;
    }

    setStatus(
      ui.status,
      "Checking the verified FNAA / Th3Dry image catalogue…"
    );

    const url =
      await window.FortniteTools
        .findKnownImage(path);

    if (!url) {
      return false;
    }

    const ok =
      await loadImage(
        ui.image,
        url,
        10_000
      );

    if (!ok) {
      ui.image.removeAttribute(
        "src"
      );

      return false;
    }

    ui.image.hidden = false;
    ui.status.hidden = true;

    setMeta(
      ui.meta,
      "Verified catalogue image • Th3Dry / FNAA",
      "high"
    );

    return true;
  }

  function safePreviewFilename(
    path
  ) {
    const base =
      assetName(path)
        .replace(
          /[^A-Za-z0-9._-]+/g,
          "_"
        )
        .replace(
          /^_+|_+$/g,
          ""
        ) ||
      "NovaSparx_Asset";

    return (
      base +
      "_preview.png"
    );
  }

  function savePreviewBlob(
    blob,
    filename
  ) {
    const url =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      url;

    anchor.download =
      filename;

    document.body
      .appendChild(
        anchor
      );

    anchor.click();
    anchor.remove();

    setTimeout(
      () => {
        try {
          URL.revokeObjectURL(
            url
          );
        } catch {}
      },
      1_500
    );
  }

  function previewUiFromImage(
    image
  ) {
    const panel =
      image?.closest?.(
        ".mesh-image-panel"
      );

    return panel
      ? resolveUi(panel)
      : null;
  }

  function viewerNotice(
    ui,
    path,
    text,
    state = ""
  ) {
    if (!ui?.status) {
      return;
    }

    setStatus(
      ui.status,
      text,
      state
    );

    setTimeout(
      () => {
        if (
          String(
            ui.panel?.dataset
              ?.viewerPath ||
            ""
          ) ===
            String(
              path || ""
            ).trim()
        ) {
          ui.status.hidden =
            true;

          delete ui.status
            .dataset.state;
        }
      },
      1_900
    );
  }

  async function mountNovaManifest(
    path,
    manifest,
    ui,
    sourceLabel =
      "NovaSparx • live 3D",
    options = {}
  ) {
    if (
      !ui?.viewer ||
      !ui?.panel ||
      !window.NovaSparxRenderer
        ?.mount
    ) {
      return null;
    }

    const signal =
      options.signal ||
      window.NovaSparxBrowserGuard
        ?.activeSignal?.() ||
      null;

    throwIfAborted(
      signal
    );

    const key =
      String(path || "")
        .trim();

    release(
      key
    );

    ui.image.hidden =
      true;

    ui.image.removeAttribute(
      "src"
    );

    ui.viewer.hidden =
      false;

    ui.viewer
      .replaceChildren();

    if (ui.controls) {
      ui.controls.hidden =
        true;
    }

    if (ui.stage) {
      ui.stage.dataset
        .previewState =
        "live-3d";
    }

    setStatus(
      ui.status,
      "NovaSparx: opening interactive 3D viewer…"
    );

    let controller =
      null;

    try {
      controller =
        await window
          .NovaSparxRenderer
          .mount(
            manifest,
            ui.viewer,
            {
              signal
            }
          );

      throwIfAborted(
        signal
      );
    } catch (error) {
      try {
        controller
          ?.dispose?.();
      } catch {}

      ui.viewer.hidden =
        true;

      ui.viewer
        .replaceChildren();

      throw error;
    }

    viewerSessions.set(
      key,
      {
        controller,
        host:
          ui.viewer,
        controls:
          ui.controls,
        panel:
          ui.panel
      }
    );

    ui.panel.dataset
      .viewerPath =
      key;

    ui.status.hidden =
      true;

    if (ui.controls) {
      ui.controls.hidden =
        false;

      const resetButton =
        ui.controls
          .querySelector(
            "[data-novasparx-reset]"
          );

      const wireframeButton =
        ui.controls
          .querySelector(
            "[data-novasparx-wireframe]"
          );

      const captureButton =
        ui.controls
          .querySelector(
            "[data-novasparx-capture]"
          );

      const fullscreenButton =
        ui.controls
          .querySelector(
            "[data-novasparx-fullscreen]"
          );

      if (resetButton) {
        resetButton.onclick =
          () => {
            controller.reset?.();
          };
      }

      if (wireframeButton) {
        wireframeButton.setAttribute(
          "aria-pressed",
          "false"
        );

        wireframeButton.onclick =
          () => {
            try {
              const enabled =
                controller
                  .toggleWireframe?.();

              wireframeButton
                .setAttribute(
                  "aria-pressed",
                  enabled
                    ? "true"
                    : "false"
                );
            } catch (error) {
              viewerNotice(
                ui,
                key,
                error?.message ||
                  "Wireframe is unavailable for this mesh.",
                "error"
              );
            }
          };
      }

      if (captureButton) {
        captureButton.onclick =
          async () => {
            if (
              captureButton.disabled
            ) {
              return;
            }

            captureButton.disabled =
              true;

            try {
              const blob =
                await controller
                  .capture?.();

              if (!blob) {
                throw new Error(
                  "Capture could not be created."
                );
              }

              savePreviewBlob(
                blob,
                safePreviewFilename(
                  key
                )
              );

              viewerNotice(
                ui,
                key,
                "PNG capture ready."
              );
            } catch (error) {
              viewerNotice(
                ui,
                key,
                error?.message ||
                  "PNG capture failed.",
                "error"
              );
            } finally {
              captureButton.disabled =
                false;
            }
          };
      }

      if (fullscreenButton) {
        const fullscreenTarget =
          ui.panel;

        const requestFullscreen =
          fullscreenTarget
            ?.requestFullscreen ||
          fullscreenTarget
            ?.webkitRequestFullscreen;

        fullscreenButton.disabled =
          typeof requestFullscreen !==
            "function";

        fullscreenButton.onclick =
          fullscreenButton.disabled
            ? null
            : async () => {
                try {
                  await requestFullscreen
                    .call(
                      fullscreenTarget
                    );
                } catch (error) {
                  viewerNotice(
                    ui,
                    key,
                    error?.message ||
                      "Fullscreen is unavailable on this device.",
                    "error"
                  );
                }
              };
      }
    }

    const fidelity =
      String(
        controller
          ?.materialFidelity ||
        manifest?.metadata
          ?.materialFidelity ||
        "unknown"
      ).toLowerCase();

    const typeLabel =
      String(
        manifest?.assetType ||
        manifest?.metadata
          ?.assetType ||
        manifest?.metadata
          ?.type ||
        "Mesh"
      );

    const lodValue =
      manifest?.metadata
        ?.lod ??
      manifest?.lod ??
      null;

    const lodText =
      lodValue ===
        null ||
      lodValue ===
        undefined ||
      lodValue ===
        ""
        ? ""
        : ` • LOD ${lodValue}`;

    setMeta(
      ui.meta,
      (
        `${sourceLabel} • Interactive WebGL • ` +
        `${typeLabel}${lodText} • ` +
        `${Number(
          controller?.vertexCount ||
          0
        ).toLocaleString()} vertices • ` +
        `${Number(
          controller?.triangleCount ||
          0
        ).toLocaleString()} triangles • ` +
        `${Number(
          controller?.materialCount ||
          0
        ).toLocaleString()} materials • ` +
        `material fidelity: ${fidelity}`
      ),
      fidelity
    );

    return {
      interactive:
        true,
      controller,
      vertexCount:
        controller?.vertexCount ||
        0,
      triangleCount:
        controller?.triangleCount ||
        0,
      materialCount:
        controller?.materialCount ||
        0,
      textured:
        Boolean(
          controller?.textured
        ),
      normalMapped:
        Boolean(
          controller?.normalMapped
        ),
      materialFidelity:
        fidelity
    };
  }

  async function renderNovaManifest(
    path,
    manifest,
    image,
    status,
    meta,
    sourceLabel =
      "NovaSparx 1.1",
    options = {}
  ) {
    const signal =
      options.signal ||
      window.NovaSparxBrowserGuard
        ?.activeSignal?.() ||
      null;

    throwIfAborted(
      signal
    );

    const ui =
      options.ui ||
      previewUiFromImage(
        image
      );

    if (
      ui &&
      window.NovaSparxRenderer
        ?.mount
    ) {
      return mountNovaManifest(
        path,
        manifest,
        ui,
        sourceLabel,
        {
          signal
        }
      );
    }

    if (
      !window.NovaSparxRenderer
        ?.render
    ) {
      throw new Error(
        "NovaSparx renderer is not loaded."
      );
    }

    setStatus(
      status,
      "NovaSparx: rendering CUE4Parse geometry to PNG…"
    );

    const result =
      await window.NovaSparxRenderer
        .render(
          manifest,
          {
            signal
          }
        );

    throwIfAborted(
      signal
    );

    release(path);

    const url =
      URL.createObjectURL(
        result.blob
      );

    rememberObjectUrl(
      path,
      url
    );

    image.src = url;
    image.alt =
      `${assetName(path)} 3D preview`;
    image.hidden = false;

    status.hidden = true;

    const fidelity =
      String(
        manifest?.metadata
          ?.materialFidelity ||
        "unknown"
      ).toLowerCase();

    const quality =
      result.textured
        ? (
            result.normalMapped
              ? "Textured + normal map"
              : "Textured"
          )
        : "Neutral 3D geometry";

    setMeta(
      meta,
      (
        `${sourceLabel} • ${quality} • ` +
        `material fidelity: ${fidelity} • ` +
        `${result.width}×${result.height} • ` +
        `${Number(
          result.vertexCount || 0
        ).toLocaleString()} vertices • ` +
        `${Number(
          result.triangleCount || 0
        ).toLocaleString()} triangles`
      ),
      fidelity
    );

    return result;
  }

  async function renderNovaMesh(
    path,
    image,
    status,
    meta,
    options = {}
  ) {
    if (!window.NovaSparx) {
      throw new Error(
        "NovaSparx resolver is not loaded."
      );
    }

    if (
      window.NovaSparxLayers
        ?.resolveMesh
    ) {
      setStatus(
        status,
        "NovaSparx: trying device cache, browser parser, then streamed fallbacks…"
      );

      const result =
        await window.NovaSparxLayers
          .resolveMesh(
            path,
            {
              preferHQ: true,
              signal:
                options.signal ||
                null,
              backend:
                options.backend !==
                false,
              backendJson:
                options.backendJson !==
                false
            }
          );

      return renderNovaManifest(
        path,
        result.manifest,
        image,
        status,
        meta,
        options.sourceLabel ||
          result.sourceLabel ||
          "NovaSparx • layered mesh",
        {
          signal:
            options.signal ||
            null
        }
      );
    }

    // Compatibility path for older cached FNAA pages.
    let manifest = null;
    let sourceLabel =
      "NovaSparx • client-rendered mesh";

    if (
      window.NovaSparx
        ?.clientMesh
    ) {
      try {
        setStatus(
          status,
          "NovaSparx: streaming compact mesh data to this device…"
        );

        manifest =
          await window.NovaSparx
            .clientMesh(path);
      } catch (error) {
        console.warn(
          "FNAA client mesh fallback:",
          error
        );
      }
    }

    if (!manifest) {
      if (
        !window.NovaSparx
          ?.resolve
      ) {
        throw new Error(
          "NovaSparx mesh resolver is not available."
        );
      }

      setStatus(
        status,
        "NovaSparx: resolving compatibility geometry…"
      );

      manifest =
        await window.NovaSparx
          .resolve(
            path,
            {
              preferHQ: true,
              signal:
                options.signal ||
                null
            }
          );

      sourceLabel =
        options.sourceLabel ||
        "NovaSparx • compatibility mesh";
    }

    return renderNovaManifest(
      path,
      manifest,
      image,
      status,
      meta,
      sourceLabel,
      {
        signal:
          options.signal ||
          null
      }
    );
  }

  function previewDeadline(
    parentSignal,
    timeoutMs,
    reason =
      "novasparx-fast-preview-timeout"
  ) {
    const controller =
      new AbortController();

    let timedOut =
      false;

    const relayAbort =
      () => {
        try {
          controller.abort(
            parentSignal?.reason ||
            "parent-preview-aborted"
          );
        } catch {}
      };

    if (
      parentSignal?.aborted
    ) {
      relayAbort();
    } else {
      parentSignal
        ?.addEventListener?.(
          "abort",
          relayAbort,
          {
            once:
              true
          }
        );
    }

    const timer =
      setTimeout(
        () => {
          timedOut =
            true;

          try {
            controller.abort(
              reason
            );
          } catch {}
        },
        Math.max(
          1_500,
          Number(timeoutMs) ||
          6_500
        )
      );

    return {
      signal:
        controller.signal,

      timedOut:
        () =>
          timedOut,

      cleanup() {
        clearTimeout(
          timer
        );

        parentSignal
          ?.removeEventListener?.(
            "abort",
            relayAbort
          );
      }
    };
  }

  function fastImageTimeout(
    desktopMs = 10_000,
    mobileMs = 6_000
  ) {
    return window
      .NovaSparxBrowserGuard
      ?.status?.()
      ?.isMobile
        ? mobileMs
        : desktopMs;
  }

  async function tryExactTypedImage(
    path,
    ui,
    label
  ) {
    const base =
      endpoint(
        "/image",
        path
      );

    if (!base) {
      return false;
    }

    const url =
      new URL(
        base
      );

    url.searchParams.set(
      "direct",
      "1"
    );

    setStatus(
      ui.status,
      "Checking exact typed preview…"
    );

    const ok =
      await loadImage(
        ui.image,
        url.toString(),
        fastImageTimeout(
          9_000,
          5_000
        )
      );

    if (!ok) {
      ui.image.removeAttribute(
        "src"
      );

      return false;
    }

    ui.image.hidden = false;
    ui.status.hidden = true;

    setMeta(
      ui.meta,
      label ||
        "Exact typed asset preview • no cross-type guessing",
      "high"
    );

    return true;
  }

  async function tryDirectAssetImage(
    path,
    ui
  ) {
    setStatus(
      ui.status,
      "Checking verified asset image…"
    );

    const ok =
      await loadImage(
        ui.image,
        endpoint(
          "/image",
          path
        ),
        fastImageTimeout(
          12_000,
          7_000
        )
      );

    if (!ok) {
      ui.image
        .removeAttribute(
          "src"
        );

      return false;
    }

    ui.image.hidden = false;
    ui.status.hidden = true;

    setMeta(
      ui.meta,
      "Direct verified asset image • FNAA resolver",
      "high"
    );

    return true;
  }

  async function tryVerifiedBlueprintImage(
    association,
    ui
  ) {
    const blueprintPath =
      String(
        association?.blueprintPath ||
        ""
      ).trim();

    if (!blueprintPath) {
      return false;
    }

    setStatus(
      ui.status,
      "NovaSparx: checking the verified Blueprint preview…"
    );

    const directBase =
      endpoint(
        "/image",
        blueprintPath
      );

    if (directBase) {
      const directUrl =
        new URL(
          directBase
        );

      directUrl.searchParams.set(
        "direct",
        "1"
      );

      const directOk =
        await loadImage(
          ui.image,
          directUrl.toString(),
          fastImageTimeout(
            9_000,
            5_000
          )
        );

      if (directOk) {
        ui.image.hidden = false;
        ui.status.hidden = true;

        setMeta(
          ui.meta,
          "Verified Blueprint preview • exact Blueprint → Mesh relationship",
          "high"
        );

        return true;
      }

      ui.image.removeAttribute(
        "src"
      );
    }

    const previewImagePath =
      String(
        association
          ?.previewImagePath ||
        ""
      ).trim();

    if (!previewImagePath) {
      return false;
    }

    // This path came from a verified Blueprint JSON property such as Icon,
    // PreviewImage or Thumbnail. /image will resolve this exact texture only;
    // raw textures are never promoted into Mesh/Blueprint lookalikes.
    setStatus(
      ui.status,
      "NovaSparx: loading a Blueprint-verified preview texture…"
    );

    const textureOk =
      await loadImage(
        ui.image,
        endpoint(
          "/image",
          previewImagePath
        ),
        fastImageTimeout(
          9_000,
          5_000
        )
      );

    if (!textureOk) {
      ui.image.removeAttribute(
        "src"
      );

      return false;
    }

    ui.image.hidden = false;
    ui.status.hidden = true;

    setMeta(
      ui.meta,
      "Blueprint JSON verified visual • exact reference • no cross-type guessing",
      "high"
    );

    return true;
  }

  async function tryTextureDecode(
    path,
    ui,
    label =
      "Decoded Fortnite texture • NovaSparx 1.0"
  ) {
    setStatus(
      ui.status,
      "NovaSparx: decoding texture…"
    );

    const ok =
      await loadImage(
        ui.image,
        endpoint(
          "/nova/texture",
          path
        ),
        fastImageTimeout(
          12_000,
          7_000
        )
      );

    if (!ok) {
      ui.image
        .removeAttribute(
          "src"
        );

      return false;
    }

    ui.image.hidden = false;
    ui.status.hidden = true;

    setMeta(
      ui.meta,
      label,
      "high"
    );

    return true;
  }

  async function tryUniversalPreview(
    path,
    ui,
    options = {}
  ) {
    if (
      !window.NovaSparx
        ?.preview
    ) {
      return {
        rendered: false,
        plan: null
      };
    }

    setStatus(
      ui.status,
      "NovaSparx Layer 8: following verified CUE4Parse visual references…"
    );

    try {
      const plan =
        await window.NovaSparx
          .preview(
            path,
            options
          );

      if (
        plan?.kind ===
          "texture" &&
        plan.previewPath
      ) {
        const rendered =
          await tryTextureDecode(
            plan.previewPath,
            ui,
            (
              "Layer 8 • CUE4Parse referenced texture" +
              (
                plan.textureWidth &&
                plan.textureHeight
                  ? ` • ${plan.textureWidth}×${plan.textureHeight}`
                  : ""
              )
            )
          );

        return {
          rendered,
          plan
        };
      }

      if (
        plan?.kind ===
          "mesh" &&
        plan.manifest
      ) {
        await renderNovaManifest(
          path,
          plan.manifest,
          ui.image,
          ui.status,
          ui.meta,
          "Layer 8 • CUE4Parse referenced model",
          {
            signal:
              options.signal ||
              null
          }
        );

        return {
          rendered: true,
          plan
        };
      }

      return {
        rendered: false,
        plan
      };
    } catch (error) {
      if (
        options.signal
          ?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw abortError(
          options.signal
        );
      }

      return {
        rendered: false,
        error: true,
        plan: {
          state: "error",
          kind: "metadata",
          source:
            "preview-endpoint-error",
          attemptedReferences: [],
          error:
            error?.message ||
            String(error)
        }
      };
    }
  }

  function evidenceColor(
    info
  ) {
    const material =
      firstMaterial(info);

    const value =
      material?.baseColor ||
      material?.BaseColor;

    if (
      !Array.isArray(value) ||
      value.length < 3
    ) {
      return "rgb(79, 149, 255)";
    }

    const channels =
      value.slice(0, 3)
        .map(
          (channel) =>
            Math.round(
              Math.max(
                0,
                Math.min(
                  1,
                  Number(channel) || 0
                )
              ) * 255
            )
        );

    return `rgb(${channels.join(", ")})`;
  }

  function roundedRect(
    context,
    x,
    y,
    width,
    height,
    radius
  ) {
    const r =
      Math.min(
        radius,
        width / 2,
        height / 2
      );

    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(
      x + width,
      y,
      x + width,
      y + r
    );
    context.lineTo(
      x + width,
      y + height - r
    );
    context.quadraticCurveTo(
      x + width,
      y + height,
      x + width - r,
      y + height
    );
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(
      x,
      y + height,
      x,
      y + height - r
    );
    context.lineTo(x, y + r);
    context.quadraticCurveTo(
      x,
      y,
      x + r,
      y
    );
    context.closePath();
  }

  function drawWrappedText(
    context,
    text,
    x,
    y,
    maxWidth,
    lineHeight,
    maxLines = 3
  ) {
    const words =
      String(text || "")
        .split(/\s+/)
        .filter(Boolean);

    const lines = [];
    let line = "";

    for (const word of words) {
      const candidate =
        line
          ? `${line} ${word}`
          : word;

      if (
        context.measureText(
          candidate
        ).width > maxWidth &&
        line
      ) {
        lines.push(line);
        line = word;

        if (
          lines.length >=
          maxLines
        ) {
          break;
        }
      } else {
        line = candidate;
      }
    }

    if (
      line &&
      lines.length < maxLines
    ) {
      lines.push(line);
    }

    lines.forEach(
      (item, index) => {
        const final =
          index === maxLines - 1 &&
          words.join(" ").length >
            lines.join(" ").length
            ? `${item.replace(/[.\s]+$/, "")}…`
            : item;

        context.fillText(
          final,
          x,
          y + index * lineHeight
        );
      }
    );

    return y +
      lines.length * lineHeight;
  }

  function canvasPng(
    canvas
  ) {
    return new Promise(
      (resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(
                  new Error(
                    "Evidence PNG encoding failed."
                  )
                ),
          "image/png"
        );
      }
    );
  }

  function xmlEscape(
    value
  ) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function evidenceSvgUrl(
    path,
    info,
    plan
  ) {
    const name =
      xmlEscape(assetName(path));

    const kind =
      xmlEscape(
        readableAssetKind(
          info,
          path
        ).toUpperCase()
      );

    const safePath =
      xmlEscape(path);

    const references =
      Array.isArray(
        info?.references
      )
        ? info.references
        : Array.isArray(
            info?.References
          )
          ? info.References
          : [];

    const attempted =
      Array.isArray(
        plan?.attemptedReferences
      )
        ? plan.attemptedReferences
          .length
        : 0;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#07101f"/>
            <stop offset="0.55" stop-color="#111d35"/>
            <stop offset="1" stop-color="#071427"/>
          </linearGradient>
        </defs>
        <rect width="1024" height="1024" fill="url(#bg)"/>
        <rect width="18" height="1024" fill="#45d6ff"/>
        <rect x="64" y="64" width="896" height="896" rx="42" fill="#ffffff" opacity="0.06"/>
        <g font-family="system-ui,Segoe UI,sans-serif">
          <text x="112" y="136" fill="#45d6ff" font-size="27" font-weight="700">NOVASPARX • LAYER 8</text>
          <text x="112" y="238" fill="#f5f8ff" font-size="54" font-weight="800">${name}</text>
          <text x="112" y="310" fill="#b9c8e7" font-size="31" font-weight="600">${kind}</text>
          <rect x="104" y="360" width="816" height="218" rx="28" fill="#050b18" opacity="0.62"/>
          <text x="142" y="430" fill="#dce7ff" font-size="23">${safePath}</text>
          <text x="154" y="742" fill="#dce7ff" font-size="25" font-weight="600">${references.length} verified references</text>
          <text x="154" y="796" fill="#dce7ff" font-size="25" font-weight="600">${attempted} visual candidates checked</text>
          <text x="112" y="920" fill="#8495ba" font-size="22">VERIFIED METADATA IMAGE • NOT A VISUAL RECONSTRUCTION</text>
        </g>
      </svg>`;

    return (
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(svg)
    );
  }

  function showEvidenceImage(
    path,
    name,
    ui,
    url,
    info,
    format,
    plan = null
  ) {
    ui.image.src = url;
    ui.image.alt =
      `${name} verified metadata preview`;
    ui.image.hidden = false;
    ui.status.hidden = true;

    if (ui.stage) {
      ui.stage.dataset
        .previewState =
        "evidence-image";
    }

    const failure =
      String(
        plan?.error || ""
      ).trim();

    setMeta(
      ui.meta,
      failure
        ? `Layer 8 • NovaSparx unavailable: ${failure} • evidence ${format}`
        : `Layer 8 • verified evidence ${format} • no visual details invented`,
      "partial"
    );

    return {
      state: "ready",
      kind: "evidence-image",
      inspection: info || null
    };
  }

  async function renderEvidenceImage(
    path,
    info,
    ui,
    plan = null
  ) {
    const signal =
      ui?.requestSignal ||
      null;

    throwIfAborted(
      signal
    );

    const canvas =
      document.createElement(
        "canvas"
      );

    const guardStatus =
      window.NovaSparxBrowserGuard
        ?.status?.() || {};

    const canvasSize =
      guardStatus.isIOS
        ? 640
        : guardStatus.isMobile
          ? 768
          : 1024;

    canvas.width =
      canvasSize;

    canvas.height =
      canvasSize;

    const context =
      canvas.getContext(
        "2d",
        { alpha: false }
      );

    if (
      context &&
      canvasSize !== 1024
    ) {
      const scale =
        canvasSize / 1024;

      context.scale(
        scale,
        scale
      );
    }

    const name =
      assetName(path);

    if (!context) {
      release(path);

      return showEvidenceImage(
        path,
        name,
        ui,
        evidenceSvgUrl(
          path,
          info,
          plan
        ),
        info,
        "image",
        plan
      );
    }

    const kind =
      readableAssetKind(
        info,
        path
      );

    const references =
      Array.isArray(
        info?.references
      )
        ? info.references
        : Array.isArray(
            info?.References
          )
          ? info.References
          : [];

    const fidelity =
      materialFidelity(
        info
      );

    const accent =
      evidenceColor(info);

    const background =
      context.createLinearGradient(
        0,
        0,
        1024,
        1024
      );

    background.addColorStop(
      0,
      "#07101f"
    );
    background.addColorStop(
      0.55,
      "#111d35"
    );
    background.addColorStop(
      1,
      "#071427"
    );

    context.fillStyle =
      background;
    context.fillRect(
      0,
      0,
      1024,
      1024
    );

    context.fillStyle =
      accent;
    context.fillRect(
      0,
      0,
      18,
      1024
    );

    context.fillStyle =
      "rgba(255,255,255,0.06)";
    roundedRect(
      context,
      64,
      64,
      896,
      896,
      42
    );
    context.fill();

    context.fillStyle =
      accent;
    context.font =
      "700 27px system-ui, sans-serif";
    context.fillText(
      "NOVASPARX • LAYER 8",
      112,
      136
    );

    context.fillStyle =
      "#f5f8ff";
    context.font =
      "800 58px system-ui, sans-serif";

    let y =
      drawWrappedText(
        context,
        name,
        112,
        232,
        800,
        70,
        3
      );

    y += 34;
    context.fillStyle =
      "#b9c8e7";
    context.font =
      "600 31px system-ui, sans-serif";
    context.fillText(
      kind.toUpperCase(),
      112,
      y
    );

    y += 70;
    context.fillStyle =
      "rgba(5, 11, 24, 0.62)";
    roundedRect(
      context,
      104,
      y,
      816,
      218,
      28
    );
    context.fill();

    context.fillStyle =
      "#dce7ff";
    context.font =
      "500 25px system-ui, sans-serif";

    drawWrappedText(
      context,
      String(path || ""),
      142,
      y + 58,
      740,
      36,
      4
    );

    const facts = [
      `${references.length} verified reference${references.length === 1 ? "" : "s"}`,
      fidelity !== "unknown"
        ? `material fidelity: ${fidelity}`
        : "material fidelity: unavailable",
      plan?.attemptedReferences?.length
        ? `${plan.attemptedReferences.length} visual candidate${plan.attemptedReferences.length === 1 ? "" : "s"} checked`
        : "no deterministic visual candidate"
    ];

    context.font =
      "600 25px system-ui, sans-serif";

    facts.forEach(
      (fact, index) => {
        const top =
          742 + index * 54;

        context.fillStyle =
          accent;
        context.beginPath();
        context.arc(
          125,
          top - 8,
          7,
          0,
          Math.PI * 2
        );
        context.fill();

        context.fillStyle =
          "#dce7ff";
        context.fillText(
          fact,
          154,
          top
        );
      }
    );

    context.fillStyle =
      "#8495ba";
    context.font =
      "500 22px system-ui, sans-serif";
    context.fillText(
      "VERIFIED METADATA PNG • NOT A VISUAL RECONSTRUCTION",
      112,
      920
    );

    release(path);

    let url;

    try {
      const blob =
        await canvasPng(
          canvas
        );

      throwIfAborted(
        signal
      );

      url =
        URL.createObjectURL(blob);

      objectUrls.set(
        path,
        url
      );
    } catch {
      try {
        url =
          canvas.toDataURL(
            "image/png"
          );
      } catch {
        url = evidenceSvgUrl(
          path,
          info,
          plan
        );
      }
    }

    throwIfAborted(
      signal
    );

    return showEvidenceImage(
      path,
      name,
      ui,
      url,
      info,
      url.startsWith(
        "data:image/svg"
      )
        ? "image"
        : "PNG",
      plan
    );
  }

  async function renderMaterial(
    path,
    info,
    ui
  ) {
    const texturePath =
      firstMaterialTexture(
        info
      );

    const fidelity =
      materialFidelity(
        info
      );

    if (
      texturePath &&
      await tryTextureDecode(
        texturePath,
        ui,
        `Material preview from verified texture • fidelity: ${fidelity}`
      )
    ) {
      setMeta(
        ui.meta,
        `Material preview from verified texture • fidelity: ${fidelity}`,
        fidelity
      );

      return true;
    }

    return false;
  }

  function readableAssetKind(
    info,
    path
  ) {
    const type =
      assetType(
        info,
        path
      );

    const lower =
      `${type} ${path}`
        .toLowerCase();

    const choices = [
      [
        /skeletalmesh|\/characters\/|\bcid_/,
        "character / skeletal asset"
      ],
      [
        /staticmesh|\/meshes\/|\bsm_/,
        "static mesh asset"
      ],
      [
        /materialinstance|material|\bmi_|\bm_/,
        "material asset"
      ],
      [
        /texture2d|texture|\btex_|\bt_/,
        "texture asset"
      ],
      [
        /niagara|particle|effect|vfx|\bns_|\bps_|\bfx_/,
        "VFX asset"
      ],
      [
        /danc|emote|\beid_/,
        "emote asset"
      ],
      [
        /backpack|backbling|back_bling|\bbid_/,
        "back bling asset"
      ],
      [
        /playset|playground|island|\bpid_/,
        "Creative island / playset asset"
      ],
      [
        /device|\/crd_|creative_device/,
        "Creative device asset"
      ],
      [
        /sound|audio|music|\busw_|\bsw_/,
        "audio asset"
      ]
    ];

    for (const [pattern, label] of choices) {
      if (pattern.test(lower)) {
        return label;
      }
    }

    return type
      ? type.replace(/[_-]+/g, " ")
      : "Fortnite asset";
  }

  function assetName(path) {
    const clean =
      String(path || "")
        .replace(/\\/g, "/")
        .replace(/\.(?:uasset|uexp|ubulk)$/i, "");

    const file =
      clean.split("/").pop() ||
      clean;

    return (
      file.split(".")[0] ||
      "Unknown asset"
    ).replace(/_C$/i, "");
  }

  async function renderPreview(
    target,
    path,
    button,
    options = {}
  ) {
    const clean =
      String(path || "")
        .trim();

    if (!target || !clean) {
      return {
        state: "error",
        error:
          "Missing preview target or asset path."
      };
    }

    const requestedKind =
      String(
        options.assetKind ||
        options.classification
          ?.kind ||
        ""
      ).toLowerCase();

    const force3d =
      [
        "staticmesh",
        "skeletalmesh",
        "blueprint-visual"
      ].includes(
        requestedKind
      );

    const ui =
      resolveUi(target);

    if (
      !ui?.panel ||
      !ui?.stage ||
      !ui?.status ||
      !ui?.image
    ) {
      return {
        state: "error",
        error:
          "Preview UI could not be created."
      };
    }

    // Legacy card mode can still behave as a toggle. New FNAA 1.0 host mode
    // always renders because tools.js owns the outer panel visibility.
    if (
      !ui.hostMode &&
      !ui.panel.hidden
    ) {
      ui.panel.hidden = true;

      if (button) {
        button.textContent =
          t(
            "viewImage",
            "Preview"
          );
      }

      return {
        state: "hidden"
      };
    }

    resetUi(ui);

    if (button) {
      button.disabled = true;
      button.textContent =
        t(
          "hideImage",
          "Hide Preview"
        );
    }

    const guard =
      window.NovaSparxBrowserGuard;

    const operation =
      guard?.beginOperation?.(
        `preview:${clean}`
      ) || null;

    const signal =
      operation?.signal ||
      null;

    ui.requestSignal =
      signal;

    try {
      throwIfAborted(
        signal
      );
      let pathFamily =
        window.NovaSparxAssociations
          ?.family?.(
            clean
          ) ||
        "other";

      // Ambiguous names are classified from bounded export JSON before any
      // visual route is allowed. A name similarity alone never changes family.
      if (
        pathFamily ===
          "other" &&
        window.NovaSparxAssociations
          ?.classify
      ) {
        try {
          const classification =
            await window.NovaSparxAssociations
              .classify(
                clean,
                {
                  signal
                }
              );

          pathFamily =
            classification?.family ||
            pathFamily;
        } catch (error) {
          if (
            error?.name ===
            "AbortError"
          ) {
            throw error;
          }
        }
      }

      // 1) Th3Dry/FNAA's known catalogue images are the quickest and most
      // deterministic layer for islands and Creative devices.
      if (
        !force3d &&
        await tryKnownCatalogImage(
          clean,
          ui
        )
      ) {
        return {
          state: "ready",
          kind: "catalog-image"
        };
      }

      let fastAssociation = null;

      // Mesh/Blueprint fast path: resolve the relationship before touching the
      // hosted CUE4Parse backend. On phones this is the primary path, not a
      // fallback, so a dead/restarting backend can never hold the UI for minutes.
      if (
        pathFamily === "mesh" ||
        pathFamily === "blueprint"
      ) {
        const browserState =
          guard?.status?.() ||
          {};

        if (
          !force3d &&
          pathFamily ===
            "blueprint" &&
          await tryExactTypedImage(
            clean,
            ui,
            "Verified Blueprint direct preview • exact asset"
          )
        ) {
          return {
            state: "ready",
            kind:
              "blueprint-direct-image"
          };
        }

        try {
          fastAssociation =
            await window
              .NovaSparxAssociations
              ?.resolveVisual?.(
                clean,
                null,
                {
                  signal
                }
              ) ||
            null;
        } catch (error) {
          if (
            signal?.aborted
          ) {
            throw error;
          }
        }

        if (
          !force3d &&
          fastAssociation
            ?.blueprintPath &&
          await tryVerifiedBlueprintImage(
            fastAssociation,
            ui
          )
        ) {
          return {
            state: "ready",
            kind:
              pathFamily === "mesh"
                ? "mesh-blueprint-image"
                : "blueprint-image",
            association:
              fastAssociation
          };
        }

        if (
          browserState.isMobile ||
          browserState.recoveryMode
        ) {
          const localPath =
            fastAssociation
              ?.visualPath ||
            (
              pathFamily ===
                "mesh"
                ? clean
                : ""
            );

          let hostedError =
            "";

          // Layer 1: memory / device cache / local parser only.
          // This stays nearly instant and never wakes the hosted backend.
          try {
            if (localPath) {
              await renderNovaMesh(
                localPath,
                ui.image,
                ui.status,
                ui.meta,
                {
                  signal,
                  backend:
                    false,
                  backendJson:
                    false,
                  sourceLabel:
                    fastAssociation
                      ?.blueprintPath
                      ? "NovaSparx • Blueprint-verified local mesh"
                      : ""
                }
              );

              return {
                state:
                  "ready",
                kind:
                  "device-local-mesh",
                association:
                  fastAssociation
              };
            }
          } catch (error) {
            if (
              signal?.aborted
            ) {
              throw abortError(
                signal
              );
            }

            if (
              error?.name !==
                "AbortError"
            ) {
              hostedError =
                String(
                  error?.message ||
                  error ||
                  ""
                ).slice(
                  0,
                  180
                );
            }
          }

          // Layer 2: one short streamed NSMESH attempt.
          // The request has its own deadline and the new request-cancellation
          // protocol kills the backend parser too, so mobile no longer needs
          // to skip hosted extraction completely.
          if (localPath) {
            const hostedBudgetMs =
              browserState
                .recoveryMode
                ? 4_500
                : browserState
                    .isIOS
                  ? 6_500
                  : 8_500;

            const hosted =
              previewDeadline(
                signal,
                hostedBudgetMs,
                "novasparx-fast-mobile-mesh-timeout"
              );

            try {
              setStatus(
                ui.status,
                "NovaSparx: streaming a fast mesh preview…"
              );

              await renderNovaMesh(
                localPath,
                ui.image,
                ui.status,
                ui.meta,
                {
                  signal:
                    hosted.signal,
                  backend:
                    true,
                  backendJson:
                    false,
                  sourceLabel:
                    fastAssociation
                      ?.blueprintPath
                      ? "NovaSparx • fast Blueprint-verified streamed mesh"
                      : "NovaSparx • fast streamed mesh"
                }
              );

              throwIfAborted(
                signal
              );

              return {
                state:
                  "ready",
                kind:
                  "fast-streamed-mesh",
                association:
                  fastAssociation
              };
            } catch (error) {
              if (
                signal?.aborted
              ) {
                throw abortError(
                  signal
                );
              }

              hostedError =
                hosted.timedOut()
                  ? (
                      "Fast streamed mesh exceeded " +
                      (
                        hostedBudgetMs /
                        1000
                      ).toFixed(
                        1
                      ) +
                      "s and was cancelled."
                    )
                  : String(
                      error?.message ||
                      error ||
                      "Fast streamed mesh was unavailable."
                    ).slice(
                      0,
                      220
                    );
            } finally {
              hosted.cleanup();
            }
          }

          return renderEvidenceImage(
            clean,
            null,
            ui,
            {
              source:
                "fast-mobile-fallback",
              blueprintPath:
                fastAssociation
                  ?.blueprintPath ||
                "",
              attemptedReferences:
                fastAssociation
                  ?.blueprintPath
                  ? [
                      fastAssociation
                        .blueprintPath
                    ]
                  : [],
              evidence:
                fastAssociation
                  ?.evidence ||
                "No verified visual completed inside the mobile preview budget.",
              error:
                hostedError ||
                "No verified mesh source was available for this asset."
            }
          );
        }
      }

      // 2) Dilly-backed direct resolver: cosmetic icons, UI and referenced
      // textures. Keep this as a direct <img> URL for iPhone Safari stability.
      if (
        ![
          "mesh",
          "blueprint",
          "texture"
        ].includes(
          pathFamily
        ) &&
        window.NovaSparxAssociations
          ?.allowDirectImage?.(
            clean
          ) !== false &&
        await tryDirectAssetImage(
          clean,
          ui
        )
      ) {
        return {
          state: "ready",
          kind: "image"
        };
      }

      // Exact raw Texture preview is safe because direct=1 never follows JSON
      // into another asset family.
      if (
        pathFamily ===
          "texture" &&
        await tryExactTypedImage(
          clean,
          ui,
          "Exact Texture preview • no Mesh/Blueprint promotion"
        )
      ) {
        return {
          state: "ready",
          kind:
            "texture-direct-image"
        };
      }

      // 3) The NovaSparx server can decode the asset itself when it is a real
      // UTexture and no public still image exists.
      if (
        ![
          "mesh",
          "blueprint"
        ].includes(
          pathFamily
        ) &&
        window.NovaSparxAssociations
          ?.allowTextureDecode?.(
            clean
          ) !== false &&
        await tryTextureDecode(
          clean,
          ui
        )
      ) {
        return {
          state: "ready",
          kind: "texture"
        };
      }

      // 4) Inspect before deciding what preview is technically honest.
      const info =
        await inspect(
          clean,
          {
            signal
          }
        );

      const type =
        assetType(
          info,
          clean
        );

      let resolvedFamily =
        window.NovaSparxAssociations
          ?.family?.(
            clean,
            info
          ) ||
        "other";

      if (
        resolvedFamily ===
          "other" &&
        pathFamily !==
          "other"
      ) {
        resolvedFamily =
          pathFamily;
      }

      if (
        resolvedFamily ===
          "other" &&
        window.NovaSparxAssociations
          ?.classify
      ) {
        try {
          const classification =
            await window.NovaSparxAssociations
              .classify(
                clean,
                {
                  signal
                }
              );

          resolvedFamily =
            classification?.family ||
            resolvedFamily;
        } catch (error) {
          if (
            error?.name ===
            "AbortError"
          ) {
            throw error;
          }
        }
      }

      // A texture is terminal for visual routing. If its direct/decoded image
      // failed above, do not follow a similarly-named Mesh or Blueprint.
      if (
        resolvedFamily ===
        "texture"
      ) {
        return renderEvidenceImage(
          clean,
          info,
          ui,
          {
            source:
              "typed-texture-fallback",
            attemptedReferences: [],
            evidence:
              "Texture type verified; cross-type mesh/Blueprint promotion is disabled."
          }
        );
      }

      if (
        type.includes(
          "material"
        )
      ) {
        if (
          await renderMaterial(
            clean,
            info,
            ui
          )
        ) {
          return {
            state: "ready",
            kind: "material-texture",
            inspection: info
          };
        }

        const universal =
          await tryUniversalPreview(
            clean,
            ui,
            {
              signal
            }
          );

        if (universal.rendered) {
          return {
            state: "ready",
            kind:
              universal.plan?.kind ||
              "universal",
            inspection:
              universal.plan
                ?.inspection ||
              info
          };
        }

        return renderEvidenceImage(
          clean,
          universal.plan
            ?.inspection ||
            info,
          ui,
          universal.plan
        );
      }

      if (
        /(niagara|particle|effect|vfx)/i
          .test(type)
      ) {
        const universal =
          await tryUniversalPreview(
            clean,
            ui,
            {
              signal
            }
          );

        if (universal.rendered) {
          return {
            state: "ready",
            kind:
              universal.plan?.kind ||
              "vfx-reference",
            inspection:
              universal.plan
                ?.inspection ||
              info
          };
        }

        return renderEvidenceImage(
          clean,
          universal.plan
            ?.inspection ||
            info,
          ui,
          universal.plan
        );
      }

      if (
        resolvedFamily ===
        "blueprint"
      ) {
        try {
          const association =
            fastAssociation ||
            await window.NovaSparxAssociations
              ?.resolveVisual?.(
                clean,
                info,
                {
                  signal
                }
              );

          if (
            !force3d &&
            association?.blueprintPath &&
            await tryVerifiedBlueprintImage(
              association,
              ui
            )
          ) {
            return {
              state: "ready",
              kind:
                "blueprint-image",
              inspection:
                info,
              association
            };
          }

          if (
            association?.visualPath
          ) {
            const browserState =
              guard?.status?.() ||
              {};

            if (
              browserState.isMobile ||
              browserState.recoveryMode
            ) {
              return renderEvidenceImage(
                clean,
                info,
                ui,
                {
                  source:
                    "blueprint-safe-fallback",
                  blueprintPath:
                    association.blueprintPath ||
                    clean,
                  attemptedReferences:
                    [
                      association.blueprintPath ||
                      clean
                    ],
                  evidence:
                    association.evidence ||
                    "Blueprint relationship verified.",
                  error:
                    "Blueprint verified, but no lightweight preview image was available. Hosted mesh rendering was skipped on this device to protect stability."
                }
              );
            }

            await renderNovaMesh(
              association.visualPath,
              ui.image,
              ui.status,
              ui.meta,
              {
                signal,
                sourceLabel:
                  "NovaSparx • Blueprint-verified mesh"
              }
            );

            return {
              state: "ready",
              kind:
                "blueprint-mesh",
              inspection:
                info,
              association
            };
          }
        } catch (error) {
          if (
            error?.name ===
            "AbortError"
          ) {
            throw error;
          }

          console.warn(
            "FNAA Blueprint association:",
            error
          );
        }

        const universal =
          await tryUniversalPreview(
            clean,
            ui,
            {
              signal
            }
          );

        if (universal.rendered) {
          return {
            state: "ready",
            kind:
              universal.plan?.kind ||
              "blueprint-reference",
            inspection:
              universal.plan
                ?.inspection ||
              info
          };
        }

        return renderEvidenceImage(
          clean,
          universal.plan
            ?.inspection ||
            info,
          ui,
          universal.plan
        );
      }

      if (
        resolvedFamily ===
          "mesh" ||
        /(staticmesh|skeletalmesh|mesh)/i
          .test(type) ||
        /^s[mk]_?/i.test(
          clean
            .split("/")
            .pop() ||
          ""
        )
      ) {
        try {
          let association =
            fastAssociation;

          try {
            association =
              association ||
              await window.NovaSparxAssociations
                ?.resolveVisual?.(
                  clean,
                  info,
                  {
                    signal
                  }
                ) ||
              null;
          } catch (error) {
            if (
              error?.name ===
              "AbortError"
            ) {
              throw error;
            }
          }

          if (
            !force3d &&
            association?.blueprintPath &&
            await tryVerifiedBlueprintImage(
              association,
              ui
            )
          ) {
            return {
              state: "ready",
              kind:
                "mesh-blueprint-image",
              inspection:
                info,
              association
            };
          }

          const visualPath =
            association?.visualPath ||
            clean;

          const browserState =
            guard?.status?.() ||
            {};

          if (
            association?.blueprintPath &&
            (
              browserState.isMobile ||
              browserState.recoveryMode
            )
          ) {
            return renderEvidenceImage(
              clean,
              info,
              ui,
              {
                source:
                  "blueprint-safe-fallback",
                blueprintPath:
                  association.blueprintPath,
                attemptedReferences:
                  [
                    association.blueprintPath
                  ],
                evidence:
                  association.evidence ||
                  "A Blueprint relationship was verified.",
                error:
                  "Verified Blueprint found, but no lightweight Blueprint image was available. Hosted mesh rendering was skipped on this device to protect browser/server stability."
              }
            );
          }

          await renderNovaMesh(
            visualPath,
            ui.image,
            ui.status,
            ui.meta,
            {
              signal,
              backend:
                !browserState.isMobile &&
                !browserState.recoveryMode,
              sourceLabel:
                association
                  ?.blueprintPath
                  ? "NovaSparx • Blueprint-verified mesh"
                  : ""
            }
          );

          return {
            state: "ready",
            kind:
              association
                ?.blueprintPath
                ? "mesh-blueprint-verified"
                : "mesh",
            inspection: info,
            association
          };
        } catch (meshError) {
          if (
            signal?.aborted ||
            meshError?.name ===
              "AbortError"
          ) {
            throw abortError(
              signal
            );
          }

          const browserState =
            guard?.status?.() ||
            {};

          if (
            browserState.isMobile ||
            browserState.recoveryMode
          ) {
            return renderEvidenceImage(
              clean,
              info,
              ui,
              {
                source:
                  "device-safe-mesh-fallback",
                attemptedReferences: [],
                error:
                  meshError?.message ||
                  "No device-safe mesh preview layer was available."
              }
            );
          }

          const universal =
            await tryUniversalPreview(
              clean,
              ui,
              {
                signal
              }
            );

          if (universal.rendered) {
            return {
              state: "ready",
              kind:
                universal.plan?.kind ||
                "referenced-mesh",
              inspection:
                universal.plan
                  ?.inspection ||
                info
            };
          }

          const fallbackPlan = {
            ...(universal.plan || {}),
            error:
              universal.plan?.error ||
              meshError?.message ||
              String(meshError)
          };

          return renderEvidenceImage(
            clean,
            fallbackPlan
              ?.inspection ||
              info,
            ui,
            fallbackPlan
          );
        }
      }

      // 5) NovaSparx Layer 8 asks CUE4Parse for a verified referenced texture
      // or 3D model, then turns that result into the PNG shown to the user.
      const universal =
        await tryUniversalPreview(
          clean,
          ui,
          {
            signal
          }
        );

      if (universal.rendered) {
        return {
          state: "ready",
          kind:
            universal.plan?.kind ||
            "universal",
          inspection:
            universal.plan
              ?.inspection ||
            info
        };
      }

      // 6) Unknown/non-mesh asset types are never promoted to mesh merely
      // because a similarly named path exists. Type evidence wins over names.

      // 7) Every remaining asset receives a deterministic PNG evidence card.
      // It is explicitly labelled and never pretends to be the Fortnite art.
      return renderEvidenceImage(
        clean,
        universal.plan
          ?.inspection ||
          info,
        ui,
        universal.plan
      );
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        return {
          state:
            "aborted",
          kind:
            "cancelled"
        };
      }

      console.warn(
        "FNAA preview:",
        error
      );

      return renderEvidenceImage(
        clean,
        null,
        ui,
        {
          source:
            "path-only-evidence",
          attemptedReferences: [],
          error:
            error?.message ||
            String(error)
        }
      );
    } finally {
      const wasCurrent =
        guard
          ?.isCurrentOperation?.(
            operation
          ) ??
        !signal?.aborted;

      guard?.endOperation?.(
        operation
      );

      if (
        button &&
        wasCurrent
      ) {
        button.disabled = false;

        if (
          !ui.panel.hidden
        ) {
          button.textContent =
            t(
              "hideImage",
              "Hide Preview"
            );
        }
      }
    }
  }

  async function toggle(
    target,
    path,
    button,
    options = {}
  ) {
    return renderPreview(
      target,
      path,
      button,
      options
    );
  }

  window.addEventListener(
    "pagehide",
    () => {
      for (
        const key of
        [
          ...viewerSessions.keys()
        ]
      ) {
        release(
          key
        );
      }

      for (
        const url of
        objectUrls.values()
      ) {
        URL.revokeObjectURL(
          url
        );
      }

      objectUrls.clear();
    }
  );

  window.FortnitePreview =
    Object.freeze({
      version: "2.0.0",
      toggle,
      render: renderPreview,
      release
    });
})();

