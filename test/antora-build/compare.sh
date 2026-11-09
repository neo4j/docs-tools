#!/usr/bin/env bash
# Compare two run.sh output directories (baseline first, candidate second).
#   ./compare.sh work/<baseline> work/<candidate>
set -uo pipefail
A="${1:?baseline dir}"; B="${2:?candidate dir}"; A="${A%/}"; B="${B%/}"
rc=0

echo "### Source commits (must match for a fair comparison)"
diff <(cat "$A/source-commit.txt") <(cat "$B/source-commit.txt") && echo same

echo; echo "### Exit codes"; echo "baseline: $(cat "$A/exit-code.txt")  candidate: $(cat "$B/exit-code.txt")"
[ "$(cat "$B/exit-code.txt")" = 0 ] || rc=1

echo; echo "### Key package versions"; diff "$A/key-versions.txt" "$B/key-versions.txt" || true

levels() { jq -rs 'group_by(.level)|map("\(.[0].level)=\(length)")|join(" ")' "$1/log/log.json" 2>/dev/null; }
echo; echo "### Log levels"; echo "baseline:  $(levels "$A")"; echo "candidate: $(levels "$B")"
bad=$(jq -rs '[.[]|select(.level=="warn" or .level=="error" or .level=="fatal")]|length' "$B/log/log.json" 2>/dev/null || echo "?")
echo "candidate warn/error/fatal: $bad"; [ "$bad" = 0 ] || rc=1

msgs() { jq -rs '.[]|select(.level=="warn" or .level=="error" or .level=="fatal")|"\(.level): \(.msg)"' "$1/log/log.json" 2>/dev/null | sort; }
echo; echo "### Warning/error messages: only in one run"
diff <(msgs "$A") <(msgs "$B") || true

echo; echo "### Site file list"
diff <(cd "$A/site" && find . -type f | sort) <(cd "$B/site" && find . -type f | sort) && echo "same files"

echo; echo "### Site content diff"
# Normalisations (each is reported, never silent):
#  - generator version strings
#  - ordering only: nginx redirect files (sorted), .meta/pageList (jq -S)
#  - page-nav-data: nav items gaining "roles":["page"] (Antora 3.2 nav item roles) are counted
#    separately, and the remaining JSON is compared exactly
norm() { sed -E 's#<lastmod>[^<]*</lastmod>#<lastmod>T</lastmod>#; s#(<meta name="generator" content="Antora )[0-9.]+#\1X#; s#Antora [0-9]+\.[0-9]+\.[0-9]+#Antora X#g'; }
navjson() { grep -o '<script type="application/json" id="page-nav-data">.*</script>' "$1" | sed -E 's#^[^>]*>##; s#</script>$##'; }
strip_roles() { jq -cS 'walk(if type=="object" and .roles==["page"] then del(.roles) else . end)'; }
changed=0; roles_only=0
while IFS= read -r f; do
  a="$A/site/$f"; b="$B/site/$f"
  case "$f" in
    *.conf) diff -q <(sort "$a") <(sort "$b") >/dev/null || { changed=$((changed+1)); echo "differs: $f"; } ;;
    .meta/pageList) diff -q <(jq -S . "$a") <(jq -S . "$b") >/dev/null || { changed=$((changed+1)); echo "differs: $f"; } ;;
    *.html)
      if diff -q <(norm <"$a") <(norm <"$b") >/dev/null; then continue; fi
      if diff -q <(norm <"$a" | grep -v page-nav-data) <(norm <"$b" | grep -v page-nav-data) >/dev/null \
         && diff -q <(navjson "$a" | strip_roles) <(navjson "$b" | strip_roles) >/dev/null; then
        roles_only=$((roles_only+1))
      else changed=$((changed+1)); echo "differs: $f"; fi ;;
    nav.json|*/nav.json|nav/tabs.json)
      if diff -q <(jq -cS . "$a") <(jq -cS . "$b") >/dev/null; then continue; fi
      if diff -q <(jq -cS . "$a" | strip_roles) <(jq -cS . "$b" | strip_roles) >/dev/null; then roles_only=$((roles_only+1))
      else changed=$((changed+1)); echo "differs: $f"; fi ;;
    *.xml|*.json|*.txt) diff -q <(norm <"$a") <(norm <"$b") >/dev/null || { changed=$((changed+1)); echo "differs: $f"; } ;;
    *) cmp -s "$a" "$b" || { changed=$((changed+1)); echo "differs: $f"; } ;;
  esac
done < <(cd "$A/site" && find . -type f | sort | sed 's#^\./##')
echo "files differing only by nav roles:[page]: $roles_only"
echo "files with other differences: $changed"
[ "$changed" = 0 ] || rc=1
exit $rc
