(() => {
  "use strict";

  let engine =
    null;

  let prepared =
    null;

  let preparePromise =
    null;

  function unavailableError() {
    const error =
      new Error(
        "NovaSparx browser parser engine is not installed on this build."
      );

    error.code =
      "NOVASPARX_LOCAL_ENGINE_UNAVAILABLE";

    return error;
  }

  function register(
    candidate
  ) {
    if (
      !candidate ||
      typeof candidate.resolveMesh !==
        "function"
    ) {
      throw new TypeError(
        "NovaSparx local parser must expose resolveMesh(path, options)."
      );
    }

    engine =
      candidate;

    prepared =
      null;

    preparePromise =
      null;

    return true;
  }

  function reset() {
    prepared =
      null;

    preparePromise =
      null;

    try {
      engine?.reset?.();
    } catch {}
  }

  function transportFor(
    options
  ) {
    return (
      options?.transport ||
      globalThis
        .NovaSparxBrowserTransport ||
      null
    );
  }

  async function prepare(
    options = {}
  ) {
    if (!engine) {
      throw unavailableError();
    }

    if (
      !options.refresh &&
      prepared?.engine ===
        engine
    ) {
      return prepared;
    }

    if (
      !options.refresh &&
      preparePromise
    ) {
      return preparePromise;
    }

    const request =
      (async () => {
        const transport =
          transportFor(
            options
          );

        let bootstrap =
          options.bootstrap ||
          null;

        if (
          !bootstrap &&
          engine.requiresBootstrap !==
            false
        ) {
          if (
            typeof transport
              ?.bootstrap !==
              "function"
          ) {
            const error =
              new Error(
                "NovaSparx browser parser requires edge metadata, but the edge transport is unavailable."
              );

            error.code =
              "NOVASPARX_EDGE_BOOTSTRAP_UNAVAILABLE";

            throw error;
          }

          bootstrap =
            await transport
              .bootstrap({
                signal:
                  options.signal ||
                  null,
                refresh:
                  Boolean(
                    options.refresh
                  )
              });
        }

        const context = {
          transport,
          bootstrap,
          signal:
            options.signal ||
            null,
          webAssembly:
            typeof WebAssembly ===
              "object",
          worker:
            typeof Worker ===
              "function"
        };

        const engineState =
          typeof engine.prepare ===
            "function"
            ? await engine.prepare(
                context
              )
            : null;

        prepared = {
          engine,
          engineState,
          transport,
          bootstrap,
          at:
            Date.now()
        };

        return prepared;
      })();

    preparePromise =
      request;

    try {
      return await request;
    } finally {
      if (
        preparePromise ===
        request
      ) {
        preparePromise =
          null;
      }
    }
  }

  async function resolveMesh(
    path,
    options = {}
  ) {
    if (!engine) {
      throw unavailableError();
    }

    const state =
      options.prepare ===
        false
        ? {
            engine,
            engineState:
              null,
            transport:
              transportFor(
                options
              ),
            bootstrap:
              options.bootstrap ||
              null
          }
        : await prepare(
            options
          );

    return engine.resolveMesh(
      path,
      {
        ...options,
        transport:
          state.transport,
        bootstrap:
          state.bootstrap,
        parserState:
          state.engineState
      }
    );
  }

  function status() {
    const transport =
      globalThis
        .NovaSparxBrowserTransport;

    return {
      version:
        "2.0.0",
      registered:
        Boolean(engine),
      prepared:
        Boolean(
          prepared?.engine ===
          engine &&
          engine
        ),
      name:
        engine?.name ||
        engine?.version ||
        null,
      requiresBootstrap:
        engine
          ? engine
              .requiresBootstrap !==
            false
          : null,
      webAssembly:
        typeof WebAssembly ===
          "object",
      worker:
        typeof Worker ===
          "function",
      edgeTransport:
        typeof transport
          ?.fetchRange ===
          "function",
      edgeBootstrap:
        typeof transport
          ?.bootstrap ===
          "function"
    };
  }

  globalThis.NovaSparxLocalParser =
    Object.freeze({
      version:
        "2.0.0",
      register,
      reset,
      prepare,
      resolveMesh,
      status
    });
})();
