# token-ledger

Records what each Claude Code session spends, so a change meant to save tokens can be measured and not guessed.

- **Stop hook**: each time Claude finishes a turn, the hook reads the session's transcript and writes the session's totals to `~/.cache/token-ledger/sessions/<session id>.json`. The file is replaced each turn, so it always holds the session's totals so far.
- **Summary line**: after each turn the hook shows you one line with the context size and the session's totals so far, for example `Context 60k. Session: in 0k, cache write 60k, cache read 0k, out 0k.` Subagent totals are added when the session started any. The line is a message to you, not context for the model.
- **Report**: `bun ~/src/claude-kit/plugins/token-ledger/hooks/run.ts report` prints the ten newest sessions; add a number for more (`report 30`).
- **Nudge**: when the context reaches 150,000 tokens, the hook adds a second line suggesting `/handoff` then `/clear`. It shows again after each further 50,000 tokens. `TOKEN_LEDGER_NUDGE_TOKENS` moves the threshold.

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
