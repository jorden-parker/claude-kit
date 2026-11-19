#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sync_script="$repository_root/sync-crush"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0
config="$sandbox/crush"
generated_config="$config/claude-kit/crushrc"

mkdir -p "$sandbox/bin" "$config/skills/naming-review" "$config/commands" "$config/claude-kit/retired"
printf 'exit 0\n' > "$sandbox/bin/crush"
chmod +x "$sandbox/bin/crush"
echo "my own skill" > "$config/skills/naming-review/SKILL.md"
printf 'option metrics false' > "$config/crushrc"
echo "old" > "$config/commands/retired.md"
printf 'commands/retired.md\n' > "$config/claude-kit/retired.files"
printf 'mcp add retired --command old\n' > "$config/claude-kit/retired.crushrc"

run_sync() { PATH="$sandbox/bin:$PATH" CRUSH_GLOBAL_CONFIG="$config" bash "$sync_script" "$@" 2>&1; }

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
fragment_has() { grep -qF -- "$2" "$config/claude-kit/$1.crushrc"; }
sources_fragment() { grep -qxF -- "source '$config/claude-kit/$1.crushrc'" "$generated_config"; }
sources_every_tool_plugin() {
  local plugin_name
  for plugin_name in brainstorm ui-design draft-pr handoff small-plans project-notes; do
    sources_fragment "$plugin_name" && fragment_has "$plugin_name" "mcp add $plugin_name --command node" || return 1
  done
}

output="$(run_sync)"
sync_status=$?

expect "sync fails because one plugin could not install" test "$sync_status" -eq 1
expect "a skill file it did not write is left alone" grep -qx "my own skill" "$config/skills/naming-review/SKILL.md"
expect "the clash is reported" output_has "code-style: FAILED"
expect "the clash names the file" output_has "skills/naming-review"
expect "other plugins still install" test -f "$config/skills/build-plans/SKILL.md"
expect "the user's own crushrc line is kept" grep -qxF "option metrics false" "$config/crushrc"
expect "the user's crushrc sources the generated one once" test "$(grep -cxF "if [ -f '$generated_config' ]; then source '$generated_config'; fi" "$config/crushrc")" -eq 1
expect "every tool plugin gets an MCP server in its own fragment" sources_every_tool_plugin
expect "a plugin of hand-written commands gets no fragment" test ! -e "$config/claude-kit/prompt-optimizer.crushrc"
expect "portable commands are installed" test -f "$config/commands/optimize.md"
expect "commands carry no frontmatter" test "$(head -c 3 "$config/commands/brainstorm.md")" != "---"
expect "agents are not installed" test ! -e "$config/agents"
expect "agents are reported as left out" output_has "brainstorm: installed. Its tools run through an MCP server; panes, autocomplete and composer fill stay in Claude Code. Its agents are left out"
expect "portable hooks are registered before the tools they match" fragment_has tdd "hook add PreToolUse --matcher '^(edit|multiedit|write)\$' --command 'node \"$config/claude-kit/tdd/crush-hooks.mjs\"' --name claude-kit-tdd --timeout 65"
expect "the hooks that cannot run are reported" output_has "tdd: installed. Only its hooks in portable-hooks/crush.json run"
expect "rules are added as a context file" fragment_has tdd "option context-path '$config/claude-kit/tdd/context/tdd.md'"
expect "an output style is added as a context file" fragment_has adhd-style "option context-path '$config/claude-kit/adhd-style/output-styles/adhd.md'"
expect "a plugin removed from the repo loses its command" test ! -e "$config/commands/retired.md"
expect "a plugin removed from the repo loses its fragment" test ! -e "$config/claude-kit/retired.crushrc"
expect "a plugin removed from the repo is no longer sourced" test "$(grep -c retired "$generated_config")" -eq 0
expect "a plugin removed from the repo loses its staged copy" test ! -e "$config/claude-kit/retired"

rm "$config/skills/naming-review/SKILL.md"
rmdir "$config/skills/naming-review"
output="$(run_sync code-style)"
expect "syncing one plugin succeeds once the clash is gone" test "$?" -eq 0
expect "its skill is installed" test -f "$config/skills/naming-review/SKILL.md"
expect "its edit checks run before edits" fragment_has code-style "--matcher '^(edit|multiedit|write)\$'"
expect "syncing one plugin keeps the others" sources_fragment brainstorm

mkdir -p "$config/skills/dropped-skill"
echo "skills/dropped-skill" >> "$config/claude-kit/brainstorm.files"
output="$(run_sync brainstorm)"
expect "a skill dropped from a plugin is removed on the next sync" test ! -e "$config/skills/dropped-skill"
expect "syncing again still sources the generated crushrc once" test "$(grep -cxF "if [ -f '$generated_config' ]; then source '$generated_config'; fi" "$config/crushrc")" -eq 1

[ "$failures" -eq 0 ] || exit 1
