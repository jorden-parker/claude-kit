#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sync_script="$repository_root/sync-opencode"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0
config="$sandbox/opencode"

mkdir -p "$sandbox/bin" "$config/skills/naming-review" "$config/claude-kit"
cat > "$sandbox/bin/opencode" <<'FAKE'
[ "$1" = "--version" ] && echo 2.1.2
exit 0
FAKE
chmod +x "$sandbox/bin/opencode"
echo "my own skill" > "$config/skills/naming-review/SKILL.md"
printf '{"model":"anthropic/claude-sonnet-5-5","instructions":["my-rules.md","/retired/style.md"],"mcp":{"servers":{"mine":{"type":"local","command":["mine"]}}}}\n' > "$config/opencode.json"
mkdir -p "$config/plugins"
echo "export default {}" > "$config/plugins/mine.js"
mkdir -p "$config/commands" "$config/claude-kit/retired"
echo "old" > "$config/commands/retired.md"
printf 'commands/retired.md\nmcp retired\ninstruction /retired/style.md\n' > "$config/claude-kit/retired.files"
jq '.mcp.servers.retired = {"type":"local","command":["old"]}' "$config/opencode.json" > "$sandbox/c" && mv "$sandbox/c" "$config/opencode.json"

run_sync() { PATH="$sandbox/bin:$PATH" OPENCODE_CONFIG_DIR="$config" bash "$sync_script" "$@" 2>&1; }

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
output_has() { grep -qF -- "$1" <<<"$output"; }
config_query() { jq -e "$@" "$config/opencode.json" >/dev/null; }

output="$(run_sync)"
sync_status=$?

expect "sync fails because one plugin could not install" test "$sync_status" -eq 1
expect "a skill file it did not write is left alone" grep -qx "my own skill" "$config/skills/naming-review/SKILL.md"
expect "the clash is reported" output_has "code-style: FAILED"
expect "the clash names the file" output_has "skills/naming-review"
expect "other plugins still install" test -f "$config/skills/build-plans/SKILL.md"
expect "the user's settings are kept" config_query '.model == "anthropic/claude-sonnet-5-5"'
expect "the user's own MCP server is kept" config_query '.mcp.servers.mine.command == ["mine"]'
expect "every tool plugin gets an MCP server" config_query '.mcp.servers | has("brainstorm") and has("ui-design") and has("draft-pr") and has("handoff") and has("small-plans") and has("project-notes")'
expect "a plugin of hand-written commands gets no MCP server" config_query '.mcp.servers | has("prompt-optimizer") | not'
expect "portable commands are installed" test -f "$config/commands/optimize.md"
expect "a plugin removed from the repo loses its command" test ! -e "$config/commands/retired.md"
expect "a plugin removed from the repo loses its MCP server" config_query '.mcp.servers | has("retired") | not'
expect "a plugin removed from the repo loses its staged copy" test ! -e "$config/claude-kit/retired"
expect "a plugin removed from the repo loses its instruction" config_query '.instructions | index("/retired/style.md") | not'
expect "command hooks are installed as a plugin file" test -f "$config/plugins/claude-kit-tdd-hooks.js"
expect "command hooks are reported as ported" output_has "tdd: installed. Its command hooks run through a plugin file"
expect "a plugin file it did not write is left alone" grep -qx "export default {}" "$config/plugins/mine.js"
expect "an output style is listed under instructions" config_query --arg style "$config/claude-kit/adhd-style/output-styles/adhd.md" '.instructions == ["my-rules.md", $style]'
expect "an output style is reported as always on" output_has "adhd-style: installed. Its output style is always on"

rm "$config/skills/naming-review/SKILL.md"
rmdir "$config/skills/naming-review"
output="$(run_sync code-style)"
expect "syncing one plugin succeeds once the clash is gone" test "$?" -eq 0
expect "its skill is installed" test -f "$config/skills/naming-review/SKILL.md"
expect "syncing one plugin keeps the others" test -f "$config/skills/build-plans/SKILL.md"

mkdir -p "$config/skills/dropped-skill"
echo "skills/dropped-skill" >> "$config/claude-kit/brainstorm.files"
output="$(run_sync brainstorm)"
expect "a skill dropped from a plugin is removed on the next sync" test ! -e "$config/skills/dropped-skill"

rm "$config/opencode.json"
printf '{\n  // comments\n}\n' > "$config/opencode.jsonc"
output="$(run_sync handoff)"
expect "a JSONC config is never rewritten" grep -qF "// comments" "$config/opencode.jsonc"
expect "a JSONC config is reported" output_has "opencode.jsonc"

[ "$failures" -eq 0 ] || exit 1
