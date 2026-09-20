# NovaSparx / Fortnite AI Agent

**NovaSparx** is a browser-first Fortnite asset research and tooling platform built for creators, modders, researchers, UEFN users, and anyone who works with Fortnite assets.

The long-term goal is simple:

> **Search a Fortnite asset path, understand what it is, and use the right tool for it — directly from the browser.**

No Fortnite installation is required for the end user. No FModel installation is required. No local game files are required.

Website: https://e8uc.github.io/Fortnite-agent/

---

## Project Status

**Overall roadmap progress: ~62%**

This number is a project-roadmap estimate, not an automated code-coverage metric.

| Feature | Status |
| --- | --- |
| Diagnosis / Tags | ✅ Complete — Available |
| View Image / Layer 8 | 🛠️ In Progress — Currently Unavailable |
| View 3D Model | ⏳ Disabled — Coming Soon |
| Listen / Audio | ⏳ Disabled — Coming Soon |
| Download GLB / PNG / JSON | ⏳ Disabled — Coming Soon |
| Export / Convert to UEFN | ⏳ Disabled — Coming Soon |
| Asset Database Self-Update | ⏳ Planned |
| Final Site Testing & Polishing | ⏳ Final Stage |

**Current development stage:** View Image / Layer 8.

---

## What Is Available Today

### Asset Path Search

Search a large Fortnite asset-path database directly from the website.

The asset system can:

- search Fortnite paths
- normalize and format asset paths
- identify supported asset families
- show reliable type tags
- avoid promoting unrelated nested references into the root asset type
- return a conservative **Asset / Unknown** result when the type cannot be proven safely

### Diagnosis / Classification / Tags

The diagnosis system is the first completed major NovaSparx stage.

It distinguishes common Unreal / Fortnite asset families such as:

- Static Mesh
- Skeletal Mesh
- Blueprint
- Texture
- Material
- Audio
- Animation
- VFX
- Cosmetic
- Data assets
- Unknown / unsupported assets

The project intentionally prefers **Unknown** over confidently showing the wrong type.

Type evidence is kept separate from feature availability. For example, identifying a Static Mesh does not automatically mean that View 3D is enabled.

### IDs

Search Fortnite IDs and discover Creative-related or internal data.

### Devices

Browse Fortnite Creative devices and inspect available internal settings and properties.

### Path Modifier

Format, normalize, and convert supported Fortnite asset-path forms.

### Cosmetics

Browse Fortnite cosmetics and related public data, including supported images, cosmetic IDs, and internal asset paths.

### AI Assistant

A Fortnite-focused AI assistant for topics such as:

- Fortnite asset paths
- FModel workflows
- UEFN
- Unreal Engine assets
- Fortnite research

Most non-AI tools are intended to remain usable without requiring an account.

---

## NovaSparx

NovaSparx is the asset-processing side of the project.

The original project depended more heavily on hosted processing. That architecture did not scale well for large Fortnite assets, especially when many users were active at the same time.

The project is now moving toward a **browser-first architecture**:

```text
Fortnite asset path
        ↓
Asset diagnosis
        ↓
Live metadata / asset location
        ↓
Required data only
        ↓
User's browser / device
        ↓
Decode / parse / render
        ↓
Image / 3D / audio / export
```

The goal is for heavy work to scale with the users themselves:

```text
1 user   → 1 device doing the user's heavy work
100 users → 100 devices doing their own heavy work
```

Instead of one small hosted server attempting to process every user's assets.

---

## Browser-First Architecture

The current target architecture is:

### Browser / Device

Responsible for the heavy work whenever possible:

- WebAssembly
- Web Workers
- asset parsing
- decoding
- rendering
- conversion
- memory-controlled processing

### Cloudflare / Edge

Used for lightweight work such as:

- metadata
- routing
- cache
- current build information
- bounded byte-range relay when direct access is unavailable

### GitHub Actions

Used for offline work such as:

- generated indexes
- regression tests
- compatibility tests
- future asset-database updates

### Hosted NovaSparx Service

The hosted NovaSparx service is now intentionally **metadata-only** for normal operation.

Heavy asset parsing and decoding routes are rejected instead of silently moving expensive work back to the server.

This keeps Back4App from becoming the backbone of NovaSparx.

---

## Browser / WebAssembly Progress

NovaSparx has moved beyond a compile-only WebAssembly experiment.

The project has now verified that:

- CUE4Parse can execute inside a real Chromium browser through WebAssembly
- managed code runs successfully in the browser runtime
- basic archive reading works
- zlib compatibility has been exercised in the browser
- a bounded managed AES compatibility path has been tested
- a real Fortnite `.utoc` header has been fetched from the current public manifest
- the same real header bytes have been parsed inside Chromium
- the browser result has been compared against desktop CUE4Parse expectations
- the live container encryption-key GUID can be matched against the current AES key list

This is important foundation work, but it does **not** yet mean full Fortnite asset extraction is complete.

Full encrypted chunk processing, complete Texture extraction, and final pixels are still part of the active View Image / Layer 8 work.

---

## View Image / Layer 8

**Status: In Progress**

Layer 8 is the View Image pipeline.

The success condition is not simply receiving JSON, finding a thumbnail, or showing any image related to the asset.

A successful Layer 8 result must ultimately turn a real Fortnite asset path into the correct image representation for that asset.

The intended user-facing flow is:

```text
Asset Path
   ↓
Correct asset identity
   ↓
Correct image relationship
   ↓
Real asset data
   ↓
Decode
   ↓
Pixels
   ↓
View Image
```

