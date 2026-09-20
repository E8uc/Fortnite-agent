// Browser integration: real search/card handlers, real classifiers and captured
// Dilly responses. No Fortnite build identity or rendering success is asserted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd(), process.cwd()] }));
const root = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'diagnosis-fixtures/manifest.json'))).filter(x => x.file);
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/Fortnite-agent\//, '');
  const target = path.resolve(root, pathname || 'index.html');
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    let data = fs.readFileSync(target);
    if (target.endsWith('index.html')) {
      // Keep the production DOM and load only this phase's production modules.
      data = data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      data = data.replace('</body>', ['asset-diagnosis.js', 'novasparx-core.js', 'novasparx-browser-guard.js', 'novasparx-associations.js', 'preview.js', 'tools.js'].map(s => `<script src="${s}"></script>`).join('\n') + '</body>');
    }
    res.setHeader('content-type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: {width:1280,height:9000} });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'export-service-new.dillyapis.com') {
      const candidate = url.searchParams.get('Path');
      const fixture = fixtures.find(x => x.path === candidate || x.physicalPath === candidate);
      return route.fulfill({status:200,contentType:'application/json',body:fixture ? fs.readFileSync(path.join(root,'diagnosis-fixtures',fixture.file),'utf8') : '{}'});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/Fortnite-agent/index.html`);
  const cases = [
    ...fixtures.map(x => ({path:x.physicalPath, expected:x.rootTypes[0]})),
    {path:"StaticMesh'/Game/Audio/SW_NotActuallySound.SW_NotActuallySound'",expected:'StaticMesh'},
    {path:'/CRD_AnimatedMesh/Device_AnimatedMesh.Device_AnimatedMesh_C',expected:'Blueprint'},
    {path:'/Game/S_Ambiguous.S_Ambiguous',expected:'Unknown'}
  ];
  await page.evaluate(rows => {
    window.FortniteAgent = { searchDatabase: async () => ({results:rows,source:'diagnosis fixtures'}), isSignedIn: () => true };
    // Parser presence must not by itself enable per-asset 3D or export buttons.
    window.NovaSparxLocalParser = {status:()=>({registered:true})};
    window.NovaSparxExporter = {supports:()=>true};
    window.FortniteTools.open('assets');
  }, cases);
  await page.locator('#assetQuery').fill('diagnosis');
  await page.locator('#assetSearch').click();
  await page.waitForFunction(n => document.querySelectorAll('.asset-result-card[data-asset-classified="1"]').length === n, cases.length);
  const results = await page.locator('.asset-result-card').evaluateAll(cards => cards.map(card => ({
    path:card.dataset.assetPath,kind:card.dataset.assetKind,
    tags:[...card.querySelectorAll('[data-asset-tags] span')].map(x=>x.textContent),
    previewDisabled:card.querySelector('[data-asset-action="preview"]').disabled,
    exportDisabled:card.querySelector('[data-asset-action="uefn"]').disabled
  })));
  for (let i=0;i<cases.length;i++) {
    const expected = await page.evaluate(type => window.FNAAAssetDiagnosis.kindFromType(type), cases[i].expected);
    assert.equal(results[i].kind, expected, cases[i].path);
    assert.ok(results[i].previewDisabled, cases[i].path);
    assert.ok(results[i].exportDisabled, cases[i].path);
    assert.ok(!results[i].tags.some(x=>['VISUAL','IMAGE','LOGIC'].includes(x)));
    if (expected === 'other') assert.deepEqual(results[i].tags,['ASSET']);
  }
  const generated = await page.evaluate(() => ({
    kind:window.FNAAAssetDiagnosis.diagnosePath('/CRD_AnimatedMesh/Device_AnimatedMesh.Device_AnimatedMesh_C').kind,
    compatible:window.FortniteTools.isClassCompatibleAsset("StaticMesh'/Game/BP_Test.BP_Test'")
  }));
  assert.equal(generated.kind,'blueprint');
  assert.equal(generated.compatible,false);
  assert.deepEqual(errors,[]);
  console.log(`Browser diagnosis integration passed: ${cases.length} search cards, actual DOM tags and capability buttons.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
