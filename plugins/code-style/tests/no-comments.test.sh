#!/usr/bin/env bash
set -uo pipefail

hook_path="$(cd "$(dirname "$0")/../hooks" && pwd)/no-comments.sh"
fixture_directory="$(mktemp -d)"
failures=0

run_hook() {
  local tool_name="$1" file_name="$2" text="$3" text_field="new_string"
  if [ "$tool_name" = "Write" ]; then
    text_field="content"
    printf '%s\n' "$text" > "$fixture_directory/$file_name"
  fi
  jq -n --arg tool_name "$tool_name" --arg file_path "$fixture_directory/$file_name" \
    --arg text_field "$text_field" --arg text "$text" \
    '{tool_name: $tool_name, tool_input: {file_path: $file_path, ($text_field): $text}}' \
    | bash "$hook_path" 2>/dev/null
}

expect_exit_status() {
  local expected_status="$1" description="$2" actual_status
  shift 2
  run_hook "$@"
  actual_status=$?
  if [ "$actual_status" -eq "$expected_status" ]; then
    echo "PASS: $description"
  else
    echo "FAIL: $description (exit $actual_status, expected $expected_status)"
    failures=$((failures + 1))
  fi
}

expect_blocked() { expect_exit_status 2 "$@"; }
expect_allowed() { expect_exit_status 0 "$@"; }

apostrophe_line="const label = \"it's\"; // note"
multiline_signature=$'def total(\n    first,\n    second,\n):\n    """Add."""\n    return first + second'
directive_signature=$'def total(first):  # noqa: E501\n    """Add."""\n    return first'
call_with_string=$'explanation = join(\n    """text""",\n)'
shell_script=$'#!/usr/bin/env bash\n# note\necho done'
node_script=$'#!/usr/bin/env node\n// note\nrun();'

expect_blocked "new file with a leading comment" Write created.ts $'// note\nconst total = 1;'
expect_blocked "edit that adds a leading comment" Edit existing.ts $'// note\nconst total = 1;'
expect_blocked "edit that adds a trailing comment" Edit existing.ts 'const total = 1; // note'
expect_blocked "edit that adds a block comment" Edit existing.ts $'/**\n * note\n */\nconst total = 1;'
expect_blocked "new shell file with a comment" Write created.sh "$shell_script"
expect_blocked "new sql file with a comment" Write created.sql $'-- note\nselect 1;'
expect_blocked "python docstring under a def" Write created.py $'import os\n\ndef total():\n    """Add."""\n    return 1'

expect_blocked "new mjs file" Write created.mjs $'// note\nexport const total = 1;'
expect_blocked "new cjs file" Write created.cjs $'// note\nmodule.exports = 1;'
expect_blocked "new mts file" Write created.mts $'// note\nexport const total = 1;'
expect_blocked "new fish file" Write created.fish $'# note\necho done'
expect_blocked "new script with a shell shebang and no extension" Write pre-commit "$shell_script"
expect_blocked "new script with a node shebang and no extension" Write run-server "$node_script"
expect_blocked "edit to a script with a shebang and no extension" Edit pre-commit $'# another note\necho again'

expect_blocked "jsx comment" Write created.tsx $'const view = (\n  <div>\n    {/* note */}\n  </div>\n);'
expect_blocked "trailing comment after an apostrophe in a string" Write created.ts "$apostrophe_line"
expect_blocked "trailing comment with no space before it" Write created.ts 'runTotal();// note'
expect_blocked "trailing comment on a line whose code names a directive" Write created.ts 'const license = loadLicense(); // note'
expect_blocked "comment that only mentions a directive" Write created.ts $'// remember the eslint-disable below\nconst total = 1;'
expect_blocked "python module docstring in a new file" Write created.py $'"""Totals."""\n\nimport os'
expect_blocked "python module docstring after a shebang" Write created.py $'#!/usr/bin/env python3\n"""Totals."""\nimport os'
expect_blocked "python docstring under a multi-line signature" Write created.py "$multiline_signature"
expect_blocked "python docstring under a def with a directive" Write created.py "$directive_signature"
expect_blocked "hash comment shaped like a preprocessor line" Write created.py $'import os\n#if broken, retry\nvalue = 1'
expect_blocked "hash comment shaped like an attribute" Write created.sh $'echo start\n#[later] tidy\necho done'
expect_blocked "trailing sql comment with no space after the dashes" Write created.sql 'select 1; --note'
expect_blocked "block comment that opens on a bare line" Write created.ts $'/*\n * note\n */\nconst total = 1;'

