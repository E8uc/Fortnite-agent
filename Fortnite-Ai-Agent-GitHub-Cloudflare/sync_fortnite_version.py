#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

TARGETS = {
    "config": ROOT / "config.js",
    "index": ROOT / "index.html",
    "worker": ROOT / "cloudflare-worker" / "worker.js",
}

VERSION_RE = re.compile(r"^\d{1,2}\.\d{1,2}$")


class VersionSyncError(RuntimeError):
    pass


def require_version(value: str) -> str:
    version = str(value or "").strip()

    if not VERSION_RE.fullmatch(version):
        raise VersionSyncError(
            f"Invalid Fortnite version: {version!r}"
        )

    return version


def replace_exactly_once(
    text: str,
    pattern: re.Pattern[str],
    replacement: str,
    label: str,
) -> str:
    updated, count = pattern.subn(
        replacement,
        text,
        count=1,
    )

    if count != 1:
        raise VersionSyncError(
            f"Expected exactly one {label} version anchor, found {count}."
        )

    return updated


def update_sources(
    version: str,
    files: dict[str, Path] | None = None,
) -> list[Path]:
    version = require_version(version)
    files = files or TARGETS
    changed: list[Path] = []

    config_path = files["config"]
    index_path = files["index"]
    worker_path = files["worker"]

    config = config_path.read_text(
        encoding="utf-8"
    )
    next_config = replace_exactly_once(
        config,
        re.compile(
            r'(fortniteVersion:\s*")[0-9]{1,2}\.[0-9]{1,2}(")'
        ),
        rf"\g<1>{version}\g<2>",
        "config.js",
    )

    index = index_path.read_text(
        encoding="utf-8"
    )
    cache_key = (
        "fortnite-" +
        version.replace(".", "-")
    )
    next_index = replace_exactly_once(
        index,
        re.compile(
            r'(config\.js\?v=)[^"]+'
        ),
        rf"\g<1>{cache_key}",
        "index.html config cache",
    )

    worker = worker_path.read_text(
        encoding="utf-8"
    )
    next_worker = replace_exactly_once(
        worker,
        re.compile(
            r'(const CURRENT_FORTNITE_VERSION\s*=\s*")'
            r'[0-9]{1,2}\.[0-9]{1,2}(";)',
            re.MULTILINE,
        ),
        rf"\g<1>{version}\g<2>",
        "worker.js",
    )

    updates = (
        (config_path, config, next_config),
        (index_path, index, next_index),
        (worker_path, worker, next_worker),
    )

    for file_path, before, after in updates:
        if before == after:
            continue

        file_path.write_text(
            after,
            encoding="utf-8",
        )
        changed.append(file_path)

    return changed


def write_github_output(
    changed: bool,
    version: str,
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
            f"changed={'true' if changed else 'false'}\n"
        )
        handle.write(
            f"fortnite_version={version}\n"
        )


def self_test() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)

        files = {
            "config": root / "config.js",
            "index": root / "index.html",
            "worker": root / "worker.js",
        }

        files["config"].write_text(
            'window.FNAA_CONFIG = { fortniteVersion: "42.20" };\n',
            encoding="utf-8",
        )
        files["index"].write_text(
            '<script src="config.js?v=104"></script>\n',
            encoding="utf-8",
        )
        files["worker"].write_text(
            'const CURRENT_FORTNITE_VERSION = "42.20";\n'
            'const PROMPT = `Fortnite v${CURRENT_FORTNITE_VERSION}`;\n',
            encoding="utf-8",
        )

        changed = update_sources(
            "42.30",
            files,
        )

        if len(changed) != 3:
            raise AssertionError(
                f"Expected three changed files, got {len(changed)}."
            )

        config_text = files["config"].read_text(
            encoding="utf-8"
        )
        index_text = files["index"].read_text(
            encoding="utf-8"
        )
        worker_text = files["worker"].read_text(
            encoding="utf-8"
        )

        if 'fortniteVersion: "42.30"' not in config_text:
            raise AssertionError(
                "Config version was not updated."
            )

        if "config.js?v=fortnite-42-30" not in index_text:
            raise AssertionError(
                "Config cache key was not updated."
            )

        if 'CURRENT_FORTNITE_VERSION = "42.30"' not in worker_text:
            raise AssertionError(
                "Worker version was not updated."
            )

        changed_again = update_sources(
            "42.30",
            files,
        )

        if changed_again:
            raise AssertionError(
                "A second identical version sync must be a no-op."
            )

        try:
            update_sources(
                "not-a-version",
                files,
            )
        except VersionSyncError:
            pass
        else:
            raise AssertionError(
                "Invalid versions must be rejected."
            )

    print(
        "FNAA_VERSION_SYNC_SELFTEST_OK"
    )


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--version",
        default="",
    )

    parser.add_argument(
        "--self-test",
        action="store_true",
    )

    args = parser.parse_args()

    if args.self_test:
        self_test()
        return

    version = require_version(
        args.version
    )

    changed = update_sources(
        version
    )

    write_github_output(
        bool(changed),
        version,
    )

    if changed:
        names = ", ".join(
            path.relative_to(ROOT)
            .as_posix()
            for path in changed
        )

        print(
            f"Synced Fortnite {version} into: {names}"
        )
    else:
        print(
            f"E8 Fortnite version is already {version}."
        )


if __name__ == "__main__":
    main()
