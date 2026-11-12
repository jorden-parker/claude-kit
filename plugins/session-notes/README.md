# session-notes

Keeps a note of every session for you: the prompts you sent, the files Claude edited, the commands it ran and any notes Claude wrote. `/notes` shows them in a pane beside the chat.

## Usage

Nothing to start: once installed, every session is noted as it runs.

`/notes` opens the **Session notes** pane. Sessions are listed newest first, each with its start time (UTC) and working directory, then:

- `> ...` each prompt you sent (slash commands are skipped)
- `note ...` each note Claude wrote
- `edited ...` each file changed by Edit, Write, MultiEdit or NotebookEdit
- `$ ...` each Bash command

The pane redraws as new notes arrive.

Ask Claude to note something ("note that the login bug was a stale cookie"). Claude calls the `write_note` tool, which saves the note to this session and opens the pane.

Ask Claude to change a note it wrote ("amend that note: it was a stale session cookie"). Claude calls the `amend_note` tool with the note's exact old text and the new text; the note is replaced in place and the pane opens. If no note in this session has that text, the tool refuses and nothing changes. Only the current session's notes can be amended.

Ask Claude to delete a note it wrote ("delete the note about the deploy"). Claude calls the `delete_note` tool with the note's exact text; the note is removed and the pane opens. If no note in this session has that text, the tool refuses and nothing changes. Only the current session's notes can be deleted.

`/note` has Claude note a short summary of the session: what was done, what was decided and what is left. `/note <topic>` notes that topic instead, for example `/note what's left` or `/note the open questions`.

## Storage

Notes live in this plugin's own store (`$.store`, key `notes`), which persists across sessions and is kept by Claude Code outside the conversation.

The plugin never adds saved notes to the system prompt, the context or a tool result, so they cost Claude no tokens and Claude cannot read them back unless you paste them in. Claude only sees the notes it writes itself, at the moment it writes them.

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
