#!/usr/bin/env python3
from __future__ import annotations

import gzip
import io
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
DB = ROOT / "database"

LEGACY_INDEX = DB / "index"
V1_ROOT = DB / "index-v1"
SHARDS_ROOT = V1_ROOT / "shards"
JSON_SRC = DB / "json-src"

RAW = DB / "fortnite_assets.gz"
NEW = DB / "fortnite_assets_new.gz"
DEFAULT_PREVIOUS = DB / "fortnite_assets_previous.gz"

FORTNITE_VERSION = os.getenv("FNAA_FORTNITE_VERSION", "42.00").strip() or "42.00"
SHARD_KEY_LENGTH = 2

LEGACY_INDEX.mkdir(parents=True, exist_ok=True)
V1_ROOT.mkdir(parents=True, exist_ok=True)
SHARDS_ROOT.mkdir(parents=True, exist_ok=True)
JSON_SRC.mkdir(parents=True, exist_ok=True)

ASSET_REF_RE = re.compile(
    r"""(?:
        /(?:Game|Engine|[A-Za-z0-9_]+)/[A-Za-z0-9_./\-]+
        |
        (?:FortniteGame|Engine)/[A-Za-z0-9_./\-]+
    )""",
    re.VERBOSE,
)

COMMON_PREFIXES = (
    "sm_",
    "sk_",
    "skm_",
    "mi_",
    "m_",
    "t_",
    "tex_",
    "ns_",
    "ps_",
    "fx_",
    "bp_",
    "w_",
    "sw_",
    "usw_",
)

SCOPE_ORDER = ("all", "sm", "m", "meshes", "new")


def read_gzip_lines(path: Path) -> list[str]:
    if not path.exists():
        return []

    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as handle:
        return [
            line.strip()
            for line in handle
            if line.strip()
        ]


def dedupe_sorted(lines: Iterable[str]) -> list[str]:
    return sorted(
        {
            str(line).strip()
            for line in lines
            if str(line).strip()
        },
        key=str.casefold,
    )


def gzip_bytes(lines: Iterable[str]) -> bytes:
    payload = "".join(f"{line}\n" for line in lines).encode("utf-8")

    # mtime=0 keeps generated files deterministic, which means hashes only
    # change when the index contents actually change.
    out = io.BytesIO()

    with gzip.GzipFile(
        fileobj=out,
        mode="wb",
        compresslevel=9,
        mtime=0,
    ) as gz:
        gz.write(payload)

    return out.getvalue()


def write_gzip_lines(path: Path, lines: Iterable[str]) -> dict:
    unique = dedupe_sorted(lines)
    data = gzip_bytes(unique)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

    return {
        "count": len(unique),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def basename(path: str) -> str:
    value = str(path or "").replace("\\", "/").rstrip("/")
    return value.rsplit("/", 1)[-1]


def logical_name(path: str) -> str:
    name = basename(path)

    for suffix in (".uasset", ".uexp", ".ubulk"):
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)]
            break

    # Object paths often end in Asset.Asset or Asset.Asset_C.
    if "." in name:
        left, right = name.split(".", 1)
        if right.casefold() in {
            left.casefold(),
            f"{left.casefold()}_c",
        }:
            name = left

    lower = name.casefold()

    for prefix in COMMON_PREFIXES:
        if lower.startswith(prefix):
            name = name[len(prefix):]
            break

    return name


def shard_key(path_or_query: str) -> str:
    value = logical_name(path_or_query).casefold()
    compact = "".join(ch for ch in value if ch.isalnum())

    if not compact:
        return "__"

    if len(compact) == 1:
        return f"{compact}_"

    return compact[:SHARD_KEY_LENGTH]


