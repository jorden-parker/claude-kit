# project-notes

Claude writes categorised notes about a project as Markdown files on your disk, and a local web page shows them all with a sidebar. Nothing leaves the machine.

## Usage

Ask Claude for a project note ("note as a decision that the viewer is built with Go"), or run `/project-note <topic>`. Claude calls the `write_project_note` tool with a category, a title and a Markdown body. `/project-note` with no topic notes what the session learned that a later session on the project should know, one note per separate thing.

| Category    | Holds                                                    |
| ----------- | -------------------------------------------------------- |
| `fact`      | something true about the project                         |
| `finding`   | something learned or observed during work                |
| `decision`  | a choice made and why                                    |
| `reference` | where something lives: a file, URL, dashboard or command |
| `debugging` | the investigation of a bug or error                      |

Any other category is refused, as is a note without a title or body.

## Debugging notes

A `debugging` note must hold these six `## ` headings. The tool refuses a note that lacks any, and names the missing ones:

1. `## Why these steps`: why those steps were chosen to reproduce the issue
2. `## Steps taken`: every step in detail, with the commands and inputs used
3. `## Evidence`: the logs, output and `file:line` that back the findings
4. `## Findings`
5. `## Next steps`
6. `## Draft Shortcut ticket`: title, type, description, steps to reproduce, expected and actual result, acceptance criteria

The ticket is a draft inside the note. The plugin never talks to Shortcut, and the tool tells Claude not to create the ticket or call a Shortcut tool.

Claude is told to load the `humanizer` skill before writing a debugging note and to write the prose by its rules. If Claude has not loaded that skill in the session, the first debugging note is refused once with that reminder; the next call saves. Where no `humanizer` skill is installed, Claude calls again unchanged.

## Transcript card

Saving a note places a small NOTE card in the transcript with the title, category and short path.

## Storage

```
~/.claude/project-notes/<project>/<category>/<date>-<slug>.md
```

- `<project>` is the repository the note is about. Claude picks it from the note's subject (the files, services and repositories it names), not from the folder the session started in, and passes a folder inside that repository; the plugin files it under the repository's name, shared by its worktrees (also a deleted `<repo>/.claude/worktrees/<name>` one). When more than one repository fits, Claude asks you which one before saving. With no project given, the note goes under the session's repository, or the project root's folder name outside git
- `<date>` is the day the note was written (UTC), or for a filed session note the day that session started; `<slug>` comes from the title
- A second note with the same title on the same day gets `-2`, `-3` and so on, so nothing is overwritten
- Each file starts with front matter: `title`, `category`, `project`, `created`, and `source` for a filed session note
- Set `PROJECT_NOTES_DIR` to keep the notes in another folder

The files are plain Markdown: edit, move or delete them with any tool. The folder a file sits in decides its project and category.

## Viewer

Run `claude-notes` in a terminal to browse every saved note in the browser. See [Notes viewer](../../README.md#notes-viewer).

## Organising existing notes

`/project-notes organise` files the notes that the retired session-notes plugin left in its store as project notes. Claude calls `list_legacy_notes`, which reads that store (`~/.claude/plugins/store/session-notes_*.json`) and lists the notes not filed yet, ten at a time, each with a source id, its project (the git root of the session's folder) and its date. Claude then files each one with `write_project_note`: a category, a title, the note's content, and the listed source, project and date.

- A note that records a bug investigation becomes a `debugging` note with all six sections; a section the old note says nothing about reads "Not recorded."
- A filed note keeps its source id in its front matter (`source:`). A session note whose id is somewhere in the notes folder is not listed again; delete the filed note and it is listed once more
- The session notes themselves are left as they are

## Auditing where notes are saved

`/project-notes edit <change>` has Claude change a saved note, handoff, small plan or brainstorm: it finds the file under the store folders, reads it, and changes it with Edit, never a shell command, so the small-plans index is rewritten. Edits and overwrites of existing files in any store under `~/.claude` need no permission (small plans live under `~/.local/share/small-plans`, the others under `~/.claude`); new files, `index.md` files and anything outside the stores still ask.

`/project-notes audit` checks the folders of every store (`handoffs`, `project-notes`, `small-plans`, `brainstorm`, under `~/.claude` except small plans, which default to `~/.local/share/small-plans`; each moved by its `*_DIR` variable) for project folders named after a worktree instead of the repository. Claude calls `audit_note_folders`, which changes nothing and reports:

- Misplaced folders, with the repository each belongs to. The evidence is a handoff's `cwd:` line (resolved through git, or the `<repo>/.claude/worktrees/<name>` path when git no longer knows it) or a name in this repository's `git worktree list`. A folder name tied to a repository in one store is mapped the same way in the others
- Folders it cannot tie to a repository, such as a temporary folder; Claude asks you where each belongs

Claude then calls `move_note_folder` (store, from, to) per folder. A move never overwrites: a taken name gets `-2`, moved handoffs are renumbered after the target's newest, and each Markdown file's `project:` line is rewritten. The emptied folder is removed.

## Install

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install project-notes@claude-kit --scope user
```

## Develop

```
pnpm test        # claude plugin test . and go test in web/
pnpm typecheck   # once Claude Code has laid .claude-plugin/types/
```
