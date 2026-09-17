# E8 Cloudflare Worker deployment

The deployed E8 Worker entry point is `e8-gateway.js`. The gateway sanitizes untrusted E8 client context before passing the request to `e8-entry.js`. `e8-entry.js` then adds E8 account/subscription behavior around the existing `worker.js`, preserving Guest and legacy logged-in fallbacks.

## Required existing secret

- `API_VAULT_MASTER_KEY` — already used by the legacy stateless OpenRouter session system. Keep it only in Cloudflare secrets.

## New E8 storage secrets

- `BACK4APP_APP_ID`
- `BACK4APP_MASTER_KEY`

Optional:
- `BACK4APP_SERVER_URL` — defaults to `https://parseapi.back4app.com`. If configured, it must use HTTPS and must not contain embedded credentials, query parameters, or a URL fragment. The E8 gateway rejects unsafe values before the master key can be sent.

Never commit Back4App master credentials to this repository, expose them to browser JavaScript, or place them in GitHub Pages files.

The `E8Account` and `E8Audit` classes are server-managed. Keep their Back4App class-level permissions closed to public/client create, read, find, update, and delete access. E8 accesses them through the Cloudflare Worker using the Back4App master key. E8 account records also use an empty ACL so they are not intended to be client-readable.

## New E8 support-panel secret

Configure at least one of:

- `E8_ADMIN_PANEL_TOKENS` — comma-separated staff tokens.
- `E8_ADMIN_PANEL_SECRET` — single staff token.

Use randomly generated, high-entropy staff tokens rather than human passwords or memorable phrases. Each token must be at least 32 characters; a longer random token is preferred. Give separate staff members separate tokens when possible so one credential can be rotated without replacing every staff credential.

Rotate a staff token immediately if it is copied into a public place, committed to source control, shared with the wrong person, or used on an untrusted device. Removing a token from the Cloudflare secret configuration invalidates it for future panel operations.

The web support panel keeps the token only in page memory, clears it after inactivity/page exit, and does not save it to localStorage or sessionStorage.

## E8 AI and tool variables

Optional:

- `E8_ENHANCED_MODEL` — overrides the Plus/Premium E8AI model. Plus and Premium intentionally share the same enhanced AI tier.
- `E8_PLUS_TOOL_CATALOG` — comma-separated tool IDs eligible for Plus 5-tool selection.
- `E8_PREMIUM_TOOL_CATALOG` — comma-separated additional Premium tool IDs. Premium inherits the Plus catalog automatically.
- `ALLOWED_ORIGINS` — comma-separated additional trusted origins when needed. Use exact origins only (scheme + hostname + optional port), prefer HTTPS, and do not add an origin merely to work around a CORS error. The E8 GitHub Pages origin and local development origins are already handled by the Worker.
- `E8_ALLOW_LOCAL_AUTH=true` — development-only escape hatch that permits OAuth `return_to` URLs on `localhost`/`127.0.0.1`. Leave this unset in production. Local OAuth redirects are blocked by the E8 gateway by default.

## Support-operation safety

Subscription activation/extension and revocation use random operation IDs. The gateway keeps a short in-memory replay cache and also records a bounded recent-operation history plus a short safety lease on the target `E8Account` record. This reduces accidental duplicate subscription changes when a browser retries a request or Cloudflare handles requests in different Worker isolates.

Do not bypass `e8-gateway.js` by deploying `e8-entry.js` directly, because doing so would remove the gateway replay/idempotency, OAuth redirect, storage-endpoint, and client-context hardening layers.

## Validation

From this directory:

```sh
npm install
npm run check
```

`npm run check` performs JavaScript syntax checks and a Wrangler dry-run bundle. It does not deploy anything.

The repository-level `E8 platform checks` GitHub Actions workflow also validates E8 static references, security invariants, CSP requirements, the hardened gateway chain, and the Worker dry-run build.

## Deployment

Only after the development branch checks pass and the required Cloudflare secrets are configured:

```sh
npm run deploy
```

Do not deploy `worker.js` or `e8-entry.js` directly for the E8 release. `wrangler.toml` intentionally points to `e8-gateway.js` so the full hardened chain is included.

After deployment, verify the E8 account page and support flow with a non-production test account before activating real subscriptions. Confirm that an invalid staff token is rejected, that a valid token can perform one intended change, and that retrying the same operation does not apply the change twice.
