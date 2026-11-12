#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/tdd-lib.sh"

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
[ -n "$session_id" ] || exit 0

rm -rf "$(tdd_state_directory "$session_id")" 2>/dev/null
exit 0
