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

## Storage

```
~/.claude/project-notes/<project>/<category>/<date>-<slug>.md
```

- `<project>` is the folder name of the session's project root. Claude can name another project when a note belongs elsewhere
- `<date>` is the day the note was written (UTC), or for a filed session note the day that session started; `<slug>` comes from the title
- A second note with the same title on the same day gets `-2`, `-3` and so on, so nothing is overwritten
- Each file starts with front matter: `title`, `category`, `project`, `created`, and `source` for a filed session note
- Set `PROJECT_NOTES_DIR` to keep the notes in another folder

The files are plain Markdown: edit, move or delete them with any tool. The folder a file sits in decides its project and category.

## Viewer

`/project-notes` opens every note in your browser. It starts a small local web server (a Go program, built on first run, so it needs Go once: `brew install go`) and opens the page.

- The sidebar lists every note, grouped by project, then category, newest first
- The note shows rendered Markdown: headings, lists, checkboxes, tables, code blocks, quotes and links. Raw HTML in a note is not rendered
- The page reloads the notes when you come back to its tab
- The same page serves all four kinds of saved notes: Handoffs, Project notes, Small plans and Brainstorm plans. Pick one at the top of the sidebar. `/project-notes` opens it on Project notes
- The server only reads the notes. It listens on `127.0.0.1`, port `47618`; set `CLAUDE_NOTES_PORT` to pick another, or `CLAUDE_NOTES_NO_OPEN=1` to skip opening the browser
- The handoff, project-notes and small-plans plugins each ship the same viewer, so any one of them is enough to run it
- It keeps running after the session ends. Running `/project-notes` again reopens the same page

From a terminal: `bash ~/src/claude-kit/plugins/project-notes/bin/project-notes` runs it in the foreground; `Ctrl+C` stops it.

## Organising existing notes

`/project-notes organise` files the notes that the retired session-notes plugin left in its store as project notes. Claude calls `list_legacy_notes`, which reads that store (`~/.claude/plugins/store/session-notes_*.json`) and lists the notes not filed yet, ten at a time, each with a source id, its project (the git root of the session's folder) and its date. Claude then files each one with `write_project_note`: a category, a title, the note's content, and the listed source, project and date.

- A note that records a bug investigation becomes a `debugging` note with all six sections; a section the old note says nothing about reads "Not recorded."
- A filed note keeps its source id in its front matter (`source:`). A session note whose id is somewhere in the notes folder is not listed again; delete the filed note and it is listed once more
- The session notes themselves are left as they are

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
