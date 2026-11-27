# code-style

Writes the rules for comments and names into every session, and blocks the
edits that break them.

- **SessionStart** prints the Comments and Naming rules (`context/code-style.md`).
- **PostToolUse** on Edit and Write: `no-comments.sh` blocks added comments,
  `naming-check.sh` blocks short, vague or abbreviated names in declarations.
- **Stop**: `naming-review-gate.sh` asks once per changed file set to run the
  `naming-review` skill before finishing.
- Escape hatch: list extra allowed identifiers, one per line, in
  `.claude/naming-allowlist.txt` in the project.

Tests: `pnpm test`. Typecheck (syntax check of the shell hooks): `pnpm typecheck`.

Checks and naming review apply only to introduced or changed code. Edit payloads are compared with old_string; full-file writes are compared with a pre-write snapshot when the harness exposes a tool-use ID, falling back to HEAD otherwise. Existing comments and names outside changed lines are left alone. Review reminders are deduplicated by file contents, so new edits trigger a fresh review.
