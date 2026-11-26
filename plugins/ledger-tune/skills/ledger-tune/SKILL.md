---
name: ledger-tune
description: Read the token-ledger data, recommend changes that cut context, tokens and cost, apply the ones the user picks, and verify with ledger data that they worked. Use for /ledger-tune.
argument-hint: "[read|apply|verify] [since YYYY-MM-DD]"
disable-model-invocation: true
---

# ledger-tune

Cut what this machine's Claude Code sessions spend on context, tokens and cost, using the data the token-ledger plugin records. There are three steps: read, apply and verify. With no argument, run all three in order. With `read`, `apply` or `verify`, run only that step.

The main session's context is reread on every turn, so anything that stays in it is paid for again on each turn. Changes that keep text out of the main context save the most.

## Read

1. Run `claude-ledger --text 40 > "${TMPDIR:-/tmp}/ledger-report.txt"`, then read that file with the Read tool. Reading the file keeps the output caps from hiding the middle of the report. It lists the newest 40 sessions and, at the end, the biggest tool results beside the guards caps. If the command is missing, run `claude-kit-update` once and try again.
2. Look for where the tokens go: the sessions with the largest context, the tools that put the most characters into the main session, tools with no cap, subagents whose cache write is large next to their cache read (a subagent started for one small lookup), and long sessions that never handed off.
3. Write at most five recommendations, largest saving first. Each one states the numbers from the report that support it, the exact change (a file and value in claude-kit, or a Claude Code setting such as a plugin or MCP server to turn off for a project), and which ledger number should move and in which direction.

Recommend only what the data shows. Say what the data could not tell you.

## Apply

1. Ask the user which recommendations to apply, with AskUserQuestion and multiple selection. Apply nothing they did not pick.
2. For a claude-kit change, work in the claude-kit clone. Its path is the claude-kit entry in `claude plugin marketplace list --json`. Follow that repo's rules: test first, and bump the version in the plugin's `plugin.json` and `package.json`. Commit, then `git push`. If the push is refused, leave the commit in place and tell the user its hash. Do not work around a refused push.
3. For a settings change, change only the setting the recommendation names, and say which file you changed.
4. Run `claude-kit-update` so the installed plugins match the clone.
5. For each applied change, run `claude-ledger --fixed "<short title>: <the number expected to move, and which way>"`. This records the time that verify compares against.

## Verify

To verify, read `verify.md` in this skill folder.

1. Installed copies: for each changed plugin, the version in `claude plugin list` matches the version in the clone's `plugin.json`. If it does not, run `claude-kit-update` and say that a new session is needed.
2. Live check, where a fix can be triggered directly in this session. Hooks load when a session starts, so a fix installed during this session shows only in a new one; say that instead of calling the fix failed.
3. Ledger check: `claude-ledger --verify` compares the sessions before and after each recorded fix. `claude-kit-update` records one each time it updates plugins, so a fix made on another machine is compared from the time it reached this one.
4. Report each fix as Working (the number moved as expected; give it before and after), Not working (give the numbers) or Too early (fewer than 5 sessions since the fix; say when to run `/ledger-tune verify` again), and never call a fix working from its tests alone; the before and after groups are different sessions doing different work, so a number that moved the wrong way is not proof on its own: say that, and check the tool the fix targets in `claude-ledger --text`.
