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
- **read-guard** (PreToolUse, Read): caps a Read of a text file over 150 lines
  at `limit: 150`, keeping the `offset`, and tells Claude the file's length so
  it can read on. Denies a text file over 5 MB unless `limit` is 300 or less.
  Denies a file over 20,000 bytes with very long lines (minified) and points
  Claude at `head -c 3600 FILE | fold -w 200` slices or `grep -o`.
- **delegation-rules** (SessionStart): use direct edits and checks for bounded tasks, scouts for verbose research, and cheaper workers for well-specified implementation plus verification. Resume workers for corrections when supported, and compare actual total cost before assuming delegation saves money. Saved agent model overrides remain authoritative. `GUARDS_DELEGATE_MODEL` chooses the default delegated alias; it does not change saved overrides. `GUARDS_DELEGATE_GUARD=0` disables these instructions.
- **ci-status** (SessionStart): in a repository whose `origin` is on GitHub,
  asks `gh` for the latest run on `main` and shows one warning line when it
  failed. Silent when `gh` is missing or signed out, when it takes over 10
  seconds, and when the run passed.
- **worker** (agent, Haiku): implements a fully specified change or runs a
  check, then replies DONE or BLOCKED with changed `path:line`s and the check's
  result line.
- **delegate-guard** (PreToolUse): selective delegation is the default. Direct reads, writes, edits and checks are allowed. Agent type/model validation remains active. `GUARDS_DELEGATE_POLICY=strict` restores the legacy 20,000-character lookup budget and 1,000-character edit limit; `GUARDS_DELEGATE_GUARD=0` disables this tool guard. The repository agent allowlist still applies at spawn time. Subagents and claude-lite sessions remain exempt.
- **bash-trim** (PostToolUse: Bash, `mcp__*`, Grep, Glob, WebFetch, WebSearch,
  Agent, Task, BashOutput, TaskOutput, ListMcpResourcesTool,
  ReadMcpResourceTool): walks the whole result and trims every text value at
  any depth. Bash output over 80 lines keeps its head, tail and error lines;
  every other tool keeps the head and tail of text over 300 lines. Text still
  over 4,000 characters (8,000 for tools other than Bash, Agent and Task) after
  that is cut to its start and end. The full text is saved under
  `$TMPDIR/guards-output/` and the marker line names the file, so Claude greps
  that file and does not run the command again. Each time it saves a file it
  first deletes saved files older than seven days. Image and audio blocks,
  `isImage` results and `data`, `blob` and `base64` values are left alone.
  `GUARDS_MCP_TRIM=0` leaves only `mcp__*` results alone. Never capped: Skill,
  ToolSearch, Read, Edit, Write, AskUserQuestion, ExitPlanMode, and failed
  commands, where Claude Code's own cut applies.
- **handback-trim** (PreToolUse, SubagentHandback): a subagent report over
  4,000 characters from guards:worker, guards:context-scout, Explore,
  general-purpose, claude, claude-code-guide or web-fetch is rewritten to its
  first 2,000 and last 2,000 characters around a marker that names the saved
  full copy. Other agent types and shorter reports pass.
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
  searches the codebase and replies in 25 lines and 3,000 characters at most with the conclusion and
  `path:line` references. delegate-guard sends Claude here.

## Only this repository's subagents run

Claude Code may spawn only subagent types defined in this repository
(`plugins/*/agents/*.md`); `fork`, `general-purpose`, `Explore`, `claude`,
other plugins' agents and a call with no `subagent_type` are refused. Two
points enforce it:

- delegate-guard (PreToolUse on Agent and Task) denies the call with the
  allowed types and a hint. It is off with `GUARDS_DELEGATE_GUARD=0`, in a
  subagent, and under claude-lite.
- The `agent.spawn` hook refuses the spawn itself, so it also catches spawns
  that bypass the tool call. `GUARDS_DELEGATE_GUARD=0` does not switch it off.

Four agents replace the built-in ones: `guards:web-researcher` (Haiku; web
fetch and search, replaces web-fetch and claude-code-guide), `guards:planner`
(Sonnet, read-only; replaces Plan), `guards:reviewer` (Sonnet, read-only
review for bugs) and `guards:generalist` (Sonnet, every tool; replaces
general-purpose, claude and statusline-setup).

The `agent.spawn` hook reads `~/.claude/agent-models.json` on every spawn and
applies the saved model of that agent type. A missing or unreadable file
means no saved models. Run `claude-agent-models` to pick each agent's model; it saves them to that file.

bash-guard and read-guard rewrite the call only in Claude Code. Qwen Code, pi,
OpenCode and Crush cannot take a rewritten call, so there both guards deny
with the reason, as they did before.

Hook events are logged to `~/.cache/guards/hooks.log`.

Requires `bun` on the PATH.

Tests: `pnpm test`. Typecheck: `pnpm typecheck`.

## Compact results and measuring savings

Run `bun <guards-plugin-path>/bin/compact-run <command> [arguments...]` for verbose checks. It prints up to 20 summary lines, retains a private full log and propagates the command exit status. This reduces output at source even when a harness ignores PostToolUse replacement. See [the comparison and live harness check](../../docs/cost-comparison.md).
