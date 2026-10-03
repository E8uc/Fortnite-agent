#!/usr/bin/env bash
set -euo pipefail

site="${1:-Fortnite-Ai-Agent-GitHub-Cloudflare}"
target="${site}/novasparx-runtime"

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

api="https://api.github.com/repos/${GITHUB_REPOSITORY}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

headers=(
  -H "Authorization: Bearer ${GITHUB_TOKEN}"
  -H "Accept: application/vnd.github+json"
  -H "X-GitHub-Api-Version: 2022-11-28"
)

curl --fail --silent --show-error --location   "${headers[@]}"   "${api}/actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=10"   -o "$tmp/runs.json"

run_id="$(
  python3 - "$tmp/runs.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

for run in payload.get("workflow_runs", []):
    run_id = run.get("id")
    if isinstance(run_id, int) and run_id > 0:
        print(run_id)
        raise SystemExit(0)

raise SystemExit("No successful Pages deployment is available to restore the NovaSparx runtime.")
PY
)"

curl --fail --silent --show-error --location   "${headers[@]}"   "${api}/actions/runs/${run_id}/artifacts?per_page=100"   -o "$tmp/artifacts.json"

artifact_id="$(
  python3 - "$tmp/artifacts.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

for artifact in payload.get("artifacts", []):
    if (
        artifact.get("name") == "github-pages"
        and not artifact.get("expired", False)
        and isinstance(artifact.get("id"), int)
    ):
        print(artifact["id"])
        raise SystemExit(0)

raise SystemExit("The latest successful Pages deployment has no reusable github-pages artifact.")
PY
)"

curl --fail --silent --show-error --location   "${headers[@]}"   "${api}/actions/artifacts/${artifact_id}/zip"   -o "$tmp/pages.zip"

mkdir -p "$tmp/pages-zip" "$tmp/pages-site"
unzip -q "$tmp/pages.zip" -d "$tmp/pages-zip"

artifact_tar="$(
  find "$tmp/pages-zip"     -type f     -name 'artifact.tar'     -print     -quit
)"

test -n "$artifact_tar"

tar -xf "$artifact_tar" -C "$tmp/pages-site"

source_runtime="$(
  find "$tmp/pages-site"     -type d     -name 'novasparx-runtime'     -print     -quit
)"

test -n "$source_runtime"
test -s "$source_runtime/worker.js"
test -s "$source_runtime/_framework/dotnet.js"
test -n "$(
  find "$source_runtime/_framework"     -type f     -name '*.wasm'     -print     -quit
)"
test -s "$source_runtime/location-index/manifest.json"
test -s "$source_runtime/studio-location-index/manifest.json"
test -s "$source_runtime/package-id-index/manifest.json"
test -s "$source_runtime/mappings/current.usmap"

rm -rf "$target"
mkdir -p "$(dirname "$target")"
cp -a "$source_runtime" "$target"

echo "Restored NovaSparx runtime from successful Pages run ${run_id}, artifact ${artifact_id}."
