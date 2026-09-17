import e8Worker from "./e8-entry.js";
import { withAdminReplayGuard } from "./e8-admin-guard.js";

const HUB_CLIENT = "hub-v1";
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanLabel(value, maxLength) {
  return cleanText(value, maxLength)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, maxLength);
}

function sanitizeClientContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;

  const output = {
    ...input,
    query: cleanText(input.query, 300),
    requestedVersion: cleanLabel(input.requestedVersion, 20)
  };

  if (Array.isArray(input.results)) {
    output.results = input.results.slice(0, 12).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return {
        ...item,
        match: cleanLabel(item.match || "result", 20),
        source: cleanLabel(item.source || "database", 30)
      };
    });
  }

  return output;
}

async function sanitizeHubRequest(request) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/" || request.headers.get("X-E8-Client") !== HUB_CLIENT) {
    return request;
  }

  const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return request;

  let body;
  try {
    body = await request.clone().json();
  } catch {
    return request;
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || !body.client_context) return request;

  const sanitized = {
    ...body,
    client_context: sanitizeClientContext(body.client_context)
  };
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(sanitized),
    redirect: request.redirect
  });
}

export default {
  async fetch(request, env, ctx) {
    const safeRequest = await sanitizeHubRequest(request);
    return withAdminReplayGuard(safeRequest, env, (nextRequest) => e8Worker.fetch(nextRequest, env, ctx));
  }
};
