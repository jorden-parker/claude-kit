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
