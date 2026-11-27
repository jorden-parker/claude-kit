#!/usr/bin/env bash
set -uo pipefail
payload="$(cat)" || exit 0
file_path="$(jq -r '.tool_input.file_path // empty' <<< "$payload")" || exit 0
session_id="$(jq -r '.session_id // empty' <<< "$payload")" || exit 0
tool_use_id="$(jq -r '.tool_use_id // empty' <<< "$payload")" || exit 0
[ -n "$file_path" ] && [ -n "$session_id" ] && [ -n "$tool_use_id" ] || exit 0
snapshot_key="$(printf '%s\n' "$session_id" "$tool_use_id" "$file_path" | shasum | cut -c1-40)"
snapshot_directory="${TMPDIR:-/tmp}/claude-code-style-baselines"
umask 077
mkdir -p "$snapshot_directory" || exit 0
find "$snapshot_directory" -type f -mtime +7 -delete 2>/dev/null
if [ -f "$file_path" ]; then cat "$file_path" > "$snapshot_directory/$snapshot_key"
else : > "$snapshot_directory/$snapshot_key"; fi
exit 0
