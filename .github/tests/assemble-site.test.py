#!/usr/bin/env python3
"""Small release fixtures exercise the local assembler without network/builds."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "assemble-site.py"
SITE = "Fortnite-Ai-Agent-GitHub-Cloudflare"
BUILD = "++Fortnite+Release-42.30-CL-58557680-Windows"
REVISION = "9" * 40


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, sort_keys=True).encode()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json_bytes(value))


def archive(files, extra=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as bundle:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            bundle.addfile(entry, io.BytesIO(data))
        if extra:
            bundle.addfile(extra)
    return output.getvalue()


class AssemblerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.site = self.root / SITE
        self.site.mkdir()
        (self.site / "index.html").write_text("tracked site")
        source_bytes = gzip.compress(b"a.uasset\nb.umap\n", mtime=0)
        (self.site / "database").mkdir()
        (self.site / "database/fortnite_assets.gz").write_bytes(source_bytes)
        write_json(self.site / "database/fortnite_assets_source.json", {"fortniteBuild": BUILD, "entries": 2, "sha256": digest(source_bytes)})
        write_json(self.site / "database/manifest.json", {"fortniteVersion": "42.30", "counts": {"all": 2}})
        write_json(self.site / "database/index-v1/manifest.json", {"fortniteVersion": "42.30", "scopes": {"all": {"count": 2}}})
        subprocess.run(["git", "-C", str(self.root), "add", SITE], check=True)
        (self.site / "untracked-secret.txt").write_text("must not publish")
        self.release_dir = self.root / ".github/runtime/data"
        self.release_dir.mkdir(parents=True)
        runtime = {
            "worker.js": b"compiled worker",
            "main.js": b"compiled entry",
            "_framework/dotnet.js": b"compiled loader",
            "_framework/app.wasm": b"wasm",
            "runtime-source.json": json_bytes({"sourceRevision": REVISION}),
        }
        self.runtime = self.root / ".github/runtime/runtime.tar.gz"
        self.runtime.write_bytes(archive(runtime))
        write_json(self.root / ".github/novasparx-runtime.json", {"archive": str(self.runtime.relative_to(self.root)), "sha256": digest(self.runtime.read_bytes()), "sourceRevision": REVISION})
        asset_bytes = gzip.compress(b"a.uasset\nb.umap\n", mtime=0)
        self.files = {
            "asset-list/manifest.json": json_bytes({"schema": "novasparx.asset-list.v1", "fortniteVersion": BUILD, "entries": 2, "bytes": len(asset_bytes), "sha256": digest(asset_bytes), "path": "fortnite_assets.gz"}),
            "asset-list/fortnite_assets.gz": asset_bytes,
            "mappings/current.usmap": b"mapping",
            "reference-index/manifest.json": json_bytes({"schema": "novasparx.asset-references.v1", "fortniteVersion": BUILD, "meshToBlueprints": {"entries": 0}, "blueprintToMeshes": {"entries": 0}}),
        }
        self.manifest_sources = {kind: {"url": f"https://fortnite-direct.dillycdn.com/{kind}.manifest", "id": kind, "fullBuild": BUILD, "hash": "a" * 40, "size": 100} for kind in ["live", "studio"]}
        self.files["manifest-sources.json"] = json_bytes(self.manifest_sources)
        self.reference_available = False
        for directory, schema in [("location-index", "novasparx.asset-locations.v1"), ("studio-location-index", "novasparx.asset-locations.v1"), ("package-id-index", "novasparx.package-locations.v1")]:
            self.files[f"{directory}/manifest.json"] = json_bytes({"schema": schema, "fortniteVersion": BUILD, "shards": 2, "path": "{shard}.json.gz"})
            for shard in ["00", "01"]:
                self.files[f"{directory}/{shard}.json.gz"] = gzip.compress(b"{}", mtime=0)
        self.save_release()
        spec = importlib.util.spec_from_file_location("assemble_site", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def save_release(self, extra=None):
        payload = archive(self.files, extra)
        part = self.release_dir / "browser-data.tar.gz.part001"
        part.write_bytes(payload)
        self.manifest = {
            "schema": "fnaa.browser-data-release.v1", "fortniteBuild": BUILD,
            "producerRevision": "a" * 40, "archiveBytes": len(payload), "archiveSha256": digest(payload), "assetCount": 2,
            "parts": [{"path": part.name, "bytes": len(payload), "sha256": digest(payload)}],
            "files": [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in self.files.items()],
            "mappings": {"path": "mappings/current.usmap", "bytes": 7, "sha256": digest(b"mapping")},
            "reference": {"available": self.reference_available}, "classes": {"available": False},
            "manifestSources": self.manifest_sources,
        }
        self.pin_manifest()

    def pin_manifest(self):
        path = self.release_dir / "manifest.json"
        write_json(path, self.manifest)
        write_json(self.root / ".github/novasparx-data.json", {"manifest": str(path.relative_to(self.root)), "sha256": digest(path.read_bytes()), "fortniteBuild": BUILD, "runtimeSourceRevision": REVISION})

    def test_complete_site_uses_only_tracked_files_and_publishes_descriptor(self):
        output = self.root / "dist"
        self.module.assemble(self.root, output)
        self.assertEqual((output / "index.html").read_text(), "tracked site")
        self.assertFalse((output / "untracked-secret.txt").exists())
        self.assertTrue((output / ".nojekyll").is_file())
        runtime = output / "novasparx-runtime"
        self.assertEqual((runtime / "mappings/current.usmap").read_bytes(), b"mapping")
        self.assertEqual((runtime / "location-index/01.json.gz").read_bytes(), self.files["location-index/01.json.gz"])
        descriptor = json.loads((runtime / "release.json").read_text())
        self.assertEqual(descriptor["schema"], "fnaa.browser-release.v1")
        self.assertEqual(descriptor["runtimeSourceRevision"], REVISION)
        self.assertEqual(descriptor["assetCount"], 2)
        self.assertEqual(descriptor["mappingsSha256"], digest(b"mapping"))
        self.assertFalse(descriptor["referencesAvailable"])
        self.assertEqual(descriptor["manifestSources"], self.manifest_sources)

    def test_runtime_only_replaces_stale_framework_without_copying_site(self):
        output = self.site / "novasparx-runtime"
        (output / "_framework").mkdir(parents=True)
        (output / "_framework/stale.wasm").write_bytes(b"old")
        self.module.assemble(self.root, output, runtime_only=True)
        self.assertFalse((output / "_framework/stale.wasm").exists())
        self.assertTrue((output / "_framework/app.wasm").is_file())
        self.assertFalse((output / "index.html").exists())
        self.assertFalse((output / ".site-inventory.json").exists())

    def test_site_inventory_covers_every_regular_output_file(self):
        output = self.root / "dist"
        self.module.assemble(self.root, output)
        inventory = json.loads((output / ".site-inventory.json").read_text())
        self.assertEqual(inventory["schema"], "fnaa.site-inventory.v1")
        self.assertEqual(inventory["fortniteBuild"], BUILD)
        self.assertEqual(inventory["runtimeSourceRevision"], REVISION)
        self.assertEqual(inventory["dataManifestSha256"], digest((self.release_dir / "manifest.json").read_bytes()))
        records = {record["path"]: record for record in inventory["files"]}
        actual = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file() and path.name != ".site-inventory.json"}
        self.assertEqual(set(records), actual)
        self.assertIn("novasparx-runtime/release.json", records)
        for name, record in records.items():
            data = (output / name).read_bytes()
            self.assertEqual(record["bytes"], len(data))
            self.assertEqual(record["sha256"], digest(data))

    def rejects_without_replacing(self, pattern):
        output = self.root / "dist"
        output.mkdir()
        (output / "previous.txt").write_text("previous valid output")
        with self.assertRaisesRegex(ValueError, pattern):
            self.module.assemble(self.root, output)
        self.assertEqual((output / "previous.txt").read_text(), "previous valid output")

    def test_part_corruption_keeps_previous_output(self):
        (self.release_dir / self.manifest["parts"][0]["path"]).write_bytes(b"corrupt")
        self.rejects_without_replacing("part.*(size|SHA-256)")

    def test_archive_member_must_be_in_inventory(self):
        extra = tarfile.TarInfo("unexpected.txt")
        self.save_release(extra)
        self.rejects_without_replacing("inventory")

    def test_symlinks_are_rejected(self):
        extra = tarfile.TarInfo("location-index/link")
        extra.type = tarfile.SYMTYPE
        extra.linkname = "../../outside"
        self.save_release(extra)
        self.rejects_without_replacing("regular file|link")

    def test_traversal_is_rejected(self):
        extra = tarfile.TarInfo("../../outside")
        self.save_release(extra)
        self.rejects_without_replacing("Unsafe")
        self.assertFalse((self.root.parent / "outside").exists())

    def test_wrong_index_build_keeps_previous_output(self):
        self.files["location-index/manifest.json"] = json_bytes({"schema": "novasparx.asset-locations.v1", "fortniteVersion": "wrong", "shards": 2, "path": "{shard}.json.gz"})
        self.save_release()
        self.rejects_without_replacing("build")

    def test_runtime_revision_mismatch_keeps_previous_output(self):
        pin = json.loads((self.root / ".github/novasparx-runtime.json").read_text())
        pin["sourceRevision"] = "b" * 40
        write_json(self.root / ".github/novasparx-runtime.json", pin)
        self.rejects_without_replacing("revision")

    def test_missing_shard_keeps_previous_output(self):
        del self.files["package-id-index/01.json.gz"]
        self.save_release()
        self.rejects_without_replacing("shard")

    def test_inventory_hash_mismatch_keeps_previous_output(self):
        self.manifest["files"][0]["sha256"] = "0" * 64
        self.pin_manifest()
        self.rejects_without_replacing("SHA-256")

    def test_full_output_cannot_replace_source_site(self):
        with self.assertRaisesRegex(ValueError, "source site"):
            self.module.assemble(self.root, self.site)

    def test_wrong_pinned_manifest_build_keeps_previous_output(self):
        self.manifest_sources["studio"]["fullBuild"] = "++Fortnite+Release-42.30-CL-OTHER-Windows"
        self.files["manifest-sources.json"] = json_bytes(self.manifest_sources)
        self.save_release()
        self.rejects_without_replacing("manifest source build")

    def test_search_same_version_but_wrong_build_keeps_previous_output(self):
        source = self.site / "database/fortnite_assets_source.json"
        write_json(source, {"fortniteBuild": "++Fortnite+Release-42.30-CL-OTHER-Windows", "entries": 2, "sha256": digest((self.site / "database/fortnite_assets.gz").read_bytes())})
        self.rejects_without_replacing("search.*build")

    def test_second_valid_assembly_replaces_previous_output(self):
        output = self.root / "dist"
        self.module.assemble(self.root, output)
        (output / "obsolete.txt").write_text("old")
        self.module.assemble(self.root, output)
        self.assertFalse((output / "obsolete.txt").exists())
        self.assertEqual((output / "index.html").read_text(), "tracked site")

    def test_reference_availability_requires_actual_shards(self):
        self.reference_available = True
        reference = json.loads(self.files["reference-index/manifest.json"])
        reference["meshToBlueprints"] = {"entries": 1, "path": "mesh/{shard}.json.gz"}
        self.files["reference-index/manifest.json"] = json_bytes(reference)
        self.save_release()
        self.rejects_without_replacing("reference.*count|Reference.*count")

    def test_valid_sparse_reference_shards_are_available(self):
        self.reference_available = True
        reference = json.loads(self.files["reference-index/manifest.json"])
        for family, directory, property_name, source, target in [
            ("meshToBlueprints", "mesh", "blueprints", "/game/mesh", "/Game/Blueprint"),
            ("blueprintToMeshes", "blueprint", "meshes", "/game/blueprint", "/Game/Mesh"),
        ]:
            value = 2166136261
            for byte in source.encode():
                value = ((value ^ byte) * 16777619) & 0xffffffff
            shard = f"{value & 255:02x}"
            reference[family] = {"entries": 1, "path": f"{directory}/{{shard}}.json.gz"}
            self.files[f"reference-index/{directory}/{shard}.json.gz"] = gzip.compress(json_bytes({"schema": "novasparx.asset-references.v1", "valueProperty": property_name, "items": {source: [target]}}), mtime=0)
        self.files["reference-index/manifest.json"] = json_bytes(reference)
        self.save_release()
        descriptor = self.module.assemble(self.root, self.root / "dist")
        self.assertTrue(descriptor["referencesAvailable"])


if __name__ == "__main__":
    unittest.main()