expect_allowed "code with no comment" Write created.ts 'const total = 1;'
expect_allowed "url inside a string" Write created.ts 'const address = "https://example.com/path";'
expect_allowed "hash inside a template literal" Write created.ts 'const style = `a { color: #fff }`;'
expect_allowed "markdown file" Write notes.md $'# Title\n<!-- note -->'
expect_allowed "eslint directive" Write created.ts $'// eslint-disable-next-line no-console\nconsole.log(1);'
expect_allowed "typescript directive" Write created.ts $'// @ts-expect-error legacy\nrun();'
expect_allowed "trailing noqa directive" Write created.py 'value = compute()  # noqa: E501'
expect_allowed "trailing type ignore directive" Write created.py 'value = compute()  # type: ignore[attr-defined]'
expect_allowed "copyright header" Write created.ts $'// Copyright 2026 Example\nconst total = 1;'
expect_allowed "license header in a block comment" Write created.ts $'/*\n * Copyright 2026 Example\n * All rights reserved.\n */\nconst total = 1;'
expect_allowed "the hook's own source" Write hook-copy.sh "$(cat "$hook_path")"
expect_allowed "shebang only" Write created.sh $'#!/usr/bin/env bash\necho done'
expect_allowed "shellcheck directive" Write created.sh $'#!/usr/bin/env bash\n# shellcheck disable=SC2086\necho done'
expect_allowed "shell parameter length" Write created.sh $'#!/usr/bin/env bash\necho "${#1}" $#'
expect_allowed "go build directive" Write created.go $'//go:build linux\n\npackage main'
expect_allowed "typescript reference directive" Write created.ts $'/// <reference types="node" />\nrun();'
expect_allowed "python string passed as an argument" Write created.py "$call_with_string"
expect_allowed "python file that starts with code" Write created.py $'import os\nvalue = "text"'
expect_allowed "file with no extension and no shebang" Write LICENSE $'# not code\ntext'

violation_message() {
  local session_id="$1"
  jq -n --arg session_id "$session_id" --arg file_path "$fixture_directory/repeat.ts" \
    '{session_id: $session_id, tool_name: "Edit", tool_input: {file_path: $file_path, new_string: "// note\nconst total = 1;"}}' \
    | TMPDIR="$fixture_directory" bash "$hook_path" 2>&1
}

expect_message() {
  local description="$1" expectation="$2" pattern="$3" message="$4" found="absent"
  printf '%s' "$message" | grep -q "$pattern" && found="present"
  if [ "$found" = "$expectation" ]; then
    echo "PASS: $description"
  else
    echo "FAIL: $description"
    failures=$((failures + 1))
  fi
}

first_message="$(violation_message repeat-session)"
second_message="$(violation_message repeat-session)"
other_session_message="$(violation_message other-session)"

expect_message "first violation in a session gets the full instructions" present "Spawn a subagent" "$first_message"
expect_message "a repeat violation still names the rule" present "Comments are not allowed" "$second_message"
expect_message "a repeat violation still lists the line" present "note" "$second_message"
expect_message "a repeat violation leaves out the long instructions" absent "Spawn a subagent" "$second_message"
expect_message "another session starts with the full instructions" present "Spawn a subagent" "$other_session_message"

rm -rf "$fixture_directory"
[ "$failures" -eq 0 ] || { echo "$failures failure(s)"; exit 1; }
echo "all passed"
