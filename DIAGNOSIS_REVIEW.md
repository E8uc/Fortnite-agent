# Diagnosis / Classification / Tags review — 19 September 2026

Base: `main` at `f45bc26887c997764f6d60453d08c31591ead71b`.
Companion NovaSparx base: `3ed95eb752ceebb9482abe3d931fa42e9b71423d`.

## Actual defects

- Export JSON identity matching accepted substring names and searched nested property/reference graphs. A reference could win over the requested root, and conflicting root classes were not rejected.
- The existing test stub did not behave like production `NovaSparx.cleanPath`: production normalization erased generated-class object suffixes before diagnosis.
- Type substring matching confused components/settings/interfaces with asset types. A verified but unsupported class could fall back to a misleading filename.
- Current Dilly JSON uses a `jsonOutput` envelope. Eight captured live responses now cover that real shape, including multiple exports and subobjects.
- Real counterexamples: `SW_River_Secondary_Emitter` is `NiagaraEmitter`; `BP_Sky_Shere` and `MF_UnwwrapUVs` are redirectors; `DA_DeformerCollection_RecomputeNormals` is `MeshDeformerCollection`. None may inherit the filename's guessed type after class inspection.
- `S_`, `MS_`, `UI_`, generic folders and physical non-asset files such as `sw_KE.res` were unsafe type evidence.
- Blueprint references promoted assets to VISUAL/IMAGE/LOGIC tags without proving those features. Parser registration and an exporter `supports()` predicate were treated as per-asset readiness.
- NovaSparx used CLR class names instead of Unreal `ExportType`, and ReferenceIndex used class substring matching.

## Changes

`asset-diagnosis.js` supplies network-free exact class mapping, typed/generated paths, conservative heuristics, root identity checks and inspection precedence. It is shared by associations, UI classification and Worker classification. Python index scopes are checked against the same regression corpus. No auto-updater or version-number change is included.

`novasparx-associations.js` accepts only target root exports through known envelopes, rejects conflicting classes, retains unknown explicit classes, and uses exact Blueprint root evidence in relationship verification. Type tags remain separate from operational capability. Without per-asset readiness proof, visual/audio/UEFN capabilities remain unavailable and download formats remain JSON-only. Existing mesh inspection `renderablePreview: true` is gated again on browser parser availability. These are conservative UI gates, not completion of preview/export implementations.

`tools.js` reuses the shared classifier, accepts already-fetched inspection evidence, labels heuristic evidence, and gates buttons. `preview.js` only changes diagnosis/labels and prevents an unknown inspected class being replaced by the old path guess. `novasparx-core.js` accepts general typed Unreal paths. The Worker preserves typed path evidence separately from its sanitized transport path. `database-worker.js` and `build_database.py` align mesh/material search scopes. `index.html` and `app.js` update script dependencies/cache versions.

Tests: `novasparx-associations.selftest.mjs`, `diagnosis-corpus.json`, `diagnosis-fixtures/*`, `diagnosis.browser.test.mjs`; browser integration is added to `.github/workflows/fnaa-v1-check.yml`.

## Validation

- JavaScript syntax: all 35 JS/MJS files across both repositories pass locally.
- Python syntax: pass. Python index-scope parity: pass.
- JSON validation: all checked JSON files pass.
- Diagnosis: existing regressions plus 99 database paths, 22 cross-layer cases, root-identity/unknown-class/capability regressions, production canonicalization, actual Worker routing parity, and 8 captured Dilly responses pass.
- Browser memory and transport/security self-tests pass in both repositories; NovaSparx format self-test passes.
- `git diff --check`: pass.
- Local Chromium installation failed, but real Chromium integration passed in GitHub Actions on 20 September: 11 search cards, actual DOM tags and capability buttons. Run: https://github.com/E8uc/Fortnite-agent/actions/runs/35496127661 . This exercises production handlers with captured service responses, not a live deployment.
- Local SDK installation was blocked, but companion GitHub Actions successfully built the backend and reference-index tool, then passed format/memory/transport checks. Run: https://github.com/E8uc/NovaSparx/actions/runs/35496139793 .

## Limits and next-stage notes

Naming-only diagnoses remain heuristic; custom classes, redirectors, conflicting exports and unrecognized types return Asset/Unknown when explicit evidence exists. A path-only index cannot prove Unreal classes. The 99-path corpus tests naming behavior, not 99 independently inspected class truths. Captured service responses are explicitly version-unverified: they do not prove that the manually supplied gzip belongs to the live service's build.

`fortnite_assets.gz`, generated index artifacts and `FNAA_FORTNITE_VERSION: "42.00"` are unchanged. The existing database workflow can rebuild the changed scope rules after merge; this is not an automatic Fortnite-version updater.

The stage is not certified as live end-to-end complete until the deployed inspection-to-card path is verified; CI and browser integration have passed. Do not start Layer 8, 3D, Audio or UEFN implementation based solely on these tests.

## Current upstream references inspected

- CUE4Parse `master` `0e9ee8d7ed04d6048c7d92b592e98a4fd67cb586`; latest reported release `1.2.2.202609`. `UObject.ExportType` reads the Unreal class before falling back to CLR type: https://github.com/FabianFG/CUE4Parse/blob/0e9ee8d7ed04d6048c7d92b592e98a4fd67cb586/CUE4Parse/UE4/Assets/Exports/UObject.cs
- FModel `dev` `1adf4055f07a93543ea445f5e34b0de0b3bed5df`; latest reported release `aug-2026`. Current Dilly integration: https://github.com/4sval/FModel/blob/1adf4055f07a93543ea445f5e34b0de0b3bed5df/FModel/ViewModels/ApiEndpoints/DillyApiEndpoints.cs
- FortnitePorting current `main` `cabc462df93de62a10affe48b643ea08abf935a5`: `src/FortnitePorting/Services/ExportService.cs` uses actual UObject types and `ExportType`. Its export categories are not copied as root asset classifications (e.g. a Blueprint exporter can produce a mesh without changing the Blueprint's class).
- Supplied browser-only architecture report: used for the separation between metadata/ranges and device parsing; no next-stage implementation was started.

Review branches: https://github.com/E8uc/Fortnite-agent/pull/1 and https://github.com/E8uc/NovaSparx/pull/2 . No changes have been merged to main.
