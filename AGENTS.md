# E8 repository instructions

## Project direction

This repository is migrating from Fortnite Ai Agent (FNAA) into the broader E8 platform.

Core product hierarchy:
- E8Hub: the central workspace/home.
- E8AI: the renamed and expanded FNAA experience inside E8Hub.
- E8Tools / Fortnite tools: existing and future creator utilities.
- E8Studio: future visual creation tools.

Do not remove a working legacy capability until its E8 replacement is implemented and tested.

## Compatibility rules

Preserve these user classes:
1. Guest: keep the current guest behavior and limits.
2. Logged-in / Free: OpenRouter login remains free and keeps the legacy logged-in capabilities.
3. Plus: inherits every Free capability and adds subscription features.
4. Premium: inherits every Free and Plus capability. It uses the same enhanced AI tier as Plus and adds broader site/tool/design entitlements.

A subscription must only add capabilities. It must never remove a capability inherited from a lower tier.

## Account rules

E8 account IDs:
- Exactly 19 characters.
- Begin with `E8`.
- End with `uC`.
- The 15 middle characters are generated from letters and digits.
- The ID is a public account/support identifier, never an authentication secret.
- The ID is associated with the live OpenRouter API credential through a one-way fingerprint. Never persist the raw provider key in Back4App.
- When the OpenRouter credential is permanently invalid, invalidate the E8 ID. A new live provider credential may receive a new ID.

Account information includes plan, status, expiry, and entitlements. Subscription authorization is always decided by the API, never by frontend JavaScript.

## Plus tool-selection rule

An active Plus user may select up to five eligible tools for the duration of the subscription. Those selections are cleared when the subscription expires. Free users must not be shown paid-only tool catalogs merely as locked advertising.

## Security requirements

- Never commit secrets, API keys, master keys, staff tokens, passwords, or private credentials.
- Back4App master credentials belong only in Cloudflare Worker secrets/environment variables.
- New Back4App account records must not be publicly readable or writable; use private ACLs and master-key access from the backend.
- Staff/admin operations must be server-authorized and rate-limited. Never trust an E8 ID alone as proof of identity.
- Do not trust client-provided plan, status, expiry, permissions, model selection, or entitlement values.
- Use strict input validation, restrictive CORS, no-store responses for account/admin APIs, and safe DOM APIs such as `textContent` for untrusted text.
- Preserve CSP protections. Do not introduce inline executable scripts unless there is a compelling reviewed reason.
- Do not expose OpenRouter credentials to support staff or normal admin UI.
- Avoid storing staff tokens in localStorage/sessionStorage.
- Prefer reversible migrations and separate development branches before production changes.

## UX requirements

User experience is a primary requirement. Avoid cluttering Free users' interfaces with large amounts of unavailable Plus/Premium content.

E8AI behavior:
- Suggestions act as the first user message and immediately start a new chat.
- Show exactly five randomly selected suggestions without duplicates.
- The back control in E8AI returns to E8Hub.
- Search/recents are local until a reviewed server-side history design is implemented.

Hub navigation currently includes Settings, Hub, More Fortnite Tools, Python Tools, Designs, Verse Codes, and a final non-clickable `Soon` label. Do not invent unfinished destination pages just to make a menu item clickable.

## Development quality

Prioritize stable, finished features over a large number of incomplete features. Before merging to production:
- run syntax/static checks;
- test Guest and logged-in legacy flows;
- test subscription expiry and inheritance;
- test E8 ID creation/rotation/invalidation;
- test authorization failures and rate limits;
- review for XSS, injection, credential exposure, broken access control, and CORS mistakes;
- verify mobile Safari behavior and responsive navigation.

No codebase can be guaranteed to have literally zero bugs or vulnerabilities. Treat security as a continuous testing and review process rather than an absolute claim.
