#!/usr/bin/env bash
set -uo pipefail

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
[ -n "$session_id" ] || exit 0

safe_session_id="$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9_-' '_')"
rm -rf "${TMPDIR:-/tmp}/claude-verify-gate/${safe_session_id}" 2>/dev/null
exit 0
