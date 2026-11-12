#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sync_script="$repository_root/sync-qwen"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0

mkdir -p "$sandbox/bin" "$sandbox/qwen-home/extensions/adhd-style" "$sandbox/qwen-home/extensions/tdd"
cat > "$sandbox/bin/qwen" <<'FAKE'
printf '%s\n' "$*" >> "$FAKE_QWEN_LOG"
if [ "$2" = "install" ]; then
  staged_name="$(basename "$3")"
  [ -f "$3/hooks/hooks.json" ] && echo "$staged_name has-hooks-json" >> "$FAKE_QWEN_LOG"
  [ -d "$3/node_modules" ] && echo "$staged_name has-node-modules" >> "$FAKE_QWEN_LOG"
  [ -d "$3/output-styles" ] && echo "$staged_name has-output-styles" >> "$FAKE_QWEN_LOG"
  [ -f "$3/.mcp.json" ] && echo "$staged_name has-mcp-json" >> "$FAKE_QWEN_LOG"
  [ -f "$3/plugin-host-server.mjs" ] && echo "$staged_name has-mcp-server" >> "$FAKE_QWEN_LOG"
  [ -d "$3/portable-commands" ] && echo "$staged_name has-portable-commands-folder" >> "$FAKE_QWEN_LOG"
  for command_file in "$3"/commands/*.md; do
    [ -f "$command_file" ] && echo "$staged_name has-command $(basename "$command_file")" >> "$FAKE_QWEN_LOG"
  done
fi
exit 0
FAKE
chmod +x "$sandbox/bin/qwen"

export FAKE_QWEN_LOG="$sandbox/qwen.log"
output="$(PATH="$sandbox/bin:$PATH" QWEN_HOME="$sandbox/qwen-home" bash "$sync_script" 2>&1)"
sync_status=$?
log="$(cat "$FAKE_QWEN_LOG")"

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

log_has() { grep -qxF -- "$1" <<<"$log"; }
log_lacks() { ! grep -qF -- "$1" <<<"$log"; }
output_has() { grep -qF -- "$1" <<<"$output"; }
output_lacks_partial_or_skipped() { ! grep -qE ': (partial|skipped)' <<<"$output"; }

expect "sync exits 0" test "$sync_status" -eq 0
expect "hook-only plugin is installed with consent" log_has "extensions install $sandbox/qwen-home/claude-kit/tdd --consent"
expect "already installed plugin is uninstalled before reinstalling" log_has "extensions uninstall tdd"
expect "hook-only plugin keeps its hooks.json" log_has "tdd has-hooks-json"
expect "node_modules are not copied" log_lacks "has-node-modules"
expect "module plugin with skills is installed" log_has "extensions install $sandbox/qwen-home/claude-kit/brainstorm --consent"
expect "module hooks.json is stripped" log_lacks "brainstorm has-hooks-json"
expect "brainstorm ships its slash command" log_has "brainstorm has-command brainstorm.md"
expect "handoff ships its slash command" log_has "handoff has-command handoff.md"
expect "prompt-optimizer ships its slash command" log_has "prompt-optimizer has-command optimize.md"
expect "session-notes ships its slash commands" log_has "session-notes has-command note.md"
expect "the portable-commands folder is turned into commands" log_lacks "has-portable-commands-folder"
for module_plugin in brainstorm ui-design draft-pr handoff session-notes; do
  expect "$module_plugin ships an MCP server" log_has "$module_plugin has-mcp-server"
  expect "$module_plugin declares its MCP server" log_has "$module_plugin has-mcp-json"
  expect "$module_plugin is reported as running through its MCP server" output_has "$module_plugin: installed. Its tools and slash commands run through an MCP server"
done
expect "a prompt-only plugin ships no MCP server" log_lacks "prompt-optimizer has-mcp"
expect "a prompt-only plugin says its commands run as prompts" output_has "prompt-optimizer: installed. Its slash commands run as prompts"
expect "no plugin is reported as partial or skipped" output_lacks_partial_or_skipped
expect "stale install of a plugin with nothing to load is removed" log_has "extensions uninstall adhd-style"
expect "output style is copied" test -f "$sandbox/qwen-home/output-styles/adhd.md"
expect "output-style-only plugin is not installed as an extension" log_lacks "claude-kit/adhd-style"
expect "output style is reported" output_has "adhd-style: output style"
expect "transcript-based gates are flagged" output_has "tdd: installed"

[ "$failures" -eq 0 ] || exit 1
