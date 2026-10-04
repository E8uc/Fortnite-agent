import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


transport = load("api_transport", "publish_pages_api.py")
publisher = load("publisher", "publish-pages.py")


class GitHub:
    def __init__(self, desired, git_directory, *, complete=False, source_missing=False, fail_upload=False):
        self.refs = {"gh-pages": "old", "pages-staging/test": "stage"}
        self.trees = {"old-tree": desired if complete else {"old.txt": "old-blob"},
                      "stage-tree": {name: desired[name] for name in ("index.html", "database/nested/asset.json")}}
        self.commits = {"old": {"tree": {"sha": "old-tree"}}, "stage": {"tree": {"sha": "stage-tree"}}}
        self.source_missing, self.fail_upload = source_missing, fail_upload
        self.uploads = 0
        self.git_directory, self.created_trees = git_directory, []

    def api(self, endpoint, payload=None, method="GET"):
        if "/git/ref/heads/" in endpoint:
            return {"object": {"sha": self.refs[unquote(endpoint.split("/git/ref/heads/")[1])]}}
        if "/git/commits/" in endpoint:
            return self.commits[endpoint.rsplit("/", 1)[1]]
        if "/git/trees/" in endpoint:
            name = endpoint.split("/git/trees/")[1].split("?")[0]
            if "?" not in endpoint:
                if self.source_missing:
                    raise subprocess.CalledProcessError(1, ["gh"], output="Not Found (HTTP 404)")
                return {"sha": name}
            return {"tree": [{"path": path, "sha": sha, "type": "blob", "mode": "100644"}
                             for path, sha in self.trees[name].items()]}
        if endpoint.endswith("/git/trees"):
            if any("/" in item["path"] for item in payload["tree"]):
                raise AssertionError("Tree requests must contain immediate directory entries")
            entries = b"".join(f"{item['mode']} {item['type']} {item['sha']}\t{item['path']}\0".encode()
                               for item in payload["tree"])
            name = subprocess.check_output(["git", "mktree", "--missing", "-z"],
                                           cwd=self.git_directory, input=entries).decode().strip()
            files = {}
            for item in payload["tree"]:
                if item["type"] == "blob":
                    files[item["path"]] = item["sha"]
                else:
                    files.update({item["path"] + "/" + path: sha for path, sha in self.trees[item["sha"]].items()})
            self.trees[name] = files
            self.created_trees.append(name)
            return {"sha": name}
        if endpoint.endswith("/git/commits"):
            name = f"commit-{len(self.commits)}"
            self.commits[name] = {"tree": {"sha": payload["tree"]}, "parents": payload["parents"]}
            return {"sha": name}
        if "/git/refs/heads/" in endpoint:
            self.refs[unquote(endpoint.split("/git/refs/heads/")[1])] = payload["sha"]
            return {"object": {"sha": payload["sha"]}}
        if endpoint != "graphql":
            raise AssertionError(f"Unexpected API request: {endpoint}")
        self.uploads += 1
        if self.fail_upload:
            raise subprocess.CalledProcessError(1, ["gh"], output="HTTP 503")
        data = payload["variables"]["input"]
        branch = data["branch"]["branchName"]
        if self.refs[branch] != data["expectedHeadOid"]:
            raise AssertionError("Staging changed")
        files = dict(self.trees[self.commits[self.refs[branch]]["tree"]["sha"]])
        files.update({item["path"]: transport.blob_sha(base64.b64decode(item["contents"]))
                      for item in data["fileChanges"]["additions"]})
        tree, commit = f"tree-{len(self.trees)}", f"commit-{len(self.commits)}"
        self.trees[tree] = files
        self.commits[commit] = {"tree": {"sha": tree}}
        self.refs[branch] = commit
        return {"data": {"createCommitOnBranch": {"commit": {"oid": commit}}}}


class PublicationApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.site = Path(self.temporary.name) / "site"
        self.site.mkdir()
        self.git_directory = Path(self.temporary.name) / "objects.git"
        subprocess.run(["git", "init", "--bare", "--quiet", str(self.git_directory)], check=True)
        files = {"index.html": b"public site", "database/nested/asset.json": b"public database",
                 "novasparx-runtime/release.json":
                 json.dumps({"schema": "fnaa.browser-release.v1", "fortniteBuild": "fixture"}).encode()}
        for name, contents in files.items():
            path = self.site / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(contents)
        records = [{"path": name, "bytes": len(contents), "sha256": hashlib.sha256(contents).hexdigest()}
                   for name, contents in files.items()]
        (self.site / ".site-inventory.json").write_text(json.dumps(
            {"schema": "fnaa.site-inventory.v1", "fortniteBuild": "fixture", "files": records}))
        self.desired = transport.local_files(self.site)

    def publish(self, backend):
        with patch.object(transport, "api", backend.api):
            transport.publish_api(self.site, "owner/repo", "gh-pages", "pages-staging/test",
                                  False, publisher.validate_inventory)

    def test_identical_published_site_does_not_mutate_any_branch(self):
        backend = GitHub(self.desired, self.git_directory, complete=True)
        before = dict(backend.refs), len(backend.commits), len(backend.trees)
        self.publish(backend)
        self.assertEqual((backend.refs, len(backend.commits), len(backend.trees)), before)
        self.assertEqual(backend.uploads, 0)

    def test_upload_failure_preserves_pages_when_source_tree_is_missing(self):
        backend = GitHub(self.desired, self.git_directory, source_missing=True, fail_upload=True)
        with self.assertRaises(subprocess.CalledProcessError):
            self.publish(backend)
        self.assertEqual(backend.uploads, 1)
        self.assertEqual(backend.refs["gh-pages"], "old")

    def test_missing_source_tree_can_publish_using_staged_blobs(self):
        backend = GitHub(self.desired, self.git_directory, source_missing=True)
        self.publish(backend)
        tree = backend.commits[backend.refs["gh-pages"]]["tree"]["sha"]
        self.assertEqual(backend.trees[tree], self.desired)

    def test_directory_tree_hashes_match_git_and_known_trees_are_reused(self):
        backend = GitHub(self.desired, self.git_directory)
        files = {"a.b": self.desired["index.html"], "a/file": self.desired["index.html"],
                 "a0": self.desired["index.html"]}
        known = set()
        with patch.object(transport, "api", backend.api):
            tree = transport.create_tree("owner/repo", files, known)
            before = len(backend.created_trees)
            self.assertEqual(transport.create_tree("owner/repo", files, known), tree)
        self.assertEqual(backend.trees[tree], files)
        self.assertEqual(len(backend.created_trees), before)


if __name__ == "__main__":
    unittest.main()
