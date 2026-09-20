/* Shared, network-free diagnosis for browser UI and Cloudflare routing.
 * Never canonicalize away the object name before reading type evidence.
 */
(() => {
  "use strict";
  const classes = {
    staticmesh: ["StaticMesh"],
    skeletalmesh: ["SkeletalMesh"],
    texture: ["Texture", "Texture2D", "TextureCube", "Texture2DArray", "TextureCubeArray", "VolumeTexture", "TextureRenderTarget2D", "TextureRenderTargetCube", "TextureRenderTarget2DArray", "TextureRenderTargetVolume", "VirtualTexture2D", "LightMapTexture2D", "ShadowMapTexture2D"],
    material: ["Material", "MaterialInterface", "MaterialInstance", "MaterialInstanceConstant", "MaterialInstanceDynamic", "MaterialFunction", "MaterialFunctionInterface", "MaterialFunctionInstance", "MaterialFunctionMaterialLayer", "MaterialFunctionMaterialLayerBlend", "MaterialParameterCollection"],
    blueprint: ["Blueprint", "BlueprintGeneratedClass", "WidgetBlueprint", "WidgetBlueprintGeneratedClass", "AnimBlueprint", "AnimBlueprintGeneratedClass", "ControlRigBlueprint", "ControlRigBlueprintGeneratedClass"],
    audio: ["SoundWave", "SoundCue", "SoundWaveProcedural", "MetaSound", "MetaSoundSource", "MetaSoundPatch"],
    animation: ["AnimSequence", "AnimSequenceBase", "AnimMontage", "AnimComposite", "AnimationAsset", "BlendSpace", "BlendSpace1D", "AimOffsetBlendSpace", "AimOffsetBlendSpace1D", "PoseAsset", "LevelSequence"],
    vfx: ["NiagaraSystem", "NiagaraEmitter", "ParticleSystem"],
    cosmetic: ["AthenaCharacterItemDefinition", "AthenaBackpackItemDefinition", "AthenaPickaxeItemDefinition", "AthenaDanceItemDefinition", "AthenaItemDefinition", "AthenaGliderItemDefinition", "AthenaItemWrapDefinition", "AthenaSkyDiveContrailItemDefinition"],
    data: ["DataAsset", "PrimaryDataAsset", "DataTable", "CurveTable", "CompositeDataTable", "CompositeCurveTable"]
  };
  const classKinds = new Map(Object.entries(classes).flatMap(([kind, names]) =>
    names.flatMap(name => [[name.toLowerCase(), kind], [`u${name.toLowerCase()}`, kind]])));

  function typeName(value) {
    const raw = String(value || "").trim();
    const wrapped = raw.match(/^(?:Class|ScriptClass|UScriptClass)['"]([^'"]+)['"]$/i);
    return (wrapped?.[1] || raw).split(/[/.]/).pop() || "";
  }
  function kindFromType(value) {
    // Components, factories, parameter collections and arbitrary names containing
    // 'StaticMesh'/'Audio' are not the asset types they mention.
    return classKinds.get(typeName(value).toLowerCase()) || "other";
  }
  function splitPath(value) {
    let path = String(value || "").trim().replace(/\\/g, "/");
    const typed = path.match(/^((?:\/Script\/[^.'"\s]+\.)?[A-Za-z0-9_]+)\s*['"]([^'"]+)['"]$/);
    const type = typed?.[1] || "";
    if (typed) path = typed[2];
    path = path.replace(/^["']|["']$/g, "");
    const tail = path.split("/").pop() || "";
    // Physical files are not object paths. Do not diagnose locale .res, PNG,
    // shader or bulk sidecar files from a familiar-looking basename.
    const physical = /^(?:FortniteGame|Engine)\//i.test(path) || /\/Content\//i.test(path);
    const tailDot = tail.lastIndexOf(".");
    const tailLeft = tailDot > 0 ? tail.slice(0, tailDot) : "";
    const tailRight = tailDot > 0 ? tail.slice(tailDot + 1) : "";
    const objectPathTail = tailDot > 0 && (
      tailRight.toLowerCase() === tailLeft.toLowerCase() ||
      tailRight.toLowerCase() === `${tailLeft.toLowerCase()}_c`
    );
    const extension = tailDot > 0 ? tailRight.toLowerCase() : "";
    const knownNonAssetFile = /^(?:res|png|jpg|jpeg|json|ini|bin|usmap|uexp|ubulk|uptnl|locres|ush|usf|wav|ogg)$/i.test(extension);
    const nonAssetFile = Boolean(
      extension &&
      extension !== "uasset" &&
      (knownNonAssetFile || (physical && !objectPathTail))
    );
    path = path.replace(/\.uasset$/i, "");
    if (/^FortniteGame\/Content\//i.test(path)) path = path.replace(/^FortniteGame\/Content\//i, "/Game/");
    else if (/^Engine\/Content\//i.test(path)) path = path.replace(/^Engine\/Content\//i, "/Engine/");
    else {
      const plugin = path.match(/^(?:(?:FortniteGame|Engine)\/)?Plugins\/(?:.*\/)?([^/]+)\/Content\/(.+)$/i);
      if (plugin) path = `/${plugin[1]}/${plugin[2]}`;
    }
    const lastSlash = path.lastIndexOf("/");
    const dot = path.indexOf(".", lastSlash);
    const packagePath = dot < 0 ? path : path.slice(0, dot);
    const packageName = packagePath.split("/").pop() || "";
    const objectName = dot < 0 ? packageName : path.slice(dot + 1);
    return { type, path, packagePath, packageName, objectName, explicitObject: dot >= 0, nonAssetFile: Boolean(nonAssetFile) };
  }
  function familyOf(kind) {
    return ["staticmesh", "skeletalmesh"].includes(kind) ? "mesh" : kind.startsWith("blueprint") ? "blueprint" : kind;
  }
  function inspectionType(value) {
    if (!value || typeof value !== "object") return "";
    for (const key of ["exportType", "ExportType", "assetClass", "AssetClass", "className", "ClassName", "assetType", "AssetType", "objectType", "ObjectType", "type", "Type", "Class"]) {
      if (typeof value[key] === "string" && value[key].trim() && !/^(?:unknown|none)$/i.test(value[key].trim())) return value[key].trim();
    }
    return "";
  }
  function matchesIdentity(value, target, allowName = true) {
    if (typeof value !== "string" || !value.trim()) return false;
    // CUE4Parse uses either Type'Path' or Type Name for reference names.
    const raw = value.trim().replace(/^[A-Za-z0-9_]+\s+(?=\/)/, "");
    const candidate = splitPath(raw);
    if (candidate.path.includes("/")) {
      if (candidate.packagePath.toLowerCase() !== target.packagePath.toLowerCase()) return false;
      if (!candidate.explicitObject) return true;
      const object = candidate.objectName.toLowerCase();
      return object === target.objectName.toLowerCase() || (!target.explicitObject && object === `${target.packageName.toLowerCase()}_c`);
    }
    return allowName && (candidate.path.toLowerCase() === target.objectName.toLowerCase() ||
      (!target.explicitObject && candidate.path.toLowerCase() === `${target.packageName.toLowerCase()}_c`));
  }
  function inspectionEvidence(inspection, path) {
    if (!inspection || typeof inspection !== "object") return null;
    const state = inspection.state ?? inspection.State;
    if (state && state !== "ready") return null;
    const target = splitPath(path);
    for (const key of ["path", "Path", "resolvedPath", "ResolvedPath"]) {
      if (inspection[key] && !matchesIdentity(inspection[key], target, false)) return null;
    }
    const value = inspectionType(inspection);
    return value ? { value, kind: kindFromType(value), source: "inspection", confidence: 100 } : null;
  }
  function diagnosePath(path, inspection = null) {
    const target = splitPath(path);
    const inspected = inspectionEvidence(inspection, path);
    let kind = "other", source = "unknown", confidence = 0;
    if (inspected) ({ kind, source, confidence } = inspected);
    else if (target.type && !/^(?:Object|SoftObjectPath)$/i.test(target.type)) {
      kind = kindFromType(target.type); source = "typed-path"; confidence = 98;
    } else if (!target.nonAssetFile) {
      const name = target.packageName.toLowerCase();
      const full = target.path.toLowerCase();
      if (target.explicitObject && target.objectName.toLowerCase() === `${name}_c`) {
        kind = "blueprint"; source = "generated-class-path"; confidence = 88;
      } else {
        // Prefix evidence beats a folder; conflicting explicit classes beat both.
        const rules = [
          [/^(?:sk_|skm_)/, "skeletalmesh"], [/^sm_/, "staticmesh"],
          [/^(?:bp_|bpc_|abp_|wbp_)/, "blueprint"],
          [/^(?:t_|tex_|texture_)/, "texture"], [/^(?:mi_|m_|mf_|mpc_)/, "material"],
          [/^(?:sw_|usw_|soundwave_|sc_|soundcue_|mss_|metasound_)/, "audio"],
          [/^(?:anim_|am_|montage_)/, "animation"], [/^(?:ns_|ne_|ps_)/, "vfx"],
          [/^(?:cid_|bid_|eid_|pickaxe_)/, "cosmetic"], [/^(?:da_|dt_|data_)/, "data"]
        ];
        kind = rules.find(([pattern]) => pattern.test(name))?.[1] || "other";
        // Generic Audio/Mesh/UI directories contain many unrelated asset types.
        if (kind === "other") {
          if (/\/skeletalmeshes?\//.test(full)) kind = "skeletalmesh";
          else if (/\/staticmeshes?\//.test(full)) kind = "staticmesh";
          else if (/\/(?:animations?|anims?|montages?)\//.test(full)) kind = "animation";
        }
        if (kind !== "other") { source = "path-fallback"; confidence = 55; }
      }
    }
    return { kind, family: familyOf(kind), source, confidence, assetType: inspected?.value || target.type || "" };
  }
  function jsonTypeEvidence(data, requestedPath) {
    const target = splitPath(requestedPath);
    const candidates = [];
    let visited = 0;
    // Only export roots and documented envelope fields are candidates. Never
    // walk Properties/References/Imports, even if a reference has the same name.
    function visit(value, depth = 0) {
      if (!value || typeof value !== "object" || depth > 4 || ++visited > 500) return;
      if (Array.isArray(value)) { for (const item of value.slice(0, 200)) visit(item, depth + 1); return; }
      const entries = Object.entries(value);
      const paths = entries.filter(([key, val]) => /^(?:Path|PathName|ObjectPath|FullName|PackageName)$/i.test(key) && typeof val === "string");
      const names = entries.filter(([key, val]) => /^(?:Name|ObjectName|AssetName)$/i.test(key) && typeof val === "string");
      const exactPath = paths.some(([, val]) => matchesIdentity(val, target, false));
      const pathConflict = paths.some(([, val]) => val.includes("/") && !matchesIdentity(val, target, false));
      const exactName = names.some(([, val]) => matchesIdentity(val, target));
      const type = inspectionType(value);
      if (type && !pathConflict && (exactPath || exactName)) {
        candidates.push({ value: type, kind: kindFromType(type), score: exactPath ? 100 : 95, object: value });
      }
      for (const [key, child] of entries) if (/^(?:jsonOutput|exports|data|result|results|asset|object)$/i.test(key)) visit(child, depth + 1);
    }
    visit(data);
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;
    if (candidates.some(c => c.score === best.score && typeName(c.value).toLowerCase() !== typeName(best.value).toLowerCase())) {
      return { value: "Unknown", kind: "other", score: 0, conflict: true };
    }
    return best;
  }
  globalThis.FNAAAssetDiagnosis = Object.freeze({ diagnosePath, kindFromType, familyOf, splitPath, inspectionType, inspectionEvidence, jsonTypeEvidence });
})();