def diagnosis_scope(path: str) -> str:
    """Index eligibility only; never use a broad /Meshes/ folder as type proof.

    Kept in parity with asset-diagnosis.js by the diagnosis corpus self-test.
    Unknown explicit classes block misleading filename/folder fallbacks.
    """
    value = str(path or "").strip().replace("\\", "/")
    typed = re.fullmatch(r"((?:/Script/[^.'\"\s]+\.)?[A-Za-z0-9_]+)\s*['\"]([^'\"]+)['\"]", value)
    if typed:
        cls = typed[1].rsplit(".", 1)[-1].casefold()
        if cls.startswith("u"):
            cls = cls[1:]
        if cls == "staticmesh":
            return "staticmesh"
        if cls == "skeletalmesh":
            return "skeletalmesh"
        if cls in {"material", "materialinterface", "materialinstance", "materialinstanceconstant", "materialinstancedynamic", "materialfunction", "materialfunctioninterface", "materialfunctioninstance", "materialfunctionmateriallayer", "materialfunctionmateriallayerblend", "materialparametercollection"}:
            return "material"
        if cls not in {"object", "softobjectpath"}:
            return "other"
        value = typed[2]
    name = basename(value).casefold()
    if "." in name:
        left, right = name.split(".", 1)
        if right == "uasset":
            name = left
        elif right == left + "_c":
            return "other"
        elif right == left:
            name = left
        else:
            return "other"
    if name.startswith(("sk_", "skm_")):
        return "skeletalmesh"
    if name.startswith("sm_"):
        return "staticmesh"
    if name.startswith(("mi_", "m_", "mf_", "mpc_")):
        return "material"
    if re.match(r"^(?:bp_|bpc_|abp_|wbp_|t_|tex_|texture_|sw_|usw_|soundwave_|sc_|soundcue_|mss_|metasound_|anim_|am_|montage_|ns_|ne_|ps_|cid_|bid_|eid_|pickaxe_|da_|dt_|data_)", name):
        return "other"
    if re.search(r"/skeletalmeshes?/", value, re.I):
        return "skeletalmesh"
    if re.search(r"/staticmeshes?/", value, re.I):
        return "staticmesh"
    return "other"


def is_sm(path: str) -> bool:
    return diagnosis_scope(path) == "staticmesh"


def is_material(path: str) -> bool:
    return diagnosis_scope(path) == "material"


def is_mesh(path: str) -> bool:
    return diagnosis_scope(path) in {"staticmesh", "skeletalmesh"}


def scope_assets(all_assets: list[str], new_assets: list[str]) -> dict[str, list[str]]:
    scopes = {"all": all_assets, "sm": [], "m": [], "meshes": [], "new": new_assets}
    for item in all_assets:
        kind = diagnosis_scope(item)
        if kind == "staticmesh":
            scopes["sm"].append(item)
        if kind in {"staticmesh", "skeletalmesh"}:
            scopes["meshes"].append(item)
        if kind == "material":
            scopes["m"].append(item)
    return scopes


def clean_reference(value: str) -> str:
    value = str(value or "").strip()

    value = value.rstrip(
        "'\"),]}>,;:"
    )

    # JSON strings can preserve a trailing escaped quote.
    value = value.rstrip("\\")

    return value


def extract_json_references() -> list[str]:
    refs: set[str] = set()

    if not JSON_SRC.exists():
        return []

    for file in sorted(JSON_SRC.rglob("*.json")):
        try:
            text = file.read_text(
                encoding="utf-8",
                errors="ignore",
            )
        except OSError:
            continue

        for match in ASSET_REF_RE.finditer(text):
            cleaned = clean_reference(match.group(0))

            if len(cleaned) < 4:
                continue

            refs.add(cleaned)

    return sorted(refs, key=str.casefold)


def previous_assets_path() -> Path | None:
    configured = os.getenv("FNAA_PREVIOUS_ASSETS", "").strip()

    if configured:
        candidate = Path(configured)

        if not candidate.is_absolute():
            candidate = ROOT / candidate

        if candidate.exists():
            return candidate

    if DEFAULT_PREVIOUS.exists():
        return DEFAULT_PREVIOUS

    return None


def derive_new_assets(all_assets: list[str]) -> tuple[list[str], str | None]:
    if NEW.exists():
        return dedupe_sorted(read_gzip_lines(NEW)), NEW.name

    previous = previous_assets_path()

    if previous is None:
        return [], None

    old = {
        item.casefold()
        for item in read_gzip_lines(previous)
    }

    current = [
        item
        for item in all_assets
        if item.casefold() not in old
    ]

    return dedupe_sorted(current), previous.name


def clear_generated_shards() -> None:
    if not SHARDS_ROOT.exists():
        return

    for file in SHARDS_ROOT.rglob("*.txt.gz"):
        try:
            file.unlink()
        except OSError:
            pass


def build_scope_shards(
    scope: str,
    lines: list[str],
) -> dict:
    buckets: dict[str, list[str]] = defaultdict(list)

    for item in lines:
        buckets[shard_key(item)].append(item)

    manifest_shards: dict[str, dict] = {}

    scope_root = SHARDS_ROOT / scope
    scope_root.mkdir(parents=True, exist_ok=True)

    for key in sorted(buckets):
        relative = Path("shards") / scope / f"{key}.txt.gz"
        output = V1_ROOT / relative

        info = write_gzip_lines(
            output,
            buckets[key],
        )

        manifest_shards[key] = {
            "path": relative.as_posix(),
            **info,
        }

    return {
        "count": len(lines),
        "shardCount": len(manifest_shards),
        "shards": manifest_shards,
    }