The project does not treat unrelated thumbnails, arbitrary nested textures, placeholders, or promotional art as proof that View Image works.

Until that path is proven reliably, View Image remains unavailable.

---

## View 3D Model

**Status: Coming Soon**

View 3D will be enabled only after a real end-to-end browser path is proven.

The target includes:

- Static Mesh
- Skeletal Mesh
- geometry
- sections
- materials
- textures
- interactive browser rendering

Existing UI or parser contracts are not considered proof of a working feature by themselves.

---

## Listen / Audio

**Status: Coming Soon**

The planned audio stage will identify supported audio assets and produce real browser playback from the correct Fortnite asset data.

The button will remain unavailable until this works end to end.

---

## Downloads

**Status: Coming Soon**

Planned output formats include:

- GLB
- PNG
- JSON

Downloads will only be exposed when the requested format can be generated reliably for the selected asset.

---

## Export / Convert to UEFN

**Status: Coming Soon**

The final export stage is intended to make supported Fortnite asset data easier to move into creator workflows such as UEFN.

This stage comes after View Image, View 3D Model, and Listen / Audio are proven.

---

## Asset Database

FNAA currently uses large compressed Fortnite asset-path databases, including:

- `fortnite_assets.gz`
- `fortnite_assets_new.gz`

The current source database is still maintained manually.

A future milestone is a **self-updating asset database pipeline** that can:

```text
Detect current Fortnite build
        ↓
Read current asset metadata
        ↓
Generate full asset-path list
        ↓
Compare against previous build
        ↓
Generate new-assets list
        ↓
Rebuild search indexes
        ↓
Validate
        ↓
Publish
```

The project keeps live build/AES information separate from the manually supplied database version so that a newer live AES response is never treated as proof of the database's source build.

---

## Reliability Rules

NovaSparx follows a few strict rules:

1. **A button should exist only when the feature really works.**
2. **A real output matters more than the presence of code.**
3. **Unknown is better than a confident wrong classification.**
4. **A nested reference must not change the identity of the root asset.**
5. **Failures should be visible instead of hidden behind unrelated fallback content.**
6. **Heavy work should stay on the user's device whenever practical.**
7. **Back4App must not become the heavy-processing backbone.**
8. **New work must pass syntax, build, browser, memory, and security checks before it is treated as complete.**

---

## Browser Support

NovaSparx targets modern browsers with WebAssembly and Web Worker support.

### Recommended Today

- Google Chrome — current modern release
- Microsoft Edge — current modern release

### Still Being Validated

- Firefox
- Safari

Chromium is currently the browser family with the strongest real-runtime validation in this project.

Mobile support remains an important target, but memory-heavy features will use stricter limits on phones and tablets.

---

## Development Journey

The project has gone through several major stages.

### 1. Web Tool Foundation

FNAA began as a browser-based collection of Fortnite tools: search, IDs, devices, path utilities, cosmetics, and an AI assistant.

### 2. NovaSparx Preview System

NovaSparx was introduced to handle Fortnite asset inspection, previews, references, meshes, textures, and future exports.

### 3. Reliability & Safety Work

The project added:

- request cancellation
- latest-request-wins behavior
- memory limits
- browser transport restrictions
- bounded responses
- safer caching
- reduced error leakage
- CI checks
- regression tests

### 4. Diagnosis / Tags

Asset diagnosis was rebuilt around stronger evidence and real regression data.

This stage is now complete.

### 5. Browser-First Migration

The architecture shifted away from server-heavy processing.

Real Chromium + WebAssembly execution is now verified, hosted heavy processing is blocked, and real Fortnite IoStore metadata has been read in the browser.

### 6. Current Stage — Layer 8

The current focus is proving the complete View Image path from real Fortnite data to correct visible pixels.

### 7. Next Stages

After Layer 8:

```text
View 3D Model
        ↓
Listen / Audio
        ↓
Download
        ↓
Export / Convert to UEFN
        ↓
Asset Database Self-Update
        ↓
Final Testing & Polishing
```

---

## Testing Philosophy

A feature is not considered complete because:

- a button exists
- a function exists
- a request returns HTTP 200
- JSON is returned
- a parser API is registered
- a thumbnail appears

A feature is considered complete only when its real user flow works with real Fortnite assets.

For example:

```text
Real Path
→ Resolve
→ Fetch required data
→ Decode / parse
→ Produce correct output
→ Show it successfully in the browser
```

---

## Project Repositories

### Fortnite AI Agent / FNAA

Frontend, website, search, tools, diagnosis, and user experience.

https://github.com/E8uc/Fortnite-agent

### NovaSparx

Browser-first Fortnite asset-processing research and runtime.

https://github.com/E8uc/NovaSparx

---

## References & Inspiration

NovaSparx studies proven Fortnite / Unreal tooling and adapts useful ideas for a browser-first environment.

Important technical references include:

- CUE4Parse
- FModel
- FortnitePorting
- Dilly / CUE4Parse ecosystem

These projects and services are references or external sources where applicable. NovaSparx is its own project and is not presented as an official component of those projects.

---

## Disclaimer

NovaSparx / Fortnite AI Agent is an independent project and is **not affiliated with, endorsed by, or sponsored by Epic Games**.

Fortnite, Unreal Engine, UEFN, and related names are trademarks or property of their respective owners.

---

## Developer

Developed by **YT @e8uc**

NovaSparx is still under active development.

**Current public roadmap status: ~62% complete.**

**Actual NovaSparx coming soon.**
