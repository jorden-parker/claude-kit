# tdd

Red, green, refactor, enforced.

- **SessionStart** prints the TDD rules (`context/tdd.md`) and clears the
  session's test state.
- **PreToolUse** on Edit and Write: `tdd-require-red.sh` guards implementation
  files.
  - Editing an existing file is always allowed. Without a failing run this
    session, Claude gets a reminder to add a test.
  - Creating a new implementation file is blocked until a test file was
    written or a test run failed this session.
- **PostToolUse** on Bash: `tdd-record-test-run.sh` records pass or fail for
  test runs.
- **Stop**: `tdd-green-gate.sh` runs the test command when the turn edited
  source, and blocks finishing while it fails.
- Override once with `TDD_SKIP=1`, or pin `{"enforce": false}` in
  `.claude/tdd.json`. Pin the test command with `{"testCommand": "..."}`.

Tests: `pnpm test`. Typecheck (syntax check of the shell hooks): `pnpm typecheck`.
