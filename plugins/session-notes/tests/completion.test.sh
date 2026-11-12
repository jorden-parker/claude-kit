#!/usr/bin/env bash
set -uo pipefail

cli_directory="$(cd "$(dirname "$0")/../bin" && pwd)"
fixture_directory="$(mktemp -d)"
trap 'rm -rf "$fixture_directory"' EXIT
failures=0

expect_equal() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$description" "$expected" "$actual"
    failures=$((failures + 1))
  else
    printf 'pass %s\n' "$description"
  fi
}

export SESSION_NOTES_STORE="$fixture_directory/missing.json"
completion_script="$(bash "$cli_directory/session-notes" completion zsh 2>&1)"
expect_equal "completion zsh works without a store" "0" "$?"
expect_equal "completion zsh registers the completer" "yes" \
  "$(grep -qxF 'compdef _session_notes session-notes' <<< "$completion_script" && echo yes || echo no)"

bash "$cli_directory/session-notes" completion fish > /dev/null 2>&1
expect_equal "completion of an unknown shell fails with usage" "2" "$?"

cat > "$fixture_directory/store.json" <<'JSON'
{"notes": [
  {"sessionId": "session-b", "cwd": "/repo", "startedAt": "2026-11-12T09:30:00.000Z",
   "prompts": [], "files": [], "commands": [],
   "notes": ["Login bug: a stale cookie", "Deploy is on Friday"]},
  {"sessionId": "session-a", "cwd": "/old", "startedAt": "2026-11-01T10:00:00.000Z",
   "prompts": [], "files": [], "commands": [], "notes": ["Old note"]}
]}
JSON
export SESSION_NOTES_STORE="$fixture_directory/store.json"
printf '%s\n' "$completion_script" > "$fixture_directory/completion.zsh"

complete_words() {
  PATH="$cli_directory:$PATH" zsh -f -c '
    compdef() { :; }
    _describe() { print -rl -- "${(@P)2}" "${@:3}"; }
    source "$1"
    shift
    words=("$@")
    CURRENT=$#words
    _session_notes
  ' completer "$fixture_directory/completion.zsh" "$@"
}

expect_equal "completes the subcommands" \
  "list:list every session and its notes
delete:delete a note
amend:replace the text of a note
completion:print the shell completion script" \
  "$(complete_words session-notes '')"
expect_equal "completes every note as its session and note numbers for delete" \
  '1 1:Login bug\: a stale cookie
1 2:Deploy is on Friday
2 1:Old note
-Q' \
  "$(complete_words session-notes delete '')"
expect_equal "completes every note as its session and note numbers for amend" \
  '1 1:Login bug\: a stale cookie
1 2:Deploy is on Friday
2 1:Old note
-Q' \
  "$(complete_words session-notes amend '')"
expect_equal "completes note numbers of the chosen session for amend" \
  '1:Login bug\: a stale cookie
2:Deploy is on Friday' \
  "$(complete_words session-notes amend 1 '')"
expect_equal "completes note numbers of another session" \
  '1:Old note' \
  "$(complete_words session-notes delete 2 '')"
expect_equal "completes the shell for completion" "zsh" \
  "$(complete_words session-notes completion '')"
expect_equal "list takes no arguments" "" \
  "$(complete_words session-notes list '')"

exit "$failures"
