# E8 Cloudflare Worker deployment

The E8 API layer uses `e8-entry.js` as the Worker entry point. It imports the existing `worker.js`, so Guest and legacy logged-in behavior remain available while E8 account/subscription routes are added around it.

## Required existing secret

- `API_VAULT_MASTER_KEY` — already used by the legacy stateless OpenRouter session system. Keep it only in Cloudflare secrets.

## New E8 storage secrets

- `BACK4APP_APP_ID`
- `BACK4APP_MASTER_KEY`

Optional:
- `BACK4APP_SERVER_URL` — defaults to `https://parseapi.back4app.com`.

Never commit Back4App master credentials to this repository.

## New E8 support-panel secret

Configure at least one of:

- `E8_ADMIN_PANEL_TOKENS` — comma-separated staff tokens, each at least 32 characters.
- `E8_ADMIN_PANEL_SECRET` — single staff token, at least 32 characters.

The web support panel does not save staff tokens to localStorage or sessionStorage.

## E8 AI and tool variables

Optional:

- `E8_ENHANCED_MODEL` — overrides the Plus/Premium E8AI model. Plus and Premium intentionally share the same enhanced AI tier.
- `E8_PLUS_TOOL_CATALOG` — comma-separated tool IDs eligible for Plus 5-tool selection.
- `E8_PREMIUM_TOOL_CATALOG` — comma-separated additional Premium tool IDs. Premium inherits the Plus catalog automatically.
- `ALLOWED_ORIGINS` — comma-separated extra trusted origins when needed. The GitHub Pages origin is already allowed.

## Validation

From this directory:

```sh
npm install
npm run check
```

`npm run check` performs JavaScript syntax checks and a Wrangler dry-run bundle. It does not deploy anything.

## Deployment

Only after the development branch checks pass and the required Cloudflare secrets are configured:

```sh
npm run deploy
```

Do not deploy `worker.js` directly for the E8 release; the configured entry point is `e8-entry.js`.
