#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
update_script="$repository_root/claude-kit-update"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0
claude_calls="$sandbox/claude-calls"
ledger_calls="$sandbox/ledger-calls"
link_directory="$sandbox/links"

mkdir -p "$sandbox/bin"
cat > "$sandbox/bin/claude" <<'STUB'
echo "$*" >> "$CLAUDE_CALLS"
case "$*" in
  "plugin marketplace list --json") cat "$MARKETPLACES_JSON" ;;
  "plugin list --available --json") cat "$PLUGINS_JSON" ;;
  "plugin update broken@claude-kit --scope user") exit 1 ;;
  "plugin update guards@claude-kit --scope user")
    if [ -n "${GUARDS_UP_TO_DATE:-}" ]; then
      echo 'Plugin "guards" is already at the latest version.'
    else
      echo 'Plugin "guards" updated from 0.8.0 to 0.11.1 for scope user. Restart to apply changes.'
    fi ;;
  "plugin update handoff@claude-kit --scope user"|"plugin update ponytail@ponytail --scope user")
    echo "Plugin is already at the latest version." ;;
esac
exit 0
STUB
chmod +x "$sandbox/bin/claude"

cat > "$sandbox/fake-ledger" <<'STUB'
echo "$*" >> "$LEDGER_CALLS"
[ -z "${LEDGER_FAILS:-}" ]
STUB
chmod +x "$sandbox/fake-ledger"

cat > "$sandbox/bin/git" <<'STUB'
echo "git $*" >> "$CLAUDE_CALLS"
[ -z "${GIT_PULL_FAILS:-}" ]
STUB
chmod +x "$sandbox/bin/git"

cat > "$sandbox/plugins.json" <<'JSON'
{
  "installed": [
    {"id": "handoff@claude-kit", "scope": "user"},
    {"id": "ponytail@ponytail", "scope": "user"},
    {"id": "guards@claude-kit", "scope": "user"}
  ],
  "available": [
    {"pluginId": "draft-pr@claude-kit", "marketplaceName": "claude-kit"},
    {"pluginId": "vercel@claude-plugins-official", "marketplaceName": "claude-plugins-official"},
    {"pluginId": "new-plugin@claude-kit", "marketplaceName": "claude-kit"},
    {"pluginId": "other@claude-plugins-official", "marketplaceName": "claude-plugins-official"}
  ]
}
JSON

