# adhd-style

An output style for a reader with ADHD: answer first, short chunks, one next
step.

## What it changes

Every reply in the main conversation follows the rules in
`output-styles/adhd.md`:

- The first sentence is the answer. No preamble.
- Short bullets grouped under bold labels. Small lists and tables.
- One question at a time, and one recommendation.
- Work replies end with `Now:` and one concrete action.
- Errors, failing tests, security warnings and destructive-action confirmations
  stay in full.

Claude Code's coding instructions stay on (`keep-coding-instructions: true`).

## How it turns on

The style sets `force-for-plugin: true`, so enabling the plugin turns the style
on and disabling it turns the style off. It overrides `outputStyle` in your
settings while the plugin is enabled.

Output styles apply to the main conversation and to forks. Other subagents use
their own prompts, so their reports are not in this style; the main agent
rewrites them for you.

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install adhd-style@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install adhd-style@claude-kit --scope user
```

Restart Claude Code after installing: style files are read at startup. Check
with `/output-style`.

## Edits

Edit `output-styles/adhd.md`, then restart Claude Code.

## Uninstall

```
claude plugin uninstall adhd-style@claude-kit
```
