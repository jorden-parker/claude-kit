# prompt-optimizer

`/optimize <draft>` rewrites a draft prompt to be clearer and more specific, then puts the rewrite in the composer so you can edit it or press Enter.

## Usage

`/optimize fix the bug` rewrites the given draft.

`/optimize` with nothing after it rewrites the text you last selected with the mouse in the transcript. With no selection either, it prints the usage line.

The rewrite is grounded in the current working directory and the last few messages of the conversation, so references like "the bug" or "that file" resolve to what they name. Nothing the draft or the conversation does not imply is added.

The rewrite model cannot open files or view images, and it is told so: the rewritten prompt is written for the agent that can. It keeps `[Image #N]` tokens verbatim, never mentions what it could not see, and does not restate the working directory. If the model still opens with such an aside, the leading paragraphs that contain one are dropped before the prompt is filled.

When the composer cannot take the text (a headless run, or a dialog holding the keys), the rewrite is copied to the clipboard and printed instead. The rewrite is also handed to the model as hidden context, so a follow-up like "do it" refers to the optimized prompt.

Images pasted into the composer alongside `/optimize` are noted for the model: a hidden line names each attached image and says it belongs with the optimized prompt, so a follow-up like "do it" treats them as part of it. The same list is given to the rewrite model, so it knows the images exist and that the agent will see them. The rewrite itself is text-only, and the composer cannot take images back, so the rewritten prompt does not re-attach them.

In a headless run (`claude -p "/optimize fix the bug"`) the process exits with code 1 when the rewrite fails or there is nothing to rewrite, so a script can tell.

## Settings

Both rows appear in `/config` under the plugin, and a change reloads the plugin at once.

| Row                | Default  | What it does                                                                                                   |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| Rewrite model      | `sonnet` | Which model rewrites the draft: `haiku`, `sonnet` or `opus`. `sonnet` stays on the draft; `haiku` drifts more. |
| Extra instructions | empty    | Appended to the rewrite rules, for a house style every rewritten prompt should follow.                         |

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install prompt-optimizer@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install prompt-optimizer@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall prompt-optimizer@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```
