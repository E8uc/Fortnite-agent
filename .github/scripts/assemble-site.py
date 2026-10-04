#!/usr/bin/env python3
"""Assemble FNAA from tracked files and local, checksum-pinned releases.

No network access, credentials, Actions artifacts or source builds are used.
All validation happens in staging before an existing output changes.
"""
import argparse
import ctypes
import errno
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit

SITE = "Fortnite-Ai-Agent-GitHub-Cloudflare"
HASH = re.compile(r"[a-f0-9]{64}")
REVISION = re.compile(r"[a-f0-9]{40}")
DATA_ROOTS = {"asset-list", "location-index", "studio-location-index", "package-id-index", "reference-index", "mappings", "manifest-sources.json"}
RUNTIME_ROOTS = {"_framework", "worker.js", "main.js", "runtime-source.json"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(value):
    require(isinstance(value, str) and value, "Unsafe empty release path")
    path = PurePosixPath(value)
    require(path.parts and not path.is_absolute() and value == path.as_posix() and
            all(part not in (".", "..", "") and ":" not in part and "\\" not in part for part in path.parts),
            f"Unsafe release path: {value}")
    return path


def local_file(root, value):
    relative = safe_path(value)
    path = root.joinpath(*relative.parts)
    require(path.resolve().is_relative_to(root.resolve()) and not path.is_symlink() and path.is_file(),
            f"Missing or unsafe local release file: {value}")
    return path


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    require(isinstance(value, dict), f"Expected JSON object: {path}")
    return value


def valid_hash(value, label):
    require(isinstance(value, str) and HASH.fullmatch(value), f"Invalid SHA-256 for {label}")
    return value


def valid_revision(value, label):
    require(isinstance(value, str) and REVISION.fullmatch(value), f"Invalid source revision for {label}")
    return value


def valid_size(value, label):
    require(type(value) is int and value >= 0, f"Invalid size for {label}")
    return value


def sha256(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def verify_file(path, record, label):
    require(path.stat().st_size == valid_size(record.get("bytes"), label), f"{label} size mismatch")
    require(sha256(path) == valid_hash(record.get("sha256"), label), f"{label} SHA-256 mismatch")


def unpack(archive, destination, roots, inventory=None):
    """Copy only regular declared members; never let tar resolve paths or links."""
    seen = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            name = member.name.removeprefix("./")
            if name in ("", ".") and member.isdir():
                continue
            relative = safe_path(name)
            require(relative.parts[0] in roots, f"Archive member outside inventory: {name}")
            require(member.isdir() or member.isreg(), f"Archive member must be a regular file or directory, never a link: {name}")
            if member.isdir():
                continue
            require(name not in seen, f"Duplicate archive member: {name}")
            seen.add(name)
            if inventory is not None:
                require(name in inventory, f"Archive member missing from inventory: {name}")
                require(member.size == inventory[name]["bytes"], f"Inventory size mismatch: {name}")
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            if inventory is not None:
                verify_file(target, inventory[name], name)
    if inventory is not None:
        require(seen == set(inventory), "Archive is missing inventory files")


def extract_runtime(root, destination, expected_revision):
    pin = read_json(root / ".github/novasparx-runtime.json")
    revision = valid_revision(pin.get("sourceRevision"), "runtime pin")
    require(revision == expected_revision, "Runtime source revision does not match data pin")
    archive = local_file(root, pin.get("archive"))
    require(sha256(archive) == valid_hash(pin.get("sha256"), "runtime archive"), "Runtime archive SHA-256 mismatch")
    unpack(archive, destination, RUNTIME_ROOTS)
    for required in ["worker.js", "main.js", "_framework/dotnet.js", "runtime-source.json"]:
        require((destination / required).is_file() and (destination / required).stat().st_size > 0,
                f"Missing compiled runtime file: {required}")
    require(any((destination / "_framework").rglob("*.wasm")), "Missing compiled WebAssembly runtime")
    source = read_json(destination / "runtime-source.json")
    require(source.get("sourceRevision") == revision, "Compiled runtime source revision mismatch")
    return revision


def validate_references(destination, manifest, inventory):
    """Reference buckets are sparse; entries count source keys, not targets."""
    available = False
    for family, directory, property_name in [
        ("meshToBlueprints", "mesh", "blueprints"),
        ("blueprintToMeshes", "blueprint", "meshes"),
    ]:
        metadata = manifest.get(family)
        require(isinstance(metadata, dict) and type(metadata.get("entries")) is int and metadata["entries"] >= 0,
                f"Invalid reference count: {family}")
        expected = metadata["entries"]
        if expected:
            require(metadata.get("path") == f"{directory}/{{shard}}.json.gz", f"Invalid reference shard path: {family}")
        prefix = f"reference-index/{directory}/"
        keys = set()
        for name in inventory:
            if not name.startswith(prefix):
                continue
            require(re.fullmatch(re.escape(prefix) + r"[a-f0-9]{2}\.json\.gz", name), f"Invalid reference shard filename: {name}")
            with gzip.open(destination / name, "rt", encoding="utf-8") as handle:
                bucket = json.load(handle)
            require(isinstance(bucket, dict) and bucket.get("schema") == "novasparx.asset-references.v1" and
                    bucket.get("valueProperty") == property_name and isinstance(bucket.get("items"), dict),
                    f"Invalid reference shard schema: {name}")
            for source, targets in bucket["items"].items():
                require(isinstance(source, str) and source.startswith("/") and source == source.lower() and source not in keys,
                        f"Invalid or duplicate reference source: {name}")
                require(isinstance(targets, list) and targets and all(isinstance(target, str) and target.startswith("/") for target in targets),
                        f"Invalid reference targets: {name}")
                hashed = 2166136261
                for byte in source.encode("utf-8"):
                    hashed = ((hashed ^ byte) * 16777619) & 0xffffffff
                require(name == f"{prefix}{hashed & 255:02x}.json.gz", f"Reference source routed to wrong shard: {name}")
                keys.add(source)
        require(len(keys) == expected, f"Reference shard count mismatch: {family}")
        available = available or bool(keys)
    return available


def extract_data(root, destination, scratch):
    pin = read_json(root / ".github/novasparx-data.json")
    manifest_path = local_file(root, pin.get("manifest"))
    manifest_hash = valid_hash(pin.get("sha256"), "data manifest")
    require(sha256(manifest_path) == manifest_hash, "Data manifest SHA-256 mismatch")
    manifest = read_json(manifest_path)
    require(manifest.get("schema") == "fnaa.browser-data-release.v1", "Unexpected browser data release schema")
    build = pin.get("fortniteBuild")
    require(isinstance(build, str) and build and manifest.get("fortniteBuild") == build, "Data release build mismatch")
    revision = valid_revision(pin.get("runtimeSourceRevision"), "data pin")
    valid_revision(manifest.get("producerRevision"), "data producer")
    require(type(manifest.get("assetCount")) is int and manifest["assetCount"] > 0, "Invalid release asset count")
    parts = manifest.get("parts")
    require(isinstance(parts, list) and parts, "Missing release archive parts")
    archive = scratch / "browser-data.tar.gz"
    part_names = set()
    with archive.open("xb") as output:
        for record in parts:
            require(isinstance(record, dict), "Invalid archive part record")
            name = str(safe_path(record.get("path")))
            require(name not in part_names, f"Duplicate archive part: {name}")
            part_names.add(name)
            part = local_file(manifest_path.parent, name)
            verify_file(part, record, f"Archive part {name}")
            with part.open("rb") as source:
                shutil.copyfileobj(source, output)
    require(archive.stat().st_size == valid_size(manifest.get("archiveBytes"), "data archive"), "Data archive size mismatch")
    require(sha256(archive) == valid_hash(manifest.get("archiveSha256"), "data archive"), "Data archive SHA-256 mismatch")
    records = manifest.get("files")
    require(isinstance(records, list) and records, "Missing data file inventory")
    inventory = {}
    for record in records:
        require(isinstance(record, dict), "Invalid file inventory record")
        name = str(safe_path(record.get("path")))
        require(name not in inventory, f"Duplicate inventory path: {name}")
        valid_size(record.get("bytes"), name)
        valid_hash(record.get("sha256"), name)
        inventory[name] = record
    unpack(archive, destination, DATA_ROOTS, inventory)
    for directory, schema in [("location-index", "novasparx.asset-locations.v1"), ("studio-location-index", "novasparx.asset-locations.v1"), ("package-id-index", "novasparx.package-locations.v1")]:
        index = read_json(destination / directory / "manifest.json")
        require(index.get("schema") == schema, f"Unexpected {directory} schema")
        require(index.get("fortniteVersion") == build, f"{directory} build mismatch")
        count = index.get("shards")
        require(type(count) is int and 0 < count <= 256 and index.get("path") == "{shard}.json.gz", f"Invalid {directory} shard contract")
        for shard in range(count):
            require(f"{directory}/{shard:02x}.json.gz" in inventory, f"Missing {directory} shard {shard:02x}")
    assets = read_json(destination / "asset-list/manifest.json")
    require(assets.get("schema") == "novasparx.asset-list.v1" and assets.get("fortniteVersion") == build, "Asset-list build/schema mismatch")
    require(assets.get("entries") == manifest["assetCount"], "Asset-list count mismatch")
    asset_path = destination / "asset-list" / str(safe_path(assets.get("path")))
    require(asset_path.is_file(), "Missing asset-list gzip")
    verify_file(asset_path, assets, "Asset-list gzip")
    reference = read_json(destination / "reference-index/manifest.json")
    require(reference.get("schema") == "novasparx.asset-references.v1" and reference.get("fortniteVersion") == build, "Reference-index build/schema mismatch")
    reference_available = validate_references(destination, reference, inventory)
    require(manifest.get("reference", {}).get("available") is reference_available, "Reference availability mismatch")
    mapping = manifest.get("mappings")
    require(isinstance(mapping, dict) and mapping.get("path") == "mappings/current.usmap", "Missing mappings contract")
    mapping_path = destination / "mappings/current.usmap"
    require(mapping_path.is_file() and mapping_path.stat().st_size > 0, "Missing current mappings")
    verify_file(mapping_path, mapping, "Mappings")
    sources = manifest.get("manifestSources")
    require(isinstance(sources, dict) and read_json(destination / "manifest-sources.json") == sources, "Manifest source inventory mismatch")
    for kind in ["live", "studio"]:
        source = sources.get(kind)
        require(isinstance(source, dict) and source.get("fullBuild") == build, f"{kind} manifest source build mismatch")
        url = urlsplit(source.get("url", ""))
        require(url.scheme == "https" and url.hostname in {"fortnite-direct.dillycdn.com", "stormforge.dillycdn.com"} and not url.username and not url.password and url.port in (None, 443), f"Unsafe {kind} manifest source URL")
        require(isinstance(source.get("id"), str) and source["id"] and isinstance(source.get("hash"), str) and source["hash"] and type(source.get("size")) is int and source["size"] > 0, f"Invalid {kind} manifest source metadata")
    return {
        "schema": "fnaa.browser-release.v1", "fortniteBuild": build,
        "assetCount": manifest["assetCount"], "producerRevision": manifest["producerRevision"],
        "runtimeSourceRevision": revision, "dataManifestSha256": manifest_hash,
        "mappingsSha256": mapping["sha256"], "classesAvailable": False,
        "referencesAvailable": reference_available, "manifestSources": sources,
    }


def copy_tracked_site(root, destination):
    result = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--", SITE], check=True, stdout=subprocess.PIPE)
    copied = 0
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        relative = Path(os.fsdecode(raw))
        source = root / relative
        if not source.exists() and not source.is_symlink():
            continue
        require(source.is_file() and not source.is_symlink(), f"Unsafe tracked site file: {relative}")
        site_relative = relative.relative_to(SITE)
        if site_relative.parts[0] == "novasparx-runtime":
            continue
        target = destination / site_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        copied += 1
    require(copied and (destination / "index.html").is_file(), "Missing tracked site index.html")
    (destination / ".nojekyll").touch()


def validate_search(site, release):
    match = re.search(r"Release-(\d+(?:\.\d+)?)", release["fortniteBuild"])
    require(match, "Cannot normalize Fortnite build for search database")
    version = match.group(1)
    manifest = read_json(site / "database/manifest.json")
    index = read_json(site / "database/index-v1/manifest.json")
    source = read_json(site / "database/fortnite_assets_source.json")
    assets = read_json(site / "novasparx-runtime/asset-list/manifest.json")
    require(source.get("fortniteBuild") == release["fortniteBuild"], "Tracked search source build does not match data release")
    require(source.get("entries") == release["assetCount"] and source.get("sha256") == assets.get("sha256"),
            "Tracked search source does not match release asset list")
    require(sha256(site / "database/fortnite_assets.gz") == source["sha256"], "Tracked search source SHA-256 mismatch")
    require(manifest.get("fortniteVersion") == version and index.get("fortniteVersion") == version,
            "Tracked search database build does not match data release")
    require(manifest.get("counts", {}).get("all") == release["assetCount"] and
            index.get("scopes", {}).get("all", {}).get("count") == release["assetCount"],
            "Tracked search database count does not match data release")


def write_site_inventory(site, release):
    records = []
    for path in sorted(site.rglob("*")):
        require(not path.is_symlink(), f"Site inventory cannot contain links: {path}")
        if path.is_dir():
            continue
        require(path.is_file(), f"Site inventory requires regular files: {path}")
        relative = path.relative_to(site).as_posix()
        if relative == ".site-inventory.json":
            continue
        records.append({"path": relative, "bytes": path.stat().st_size, "sha256": sha256(path)})
    inventory = {
        "schema": "fnaa.site-inventory.v1", "fortniteBuild": release["fortniteBuild"],
        "runtimeSourceRevision": release["runtimeSourceRevision"],
        "dataManifestSha256": release["dataManifestSha256"], "files": records,
    }
    (site / ".site-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")


def install_directory(staged, output):
    if not output.exists():
        os.replace(staged, output)
        return
    require(output.is_dir() and not output.is_symlink(), "Output must be a real directory")
    # Linux exchanges nonempty directories atomically; the old output becomes staged.
    exchange = getattr(ctypes.CDLL(None, use_errno=True), "renameat2", None)
    if exchange is not None:
        exchange.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        exchange.restype = ctypes.c_int
        if exchange(-100, os.fsencode(staged), -100, os.fsencode(output), 2) == 0:
            return
        error = ctypes.get_errno()
        if error not in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP):
            raise OSError(error, os.strerror(error))
    backup = staged.parent / "previous-output"
    os.replace(output, backup)
    try:
        os.replace(staged, output)
    except BaseException:
        os.replace(backup, output)
        raise


def assemble(root, output, runtime_only=False):
    root = Path(root).resolve()
    output_path = Path(output).absolute()
    require(not output_path.is_symlink(), "Output must not be a symlink")
    output = output_path.resolve()
    require(output != root and not root.is_relative_to(output), "Output cannot replace the repository")
    source_site = root / SITE
    if not runtime_only:
        require(not output.is_relative_to(source_site), "Output cannot replace or be inside the source site")
    else:
        require(output != source_site and not source_site.is_relative_to(output), "Runtime output cannot replace the source site")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".fnaa-assemble-", dir=output.parent) as temporary:
        scratch = Path(temporary)
        staged = scratch / "output"
        staged.mkdir()
        if not runtime_only:
            copy_tracked_site(root, staged)
        runtime = staged if runtime_only else staged / "novasparx-runtime"
        runtime.mkdir(parents=True, exist_ok=True)
        descriptor = extract_data(root, runtime, scratch)
        extract_runtime(root, runtime, descriptor["runtimeSourceRevision"])
        if not runtime_only:
            validate_search(staged, descriptor)
        (runtime / "release.json").write_text(json.dumps(descriptor, indent=2) + "\n", encoding="utf-8")
        if not runtime_only:
            write_site_inventory(staged, descriptor)
        install_directory(staged, output)
    return descriptor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Publication directory (or runtime directory with --runtime-only)")
    parser.add_argument("--runtime-only", action="store_true", help="Assemble only the complete browser runtime for local tests")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    try:
        release = assemble(root, arguments.output, arguments.runtime_only)
    except (ValueError, OSError, KeyError, TypeError, tarfile.TarError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"FNAA assembly failed: {error}\n")
    print(f"Assembled {arguments.output}: {release['fortniteBuild']}, {release['assetCount']:,} assets, runtime {release['runtimeSourceRevision']}")


if __name__ == "__main__":
    main()
