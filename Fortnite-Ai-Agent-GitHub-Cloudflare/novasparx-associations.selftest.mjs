import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis;

// Use production canonicalization: the old stub hid loss of .Object_C.
vm.runInThisContext(fs.readFileSync(new URL("./novasparx-core.js", import.meta.url), "utf8"));

globalThis.NovaSparxBrowserGuard = {
  status() {
    return {
      isIOS: false,
      isMobile: false
    };
  }
};

let payload = null;

globalThis.fetch = async () =>
  new Response(
    JSON.stringify(payload),
    {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    }
  );

vm.runInThisContext(fs.readFileSync(new URL("./asset-diagnosis.js", import.meta.url), "utf8"));

const source =
  fs.readFileSync(
    new URL(
      "./novasparx-associations.js",
      import.meta.url
    ),
    "utf8"
  );

vm.runInThisContext(
  source,
  {
    filename:
      "novasparx-associations.js"
  }
);

const associations =
  globalThis.NovaSparxAssociations;

assert.ok(
  associations,
  "NovaSparxAssociations should be installed"
);

assert.equal(
  associations.diagnosePath(
    "/Game/Props/SM_Chair.SM_Chair"
  ).kind,
  "staticmesh"
);

assert.equal(
  associations.diagnosePath(
    "/Game/Characters/SK_Test.SK_Test"
  ).kind,
  "skeletalmesh"
);

assert.equal(
  associations.diagnosePath(
    "/Game/Audio/SW_Click.SW_Click"
  ).kind,
  "audio"
);

assert.equal(
  associations.diagnosePath(
    "/Game/UI/T_Icon.T_Icon"
  ).kind,
  "texture"
);

assert.equal(
  associations.diagnosePath(
    "/Game/Blueprints/WBP_Menu.WBP_Menu_C"
  ).kind,
  "blueprint"
);

assert.equal(
  associations.diagnosePath(
    "/LFNTG_Consumable/Drinks/SkeletalMesh/SKM_Gear_Potion_Pony_E.SKM_Gear_Potion_Pony_E"
  ).kind,
  "skeletalmesh",
  "Current Fortnite SKM naming must classify as SkeletalMesh"
);

assert.equal(
  associations.diagnosePath(
    "/CRD_AnimatedMesh/Device_AnimatedMesh.Device_AnimatedMesh_C"
  ).kind,
  "blueprint",
  "Generated class object paths must classify as Blueprint even without BP_"
);

assert.equal(
  associations.diagnosePath(
    "/Game/Misc/S_Ambiguous.S_Ambiguous"
  ).kind,
  "other",
  "S_ alone is ambiguous and must not advertise AUDIO"
);

assert.equal(
  associations.diagnosePath(
    "SoundWave'/Game/Misc/S_Ambiguous.S_Ambiguous'"
  ).kind,
  "audio",
  "Explicit Unreal SoundWave type must override ambiguous naming"
);

assert.equal(
  associations.diagnosePath(
    "StaticMesh'/Game/Audio/SW_NotActuallySound.SW_NotActuallySound'"
  ).kind,
  "staticmesh",
  "Explicit Unreal class must override misleading path prefixes"
);

assert.equal(
  associations.diagnosePath(
    "/BRCosmetics/Animation/Game/MainPlayer/Emotes/JadeTowel_Gloss/CMF/Emote_JadeTowel_Gloss_CMF_M.Emote_JadeTowel_Gloss_CMF_M"
  ).kind,
  "animation",
  "Animation folder evidence should classify real project-style paths"
);

payload = [
  {
    Type:
      "StaticMesh",
    Name:
      "SM_Chair",
    Properties: {
      RelatedBlueprint: {
        Type:
          "BlueprintGeneratedClass",
        ObjectName:
          "BP_Chair_C"
      }
    }
  }
];

let result =
  await associations.classify(
    "/Game/Props/SM_Chair.SM_Chair",
    {
      verifyKnown:
        true
    }
  );

