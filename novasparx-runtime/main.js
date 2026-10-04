import { dotnet } from "./_framework/dotnet.js";

// Executed by an actual browser page, never by Node. Node only hosts the files
// and drives Chromium in runtime.test.mjs.
globalThis.cue4parseProbe = { state: "starting", assetParsingProven: false };
try {
  const { runMain, getConfig, setModuleImports } = await dotnet.withDiagnosticTracing(false).create();
  setModuleImports("texture-view", { render(width, height, encoded, path) {
    if (width <= 0 || height <= 0 || width * height > 65536) throw new Error("Texture pixel budget exceeded");
    const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    if (raw.length !== width * height * 4) throw new Error("RGBA byte count mismatch");
    const canvas = document.createElement("canvas");
    const index = (globalThis.nativeTexturePromises ||= []).length;
    canvas.id = `native-texture-${index}`; canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(raw.buffer), width, height), 0, 0);
    const label = document.createElement("p"); label.textContent = path;
    document.body.append(label, canvas);
    globalThis.nativeTexturePromises.push(crypto.subtle.digest("SHA-256", raw).then(hash => ({ path, width, height,
      pixelsSha256: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,"0")).join("").toUpperCase() })));
  }});
  const test = new URLSearchParams(globalThis.location.search).get("test");
  const args = test === "reject-partial-block" ? ["--reject-partial-block"] : test === "cancel-ctr" ? ["--cancel-ctr"] : [];
  const exitCode = await runMain(getConfig().mainAssemblyName, args);
  globalThis.cue4parseProbe = { state: exitCode === 0 ? "ready" : "failed", exitCode, assetParsingProven: false };
} catch (error) {
  globalThis.cue4parseProbe = { state: "failed", error: String(error?.stack || error), assetParsingProven: false };
  console.error(error);
}
