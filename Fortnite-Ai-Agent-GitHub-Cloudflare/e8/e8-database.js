(() => {
  "use strict";

  const CURRENT_VERSION = "42.00";
  const ROOT_URL = new URL("../", new URL("./", document.currentScript?.src || location.href));
  const ROOT = ROOT_URL.pathname.endsWith("/") ? ROOT_URL.pathname : `${ROOT_URL.pathname}/`;

  const DB_CONFIG = Object.freeze({
    manifest: `${ROOT}database/index-v1/manifest.json`,
    raw: `${ROOT}database/fortnite_assets.gz`,
    newRaw: `${ROOT}database/fortnite_assets_new.gz`,
    all: `${ROOT}database/index/all.txt.gz`,
    sm: `${ROOT}database/index/sm.txt.gz`,
    m: `${ROOT}database/index/m.txt.gz`,
    meshes: `${ROOT}database/index/meshes.txt.gz`,
    new: `${ROOT}database/index/new.txt.gz`,
    json: `${ROOT}database/index/json-references.txt.gz`,
    ids: `${ROOT}database/id.json`,
    devices: `${ROOT}database/devicemeshs.json`
  });

  let worker = null;
  let sequence = 0;
  const pending = new Map();

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(`${ROOT}database-worker.js?v=3`);
    worker.addEventListener("message", (event) => {
      const { id, ok, data, error } = event.data || {};
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (ok) request.resolve(data);
      else request.reject(new Error(error || "Database search failed."));
    });
    worker.addEventListener("error", (event) => {
      for (const request of pending.values()) request.reject(new Error(event.message || "Database worker crashed."));
      pending.clear();
      try { worker.terminate(); } catch {}
      worker = null;
    });
    return worker;
  }

  function search(scope, query) {
    const active = ensureWorker();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("Database search timed out."));
      }, 30_000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      active.postMessage({ id, type: "search", scope, query, config: DB_CONFIG });
    });
  }

  function looksLikeAssetQuestion(text) {
    return /^\s*@SearchForPath\b/i.test(String(text || "")) || /\b(path|asset path|mesh|staticmesh|static mesh|skeletalmesh|texture|material|icon|uasset|fortnite files|sm_|sk_|mi_|m_)\b|مسار|باث|ميش|تكستشر|ماتيريال|ملفات اللعبة|ملفات فورتنايت/i.test(String(text || ""));
  }

  function extractVersion(text) {
    return String(text || "").match(/\bv?(\d{1,2}\.\d{1,2})\b/i)?.[1] || "";
  }

  function scopeFor(text) {
    const lower = String(text || "").toLowerCase();
    if (/(^|[\s/._-])sm_/.test(lower) || /static\s*mesh/.test(lower)) return "sm";
    if (/(^|[\s/._-])(m_|mi_)/.test(lower) || /\bmaterial/.test(lower)) return "m";
    if (/(^|[\s/._-])sk_/.test(lower) || /\b(mesh|meshes|skeletalmesh)\b|ميش/.test(lower)) return "meshes";
    return "all";
  }

  function coreQuery(text) {
    const raw = String(text || "").trim().replace(/^@SearchForPath\b/i, " ").trim();
    const id = raw.match(/\b(?:SM|SK|M|MI|T|S|A|BP|NS)_[A-Za-z0-9_]+\b/i);
    if (id) return id[0];
    const quoted = raw.match(/["“”']([^"“”']{2,100})["“”']/);
    if (quoted) return quoted[1];
    const cleaned = raw
      .replace(/\bv?\d{1,2}\.\d{1,2}\b/gi, " ")
      .replace(/\b(give|me|the|a|an|for|of|please|find|search|what|whats|what's|is|path|asset|mesh|static|skeletal|fortnite|files?|current|latest|new|describe)\b/gi, " ")
      .replace(/(انطيني|اعطيني|اريد|أريد|شنو|شسم|مسار|باث|مال|ملفات|فورتنايت|الميش|ميش)/g, " ")
      .replace(/[^A-Za-z0-9_\u0600-\u06FF]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (cleaned || raw).slice(0, 100);
  }

  async function buildClientContext(userText) {
    if (!looksLikeAssetQuestion(userText)) return null;
    const query = coreQuery(userText);
    if (!query) return null;
    try {
      const result = await search(scopeFor(userText), query);
      const rows = Array.isArray(result?.results) ? result.results.slice(0, 12) : [];
      return {
        version: CURRENT_VERSION,
        requestedVersion: extractVersion(userText),
        query,
        results: rows.map((row) => ({
          path: String(row?.path || "").slice(0, 900),
          match: String(row?.match || "result").slice(0, 20),
          source: String(row?.source || "database").slice(0, 30)
        }))
      };
    } catch {
      return { version: CURRENT_VERSION, requestedVersion: extractVersion(userText), query, results: [] };
    }
  }

  window.E8Database = Object.freeze({ search, buildClientContext, root: ROOT, config: DB_CONFIG });
})();
