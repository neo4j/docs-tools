#!/usr/bin/env bash
# Replicates the build job in .github/workflows/reusable-docs-build.yml for one Antora
# version against a real docs repo, so Antora/Node upgrades can be checked against our
# extensions before the workflow default changes.
#
#   ./run.sh --antora-version 3.2.2 [--repo neo4j/docs-aura] [--ref console]
#            [--mode preview|publish] [--local-extensions] [--out DIR]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS_ROOT="$(cd "$HERE/../.." && pwd)"
WORKFLOW="$TOOLS_ROOT/.github/workflows/reusable-docs-build.yml"

ANTORA_VERSION=""; REPO="neo4j/docs-aura"; REF=""; MODE="preview"; LOCAL_EXT=false; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --antora-version) ANTORA_VERSION="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --local-extensions) LOCAL_EXT=true; shift ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$ANTORA_VERSION" ] || { echo "--antora-version is required" >&2; exit 2; }
[ "$MODE" = preview ] || [ "$MODE" = publish ] || { echo "--mode must be preview or publish" >&2; exit 2; }

NAME="$(basename "$REPO")-${REF:-default}-${MODE}-antora-${ANTORA_VERSION}"
OUT="${OUT:-$HERE/work/$NAME}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
rm -rf "$OUT"; mkdir -p "$OUT"
SRC="$OUT/src"

# --- Inputs, read from the workflow so they cannot drift from CI --------------------
wf() { yq eval ".on.workflow_call.inputs.\"$1\".default" "$WORKFLOW"; }
EXTENSIONS="$(wf antora-extensions | tr -s '[:space:]' ' ')"
NODE_EXPECTED="$(wf node-version)"
UI_BUNDLE="${UI_BUNDLE_URL:-https://static-content.neo4j.com/build/ui-bundle-docs-restructure.zip}"  # override to test a local UI bundle
ATTRIBUTES="$(wf antora-attributes)"
if [ "$MODE" = publish ]; then
  SCRIPT="verify:publish"
  URL="https://neo4j.com/docs"
  EXTENSIONS="$EXTENSIONS @neo4j-antora/tabbed-nav"
  ATTRIBUTES="$ATTRIBUTES --attribute page-no-local-manifest=true --attribute page-chatbot=$URL/assets/chatbot"
  export DOCS_FETCH_NAV=true
else
  SCRIPT="verify:preview"
  URL="https://neo4j-$(basename "$REPO")-0.surge.sh"
  export DOCS_EMIT_LOCAL_MANIFEST=true
fi

echo "== Node $(node -p process.versions.node) (workflow default: $NODE_EXPECTED)"
echo "== $REPO @ ${REF:-default branch}, $MODE, Antora $ANTORA_VERSION"

# --- Checkout ---------------------------------------------------------------------
git clone --quiet --depth 1 ${REF:+--branch "$REF"} "https://github.com/$REPO.git" "$SRC"
echo "$(git -C "$SRC" rev-parse HEAD)" > "$OUT/source-commit.txt"

# --- npm: same 7-day cooldown as CI ------------------------------------------------
NPMRC="$OUT/npmrc"
{
  echo "min-release-age=7"
  echo "min-release-age-exclude[]=@neo4j-antora/*"
  echo "min-release-age-exclude[]=@neo4j-documentation/*"
} > "$NPMRC"
export NPM_CONFIG_USERCONFIG="$NPMRC"

# --- Install, in the same order as the workflow ------------------------------------
cd "$SRC"
npm install --omit=dev
# shellcheck disable=SC2086
npm install $EXTENSIONS
npm install @neo4j-antora/antora-modify-sitemaps@0.7.3 @neo4j-antora/tabbed-nav
npm update
npm uninstall @antora/cli @antora/site-generator-default
npm install "antora@$ANTORA_VERSION"

if $LOCAL_EXT; then
  # Swap the published Antora extensions for the code in this checkout.
  for dir in "$TOOLS_ROOT"/extensions/antora/*/; do
    pkg="$(jq -r .name "$dir/package.json")"
    if [ -d "node_modules/$pkg" ]; then
      echo "Using local $pkg"
      # Install from a copy: npm chmods bin files, which would dirty this checkout.
      copy="$OUT/local-ext/$(basename "$dir")"
      mkdir -p "$copy"; rsync -a --exclude node_modules "$dir/" "$copy/"
      npm install --no-save "$copy"
    fi
  done
fi
npm list --all > "$OUT/installed.txt" 2>&1 || true
npm list --all 2>/dev/null | grep -E "@asciidoctor/core|@antora/(cli|asciidoc-loader|site-generator)" | sort | uniq -c > "$OUT/key-versions.txt" || true

# --- Build, same flags as CI ------------------------------------------------------
CLI_EXT=""
for e in $EXTENSIONS; do CLI_EXT="--extension $e $CLI_EXT"; done
# Same as CI: local-path extensions resolve hoisted deps from the repo node_modules.
export NODE_PATH="$SRC/node_modules"
set +e
# shellcheck disable=SC2086
npm run "$SCRIPT" -- --ui-bundle-url="$UI_BUNDLE" --url "$URL" --cache-dir "$OUT/antora-cache" $CLI_EXT $ATTRIBUTES 2>&1 | tee "$OUT/build.out"
STATUS=${PIPESTATUS[0]}
set -e

mkdir -p "$OUT/log"; cp -R build/log/. "$OUT/log/" 2>/dev/null || true
SITE="$(ls -d build/*/ 2>/dev/null | grep -v '^build/log/' | head -1 || true)"
[ -n "$SITE" ] && { rm -rf "$OUT/site"; cp -R "$SITE" "$OUT/site"; }
echo "$STATUS" > "$OUT/exit-code.txt"
echo "== exit $STATUS; results in $OUT"
exit "$STATUS"
