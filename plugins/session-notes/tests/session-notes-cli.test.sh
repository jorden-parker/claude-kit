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

printf '%s' '{"notes": [{"sessionId": "partial", "notes": ["Note of a partial session", {"text": "object note"}]}]}' \
  > "$fixture_directory/partial.json"
expect_equal "list shows a session with missing fields" "yes" \
  "$(SESSION_NOTES_STORE="$fixture_directory/partial.json" bash "$cli_path" list 2>&1 | grep -q 'note 1 Note of a partial session' && echo yes || echo no)"

export XDG_CACHE_HOME="$fixture_directory/cache"
printf '{"notes": []}' > "$fixture_directory/empty.json"
output="$(SESSION_NOTES_STORE="$fixture_directory/empty.json" bash "$cli_path" browse 2>&1)"
expect_equal "browse without sessions says so" "No session notes yet." "$output"

mkdir -p "$fixture_directory/link"
ln -s "$cli_path" "$fixture_directory/link/session-notes"
output="$(SESSION_NOTES_STORE="$fixture_directory/empty.json" bash "$fixture_directory/link/session-notes" browse 2>&1)"
expect_equal "browse runs through the installed link" "No session notes yet." "$output"

printf 'not json' > "$fixture_directory/broken.json"
output="$(SESSION_NOTES_STORE="$fixture_directory/broken.json" bash "$cli_path" browse 2>&1)"
status=$?
expect_equal "browse of an unreadable store fails" "1" "$status"
expect_equal "browse of an unreadable store says why" \
  "Could not read the session notes in $fixture_directory/broken.json." "$output"

rm -f "$SESSION_NOTES_STORE"
output="$(bash "$cli_path" list 2>&1)"
expect_equal "a missing store says so" "No session notes yet." "$output"

exit "$failures"
