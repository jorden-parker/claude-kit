#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sync_script="$repository_root/sync-qwen"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0

mkdir -p "$sandbox/bin" "$sandbox/qwen-home/extensions/session-notes" "$sandbox/qwen-home/extensions/tdd"
cat > "$sandbox/bin/qwen" <<'FAKE'
printf '%s\n' "$*" >> "$FAKE_QWEN_LOG"
if [ "$2" = "install" ]; then
  staged_name="$(basename "$3")"
  [ -f "$3/hooks/hooks.json" ] && echo "$staged_name has-hooks-json" >> "$FAKE_QWEN_LOG"
  [ -d "$3/node_modules" ] && echo "$staged_name has-node-modules" >> "$FAKE_QWEN_LOG"
  [ -d "$3/output-styles" ] && echo "$staged_name has-output-styles" >> "$FAKE_QWEN_LOG"
  [ -d "$3/qwen-commands" ] && echo "$staged_name has-qwen-commands-folder" >> "$FAKE_QWEN_LOG"
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
output_lacks() { ! output_has "$1"; }
every_qwen_command_uses_arguments() {
  ! grep -LF '{{args}}' "$repository_root"/plugins/*/qwen-commands/*.md | grep -q .
}

expect "sync exits 0" test "$sync_status" -eq 0
expect "hook-only plugin is installed with consent" log_has "extensions install $sandbox/qwen-home/claude-kit/tdd --consent"
expect "already installed plugin is uninstalled before reinstalling" log_has "extensions uninstall tdd"
expect "hook-only plugin keeps its hooks.json" log_has "tdd has-hooks-json"
expect "node_modules are not copied" log_lacks "has-node-modules"
expect "module plugin with skills is installed" log_has "extensions install $sandbox/qwen-home/claude-kit/brainstorm --consent"
expect "module hooks.json is stripped" log_lacks "brainstorm has-hooks-json"
expect "module plugin without commands is flagged as partial" output_has "design: partial. Skills and agents installed; its tools come from register.ts"
expect "brainstorm ships its slash command" log_has "brainstorm has-command brainstorm.md"
expect "handoff ships its slash command" log_has "handoff has-command handoff.md"
expect "prompt-optimizer ships its slash command" log_has "prompt-optimizer has-command optimize.md"
expect "the qwen-commands folder is renamed away" log_lacks "has-qwen-commands-folder"
expect "plugin with a slash command says it runs as a prompt" output_has "handoff: partial. Its slash commands run as prompts"
expect "no plugin with a slash command reports it missing" output_lacks "slash commands and tools come from register.ts"
expect "every Qwen command passes its arguments on" every_qwen_command_uses_arguments
expect "module-only plugin without commands is not installed" log_lacks "claude-kit/session-notes"
expect "module-only plugin without commands is flagged as skipped" output_has "session-notes: skipped"
expect "stale install of module-only plugin is removed" log_has "extensions uninstall session-notes"
expect "output style is copied" test -f "$sandbox/qwen-home/output-styles/adhd.md"
expect "output-style-only plugin is not installed as an extension" log_lacks "claude-kit/adhd-style"
expect "output style is reported" output_has "adhd-style: output style"
expect "transcript-based gates are flagged" output_has "tdd: installed"

[ "$failures" -eq 0 ] || exit 1
