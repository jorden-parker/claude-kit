# session-notes

Keeps a note of every session for you: the prompts you sent, the files Claude edited and the commands it ran. `/notes` shows them in a pane beside the chat.

## Usage

Nothing to start: once installed, every session is noted as it runs.

`/notes` opens the **Session notes** pane. Sessions are listed newest first, each with its start time (UTC) and working directory, then:

- `> ...` each prompt you sent (slash commands are skipped)
- `edited ...` each file changed by Edit, Write, MultiEdit or NotebookEdit
- `$ ...` each Bash command

The pane redraws as new notes arrive.

## Storage

Notes live in this plugin's own store (`$.store`, key `notes`), which persists across sessions and is kept by Claude Code outside the conversation.

The plugin never adds them to the system prompt, the context or a tool result, so they cost Claude no tokens and Claude cannot see them unless you paste them in.

Limits keep the store small: the latest 100 sessions, 100 entries per list, 500 characters per entry. Repeated entries are kept once.

## Install

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install session-notes@claude-kit --scope user
```

On the dev machine, add the local checkout instead, then `/reload-plugins` after edits:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install session-notes@claude-kit --scope user
```

## Develop

```
pnpm test        # claude plugin test .
pnpm typecheck   # once Claude Code has laid .claude-plugin/types/
```
