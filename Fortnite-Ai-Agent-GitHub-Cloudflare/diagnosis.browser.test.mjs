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
      data = data.replace('</body>', ['asset-diagnosis.js', 'novasparx-core.js', 'novasparx-browser-guard.js', 'novasparx-associations.js', 'novasparx-texture-runtime.js', 'preview.js', 'tools.js'].map(s => `<script src="${s}"></script>`).join('\n') + '</body>');
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
      const candidate = url.searchParams.get('path') || url.searchParams.get('Path');
      if (candidate === 'FortniteGame/Content/Audio/SC_NotDirect.uasset') {
        return route.fulfill({
          status:200,
          contentType:'application/json',
          body:JSON.stringify({
            jsonOutput:[{
              Type:'SoundCue',
              Name:'SC_NotDirect',
              Properties:{
                Wave:{
                  Type:'SoundWave',
                  ObjectName:'SoundWave SW_Linked',
                  ObjectPath:'/Game/Audio/SW_Linked.SW_Linked'
                }
              }
            }]
          })
        });
      }

      if (
        candidate ===
        'FortniteGame/Plugins/GameFeatures/Train/Content/Sound/Cues/Cue_Train_Bells.uasset'
      ) {
        return route.fulfill({
          status:200,
          contentType:'application/json',
          body:JSON.stringify({
            jsonOutput:[
              {
                Type:'SoundCue',
                Name:'Cue_Train_Bells',
                Properties:{
                  FirstNode:{
                    ObjectName:"SoundNodeWavePlayer'Cue_Train_Bells:SoundNodeWavePlayer_0'",
                    ObjectPath:'/Train/Sound/Cues/Cue_Train_Bells.3'
                  }
                }
              },
              {
                Type:'SoundNodeWavePlayer',
                Name:'SoundNodeWavePlayer_0',
                Properties:{
                  SoundWaveAssetPtr:{
                    AssetPathName:'/Train/Sound/MS/MSS_Train_Exterior_Bells.MSS_Train_Exterior_Bells',
                    SubPathString:''
                  }
                },
                SoundWave:{
                  ObjectName:"MetaSoundSource'MSS_Train_Exterior_Bells'",
                  ObjectPath:'/Train/Sound/MS/MSS_Train_Exterior_Bells.0'
                }
              }
            ]
          })
        });
      }

      if (
        candidate ===
        'FortniteGame/Plugins/GameFeatures/Train/Content/Sound/MS/MSS_Train_Exterior_Bells.uasset'
      ) {
        return route.fulfill({
          status:200,
          contentType:'application/json',
          body:JSON.stringify({
            jsonOutput:[{
              Type:'MetaSoundSource',
              Name:'MSS_Train_Exterior_Bells',
              Properties:{
                RootMetasoundDocument:{
                  RootGraph:{
                    Interface:{
                      Inputs:[{
                        Name:'Variations',
                        TypeName:'WaveAsset:Array',
                        Defaults:[{
                          Literal:{
                            Type:'EMetasoundFrontendLiteralType::UObjectArray',
                            AsUObject:[{
                              ObjectName:"SoundWave'Train_Proto_Bells_Close'",
                              ObjectPath:'/Train/Sound/Waves/Locomotion/S28/Train_Proto_Bells_Close.0'
                            }]
                          }
                        }]
                      }]
                    }
                  }
                }
              }
            }]
          })
        });
      }
      const fixture = fixtures.find(x => x.path === candidate || x.physicalPath === candidate);
      return route.fulfill({status:200,contentType:'application/json',body:fixture ? fs.readFileSync(path.join(root,'diagnosis-fixtures',fixture.file),'utf8') : '{}'});
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/Fortnite-agent/index.html`);
  const downloadFormatProof =
    await page.evaluate(
      () => ({
        texture:
          window.NovaSparxAssociations
            .capabilityProfile(
              "texture"
            )
            .downloadFormats,
        audio:
          window.NovaSparxAssociations
            .capabilityProfile(
              "audio"
            )
            .downloadFormats
      })
    );

  assert.deepEqual(
    downloadFormatProof.texture,
    ["json", "png"]
  );

  assert.deepEqual(
    downloadFormatProof.audio,
    ["json", "wav"]
  );

  console.log(
    "FNAA_DOWNLOAD_FORMATS_PROVEN",
    JSON.stringify(
      downloadFormatProof
    )
  );


  const cases = [
    ...fixtures.map(x => ({path:x.physicalPath, expected:x.rootTypes[0]})),
    {path:"StaticMesh'/Game/Audio/SW_NotActuallySound.SW_NotActuallySound'",expected:'StaticMesh'},
    {path:"Texture2D'/Game/Test/T_Layer8_Probe.T_Layer8_Probe'",expected:'Texture2D'},
    {path:'/Game/Audio/SW_ListenProof.SW_ListenProof',expected:'SoundWave',listen:true},
    {path:"SoundCue'/Game/Audio/SC_NotDirect.SC_NotDirect'",expected:'SoundCue',listen:true},
    {path:'/CRD_AnimatedMesh/Device_AnimatedMesh.Device_AnimatedMesh_C',expected:'Blueprint'},
    {path:'/Game/S_Ambiguous.S_Ambiguous',expected:'Unknown'}
  ];
  await page.evaluate(rows => {
    const canonicalSoundWave =
      'FortniteGame/Plugins/GameFeatures/TestAudio/Content/Audio/SW_RefOnly.uasset';

    window.FortniteAgent = {
      searchDatabase: async (_scope, query) => {
        if (String(query || '').toLowerCase() === 'sw_refonly') {
          return {
            results:[
              {
                path:canonicalSoundWave,
                match:'exact',
                source:'diagnosis canonical audio fixture'
              }
            ],
            source:'diagnosis canonical audio fixture'
          };
        }

        if (
          String(query || '').toLowerCase() ===
          'train_proto_bells_close'
        ) {
          return {
            results:[
              {
                path:'FortniteGame/Plugins/GameFeatures/Train/Content/Sound/Waves/Locomotion/S28/Train_Proto_Bells_Close.uasset',
                match:'exact',
                source:'diagnosis train metasound fixture'
              }
            ],
            source:'diagnosis train metasound fixture'
          };
        }

        return {
          results:rows,
          source:'diagnosis fixtures'
        };
      },

      apiFetch: async (url) => {
        const value =
          String(url || '');

        if (value.startsWith('/nova/references?')) {
          const parsed =
            new URL(
              value,
              location.origin
            );

          const requested =
            parsed.searchParams.get('path') ||
            '';

          if (
            requested.includes(
              'SC_RefOnly'
            )
          ) {
            return new Response(
              JSON.stringify({
                state:'ready',
                references:[
                  {
                    kind:'property:Wave',
                    path:'/OldAudioMount/Audio/SW_RefOnly.SW_RefOnly'
                  }
                ]
              }),
              {
                status:200,
                headers:{
                  'content-type':'application/json'
                }
              }
            );
          }

          return new Response(
            JSON.stringify({
              state:'ready',
              references:[]
            }),
            {
              status:200,
              headers:{
                'content-type':'application/json'
              }
            }
          );
        }

        return new Response(
          '{}',
          {
            status:404,
            headers:{
              'content-type':'application/json'
            }
          }
        );
      },

      isSignedIn: () => true
    };

    // Parser presence must not by itself enable per-asset 3D or export buttons.
    window.NovaSparxLocalParser = {status:()=>({registered:true})};
    window.NovaSparxExporter = {supports:()=>true};
    window.FortniteTools.open('assets');
  }, cases);
  await page.locator('#assetQuery').fill('diagnosis');
  await page.locator('#assetSearch').click();
  await page.waitForFunction(n => document.querySelectorAll('.asset-result-card[data-asset-classified="1"]').length === n, cases.length);
  const results = await page.locator('.asset-result-card').evaluateAll(cards => cards.map(card => ({
    path:card.dataset.assetPath,
    kind:card.dataset.assetKind,
    tags:[...card.querySelectorAll('[data-asset-tags] span')].map(x=>x.textContent),
    previewText:card.querySelector('[data-asset-action="preview"]').textContent,
    previewDisabled:card.querySelector('[data-asset-action="preview"]').disabled,
    exportDisabled:card.querySelector('[data-asset-action="uefn"]').disabled
  })));

  let textureIndex = -1;
  let audioIndex = -1;

  for (let i=0;i<cases.length;i++) {
    const expected = await page.evaluate(type => window.FNAAAssetDiagnosis.kindFromType(type), cases[i].expected);
    assert.equal(results[i].kind, expected, cases[i].path);

    if (expected === 'texture' || expected === 'staticmesh') {
      if (expected === 'texture') textureIndex = i;
      assert.equal(results[i].previewDisabled, false, cases[i].path);
      assert.equal(results[i].previewText, 'View Image', cases[i].path);
    } else if (
      expected === 'audio' &&
      cases[i].listen === true
    ) {
      audioIndex = i;
      assert.equal(results[i].previewDisabled, false, cases[i].path);
      assert.equal(results[i].previewText, 'Listen', cases[i].path);
    } else {
      assert.ok(results[i].previewDisabled, cases[i].path);
    }

    assert.ok(results[i].exportDisabled, cases[i].path);
    assert.ok(!results[i].tags.some(x=>['VISUAL','IMAGE','LOGIC'].includes(x)));
    if (expected === 'other') assert.deepEqual(results[i].tags,['ASSET']);
  }

  assert.ok(textureIndex >= 0, 'Diagnosis fixtures contain no Texture case for View Image regression.');

  const clickProof = await page.evaluate(async textureIndex => {
    const cards = [...document.querySelectorAll('.asset-result-card')];
    const card = cards[textureIndex];
    const button = card?.querySelector('[data-asset-action="preview"]');

    if (!card || !button || button.disabled) {
      throw new Error('Texture View Image button is not actionable.');
    }

    let call = null;

    window.FortnitePreview = {
      toggle: async (host, path, _button, options) => {
        call = {
          path,
          assetKind:options?.assetKind || ''
        };

        host.innerHTML = '<img data-proof-image alt="proof" />';

        return {
          state:'ready',
          kind:'texture'
        };
      },
      release: () => {}
    };

    button.click();

    const deadline = Date.now() + 3000;

    while (!call && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    if (!call) {
      throw new Error('Texture View Image click never reached FortnitePreview.toggle().');
    }

    return {
      call,
      panelVisible:card.querySelector('[data-asset-panel]')?.hidden === false,
      label:button.textContent
    };
  }, textureIndex);

  assert.equal(clickProof.call.assetKind, 'texture');
  assert.ok(clickProof.call.path);
  assert.equal(clickProof.panelVisible, true);

  console.log(
    'FNAA_TEXTURE_VIEW_IMAGE_CLICK_PROVEN',
    JSON.stringify(clickProof)
  );

  assert.ok(
    audioIndex >= 0,
    'Diagnosis cases contain no direct SoundWave Listen case.'
  );

  const audioClickProof =
    await page.evaluate(
      async audioIndex => {
        const cards =
          [
            ...document.querySelectorAll(
              '.asset-result-card'
            )
          ];

        const card =
          cards[audioIndex];

        const button =
          card?.querySelector(
            '[data-asset-action="preview"]'
          );

        if (
          !card ||
          !button ||
          button.disabled
        ) {
          throw new Error(
            'SoundWave Listen button is not actionable.'
          );
        }

        let call = null;

        window.FortnitePreview = {
          toggle:
            async (
              host,
              path,
              _button,
              options
            ) => {
              call = {
                path,
                assetKind:
                  options
                    ?.assetKind ||
                  ''
              };

              host.innerHTML =
                '<audio data-proof-audio></audio>';

              return {
                state:
                  'ready',
                kind:
                  'audio'
              };
            },
          release:
            () => {}
        };

        button.click();

        const deadline =
          Date.now() +
          3000;

        while (
          !call &&
          Date.now() <
            deadline
        ) {
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                20
              )
          );
        }

        if (!call) {
          throw new Error(
            'SoundWave Listen click never reached FortnitePreview.toggle().'
          );
        }

        return {
          call,
          panelVisible:
            card.querySelector(
              '[data-asset-panel]'
            )?.hidden ===
            false,
          label:
            button.textContent
        };
      },
      audioIndex
    );

  assert.equal(
    audioClickProof.call.assetKind,
    'audio'
  );

  assert.equal(
    audioClickProof.panelVisible,
    true
  );

  assert.equal(
    audioClickProof.label,
    'Hide'
  );

  console.log(
    'FNAA_SOUNDWAVE_LISTEN_CLICK_PROVEN',
    JSON.stringify(
      audioClickProof
    )
  );
  const linkedAudioProof =
    await page.evaluate(
      async () =>
        await window.FortniteTools
          .resolveSoundWavePaths(
            "SoundCue'/Game/Audio/SC_NotDirect.SC_NotDirect'"
          )
    );

  assert.deepEqual(
    linkedAudioProof,
    [
      'FortniteGame/Content/Audio/SW_Linked.uasset'
    ]
  );

  console.log(
    'FNAA_LINKED_SOUNDWAVE_RESOLUTION_PROVEN',
    JSON.stringify(linkedAudioProof)
  );

  const referenceOnlyAudioProof =
    await page.evaluate(
      async () =>
        await window.FortniteTools
          .resolveAudioCandidatePaths(
            "SoundCue'/Game/Audio/SC_RefOnly.SC_RefOnly'"
          )
    );

  assert.ok(
    referenceOnlyAudioProof.includes(
      'FortniteGame/Plugins/GameFeatures/TestAudio/Content/Audio/SW_RefOnly.uasset'
    ),
    JSON.stringify(referenceOnlyAudioProof)
  );

  assert.ok(
    !referenceOnlyAudioProof.includes(
      'FortniteGame/Plugins/GameFeatures/OldAudioMount/Content/Audio/SW_RefOnly.uasset'
    ),
    JSON.stringify(referenceOnlyAudioProof)
  );

  console.log(
    'FNAA_REFERENCE_ONLY_AUDIO_CANONICALIZATION_PROVEN',
    JSON.stringify(
      referenceOnlyAudioProof
    )
  );

  const trainMetaSoundProof =
    await page.evaluate(
      async () =>
        await window.FortniteTools
          .resolveAudioCandidatePaths(
            'FortniteGame/Plugins/GameFeatures/Train/Content/Sound/Cues/Cue_Train_Bells.uasset'
          )
    );

  assert.ok(
    trainMetaSoundProof.includes(
      'FortniteGame/Plugins/GameFeatures/Train/Content/Sound/Waves/Locomotion/S28/Train_Proto_Bells_Close.uasset'
    ),
    JSON.stringify(
      trainMetaSoundProof
    )
  );

  console.log(
    'FNAA_TRAIN_METASOUND_WAVE_RESOLUTION_PROVEN',
    JSON.stringify(
      trainMetaSoundProof
    )
  );

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
