(() => {
  "use strict";

  // Stable contract for a future .NET/JS WebAssembly Fortnite parser.
  // The layer orchestrator calls resolveMesh() only when an actual engine
  // registers itself. Keeping this adapter present lets NovaSparx add CUE4Parse
  // replacements incrementally without changing the preview UI again.
  let engine = null;

  function register(candidate) {
    if (
      !candidate ||
      typeof candidate.resolveMesh !== "function"
    ) {
      throw new TypeError(
        "NovaSparx local parser must expose resolveMesh(path, options)."
      );
    }

    engine = candidate;
    return true;
  }

  async function resolveMesh(path, options = {}) {
    if (!engine) {
      const error = new Error(
        "NovaSparx browser parser engine is not installed on this build."
      );
      error.code = "NOVASPARX_LOCAL_ENGINE_UNAVAILABLE";
      throw error;
    }

    return engine.resolveMesh(path, options);
  }

  function status() {
    return {
      registered: Boolean(engine),
      name:
        engine?.name ||
        engine?.version ||
        null,
      webAssembly:
        typeof WebAssembly === "object",
      worker:
        typeof Worker === "function"
    };
  }

  globalThis.NovaSparxLocalParser = Object.freeze({
    version: "1.0.0",
    register,
    resolveMesh,
    status
  });
})();
