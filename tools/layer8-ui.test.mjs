// Reuse the verified bounded relay harness; all Unreal work runs in the browser.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const nova = path.resolve(process.argv[2]);
const bundle = path.resolve(process.argv[3]);
const site = path.resolve('Fortnite-Ai-Agent-GitHub-Cloudflare');
fs.mkdirSync(path.join(bundle, 'site'), { recursive: true });
for (const name of fs.readdirSync(site).filter(n => n.endsWith('.js'))) fs.copyFileSync(path.join(site, name), path.join(bundle, 'site', name));
fs.cpSync(path.join(nova, 'web/location-index'), path.join(bundle, 'novasparx/location-index'), { recursive: true });
fs.mkdirSync(path.join(bundle, 'novasparx/runtime'), { recursive: true });
fs.cpSync(path.join(bundle, '_framework'), path.join(bundle, 'novasparx/runtime/_framework'), { recursive: true });
fs.copyFileSync(path.join(nova, 'tools/CUE4Parse.BrowserProbe/worker.js'), path.join(bundle, 'novasparx/runtime/worker.js'));
const scripts = ['novasparx-browser-guard','asset-diagnosis','novasparx-core','novasparx-browser-transport','novasparx-local-parser','novasparx-associations','novasparx-texture-runtime','preview'];
const html = '<!doctype html><meta charset="utf-8"><button id="view">View Image</button><div id="target"></div><script>window.FNAA_CONFIG={apiEndpoint:location.origin};</script>' + scripts.map(n => `<script src="/site/${n}.js"></script>`).join('');
let prefix = fs.readFileSync(path.join(nova, 'tools/CUE4Parse.BrowserProbe/runtime.test.mjs'), 'utf8').split('let browser;')[0];
prefix = prefix.replace("  const pathname = new URL(req.url, 'http://localhost').pathname;", `  let pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/nova-edge/range') pathname = '/edge/range';
  if (pathname === '/nova-edge/bootstrap') {
    try {
      const live = await (liveManifestPromise ||= resolveRawManifest(LIVE_MANIFEST_ENDPOINT));
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({schema:'novasparx.edge-bootstrap.v1',manifest:{candidates:[{url:live.source}]}}));
    } catch (e) { res.writeHead(502).end(String(e)); }
    return;
  }`);
prefix = prefix.replace("res.end('<!doctype html><meta charset=\"utf-8\"><title>CUE4Parse browser runtime proof</title><script type=\"module\" src=\"/main.js\"></script>');", `res.end(${JSON.stringify(html)});`);
const test = `
const fixture = JSON.parse(fs.readFileSync('tools/CUE4Parse.BrowserProbe/texture-fixture.json','utf8'));
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  page.on('pageerror', e => console.log('UI_ERROR',String(e)));
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  await page.evaluate(() => {
    const NativeWorker = window.Worker;
    window.pixelProofs = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if(data.type === 'pixels') window.pixelProofs.push(crypto.subtle.digest('SHA-256', data.pixels).then(hash => ({path:data.path,hash:Array.from(new Uint8Array(hash), n=>n.toString(16).padStart(2,'0')).join('').toUpperCase()})));
        });
      }
    };
    document.querySelector('#view').onclick = function() {
      // Use a fresh UI host because the legacy panel itself is a toggle.
      document.querySelector('#target').replaceChildren();
      window.previewResult = null;
      FortnitePreview.render(document.querySelector('#target'), window.requestedPath, this, {assetKind:'texture',maxPreviewSize:256})
        .then(r => window.previewResult=r).catch(e=>window.previewResult={state:'error',error:String(e)});
    };
  });
  const results = [];
  for (const [index,target] of fixture.selected.entries()) {
    await page.evaluate(p => window.requestedPath=p, target.path);
    await page.click('#view');
    await page.waitForFunction(()=>window.previewResult!==null,null,{timeout:300000});
    const result = await page.evaluate(async()=>({result:window.previewResult,pixels:await Promise.all(window.pixelProofs),image:{width:document.querySelector('.mesh-preview-image')?.naturalWidth,height:document.querySelector('.mesh-preview-image')?.naturalHeight}}));
    assert.equal(result.result.state,'ready',JSON.stringify(result));
    assert.equal(result.result.kind,'browser-texture');
    assert.equal(result.image.width,target.width); assert.equal(result.image.height,target.height);
    assert.ok(result.pixels.some(p=>p.path.toLowerCase()===target.path.toLowerCase() && p.hash===target.pixelsSha256),'UI did not receive matching real decoded pixels');
    await page.locator('.mesh-preview-image').screenshot({path:'fnaa-texture-'+index+'.png'});
    results.push({path:target.path,...result});
  }
  assert.ok(!requests.some(u=>/back4app|\\/api\\/(texture|preview|inspect)/i.test(u)),'Unexpected hosted parsing call');
  fs.writeFileSync('fnaa-layer8-ui-proof.json',JSON.stringify({results,relayRequests,relayBytes},null,2));
  console.log('FNAA_BUTTON_TO_NATIVE_PIXELS_PROVEN',results.length);
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
`;
const generated = path.join(nova, 'layer8-ui.generated.mjs');
fs.writeFileSync(generated,prefix+test);
const run = spawnSync(process.execPath,[generated,bundle],{cwd:nova,stdio:'inherit'});
process.exit(run.status ?? 1);
