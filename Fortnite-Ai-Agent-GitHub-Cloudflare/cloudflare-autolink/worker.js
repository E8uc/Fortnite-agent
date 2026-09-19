import { DurableObject } from "cloudflare:workers";

const LINK_INSTANCE_NAME = "primary";
const BACKEND_TAG = "nova-backend";

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_CONTROL_BYTES = 256 * 1024;

function requestTimeoutMs(path) {
  if (
    path === "/v1/warmup" ||
    path === "/v1/refresh"
  ) {
    return 140_000;
  }

  if (path === "/v1/client-mesh") {
    return 35_000;
  }

  if (path === "/v1/resolve") {
    return 30_000;
  }

  if (
    path === "/v1/preview" ||
    path === "/v1/texture"
  ) {
    return 24_000;
  }

  if (
    path === "/v1/inspect" ||
    path === "/v1/references"
  ) {
    return 20_000;
  }

  return 15_000;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return (
    request.headers.get("x-novasparx-link-token") ||
    ""
  ).trim();
}

function authorized(request, env) {
  const supplied = bearerToken(request);

  if (!supplied) return false;

  const expectedTokens = [
    env.NOVASPARX_SHARED_TOKEN,
    env.NOVASPARX_LINK_TOKEN,
    env.NOVASPARX_SHARED_TOKEN_PREVIOUS,
    env.NOVASPARX_LINK_TOKEN_PREVIOUS
  ]
    .map((value) =>
      String(value || "").trim()
    )
    .filter(Boolean);

  return expectedTokens.some(
    (expected) =>
      supplied.length === expected.length &&
      supplied === expected
  );
}

function getStub(env) {
  const id = env.NOVA_LINK.idFromName(LINK_INSTANCE_NAME);
  return env.NOVA_LINK.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "NovaSparx AutoLink",
        protocol: "novasparx.autolink.v1"
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const stub = getStub(env);
        return await stub.fetch(
          new Request("https://autolink.internal/__status", {
            method: "GET"
          })
        );
      } catch (error) {
        return json(
          {
            ok: false,
            service: "NovaSparx AutoLink",
            connected: false,
            error: String(error?.message || error)
          },
          503
        );
      }
    }

    if (url.pathname === "/connect") {
      if (request.method !== "GET") {
        return json(
          { state: "error", error: "GET required." },
          405
        );
      }

      if (
        (request.headers.get("upgrade") || "").toLowerCase() !==
        "websocket"
      ) {
        return json(
          {
            state: "error",
            error: "Upgrade: websocket required."
          },
          426
        );
      }

      if (!authorized(request, env)) {
        return json(
          { state: "error", error: "Unauthorized." },
          401
        );
      }

      const stub = getStub(env);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith("/v1/")) {
      if (request.method !== "GET" && request.method !== "POST") {
        return json(
          { state: "error", error: "Method not allowed." },
          405
        );
      }

      if (!authorized(request, env)) {
        return json(
          { state: "error", error: "Unauthorized." },
          401
        );
      }

      const stub = getStub(env);
      return stub.fetch(request);
    }

    return json(
      { state: "missing", error: "Route not found." },
      404
    );
  }
};

