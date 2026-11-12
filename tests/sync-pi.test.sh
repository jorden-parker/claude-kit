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
for module_plugin in brainstorm ui-design draft-pr handoff session-notes; do
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
for hook_plugin in code-style guards quality-gates tdd; do
  expect "$hook_plugin is installed as a local package" log_has "install $package_root/$hook_plugin"
  expect "$hook_plugin ships its command hooks extension" test -f "$package_root/$hook_plugin/pi-hooks-extension.js"
  expect "$hook_plugin names its command hooks extension in the manifest" manifest_has "$hook_plugin" '.pi.extensions == ["./pi-hooks-extension.js"]'
  expect "$hook_plugin keeps its hooks.json for the bridge" test -f "$package_root/$hook_plugin/hooks/hooks.json"
  expect "$hook_plugin is reported as running its hooks in an extension" output_has "$hook_plugin: installed. Its command hooks run in a pi extension"
done
hook_events_match() {
  local probe="$sandbox/probe.mjs"
  cat > "$probe" <<'PROBE'
import { pathToFileURL } from "node:url";
const { default: extension } = await import(pathToFileURL(process.argv[2]).href);
const registeredNames = [];
extension({ on: (eventName) => registeredNames.push(eventName), registerTool() {} });
console.log(registeredNames.sort().join(","));
PROBE
  [ "$(bun "$probe" "$package_root/tdd/pi-hooks-extension.js" 2>/dev/null)" = "agent_before_settle,before_agent_start,session_start,tool_call,tool_result" ]
}
expect "the bundled hook extension registers the pi events it maps" hook_events_match
expect "an output-style plugin is flagged as skipped" output_has "adhd-style: skipped"

unquoted_colon_descriptions() { grep -hE '^description: [^"].*: ' "$repository_root"/plugins/*/portable-commands/*.md; }
expect "a description holding a colon is quoted, or its front matter is not valid YAML" test -z "$(unquoted_colon_descriptions)"

mkdir -p "$sandbox/project"
: > "$FAKE_PI_LOG"
local_output="$(cd "$sandbox/project" && PATH="$sandbox/bin:$PATH" PI_CODING_AGENT_DIR="$sandbox/agent" bash "$sync_script" --local handoff tdd 2>&1)"
local_status=$?
log="$(cat "$FAKE_PI_LOG")"
output="$local_output"
local_package="$(cd "$sandbox/project" && pwd -P)/.pi/claude-kit/handoff"

expect "local sync exits 0" test "$local_status" -eq 0
expect "--local builds the package under the project's .pi folder" test -f "$local_package/plugin-host-extension.js"
expect "--local installs into the project settings" log_has "install $local_package -l --approve"
expect "--local says where it installed" output_has "handoff: installed in this project."
expect "--local installs a hook-only plugin into the project" log_has "install $(cd "$sandbox/project" && pwd -P)/.pi/claude-kit/tdd -l --approve"
expect "--local ships the hook extension of a hook-only plugin" test -f "$(cd "$sandbox/project" && pwd -P)/.pi/claude-kit/tdd/pi-hooks-extension.js"
expect "--local keeps the built packages out of git" grep -qxF 'claude-kit/' "$sandbox/project/.pi/.gitignore"

[ "$failures" -eq 0 ] || exit 1
