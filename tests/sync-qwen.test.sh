#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sync_script="$repository_root/sync-qwen"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0

mkdir -p "$sandbox/bin" "$sandbox/qwen-home/extensions/handoff" "$sandbox/qwen-home/extensions/tdd"
cat > "$sandbox/bin/qwen" <<'FAKE'
printf '%s\n' "$*" >> "$FAKE_QWEN_LOG"
if [ "$2" = "install" ]; then
  staged_name="$(basename "$3")"
  [ -f "$3/hooks/hooks.json" ] && echo "$staged_name has-hooks-json" >> "$FAKE_QWEN_LOG"
  [ -d "$3/node_modules" ] && echo "$staged_name has-node-modules" >> "$FAKE_QWEN_LOG"
  [ -d "$3/output-styles" ] && echo "$staged_name has-output-styles" >> "$FAKE_QWEN_LOG"
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

expect "sync exits 0" test "$sync_status" -eq 0
expect "hook-only plugin is installed with consent" log_has "extensions install $sandbox/qwen-home/claude-kit/tdd --consent"
expect "already installed plugin is uninstalled before reinstalling" log_has "extensions uninstall tdd"
expect "hook-only plugin keeps its hooks.json" log_has "tdd has-hooks-json"
expect "node_modules are not copied" log_lacks "has-node-modules"
expect "module plugin with skills is installed" log_has "extensions install $sandbox/qwen-home/claude-kit/brainstorm --consent"
expect "module hooks.json is stripped" log_lacks "brainstorm has-hooks-json"
expect "module plugin with skills is flagged as partial" output_has "brainstorm: partial"
expect "module-only plugin is not installed" log_lacks "claude-kit/handoff"
expect "module-only plugin is flagged as skipped" output_has "handoff: skipped"
expect "stale install of module-only plugin is removed" log_has "extensions uninstall handoff"
expect "output style is copied" test -f "$sandbox/qwen-home/output-styles/adhd.md"
expect "output-style-only plugin is not installed as an extension" log_lacks "claude-kit/adhd-style"
expect "output style is reported" output_has "adhd-style: output style"
expect "transcript-based gates are flagged" output_has "tdd: installed"

[ "$failures" -eq 0 ] || exit 1
