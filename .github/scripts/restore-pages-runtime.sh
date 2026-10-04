#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point for existing local browser proof commands.
# Both runtime and generated data come from local checksum-pinned releases.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository="$(cd -- "${script_dir}/../.." && pwd)"
site="${1:-${repository}/Fortnite-Ai-Agent-GitHub-Cloudflare}"
python3 "${script_dir}/assemble-site.py" --runtime-only --output "${site}/novasparx-runtime"
