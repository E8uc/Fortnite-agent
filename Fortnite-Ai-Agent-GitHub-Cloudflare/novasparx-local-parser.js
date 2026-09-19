(() => {
  "use strict";

  let engine =
    null;

  let prepared =
    null;

  let prepareTask =
    null;

  let prepareGeneration =
    0;

  function abortError(
    signal
  ) {
    const error =
      new Error(
        "NovaSparx parser request was replaced by a newer request."
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

    prepareTask =
      null;

    prepareGeneration++;

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
    throwIfAborted(
      options.signal
    );

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

    const requestSignal =
      options.signal ||
      null;

    if (
      !options.refresh &&
      prepareTask &&
      prepareTask.signal ===
        requestSignal
    ) {
      return prepareTask
        .promise;
    }

    const generation =
      ++prepareGeneration;

    const request =
      (async () => {
        throwIfAborted(
          requestSignal
        );
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
                  requestSignal,
                refresh:
                  Boolean(
                    options.refresh
                  )
              });

          throwIfAborted(
            requestSignal
          );
        }

        const context = {
          transport,
          bootstrap,
          signal:
            requestSignal,
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

        throwIfAborted(
          requestSignal
        );

        const nextPrepared = {
          engine,
          engineState,
          transport,
          bootstrap,
          at:
            Date.now()
        };

        if (
          generation ===
          prepareGeneration
        ) {
          prepared =
            nextPrepared;
        }

        return nextPrepared;
      })();

    prepareTask = {
      promise:
        request,
      signal:
        requestSignal,
      generation
    };

    try {
      return await request;
    } finally {
      if (
        prepareTask?.promise ===
        request
      ) {
        prepareTask =
          null;
      }
    }
  }

  async function resolveMesh(
    path,
    options = {}
  ) {
    throwIfAborted(
      options.signal
    );

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

    throwIfAborted(
      options.signal
    );

    const result =
      await engine.resolveMesh(
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

    throwIfAborted(
      options.signal
    );

    return result;
  }

  function status() {
    const transport =
      globalThis
        .NovaSparxBrowserTransport;

    return {
      version:
        "2.1.0",
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
        "2.1.0",
      register,
      reset,
      prepare,
      resolveMesh,
      status
    });
})();