assert.equal(
  result.kind,
  "staticmesh",
  "A nested Blueprint reference must not replace the root StaticMesh type"
);

assert.equal(
  result.source,
  "export-json"
);

payload = [
  {
    Type:
      "BlueprintGeneratedClass",
    Name:
      "BP_Door_C",
    Properties: {
      Mesh:
        "StaticMesh'/Game/Props/SM_Door.SM_Door'"
    }
  }
];

result =
  await associations.classify(
    "/Game/Blueprints/BP_Door.BP_Door_C",
    {
      verifyKnown:
        true
    }
  );

assert.match(
  result.kind,
  /^blueprint/,
  "A Blueprint must remain a Blueprint even when it references a mesh"
);

payload = [
  {
    Type:
      "SoundWave",
    Name:
      "SW_Click",
    Properties: {
      Icon:
        "Texture2D'/Game/UI/T_Speaker.T_Speaker'"
    }
  }
];

result =
  await associations.classify(
    "/Game/Audio/SW_Click.SW_Click",
    {
      verifyKnown:
        true
    }
  );

assert.equal(
  result.kind,
  "audio",
  "A SoundWave must stay audio even when it references a texture"
);

payload = [
  {
    Name:
      "MysteryAsset",
    Properties: {
      Unrelated: {
        Type:
          "StaticMesh",
        Name:
          "SM_Other"
      }
    }
  }
];

result =
  await associations.classify(
    "/Game/Misc/MysteryAsset.MysteryAsset",
    {
      verifyKnown:
        true
    }
  );

assert.equal(
  result.kind,
  "other",
  "An unrelated nested reference must not classify an unknown asset"
);

console.log(
  "NovaSparx association diagnosis self-test passed."
);

