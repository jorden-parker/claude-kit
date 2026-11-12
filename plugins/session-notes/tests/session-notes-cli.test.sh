#!/usr/bin/env bash
set -uo pipefail

cli_path="$(cd "$(dirname "$0")/../bin" && pwd)/session-notes"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
export SESSION_NOTES_STORE="$fixture_directory/store.json"
failures=0

write_fixture_store() {
  cat > "$SESSION_NOTES_STORE" <<'JSON'
{"notes": [
  {"sessionId": "session-b", "cwd": "/repo", "startedAt": "2026-11-12T09:30:00.000Z",
   "prompts": ["fix the login bug"], "files": ["/repo/login.ts"], "commands": ["pnpm test"],
   "notes": ["Login bug was a stale cookie", "Deploy is on Friday"]},
  {"sessionId": "session-a", "cwd": "/old", "startedAt": "2026-11-01T10:00:00.000Z",
   "prompts": ["old prompt"], "files": [], "commands": []}
]}
JSON
}

expect_equal() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$description" "$expected" "$actual"
    failures=$((failures + 1))
  else
    printf 'pass %s\n' "$description"
  fi
}

stored_notes_of_first_session() {
  jq -c '.notes[0].notes' "$SESSION_NOTES_STORE"
}

write_fixture_store
expected_listing='[1] 2026-11-12 09:30 UTC  /repo
  > fix the login bug
  note 1 Login bug was a stale cookie
  note 2 Deploy is on Friday
  edited /repo/login.ts
  $ pnpm test

[2] 2026-11-01 10:00 UTC  /old
  > old prompt'
expect_equal "list shows sessions newest first with numbered notes" \
  "$expected_listing" "$(bash "$cli_path" list)"

write_fixture_store
output="$(bash "$cli_path" delete 1 1)"
expect_equal "delete reports the deleted note" "Deleted note 1 from session 1." "$output"
expect_equal "delete removes only that note" '["Deploy is on Friday"]' "$(stored_notes_of_first_session)"
expect_equal "delete keeps the other sessions" '"session-a"' "$(jq -c '.notes[1].sessionId' "$SESSION_NOTES_STORE")"

write_fixture_store
output="$(bash "$cli_path" delete 1 3 2>&1)"
status=$?
expect_equal "delete of a missing note fails" "1" "$status"
expect_equal "delete of a missing note says why" "No note 3 in session 1." "$output"
expect_equal "delete of a missing note changes nothing" \
  '["Login bug was a stale cookie","Deploy is on Friday"]' "$(stored_notes_of_first_session)"

write_fixture_store
output="$(bash "$cli_path" delete 2 1 2>&1)"
expect_equal "delete in a session without notes says why" "No note 1 in session 2." "$output"

write_fixture_store
output="$(bash "$cli_path" delete 5 1 2>&1)"
expect_equal "delete in a missing session says why" "No session 5." "$output"

write_fixture_store
output="$(bash "$cli_path" amend 1 2 Deploy moved to Monday)"
expect_equal "amend reports the amended note" "Amended note 2 in session 1." "$output"
expect_equal "amend replaces that note in place" \
  '["Login bug was a stale cookie","Deploy moved to Monday"]' "$(stored_notes_of_first_session)"

write_fixture_store
output="$(bash "$cli_path" amend 1 1 "  " 2>&1)"
status=$?
expect_equal "amend with empty text fails" "1" "$status"
expect_equal "amend with empty text says why" "The note needs some text." "$output"
expect_equal "amend with empty text changes nothing" \
  '["Login bug was a stale cookie","Deploy is on Friday"]' "$(stored_notes_of_first_session)"

write_fixture_store
bash "$cli_path" delete first 1 > /dev/null 2>&1
expect_equal "a non-number argument is a usage error" "2" "$?"

bash "$cli_path" > /dev/null 2>&1
expect_equal "no command is a usage error" "2" "$?"

browse_with_keys() {
  printf '%b' "$1" | bash "$cli_path" browse 2>&1
}

write_fixture_store
output="$(browse_with_keys 'q')"
expect_equal "browse lists every note with its session" "yes" \
  "$(grep -q 'Login bug was a stale cookie' <<< "$output" && grep -q 'Deploy is on Friday' <<< "$output" && echo yes || echo no)"

write_fixture_store
browse_with_keys 'jdyq' > /dev/null
expect_equal "browse deletes the selected note after confirming" '["Login bug was a stale cookie"]' \
  "$(stored_notes_of_first_session)"

write_fixture_store
browse_with_keys '\e[Bdyq' > /dev/null
expect_equal "browse moves the selection with the arrow keys" '["Login bug was a stale cookie"]' \
  "$(stored_notes_of_first_session)"

write_fixture_store
browse_with_keys 'dnq' > /dev/null
expect_equal "browse keeps the note when delete is not confirmed" \
  '["Login bug was a stale cookie","Deploy is on Friday"]' "$(stored_notes_of_first_session)"

write_fixture_store
editor_path="$fixture_directory/editor.sh"
printf '#!/usr/bin/env bash\nprintf "Cookie expiry was wrong\\n\\n" > "$1"\n' > "$editor_path"
chmod +x "$editor_path"
printf 'eq' | EDITOR="$editor_path" VISUAL="" bash "$cli_path" browse > /dev/null 2>&1
expect_equal "browse edits the selected note in the editor" \
  '["Cookie expiry was wrong","Deploy is on Friday"]' "$(stored_notes_of_first_session)"

write_fixture_store
output="$(browse_with_keys 'vxq')"
expect_equal "browse views the session of the selected note" "yes" \
  "$(grep -q 'fix the login bug' <<< "$output" && grep -q 'pnpm test' <<< "$output" && echo yes || echo no)"

write_fixture_store
jq '.notes |= map(del(.notes))' "$SESSION_NOTES_STORE" > "$fixture_directory/empty.json"
output="$(printf 'q' | SESSION_NOTES_STORE="$fixture_directory/empty.json" bash "$cli_path" browse 2>&1)"
expect_equal "browse without notes says so" "No notes to browse." "$output"

rm -f "$SESSION_NOTES_STORE"
output="$(bash "$cli_path" list 2>&1)"
expect_equal "a missing store says so" "No session notes yet." "$output"

exit "$failures"
