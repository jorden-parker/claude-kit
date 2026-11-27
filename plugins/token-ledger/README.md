# token-ledger

Records what each Claude Code session spends, so a change meant to save tokens can be measured and not guessed.

- **Stop hook**: each time Claude finishes a turn, the hook reads the session's transcript and writes the session's totals to `~/.cache/token-ledger/sessions/<session id>.json`. The file is replaced each turn, so it always holds the session's totals so far.
- **Summary line**: after each turn the hook shows you one line with the context size and the session's totals so far, for example `Context 60k. Session: in 0k, cache write 60k, cache read 0k, out 0k.` Subagent totals are added when the session started any. The line is a message to you, not context for the model.
- **Report**: `bun ~/src/claude-kit/plugins/token-ledger/hooks/run.ts report` prints every stored session, newest first; a number limits it to the newest sessions (`report 30`). It ends with the ten tools whose results were largest across those sessions, each beside the guards cap that applies to it (bash-trim for Bash and MCP tools, read-guard for Read), so the caps can be tuned from real numbers. The caps are copied into `ledger.ts`; change them there when guards changes.
- **Terminal command**: `claude-ledger [N]` opens a copyable table of every stored session in the browser, newest first; a number such as `claude-ledger 50` limits it to the newest sessions. Each session's main-agent rows sit together above its subagent rows, separated by a line, and the Session Share column gives each row's part of that session's tokens. One row per model per session. Copying from it pastes plain text with Totals, Columns and Sessions sections, the Sessions section holding one line per row with cells separated by " | ". It uses no Markdown or HTML, so it stays intact when pasted through chat apps such as Slack and WhatsApp on the way to Claude. The Download .txt button saves the same text for every row as claude-ledger-usage.txt, for when it is too long to paste. Copied rows show projects as "project 1", "project 2" and so on. The summary lists tool names and character counts only, never tool output, and MCP tools are grouped as "MCP tools". The table highlights the cache read and write columns, and a Cache Status column flags rows where reads are missing or below writes. It also shows Last Nudge Tokens, and on each session's first row, every tool's result characters in the main agent's context. `claude-ledger --text [N]` prints the text report instead. `claude-kit-update` links it into `~/.local/bin`.
- **Fixes**: `claude-ledger --fixed "<title>"` records a fix at the current time in `~/.cache/token-ledger/fixes.jsonl`. `claude-ledger --verify [YYYY-MM-DD]` then prints, for each recorded fix (or for the date given), the sessions before and after it: count, median context, median tool result characters, median tokens, cache read share and nudged sessions. Sessions that were already running when a fix landed are left out of the comparison (they kept the old hooks), and the output says how many. Fewer than five sessions after a fix prints a too-early note.
- **Nudge**: once the context has grown 40,000 tokens since the session's first turn, the hook adds a second line suggesting `/handoff` then `/clear`. It repeats every 50,000 tokens after that. `TOKEN_LEDGER_NUDGE_TOKENS` sets the growth amount.
- **Reply meter**: when the last reply ran over 150 words, or over 40 words of narration between tool calls, the next prompt carries a one-line note telling Claude to say less. `TOKEN_LEDGER_REPLY_WORDS` and `TOKEN_LEDGER_NARRATION_WORDS` move the budgets.

## What a session's entry holds

| Field                    | Meaning                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `main`                   | Tokens per model in the main session: input, cache write, cache read and output. |
| `subagents`              | The same, summed over every subagent the session started.                        |
| `contextTokens`          | What the last request read: the size of the context now.                         |
| `resultCharactersByTool` | Characters of tool results put into the main context, per tool.                  |
| `project`, `updatedAt`   | The working folder's name and the time of the last turn.                         |

A report looks like this:

```
2026-11-20 14:02  claude-kit  context 182k  d6e2d54c-b3e5-425e-b19d-14c91b2daf87
  claude-fable-5-2: in 4k, cache write 310k, cache read 9120k, out 96k
  subagents claude-haiku-5-5: in 310k, cache write 0k, cache read 0k, out 12k
  tool results: Bash 141k chars, Read 52k chars, Agent 31k chars
```

Cache reads are usually the largest number: every turn reads the whole context again, which is why a long session costs more per turn than a short one.

## Limits

- It counts tokens, not money: the transcript holds no prices
- The transcript's format is internal to Claude Code and can change. A line the hook cannot read is skipped, and a hook that fails never blocks a turn
- Claude Code writes a turn's last reply to the transcript at about the moment it runs the hook. The hook waits up to two seconds for that reply, so the totals include the turn that just ended
- Claude Code only

Requires `bun` on the PATH.