run_update() {
  : > "$claude_calls"
  : > "$ledger_calls"
  PATH="$sandbox/bin:$PATH" CLAUDE_CALLS="$claude_calls" PLUGINS_JSON="$sandbox/plugins.json" \
    MARKETPLACES_JSON="$sandbox/marketplaces.json" CLAUDE_KIT_LINK_DIR="$link_directory" \
    CLAUDE_KIT_LEDGER_COMMAND="$sandbox/fake-ledger" LEDGER_CALLS="$ledger_calls" \
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
not_called_exactly() { ! grep -qxF -- "$1" "$claude_calls"; }
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
  calls_in_order "git -C $repository_root pull --ff-only" "plugin marketplace update claude-kit"
expect "a missing claude-kit marketplace is added from this checkout" called "plugin marketplace add $repository_root"
expect "the claude-kit marketplace is updated after the add" \
  calls_in_order "plugin marketplace add $repository_root" "plugin marketplace update claude-kit"
expect "plugins are updated after the marketplaces" \
  calls_in_order "plugin marketplace update claude-kit" "plugin update handoff@claude-kit --scope user"
expect "other marketplaces are not updated" not_called_exactly "plugin marketplace update"
expect "installed plugins of other marketplaces are not updated" not_called "plugin update ponytail@ponytail"
expect "an available claude-kit plugin that is not installed is not updated" not_called "plugin update new-plugin@claude-kit"
expect "an available claude-kit plugin that is not installed is never installed" not_called "plugin install"
expect "an available plugin of another marketplace is not installed" not_called "plugin install other@claude-plugins-official"
expect "claude-notes is linked onto the PATH folder" links_to claude-notes "$repository_root/notes-viewer/claude-notes"
expect "claude-ledger is linked onto the PATH folder" links_to claude-ledger "$repository_root/plugins/token-ledger/bin/claude-ledger"
expect "claude-kit-update is linked onto the PATH folder" links_to claude-kit-update "$repository_root/claude-kit-update"
expect "claude-kit-doctor is linked onto the PATH folder" links_to claude-kit-doctor "$repository_root/claude-kit-doctor"

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
expect "the other plugins are still updated after a failure" called "plugin update guards@claude-kit --scope user"
expect "the failed plugin is named" grep -qF "broken@claude-kit" <<<"$output"

sed -i.bak 's/"broken@claude-kit"/"handoff@claude-kit"/' "$sandbox/plugins.json"
output="$(GIT_PULL_FAILS=1 run_update)"
status=$?
expect "a failed pull exits 1" [ "$status" -eq 1 ]
expect "the plugins are still updated after a failed pull" called "plugin update handoff@claude-kit --scope user"
expect "the failed pull is named" grep -qF "Failed: pull $repository_root" <<<"$output"

output="$(run_update)"
status=$?
expect "an updated plugin exits 0" [ "$status" -eq 0 ]
expect "an updated plugin is recorded as a fix once" [ "$(grep -c '' "$ledger_calls")" -eq 1 ]
expect "the fix names the update from and to versions" grep -qF -- "--fixed claude-kit-update: guards 0.8.0 to 0.11.1" "$ledger_calls"
expect "the output names the updated plugin and its versions" grep -qxF "Updated guards from 0.8.0 to 0.11.1" <<<"$output"
expect "the output leaves out plugins that were not updated" [ -z "$(grep -F handoff <<<"$output")" ]
expect "the output leaves out the per-plugin progress lines" [ -z "$(grep -E '^Updating .+@' <<<"$output")" ]

output="$(LEDGER_FAILS=1 run_update)"
status=$?
expect "a failed fix record exits 1" [ "$status" -eq 1 ]
expect "a failed fix record is named" grep -qF "Failed: record the update" <<<"$output"

output="$(GUARDS_UP_TO_DATE=1 run_update)"
status=$?
expect "a run with no plugin update exits 0" [ "$status" -eq 0 ]
expect "a run with no plugin update records no fix" [ ! -s "$ledger_calls" ]

cat > "$sandbox/plugins.json" <<'JSON'
{
  "installed": [
    {"id": "guards@claude-kit", "scope": "user"},
    {"id": "tdd@claude-kit", "scope": "user"}
  ],
  "available": [
    {"pluginId": "code-style@claude-kit", "marketplaceName": "claude-kit"},
    {"pluginId": "tdd@claude-kit", "marketplaceName": "claude-kit"},
    {"pluginId": "quality-gates@claude-kit", "marketplaceName": "claude-kit"},
    {"pluginId": "guards@claude-kit", "marketplaceName": "claude-kit"}
  ]
}
JSON
output="$(run_update)"
status=$?
expect "the claude-kit plugins claude-lite reads are updated only when installed" [ "$status" -eq 0 ]
expect "claude-lite's installed guards plugin is updated" called "plugin update guards@claude-kit --scope user"
expect "claude-lite's installed tdd plugin is updated" called "plugin update tdd@claude-kit --scope user"
expect "claude-lite's uninstalled code-style plugin is not updated" not_called "plugin update code-style@claude-kit"
expect "claude-lite's uninstalled quality-gates plugin is not updated" not_called "plugin update quality-gates@claude-kit"
expect "claude-lite's uninstalled code-style plugin is not installed" not_called "plugin install code-style@claude-kit"
expect "claude-lite's uninstalled quality-gates plugin is not installed" not_called "plugin install quality-gates@claude-kit"

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

home_moved="$sandbox/home-moved"
mkdir -p "$home_moved/.claude/small-plans/alpha/set-one"
echo "kept" > "$home_moved/.claude/small-plans/alpha/set-one/01-step.md"
output="$(HOME="$home_moved" run_update)"
expect "an old small-plans folder moves when the new one is absent" [ "$(cat "$home_moved/.local/share/small-plans/alpha/set-one/01-step.md" 2>/dev/null)" = kept ]
expect "the old small-plans folder is gone after the move" [ ! -e "$home_moved/.claude/small-plans" ]
expect "the move is reported" grep -qxF "Moved small plans to ~/.local/share/small-plans" <<<"$output"

home_merge="$sandbox/home-merge"
mkdir -p "$home_merge/.claude/small-plans/alpha/set-old" "$home_merge/.claude/small-plans/beta/set-two" "$home_merge/.local/share/small-plans/alpha/set-new"
echo "old alpha" > "$home_merge/.claude/small-plans/alpha/set-old/01-step.md"
echo "beta" > "$home_merge/.claude/small-plans/beta/set-two/01-step.md"
echo "new alpha" > "$home_merge/.local/share/small-plans/alpha/set-new/01-step.md"
output="$(HOME="$home_merge" run_update)"
expect "a clashing project folder is left in the old folder" [ "$(cat "$home_merge/.claude/small-plans/alpha/set-old/01-step.md" 2>/dev/null)" = "old alpha" ]
expect "the clashing project keeps the new folder's files" [ "$(cat "$home_merge/.local/share/small-plans/alpha/set-new/01-step.md")" = "new alpha" ]
expect "a project folder with no clash moves into the new folder" [ "$(cat "$home_merge/.local/share/small-plans/beta/set-two/01-step.md" 2>/dev/null)" = beta ]
expect "the clash is reported" grep -qF "Left ~/.claude/small-plans/alpha: already in ~/.local/share/small-plans" <<<"$output"
expect "the old folder stays while it holds a clash" [ -d "$home_merge/.claude/small-plans" ]

home_override="$sandbox/home-override"
mkdir -p "$home_override/.claude/small-plans/alpha/set-one"
echo "kept" > "$home_override/.claude/small-plans/alpha/set-one/01-step.md"
HOME="$home_override" SMALL_PLANS_DIR="$sandbox/work-plans" run_update >/dev/null
expect "SMALL_PLANS_DIR set leaves the old small-plans folder where it is" [ "$(cat "$home_override/.claude/small-plans/alpha/set-one/01-step.md")" = kept ]
expect "SMALL_PLANS_DIR set creates no new small-plans folder" [ ! -e "$home_override/.local/share/small-plans" ]

[ "$failures" -eq 0 ] || exit 1
