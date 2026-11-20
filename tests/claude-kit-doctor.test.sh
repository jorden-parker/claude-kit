#!/usr/bin/env bash
set -uo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
doctor_script="$repository_root/claude-kit-doctor"
fake_home="$(mktemp -d)"
trap 'rm -rf "$fake_home"' EXIT
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

handoff_version="$(jq -r .version "$repository_root/plugins/handoff/.claude-plugin/plugin.json")"
mkdir -p "$fake_home/.claude/plugins"
jq -n --arg handoff_version "$handoff_version" '{
  version: 2,
  plugins: {
    "handoff@claude-kit": [{scope: "user", version: $handoff_version}],
    "brainstorm@claude-kit": [{scope: "user", version: "0.0.1"}]
  }
}' > "$fake_home/.claude/plugins/installed_plugins.json"

output="$(HOME="$fake_home" bash "$doctor_script" 2>&1)"
status=$?
expect "a stale plugin makes the doctor exit 1" [ "$status" -eq 1 ]
expect "a plugin at the repository version is ok" grep -qE "^handoff +[0-9.]+ +[0-9.]+ +ok$" <<<"$output"
expect "a plugin behind the repository is stale" grep -qE "^brainstorm +[0-9.]+ +0\.0\.1 +stale$" <<<"$output"
expect "a plugin that is not installed says so" grep -qE "^draft-pr +[0-9.]+ +- +not installed$" <<<"$output"
expect "the summary counts the stale plugins" grep -qF "1 plugin differs from this checkout: run claude-kit-update" <<<"$output"

rm "$fake_home/.claude/plugins/installed_plugins.json"
output="$(HOME="$fake_home" bash "$doctor_script" 2>&1)"
expect "no installed plugins file exits 0" [ $? -eq 0 ]
expect "no installed plugins file lists every plugin as not installed" \
  grep -qE "^handoff +[0-9.]+ +- +not installed$" <<<"$output"

[ "$failures" -eq 0 ] || exit 1