Tests: `pnpm test`. Typecheck: `pnpm typecheck`.

## Install

```
claude plugin install token-ledger@claude-kit --scope user
```

## Provider-aware metrics

New records optionally include `tasks` and `workerTasks`, with requested/resolved model IDs where exposed, worker calls/resumes, observed hook denials, reasoning usage and estimated costs. Missing usage is unknown, never evidence of zero cost. Legacy counters and records remain readable. Anthropic, OpenAI and Bedrock usage field shapes are normalized; OpenAI cache counts are subtracted from inclusive input totals. Reasoning is part of output and is not charged twice.

Set `TOKEN_LEDGER_PRICING` to a JSON object keyed by exact returned model ID; each value has nonnegative `input`, `output`, `cacheRead` and `cacheWrite` rates per million tokens in one currency. Incomplete usage or missing rates produces unknown cost. Estimates are not authoritative billing. Worker usage is retained separately when parent-task attribution is unavailable; use one task per session when comparing complete task costs. See [comparison instructions](../../docs/cost-comparison.md) and `bun bin/compare-runs.ts <baseline-folder> <candidate-folder>`.

Cache labels describe observed reuse, not waste. Model token shares do not establish whether delegation saves money. Context nudges recommend a reset only at a task boundary when old context is no longer useful.

### Record work results across two machines

At work, open `claude-ledger` and expand a fix or a single session under **Laptop check-in**. The terminal comparison `claude-ledger --verify [YYYY-MM-DD]` also prints the Before and After answers for a fix. On the laptop, open `claude-ledger`, choose **Record work results**, and match each displayed code and version. Name the experiment and workload once. Choose Before, After, or Single session and open its selections. Saving the same experiment and phase updates that observation. Use a separate experiment name to retain another window. The report server runs on loopback until Ctrl-C.

Read saved selections with `claude-ledger --checkins`. Records live in `~/.cache/token-ledger/work-checkins.sqlite` on the recording machine. Single-session token counts include the main agent and all subagents. Equal ranges leave the direction uncertain. An updated work report requires the released plugin and CLI.

### Local analysis and verification

Run `claude-ledger analyze` for the latest 40 local sessions, or `claude-ledger analyze 10` to select a different sample. It reports median usage, tool-result sizes, recorded worker calls and estimated cost where pricing is complete. Saved work-machine selections appear in a separate section.

Run `claude-ledger verify` for two rows of laptop answer codes around the newest deployment, or `claude-ledger verify since 2026-11-25` to supply a boundary. Use `claude-ledger verify all` for detailed comparisons and saved observations across all deployments. Read the answer codes on the work screen and select them in the laptop form. Both commands run locally without calling a model. The collector continues recording automatically. For recommendations, ask your assistant to review `claude-ledger analyze` or `claude-ledger --checkins`.

Run `claude-ledger verify browser` on the work machine to open the latest deployment as a local HTML report. Each measurement shows its Before and After codes beside the exact readings.

The **Record work results** form includes a live preview and **Copy selected results**. Choose the relevant readings, then copy only those selections into chat without saving first. Unselected/Unknown readings are omitted. Its Before/After calculation uses all locally recorded sessions across projects, includes subagent totals, and shows how many spanning/unknown-start sessions are excluded. Other machines are not included automatically.

`claude-ledger verify browser` now keeps a local report server running. The page checks for newly recorded results every two seconds and updates the deployment comparison automatically, including the After count. Keep the command running; Ctrl-C stops it. Hidden tabs pause polling; network errors retain the last readings and retry automatically. Text selections defer replacement so copying is not interrupted. Sessions are still recorded when a Claude Code response finishes, rather than while it is generating. Existing static report tabs must be reopened with this command once.

The live deployment page shows **Recording status**, a short D-code plus the deployment cutoff, latest recorded session start and latest result time. D1 means no records; D2 means no results since deployment; D3 means results arrive but are excluded by their start times; D4 means qualifying After results are arriving. Read the code from the work screen when troubleshooting; no copying is needed. `claude-ledger diagnose` prints the same timestamp-only diagnostic in a terminal. Recording errors now appear in hook stderr instead of being silently discarded.

Recorder diagnostics now show both **Recorder launch** and **Recorder result**. A launch of `runtime-missing` identifies Bun missing from the hook environment; `runtime-failed` identifies a process/load failure. Results distinguish missing event fields, an unavailable transcript, a save failure and a saved session. Status files contain timestamps and outcome codes, not conversation contents. The hook launcher resolves Bun from PATH or standard installation folders, covering GUI launches with a restricted PATH; `TOKEN_LEDGER_BUN` can pin an absolute executable path. Restart Claude Code after updating to load the launcher.
