import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('checks',ROOT/'.github/scripts/local-check-plan.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Checks(unittest.TestCase):
 def test_text_change_keeps_only_cheap_checks(self):
  self.assertFalse(m.checks_for(['README.md','LOCAL-PUBLICATION.md'])['nativeBrowserMatrix'])
 def test_actual_browser_dependencies_require_release_proof(self):
  for name in ['preview.js','novasparx-renderer.js','novasparx-texture-runtime.js','config.js','cloudflare-worker/worker.js','tools.js','asset-diagnosis.js','novasparx-core.js','novasparx-random-access.js','novasparx-associations.js']:
   with self.subTest(name=name):self.assertTrue(m.checks_for([m.SITE+name])['nativeBrowserMatrix'])
  for name in ['.github/novasparx-data.json','.github/novasparx-runtime.json','.github/runtime/new.tar.gz','.github/browser-data/new/manifest.json']:
   with self.subTest(name=name):self.assertTrue(m.checks_for([name])['productionSmoke'])
 def test_changed_browser_proof_cannot_skip_itself(self):
  for name in ['.github/tests/novasparx-production.browser.test.mjs','.github/tests/novasparx-renderer-alpha.browser.test.mjs','.github/tests/novasparx-texture-placement.browser.test.mjs']:
   with self.subTest(name=name):self.assertTrue(m.checks_for([name])['productionSmoke'])
if __name__=='__main__':unittest.main()
