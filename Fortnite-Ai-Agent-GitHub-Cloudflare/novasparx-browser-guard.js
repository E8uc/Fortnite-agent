(() => {
  "use strict";

  const ua = String(navigator.userAgent || "");
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || /Mobile/i.test(ua);

  const deviceMemory =
    Number(navigator.deviceMemory || 0);

  const hardwareConcurrency =
    Number(navigator.hardwareConcurrency || 0);

  const ACTIVE_PREVIEW_KEY =
    "novasparx:active-preview-v1";

  const SAFE_MODE_KEY =
    "novasparx:safe-mode-until-v1";

  function storageGet(key) {
    try {
      return globalThis.localStorage
        ?.getItem?.(key) || "";
    } catch {
      return "";
    }
  }

  function storageSet(key, value) {
    try {
      globalThis.localStorage
        ?.setItem?.(
          key,
          String(value)
        );
    } catch {}
  }

  function storageRemove(key) {
    try {
      globalThis.localStorage
        ?.removeItem?.(key);
    } catch {}
  }

  const bootTime =
    Date.now();

  const previousActiveAt =
    Number(
      storageGet(
        ACTIVE_PREVIEW_KEY
      ) || 0
    );

  let safeModeUntil =
    Number(
      storageGet(
        SAFE_MODE_KEY
      ) || 0
    );

  // If the previous page vanished while a preview was active and no normal
  // pagehide/endOperation cleanup ran, assume a tab/process interruption.
  // Safari does not expose a direct "the tab crashed" event, so this persistent
  // sentinel is intentionally heuristic and only tightens limits temporarily.
  if (
    previousActiveAt > 0 &&
    bootTime - previousActiveAt <
      15 * 60 * 1000
  ) {
    safeModeUntil =
      Math.max(
        safeModeUntil,
        bootTime +
          30 * 60 * 1000
      );

    storageSet(
      SAFE_MODE_KEY,
      safeModeUntil
    );
  } else if (
    previousActiveAt > 0
  ) {
    storageRemove(
      ACTIVE_PREVIEW_KEY
    );
  }

  const recoveryMode =
    safeModeUntil >
    bootTime;

  // Safari/WebKit does not expose a reliable per-tab RAM budget. These limits
  // are deliberately conservative and are used before large allocations.
  const packageLimitBytes =
    recoveryMode
      ? (
          isIOS
            ? 4 * 1024 * 1024
            : isMobile
              ? 8 * 1024 * 1024
              : 16 * 1024 * 1024
        )
      : isIOS
        ? 8 * 1024 * 1024
        : isMobile
          ? 12 * 1024 * 1024
          : 32 * 1024 * 1024;

  const geometryBudgetBytes =
    recoveryMode
      ? (
          isIOS
            ? 16 * 1024 * 1024
            : isMobile
              ? 28 * 1024 * 1024
              : 96 * 1024 * 1024
        )
      : isIOS
        ? 30 * 1024 * 1024
        : isMobile
          ? 48 * 1024 * 1024
          : 160 * 1024 * 1024;

  const maxVertices =
    recoveryMode
      ? (
          isIOS
            ? 60_000
            : isMobile
              ? 100_000
              : 260_000
        )
      : isIOS
        ? 100_000
        : isMobile
          ? 160_000
          : 400_000;

  const maxIndices =
    recoveryMode
      ? (
          isIOS
            ? 180_000
            : isMobile
              ? 300_000
              : 780_000
        )
      : isIOS
        ? 300_000
        : isMobile
          ? 480_000
          : 1_200_000;

  const previewTimeoutMs =
    isIOS
      ? 16_000
      : isMobile
        ? 20_000
        : 35_000;

  let activeController = null;
  let pressureState = "normal";
  let lastReason = "";
  let lastMeasurement = null;

  function byteLength(value) {
    if (!value) return 0;

    if (ArrayBuffer.isView(value)) {
      return value.byteLength;
    }

    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }

    if (Array.isArray(value)) {
      // Number arrays are much more expensive than typed arrays in JS heaps.
      return value.length * 8;
    }

    return 0;
  }

  function geometryBytes(manifest) {
    const geometry = manifest?.geometry || {};

    return (
      byteLength(geometry.positions) +
      byteLength(geometry.indices) +
      byteLength(geometry.normals) +
      byteLength(geometry.tangents) +
      byteLength(geometry.uv0) +
      byteLength(geometry.colors)
    );
  }

  function counts(manifest) {
    const geometry = manifest?.geometry || {};

    const positions =
      geometry.positions;

    const indices =
      geometry.indices;

    return {
      vertices:
        Number(
          manifest?.metadata?.vertexCount ||
          ((positions?.length || 0) / 3)
        ) || 0,
      indices:
        Number(indices?.length || 0) || 0
    };
  }

  function legacyHeapSnapshot() {
    const memory =
      performance?.memory;

    if (
      !memory ||
      !Number.isFinite(memory.usedJSHeapSize) ||
      !Number.isFinite(memory.jsHeapSizeLimit)
    ) {
      return null;
    }

    return {
      bytes:
        Number(memory.usedJSHeapSize),
      limit:
        Number(memory.jsHeapSizeLimit),
      source:
        "performance.memory"
    };
  }

  async function measureMemory() {
    if (
      globalThis.crossOriginIsolated &&
      typeof performance?.measureUserAgentSpecificMemory === "function"
    ) {
      try {
        const sample =
          await performance.measureUserAgentSpecificMemory();

        lastMeasurement = {
          bytes:
            Number(sample?.bytes || 0),
          limit: 0,
          source:
            "measureUserAgentSpecificMemory"
        };

        return lastMeasurement;
      } catch {
        // Fall through to the legacy Chromium-only signal.
      }
    }

    lastMeasurement =
      legacyHeapSnapshot();

    return lastMeasurement;
  }

  function setPressure(state, reason = "") {
    pressureState = state;
    lastReason = String(reason || "");
  }

  function assertResponseBudget(response, purpose = "mesh") {
    const length =
      Number(
        response?.headers?.get?.(
          "content-length"
        ) || 0
      );

    if (
      length > 0 &&
      length > packageLimitBytes
    ) {
      try {
        response.body?.cancel();
      } catch {}

      const error =
        new Error(
          `NovaSparx stopped a ${Math.ceil(length / 1024 / 1024)} MiB ${purpose} before it could exhaust this browser.`
        );

      error.code =
        "NOVASPARX_BROWSER_BUDGET";

      throw error;
    }

    // FNAA's NovaLink normally supplies Content-Length. On iOS, refuse an
    // unbounded binary response rather than discover its size after allocating it.
    if (
      isIOS &&
      purpose === "mesh" &&
      !length
    ) {
      try {
        response.body?.cancel();
      } catch {}

      const error =
        new Error(
          "NovaSparx stopped an unbounded mesh response to protect mobile Safari."
        );

      error.code =
        "NOVASPARX_BROWSER_BUDGET";

      throw error;
    }

    const heap =
      legacyHeapSnapshot();

    if (
      heap?.limit > 0 &&
      length > 0
    ) {
      // Binary payload + WebGL upload + renderer working memory.
      const projected =
        heap.bytes +
        length * 3.5;

      if (
        projected >
        heap.limit * 0.78
      ) {
        try {
          response.body?.cancel();
        } catch {}

        const error =
          new Error(
            "NovaSparx paused this preview because the browser is already close to its memory limit."
          );

        error.code =
          "NOVASPARX_BROWSER_PRESSURE";

        setPressure(
          "high",
          "heap-preflight"
        );

        throw error;
      }
    }

    return {
      contentLength:
        length,
      limit:
        packageLimitBytes
    };
  }

  function assertManifestBudget(manifest) {
    const bytes =
      geometryBytes(manifest);

    const count =
      counts(manifest);

    if (
      bytes > geometryBudgetBytes ||
      count.vertices > maxVertices ||
      count.indices > maxIndices
    ) {
      const error =
        new Error(
          "NovaSparx selected a lighter preview because this mesh is too large for the current device budget."
        );

      error.code =
        "NOVASPARX_BROWSER_BUDGET";

      throw error;
    }

    return {
      geometryBytes:
        bytes,
      vertices:
        count.vertices,
      indices:
        count.indices
    };
  }

  async function canPersist(bytes) {
    if (
      !Number.isFinite(bytes) ||
      bytes <= 0 ||
      !navigator.storage?.estimate
    ) {
      return true;
    }

    try {
      const estimate =
        await navigator.storage.estimate();

      const quota =
        Number(estimate.quota || 0);

      const usage =
        Number(estimate.usage || 0);

      if (!quota) return true;

      // Keep generous headroom for Safari private browsing / eviction behavior.
      return (
        usage +
        bytes * 2.2 <
        quota * 0.8
      );
    } catch {
      return true;
    }
  }

  function renderPolicy(manifest) {
    const count =
      counts(manifest);

    const veryHeavy =
      count.vertices >
        (isMobile ? 90_000 : 260_000);

    return {
      size:
        recoveryMode
          ? (
              isIOS
                ? 512
                : isMobile
                  ? 576
                  : 768
            )
          : isIOS
            ? (veryHeavy ? 512 : 640)
            : isMobile
              ? (veryHeavy ? 640 : 768)
              : (veryHeavy ? 768 : 1024),

      supersample:
        !isMobile &&
        !veryHeavy,

      maxMaterials:
        isIOS
          ? 4
          : isMobile
            ? 8
            : 24,

      maxTextureLoads:
        recoveryMode
          ? (
              isIOS
                ? 2
                : isMobile
                  ? 5
                  : 20
            )
          : isIOS
            ? 4
            : isMobile
              ? 10
              : 40,

      textureModes:
        isIOS
          ? ["base"]
          : isMobile
            ? ["base", "normal"]
            : ["base", "normal", "emissive", "opacity", "packed"],

      mipmaps:
        !isMobile,

      powerPreference:
        isMobile
          ? "low-power"
          : "high-performance"
    };
  }

  function beginOperation(label = "preview") {
    if (activeController) {
      try {
        clearTimeout(
          activeController
            .__novaTimeout
        );
      } catch {}

      activeController.abort(
        "replaced-by-new-preview"
      );
    }

    activeController =
      new AbortController();

    activeController.label =
      String(label || "preview");

    activeController.__novaTimeout =
      setTimeout(
        () => {
          try {
            activeController
              ?.abort(
                "preview-time-budget"
              );
          } catch {}
        },
        previewTimeoutMs
      );

    storageSet(
      ACTIVE_PREVIEW_KEY,
      Date.now()
    );

    return activeController;
  }

  function endOperation(controller) {
    if (
      controller &&
      activeController === controller
    ) {
      try {
        clearTimeout(
          controller
            .__novaTimeout
        );
      } catch {}

      activeController = null;
      storageRemove(
        ACTIVE_PREVIEW_KEY
      );
    }
  }

  function abortActive(reason = "browser-lifecycle") {
    if (!activeController) return;

    try {
      clearTimeout(
        activeController
          .__novaTimeout
      );
    } catch {}

    try {
      activeController.abort(reason);
    } catch {}

    activeController = null;

    storageRemove(
      ACTIVE_PREVIEW_KEY
    );
  }

  function status() {
    return {
      isIOS,
      isAndroid,
      isMobile,
      deviceMemory:
        deviceMemory || null,
      hardwareConcurrency:
        hardwareConcurrency || null,
      previewTimeoutMs,
      recoveryMode,
      safeModeUntil:
        recoveryMode
          ? safeModeUntil
          : null,
      packageLimitBytes,
      geometryBudgetBytes,
      maxVertices,
      maxIndices,
      pressureState,
      lastReason,
      lastMeasurement
    };
  }

  addEventListener(
    "pagehide",
    () => {
      abortActive("pagehide");
      globalThis.NovaSparxLayers
        ?.releaseMemory?.();
    }
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.visibilityState ===
        "hidden"
      ) {
        abortActive(
          "page-hidden"
        );
      }
    }
  );

  globalThis.NovaSparxBrowserGuard =
    Object.freeze({
      version: "1.2.0",
      status,
      measureMemory,
      assertResponseBudget,
      assertManifestBudget,
      canPersist,
      renderPolicy,
      beginOperation,
      endOperation,
      abortActive,
      setPressure
    });
})();
