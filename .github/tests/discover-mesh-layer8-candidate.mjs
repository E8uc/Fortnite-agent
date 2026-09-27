import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";

const site = path.resolve(
  process.argv[2] ||
  "Fortnite-Ai-Agent-GitHub-Cloudflare"
);

const database = path.join(
  site,
  "database",
  "fortnite_assets.gz"
);

const DILLY =
  "https://export-service-new.dillyapis.com/v1/export";

const MAX_JSON_BYTES =
  12 * 1024 * 1024;

const MAX_CANDIDATES =
  24;

function virtualPath(physical) {
  const normalized =
    String(physical || "")
      .replace(/\\/g, "/");

  if (
    normalized.startsWith(
      "FortniteGame/Content/"
    )
  ) {
    return (
      "/Game/" +
      normalized
        .slice(
          "FortniteGame/Content/"
            .length
        )
        .replace(
          /\.uasset$/i,
          ""
        )
    );
  }

  return "";
}

function cleanObjectPath(value) {
  let result =
    String(value || "")
      .trim();

  const typed =
    result.match(
      /^[A-Za-z0-9_]+['"]([^'"]+)['"]$/
    );

  if (typed?.[1]) {
    result =
      typed[1];
  }

  const slash =
    result.lastIndexOf("/");

  const dot =
    result.lastIndexOf(".");

  if (
    dot >
    slash
  ) {
    result =
      result.slice(
        0,
        dot
      );
  }

  return result;
}

function scorePath(value) {
  const path =
    value.toLowerCase();

  let score = 0;

  for (const [needle, weight] of [
    ["/weapons/", 40],
    ["/props/", 35],
    ["/items/", 30],
    ["/athena/", 25],
    ["/environments/", 20],
    ["/vehicles/", 20],
    ["/brcosmetics/", 15],
    ["/gameplay/", 10]
  ]) {
    if (path.includes(needle)) {
      score += weight;
    }
  }

  if (
    path.includes(
      "/editor"
    ) ||
    path.includes(
      "/test"
    ) ||
    path.includes(
      "/debug"
    )
  ) {
    score -= 40;
  }

  return score;
}

async function fetchJson(
  assetPath,
  label
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(
          "candidate-timeout"
        ),
      12_000
    );

  try {
    const url =
      new URL(
        DILLY
      );

    url.searchParams.set(
      "Path",
      assetPath
    );

    url.searchParams.set(
      "Raw",
      "false"
    );

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,
          headers: {
            accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      return null;
    }

    const declared =
      Number(
        response.headers
          .get(
            "content-length"
          ) ||
        0
      );

    if (
      declared >
      MAX_JSON_BYTES
    ) {
      return null;
    }

    const text =
      await response.text();

    if (
      Buffer.byteLength(
        text
      ) >
      MAX_JSON_BYTES
    ) {
      return null;
    }

    try {
      return JSON.parse(
        text
      );
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(
      timeout
    );
  }
}

function collectTypedPaths(
  value,
  typePattern
) {
  const found =
    new Set();

  const walk =
    node => {
      if (
        typeof node ===
        "string"
      ) {
        const regex =
          new RegExp(
            `(?:${typePattern})['"]([^'"]+)['"]`,
            "gi"
          );

        for (
          const match of
          node.matchAll(
            regex
          )
        ) {
          const clean =
            cleanObjectPath(
              match[1]
            );

          if (clean) {
            found.add(
              clean
            );
          }
        }

        return;
      }

      if (
        Array.isArray(
          node
        )
      ) {
        for (
          const item of
          node
        ) {
          walk(
            item
          );
        }

        return;
      }

      if (
        !node ||
        typeof node !==
          "object"
      ) {
        return;
      }

      const objectName =
        String(
          node.ObjectName ||
          node.Name ||
          ""
        );

      const objectPath =
        String(
          node.ObjectPath ||
          node.Path ||
          ""
        );

      if (
        objectPath &&
        new RegExp(
          typePattern,
          "i"
        ).test(
          objectName
        )
      ) {
        found.add(
          cleanObjectPath(
            objectPath
          )
        );
      }

      for (
        const child of
        Object.values(
          node
        )
      ) {
        walk(
          child
        );
      }
    };

  walk(
    value
  );

  return [
    ...found
  ];
}

if (
  !fs.existsSync(
    database
  )
) {
  throw new Error(
    "Fortnite asset database is unavailable."
  );
}

const candidates = [];

const input =
  fs.createReadStream(
    database
  )
    .pipe(
      createGunzip()
    );

const lines =
  readline.createInterface({
    input,
    crlfDelay:
      Infinity
  });

for await (
  const line of
  lines
) {
  const physical =
    line.trim();

  if (
    !/^FortniteGame\/Content\/.+\/SM_[^/]+\.uasset$/i
      .test(
        physical
      )
  ) {
    continue;
  }

  const unreal =
    virtualPath(
      physical
    );

  if (!unreal) {
    continue;
  }

  candidates.push({
    physical,
    unreal,
    score:
      scorePath(
        physical
      )
  });

  if (
    candidates.length >=
    500
  ) {
    break;
  }
}

candidates.sort(
  (a, b) =>
    b.score -
    a.score ||
    a.unreal.localeCompare(
      b.unreal
    )
);

let attempts = 0;
let winner = null;

for (
  const candidate of
  candidates.slice(
    0,
    MAX_CANDIDATES
  )
) {
  attempts++;

  const root =
    await fetchJson(
      candidate.unreal,
      "StaticMesh"
    );

  if (!root) {
    console.log(
      "MESH_DISCOVERY_ROOT_MISS",
      candidate.unreal
    );
    continue;
  }

  const materials =
    collectTypedPaths(
      root,
      "Material(?:InstanceConstant|InstanceDynamic|Interface)?"
    )
      .filter(
        value =>
          value.startsWith(
            "/"
          )
      )
      .slice(
        0,
        6
      );

  console.log(
    "MESH_DISCOVERY_ROOT",
    JSON.stringify({
      mesh:
        candidate.unreal,
      materials
    })
  );

  for (
    const material of
    materials
  ) {
    const materialJson =
      await fetchJson(
        material,
        "Material"
      );

    if (!materialJson) {
      console.log(
        "MESH_DISCOVERY_MATERIAL_MISS",
        JSON.stringify({
          mesh:
            candidate.unreal,
          material
        })
      );
      continue;
    }

    const textures =
      collectTypedPaths(
        materialJson,
        "Texture(?:2D|Cube|RenderTarget2D)?"
      )
        .filter(
          value =>
            value.startsWith(
              "/"
            )
        );

    console.log(
      "MESH_DISCOVERY_MATERIAL",
      JSON.stringify({
        mesh:
          candidate.unreal,
        material,
        textures:
          textures.slice(
            0,
            8
          )
      })
    );

    if (
      textures.length
    ) {
      winner = {
        mesh:
          candidate.unreal,
        physical:
          candidate.physical,
        material,
        texture:
          textures[0],
        textureCandidates:
          textures.slice(
            0,
            8
          ),
        attempts
      };

      break;
    }
  }

  if (winner) {
    break;
  }
}

if (!winner) {
  throw new Error(
    `No verified Fortnite StaticMesh → Material → Texture candidate was found in ${attempts} bounded attempts.`
  );
}

fs.writeFileSync(
  "mesh-layer8-candidate.json",
  JSON.stringify(
    winner,
    null,
    2
  )
);

console.log(
  "FNAA_MESH_LAYER8_CANDIDATE",
  JSON.stringify(
    winner
  )
);
