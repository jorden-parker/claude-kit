# handoff

`/handoff [focus]` summarizes the current session into a prompt a fresh session can pick up (goal, what is done, what is left, files and commands mentioned, open questions), then fills it into the composer so you can edit it or press Enter. An optional focus argument centers the recap on one topic.

## Usage

`/handoff` recaps the whole session.

`/handoff the failing test` centers the recap on the failing test.

`/handoff --new [focus]` hands the work off to a new session: it builds the recap, runs `/clear`, then submits the recap as the first prompt of the fresh session, so the work continues without the prior conversation. The recap is parked in the plugin store until it is submitted; if the process ends before that, the next session finds it and fills it into the composer instead.

If the session cannot be cleared, the recap is filled into the composer as `/handoff` would.

Every recap is also kept in the plugin store, the latest 50, so earlier handoffs can be picked up later.

`/handoff --save [focus]` builds the recap and stores it without touching the composer, then prints its id.

`/handoff --each [focus]` writes one handoff per plan suggested in the conversation and stores each without touching the composer, then lists their ids. Use it after Claude proposes several options, such as a ranked list of plugin ideas: each idea becomes its own stored handoff, and `/handoff --resume <id>` starts a fresh session on any one of them. The latest assistant message is sent whole so long lists are not cut off; a focus limits it to the plans it names.

`/handoff --list` shows the stored handoffs, newest first: id, time (UTC), working directory and the recap's first line.

`/handoff --resume <id>` hands off to a new session seeded with that stored recap, the way `--new` does for the current session. With no id it shows the list.

The recap uses the last 40 messages of the conversation. Nothing beyond the conversation is added. With no messages it says "Nothing to recap yet."

When the composer cannot take the text (a headless run, or a dialog holding the keys), the recap is copied to the clipboard and printed instead. The recap is also handed to the model as hidden context, so a follow-up like "continue from that" refers to the recap.

The recap is written by Haiku in the background. A rate-limited, overloaded or failing API is retried after 1, 2 and 4 seconds. If Haiku still returns an API error, `/handoff` says so (`Haiku could not write the recap (API error 429, rate_limit). A subagent is writing the recap…`) and starts a subagent: a fork of the session, which sees the whole conversation and runs on the session's own model. When the subagent ends, its answer is stored, filled or handed off as the flags ask, and a toast reports the result. The recap stays out of the transcript. A background request is sent once, with no retry, and an API proxy can refuse it every time while subagents and normal turns still get through; this route is for that case. It costs more than Haiku, as the fork reads the whole conversation.

If the subagent cannot start, the conversation writes the recap instead: `/handoff` submits the recap rules as a normal turn, and the result is printed beneath that turn's answer.

## Settings

The row appears in `/config` under the plugin.

| Row          | Default | What it does                                                                                                                                                                                                                                                                                                      |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recap writer | `haiku` | Who writes the recap: `haiku`, `subagent` or `conversation`. `subagent` skips Haiku and its retries and starts the subagent at once, for a machine whose API proxy always refuses the Haiku call. `conversation` has the session's own model write the recap as a normal turn, which leaves it in the transcript. |

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install handoff@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install handoff@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall handoff@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```
