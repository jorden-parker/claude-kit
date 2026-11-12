#!/usr/bin/env bash
set -uo pipefail

source "$(dirname "$0")/tdd-lib.sh"

payload="$(cat)" || exit 0
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)" || exit 0
command_text="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
event_name="$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null)"
[ -n "$session_id" ] && [ -n "$command_text" ] || exit 0

tdd_command_is_test_runner "$command_text" || exit 0

exit_code="$(printf '%s' "$payload" | jq -r '(.tool_response.exit_code // .tool_response.exitCode // empty) | tostring' 2>/dev/null)"
interrupted="$(printf '%s' "$payload" | jq -r '.tool_response.interrupted // false' 2>/dev/null)"
response_output="$(printf '%s' "$payload" | jq -r 'if (.tool_response|type)=="object" then ((.tool_response.stdout // "") + "\n" + (.tool_response.stderr // "") + "\n" + (.tool_response.llmContent // "" | tostring) + "\n" + (.tool_response.returnDisplay // "" | tostring)) else (.tool_response // "" | tostring) end' 2>/dev/null)"

if [ "$event_name" = "PostToolUseFailure" ] || [ "$interrupted" = "true" ]; then
  result="fail"
elif [[ "$exit_code" =~ ^[0-9]+$ ]]; then
  if [ "$exit_code" -eq 0 ]; then result="pass"; else result="fail"; fi
elif tdd_output_indicates_failure "$response_output"; then
  result="fail"
else
  result="pass"
fi

tdd_record_result "$session_id" "$result"
exit 0