export class NovaLinkDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;

    // Pending requests only exist while an HTTP request is actively waiting
    // for data, so they do not need Durable Object storage.
    this.pending = new Map();

    // If a browser replaces a request after AutoLink already forwarded it,
    // keep the id briefly so any late response frames can be discarded
    // without tearing down the reverse socket.
    this.cancelledResponseIds =
      new Set();

    // Binary frames intentionally contain only body bytes. NovaSparx sends one
    // response at a time over the reverse socket, so this identifies which
    // pending request owns incoming binary frames.
    this.activeResponseId = null;

    this.backendVersion = null;
    this.connectedAt = null;
    this.lastDisconnectedAt = null;
    this.lastCloseCode = null;
    this.lastCloseReason = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/__status") {
      const socket = this.getBackendSocket();

      let attachment = null;

      if (socket) {
        try {
          attachment =
            socket.deserializeAttachment();
        } catch {
          attachment = null;
        }
      }

      return json({
        ok: true,
        service: "NovaSparx AutoLink",
        connected: !!socket,
        protocol: "novasparx.autolink.v1",
        pendingRequests: this.pending.size,
        backendVersion:
          attachment?.backendVersion ||
          this.backendVersion ||
          null,
        connectedAt:
          attachment?.connectedAt ||
          this.connectedAt ||
          null,
        lastDisconnectedAt: this.lastDisconnectedAt,
        lastCloseCode: this.lastCloseCode,
        lastCloseReason: this.lastCloseReason
      });
    }

    if (url.pathname === "/connect") {
      if (!authorized(request, this.env)) {
        return json(
          { state: "error", error: "Unauthorized." },
          401
        );
      }

      if (
        (request.headers.get("upgrade") || "").toLowerCase() !==
        "websocket"
      ) {
        return json(
          {
            state: "error",
            error: "Upgrade: websocket required."
          },
          426
        );
      }

      this.backendVersion =
        String(
          request.headers.get("x-novasparx-version") || ""
        ).trim() || null;

      this.connectedAt =
        new Date().toISOString();

      this.lastCloseCode = null;
      this.lastCloseReason = null;

      // One backend connection is enough for this deployment. Replacing an
      // old socket is safer than keeping two parsers racing to answer the same
      // logical request stream.
      for (const oldSocket of this.ctx.getWebSockets(BACKEND_TAG)) {
        try {
          oldSocket.close(
            1012,
            "NovaSparx backend reconnected"
          );
        } catch {
          // Ignore stale closing sockets.
        }
      }

      this.failAllPending(
        new Error("NovaSparx backend reconnected.")
      );

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server, [BACKEND_TAG]);

      try {
        server.serializeAttachment({
          backendVersion:
            this.backendVersion,
          connectedAt:
            this.connectedAt
        });
      } catch {
        // Connection metadata is diagnostic-only. The socket still works
        // even if attachment persistence is unavailable.
      }

      server.send(
        JSON.stringify({
          type: "hello",
          protocol: "novasparx.autolink.v1",
          maxChunkBytes: 512 * 1024,
          maxResponseBytes: MAX_RESPONSE_BYTES
        })
      );

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    if (!url.pathname.startsWith("/v1/")) {
      return json(
        { state: "missing", error: "Route not found." },
        404
      );
    }

    if (!authorized(request, this.env)) {
      return json(
        { state: "error", error: "Unauthorized." },
        401
      );
    }

    const socket = this.getBackendSocket();

    if (!socket) {
      return json(
        {
          state: "offline",
          error: "NovaSparx backend is not connected."
        },
        503,
        { "retry-after": "5" }
      );
    }

    return this.proxyToBackend(socket, request, url);
  }

  getBackendSocket() {
    const sockets = this.ctx.getWebSockets(BACKEND_TAG);

    for (const socket of sockets) {
      // OPEN = 1 in the standard WebSocket readyState enum.
      if (socket.readyState === 1) {
        return socket;
      }
    }

    return null;
  }

  async proxyToBackend(socket, request, url) {
    const id = crypto.randomUUID();

    const query = {};
    for (const [key, value] of url.searchParams) {
      if (!(key in query)) query[key] = value;
    }

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    let resolveHeader;
    let rejectHeader;
    let resolveDone;

    const headerPromise = new Promise((resolve, reject) => {
      resolveHeader = resolve;
      rejectHeader = reject;
    });

    const donePromise = new Promise((resolve) => {
      resolveDone = resolve;
    });

    const pending = {
      id,
      writer,
      resolveHeader,
      rejectHeader,
      resolveDone,
      headerResolved: false,
      expectedLength: null,
      expectedChunks: null,
      receivedBytes: 0,
      receivedChunks: 0,
      timeout: null,
      requestSignal:
        request.signal ||
        null,
      abortHandler:
        null
    };

    const cancelBackend =
      (reason) => {
        this.rememberCancelledResponse(
          id
        );

        try {
          socket.send(
            JSON.stringify({
              type:
                "cancel",
              id,
              reason:
                String(
                  reason ||
                  "client-cancelled"
                ).slice(
                  0,
                  120
                )
            })
          );
        } catch {}

        this.failPending(
          id,
          new Error(
            "NovaSparx AutoLink request was cancelled."
          ),
          {
            discardLateResponse:
              true
          }
        );
      };

    pending.abortHandler =
      () =>
        cancelBackend(
          request.signal
            ?.reason ||
          "client-request-aborted"
        );

    pending.timeout = setTimeout(
      () =>
        cancelBackend(
          "autolink-timeout"
        ),
      requestTimeoutMs(
        url.pathname
      )
    );

    this.pending.set(
      id,
      pending
    );

    if (
      request.signal
        ?.aborted
    ) {
      pending.abortHandler();
    } else {
      request.signal
        ?.addEventListener?.(
          "abort",
          pending.abortHandler,
          {
            once:
              true
          }
        );
    }

    // Keep this Durable Object event alive until the complete response body
    // arrives. Without this, the WebSocket can survive hibernation while the
    // in-memory pending stream state is discarded between the response header
    // and the following binary frame.
    this.ctx.waitUntil(donePromise);

    try {
      socket.send(
        JSON.stringify({
          type: "request",
          id,
          method: request.method,
          path: url.pathname,
          query
        })
      );
    } catch (error) {
      this.failPending(id, error);
    }

    let header;

    try {
      header = await headerPromise;
    } catch (error) {
      return json(
        {
          state: "error",
          error: String(
            error?.message ||
            "NovaSparx AutoLink request failed."
          )
        },
        502
      );
    }

    const headers = new Headers({
      "content-type":
        header.contentType ||
        "application/octet-stream",
      "cache-control": "no-store",
      "x-novasparx-autolink": "1"
    });

    if (Number.isFinite(header.length)) {
      headers.set(
        "content-length",
        String(header.length)
      );
    }

    return new Response(stream.readable, {
      status: header.status,
      headers
    });
  }

  async webSocketMessage(ws, message) {
    if (typeof message === "string") {
      if (
        new TextEncoder().encode(message).byteLength >
        MAX_CONTROL_BYTES
      ) {
        ws.close(1009, "Control message too large");
        this.failAllPending(
          new Error("NovaLink control message too large.")
        );
        return;
      }

      let control;

      try {
        control = JSON.parse(message);
      } catch {
        ws.send(
          JSON.stringify({
            type: "protocol_error",
            error: "Invalid JSON control message."
          })
        );
        return;
      }

      const type = String(control?.type || "")
        .trim()
        .toLowerCase();

      if (type === "response") {
        this.beginResponse(control);
        return;
      }

      if (type === "response_end") {
        await this.endResponse(control);
        return;
      }

      if (type === "cancelled") {
        this.finishCancelledResponse(
          control
        );
        return;
      }

      if (type === "pong" || type === "hello") {
        return;
      }

      if (type === "protocol_error") {
        this.failAllPending(
          new Error(
            String(
              control?.error ||
              "NovaSparx reported a protocol error."
            )
          )
        );
        return;
      }

      return;
    }

    const id = this.activeResponseId;

    if (!id) {
      ws.close(
        1002,
        "Binary frame without response header"
      );
      this.failAllPending(
        new Error(
          "NovaLink received binary data without an active response."
        )
      );
      return;
    }

    const pending = this.pending.get(id);

    if (!pending) {
      if (
        this.cancelledResponseIds
          .has(id)
      ) {
        return;
      }

      ws.close(
        1002,
        "Unknown response id"
      );
      return;
    }

    const chunk =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            message.buffer,
            message.byteOffset,
            message.byteLength
          );

    pending.receivedBytes += chunk.byteLength;
    pending.receivedChunks += 1;

    if (
      pending.receivedBytes > MAX_RESPONSE_BYTES ||
      (
        Number.isFinite(pending.expectedLength) &&
        pending.receivedBytes > pending.expectedLength
      )
    ) {
      ws.close(1009, "Response too large");

      this.failPending(
        id,
        new Error(
          "NovaSparx response exceeded its declared size."
        )
      );

      this.activeResponseId = null;
      return;
    }

    try {
      await pending.writer.write(chunk);
    } catch (error) {
      this.failPending(id, error);
      this.activeResponseId = null;
    }
  }

  beginResponse(control) {
    const id = String(control?.id || "");

    if (!id) return;

    const pending = this.pending.get(id);

    if (!pending) {
      if (
        this.cancelledResponseIds
          .has(id)
      ) {
        if (
          this.activeResponseId &&
          this.activeResponseId !==
            id
        ) {
          this.failAllPending(
            new Error(
              "NovaLink received overlapping binary responses."
            )
          );
          return;
        }

        this.activeResponseId =
          id;

        return;
      }

      return;
    }

    if (this.activeResponseId) {
      this.failAllPending(
        new Error(
          "NovaLink received overlapping binary responses."
        )
      );
      return;
    }

    const status = Number(control?.status);
    const length = Number(control?.length);
    const chunks = Number(control?.chunks);

    if (
      !Number.isInteger(status) ||
      status < 100 ||
      status > 599
    ) {
      this.failPending(
        id,
        new Error("NovaLink returned an invalid HTTP status.")
      );
      return;
    }

    if (
      !Number.isInteger(length) ||
      length < 0 ||
      length > MAX_RESPONSE_BYTES
    ) {
      this.failPending(
        id,
        new Error("NovaLink returned an invalid body length.")
      );
      return;
    }

    if (
      !Number.isInteger(chunks) ||
      chunks < 0 ||
      chunks > 128
    ) {
      this.failPending(
        id,
        new Error("NovaLink returned an invalid chunk count.")
      );
      return;
    }

    pending.expectedLength = length;
    pending.expectedChunks = chunks;
    pending.headerResolved = true;

    this.activeResponseId = id;

    pending.resolveHeader({
      status,
      contentType: String(
        control?.contentType ||
        "application/octet-stream"
      ),
      length,
      chunks
    });
  }

  async endResponse(control) {
    const id = String(control?.id || "");

    if (!id) return;

    const pending = this.pending.get(id);

    if (!pending) {
      if (
        this.cancelledResponseIds
          .has(id)
      ) {
        this.cancelledResponseIds
          .delete(id);

        if (
          this.activeResponseId ===
          id
        ) {
          this.activeResponseId =
            null;
        }
      }

      return;
    }

    if (this.activeResponseId !== id) {
      this.failPending(
        id,
        new Error(
          "NovaLink response ended out of order."
        )
      );
      return;
    }

    if (
      pending.receivedBytes !== pending.expectedLength ||
      pending.receivedChunks !== pending.expectedChunks
    ) {
      this.failPending(
        id,
        new Error(
          "NovaLink response body did not match its declared size."
        )
      );

      this.activeResponseId = null;
      return;
    }

    clearTimeout(
      pending.timeout
    );

    pending.requestSignal
      ?.removeEventListener?.(
        "abort",
        pending.abortHandler
      );

    this.pending.delete(id);
    this.activeResponseId = null;

    try {
      await pending.writer.close();
    } catch {
      // Consumer disconnected after receiving enough data.
    } finally {
      pending.resolveDone?.();
    }
  }

  finishCancelledResponse(
    control
  ) {
    const id =
      String(
        control?.id ||
        ""
      );

    if (!id) {
      return;
    }

    this.cancelledResponseIds
      .delete(id);

    if (
      this.activeResponseId ===
      id
    ) {
      this.activeResponseId =
        null;
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    this.activeResponseId = null;
    this.lastDisconnectedAt =
      new Date().toISOString();
    this.lastCloseCode = code;
    this.lastCloseReason =
      reason || "closed";

    this.failAllPending(
      new Error(
        `NovaSparx backend disconnected (${code}: ${reason || "closed"}).`
      )
    );
  }

  async webSocketError(ws, error) {
    this.activeResponseId = null;
    this.lastDisconnectedAt =
      new Date().toISOString();
    this.lastCloseCode = null;
    this.lastCloseReason =
      String(
        error?.message ||
        "NovaSparx backend WebSocket error."
      );

    this.failAllPending(
      new Error(
        this.lastCloseReason
      )
    );
  }

  rememberCancelledResponse(
    id
  ) {
    if (!id) {
      return;
    }

    this.cancelledResponseIds
      .add(id);

    while (
      this.cancelledResponseIds
        .size > 128
    ) {
      const oldest =
        this.cancelledResponseIds
          .values()
          .next()
          .value;

      if (!oldest) {
        break;
      }

      this.cancelledResponseIds
        .delete(oldest);
    }
  }

  failPending(
    id,
    error,
    options = {}
  ) {
    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(
      pending.timeout
    );

    pending.requestSignal
      ?.removeEventListener?.(
        "abort",
        pending.abortHandler
      );

    this.pending.delete(id);

    if (
      options.discardLateResponse
    ) {
      this.rememberCancelledResponse(
        id
      );
    }

    if (!pending.headerResolved) {
      try {
        pending.rejectHeader(error);
      } catch {
        // Promise already settled.
      }
    }

    try {
      pending.writer.abort(error);
    } catch {
      // Stream already closed or canceled.
    } finally {
      pending.resolveDone?.();
    }

    if (
      this.activeResponseId ===
        id &&
      !options
        .discardLateResponse
    ) {
      this.activeResponseId =
        null;
    }
  }

  failAllPending(error) {
    const ids = [...this.pending.keys()];

    for (const id of ids) {
      this.failPending(id, error);
    }

    this.activeResponseId = null;

    this.cancelledResponseIds
      .clear();
  }
}
