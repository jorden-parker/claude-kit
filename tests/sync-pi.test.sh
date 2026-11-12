#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
sync_script="$repository_root/sync-pi"
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
failures=0

mkdir -p "$sandbox/bin" "$sandbox/agent"
cat > "$sandbox/bin/pi" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_PI_LOG"
FAKE
chmod +x "$sandbox/bin/pi"

export FAKE_PI_LOG="$sandbox/pi.log"
output="$(PATH="$sandbox/bin:$PATH" PI_CODING_AGENT_DIR="$sandbox/agent" bash "$sync_script" 2>&1)"
sync_status=$?
log="$(cat "$FAKE_PI_LOG")"
package_root="$sandbox/agent/claude-kit"

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
manifest_has() { jq -e "$2" "$package_root/$1/package.json" >/dev/null; }

expect "sync exits 0" test "$sync_status" -eq 0
for module_plugin in brainstorm design draft-pr handoff session-notes; do
  expect "$module_plugin is installed as a local package" log_has "install $package_root/$module_plugin"
  expect "$module_plugin ships its extension" test -f "$package_root/$module_plugin/plugin-host-extension.js"
  expect "$module_plugin names its extension in the manifest" manifest_has "$module_plugin" '.pi.extensions == ["./plugin-host-extension.js"]'
  expect "$module_plugin is reported as running in an extension" output_has "$module_plugin: installed. Its tools run in a pi extension"
done
expect "brainstorm ships its skill" manifest_has brainstorm '.pi.skills == ["./skills"]'
expect "brainstorm ships its prompt template" test -f "$package_root/brainstorm/prompts/brainstorm.md"
expect "handoff ships its prompt template" test -f "$package_root/handoff/prompts/handoff.md"
expect "session-notes ships its prompt templates" test -f "$package_root/session-notes/prompts/note.md"
expect "a prompt-only plugin ships no extension" test ! -e "$package_root/prompt-optimizer/plugin-host-extension.js"
expect "a prompt-only plugin ships its prompt template" test -f "$package_root/prompt-optimizer/prompts/optimize.md"
expect "a prompt-only plugin says its commands run as prompt templates" output_has "prompt-optimizer: installed. Its slash commands run as prompt templates"
expect "prompt templates use pi's arguments placeholder" grep -qF '$ARGUMENTS' "$package_root/prompt-optimizer/prompts/optimize.md"
expect "node_modules are not copied" test ! -e "$package_root/brainstorm/node_modules"
expect "a hook-only plugin is not installed" log_lacks "claude-kit/tdd"
expect "a hook-only plugin is flagged as skipped" output_has "tdd: skipped"
expect "an output-style plugin is flagged as skipped" output_has "adhd-style: skipped"

[ "$failures" -eq 0 ] || exit 1
