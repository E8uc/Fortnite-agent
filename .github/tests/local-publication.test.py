import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync = load("asset_sync", "Fortnite-Ai-Agent-GitHub-Cloudflare/sync_fortnite_assets.py")
publisher = load("publisher", ".github/scripts/publish-pages.py")


class LocalPublication(unittest.TestCase):
    def test_local_import_and_rejected_corruption_preserves_current(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            assets = sync.gzip_bytes(["FortniteGame/A.uasset", "FortniteGame/B.umap"])
            manifest = {"schema": "novasparx.asset-list.v1", "fortniteVersion": "test-build",
                        "entries": 2, "bytes": len(assets), "sha256": sync.sha256_bytes(assets), "path": "assets.gz"}
            source = root / "manifest.json"
            source.write_text(json.dumps(manifest))
            (root / "assets.gz").write_bytes(assets)
            database = root / "database"
            self.assertTrue(sync.sync_local(database, source, 1)["changed"])
            self.assertFalse(sync.sync_local(database, source, 1)["changed"])
            before = (database / "fortnite_assets.gz").read_bytes()
            manifest["sha256"] = "0" * 64
            source.write_text(json.dumps(manifest))
            with self.assertRaises(sync.SyncError):
                sync.sync_local(database, source, 1)
            self.assertEqual((database / "fortnite_assets.gz").read_bytes(), before)
            manifest["path"] = "../assets.gz"
            source.write_text(json.dumps(manifest))
            with self.assertRaises(sync.SyncError):
                sync.sync_local(database, source, 1)

    def test_complete_snapshot_no_change_and_failed_publication(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            site, remote = root / "site", root / "pages.git"
            names = ["index.html", ".nojekyll", "novasparx-runtime/worker.js",
                     "novasparx-runtime/_framework/dotnet.js", "novasparx-runtime/mappings/current.usmap"]
            names += [f"novasparx-runtime/{n}/manifest.json" for n in
                      ("location-index", "studio-location-index", "package-id-index")]
            for name in names:
                path = site / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture")
            (site / "novasparx-runtime/release.json").write_text(json.dumps(
                {"schema": "fnaa.browser-release.v1", "fortniteBuild": "fixture-build"}))
            records = [{"path": p.relative_to(site).as_posix(), "bytes": p.stat().st_size,
                        "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                       for p in site.rglob("*") if p.is_file()]
            (site / ".site-inventory.json").write_text(json.dumps(
                {"schema": "fnaa.site-inventory.v1", "fortniteBuild": "fixture-build", "files": records}))
            subprocess.run(["git", "init", "--bare", str(remote)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            publisher.publish(site, str(remote), "gh-pages")
            def head():
                return subprocess.check_output(["git", "--git-dir", str(remote), "rev-parse", "gh-pages"])
            first = head()
            publisher.publish(site, str(remote), "gh-pages")
            self.assertEqual(head(), first)
            (site / "private-source.cs").write_text("must never be published")
            with self.assertRaises(ValueError):
                publisher.publish(site, str(remote), "gh-pages")
            (site / "private-source.cs").unlink()
            (site / "novasparx-runtime/mappings/current.usmap").unlink()
            with self.assertRaises(ValueError):
                publisher.publish(site, str(remote), "gh-pages")
            self.assertEqual(head(), first)


if __name__ == "__main__":
    unittest.main()
