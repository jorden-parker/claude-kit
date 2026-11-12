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

## Outside Claude Code

`bin/session-notes` reads and edits the same store from your own terminal. It needs `jq`.

Run `session-notes` with no arguments to browse every session in a full-screen list, each with its notes indented under it. The list is a small Go program built with Charm's Bubble Tea; the first run builds it, so it needs Go (`brew install go`) once.

- `↑`/`↓` (or `j`/`k`) move the selection
- `enter` (or `v`) shows the whole session; `esc` or `q` goes back to the list, as the footer says
- `e` on a note opens it in `$VISUAL` or `$EDITOR` (default `vi`); saving it empty leaves the note as it was
- `d` deletes the selected note, or the whole session, after you press `y`
- `/` filters the list
- `q` quits from the list; the footer always shows the keys

The same commands work without the list, for scripts:

```
session-notes browse                         # the list above, by name
session-notes list                           # every session, newest first, notes numbered
session-notes delete <session> <note>        # e.g. session-notes delete 1 2
session-notes amend <session> <note> <text>  # e.g. session-notes amend 1 2 Deploy moved to Monday
session-notes completion zsh                 # print the zsh completion script
```

Session and note numbers are the ones `list` prints. A number with no note, or empty text, is refused with a message and the store is left unchanged.

Install it from the installed plugin with one line:

```
bash "$(jq -r '.plugins["session-notes@claude-kit"][0].installPath' ~/.claude/plugins/installed_plugins.json)/install.sh"
```

Or from a checkout: `bash ~/src/claude-kit/plugins/session-notes/install.sh`.

It links `~/.local/bin/session-notes` to the plugin's `bin/session-notes` and, in zsh, adds `~/.local/bin` to your PATH in `~/.zshrc` if it is not there yet. In zsh it also adds tab completion to `~/.zshrc`: subcommands, then every note with its text; picking one fills in its session and note numbers. Read from `list`. Nothing is downloaded. If another program's file is already at that path, it stops and says so.

After that, each Claude Code session start points `~/.local/bin/session-notes` at the current plugin version. A file of your own at that path, or a link to another program, is left alone. Set `SESSION_NOTES_LINK_DIR` to link into another directory.

It finds the store at `~/.claude/plugins/store/session-notes_*.json` (under `$CLAUDE_CONFIG_DIR` when set). Set `SESSION_NOTES_STORE` to a file path to use another store.

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
