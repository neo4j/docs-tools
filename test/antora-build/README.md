# antora-build: check an Antora (or Node) upgrade against our extensions

`run.sh` repeats the build job in `.github/workflows/reusable-docs-build.yml` for one
Antora version against a real docs repo. `compare.sh` diffs two runs. Use them before
changing the `antora-version` (or `node-version`) default in that workflow.

The extension list, Node version and attribute defaults are read from the workflow with
`yq`, so they follow it. The install order, the 7-day npm cooldown, the CLI flags and
`NODE_PATH` match CI.

```sh
./run.sh --antora-version 3.1.15                 # baseline
./run.sh --antora-version 3.2.2                  # candidate
./compare.sh work/docs-aura-default-preview-antora-3.1.15 \
             work/docs-aura-default-preview-antora-3.2.2

./run.sh --antora-version 3.2.2 --mode publish   # adds tabbed-nav, fetches the prod nav
./run.sh --antora-version 3.2.2 --local-extensions  # use extensions/antora/* from this checkout
./run.sh --antora-version 3.2.2 --repo neo4j/docs-operations-manual --ref dev
```

Needs `node`, `npm`, `git`, `yq`, `jq` and `rsync`, plus network access. Output goes to
`work/<repo>-<ref>-<mode>-antora-<version>/` (ignored by git): `build.out`, `log/`,
`site/`, `installed.txt`, `key-versions.txt` and the source commit.

`compare.sh` exits non-zero on a failed build, any warn/error/fatal in the candidate log,
a different file list, or content differences. It ignores generator version strings,
sitemap `lastmod`, ordering in redirect files and `.meta/pageList`, and reports separately
any file where the only change is the `roles` and `pathname` keys Antora 3.2 adds to nav items.

Both runs must use the same source commit. Re-run the baseline if the target repo moved.

## Result: Antora 3.1.15 vs 3.2.2 (Node 24.22.1, default extension list)

Tested on `neo4j/docs-aura` and `neo4j/docs-operations`, in preview and publish mode:

- All builds exit 0 with no warn/error/fatal, identical log counts and identical file lists.
- Building with the extensions from this checkout (`--local-extensions`, docs-aura) gives the
  same site as the published ones.
- The only change is additive nav data. Antora 3.2 adds `"roles":["page"]` to nav items, and
  `"pathname"` to nav items that link to a heading (`url` with a `#fragment`). It shows up in
  each page's embedded `page-nav-data` block, in `aura/nav.json`-style nav files and in
  `nav/tabs.json`. docs-operations: 516 nav blocks compared, none differ beyond those two keys.
  Check that the UI bundle and anything reading these files tolerates the new keys before upgrading.

## Testing a local UI bundle

Set `UI_BUNDLE_URL` to a path or URL to build with a different UI bundle than the workflow's
`ui-bundle-docs-restructure.zip`, for example one built from a docs-ui branch:

```sh
UI_BUNDLE_URL=/path/to/docs-ui/build/ui-bundle.zip ./run.sh --antora-version 3.2.2 --repo neo4j/docs-operations
```
