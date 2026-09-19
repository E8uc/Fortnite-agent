import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

globalThis.window = globalThis;

globalThis.NovaSparx = {
  cleanPath(value) {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/");
  }
};

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
