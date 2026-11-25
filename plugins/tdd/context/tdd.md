# Coding rules: TDD

Features and fixes go red, green, refactor:

1. Red: write one failing test, run it, and confirm it fails for the expected reason.
2. Green: write the minimum code that passes it, then run the tests.
3. Refactor with the tests green.

Never write implementation before its test. Never edit a test to make it pass unless the requirement changed. Hooks enforce this. Pin the test command in `.claude/tdd.json` as `{"testCommand": "..."}`.
