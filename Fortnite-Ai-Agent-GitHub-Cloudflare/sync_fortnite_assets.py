#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import ipaddress
import json
import os
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
DEFAULT_DB = ROOT / "database"

DEFAULT_MANIFEST_URL = (
    "https://raw.githubusercontent.com/"
    "E8uc/NovaSparx/main/web/location-index/manifest.json"
)

MAX_MANIFEST_BYTES = 1024 * 1024
MAX_ASSET_GZIP_BYTES = 128 * 1024 * 1024
MAX_LOCATION_SHARD_BYTES = 4 * 1024 * 1024
MAX_LOCATION_SHARD_EXPANDED_BYTES = 32 * 1024 * 1024
MAX_LOCATION_SHARDS = 256
MAX_LINE_CHARS = 4096
DEFAULT_MIN_ENTRIES = 1_000_000
MAX_ENTRIES = 5_000_000

ASSET_SUFFIXES = (".uasset", ".umap")
RELEASE_RE = re.compile(r"Release-(\d+(?:\.\d+)?)", re.IGNORECASE)


class SyncError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        while True:
            chunk = handle.read(
                1024 * 1024
            )

            if not chunk:
                break

            digest.update(
                chunk
            )

    return digest.hexdigest()


def gzip_bytes(lines: Iterable[str]) -> bytes:
    output = io.BytesIO()

    with gzip.GzipFile(
        fileobj=output,
        mode="wb",
        compresslevel=9,
        mtime=0,
    ) as archive:
        for line in lines:
            value = str(line).strip()

            if not value:
                continue

            archive.write(
                value.encode("utf-8")
                + b"\n"
            )

    return output.getvalue()


def read_gzip_lines(path: Path) -> list[str]:
    if not path.exists():
        return []

    with gzip.open(
        path,
        "rt",
        encoding="utf-8",
        errors="strict",
    ) as handle:
        return [
            line.strip()
            for line in handle
            if line.strip()
        ]


def normalize_release_version(build: str) -> str:
    value = str(build or "").strip()

    match = RELEASE_RE.search(value)

    if match:
        return match.group(1)

    return value or "unknown"


def _private_literal_host(host: str) -> bool:
    value = str(host or "").strip().rstrip(".")

    if not value:
        return True

    if value.lower() in {
        "localhost",
        "localhost.localdomain",
    }:
        return True

    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False

    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def require_https_url(raw: str, label: str) -> str:
    value = str(raw or "").strip()

    parsed = urllib.parse.urlparse(value)

    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or _private_literal_host(parsed.hostname)
    ):
        raise SyncError(
            f"{label} must be a public HTTPS URL."
        )

    return value


