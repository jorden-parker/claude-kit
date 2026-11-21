# guards

Small command guards that keep Bash, Read, commit and delegation behavior in
check. Each hook is a pure `decide(event)` function in `hooks/`, run through
`hooks/run.ts`.

- **bash-guard** (PreToolUse, Bash): bounds unbounded `git log`, `git diff`
  and `find`. When the unbounded part is the last, plain segment of the
  command, it appends `| head -n 150` and tells Claude so, which saves the
  round trip a denial costs. It still denies when capping could change what
  the command does (a redirect, a `find` with `-delete` or `-exec`, a later
  `&&` segment) and denies `cat` of a lockfile.
- **commit-guard** (PreToolUse, Bash, 600 s timeout): before `git commit`,
  denies `--no-verify`, `HUSKY=0` and `core.hooksPath`, runs the project's
  `lint`, `typecheck` and `test` scripts when no pre-commit hook exists, and for
  Next.js denies the commit while a running dev server reports compilation
  errors. Opt out with
  `GUARDS_COMMIT_GUARD=0`.
- **read-guard** (PreToolUse, Read): caps a Read of a text file over 300 lines
  at `limit: 300`, keeping the `offset`, and tells Claude the file's length so
  it can read on. Denies a text file over 5 MB unless `limit` is 300 or less.
- **delegation-rules** (SessionStart): makes the main session an orchestrator.
  It plans, talks to the user and judges results, and hands lookups to
  `guards:context-scout` and implementation and verification to `guards:worker`
  (Haiku), sending independent work out in parallel. It also tells Claude to
  run checks itself rather than ask the user to run them. Off with
  `GUARDS_DELEGATE_GUARD=0`.
- **ci-status** (SessionStart): in a repository whose `origin` is on GitHub,
  asks `gh` for the latest run on `main` and shows one warning line when it
  failed. Silent when `gh` is missing or signed out, when it takes over 10
  seconds, and when the run passed.
- **worker** (agent, Haiku): implements a fully specified change or runs a
  check, then replies DONE or BLOCKED with changed `path:line`s and the check's
  result line.
- **delegate-guard** (PreToolUse, Read, Grep, Glob, Bash, Agent): forces
  context-heavy work onto Haiku subagents. In the main session it adds up the
  characters that lookups (`Read`, `Grep`, `Glob`, and Bash commands that start
  with `cat`, `grep`, `rg`, `find`, `ls`, `git log`, `git diff` and the like)
  put into the context. From 10,000 characters it warns with each lookup; at
  20,000 it denies the next lookup and points Claude at the
  `guards:context-scout` agent. Only a delegation to Haiku
  (`guards:context-scout`, `guards:worker`, or any agent spawned with
  `model: "haiku"`) resets the budget;
  a new user prompt does not, since the context keeps the earlier reads. It
  also denies three kinds of Agent call: an `Explore` subagent (the scout is
  the only lookup agent, since its reply is capped), a scout prompt over 1,500
  characters, and a `general-purpose` or `claude` agent (or one with no
  `subagent_type`) that names no `model`, since it would run on the session
  model. Plugin agents keep the model their own file pins.
  It also denies Edit, Write, MultiEdit and NotebookEdit of any file outside
  `~/.claude` and the temp folders, and points Claude at `guards:worker`.
  Subagents are never limited. Claude Code only. Opt out with
  `GUARDS_DELEGATE_GUARD=0`. Hooks load when a session starts, so a session
  opened before the plugin was updated runs without this guard.
- **bash-trim** (PostToolUse, Bash and MCP tools): keeps the head, the tail
  and the error lines of Bash output over 150 lines, and the head and tail of
  an MCP text result over 300 lines. The full text is saved under
  `$TMPDIR/guards-output/` and the marker line names the file, so Claude greps
  that file and does not run the command again. Each time it saves a file it
  first deletes saved files older than seven days. Leave MCP results alone with
  `GUARDS_MCP_TRIM=0`.
- **browser-check** (Stop, off by default): blocks once when a UI file was
  edited after the last browser console read (`agent-browser console`,
  Playwright or Claude in Chrome). Opt in with `GUARDS_BROWSER_CHECK=1`.
  A plugin's own hooks module (`hooks/*.tsx` beside `.claude-plugin/`) is not a
  page and is skipped.
- **self-check** (Stop): blocks once when the last reply asks the user to run a
  check (tests, typecheck, lint, build, a package manager command) instead of
  running it or sending it to `guards:worker`. A `! <command>` line for a step
  only the user can do (interactive login, device, credentials) passes. Opt out
  with `GUARDS_SELF_CHECK=0`.

## Agent

- **context-scout** (`agents/context-scout.md`, Haiku, read-only): reads and
  searches the codebase and replies in 25 lines at most with the conclusion and
  `path:line` references. delegate-guard sends Claude here.

bash-guard and read-guard rewrite the call only in Claude Code. Qwen Code, pi,
OpenCode and Crush cannot take a rewritten call, so there both guards deny
with the reason, as they did before.

Hook events are logged to `~/.cache/guards/hooks.log`.

Requires `bun` on the PATH.

Tests: `pnpm test`. Typecheck: `pnpm typecheck`.
