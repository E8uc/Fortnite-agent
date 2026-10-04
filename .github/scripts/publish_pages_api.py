"""Stage verified public files through GitHub APIs, then promote one complete tree."""
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote


def api(endpoint, payload=None, method="GET"):
    command = ["gh", "api", endpoint, "--method", method]
    with tempfile.TemporaryDirectory(prefix="fnaa-api-") as directory:
        if payload is not None:
            request = Path(directory) / "request.json"
            request.write_text(json.dumps(payload), encoding="utf-8")
            command += ["--input", str(request)]
        return json.loads(subprocess.check_output(command, stderr=subprocess.STDOUT, text=True))


def branch_head(repository, branch):
    try:
        return api(f"repos/{repository}/git/ref/heads/{quote(branch, safe='')}")["object"]["sha"]
    except subprocess.CalledProcessError as error:
        if "HTTP 404" in (error.output or ""):
            return None
        raise


def remote_tree(repository, head):
    commit = api(f"repos/{repository}/git/commits/{head}")
    tree = commit["tree"]["sha"]
    result = api(f"repos/{repository}/git/trees/{tree}?recursive=1")
    if result.get("truncated") or any(item["type"] not in ("tree", "blob") for item in result["tree"]):
        raise ValueError("Remote staging tree is incomplete or contains unsupported entries")
    files = {item["path"]: item["sha"] for item in result["tree"] if item["type"] == "blob"}
    if any(item["mode"] != "100644" for item in result["tree"] if item["type"] == "blob"):
        raise ValueError("Remote staging tree contains links or executable files")
    return tree, files


def blob_sha(contents):
    return hashlib.sha1(b"blob " + str(len(contents)).encode() + b"\0" + contents).hexdigest()


def local_files(site):
    return {path.relative_to(site).as_posix(): blob_sha(path.read_bytes())
            for path in sorted(site.rglob("*")) if path.is_file()}


def update_ref(repository, branch, commit, existing):
    endpoint = f"repos/{repository}/git/refs"
    payload = {"ref": f"refs/heads/{branch}", "sha": commit}
    method = "POST"
    if existing:
        endpoint += f"/heads/{quote(branch, safe='')}"
        payload = {"sha": commit, "force": False}
        method = "PATCH"
    api(endpoint, payload, method)


def upload_batch(repository, branch, head, additions):
    query = """mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }"""
    result = api("graphql", {"query": query, "variables": {"input": {
        "branch": {"repositoryNameWithOwner": repository, "branchName": branch},
        "expectedHeadOid": head, "message": {"headline": "Stage verified Pages files"},
        "fileChanges": {"additions": additions},
    }}}, "POST")
    if result.get("errors"):
        raise ValueError("GitHub rejected the staging batch; Pages was not changed")
    return result["data"]["createCommitOnBranch"]["commit"]["oid"]


def publish_api(site, repository, branch, staging_branch, dry_run, validate_inventory):
    site = Path(site).resolve()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Repository must be owner/name")
    release = json.loads((site / "novasparx-runtime/release.json").read_text())
    if release.get("schema") != "fnaa.browser-release.v1":
        raise ValueError("A validated browser release is required")
    validate_inventory(site, release)
    desired = local_files(site)
    inventory_hash = hashlib.sha256((site / ".site-inventory.json").read_bytes()).hexdigest()
    staging_branch = staging_branch or f"pages-staging/{inventory_hash[:20]}"
    if staging_branch == branch or not staging_branch.startswith("pages-staging/"):
        raise ValueError("Staging must use a separate pages-staging/ branch")
    for name in (branch, staging_branch):
        subprocess.check_output(["git", "check-ref-format", "--branch", name], stderr=subprocess.STDOUT)
    if dry_run:
        print(f"Prepared {release['fortniteBuild']}; API target {repository}:{branch}; staging {staging_branch}; no publication performed")
        return

    published = branch_head(repository, branch)
    if published and remote_tree(repository, published)[1] == desired:
        print("Published branch already contains this exact site; nothing changed")
        return
    staged = branch_head(repository, staging_branch)
    staged_files = remote_tree(repository, staged)[1] if staged else {}
    if staged_files != desired:
        root = Path(__file__).resolve().parents[2]
        source_tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=root, text=True).strip()
        available = set(staged_files.values())
        try:
            api(f"repos/{repository}/git/trees/{source_tree}")
        except subprocess.CalledProcessError as error:
            if "HTTP 404" not in (error.output or ""):
                raise
        else:
            listing = subprocess.check_output(["git", "ls-tree", "-r", "-z", "HEAD"], cwd=root)
            available.update(entry.split(b"\t", 1)[0].split()[2].decode()
                             for entry in listing.split(b"\0") if entry and entry.split()[1] == b"blob")
        seed = [{"path": name, "mode": "100644", "type": "blob", "sha": sha}
                for name, sha in desired.items() if sha in available]
        tree = api(f"repos/{repository}/git/trees", {"tree": seed}, "POST")["sha"]
        parents = [staged or published] if staged or published else []
        commit = api(f"repos/{repository}/git/commits", {
            "message": "Seed verified Pages staging tree", "tree": tree, "parents": parents,
        }, "POST")["sha"]
        update_ref(repository, staging_branch, commit, staged)
        staged = commit
        pending = [(name, sha) for name, sha in desired.items() if sha not in available]
        batch, size, uploaded = [], 0, 0
        for name, sha in pending:
            contents = (site / name).read_bytes()
            if blob_sha(contents) != sha:
                raise ValueError(f"Site changed before upload: {name}")
            if batch and (len(batch) >= 50 or size + len(contents) > 6 * 1024 * 1024):
                staged = upload_batch(repository, staging_branch, staged, batch)
                uploaded += len(batch)
                print(f"Staged {uploaded}/{len(pending)} new files", flush=True)
                batch, size = [], 0
            batch.append({"path": name, "contents": base64.b64encode(contents).decode("ascii")})
            size += len(contents)
        if batch:
            staged = upload_batch(repository, staging_branch, staged, batch)
            print(f"Staged {len(pending)}/{len(pending)} new files", flush=True)

    tree, actual = remote_tree(repository, staged)
    if actual != desired or branch_head(repository, staging_branch) != staged:
        raise ValueError("Remote staging tree does not match the complete local site")
    validate_inventory(site, release)
    if local_files(site) != desired:
        raise ValueError("Site changed during staging; Pages was not changed")
    if branch_head(repository, branch) != published:
        raise ValueError("Published branch changed during staging; Pages was not changed")
    promotion = api(f"repos/{repository}/git/commits", {
        "message": f"Publish browser release {release['fortniteBuild']}",
        "tree": tree, "parents": [published] if published else [],
    }, "POST")["sha"]
    update_ref(repository, branch, promotion, published)
    print(f"Published {promotion} to {repository}:{branch}")
