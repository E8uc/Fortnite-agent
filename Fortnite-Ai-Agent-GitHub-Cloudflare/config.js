(() => {
  "use strict";

  const API =
    "https://fortnite-ai-agent-api.a39328122.workers.dev";

  const SITE =
    "https://e8uc.github.io/Fortnite-agent/";

  const BASE =
    "/Fortnite-agent/";

  const database = Object.freeze({
    manifest:
      `${BASE}database/index-v1/manifest.json`,

    raw:
      `${BASE}database/fortnite_assets.gz`,

    newRaw:
      `${BASE}database/fortnite_assets_new.gz`,

    all:
      `${BASE}database/index/all.txt.gz`,

    sm:
      `${BASE}database/index/sm.txt.gz`,

    m:
      `${BASE}database/index/m.txt.gz`,

    meshes:
      `${BASE}database/index/meshes.txt.gz`,

    new:
      `${BASE}database/index/new.txt.gz`,

    json:
      `${BASE}database/index/json-references.txt.gz`,

    ids:
      `${BASE}database/id.json`,

    devices:
      `${BASE}database/devicemeshs.json`
  });

  const routes = Object.freeze({
    chat: "/Main/Chat",
    paths: "/ManualSearch/Paths",
    assets: "/ManualSearch/Assets",
    settings: "/Settings"
  });

  window.FNAA_CONFIG = Object.freeze({
    version: "1.0.2",
    fortniteVersion: "42.00",
    apiEndpoint: API,
    siteUrl: SITE,
    siteBasePath: BASE,
    routes,
    database
  });

  window.FORTNITE_AI_API_ENDPOINT =
    API;

  window.FORTNITE_AI_DB =
    database;

  // The reliability layer is loaded explicitly at the end of index.html.
  // Keeping script order deterministic prevents Safari from racing it against
  // auth.js, tools.js and app.js.
})();
