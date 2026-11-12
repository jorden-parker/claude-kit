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
