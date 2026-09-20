(() => {
  "use strict";

  const EXPORT_BASE =
    "https://export-service-new.dillyapis.com/v1/export";

  const cache = new Map();
  const CACHE_LIMIT = 18;

  const REFERENCE_INDEX_BASE =
    "https://raw.githubusercontent.com/E8uc/NovaSparx/main/web/reference-index";

  let referenceManifestPromise = null;
  let referenceManifestFailureAt = 0;

  const REFERENCE_MANIFEST_RETRY_MS =
    15_000;

  const REFERENCE_MANIFEST_MAX_BYTES =
    256 * 1024;

  const referenceShardCache = new Map();
  const REFERENCE_SHARD_CACHE_LIMIT = 6;

  function deadlineSignal(
    parentSignal,
    timeoutMs
  ) {
    const controller =
      new AbortController();

    let timedOut = false;

    const relayAbort = () => {
      try {
        controller.abort(
          parentSignal?.reason ||
          "parent-abort"
        );
      } catch {}
    };

    if (parentSignal?.aborted) {
      relayAbort();
    } else {
      parentSignal?.addEventListener?.(
        "abort",
        relayAbort,
        { once: true }
      );
    }

    const timer =
      setTimeout(
        () => {
          timedOut = true;

          try {
            controller.abort(
              "novasparx-deadline"
            );
          } catch {}
        },
        timeoutMs
      );

    return {
      signal:
        controller.signal,

      timedOut:
        () =>
          timedOut,

      cleanup() {
        clearTimeout(
          timer
        );

        parentSignal
          ?.removeEventListener?.(
            "abort",
            relayAbort
          );
      }
    };
  }

  async function settleWithin(
    promise,
    timeoutMs,
    fallback = null
  ) {
    let timer = null;

    try {
      return await Promise.race([
        promise,
        new Promise(
          (resolve) => {
            timer =
              setTimeout(
                () =>
                  resolve(
                    fallback
                  ),
                timeoutMs
              );
          }
        )
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer
        );
      }
    }
  }

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
    return window.FNAAAssetDiagnosis.diagnosePath(path, inspection).family;
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

      const deadline =
        deadlineSignal(
          signal,
          guard.isMobile
            ? 3_500
            : 5_000
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
                deadline.signal,
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
          signal?.aborted
        ) {
          throw error;
        }

        // A slow JSON candidate is not allowed to hold the whole preview open.
      } finally {
        deadline.cleanup();
      }
    }

    return null;
  }

  const { jsonTypeEvidence, diagnosePath, kindFromType } = window.FNAAAssetDiagnosis;

  function capabilityProfile(kind, data = null, inspection = null) {
    const resolvedKind = String(kind || "other").split("-")[0];
    const tagMap = {
      staticmesh: ["STATIC MESH", "MESH"], skeletalmesh: ["SKELETAL MESH", "MESH"],
      blueprint: ["BLUEPRINT"], texture: ["TEXTURE"], material: ["MATERIAL"],
      audio: ["AUDIO", "SOUND"], animation: ["ANIMATION"], vfx: ["VFX"],
      cosmetic: ["COSMETIC"], data: ["DATA"], other: ["ASSET"]
    };
    // Type eligibility is not operational readiness. References alone do not
    // prove a Blueprint is renderable, and parser registration proves no asset.
    const eligibleView3D = ["staticmesh", "skeletalmesh"].includes(resolvedKind);
    const eligibleViewImage = resolvedKind === "texture";
    const canView3D = eligibleView3D && inspection?.facts?.renderablePreview === true;
    return {
      kind: resolvedKind,
      eligibleView3D, eligibleViewImage,
      canPreview: canView3D, canView3D, canViewImage: false,
      previewMode: canView3D ? "3d" : "none",
      canListen: false, canDownload: true, canExportUEFN: false,
      downloadFormats: ["json"],
      tags: (tagMap[resolvedKind] || tagMap.other).slice()
    };
  }

  async function classify(path, options = {}) {
    const diagnosis = window.FNAAAssetDiagnosis;
    const inspected = diagnosis.inspectionEvidence(options.inspection, path);
    const local = diagnosePath(path);
    let data = options.data ?? null;
    if (!data && !inspected && !["typed-path"].includes(local.source) &&
        (options.verifyKnown === true || local.kind === "other")) {
      data = await fetchExportJson(path, options.signal);
    }
    const evidence = data ? jsonTypeEvidence(data, path) : null;
    const result = inspected
      ? { ...inspected, assetType: inspected.value }
      : evidence
        ? { kind: evidence.kind, source: "export-json", confidence: evidence.conflict ? 0 : 99,
            assetType: evidence.value }
        : local;
    const capabilities = capabilityProfile(result.kind, evidence?.object, inspected ? options.inspection : null);
    return { ...result, family: diagnosis.familyOf(result.kind), capabilities,
      tags: capabilities.tags, data };
  }

  function blueprintEvidence(data, requestedPath) {
    return jsonTypeEvidence(data, requestedPath)?.kind === "blueprint";
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

  function previewTextureReferences(
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
              /(?:LargeIcon|SmallIcon|Icon|PreviewImage|PreviewTexture|Thumbnail|DisplayImage|GalleryArt|Portrait|KeyArt|FeaturedImage|Brush)/i
                .test(key)
            ) {
              score += 420;
            }

            if (
              /(?:BaseColor|Diffuse|Albedo|Emissive|Texture|Sprite|Thumbnail|Preview|Icon|Image)/i
                .test(key)
            ) {
              score += 230;
            }

            if (
              /^(?:T_|Tex_|Texture_)/i
                .test(name)
            ) {
              score += 80;
            }

            if (
              /(?:icon|thumbnail|preview|display|portrait|keyart|basecolor|diffuse|albedo|emissive)/i
                .test(name)
            ) {
              score += 140;
            }

            if (
              /(?:normal|rough|roughness|spec|specular|metal|metallic|orm|mra|mask|opacity|ao|noise|detail|gradient|lut|lightmap)/i
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
    ].slice(
      0,
      8
    );
  }

  function materialReferences(
    data
  ) {
    return collectReferences(
      data
    )
      .filter(
        (item) => {
          const key =
            String(
              item.key || ""
            );

          const name =
            leaf(
              item.path
            );

          return (
            /Material|MaterialInterface|MaterialInstance/i
              .test(key) ||
            /^(?:MI_|M_)/i
              .test(name)
          );
        }
      )
      .map(
        (item) =>
          item.path
      );
  }

  async function referencedMaterialTextures(
    data,
    signal
  ) {
    const materialPaths =
      [
        ...new Set(
          materialReferences(
            data
          )
        )
      ].slice(
        0,
        2
      );

    if (!materialPaths.length) {
      return [];
    }

    const settled =
      await Promise.allSettled(
        materialPaths.map(
          (materialPath) =>
            fetchExportJson(
              materialPath,
              signal
            )
        )
      );

    const textures = [];

    for (
      const item of
      settled
    ) {
      if (
        signal?.aborted
      ) {
        const error =
          new Error(
            "NovaSparx preview request was cancelled."
          );

        error.name =
          "AbortError";

        throw error;
      }

      if (
        item.status !==
          "fulfilled" ||
        !item.value
      ) {
        continue;
      }

      for (
        const texturePath of
        previewTextureReferences(
          item.value
        )
      ) {
        if (
          !textures.includes(
            texturePath
          )
        ) {
          textures.push(
            texturePath
          );
        }

        if (
          textures.length >= 6
        ) {
          return textures;
        }
      }
    }

    return textures;
  }

  async function publicPreview(
    path,
    options = {}
  ) {
    const data =
      options.data ||
      await fetchExportJson(
        path,
        options.signal
      );

    if (!data) {
      return null;
    }

    const evidence =
      jsonTypeEvidence(
        data,
        path
      );

    const type =
      String(
        evidence?.value ||
        ""
      );

    const kind =
      kindFromType(
        type
      );

    const directImages =
      previewTextureReferences(
        data
      );

    let referencedImages = [];

    if (
      directImages.length <
        2
    ) {
      try {
        referencedImages =
          await referencedMaterialTextures(
            data,
            options.signal
          );
      } catch (error) {
        if (
          options.signal
            ?.aborted ||
          error?.name ===
            "AbortError"
        ) {
          throw error;
        }
      }
    }

    return {
      state:
        "ready",
      source:
        "dilly-json",
      type,
      kind,
      previewImagePaths:
        [
          ...new Set(
            [
              ...directImages,
              ...referencedImages
            ]
          )
        ].slice(
          0,
          8
        ),
      meshPaths:
        meshReferences(
          data
        ),
      data
    };
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
      referenceManifestPromise
    ) {
      return referenceManifestPromise;
    }

    if (
      referenceManifestFailureAt &&
      Date.now() -
        referenceManifestFailureAt <
        REFERENCE_MANIFEST_RETRY_MS
    ) {
      return null;
    }

    const deadline =
      deadlineSignal(
        signal,
        1_500
      );

    const request =
      (async () => {
        try {
          const response =
            await fetch(
              `${REFERENCE_INDEX_BASE}/manifest.json`,
              {
                cache:
                  "force-cache",
                signal:
                  deadline.signal
              }
            );

          if (!response.ok) {
            try {
              await response.body
                ?.cancel();
            } catch {}

            throw new Error(
              `NovaSparx reference manifest returned HTTP ${response.status}.`
            );
          }

          const bytes =
            await readResponseBytesBounded(
              response,
              REFERENCE_MANIFEST_MAX_BYTES,
              deadline.signal
            );

          const parsed =
            JSON.parse(
              new TextDecoder()
                .decode(bytes)
            );

          if (
            !parsed ||
            typeof parsed !==
              "object" ||
            Array.isArray(parsed)
          ) {
            throw new Error(
              "NovaSparx reference manifest is invalid."
            );
          }

          referenceManifestFailureAt =
            0;

          return parsed;
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }

          referenceManifestFailureAt =
            Date.now();

          return null;
        } finally {
          deadline.cleanup();
        }
      })();

    referenceManifestPromise =
      request;

    try {
      const result =
        await request;

      if (
        !result &&
        referenceManifestPromise ===
          request
      ) {
        referenceManifestPromise =
          null;
      }

      return result;
    } catch (error) {
      if (
        referenceManifestPromise ===
          request
      ) {
        referenceManifestPromise =
          null;
      }

      throw error;
    }
  }

  async function readStreamBytesBounded(
    stream,
    maxBytes,
    signal = null
  ) {
    if (
      !stream ||
      typeof stream.getReader !==
        "function"
    ) {
      throw new Error(
        "NovaSparx reference stream is unavailable."
      );
    }

    const reader =
      stream.getReader();

    const chunks = [];
    let total = 0;

    try {
      while (true) {
        if (signal?.aborted) {
          const error =
            new Error(
              "NovaSparx reference request was cancelled."
            );

          error.name =
            "AbortError";

          throw error;
        }

        const {
          done,
          value
        } =
          await reader.read();

        if (done) break;

        if (!value?.byteLength) {
          continue;
        }

        total +=
          value.byteLength;

        if (
          total >
          maxBytes
        ) {
          try {
            await reader.cancel(
              "reference-shard-too-large"
            );
          } catch {}

          throw new Error(
            "NovaSparx reference shard exceeded the browser safety budget."
          );
        }

        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    const bytes =
      new Uint8Array(total);

    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(
        chunk,
        offset
      );

      offset +=
        chunk.byteLength;
    }

    return bytes;
  }

  async function readResponseBytesBounded(
    response,
    maxBytes,
    signal = null
  ) {
    const declared =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      declared > 0 &&
      declared > maxBytes
    ) {
      try {
        await response.body
          ?.cancel();
      } catch {}

      throw new Error(
        "NovaSparx reference shard exceeded the browser safety budget."
      );
    }

    if (
      response.body &&
      typeof response.body
        .getReader ===
        "function"
    ) {
      return readStreamBytesBounded(
        response.body,
        maxBytes,
        signal
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

    return bytes;
  }

  async function decodeReferenceShard(
    response,
    signal = null
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
      await readResponseBytesBounded(
        response,
        maxBytes,
        signal
      );

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

      const expandedBytes =
        await readStreamBytesBounded(
          stream,
          guard.isMobile
            ? 4 * 1024 * 1024
            : 12 * 1024 * 1024,
          signal
        );

      return JSON.parse(
        new TextDecoder()
          .decode(
            expandedBytes
          )
      );
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
      const deadline =
        deadlineSignal(
          options.signal,
          2_000
        );

      try {
        const response =
          await fetch(
            `${REFERENCE_INDEX_BASE}/mesh/${shard}.json.gz`,
            {
              cache:
                "force-cache",
              signal:
                deadline.signal
            }
          );

        if (!response.ok) {
          return [];
        }

        payload =
          await decodeReferenceShard(
            response,
            deadline.signal
          );
      } catch (error) {
        if (
          options.signal
            ?.aborted
        ) {
          throw error;
        }

        return [];
      } finally {
        deadline.cleanup();
      }

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

    const guard =
      window.NovaSparxBrowserGuard
        ?.status?.() || {};

    const result =
      await settleWithin(
        search(
          "all",
          query
        ),
        guard.isMobile
          ? 2_500
          : 4_000,
        null
      );

    if (!result) {
      return [];
    }

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
      guard.isMobile
        ? 2
        : 4;

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
            blueprintEvidence(data, candidate)
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

    const checks =
      await Promise.all(
        candidates.map(
          async (candidate) => {
            try {
              const data =
                await fetchExportJson(
                  candidate,
                  options.signal
                );

              if (
                !data ||
                !blueprintEvidence(data, candidate)
              ) {
                return null;
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
            } catch (error) {
              if (
                options.signal
                  ?.aborted
              ) {
                throw error;
              }

              return null;
            }
          }
        )
      );

    return (
      checks.find(
        Boolean
      ) ||
      null
    );
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
      !blueprintEvidence(data, blueprintPath)
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
        "1.8.3",
      family,
      diagnosePath,
      classify,
      capabilityProfile,
      allowDirectImage,
      allowTextureDecode,
      publicPreview,
      resolveVisual,
      findBlueprintForMesh,
      visualFromBlueprint
    });
})();
