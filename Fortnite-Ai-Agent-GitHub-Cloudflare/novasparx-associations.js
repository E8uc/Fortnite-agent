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
    const inspectedKind =
      kindFromType(
        inspectionType(
          inspection
        )
      );

    if (
      inspectedKind ===
        "staticmesh" ||
      inspectedKind ===
        "skeletalmesh"
    ) {
      return "mesh";
    }

    if (
      inspectedKind.startsWith(
        "blueprint"
      )
    ) {
      return "blueprint";
    }

    if (
      inspectedKind !==
        "other"
    ) {
      return inspectedKind;
    }

    const detectedKind =
      pathKind(path);

    if (
      detectedKind ===
        "staticmesh" ||
      detectedKind ===
        "skeletalmesh"
    ) {
      return "mesh";
    }

    if (
      detectedKind.startsWith(
        "blueprint"
      )
    ) {
      return "blueprint";
    }

    return detectedKind;
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

  function detectFamilyFromJson(
    data,
    fallbackPath = ""
  ) {
    const evidence =
      jsonTypeEvidence(
        data,
        fallbackPath
      );

    const kind =
      kindFromType(
        evidence?.value ||
        ""
      );

    if (
      kind === "staticmesh" ||
      kind === "skeletalmesh"
    ) {
      return "mesh";
    }

    if (
      kind.startsWith(
        "blueprint"
      )
    ) {
      return "blueprint";
    }

    if (kind !== "other") {
      return kind;
    }

    return family(
      fallbackPath
    );
  }

  function normalizedTypeValue(
    value
  ) {
    return String(
      value || ""
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
  }

  function inspectionType(
    inspection
  ) {
    if (
      !inspection ||
      typeof inspection !==
        "object"
    ) {
      return "";
    }

    for (
      const key of [
        "assetType",
        "AssetType",
        "type",
        "Type",
        "objectType",
        "ObjectType",
        "className",
        "ClassName",
        "exportType",
        "ExportType",
        "assetClass",
        "AssetClass"
      ]
    ) {
      const value =
        inspection[key];

      if (
        typeof value ===
          "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }

    return "";
  }

  function jsonTypeEvidence(
    data,
    requestedPath = ""
  ) {
    const candidates = [];
    let visited = 0;

    const targetName =
      leaf(
        requestedPath
      ).toLowerCase();

    const targetPath =
      clean(
        requestedPath
      )
        .toLowerCase()
        .replace(
          /_c$/,
          ""
        );

    const typeKeys =
      /^(?:ClassName|AssetClass|ExportType|Type|Class|ObjectType)$/i;

    const identityKeys =
      /^(?:Name|ObjectName|PathName|ObjectPath|FullName|AssetName|PackageName)$/i;

    const identityScore =
      (value) => {
        if (
          typeof value !==
            "string" ||
          !value.trim() ||
          !targetName
        ) {
          return 0;
        }

        const raw =
          value
            .trim()
            .toLowerCase()
            .replace(
              /_c(?=['"]?$)/,
              ""
            );

        let score = 0;

        if (
          targetPath &&
          raw.includes(
            targetPath
          )
        ) {
          score += 260;
        }

        const normalizedName =
          raw
            .split("/")
            .pop()
            ?.split(".")
            .pop()
            ?.replace(
              /^.*'/,
              ""
            )
            ?.replace(
              /['"]+$/g,
              ""
            ) || "";

        if (
          normalizedName ===
          targetName
        ) {
          score += 220;
        } else if (
          raw.includes(
            targetName
          )
        ) {
          score += 90;
        }

        return score;
      };

    const inspectObject =
      (
        value,
        depth = 0
      ) => {
        if (
          !value ||
          typeof value !==
            "object" ||
          Array.isArray(value)
        ) {
          return;
        }

        const entries =
          Object.entries(
            value
          )
            .slice(0, 160);

        let objectIdentity = 0;

        for (
          const [
            key,
            child
          ] of entries
        ) {
          if (
            identityKeys.test(
              key
            )
          ) {
            objectIdentity =
              Math.max(
                objectIdentity,
                identityScore(
                  child
                )
              );
          }
        }

        for (
          const [
            key,
            child
          ] of entries
        ) {
          if (
            depth > 0 &&
            objectIdentity === 0
          ) {
            continue;
          }

          if (
            !typeKeys.test(
              key
            ) ||
            typeof child !==
              "string" ||
            !child.trim()
          ) {
            continue;
          }

          const kind =
            kindFromType(
              child
            );

          if (kind === "other") {
            continue;
          }

          const keyWeight =
            /^(?:ClassName|AssetClass|ExportType)$/i
              .test(key)
              ? 120
              : /^(?:Type|ObjectType)$/i
                  .test(key)
                ? 105
                : 90;

          const depthWeight =
            Math.max(
              0,
              110 -
              depth * 28
            );

          candidates.push({
            value:
              child.trim(),
            key:
              String(key),
            score:
              keyWeight +
              depthWeight +
              objectIdentity,
            depth,
            kind
          });
        }
      };

    const walk =
      (
        value,
        depth = 0
      ) => {
        if (
          value == null ||
          depth > 7 ||
          visited++ > 1500
        ) {
          return;
        }

        if (
          Array.isArray(value)
        ) {
          for (
            const item of
            value.slice(0, 100)
          ) {
            // Export services commonly return an array of root exports.
            // Do not penalize those entries as if they were nested references.
            walk(
              item,
              depth === 0
                ? 0
                : depth + 1
            );
          }

          return;
        }

        if (
          typeof value !==
            "object"
        ) {
          return;
        }

        inspectObject(
          value,
          depth
        );

        for (
          const child of
          Object.values(value)
            .slice(0, 160)
        ) {
          if (
            child &&
            typeof child ===
              "object"
          ) {
            walk(
              child,
              depth + 1
            );
          }
        }
      };

    walk(data);

    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        a.depth - b.depth
    );

    return (
      candidates[0] ||
      null
    );
  }

  function typedPathKind(
    path
  ) {
    const raw =
      String(path || "")
        .trim();

    const match =
      raw.match(
        /^([A-Za-z0-9_]+)\s*['"]/
      );

    if (!match?.[1]) {
      return "other";
    }

    return kindFromType(
      match[1]
    );
  }

  function diagnosticPathText(
    path
  ) {
    const raw =
      clean(path);

    const wrapped =
      String(raw || "")
        .match(
          /^[A-Za-z0-9_]+\s*['"]((?:\/|FortniteGame\/)[^'"]+)['"]?$/i
        );

    return wrapped?.[1] ||
      raw;
  }

  function objectPathLooksGeneratedClass(
    path
  ) {
    const value =
      diagnosticPathText(
        path
      );

    const tail =
      String(value || "")
        .split("/")
        .pop() ||
      "";

    const dot =
      tail.indexOf(".");

    if (dot <= 0) {
      return false;
    }

    const packageName =
      tail.slice(
        0,
        dot
      );

    const objectName =
      tail.slice(
        dot + 1
      );

    return (
      packageName.length > 0 &&
      objectName.toLowerCase() ===
        `${packageName.toLowerCase()}_c`
    );
  }

  function pathKind(
    path
  ) {
    const typedKind =
      typedPathKind(
        path
      );

    if (typedKind !== "other") {
      return typedKind;
    }

    const normalizedPath =
      diagnosticPathText(
        path
      );

    const name =
      leaf(
        normalizedPath
      )
        .toLowerCase();

    const full =
      String(
        normalizedPath ||
        ""
      )
        .toLowerCase();

    if (
      /^(?:sk_|skm_)/
        .test(name) ||
      /\/skeletalmesh(?:es)?\//
        .test(full)
    ) {
      return "skeletalmesh";
    }

    if (
      /^sm_/
        .test(name) ||
      /\/staticmesh(?:es)?\//
        .test(full)
    ) {
      return "staticmesh";
    }

    if (
      /^(?:t_|tex_|texture_|icon_|ui_)/
        .test(name)
    ) {
      return "texture";
    }

    if (
      /^(?:mi_|m_|mf_)/
        .test(name)
    ) {
      return "material";
    }

    if (
      objectPathLooksGeneratedClass(
        normalizedPath
      ) ||
      /^(?:bp_|bpc_|abp_|wbp_)/
        .test(name)
    ) {
      return "blueprint";
    }

    // S_ is intentionally not treated as sound. It is ambiguous in Fortnite.
    // Strong sound prefixes, folders, or explicit Unreal class metadata are
    // required before we advertise AUDIO.
    if (
      /^(?:sw_|usw_|soundwave_|sc_|soundcue_|ms_|metasound_|audio_|sfx_|music_)/
        .test(name) ||
      /\/(?:sounds?|audio|music)\//
        .test(full)
    ) {
      return "audio";
    }

    if (
      /^(?:anim_|am_|montage_)/
        .test(name) ||
      /\/(?:animations?|anims?|montages?)\//
        .test(full)
    ) {
      return "animation";
    }

    if (
      /^(?:ns_|ne_|ps_|vfx_|fx_)/
        .test(name)
    ) {
      return "vfx";
    }

    if (
      /^(?:cid_|bid_|eid_|pickaxe_)/
        .test(name)
    ) {
      return "cosmetic";
    }

    if (
      /^(?:da_|dt_|data_)/
        .test(name)
    ) {
      return "data";
    }

    return "other";
  }

  function diagnosePath(
    path
  ) {
    const typedKind =
      typedPathKind(
        path
      );

    const generatedClass =
      objectPathLooksGeneratedClass(
        diagnosticPathText(
          path
        )
      );

    const kind =
      pathKind(path);

    const resultFamily =
      kind === "staticmesh" ||
      kind === "skeletalmesh"
        ? "mesh"
        : kind.startsWith(
            "blueprint"
          )
          ? "blueprint"
          : kind;

    const source =
      typedKind !== "other"
        ? "typed-path"
        : generatedClass &&
          kind === "blueprint"
          ? "generated-class-path"
          : kind === "other"
            ? "unknown"
            : "path-fallback";

    return {
      family:
        resultFamily,
      kind,
      source,
      confidence:
        source === "typed-path"
          ? 98
          : source ===
              "generated-class-path"
            ? 88
            : source ===
                "path-fallback"
              ? 55
              : 0
    };
  }

  function kindFromType(
    rawType
  ) {
    const type =
      normalizedTypeValue(
        rawType
      );

    if (!type) {
      return "other";
    }

    if (
      type.includes(
        "skeletalmesh"
      )
    ) {
      return "skeletalmesh";
    }

    if (
      type.includes(
        "staticmesh"
      )
    ) {
      return "staticmesh";
    }

    if (
      type.includes(
        "texture"
      ) ||
      type.includes(
        "slatebrush"
      )
    ) {
      return "texture";
    }

    if (
      type.includes(
        "material"
      )
    ) {
      return "material";
    }

    if (
      type.includes(
        "blueprint"
      ) ||
      type.includes(
        "generatedclass"
      )
    ) {
      return "blueprint";
    }

    if (
      type.includes(
        "soundwave"
      ) ||
      type.includes(
        "soundcue"
      ) ||
      type.includes(
        "metasound"
      ) ||
      type.includes(
        "audio"
      )
    ) {
      return "audio";
    }

    if (
      type.includes(
        "animsequence"
      ) ||
      type.includes(
        "animmontage"
      ) ||
      type.includes(
        "animation"
      )
    ) {
      return "animation";
    }

    if (
      type.includes(
        "niagara"
      ) ||
      type.includes(
        "particlesystem"
      )
    ) {
      return "vfx";
    }

    if (
      type.includes(
        "cosmetic"
      ) ||
      type.includes(
        "athenacharacteritemdefinition"
      ) ||
      type.includes(
        "athenabackpackitemdefinition"
      ) ||
      type.includes(
        "athenapickaxeitemdefinition"
      ) ||
      type.includes(
        "athenadanceitemdefinition"
      ) ||
      type.includes(
        "athenaitemdefinition"
      )
    ) {
      return "cosmetic";
    }

    if (
      type.includes(
        "dataasset"
      ) ||
      type.includes(
        "datatable"
      )
    ) {
      return "data";
    }

    return "other";
  }

  function capabilityProfile(
    kind,
    data = null
  ) {
    let resolvedKind =
      kind || "other";

    if (
      resolvedKind ===
        "blueprint" &&
      data
    ) {
      const meshes =
        meshReferences(data);

      const images =
        blueprintPreviewImages(
          data
        );

      if (meshes.length) {
        resolvedKind =
          "blueprint-visual";
      } else if (
        images.length
      ) {
        resolvedKind =
          "blueprint-image";
      } else {
        resolvedKind =
          "blueprint-logic";
      }
    }

    const view3dKinds =
      new Set([
        "staticmesh",
        "skeletalmesh",
        "blueprint-visual"
      ]);

    const imageKinds =
      new Set([
        "texture",
        "cosmetic",
        "blueprint-image",
        "material"
      ]);

    // Keep this list aligned with NovaSparxExporter.supports().
    // Future-capable asset families must not appear as export-ready before
    // their complete data (for example bones/weights) is actually preserved.
    const uefnKinds =
      new Set([
        "staticmesh",
        "blueprint-visual",
        "texture"
      ]);

    const formatMap = {
      texture:
        ["png", "json"],
      cosmetic:
        ["png", "json"],
      material:
        ["json"],
      staticmesh:
        ["glb", "obj", "nsmesh", "json"],
      skeletalmesh:
        ["nsmesh", "json"],
      "blueprint-visual":
        ["glb", "obj", "nsmesh", "json"],
      "blueprint-image":
        ["png", "json"],
      "blueprint-logic":
        ["json"],
      audio:
        ["json"],
      animation:
        ["json"],
      vfx:
        ["json"],
      data:
        ["json"],
      other:
        ["json"]
    };

    const tagMap = {
      texture:
        ["TEXTURE"],
      cosmetic:
        ["COSMETIC"],
      material:
        ["MATERIAL"],
      staticmesh:
        ["STATIC MESH", "MESH"],
      skeletalmesh:
        ["SKELETAL MESH", "MESH"],
      "blueprint-visual":
        ["BLUEPRINT", "VISUAL"],
      "blueprint-image":
        ["BLUEPRINT", "IMAGE"],
      "blueprint-logic":
        ["BLUEPRINT", "LOGIC"],
      audio:
        ["AUDIO", "SOUND"],
      animation:
        ["ANIMATION"],
      vfx:
        ["VFX"],
      data:
        ["DATA"],
      other:
        ["ASSET"]
    };

    const canViewImage =
      imageKinds.has(
        resolvedKind
      );

    const canView3D =
      view3dKinds.has(
        resolvedKind
      );

    return {
      kind:
        resolvedKind,
      canPreview:
        true,
      previewMode:
        canView3D
          ? "3d"
          : canViewImage
            ? "image"
            : "universal",
      canViewImage,
      canView3D,
      canDownload:
        true,
      canExportUEFN:
        uefnKinds.has(
          resolvedKind
        ),
      downloadFormats:
        (
          formatMap[
            resolvedKind
          ] ||
          formatMap.other
        ).slice(),
      tags:
        (
          tagMap[
            resolvedKind
          ] ||
          tagMap.other
        ).slice()
    };
  }

  async function classify(
    path,
    options = {}
  ) {
    const inspection =
      options.inspection ||
      null;

    let data =
      options.data ||
      null;

    const inspectedType =
      inspectionType(
        inspection
      );

    const inspectedKind =
      kindFromType(
        inspectedType
      );

    const typedKind =
      typedPathKind(
        path
      );

    const fallbackKind =
      typedKind !== "other"
        ? typedKind
        : pathKind(path);

    const pathFamily =
      family(
        path,
        inspection
      );

    const explicitTypedKind =
      typedKind !== "other";

    const needsJson =
      !data &&
      (
        inspectedKind ===
          "blueprint" ||
        typedKind ===
          "blueprint" ||
        (
          options.verifyKnown ===
            true &&
          inspectedKind ===
            "other" &&
          !explicitTypedKind
        ) ||
        (
          !inspectedType &&
          !explicitTypedKind &&
          (
            fallbackKind ===
              "other" ||
            fallbackKind ===
              "blueprint"
          )
        )
      );

    if (needsJson) {
      data =
        await fetchExportJson(
          path,
          options.signal
        );
    }

    const jsonEvidence =
      data
        ? jsonTypeEvidence(
            data,
            path
          )
        : null;

    const jsonKind =
      kindFromType(
        jsonEvidence?.value ||
        ""
      );

    let kind =
      inspectedKind !==
        "other"
        ? inspectedKind
        : jsonKind !==
            "other"
          ? jsonKind
          : fallbackKind;

    if (
      kind === "other"
    ) {
      const detectedFamily =
        data
          ? detectFamilyFromJson(
              data,
              path
            )
          : pathFamily;

      if (
        detectedFamily ===
          "mesh"
      ) {
        kind =
          /^sk_/i.test(
            leaf(path)
          )
            ? "skeletalmesh"
            : "staticmesh";
      } else if (
        detectedFamily !==
          "other"
      ) {
        kind =
          detectedFamily;
      }
    }

    const capabilities =
      capabilityProfile(
        kind,
        data
      );

    const source =
      inspectedKind !==
        "other"
        ? "inspection"
        : jsonKind !==
            "other"
          ? "export-json"
          : fallbackKind !==
              "other"
            ? "path-fallback"
            : "unknown";

    const confidence =
      source ===
        "inspection"
        ? 100
        : source ===
            "export-json"
          ? Math.max(
              80,
              Math.min(
                95,
                Number(
                  jsonEvidence
                    ?.score ||
                  90
                )
              )
            )
          : source ===
              "path-fallback"
            ? 40
            : 0;

    const resultFamily =
      capabilities.kind
        .startsWith(
          "blueprint"
        )
        ? "blueprint"
        : [
            "staticmesh",
            "skeletalmesh"
          ].includes(
            capabilities.kind
          )
          ? "mesh"
          : capabilities.kind ===
              "cosmetic"
            ? "other"
            : capabilities.kind;

    return {
      family:
        resultFamily,
      kind:
        capabilities.kind,
      source,
      confidence,
      capabilities,
      tags:
        capabilities.tags,
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
        data
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
                !blueprintEvidence(data)
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
        "1.8.2",
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
