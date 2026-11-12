# guards

Small command guards that keep Bash, Read and commit behavior in check. Each
hook is a pure `decide(event)` function in `hooks/`, run through
`hooks/run.ts`.

- **bash-guard** (PreToolUse, Bash): denies unbounded `git log`, `git diff`,
  `find`, and `cat` of a lockfile, unless the command bounds the output.
- **commit-guard** (PreToolUse, Bash, 600 s timeout): before `git commit`,
  denies `--no-verify`, `HUSKY=0` and `core.hooksPath`, runs the project's
  `lint`, `typecheck` and `test` scripts when no pre-commit hook exists, and for
  Next.js requires a running dev server with no compilation errors. Opt out with
  `GUARDS_COMMIT_GUARD=0`.
- **read-guard** (PreToolUse, Read): denies Reads of text files over 300 lines
  or 5 MB unless `limit` is 300 or less.
- **bash-trim** (PostToolUse, Bash): keeps the head, the tail and the error
  lines of long output.
- **browser-check** (Stop): blocks once when a UI file was edited after the last
  browser console read (`agent-browser console`, Playwright or Claude in Chrome).

Hook events are logged to `~/.cache/guards/hooks.log`.

Requires `bun` on the PATH.

Tests: `pnpm test`. Typecheck: `pnpm typecheck`.
