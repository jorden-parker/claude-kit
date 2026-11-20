#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
marketplace="$repository_root/.claude-plugin/marketplace.json"
readme="$repository_root/README.md"
failures=0

expect() {
  local description="$1"
  shift
  if "$@"; then
    echo "ok: $description"
  else
    echo "FAIL: $description"
    failures=$((failures + 1))
  fi
}

is_in_marketplace() {
  jq -e --arg source "./plugins/$1" '.plugins[] | select(.source == $source)' "$marketplace" >/dev/null
}

is_in_readme_table() {
  grep -qF "| [$1](plugins/$1/)" "$readme"
}

has_plugin_folder() {
  [ -d "$repository_root/${1#./}" ]
}

for plugin_folder in "$repository_root"/plugins/*/; do
  plugin_name="$(basename "$plugin_folder")"
  expect "$plugin_name is listed in marketplace.json" is_in_marketplace "$plugin_name"
  expect "$plugin_name has a row in the README table" is_in_readme_table "$plugin_name"
done

while IFS= read -r plugin_source; do
  expect "marketplace source $plugin_source is a folder" has_plugin_folder "$plugin_source"
done < <(jq -r '.plugins[].source' "$marketplace")

expect "turn-edits-lib.sh is the same in code-style and tdd" \
  cmp -s "$repository_root/plugins/code-style/hooks/turn-edits-lib.sh" \
  "$repository_root/plugins/tdd/hooks/turn-edits-lib.sh"

kit_theme="$repository_root/theme/kit-theme.css"

has_kit_theme() {
  [ -s "$kit_theme" ] || return 1
  while IFS= read -r theme_line; do
    [ -n "$theme_line" ] || continue
    grep -qF -- "$theme_line" "$repository_root/$1" || return 1
  done <"$kit_theme"
}

for themed_page in \
  plugins/brainstorm/hooks/register.ts \
  plugins/draft-pr/hooks/page-style.ts \
  plugins/ui-design/hooks/page-style.ts \
  design-studio/monitor.html \
  notes-viewer/index.html; do
  expect "$themed_page carries every line of theme/kit-theme.css" has_kit_theme "$themed_page"
done

[ "$failures" -eq 0 ] || exit 1