def build_legacy_indexes(
    scopes: dict[str, list[str]],
    json_refs: list[str],
) -> dict:
    legacy: dict[str, dict] = {}

    for scope in ("all", "sm", "m", "meshes"):
        relative = Path("index") / f"{scope}.txt.gz"

        legacy[scope] = {
            "path": relative.as_posix(),
            **write_gzip_lines(
                DB / relative,
                scopes[scope],
            ),
        }

    relative = Path("index") / "new.txt.gz"

    legacy["new"] = {
        "path": relative.as_posix(),
        **write_gzip_lines(
            DB / relative,
            scopes["new"],
        ),
    }

    relative = Path("index") / "json-references.txt.gz"

    legacy["json"] = {
        "path": relative.as_posix(),
        **write_gzip_lines(
            DB / relative,
            json_refs,
        ),
    }

    return legacy


def build_v1_full_indexes(
    scopes: dict[str, list[str]],
    json_refs: list[str],
) -> dict:
    full: dict[str, dict] = {}

    for scope in SCOPE_ORDER:
        relative = Path("full") / f"{scope}.txt.gz"

        full[scope] = {
            "path": relative.as_posix(),
            **write_gzip_lines(
                V1_ROOT / relative,
                scopes[scope],
            ),
        }

    relative = Path("full") / "json.txt.gz"

    full["json"] = {
        "path": relative.as_posix(),
        **write_gzip_lines(
            V1_ROOT / relative,
            json_refs,
        ),
    }

    return full


def source_info(
    path: Path | None,
) -> dict | None:
    if path is None or not path.exists():
        return None

    data = path.read_bytes()

    return {
        "file": path.name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def main() -> None:
    if not RAW.exists():
        raise SystemExit(
            "Missing database/fortnite_assets.gz\n"
            "Put the current Fortnite asset database there first."
        )

    all_assets = dedupe_sorted(
        read_gzip_lines(RAW)
    )

    new_assets, new_source_name = derive_new_assets(
        all_assets
    )

    scopes = scope_assets(
        all_assets,
        new_assets,
    )

    json_refs = extract_json_references()

    clear_generated_shards()

    legacy = build_legacy_indexes(
        scopes,
        json_refs,
    )

    full = build_v1_full_indexes(
        scopes,
        json_refs,
    )

    scope_manifest = {}

    for scope in SCOPE_ORDER:
        scope_manifest[scope] = {
            **build_scope_shards(
                scope,
                scopes[scope],
            ),
            "full": full[scope],
        }

    manifest = {
        "schema": "fnaa.asset-index.v1",
        "version": 1,
        "fortniteVersion": FORTNITE_VERSION,
        "builtAt": datetime.now(
            timezone.utc
        ).isoformat(),
        "shardKeyLength": SHARD_KEY_LENGTH,
        "shardAlgorithm": "logical-basename-prefix-v1",
        "scopes": scope_manifest,
        "jsonReferences": full["json"],
        "legacy": legacy,
        "sources": {
            "current": source_info(RAW),
            "new": source_info(NEW) if NEW.exists() else None,
            "newDerivedFrom": (
                new_source_name
                if not NEW.exists()
                else None
            ),
        },
    }

    manifest_path = V1_ROOT / "manifest.json"

    manifest_path.write_text(
        json.dumps(
            manifest,
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    # Keep a tiny compatibility manifest for existing deployment tooling.
    compatibility_manifest = {
        "schema": manifest["schema"],
        "version": manifest["version"],
        "fortniteVersion": manifest["fortniteVersion"],
        "builtAt": manifest["builtAt"],
        "counts": {
            scope: len(scopes[scope])
            for scope in SCOPE_ORDER
        },
        "jsonReferences": len(json_refs),
        "indexV1": "index-v1/manifest.json",
    }

    (DB / "manifest.json").write_text(
        json.dumps(
            compatibility_manifest,
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "manifest": manifest_path.relative_to(ROOT).as_posix(),
                "fortniteVersion": FORTNITE_VERSION,
                "counts": {
                    scope: len(scopes[scope])
                    for scope in SCOPE_ORDER
                },
                "jsonReferences": len(json_refs),
                "shards": {
                    scope: scope_manifest[scope]["shardCount"]
                    for scope in SCOPE_ORDER
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
