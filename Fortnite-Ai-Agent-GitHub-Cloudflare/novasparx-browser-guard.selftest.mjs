import assert from "node:assert/strict";

Object.defineProperty(
  globalThis,
  "navigator",
  {
    configurable: true,
    value: {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit Mobile Safari",
      hardwareConcurrency: 4,
      storage: {
        async estimate() {
          return {
            quota:
              256 * 1024 * 1024,
            usage:
              16 * 1024 * 1024
          };
        }
      }
    }
  }
);

globalThis.window =
  globalThis;

globalThis.document = {
  visibilityState:
    "visible",

  addEventListener() {}
};

globalThis.addEventListener =
  () => {};

await import(
  "./novasparx-browser-guard.js?selftest=1"
);

const guard =
  globalThis.NovaSparxBrowserGuard;

assert.ok(
  guard,
  "browser guard should register"
);

const status =
  guard.status();

assert.equal(
  status.isIOS,
  true
);

assert.equal(
  status.packageLimitBytes,
  8 * 1024 * 1024
);

assert.equal(
  status.maxVertices,
  100_000
);

assert.equal(
  status.maxIndices,
  300_000
);

let cancelled = false;

const oversizedResponse = {
  headers: {
    get(name) {
      return name.toLowerCase() ===
        "content-length"
        ? String(
            9 * 1024 * 1024
          )
        : null;
    }
  },

  body: {
    cancel() {
      cancelled = true;
    }
  }
};

assert.throws(
  () =>
    guard.assertResponseBudget(
      oversizedResponse,
      "mesh"
    ),
  /exhaust|budget|stopped/i
);

assert.equal(
  cancelled,
  true
);

const safeManifest = {
  geometry: {
    positions:
      new Float32Array(
        3 * 1_000
      ),

    indices:
      new Uint32Array(
        3 * 1_000
      ),

    normals:
      new Float32Array(
        3 * 1_000
      ),

    tangents:
      new Float32Array(
        4 * 1_000
      ),

    uv0:
      new Float32Array(
        2 * 1_000
      )
  },

  metadata: {
    vertexCount:
      1_000
  }
};

assert.doesNotThrow(
  () =>
    guard.assertManifestBudget(
      safeManifest
    )
);

const tooManyVertices = {
  geometry: {
    positions:
      new Float32Array(
        3 * 100_001
      ),

    indices:
      new Uint32Array(
        3
      )
  },

  metadata: {
    vertexCount:
      100_001
  }
};

assert.throws(
  () =>
    guard.assertManifestBudget(
      tooManyVertices
    ),
  /lighter preview|budget/i
);

const policy =
  guard.renderPolicy(
    safeManifest
  );

assert.equal(
  policy.maxMaterials,
  4
);

assert.equal(
  policy.maxTextureLoads,
  4
);

assert.deepEqual(
  policy.textureModes,
  ["base"]
);

assert.equal(
  policy.mipmaps,
  false
);

assert.equal(
  await guard.canPersist(
    8 * 1024 * 1024
  ),
  true
);

console.log(
  "NovaSparx browser guard self-test passed."
);
