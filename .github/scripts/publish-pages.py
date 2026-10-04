#!/usr/bin/env python3
"""Publish a locally assembled site to the managed Pages branch, without CI."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path, PurePosixPath


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.STDOUT, text=True).strip()


def validate_inventory(site, release, ignore_git=False):
    inventory = json.loads((site / ".site-inventory.json").read_text())
    if inventory.get("schema") != "fnaa.site-inventory.v1" or any(
            inventory.get(key) != release.get(key) for key in
            ("fortniteBuild", "runtimeSourceRevision", "dataManifestSha256")):
        raise ValueError("Assembled site inventory identity mismatch")
    expected = {}
    for record in inventory.get("files", []):
        name = record["path"]
        relative = PurePosixPath(name)
        if (not name or relative.is_absolute() or name != relative.as_posix() or
                any(part in ("..", ".git") for part in relative.parts) or "\\" in name or
                name in expected or name == ".site-inventory.json"):
            raise ValueError("Unsafe or duplicate site inventory path")
        expected[name] = record
    actual = set()
    for path in site.rglob("*"):
        if ignore_git and path.relative_to(site).parts[0] == ".git":
            continue
        if path.is_symlink():
            raise ValueError("Links are not permitted in the published site")
        if path.is_file() and path.name != ".site-inventory.json":
            actual.add(path.relative_to(site).as_posix())
    if not expected or actual != set(expected):
        raise ValueError("Assembled site has missing or undeclared files")
    for name, record in expected.items():
        path = site / name
        with path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if path.stat().st_size != record["bytes"] or digest != record["sha256"]:
            raise ValueError(f"Assembled site changed after validation: {name}")


def publish(site, remote, branch, dry_run=False):
    site = site.resolve()
    required = ["index.html", ".nojekyll", "novasparx-runtime/release.json",
                "novasparx-runtime/worker.js", "novasparx-runtime/_framework/dotnet.js",
                "novasparx-runtime/mappings/current.usmap"]
    required += [f"novasparx-runtime/{name}/manifest.json" for name in
                 ("location-index", "studio-location-index", "package-id-index")]
    for name in required:
        if not (site / name).is_file() or (name != ".nojekyll" and not (site / name).stat().st_size):
            raise ValueError(f"Incomplete assembled site: {name}")
    release = json.loads((site / "novasparx-runtime/release.json").read_text())
    if release.get("schema") != "fnaa.browser-release.v1":
        raise ValueError("A validated browser release is required")
    validate_inventory(site, release)
    if dry_run:
        print(f"Prepared {release['fortniteBuild']}; target branch {branch}; no publication performed")
        return
    with tempfile.TemporaryDirectory(prefix="fnaa-pages-") as directory:
        checkout = Path(directory)
        run("git", "init", "--initial-branch", branch, directory)
        run("git", "remote", "add", "origin", remote, cwd=checkout)
        existing = run("git", "ls-remote", "--heads", "origin", f"refs/heads/{branch}", cwd=checkout)
        if existing:
            run("git", "fetch", "--depth=1", "origin", branch, cwd=checkout)
            run("git", "reset", "--hard", "FETCH_HEAD", cwd=checkout)
        # Only the prepared public site is copied; the producer/private sources
        # and its credentials never enter the publication branch.
        for old in checkout.iterdir():
            if old.name != ".git":
                shutil.rmtree(old) if old.is_dir() else old.unlink()
        for source in site.iterdir():
            if source.name == ".git":
                raise ValueError("A Git checkout cannot be used as the assembled site")
            target = checkout / source.name
            shutil.copytree(source, target) if source.is_dir() else shutil.copy2(source, target)
        # Recheck the actual snapshot, including changes during the copy.
        validate_inventory(checkout, release, ignore_git=True)
        run("git", "add", "--all", cwd=checkout)
        if not run("git", "diff", "--cached", "--name-only", cwd=checkout):
            print("Published branch already contains this exact site; nothing pushed")
            return
        run("git", "-c", "user.name=FNAA local publisher", "-c",
            "user.email=fnaa-publisher@users.noreply.github.com", "commit", "-m",
            f"Publish browser release {release['fortniteBuild']}", cwd=checkout)
        # No force-push: a concurrent publication requires a fresh assembly/run.
        run("git", "push", "origin", f"HEAD:refs/heads/{branch}", cwd=checkout)
        print(f"Published {run('git', 'rev-parse', 'HEAD', cwd=checkout)} to {branch}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, type=Path)
    parser.add_argument("--remote", default="https://github.com/E8uc/Fortnite-agent.git")
    parser.add_argument("--branch", default="gh-pages")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        publish(args.site, args.remote, args.branch, args.dry_run)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"Publication stopped; previous site retained. Git access/push failed (exit {exc.returncode}); check local Git credentials.") from exc
    except (ValueError, OSError) as exc:
        raise SystemExit(f"Publication stopped; previous site retained: {exc}") from exc


if __name__ == "__main__":
    main()