// Real database paths are evidence for naming coverage, not verified class truth.
const corpus = JSON.parse(fs.readFileSync(new URL("./diagnosis-corpus.json", import.meta.url), "utf8"));
assert.equal(createHash("sha256").update(fs.readFileSync(new URL("./database/fortnite_assets.gz", import.meta.url))).digest("hex"), corpus.sha256, "Refresh corpus provenance when the manual asset database changes");
for (const item of corpus.cases) {
  assert.equal(associations.diagnosePath(item.path).kind, item.expectedKind, item.path);
}
const cases = [
  ["StaticMesh'/Game/Audio/SW_NotActuallySound.SW_NotActuallySound'", "staticmesh"],
  ["SkeletalMesh'/Game/Textures/T_Test.T_Test'", "skeletalmesh"],
  ["Texture2D'/Game/SM_Test.SM_Test'", "texture"],
  ["SoundCue'/Game/S_Test.S_Test'", "audio"],
  ["MetaSoundSource'/Game/S_Test.S_Test'", "audio"],
  ["MetaSoundPatch'/Game/S_Test.S_Test'", "audio"],
  ["Blueprint'/Game/SM_Test.SM_Test'", "blueprint"],
  ["BlueprintGeneratedClass'/Game/T_Test.T_Test_C'", "blueprint"],
  ["/Script/Engine.StaticMesh'/Game/SW_Test.SW_Test'", "staticmesh"],
  ["StaticMeshComponent'/Game/SM_Test.SM_Test'", "other"],
  ["SkeletalMeshLODSettings'/Game/SKM_Test.SKM_Test'", "other"],
  ["AudioBus'/Game/SW_Test.SW_Test'", "other"],
  ["NiagaraDataInterfaceStaticMesh'/Game/SM_Test.SM_Test'", "other"],
  ["UnknownCustomClass'/Game/Textures/T_Test.T_Test'", "other"],
  ["AnimBlueprintGeneratedClass'/Game/SM_Test.SM_Test_C'", "blueprint"],
  ["/Game/StaticMeshes/BP_Test.BP_Test", "blueprint"],
  ["/Game/Audio/T_Test.T_Test", "texture"],
  ["/Game/Audio/Unknown.Unknown", "other"],
  ["/Game/Meshes/Unknown.Unknown", "other"],
  ["/Game/SkeletalMesh/T_Test.T_Test", "texture"],
  ["/Game/SKM_Test.SKM_Test_C", "blueprint"],
  ["/CRD_AnimatedMesh/Device_AnimatedMesh.Device_AnimatedMesh_C", "blueprint"],
  ["FortniteGame/Content/Props/SM_Physical.SM_Physical", "staticmesh"],
  ["FortniteGame/Content/Audio/SW_Physical.SW_Physical", "audio"],
  ["Engine/Content/Internationalization/icudt78l/curr/sw_KE.res", "other"]
];
for (const [path, kind] of cases) {
  const local = associations.diagnosePath(path);
  assert.equal(local.kind, kind, path);
  assert.equal(associations.family(path), local.family, path);
  const result = await associations.classify(path, { data: {} });
  assert.equal(result.kind, kind, path);
  assert.equal(result.source, local.source, path);
}
const target = "/Game/Misc/Mystery.Mystery";
for (const data of [
  [{ Name: "Mystery", Properties: { Ref: { Name: "Mystery", Type: "StaticMesh" } } }],
  [{ Name: "MysteryOther", Type: "StaticMesh" }],
  [{ Name: "Other", Type: "StaticMesh" }],
  [{ Name: "Mystery", ObjectPath: "/Other/Mystery.Mystery", Type: "StaticMesh" }],
  { Properties: { Name: "Mystery", Type: "StaticMesh" } },
  [{ Name: "Mystery", Type: "DataAsset", Properties: { Ref: { Name: "Mystery", Type: "StaticMesh" } } }],
]) {
  const expected = data[0]?.Type === "DataAsset" ? "data" : "other";
  assert.equal((await associations.classify(target, { data })).kind, expected, JSON.stringify(data));
}
assert.equal((await associations.classify(target, { data: [
  { Name: "Mystery", Type: "StaticMesh" }, { Name: "Mystery", Type: "Texture2D" }
] })).kind, "other", "Conflicting root classes must fail closed");
for (const data of [
  [{ Type: "StaticMesh", Name: "Mystery" }],
  { exports: [{ Type: "StaticMesh", Name: "Mystery" }] },
  { data: { exports: [{ Type: "StaticMesh", Name: "Mystery" }] } }
]) assert.equal((await associations.classify(target, { data })).kind, "staticmesh");
assert.equal((await associations.classify("/Game/SM_Test.SM_Test", {
  data: [{ Name: "SM_Test", Type: "CustomUnrecognizedType" }]
})).kind, "other", "Explicit unknown class blocks name heuristic");
assert.equal((await associations.classify("StaticMesh'/Game/SM_Test.SM_Test'", {
  inspection: { state: "ready", path: "/Game/SM_Test", assetType: "SoundWave" },
  data: [{ Name: "SM_Test", Type: "Texture2D" }]
})).kind, "audio", "Inspection wins over typed path and JSON");
assert.equal((await associations.classify(target, {
  inspection: { path: "/Other/Mystery", assetType: "StaticMesh" }, data: {}
})).kind, "other", "Unrelated inspection cannot classify target");
assert.equal((await associations.classify(target, {
  inspection: { state: "error", path: target, assetType: "StaticMesh" }, data: {}
})).kind, "other", "Failed inspection cannot classify target");
assert.equal((await associations.classify("/Game/BP_Test.uasset", {
  data: [{ Type: "BlueprintGeneratedClass", Name: "BP_Test_C" }]
})).source, "export-json", "Package requests match their generated root export");
for (const kind of ["staticmesh", "skeletalmesh", "blueprint", "texture", "audio", "animation", "vfx", "data", "other"]) {
  const caps = associations.capabilityProfile(kind, { Properties: { Mesh: "StaticMesh'/Game/SM_X.SM_X'" } });
  assert.equal(caps.canPreview, false, kind);
  assert.equal(caps.canExportUEFN, false, kind);
  assert.equal(caps.canListen, false, kind);
  assert.deepEqual(caps.downloadFormats, ["json"]);
  assert.ok(!caps.tags.some(tag => ["VISUAL", "IMAGE", "LOGIC"].includes(tag)));
}
assert.deepEqual(associations.capabilityProfile("blueprint").tags, ["BLUEPRINT"]);
assert.equal(associations.capabilityProfile("staticmesh", null, {facts:{renderablePreview:true}}).canView3D, true);
assert.equal(associations.capabilityProfile("audio", null, {facts:{renderablePreview:true}}).canView3D, false);
// Database indexing is tested against the same expected classifications.
const allCases = [...corpus.cases, ...cases.map(([path, expectedKind]) => ({path, expectedKind}))];
assert.equal(globalThis.NovaSparx.cleanPath("MetaSoundSource'/Game/Test.Test'"), "/Game/Test");
assert.equal(globalThis.NovaSparx.cleanPath("/Script/Engine.StaticMesh'/Game/Test.Test'"), "/Game/Test");

