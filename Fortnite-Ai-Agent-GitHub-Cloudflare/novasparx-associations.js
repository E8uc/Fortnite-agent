(() => {
  "use strict";

  const EXPORT_BASE =
    "https://export-service-new.dillyapis.com/v1/export";

  const cache = new Map();
  const CACHE_LIMIT = 18;

  const REFERENCE_INDEX_BASE =
    "https://raw.githubusercontent.com/E8uc/NovaSparx/main/web/reference-index";

  let referenceManifestPromise = null;
  const referenceShardCache = new Map();
  const REFERENCE_SHARD_CACHE_LIMIT = 6;

  function clean(path) {
    return (
      window.NovaSparx
        ?.cleanPath?.(path) ||
      String(path || "")
        .trim()
        .replace(/\\/g, "/")
    );
  }

  function leaf(path) {
    const value =
      clean(path)
        .split("/")
        .pop() || "";

    return value
      .split(".")[0]
      .replace(/_C$/i, "");
  }

  function family(path, inspection = null) {
    const type =
      String(
        inspection?.assetType ||
        inspection?.AssetType ||
        ""
      ).toLowerCase();

    const name =
      leaf(path)
        .toLowerCase();

    if (
      type.includes("texture") ||
      /^(?:t_|tex_|texture_)/i.test(name)
    ) {
      return "texture";
    }

    if (
      type.includes("staticmesh") ||
      type.includes("skeletalmesh") ||
      /^(?:sm_|sk_)/i.test(name)
    ) {
      return "mesh";
    }

    if (
      type.includes("blueprint") ||
      type.includes("generatedclass") ||
      /^(?:bp_|bpc_)/i.test(name)
    ) {
      return "blueprint";
    }

    if (
      type.includes("material") ||
      /^(?:m_|mi_)/i.test(name)
    ) {
      return "material";
    }

    return "other";
  }

  function allowDirectImage(path) {
    const kind = family(path);

    // Mesh/Blueprint imagery must be relationship-aware. Raw Texture assets
    // also avoid the generic ForceImage route so a JSON image candidate cannot
    // silently promote them to another asset family; textures use the typed
    // NovaSparx texture decoder instead.
    return ![
      "mesh",
      "blueprint",
      "texture"
    ].includes(kind);
  }

  function allowTextureDecode(path) {
    return ![
      "mesh",
      "blueprint"
    ].includes(
      family(path)
    );
  }

  function normalizeReference(raw) {
    if (
      typeof raw !== "string"
    ) {
      return "";
    }

    let value =
      raw.trim();

    const wrapped =
      value.match(
        /(?:StaticMesh|SkeletalMesh|BlueprintGeneratedClass|Blueprint|Texture2D|Texture|MaterialInstanceConstant|Material|Object|SoftObjectPath)?'?((?:\/|FortniteGame\/)[^'"]+)'?/i
      );

    if (wrapped?.[1]) {
      value = wrapped[1];
    }

    value =
      value
        .replace(/^["']|["']$/g, "")
        .replace(/\.(?:uasset|uexp|ubulk)$/i, "");

    return clean(value);
  }

  function collectReferences(data) {
    const out = [];
    const seen = new Set();
    let visited = 0;

    const add = (
      raw,
      key = ""
    ) => {
      const path =
        normalizeReference(raw);

      if (
        !path ||
        !/^(?:\/|FortniteGame\/)/i
          .test(path)
      ) {
        return;
      }

      const id =
        path.toLowerCase();

      if (seen.has(id)) return;
      seen.add(id);

      out.push({
        path,
        key:
          String(key || "")
      });
    };

    const walk = (
      value,
      key = "",
      depth = 0
    ) => {
      if (
        value == null ||
        depth > 9 ||
        visited++ > 2400
      ) {
        return;
      }

      if (
        typeof value ===
        "string"
      ) {
        add(value, key);
        return;
      }

      if (Array.isArray(value)) {
        for (
          const item of
          value.slice(0, 120)
        ) {
          walk(
            item,
            key,
            depth + 1
          );
        }

        return;
      }

      if (
        typeof value ===
        "object"
      ) {
        let count = 0;

        for (
          const [
            childKey,
            child
          ] of
          Object.entries(value)
        ) {
          if (count++ >= 180) break;

          if (
            typeof child ===
            "string"
          ) {
            add(
              child,
              childKey
            );
          }

          walk(
            child,
            childKey,
            depth + 1
          );
        }
      }
    };

    walk(data);
    return out;
  }

  async function readJsonLimited(
    response,
    maxBytes
  ) {
    const length =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      length > 0 &&
      length > maxBytes
    ) {
      try {
        await response.body?.cancel();
      } catch {}

      throw new Error(
        "Blueprint JSON is too large for this device's safe preview budget."
      );
    }

    if (!response.body) {
      throw new Error(
        "Blueprint JSON response body is unavailable."
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let total = 0;
    let text = "";

    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) break;

      total +=
        value.byteLength;

      if (total > maxBytes) {
        try {
          await reader.cancel(
            "json-too-large"
          );
        } catch {}

        throw new Error(
          "Blueprint JSON exceeded this device's safe preview budget."
        );
      }

      text +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );
    }

    text +=
      decoder.decode();

    return JSON.parse(text);
  }

  async function fetchExportJson(
    path,
    signal
  ) {
    const guard =
      window.NovaSparxBrowserGuard
        ?.status?.() || {};

    const maxBytes =
      guard.isIOS
        ? 2 * 1024 * 1024
        : guard.isMobile
          ? 4 * 1024 * 1024
          : 8 * 1024 * 1024;

    const forms =
      [
        path,
        clean(path)
      ].filter(Boolean);

    for (
      const raw of
      [...new Set(forms)]
    ) {
      const url =
        new URL(
          EXPORT_BASE
        );

      url.searchParams.set(
        "Path",
        raw
      );

      url.searchParams.set(
        "Raw",
        "false"
      );

      try {
        const response =
          await fetch(
            url.toString(),
            {
              method: "GET",
              cache:
                "force-cache",
              signal:
                signal ||
                undefined,
              headers: {
                Accept:
                  "application/json,text/plain;q=0.8"
              }
            }
          );

        if (!response.ok) {
          try {
            await response.body?.cancel();
          } catch {}

          continue;
        }

        return await readJsonLimited(
          response,
          maxBytes
        );
      } catch (error) {
        if (
          error?.name ===
          "AbortError"
        ) {
          throw error;
        }
      }
    }

    return null;
  }

  function detectFamilyFromJson(
    data,
    fallbackPath = ""
  ) {
    let best =
      family(
        fallbackPath
      );

    let visited = 0;

    const rank = {
      other: 0,
      material: 1,
      texture: 2,
      mesh: 3,
      blueprint: 4
    };

    const consider = (
      value,
      key = ""
    ) => {
      const text =
        `${key} ${String(value || "")}`
          .toLowerCase();

      let candidate =
        "other";

      if (
        /blueprintgeneratedclass|\bblueprint\b|generatedclass/
          .test(text)
      ) {
        candidate =
          "blueprint";
      } else if (
        /skeletalmesh|staticmesh|\bmesh\b/
          .test(text)
      ) {
        candidate =
          "mesh";
      } else if (
        /texture2d|virtualtexture|\btexture\b/
          .test(text)
      ) {
        candidate =
          "texture";
      } else if (
        /materialinstance|materialinterface|\bmaterial\b/
          .test(text)
      ) {
        candidate =
          "material";
      }

      if (
        rank[candidate] >
        rank[best]
      ) {
        best =
          candidate;
      }
    };

    const walk = (
      value,
      key = "",
      depth = 0
    ) => {
      if (
        value == null ||
        depth > 6 ||
        visited++ > 900 ||
        best === "blueprint"
      ) {
        return;
      }

      if (
        typeof value ===
          "string" ||
        typeof value ===
          "number"
      ) {
        consider(
          value,
          key
        );
        return;
      }

      if (
        Array.isArray(value)
      ) {
        for (
          const item of
          value.slice(0, 60)
        ) {
          walk(
            item,
            key,
            depth + 1
          );
        }

        return;
      }

      if (
        typeof value ===
        "object"
      ) {
        for (
          const [
            childKey,
            child
          ] of
          Object.entries(value)
            .slice(0, 100)
        ) {
          if (
            /^(?:Type|Class|ClassName|ExportType|ObjectName|AssetClass)$/i
              .test(childKey)
          ) {
            consider(
              child,
              childKey
            );
          }

          walk(
            child,
            childKey,
            depth + 1
          );
        }
      }
    };

    walk(data);

    return best;
  }

  async function classify(
    path,
    options = {}
  ) {
    const pathFamily =
      family(path);

    // Strong Unreal naming prefixes are already deterministic enough to avoid
    // a JSON request. Ambiguous paths fall through to bounded export JSON.
    if (
      pathFamily !==
      "other"
    ) {
      return {
        family:
          pathFamily,
        source:
          "path-type"
      };
    }

    const data =
      await fetchExportJson(
        path,
        options.signal
      );

    if (!data) {
      return {
        family:
          "other",
        source:
          "unknown"
      };
    }

    return {
      family:
        detectFamilyFromJson(
          data,
          path
        ),
      source:
        "export-json",
      data
    };
  }

  function blueprintEvidence(data) {
    let found = false;
    let visited = 0;

    const walk = (
      value,
      depth = 0
    ) => {
      if (
        found ||
        value == null ||
        depth > 7 ||
        visited++ > 1200
      ) {
        return;
      }

      if (
        typeof value ===
        "string"
      ) {
        if (
          /BlueprintGeneratedClass|Blueprint/i
            .test(value)
        ) {
          found = true;
        }

        return;
      }

      if (Array.isArray(value)) {
        for (
          const item of
          value.slice(0, 80)
        ) {
          walk(
            item,
            depth + 1
          );
        }

        return;
      }

      if (
        typeof value ===
        "object"
      ) {
        for (
          const [
            key,
            child
          ] of
          Object.entries(value)
            .slice(0, 120)
        ) {
          if (
            /^(?:Type|Class|ObjectName|ExportType)$/i
              .test(key) &&
            /BlueprintGeneratedClass|Blueprint/i
              .test(
                String(child || "")
              )
          ) {
            found = true;
            return;
          }

          walk(
            child,
            depth + 1
          );
        }
      }
    };

    walk(data);
    return found;
  }

  function blueprintPreviewImages(
    data
  ) {
    const scored =
      collectReferences(
        data
      )
        .map(
          (item) => {
            const key =
              String(
                item.key || ""
              );

            const name =
              leaf(
                item.path
              );

            let score = 0;

            if (
              /(?:LargeIcon|SmallIcon|Icon|PreviewImage|PreviewTexture|Thumbnail|DisplayImage|GalleryArt|PrefabIcon|Portrait|KeyArt|FeaturedImage|Brush)/i
                .test(key)
            ) {
              score += 300;
            }

            if (
              /(?:icon|thumbnail|preview|display|gallery|prefab|portrait|keyart)/i
                .test(name)
            ) {
              score += 220;
            }

            if (
              /^(?:T_|Tex_|Texture_)/i
                .test(name)
            ) {
              score += 40;
            }

            if (
              /(?:normal|rough|roughness|spec|specular|metal|metallic|orm|mra|mask|opacity|ao|basecolor|albedo|diffuse|emissive|noise|detail|gradient|lut|lightmap)/i
                .test(name)
            ) {
              score -= 500;
            }

            return {
              path:
                item.path,
              score
            };
          }
        )
        .filter(
          (item) =>
            item.score > 0
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    return [
      ...new Set(
        scored.map(
          (item) =>
            item.path
        )
      )
    ].slice(0, 6);
  }

  function meshReferences(
    data
  ) {
    return collectReferences(data)
      .filter(
        (item) => {
          const name =
            leaf(item.path);

          const key =
            String(
              item.key || ""
            );

          return (
            /StaticMesh|SkeletalMesh|PreviewMesh|Mesh/i
              .test(key) ||
            /^(?:SM_|SK_)/i
              .test(name)
          );
        }
      )
      .map(
        (item) =>
          item.path
      );
  }

  function samePath(
    a,
    b
  ) {
    return (
      clean(a)
        .toLowerCase() ===
      clean(b)
        .toLowerCase()
    );
  }

  function stem(path) {
    return leaf(path)
      .replace(
        /^(?:SM_|SK_|BP_|BPC_)/i,
        ""
      )
      .toLowerCase();
  }

  function referenceShard(
    path
  ) {
    let hash =
      2166136261;

    for (
      const byte of
      new TextEncoder().encode(
        clean(path)
          .toLowerCase()
      )
    ) {
      hash ^= byte;
      hash =
        Math.imul(
          hash,
          16777619
        );
    }

    return (
      hash >>> 0
    )
      .toString(16)
      .slice(-2)
      .padStart(2, "0");
  }

  async function referenceManifest(
    signal
  ) {
    if (
      !referenceManifestPromise
    ) {
      referenceManifestPromise =
        fetch(
          `${REFERENCE_INDEX_BASE}/manifest.json`,
          {
            cache:
              "force-cache",
            signal:
              signal ||
              undefined
          }
        )
          .then(
            async (response) => {
              if (!response.ok) {
                throw new Error(
                  `NovaSparx reference manifest returned HTTP ${response.status}.`
                );
              }

              return response.json();
            }
          )
          .catch(
            () => null
          );
    }

    return referenceManifestPromise;
  }

  async function decodeReferenceShard(
    response
  ) {
    const length =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    const guard =
      window.NovaSparxBrowserGuard
        ?.status?.() || {};

    const maxBytes =
      guard.isMobile
        ? 768 * 1024
        : 2 * 1024 * 1024;

    if (
      length > 0 &&
      length > maxBytes
    ) {
      try {
        await response.body?.cancel();
      } catch {}

      throw new Error(
        "NovaSparx reference shard exceeded the browser safety budget."
      );
    }

    const bytes =
      new Uint8Array(
        await response.arrayBuffer()
      );

    if (
      bytes.byteLength >
      maxBytes
    ) {
      throw new Error(
        "NovaSparx reference shard exceeded the browser safety budget."
      );
    }

    const isGzip =
      bytes.length >= 2 &&
      bytes[0] === 0x1f &&
      bytes[1] === 0x8b;

    if (isGzip) {
      if (
        typeof DecompressionStream !==
        "function"
      ) {
        throw new Error(
          "This browser cannot decode the NovaSparx reference shard."
        );
      }

      const stream =
        new Blob(
          [bytes]
        )
          .stream()
          .pipeThrough(
            new DecompressionStream(
              "gzip"
            )
          );

      return new Response(
        stream
      ).json();
    }

    return JSON.parse(
      new TextDecoder()
        .decode(bytes)
    );
  }

  async function staticBlueprintCandidates(
    meshPath,
    options = {}
  ) {
    const manifest =
      await referenceManifest(
        options.signal
      );

    if (
      manifest?.schema !==
        "novasparx.asset-references.v1" ||
      manifest?.available ===
        false
    ) {
      return [];
    }

    const shard =
      referenceShard(
        meshPath
      );

    let payload =
      referenceShardCache.get(
        shard
      );

    if (!payload) {
      const response =
        await fetch(
          `${REFERENCE_INDEX_BASE}/mesh/${shard}.json.gz`,
          {
            cache:
              "force-cache",
            signal:
              options.signal ||
              undefined
          }
        );

      if (!response.ok) {
        return [];
      }

      payload =
        await decodeReferenceShard(
          response
        );

      referenceShardCache.set(
        shard,
        payload
      );

      while (
        referenceShardCache.size >
        REFERENCE_SHARD_CACHE_LIMIT
      ) {
        const oldest =
          referenceShardCache
            .keys()
            .next()
            .value;

        referenceShardCache.delete(
          oldest
        );
      }
    }

    const items =
      payload?.items &&
      typeof payload.items ===
        "object"
        ? payload.items
        : {};

    const key =
      clean(meshPath)
        .toLowerCase();

    const values =
      Array.isArray(
        items[key]
      )
        ? items[key]
        : [];

    return values
      .map(
        (value) =>
          clean(value)
      )
      .filter(Boolean);
  }

  function candidateScore(
    target,
    candidate
  ) {
    const targetStem =
      stem(target);

    const candidateStem =
      stem(candidate);

    let score = 0;

    if (
      targetStem ===
      candidateStem
    ) {
      score += 600;
    }

    if (
      candidateStem.includes(
        targetStem
      ) ||
      targetStem.includes(
        candidateStem
      )
    ) {
      score += 240;
    }

    const targetDir =
      clean(target)
        .split("/")
        .slice(0, -1)
        .join("/")
        .toLowerCase();

    const candidateDir =
      clean(candidate)
        .split("/")
        .slice(0, -1)
        .join("/")
        .toLowerCase();

    if (
      targetDir ===
      candidateDir
    ) {
      score += 280;
    } else {
      const targetParts =
        targetDir.split("/");

      const candidateParts =
        candidateDir.split("/");

      let common = 0;

      while (
        common <
          Math.min(
            targetParts.length,
            candidateParts.length
          ) &&
        targetParts[common] ===
          candidateParts[common]
      ) {
        common++;
      }

      score +=
        common * 12;
    }

    if (
      /^BP_/i.test(
        leaf(candidate)
      )
    ) {
      score += 120;
    }

    return score;
  }

  async function blueprintCandidates(
    meshPath
  ) {
    const search =
      window.FortniteAgent
        ?.searchDatabase;

    if (
      typeof search !==
      "function"
    ) {
      return [];
    }

    const query =
      stem(meshPath)
        .replace(
          /[_-]+/g,
          " "
        )
        .trim();

    if (
      query.length < 3
    ) {
      return [];
    }

    const result =
      await search(
        "all",
        query
      );

    return (
      Array.isArray(
        result?.results
      )
        ? result.results
        : []
    )
      .map(
        (item) =>
          String(
            item?.path ||
            ""
          ).trim()
      )
      .filter(Boolean)
      .filter(
        (path) => {
          const name =
            leaf(path);

          return (
            /^BP_/i.test(name) ||
            /\/Blueprints?\//i
              .test(
                clean(path)
              )
          );
        }
      )
      .sort(
        (a, b) =>
          candidateScore(
            meshPath,
            b
          ) -
          candidateScore(
            meshPath,
            a
          )
      );
  }

  async function findBlueprintForMesh(
    meshPath,
    options = {}
  ) {
    const target =
      clean(meshPath);

    const guard =
      window.NovaSparxBrowserGuard
        ?.status?.() || {};

    const maxCandidates =
      guard.isIOS
        ? 3
        : guard.isMobile
          ? 4
          : 7;

    // AssetRegistry referencers are the strongest zero-runtime-RAM layer:
    // GitHub Actions builds them offline, then the browser fetches one tiny
    // shard. JSON verification is attempted for the leading candidate when
    // available, but the registry edge itself is already exact on-disk evidence.
    try {
      const indexed =
        (
          await staticBlueprintCandidates(
            target,
            options
          )
        )
          .sort(
            (a, b) =>
              candidateScore(
                target,
                b
              ) -
              candidateScore(
                target,
                a
              )
          )
          .slice(
            0,
            maxCandidates
          );

      for (
        const candidate of
        indexed.slice(
          0,
          guard.isMobile
            ? 1
            : 2
        )
      ) {
        try {
          const data =
            await fetchExportJson(
              candidate,
              options.signal
            );

          if (
            data &&
            blueprintEvidence(data)
          ) {
            const refs =
              collectReferences(
                data
              );

            const exact =
              refs.some(
                (item) =>
                  samePath(
                    item.path,
                    target
                  )
              );

            if (exact) {
              const previewImages =
                blueprintPreviewImages(
                  data
                );

              return {
                state:
                  "ready",
                sourceFamily:
                  "mesh",
                blueprintPath:
                  clean(candidate),
                visualPath:
                  target,
                previewImagePath:
                  previewImages[0] ||
                  "",
                relation:
                  "asset-registry+json-referencer",
                evidence:
                  "AssetRegistry and Blueprint export JSON both verify the Blueprint -> mesh relationship."
              };
            }
          }
        } catch (error) {
          if (
            error?.name ===
            "AbortError"
          ) {
            throw error;
          }
        }
      }

      if (indexed.length) {
        return {
          state:
            "ready",
          sourceFamily:
            "mesh",
          blueprintPath:
            clean(indexed[0]),
          visualPath:
            target,
          relation:
            "asset-registry-referencer",
          evidence:
            "Fortnite AssetRegistry reports this Blueprint package as an on-disk referencer of the requested mesh."
        };
      }
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        throw error;
      }
    }

    // Runtime fallback: shortlist likely Blueprint packages from FNAA's sharded
    // path database, then accept one only when its export JSON contains an
    // exact reference to the requested mesh.
    const candidates =
      (
        await blueprintCandidates(
          target
        )
      ).slice(
        0,
        maxCandidates
      );

    for (const candidate of candidates) {
      const data =
        await fetchExportJson(
          candidate,
          options.signal
        );

      if (
        !data ||
        !blueprintEvidence(data)
      ) {
        continue;
      }

      const refs =
        collectReferences(
          data
        );

      const exact =
        refs.some(
          (item) =>
            samePath(
              item.path,
              target
            )
        );

      if (!exact) {
        continue;
      }

      const meshes =
        meshReferences(
          data
        );

      const previewImages =
        blueprintPreviewImages(
          data
        );

      return {
        state:
          "ready",
        sourceFamily:
          "mesh",
        blueprintPath:
          clean(candidate),
        visualPath:
          meshes.find(
            (path) =>
              samePath(
                path,
                target
              )
          ) ||
          meshes[0] ||
          target,
        previewImagePath:
          previewImages[0] ||
          "",
        relation:
          "verified-blueprint-referencer",
        evidence:
          "Blueprint export JSON contains an exact reference to the requested mesh."
      };
    }

    return null;
  }

  async function visualFromBlueprint(
    blueprintPath,
    options = {}
  ) {
    const data =
      await fetchExportJson(
        blueprintPath,
        options.signal
      );

    if (
      !data ||
      !blueprintEvidence(data)
    ) {
      return null;
    }

    const meshes =
      meshReferences(
        data
      );

    const previewImages =
      blueprintPreviewImages(
        data
      );

    if (
      !meshes.length &&
      !previewImages.length
    ) {
      return null;
    }

    return {
      state:
        "ready",
      sourceFamily:
        "blueprint",
      blueprintPath:
        clean(blueprintPath),
      visualPath:
        meshes[0] ||
        "",
      previewImagePath:
        previewImages[0] ||
        "",
      relation:
        meshes.length
          ? "verified-blueprint-mesh"
          : "verified-blueprint-visual",
      evidence:
        meshes.length
          ? "Blueprint export JSON contains a verified mesh reference."
          : "Blueprint export JSON contains a verified preview/icon texture reference."
    };
  }

  async function resolveVisual(
    path,
    inspection = null,
    options = {}
  ) {
    const sourceFamily =
      family(
        path,
        inspection
      );

    const cacheKey =
      [
        sourceFamily,
        clean(path)
          .toLowerCase()
      ].join("|");

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    let result = null;

    if (
      sourceFamily ===
      "texture"
    ) {
      result = {
        state:
          "typed",
        sourceFamily,
        relation:
          "texture-direct-only",
        visualPath:
          clean(path),
        blueprintPath:
          "",
        evidence:
          "Texture assets are not promoted to mesh/Blueprint previews."
      };
    } else if (
      sourceFamily ===
      "mesh"
    ) {
      result =
        await findBlueprintForMesh(
          path,
          options
        );
    } else if (
      sourceFamily ===
      "blueprint"
    ) {
      result =
        await visualFromBlueprint(
          path,
          options
        );
    }

    cache.set(
      cacheKey,
      result
    );

    while (
      cache.size >
      CACHE_LIMIT
    ) {
      const oldest =
        cache.keys()
          .next()
          .value;

      cache.delete(oldest);
    }

    return result;
  }

  window.NovaSparxAssociations =
    Object.freeze({
      version:
        "1.3.0",
      family,
      classify,
      allowDirectImage,
      allowTextureDecode,
      resolveVisual,
      findBlueprintForMesh,
      visualFromBlueprint
    });
})();