def fetch_bounded(
    url: str,
    max_bytes: int,
    label: str,
    timeout: int = 120,
) -> bytes:
    safe_url = require_https_url(
        url,
        label,
    )

    request = urllib.request.Request(
        safe_url,
        headers={
            "User-Agent": "FNAA-AssetUpdater/1.0",
            "Accept": "application/json,application/octet-stream,*/*;q=0.8",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=timeout,
    ) as response:
        declared = response.headers.get(
            "Content-Length"
        )

        if declared:
            try:
                declared_size = int(declared)
            except ValueError:
                declared_size = 0

            if declared_size > max_bytes:
                raise SyncError(
                    f"{label} declared {declared_size} bytes, "
                    f"above the {max_bytes} byte budget."
                )

        chunks: list[bytes] = []
        total = 0

        while True:
            chunk = response.read(
                min(
                    1024 * 1024,
                    max_bytes - total + 1,
                )
            )

            if not chunk:
                break

            total += len(chunk)

            if total > max_bytes:
                raise SyncError(
                    f"{label} exceeded the {max_bytes} byte budget."
                )

            chunks.append(chunk)

    return b"".join(chunks)


def load_manifest_bytes(data: bytes) -> dict:
    try:
        parsed = json.loads(
            data.decode("utf-8")
        )
    except Exception as exc:
        raise SyncError(
            "NovaSparx asset manifest is not valid UTF-8 JSON."
        ) from exc

    if not isinstance(parsed, dict):
        raise SyncError(
            "NovaSparx asset manifest must be a JSON object."
        )

    schema = str(
        parsed.get("schema")
        or ""
    ).strip()

    if schema not in {
        "novasparx.asset-list.v1",
        "novasparx.asset-locations.v1",
    }:
        raise SyncError(
            "Unexpected NovaSparx asset manifest schema: "
            f"{schema or 'missing'}"
        )

    return parsed


def validate_asset_payload(
    compressed: bytes,
    manifest: dict,
    min_entries: int,
) -> int:
    expected_entries = int(
        manifest.get("entries") or 0
    )

    if not (
        min_entries
        <= expected_entries
        <= MAX_ENTRIES
    ):
        raise SyncError(
            "NovaSparx asset count is outside the allowed range: "
            f"{expected_entries}"
        )

    expected_bytes = int(
        manifest.get("bytes") or 0
    )

    if (
        expected_bytes > 0
        and expected_bytes
        != len(compressed)
    ):
        raise SyncError(
            "NovaSparx asset gzip size does not match its manifest."
        )

    expected_hash = str(
        manifest.get("sha256") or ""
    ).strip().lower()

    actual_hash = sha256_bytes(
        compressed
    )

    if (
        expected_hash
        and actual_hash
        != expected_hash
    ):
        raise SyncError(
            "NovaSparx asset gzip SHA-256 does not match its manifest."
        )

    count = 0

    try:
        with gzip.open(
            io.BytesIO(compressed),
            "rt",
            encoding="utf-8",
            errors="strict",
        ) as handle:
            for raw_line in handle:
                value = raw_line.strip()

                if not value:
                    continue

                if (
                    "\x00" in value
                    or len(value)
                    > MAX_LINE_CHARS
                ):
                    raise SyncError(
                        "NovaSparx returned an invalid asset path."
                    )

                normalized = value.replace(
                    "\\",
                    "/",
                )

                if not normalized.lower().endswith(
                    ASSET_SUFFIXES
                ):
                    raise SyncError(
                        "NovaSparx returned a non-package asset path: "
                        f"{normalized[:200]}"
                    )

                count += 1

                if count > MAX_ENTRIES:
                    raise SyncError(
                        "NovaSparx asset list exceeded the maximum entry budget."
                    )
    except OSError as exc:
        raise SyncError(
            "NovaSparx asset list is not a valid gzip stream."
        ) from exc

    if count != expected_entries:
        raise SyncError(
            "NovaSparx asset count mismatch: "
            f"manifest={expected_entries}, gzip={count}"
        )

    return count


def iter_compressed_lines(
    compressed: bytes,
):
    with gzip.open(
        io.BytesIO(compressed),
        "rt",
        encoding="utf-8",
        errors="strict",
    ) as handle:
        for raw_line in handle:
            value = raw_line.strip()

            if value:
                yield value.replace(
                    "\\",
                    "/",
                )


def load_old_keys(path: Path) -> set[str]:
    return {
        value.casefold()
        for value in read_gzip_lines(path)
    }


def write_atomic(
    path: Path,
    data: bytes,
) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary = path.with_name(
        path.name
        + ".tmp"
    )

    temporary.write_bytes(
        data
    )

    os.replace(
        temporary,
        path,
    )


def write_json_atomic(
    path: Path,
    payload: dict,
) -> None:
    data = (
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")

    write_atomic(
        path,
        data,
    )


def asset_source_url(
    manifest_url: str,
    manifest: dict,
) -> str:
    configured = os.getenv(
        "FNAA_ASSET_GZIP_URL",
        "",
    ).strip()

    if configured:
        return require_https_url(
            configured,
            "FNAA asset gzip URL",
        )

    relative = str(
        manifest.get("path")
        or "fortnite_assets.gz"
    ).strip()

    parsed = urllib.parse.urlparse(
        relative
    )

    if parsed.scheme:
        return require_https_url(
            relative,
            "NovaSparx asset gzip URL",
        )

    if (
        relative.startswith("/")
        or ".." in Path(relative).parts
    ):
        raise SyncError(
            "NovaSparx asset gzip path is unsafe."
        )

    resolved = urllib.parse.urljoin(
        manifest_url,
        relative,
    )

    return require_https_url(
        resolved,
        "NovaSparx asset gzip URL",
    )


def location_shard_url(
    manifest_url: str,
    manifest: dict,
    shard_index: int,
) -> str:
    template = str(
        manifest.get("path")
        or ""
    ).strip()

    if (
        "{shard}" not in template
        or template.startswith("/")
        or ".." in Path(template).parts
    ):
        raise SyncError(
            "NovaSparx location-index shard path is unsafe or invalid."
        )

    shard_name = f"{shard_index:02x}"

    relative = template.replace(
        "{shard}",
        shard_name,
    )

    parsed = urllib.parse.urlparse(
        relative
    )

    if parsed.scheme:
        return require_https_url(
            relative,
            "NovaSparx location-index shard URL",
        )

    resolved = urllib.parse.urljoin(
        manifest_url,
        relative,
    )

    return require_https_url(
        resolved,
        "NovaSparx location-index shard URL",
    )


def parse_location_shard(
    compressed: bytes,
    shard_index: int,
) -> list[str]:
    if len(compressed) > MAX_LOCATION_SHARD_BYTES:
        raise SyncError(
            f"NovaSparx location shard {shard_index:02x} "
            "exceeded the compressed byte budget."
        )

    try:
        with gzip.GzipFile(
            fileobj=io.BytesIO(
                compressed
            ),
            mode="rb",
        ) as archive:
            expanded = archive.read(
                MAX_LOCATION_SHARD_EXPANDED_BYTES
                + 1
            )
    except OSError as exc:
        raise SyncError(
            f"NovaSparx location shard {shard_index:02x} "
            "is not valid gzip."
        ) from exc

    if (
        len(expanded)
        > MAX_LOCATION_SHARD_EXPANDED_BYTES
    ):
        raise SyncError(
            f"NovaSparx location shard {shard_index:02x} "
            "exceeded the expanded byte budget."
        )

    try:
        payload = json.loads(
            expanded.decode(
                "utf-8"
            )
        )
    except Exception as exc:
        raise SyncError(
            f"NovaSparx location shard {shard_index:02x} "
            "is not valid UTF-8 JSON."
        ) from exc

    if (
        not isinstance(
            payload,
            dict,
        )
        or payload.get(
            "schema"
        )
        != "novasparx.asset-locations.v1"
        or payload.get(
            "valueProperty"
        )
        != "toc"
        or not isinstance(
            payload.get("items"),
            dict,
        )
    ):
        raise SyncError(
            f"NovaSparx location shard {shard_index:02x} "
            "has an unexpected schema."
        )

    paths: list[str] = []

    for raw_path in payload[
        "items"
    ].keys():
        value = str(
            raw_path
            or ""
        ).strip().replace(
            "\\",
            "/",
        )

        if (
            not value
            or "\x00" in value
            or len(value)
            > MAX_LINE_CHARS
            or not value.lower().endswith(
                ASSET_SUFFIXES
            )
        ):
            raise SyncError(
                f"NovaSparx location shard {shard_index:02x} "
                "contains an invalid package path."
            )

        paths.append(
            value
        )

    return paths


def build_location_asset_payload(
    *,
    manifest_url: str,
    manifest: dict,
    min_entries: int,
    fetcher=fetch_bounded,
) -> bytes:
    expected_entries = int(
        manifest.get("entries")
        or 0
    )

    if not (
        min_entries
        <= expected_entries
        <= MAX_ENTRIES
    ):
        raise SyncError(
            "NovaSparx location-index asset count is outside "
            "the allowed range: "
            f"{expected_entries}"
        )

    shard_count = int(
        manifest.get("shards")
        or 0
    )

    if not (
        1
        <= shard_count
        <= MAX_LOCATION_SHARDS
    ):
        raise SyncError(
            "NovaSparx location-index shard count is invalid: "
            f"{shard_count}"
        )

    expected_source_bytes = int(
        manifest.get("bytes")
        or 0
    )

    if expected_source_bytes <= 0:
        raise SyncError(
            "NovaSparx location-index manifest is missing its byte count."
        )

    output = io.BytesIO()
    total_entries = 0
    total_source_bytes = 0

    with gzip.GzipFile(
        fileobj=output,
        mode="wb",
        compresslevel=9,
        mtime=0,
    ) as archive:
        for shard_index in range(
            shard_count
        ):
            shard_url = (
                location_shard_url(
                    manifest_url,
                    manifest,
                    shard_index,
                )
            )

            compressed = fetcher(
                shard_url,
                MAX_LOCATION_SHARD_BYTES,
                (
                    "NovaSparx location-index shard "
                    f"{shard_index:02x}"
                ),
            )

            total_source_bytes += len(
                compressed
            )

            paths = parse_location_shard(
                compressed,
                shard_index,
            )

            for value in paths:
                archive.write(
                    value.encode(
                        "utf-8"
                    )
                    + b"\n"
                )

            total_entries += len(
                paths
            )

            if (
                total_entries
                > MAX_ENTRIES
            ):
                raise SyncError(
                    "NovaSparx location-index exceeded "
                    "the maximum entry budget."
                )

    if (
        total_source_bytes
        != expected_source_bytes
    ):
        raise SyncError(
            "NovaSparx location-index compressed byte count mismatch: "
            f"manifest={expected_source_bytes}, "
            f"downloaded={total_source_bytes}"
        )

    if (
        total_entries
        != expected_entries
    ):
        raise SyncError(
            "NovaSparx location-index asset count mismatch: "
            f"manifest={expected_entries}, "
            f"shards={total_entries}"
        )

    return output.getvalue()


def local_location_source_matches(
    database_dir: Path,
    manifest: dict,
) -> dict | None:
    raw_path = (
        database_dir
        / "fortnite_assets.gz"
    )

    metadata_path = (
        database_dir
        / "fortnite_assets_source.json"
    )

    if (
        not raw_path.exists()
        or not metadata_path.exists()
    ):
        return None

    build = str(
        manifest.get(
            "fortniteVersion"
        )
        or ""
    ).strip()

    revision = str(
        manifest.get(
            "builtAt"
        )
        or ""
    ).strip()

    expected_entries = int(
        manifest.get("entries")
        or 0
    )

    expected_source_bytes = int(
        manifest.get("bytes")
        or 0
    )

    expected_shards = int(
        manifest.get("shards")
        or 0
    )

    if (
        not build
        or not revision
        or expected_entries <= 0
        or expected_source_bytes <= 0
        or expected_shards <= 0
    ):
        return None

    try:
        metadata = json.loads(
            metadata_path.read_text(
                encoding="utf-8"
            )
        )
    except Exception:
        return None

    expected_hash = str(
        metadata.get(
            "sha256"
        )
        or ""
    ).strip().lower()

    if (
        metadata.get(
            "sourceSchema"
        )
        != "novasparx.asset-locations.v1"
        or str(
            metadata.get(
                "sourceRevision"
            )
            or ""
        ).strip()
        != revision
        or str(
            metadata.get(
                "fortniteBuild"
            )
            or ""
        ).strip()
        != build
        or int(
            metadata.get(
                "entries"
            )
            or 0
        )
        != expected_entries
        or int(
            metadata.get(
                "sourceIndexBytes"
            )
            or 0
        )
        != expected_source_bytes
        or int(
            metadata.get(
                "sourceIndexShards"
            )
            or 0
        )
        != expected_shards
        or len(expected_hash)
        != 64
    ):
        return None

    if (
        sha256_file(
            raw_path
        )
        != expected_hash
    ):
        return None

    return {
        "changed":
            False,
        "fortniteBuild":
            build,
        "fortniteVersion":
            normalize_release_version(
                build
            ),
        "entries":
            expected_entries,
        "sha256":
            expected_hash,
    }


def sync_payload(
    *,
    database_dir: Path,
    manifest_url: str,
    manifest: dict,
    compressed: bytes,
    min_entries: int,
    source_metadata_extra: dict | None = None,
) -> dict:
    count = validate_asset_payload(
        compressed,
        manifest,
        min_entries,
    )

    build = str(
        manifest.get("fortniteVersion")
        or ""
    ).strip()

    if not build:
        raise SyncError(
            "NovaSparx asset manifest is missing fortniteVersion."
        )

    raw_path = (
        database_dir
        / "fortnite_assets.gz"
    )

    previous_path = (
        database_dir
        / "fortnite_assets_previous.gz"
    )

    new_path = (
        database_dir
        / "fortnite_assets_new.gz"
    )

    metadata_path = (
        database_dir
        / "fortnite_assets_source.json"
    )

    source_hash = sha256_bytes(
        compressed
    )

    current_bytes = (
        raw_path.read_bytes()
        if raw_path.exists()
        else b""
    )

    current_hash = (
        sha256_bytes(
            current_bytes
        )
        if current_bytes
        else ""
    )

    existing_metadata = {}

    if metadata_path.exists():
        try:
            existing_metadata = json.loads(
                metadata_path.read_text(
                    encoding="utf-8"
                )
            )
        except Exception:
            existing_metadata = {}

    metadata_matches = (
        str(
            existing_metadata.get(
                "sha256"
            )
            or ""
        ).strip().lower()
        == source_hash
        and str(
            existing_metadata.get(
                "fortniteBuild"
            )
            or ""
        ).strip()
        == build
    )

    if (
        current_hash
        and current_hash
        == source_hash
        and metadata_matches
    ):
        return {
            "changed": False,
            "fortniteBuild": build,
            "fortniteVersion":
                normalize_release_version(
                    build
                ),
            "entries": count,
            "sha256": source_hash,
        }

    old_keys = load_old_keys(
        raw_path
    )

    new_assets: list[str] = []

    for value in iter_compressed_lines(
        compressed
    ):
        key = value.casefold()

        if key in old_keys:
            old_keys.remove(key)
        else:
            new_assets.append(
                value
            )

    new_payload = gzip_bytes(
        new_assets
    )

    database_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    if current_bytes:
        write_atomic(
            previous_path,
            current_bytes,
        )

    write_atomic(
        raw_path,
        compressed,
    )

    write_atomic(
        new_path,
        new_payload,
    )

    source_metadata = {
        "schema":
            "fnaa.asset-source.v1",
        "source":
            "NovaSparx",
        "sourceManifest":
            manifest_url,
        "fortniteBuild":
            build,
        "fortniteVersion":
            normalize_release_version(
                build
            ),
        "entries":
            count,
        "bytes":
            len(compressed),
        "sha256":
            source_hash,
        "newAssets":
            len(new_assets),
        "removedAssets":
            len(old_keys),
        "updatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),
    }

    if source_metadata_extra:
        source_metadata.update(
            source_metadata_extra
        )

    write_json_atomic(
        metadata_path,
        source_metadata,
    )

    return {
        "changed": True,
        **source_metadata,
    }


def local_source_matches(
    database_dir: Path,
    manifest: dict,
) -> dict | None:
    raw_path = (
        database_dir
        / "fortnite_assets.gz"
    )

    metadata_path = (
        database_dir
        / "fortnite_assets_source.json"
    )

    if (
        not raw_path.exists()
        or not metadata_path.exists()
    ):
        return None

    build = str(
        manifest.get("fortniteVersion")
        or ""
    ).strip()

    expected_hash = str(
        manifest.get("sha256")
        or ""
    ).strip().lower()

    expected_bytes = int(
        manifest.get("bytes")
        or 0
    )

    expected_entries = int(
        manifest.get("entries")
        or 0
    )

    if (
        not build
        or len(expected_hash) != 64
        or not all(
            character in "0123456789abcdef"
            for character in expected_hash
        )
        or expected_bytes <= 0
        or expected_entries <= 0
    ):
        return None

    try:
        metadata = json.loads(
            metadata_path.read_text(
                encoding="utf-8"
            )
        )
    except Exception:
        return None

    if (
        str(
            metadata.get("fortniteBuild")
            or ""
        ).strip()
        != build
        or str(
            metadata.get("sha256")
            or ""
        ).strip().lower()
        != expected_hash
        or int(
            metadata.get("entries")
            or 0
        )
        != expected_entries
        or raw_path.stat().st_size
        != expected_bytes
    ):
        return None

    if sha256_file(
        raw_path
    ) != expected_hash:
        return None

    return {
        "changed": False,
        "fortniteBuild": build,
        "fortniteVersion":
            normalize_release_version(
                build
            ),
        "entries":
            expected_entries,
        "sha256":
            expected_hash,
    }


def sync_remote(
    database_dir: Path,
    manifest_url: str,
    min_entries: int,
) -> dict:
    safe_manifest_url = require_https_url(
        manifest_url,
        "FNAA asset manifest URL",
    )

    manifest_bytes = fetch_bounded(
        safe_manifest_url,
        MAX_MANIFEST_BYTES,
        "NovaSparx asset manifest",
    )

    manifest = load_manifest_bytes(
        manifest_bytes
    )

    expected_entries = int(
        manifest.get("entries")
        or 0
    )

    if not (
        min_entries
        <= expected_entries
        <= MAX_ENTRIES
    ):
        raise SyncError(
            "NovaSparx asset count is outside the allowed range: "
            f"{expected_entries}"
        )

    schema = str(
        manifest.get("schema")
        or ""
    ).strip()

    if (
        schema
        == "novasparx.asset-locations.v1"
    ):
        unchanged = (
            local_location_source_matches(
                database_dir,
                manifest,
            )
        )

        if unchanged is not None:
            return unchanged

        compressed = (
            build_location_asset_payload(
                manifest_url=
                    safe_manifest_url,
                manifest=
                    manifest,
                min_entries=
                    min_entries,
            )
        )

        derived_manifest = {
            "schema":
                "novasparx.asset-list.v1",
            "fortniteVersion":
                manifest.get(
                    "fortniteVersion"
                ),
            "entries":
                manifest.get(
                    "entries"
                ),
            "bytes":
                len(
                    compressed
                ),
            "sha256":
                sha256_bytes(
                    compressed
                ),
            "path":
                "derived-from-location-index",
        }

        return sync_payload(
            database_dir=
                database_dir,
            manifest_url=
                safe_manifest_url,
            manifest=
                derived_manifest,
            compressed=
                compressed,
            min_entries=
                min_entries,
            source_metadata_extra={
                "sourceSchema":
                    schema,
                "sourceRevision":
                    str(
                        manifest.get(
                            "builtAt"
                        )
                        or ""
                    ).strip(),
                "sourceIndexBytes":
                    int(
                        manifest.get(
                            "bytes"
                        )
                        or 0
                    ),
                "sourceIndexShards":
                    int(
                        manifest.get(
                            "shards"
                        )
                        or 0
                    ),
                "sourceIndexPath":
                    str(
                        manifest.get(
                            "path"
                        )
                        or ""
                    ).strip(),
            },
        )

    unchanged = local_source_matches(
        database_dir,
        manifest,
    )

    if unchanged is not None:
        return unchanged

    gzip_url = asset_source_url(
        safe_manifest_url,
        manifest,
    )

    compressed = fetch_bounded(
        gzip_url,
        MAX_ASSET_GZIP_BYTES,
        "NovaSparx canonical asset list",
        timeout=180,
    )

    return sync_payload(
        database_dir=database_dir,
        manifest_url=safe_manifest_url,
        manifest=manifest,
        compressed=compressed,
        min_entries=min_entries,
    )


def _fixture_manifest(
    *,
    build: str,
    compressed: bytes,
    entries: int,
) -> dict:
    return {
        "schema":
            "novasparx.asset-list.v1",
        "fortniteVersion":
            build,
        "entries":
            entries,
        "bytes":
            len(compressed),
        "sha256":
            sha256_bytes(
                compressed
            ),
        "path":
            "fortnite_assets.gz",
    }


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = (
            Path(tmp)
            / "database"
        )

        db.mkdir(
            parents=True,
            exist_ok=True,
        )

        old_assets = [
            "FortniteGame/Content/A.uasset",
            "FortniteGame/Content/B.uasset",
            "FortniteGame/Content/Removed.uasset",
        ]

        current_assets = [
            "FortniteGame/Content/A.uasset",
            "FortniteGame/Content/B.uasset",
            "FortniteGame/Content/C.uasset",
            "FortniteGame/Maps/NewIsland.umap",
        ]

        write_atomic(
            db / "fortnite_assets.gz",
            gzip_bytes(
                old_assets
            ),
        )

        current_payload = gzip_bytes(
            current_assets
        )

        manifest = _fixture_manifest(
            build=
                "++Fortnite+Release-99.10-CL-123-Windows",
            compressed=
                current_payload,
            entries=
                len(current_assets),
        )

        result = sync_payload(
            database_dir=db,
            manifest_url=
                "https://example.com/asset-list/manifest.json",
            manifest=manifest,
            compressed=current_payload,
            min_entries=1,
        )

        if not result["changed"]:
            raise AssertionError(
                "Self-test expected a changed asset database."
            )

        if result["newAssets"] != 2:
            raise AssertionError(
                f"Self-test expected 2 new assets, got {result['newAssets']}."
            )

        if result["removedAssets"] != 1:
            raise AssertionError(
                f"Self-test expected 1 removed asset, got {result['removedAssets']}."
            )

        if (
            read_gzip_lines(
                db
                / "fortnite_assets_previous.gz"
            )
            != old_assets
        ):
            raise AssertionError(
                "Self-test did not preserve the previous asset database."
            )

        if (
            read_gzip_lines(
                db
                / "fortnite_assets_new.gz"
            )
            != current_assets[2:]
        ):
            raise AssertionError(
                "Self-test generated the wrong new-asset diff."
            )

        metadata = json.loads(
            (
                db
                / "fortnite_assets_source.json"
            ).read_text(
                encoding="utf-8"
            )
        )

        if metadata["fortniteVersion"] != "99.10":
            raise AssertionError(
                "Self-test failed Fortnite version normalization."
            )

        local_match = (
            local_source_matches(
                db,
                manifest,
            )
        )

        if (
            local_match is None
            or local_match["changed"]
        ):
            raise AssertionError(
                "Self-test expected the manifest-only fast path to match."
            )

        second = sync_payload(
            database_dir=db,
            manifest_url=
                "https://example.com/asset-list/manifest.json",
            manifest=manifest,
            compressed=current_payload,
            min_entries=1,
        )

        if second["changed"]:
            raise AssertionError(
                "Self-test expected an identical source to be a no-op."
            )

        if (
            read_gzip_lines(
                db
                / "fortnite_assets_new.gz"
            )
            != current_assets[2:]
        ):
            raise AssertionError(
                "A no-op sync must preserve the latest new-asset diff."
            )

    with tempfile.TemporaryDirectory() as tmp:
        shard_assets = {
            "00": [
                "FortniteGame/Content/One.uasset",
                "FortniteGame/Maps/One.umap",
            ],
            "01": [
                "FortniteGame/Content/Two.uasset",
            ],
        }

        shard_payloads: dict[str, bytes] = {}

        for shard_name, assets in shard_assets.items():
            body = json.dumps(
                {
                    "schema":
                        "novasparx.asset-locations.v1",
                    "valueProperty":
                        "toc",
                    "items":
                        {
                            asset:
                                "FortniteGame/Content/Paks/test.utoc"
                            for asset in assets
                        },
                },
                separators=(
                    ",",
                    ":",
                ),
                sort_keys=True,
            ).encode(
                "utf-8"
            )

            stream = io.BytesIO()

            with gzip.GzipFile(
                fileobj=stream,
                mode="wb",
                compresslevel=9,
                mtime=0,
            ) as archive:
                archive.write(
                    body
                )

            shard_payloads[
                shard_name
            ] = stream.getvalue()

        location_manifest = {
            "schema":
                "novasparx.asset-locations.v1",
            "builtAt":
                "2099-01-01T00:00:00+00:00",
            "fortniteVersion":
                "++Fortnite+Release-99.20-CL-456-Windows",
            "entries":
                sum(
                    len(values)
                    for values in shard_assets.values()
                ),
            "shards":
                len(
                    shard_assets
                ),
            "bytes":
                sum(
                    len(value)
                    for value in shard_payloads.values()
                ),
            "path":
                "{shard}.json.gz",
        }

        def fixture_fetcher(
            url: str,
            max_bytes: int,
            label: str,
            timeout: int = 120,
        ) -> bytes:
            del max_bytes, label, timeout

            name = Path(
                urllib.parse.urlparse(
                    url
                ).path
            ).name

            shard_name = name.split(
                ".",
                1,
            )[0]

            return shard_payloads[
                shard_name
            ]

        location_payload = (
            build_location_asset_payload(
                manifest_url=
                    "https://example.com/location-index/manifest.json",
                manifest=
                    location_manifest,
                min_entries=
                    1,
                fetcher=
                    fixture_fetcher,
            )
        )

        location_lines = list(
            iter_compressed_lines(
                location_payload
            )
        )

        expected_location_lines = [
            *shard_assets["00"],
            *shard_assets["01"],
        ]

        if (
            location_lines
            != expected_location_lines
        ):
            raise AssertionError(
                "Self-test generated the wrong asset list "
                "from the location index."
            )

    print(
        "FNAA_ASSET_SYNC_SELFTEST_OK"
    )


def write_github_outputs(
    result: dict,
) -> None:
    output = os.getenv(
        "GITHUB_OUTPUT",
        "",
    ).strip()

    if not output:
        return

    with open(
        output,
        "a",
        encoding="utf-8",
    ) as handle:
        handle.write(
            "changed="
            + (
                "true"
                if result.get(
                    "changed"
                )
                else "false"
            )
            + "\n"
        )

        handle.write(
            "fortnite_version="
            + str(
                result.get(
                    "fortniteVersion"
                )
                or "unknown"
            )
            + "\n"
        )

        handle.write(
            "fortnite_build="
            + str(
                result.get(
                    "fortniteBuild"
                )
                or "unknown"
            )
            .replace(
                "\n",
                " ",
            )
            + "\n"
        )


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--database-dir",
        type=Path,
        default=DEFAULT_DB,
    )

    parser.add_argument(
        "--manifest-url",
        default=(
            os.getenv(
                "FNAA_ASSET_MANIFEST_URL",
                "",
            ).strip()
            or DEFAULT_MANIFEST_URL
        ),
    )

    parser.add_argument(
        "--min-entries",
        type=int,
        default=DEFAULT_MIN_ENTRIES,
    )

    parser.add_argument(
        "--self-test",
        action="store_true",
    )

    args = parser.parse_args()

    if args.self_test:
        self_test()
        return

    if args.min_entries < 1:
        raise SystemExit(
            "--min-entries must be positive."
        )

    try:
        result = sync_remote(
            database_dir=
                args.database_dir,
            manifest_url=
                args.manifest_url,
            min_entries=
                args.min_entries,
        )
    except SyncError as exc:
        raise SystemExit(
            f"Asset sync failed: {exc}"
        ) from exc

    write_github_outputs(
        result
    )

    print(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
