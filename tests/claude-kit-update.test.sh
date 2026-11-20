#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
update_script="$repository_root/claude-kit-update"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0
claude_calls="$sandbox/claude-calls"
link_directory="$sandbox/links"

mkdir -p "$sandbox/bin"
cat > "$sandbox/bin/claude" <<'STUB'
echo "$*" >> "$CLAUDE_CALLS"
case "$*" in
  "plugin marketplace list --json") cat "$MARKETPLACES_JSON" ;;
  "plugin list --available --json") cat "$PLUGINS_JSON" ;;
  "plugin update broken@claude-kit --scope user") exit 1 ;;
esac
exit 0
STUB
chmod +x "$sandbox/bin/claude"

cat > "$sandbox/bin/git" <<'STUB'
echo "git $*" >> "$CLAUDE_CALLS"
[ -z "${GIT_PULL_FAILS:-}" ]
STUB
chmod +x "$sandbox/bin/git"

cat > "$sandbox/plugins.json" <<'JSON'
{
  "installed": [
    {"id": "handoff@claude-kit", "scope": "user"},
    {"id": "ponytail@ponytail", "scope": "user"}
  ],
  "available": [
    {"pluginId": "draft-pr@claude-kit", "marketplaceName": "claude-kit"},
    {"pluginId": "vercel@claude-plugins-official", "marketplaceName": "claude-plugins-official"}
  ]
}
JSON

run_update() {
  : > "$claude_calls"
  PATH="$sandbox/bin:$PATH" CLAUDE_CALLS="$claude_calls" PLUGINS_JSON="$sandbox/plugins.json" \
    MARKETPLACES_JSON="$sandbox/marketplaces.json" CLAUDE_KIT_LINK_DIR="$link_directory" \
    bash "$update_script" 2>&1
}

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
called() { grep -qxF -- "$1" "$claude_calls"; }
not_called() { ! grep -qF -- "$1" "$claude_calls"; }
links_to() { [ "$(readlink "$link_directory/$1")" = "$2" ]; }
calls_in_order() {
  local first_line second_line
  first_line="$(grep -nxF -- "$1" "$claude_calls" | cut -d: -f1)"
  second_line="$(grep -nxF -- "$2" "$claude_calls" | cut -d: -f1)"
  [ -n "$first_line" ] && [ -n "$second_line" ] && [ "$first_line" -lt "$second_line" ]
}

echo '[]' > "$sandbox/marketplaces.json"
output="$(run_update)"
status=$?
expect "a fresh machine exits 0" [ "$status" -eq 0 ]
expect "this checkout is pulled" called "git -C $repository_root pull --ff-only"
expect "the checkout is pulled before the marketplaces are updated" \
  calls_in_order "git -C $repository_root pull --ff-only" "plugin marketplace update"
expect "a missing claude-kit marketplace is added from this checkout" called "plugin marketplace add $repository_root"
expect "every marketplace is updated after the add" \
  calls_in_order "plugin marketplace add $repository_root" "plugin marketplace update"
expect "plugins are updated after the marketplaces" \
  calls_in_order "plugin marketplace update" "plugin update handoff@claude-kit --scope user"
expect "installed plugins of other marketplaces are updated" called "plugin update ponytail@ponytail --scope user"
expect "plugins that are not installed stay uninstalled" not_called "plugin install"
expect "claude-notes is linked onto the PATH folder" links_to claude-notes "$repository_root/notes-viewer/claude-notes"
expect "claude-kit-update is linked onto the PATH folder" links_to claude-kit-update "$repository_root/claude-kit-update"

echo '[{"name": "claude-kit"}]' > "$sandbox/marketplaces.json"
output="$(run_update)"
expect "a second run exits 0" [ $? -eq 0 ]
expect "an existing marketplace is not added again" not_called "plugin marketplace add"
expect "existing links are kept" links_to claude-notes "$repository_root/notes-viewer/claude-notes"

rm "$link_directory/claude-notes"
echo "my own script" > "$link_directory/claude-notes"
output="$(run_update)"
expect "a file of the user's own at a link path is left alone" grep -qx "my own script" "$link_directory/claude-notes"
expect "a file left alone is reported" grep -qF "$link_directory/claude-notes" <<<"$output"

sed -i.bak 's/"handoff@claude-kit"/"broken@claude-kit"/' "$sandbox/plugins.json"
output="$(run_update)"
status=$?
expect "a failed plugin update exits 1" [ "$status" -eq 1 ]
expect "the other plugins are still updated after a failure" called "plugin update ponytail@ponytail --scope user"
expect "the failed plugin is named" grep -qF "broken@claude-kit" <<<"$output"

sed -i.bak 's/"broken@claude-kit"/"handoff@claude-kit"/' "$sandbox/plugins.json"
output="$(GIT_PULL_FAILS=1 run_update)"
status=$?
expect "a failed pull exits 1" [ "$status" -eq 1 ]
expect "the plugins are still updated after a failed pull" called "plugin update handoff@claude-kit --scope user"
expect "the failed pull is named" grep -qF "Failed: pull $repository_root" <<<"$output"

run_profile() {
  local project_folder="$1" profile_name="$2"
  : > "$claude_calls"
  (cd "$project_folder" && PATH="$sandbox/bin:$PATH" CLAUDE_CALLS="$claude_calls" \
    bash "$update_script" profile "$profile_name" 2>&1)
}
plugin_setting() {
  jq -r --arg plugin "$2" '.enabledPlugins[$plugin]' "$1/.claude/settings.local.json"
}

project="$sandbox/project"
mkdir -p "$project/.claude"
echo '{"permissions": {"allow": ["Bash(ls:*)"]}, "enabledPlugins": {"handoff@claude-kit": true}}' \
  > "$project/.claude/settings.local.json"

output="$(run_profile "$project" notes)"
status=$?
expect "the notes profile exits 0" [ "$status" -eq 0 ]
expect "notes turns the code plugins off" [ "$(plugin_setting "$project" tdd@claude-kit)" = false ]
expect "notes turns the web plugins off" [ "$(plugin_setting "$project" vercel@claude-plugins-official)" = false ]
expect "a profile keeps the other plugin settings" [ "$(plugin_setting "$project" handoff@claude-kit)" = true ]
expect "a profile keeps the other settings" [ "$(jq -r '.permissions.allow[0]' "$project/.claude/settings.local.json")" = "Bash(ls:*)" ]
expect "a profile pulls and updates nothing" [ ! -s "$claude_calls" ]
expect "a profile says where it wrote" grep -qF "$project/.claude/settings.local.json" <<<"$output"

run_profile "$project" code >/dev/null
expect "code turns the code plugins on" [ "$(plugin_setting "$project" code-style@claude-kit)" = true ]
expect "code turns the web plugins off" [ "$(plugin_setting "$project" ui-design@claude-kit)" = false ]

fresh_project="$sandbox/fresh-project"
mkdir -p "$fresh_project"
run_profile "$fresh_project" web >/dev/null
expect "web turns the code plugins on in a project with no settings" [ "$(plugin_setting "$fresh_project" quality-gates@claude-kit)" = true ]
expect "web turns the web plugins on" [ "$(plugin_setting "$fresh_project" vercel@claude-plugins-official)" = true ]

output="$(run_profile "$fresh_project" games)"
status=$?
expect "an unknown profile exits 2" [ "$status" -eq 2 ]
expect "an unknown profile names the three profiles" grep -qF "web|code|notes" <<<"$output"

[ "$failures" -eq 0 ] || exit 1
