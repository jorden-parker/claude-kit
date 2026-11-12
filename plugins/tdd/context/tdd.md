# Coding rules: TDD

These apply to all code written in any repo.

## TDD

Features and fixes follow red, green, refactor.

1. Red: write one failing test first and run it. Confirm it fails for the expected reason, not a typo or import error.
2. Green: write the minimum implementation that makes that test pass. Run the tests.
3. Refactor: clean up with the tests green, re-running after each change.

- Never write implementation before its test.
- Never edit a test to make it pass; fix the code, or change the test only when the requirement itself changed.
- Hooks enforce this: new implementation files are blocked until a test is written or fails, edits to existing code get a reminder, and finishing is blocked while tests fail.
- The test command is detected from the repo (package.json, pytest, go.mod, Cargo.toml, rspec). Pin it in `.claude/tdd.json` as `{"testCommand": "..."}`.
