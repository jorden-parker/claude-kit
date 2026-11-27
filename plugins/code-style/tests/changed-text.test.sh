#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../hooks/changed-text-lib.sh"
source_text=$'// existing\nconst data = 1;\nconst total = 2;'
new_text=$'// existing\nconst data = 1;\nconst total = 3;'
payload="$(jq -n --arg before "$source_text" --arg after "$new_text" '{tool_input:{old_string:$before,new_string:$after}}')"
actual="$(changed_text_for_payload "$payload" /tmp/example.ts "$new_text")"
[ "$actual" = 'const total = 3;' ]
echo 'PASS: existing comments and names are not included in changed text'
sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
file_path="$sandbox/source.ts"
printf '%s\n' "$source_text" > "$file_path"
payload="$(jq -n --arg file "$file_path" --arg after "$new_text" '{session_id:"snapshot-test",tool_use_id:"write-test",tool_input:{file_path:$file,content:$after}}')"
printf '%s' "$payload" | bash "$(dirname "$0")/../hooks/capture-write-baseline.sh"
printf '%s\n' "$new_text" > "$file_path"
[ "$(changed_text_for_payload "$payload" "$file_path" "$new_text")" = 'const total = 3;' ]
echo 'PASS: full writes compare against pre-write contents outside git too'
