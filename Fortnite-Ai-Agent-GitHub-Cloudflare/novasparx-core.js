(() => {
  "use strict";

  const API = String(window.FORTNITE_AI_API_ENDPOINT || "").trim().replace(/\/+$/, "");
  const MAX_VERTICES = 700000;
  const MAX_INDICES = 2100000;
  const MAX_MATERIALS = 64;

  function fallbackClean(raw) {
    let value = String(raw || "").trim().replace(/\\/g, "/");

    const wrapped = value.match(
      /^(?:StaticMesh|SkeletalMesh|Texture2D|Texture|Material|MaterialInstanceConstant|MaterialInstance|Object|BlueprintGeneratedClass|Blueprint|NiagaraSystem|NiagaraEmitter|SoundCue|SoundWave)?'(.+)'$/i
    );
    if (wrapped) value = wrapped[1];

    value = value
      .replace(/^["']|["']$/g, "")
      .replace(/\.(?:uasset|uexp|ubulk)$/i, "");

    const slash = value.lastIndexOf("/");
    const dot = value.lastIndexOf(".");

    if (dot > slash) {
      const left = value.slice(0, dot);
      const objectName = value.slice(dot + 1).replace(/_C$/i, "");
      const packageName = left.slice(left.lastIndexOf("/") + 1);
      if (objectName.toLowerCase() === packageName.toLowerCase()) value = left;
    }

    if (/^FortniteGame\/Content\//i.test(value)) {
      value = "/Game/" + value.slice("FortniteGame/Content/".length);
    } else if (/^Engine\/Content\//i.test(value)) {
      value = "/Engine/" + value.slice("Engine/Content/".length);
    } else if (/^(?:FortniteGame\/)?Plugins\//i.test(value)) {
      const parts = value.split("/").filter(Boolean);
      const contentIndex = parts.findIndex((part) => part.toLowerCase() === "content");
      if (contentIndex >= 1 && contentIndex + 1 < parts.length) {
        const mount = parts[contentIndex - 1];
        value = `/${mount}/${parts.slice(contentIndex + 1).join("/")}`;
      }
    }

    if (!value.startsWith("/") && value.includes("/")) value = "/" + value;
    return value.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  }

  function cleanPath(raw) {
    return window.FortniteTools?.packagePath?.(raw) || fallbackClean(raw);
  }

  function objectPath(raw) {
    const packagePath = cleanPath(raw);
    if (!packagePath) return "";
    const name = packagePath.slice(packagePath.lastIndexOf("/") + 1);
    return `${packagePath}.${name}`;
  }

  function textureUrl(path) {
    const value = String(path || "").trim();
    if (!value || !API) return "";
    return `${API}/nova/texture?path=${encodeURIComponent(value)}`;
  }

  function clamp(value, min, max, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }

  function rgba(value, fallback) {
    if (Array.isArray(value)) {
      return [0, 1, 2, 3].map((index) => {
        const number = Number(value[index]);
        return Number.isFinite(number) ? number : fallback[index];
      });
    }

    if (value && typeof value === "object") {
      return [
        Number(value.r ?? value.R ?? value.x ?? value.X ?? fallback[0]),
        Number(value.g ?? value.G ?? value.y ?? value.Y ?? fallback[1]),
        Number(value.b ?? value.B ?? value.z ?? value.Z ?? fallback[2]),
        Number(value.a ?? value.A ?? value.w ?? value.W ?? fallback[3])
      ].map((number, index) => Number.isFinite(number) ? number : fallback[index]);
    }

    return fallback.slice();
  }

  function finiteArray(raw, tupleSize, maxItems) {
    if (!Array.isArray(raw) && !ArrayBuffer.isView(raw)) return null;
    const input = ArrayBuffer.isView(raw) ? Array.from(raw) : raw;
    if (!input.length) return null;

    const out = [];

    if (typeof input[0] === "number") {
      const limit = Math.min(input.length, maxItems * tupleSize);
      for (let i = 0; i < limit; i++) {
        const number = Number(input[i]);
        if (!Number.isFinite(number)) return null;
        out.push(number);
      }
      return out.length % tupleSize === 0 ? out : null;
    }

    const keys = tupleSize === 2
      ? [["x", "X", "u", "U"], ["y", "Y", "v", "V"]]
      : tupleSize === 4
        ? [["x", "X", "r", "R"], ["y", "Y", "g", "G"], ["z", "Z", "b", "B"], ["w", "W", "a", "A"]]
        : [["x", "X"], ["y", "Y"], ["z", "Z"]];

    for (const item of input) {
      if (!item || typeof item !== "object") return null;

      for (let component = 0; component < tupleSize; component++) {
        let value = Array.isArray(item) ? item[component] : undefined;

        if (!Array.isArray(item)) {
          for (const key of keys[component]) {
            if (item[key] !== undefined) {
              value = item[key];
              break;
            }
          }
        }

        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        out.push(number);
      }

      if (out.length / tupleSize >= maxItems) break;
    }

    return out;
  }

  function normalizeMaterial(raw, index) {
    const material = raw && typeof raw === "object" ? raw : {};

    const pathValue = (...keys) => {
      for (const key of keys) {
        const value = material[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    };

    const texture = (...keys) => {
      const path = pathValue(...keys);
      return path ? textureUrl(path) : "";
    };

    return {
      index,
      name: String(material.name ?? material.Name ?? `Material_${index}`),
      path: String(material.path ?? material.Path ?? ""),

      baseColor: rgba(material.baseColor ?? material.BaseColor, [1, 1, 1, 1]),
      emissiveColor: rgba(material.emissiveColor ?? material.EmissiveColor, [0, 0, 0, 1]),

      roughness: clamp(material.roughness ?? material.Roughness, 0, 1, 0.62),
      metallic: clamp(material.metallic ?? material.Metallic, 0, 1, 0),
      specular: clamp(material.specular ?? material.Specular, 0, 1, 0.5),
      opacity: clamp(material.opacity ?? material.Opacity, 0, 1, 1),
      opacityMode: String(material.opacityMode ?? material.OpacityMode ?? "opaque").toLowerCase(),
      opacityCutoff: clamp(material.opacityCutoff ?? material.OpacityCutoff, 0, 1, 0.333),

      twoSided: Boolean(material.twoSided ?? material.TwoSided),
      useVertexColor: Boolean(material.useVertexColor ?? material.UseVertexColor),

      uvScale: Array.isArray(material.uvScale ?? material.UvScale)
        ? (material.uvScale ?? material.UvScale).slice(0, 2).map(Number)
        : [1, 1],
      uvOffset: Array.isArray(material.uvOffset ?? material.UvOffset)
        ? (material.uvOffset ?? material.UvOffset).slice(0, 2).map(Number)
        : [0, 0],

      baseColorTexture: texture("baseColorTexture", "BaseColorTexture"),
      normalTexture: texture("normalTexture", "NormalTexture"),
      emissiveTexture: texture("emissiveTexture", "EmissiveTexture"),
      opacityTexture: texture("opacityTexture", "OpacityTexture"),
      packedTexture: texture("packedTexture", "PackedTexture"),

      baseColorTexturePath: pathValue("baseColorTexture", "BaseColorTexture"),
      normalTexturePath: pathValue("normalTexture", "NormalTexture"),
      emissiveTexturePath: pathValue("emissiveTexture", "EmissiveTexture"),
      opacityTexturePath: pathValue("opacityTexture", "OpacityTexture"),
      packedTexturePath: pathValue("packedTexture", "PackedTexture"),

      packedChannels: {
        ao: Number(material.packedChannels?.ao ?? material.PackedChannels?.Ao ?? -1),
        roughness: Number(material.packedChannels?.roughness ?? material.PackedChannels?.Roughness ?? -1),
        metallic: Number(material.packedChannels?.metallic ?? material.PackedChannels?.Metallic ?? -1)
      },

      fidelity: String(material.fidelity ?? material.Fidelity ?? "unknown").toLowerCase(),
      evidence: String(material.evidence ?? material.Evidence ?? "")
    };
  }

  function normalizeSections(raw, indexCount) {
    if (!Array.isArray(raw)) return [];

    return raw.slice(0, 256).map((section) => {
      const firstIndex = Math.max(0, Number(section.firstIndex ?? section.FirstIndex ?? 0) || 0);
      let count = Number(section.indexCount ?? section.IndexCount ?? 0) ||
        ((Number(section.numFaces ?? section.NumFaces ?? 0) || 0) * 3);

      count = Math.max(0, Math.min(count, indexCount - firstIndex));
      count -= count % 3;

      return {
        firstIndex,
        indexCount: count,
        materialIndex: Math.max(0, Number(section.materialIndex ?? section.MaterialIndex ?? 0) || 0),
        name: String(section.name ?? section.Name ?? "")
      };
    }).filter((section) => section.indexCount > 0);
  }

  function normalizeReferences(raw) {
    if (!Array.isArray(raw)) return [];

    const seen = new Set();
    const out = [];

    for (const item of raw) {
      const path = typeof item === "string"
        ? item
        : String(item?.path ?? item?.Path ?? "").trim();
      if (!path) continue;

      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        kind: typeof item === "object" ? String(item.kind ?? item.Kind ?? "reference") : "reference",
        path
      });

      if (out.length >= 128) break;
    }

    return out;
  }

  function normalizeManifest(data, requestedPath = "") {
    if (!data || typeof data !== "object") {
      throw new Error("NovaSparx returned an empty manifest.");
    }

    const manifest = data.manifest && typeof data.manifest === "object" ? data.manifest : data;
    const geometry = manifest.geometry || manifest.Geometry || manifest;

    const positions = finiteArray(geometry.positions ?? geometry.Positions, 3, MAX_VERTICES);
    let indices = finiteArray(geometry.indices ?? geometry.Indices, 1, MAX_INDICES);

    if (!positions || !indices || positions.length < 9 || indices.length < 3) {
      throw new Error("NovaSparx manifest does not contain usable geometry.");
    }

    indices = indices.map(Number).filter(Number.isInteger);
    indices.length -= indices.length % 3;

    const vertexCount = positions.length / 3;
    if (indices.some((index) => index < 0 || index >= vertexCount)) {
      throw new Error("NovaSparx geometry contains invalid indices.");
    }

    const normals = finiteArray(geometry.normals ?? geometry.Normals, 3, MAX_VERTICES);
    const tangents = finiteArray(geometry.tangents ?? geometry.Tangents, 4, MAX_VERTICES);
    const uv0 = finiteArray(geometry.uv0 ?? geometry.Uv0 ?? geometry.UV0, 2, MAX_VERTICES);
    const colors = finiteArray(geometry.colors ?? geometry.Colors, 4, MAX_VERTICES);

    const materialsRaw = manifest.materials ?? manifest.Materials ?? [];
    const materials = Array.isArray(materialsRaw)
      ? materialsRaw.slice(0, MAX_MATERIALS).map(normalizeMaterial)
      : [];

    if (!materials.length) materials.push(normalizeMaterial({}, 0));

    const sections = normalizeSections(
      manifest.sections ?? manifest.Sections,
      indices.length
    );

    const references = normalizeReferences(
      manifest.references ?? manifest.References ?? data.references ?? data.References
    );

    return {
      schema: "novasparx.preview.v1",
      path: cleanPath(manifest.path ?? manifest.Path ?? requestedPath),
      resolvedPath: String(data.resolvedPath ?? data.ResolvedPath ?? manifest.resolvedPath ?? manifest.ResolvedPath ?? ""),
      assetType: String(data.assetType ?? data.AssetType ?? manifest.assetType ?? manifest.AssetType ?? "Unknown"),
      source: String(data.source ?? data.Source ?? "NovaSparx"),
      quality: String(manifest.quality ?? manifest.Quality ?? "preview"),

      geometry: {
        positions,
        indices,
        normals: normals && normals.length === positions.length ? normals : null,
        tangents: tangents && tangents.length / 4 === vertexCount ? tangents : null,
        uv0: uv0 && uv0.length / 2 === vertexCount ? uv0 : null,
        colors: colors && colors.length / 4 === vertexCount ? colors : null
      },

      sections,
      materials,
      references,

      metadata: {
        vertexCount,
        triangleCount: indices.length / 3,
        isNanite: Boolean(manifest.isNanite ?? manifest.IsNanite),
        lod: Number(manifest.lod ?? manifest.Lod ?? 0),
        materialFidelity: String(
          manifest.materialFidelity ?? manifest.MaterialFidelity ??
          data.materialFidelity ?? data.MaterialFidelity ?? "unknown"
        ).toLowerCase()
      }
    };
  }

  function parseClientMesh(buffer, requestedPath = "") {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16) {
      throw new Error("NovaSparx returned an invalid mesh package.");
    }

    const bytes = new Uint8Array(buffer);
    const magic = [0x4e, 0x53, 0x4d, 0x45, 0x53, 0x48, 0x31, 0x00];

    for (let index = 0; index < magic.length; index++) {
      if (bytes[index] !== magic[index]) {
        throw new Error("NovaSparx mesh package has an invalid signature.");
      }
    }

    const view = new DataView(buffer);
    const headerLength = view.getUint32(8, true);
    const paddedHeaderLength = view.getUint32(12, true);

    if (
      !headerLength ||
      paddedHeaderLength < headerLength ||
      paddedHeaderLength % 4 !== 0
    ) {
      throw new Error("NovaSparx mesh package has an invalid header.");
    }

    const payloadStart = 16 + paddedHeaderLength;

    if (payloadStart > buffer.byteLength) {
      throw new Error("NovaSparx mesh header exceeds the package.");
    }

    let header;

    try {
      header = JSON.parse(
        new TextDecoder().decode(
          new Uint8Array(
            buffer,
            16,
            headerLength
          )
        )
      );
    } catch {
      throw new Error("NovaSparx mesh header could not be decoded.");
    }

    if (
      header?.schema !==
      "novasparx.client-mesh.v1"
    ) {
      throw new Error(
        `Unsupported NovaSparx mesh schema: ${header?.schema || "missing"}`
      );
    }

    const payloadLength =
      buffer.byteLength -
      payloadStart;

    const array = (
      name,
      Type
    ) => {
      const item =
        header.arrays?.[name];

      if (!item) return null;

      const offset =
        Number(item.byteOffset);

      const length =
        Number(item.byteLength);

      if (
        !Number.isInteger(offset) ||
        !Number.isInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length >
          payloadLength ||
        length %
          Type.BYTES_PER_ELEMENT !==
          0
      ) {
        throw new Error(
          `Invalid NovaSparx mesh array: ${name}`
        );
      }

      const absolute =
        payloadStart + offset;

      if (
        absolute %
          Type.BYTES_PER_ELEMENT !==
          0
      ) {
        throw new Error(
          `Invalid NovaSparx mesh alignment: ${name}`
        );
      }

      return new Type(
        buffer,
        absolute,
        length /
          Type.BYTES_PER_ELEMENT
      );
    };

    const positions =
      array(
        "positions",
        Float32Array
      );

    const normals =
      array(
        "normals",
        Float32Array
      );

    const tangents =
      array(
        "tangents",
        Float32Array
      );

    const uv0 =
      array(
        "uv0",
        Float32Array
      );

    const colors =
      array(
        "colors",
        Float32Array
      );

    const indices =
      array(
        "indices",
        Uint32Array
      );

    if (
      !positions ||
      !normals ||
      !tangents ||
      !uv0 ||
      !indices
    ) {
      throw new Error(
        "NovaSparx mesh package is missing geometry streams."
      );
    }

    const vertexCount =
      positions.length / 3;

    if (
      !Number.isInteger(vertexCount) ||
      vertexCount <= 0 ||
      vertexCount > MAX_VERTICES ||
      indices.length < 3 ||
      indices.length > MAX_INDICES ||
      indices.length % 3 !== 0 ||
      normals.length !==
        vertexCount * 3 ||
      tangents.length !==
        vertexCount * 4 ||
      uv0.length !==
        vertexCount * 2 ||
      (
        colors &&
        colors.length !==
          vertexCount * 4
      )
    ) {
      throw new Error(
        "NovaSparx mesh package has inconsistent geometry."
      );
    }

    const materialsRaw =
      Array.isArray(header.materials)
        ? header.materials
        : [];

    const materials =
      materialsRaw
        .slice(0, MAX_MATERIALS)
        .map(normalizeMaterial);

    if (!materials.length) {
      materials.push(
        normalizeMaterial({}, 0)
      );
    }

    const sections =
      normalizeSections(
        header.sections,
        indices.length
      );

    const textureReferences =
      Array.isArray(
        header.texturePaths
      )
        ? header.texturePaths.map(
            (path) => ({
              kind: "texture",
              path
            })
          )
        : [];

    const asset =
      header.asset &&
      typeof header.asset ===
        "object"
        ? header.asset
        : {};

    return {
      schema:
        "novasparx.preview.v1",

      path:
        cleanPath(
          asset.path ||
          requestedPath
        ),

      resolvedPath:
        String(
          asset.resolvedPath ||
          ""
        ),

      assetType:
        String(
          asset.assetType ||
          "Unknown"
        ),

      source:
        String(
          asset.source ||
          "NovaSparx"
        ),

      quality:
        "client-binary",

      geometry: {
        positions,
        indices,
        normals,
        tangents,
        uv0,
        colors
      },

      sections,
      materials,

      references:
        normalizeReferences(
          textureReferences
        ),

      metadata: {
        vertexCount,
        triangleCount:
          indices.length / 3,
        isNanite:
          Boolean(
            asset.isNanite
          ),
        lod:
          Number(
            asset.lod || 0
          ),
        materialFidelity:
          String(
            asset.materialFidelity ||
            "unknown"
          ).toLowerCase()
      }
    };
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      cache: options.noCache ? "no-store" : "force-cache",
      headers: { Accept: "application/json" }
    });

    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  async function resolve(path, options = {}) {
    if (!API) throw new Error("FNAA API endpoint is not configured.");

    const url = new URL(`${API}/nova/resolve`);
    url.searchParams.set("path", String(path || ""));
    url.searchParams.set("quality", options.preferHQ === false ? "normal" : "hq");

    const { response, data } = await requestJson(url, options);

    if (!response.ok || data.state !== "ready") {
      const error = new Error(data.error || `NovaSparx resolver returned HTTP ${response.status}.`);
      error.code = data.code || (response.status === 404 ? "NOVA_MISSING" : "NOVA_ERROR");
      error.details = data;
      throw error;
    }

    return normalizeManifest(data, path);
  }

  async function clientMesh(path, options = {}) {
    if (!API) {
      throw new Error(
        "FNAA API endpoint is not configured."
      );
    }

    const url =
      new URL(
        `${API}/nova/client-mesh`
      );

    url.searchParams.set(
      "path",
      String(path || "")
    );

    if (options.retry) {
      url.searchParams.set(
        "retry",
        String(Date.now())
      );
    }

    const response =
      await fetch(
        url.toString(),
        {
          cache: "no-store",
          headers: {
            Accept:
              "application/vnd.novasparx.mesh-v1,application/octet-stream;q=0.9,application/json;q=0.5"
          }
        }
      );

    if (!response.ok) {
      const data =
        await response
          .json()
          .catch(() => ({}));

      const error =
        new Error(
          data.error ||
          `NovaSparx client mesh returned HTTP ${response.status}.`
        );

      error.code =
        data.code ||
        (
          response.status === 404
            ? "NOVA_MISSING"
            : "NOVA_CLIENT_MESH_ERROR"
        );

      error.details = data;
      throw error;
    }

    return parseClientMesh(
      await response.arrayBuffer(),
      path
    );
  }

  async function inspect(path, options = {}) {
    if (!API) throw new Error("FNAA API endpoint is not configured.");

    const url = new URL(`${API}/nova/inspect`);
    url.searchParams.set("path", String(path || ""));

    const { response, data } = await requestJson(url, { ...options, noCache: true });

    if (!response.ok) {
      const error = new Error(data.error || `NovaSparx inspect returned HTTP ${response.status}.`);
      error.code = data.code || "NOVA_INSPECT_ERROR";
      error.details = data;
      throw error;
    }

    return data;
  }

  async function preview(path, options = {}) {
    if (!API) throw new Error("FNAA API endpoint is not configured.");

    const url = new URL(`${API}/nova/preview`);
    url.searchParams.set("path", String(path || ""));

    if (options.retry) {
      url.searchParams.set("retry", String(Date.now()));
    }

    const { response, data } = await requestJson(
      url,
      { ...options, noCache: Boolean(options.retry) }
    );

    if (!response.ok || data.state !== "ready") {
      const error = new Error(
        data.error ||
        `NovaSparx preview planner returned HTTP ${response.status}.`
      );

      error.code = data.code || "NOVA_PREVIEW_ERROR";
      error.details = data;
      throw error;
    }

    const kind = String(data.kind || "metadata").toLowerCase();

    return {
      ...data,
      kind,
      manifest:
        kind === "mesh" && data.mesh
          ? normalizeManifest(data.mesh, path)
          : null
    };
  }

  window.NovaSparx = Object.freeze({
    version: "1.2.0",
    resolve,
    clientMesh,
    inspect,
    preview,
    parseClientMesh,
    normalizeManifest,
    cleanPath,
    objectPath,
    textureUrl
  });
})();