const workerContext = vm.createContext({ console, URL, Map, Set, TextEncoder, TextDecoder,
  AbortController, Response, Request, Headers, setTimeout, clearTimeout, crypto: globalThis.crypto });
vm.runInContext(fs.readFileSync(new URL("./asset-diagnosis.js", import.meta.url), "utf8"), workerContext);
const workerSource = fs.readFileSync(new URL("./cloudflare-worker/worker.js", import.meta.url), "utf8")
  .replace('import "../asset-diagnosis.js";', '').replace('export default', 'const workerDefault =');
vm.runInContext(workerSource + '\nglobalThis.routingFamily = visualAssetFamily;', workerContext);
for (const item of allCases) {
  assert.equal(workerContext.routingFamily(item.path), associations.family(item.path), item.path);
}

const python = spawnSync("python3", ["-c", `
import json,sys
from build_database import diagnosis_scope
for item in json.load(sys.stdin):
 expected = item['expectedKind'] if item['expectedKind'] in ('staticmesh','skeletalmesh','material') else 'other'
 actual = diagnosis_scope(item['path'])
 assert actual == expected, (item['path'], actual, expected)
`], { cwd: fileURLToPath(new URL(".", import.meta.url)), input: JSON.stringify(allCases), encoding: "utf8" });
assert.equal(python.status, 0, python.stderr);
console.log(`Diagnosis corpus passed: ${corpus.cases.length} real database paths, ${cases.length} cross-layer cases, root identity and capability regressions.`);

const liveFixtures = JSON.parse(fs.readFileSync(new URL("./diagnosis-fixtures/manifest.json", import.meta.url), "utf8"));
let fixturesTested = 0;
for (const fixture of liveFixtures.filter(x => x.file)) {
  const bytes = fs.readFileSync(new URL(`./diagnosis-fixtures/${fixture.file}`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
  const data = JSON.parse(bytes);
  const expected = globalThis.FNAAAssetDiagnosis.kindFromType(fixture.rootTypes[0]);
  for (const path of [fixture.path, fixture.physicalPath]) {
    const result = await associations.classify(path, { data });
    assert.equal(result.source, "export-json", fixture.path);
    assert.equal(result.kind, expected, fixture.path);
  }
  // Exercise fetch -> bounded JSON reader -> actual current Dilly envelope.
  payload = data;
  const fetched = await associations.classify(fixture.path, { verifyKnown: true });
  assert.equal(fetched.kind, expected, fixture.path);
  assert.equal(fetched.source, "export-json", fixture.path);
  fixturesTested++;
}
console.log(`Captured live Dilly export fixtures passed: ${fixturesTested}.`);

payload = [
  {
    Type: "Texture2D",
    Name: "T_PublicPreview"
  }
];
const publicPreview = await associations.publicPreview(
  "/Game/UI/T_PublicPreview.T_PublicPreview",
  { data: payload }
);
assert.equal(publicPreview?.kind, "texture", "publicPreview must use the shared classifier without a runtime ReferenceError");
console.log("Public preview shared-diagnosis regression passed.");
