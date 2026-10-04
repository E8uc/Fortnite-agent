Custom GitHub Actions workflows are disabled and removed. Build, data refresh,
and browser checks run locally. The existing URL uses GitHub's managed Pages
publication from `gh-pages`.

Assemble a complete, validated release from a fresh checkout:

```sh
python3 .github/scripts/assemble-site.py --output /tmp/fnaa-site
python3 .github/scripts/publish-pages.py --site /tmp/fnaa-site --dry-run
python3 .github/scripts/publish-pages.py --site /tmp/fnaa-site
```

Use normal local Git credentials (`gh auth setup-git` if needed). The publisher
pushes a complete snapshot without force-pushing. No changed files means no push.

Data updates use NovaSparx's existing local reference-index builder, followed by
`tools/create-browser-data-release.py` with explicit mappings and matching Live/
Studio manifest sources. Copy only its approved release parts into
`.github/browser-data/`, update `.github/novasparx-data.json`, and assemble.
Import the assembled asset list with `sync_fortnite_assets.py --manifest-file
/tmp/fnaa-site/novasparx-runtime/asset-list/manifest.json`, then run the existing
local database builder. Promote only matching build/count/hash inputs.

The data package contains generated public metadata, not NovaSparx source or
credentials. Corrupt, incomplete, or mixed-build inputs leave prior outputs intact.
