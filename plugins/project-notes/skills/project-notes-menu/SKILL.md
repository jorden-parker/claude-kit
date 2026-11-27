---
name: project-notes-menu
description: Organise existing session notes as project notes, change a saved note, or move notes saved under a worktree's name to the repository's name
argument-hint: "organise | edit <change> | audit"
disable-model-invocation: true
---

Arguments: $ARGUMENTS

If the first word is `organise` or `organize`: call `mcp__project-notes__list_legacy_notes` to get the session notes not yet filed as project notes. File each one with a single `mcp__project-notes__write_project_note` call: pass its source, project and created exactly as listed, the category that fits best, a short title, and the note's content as the body, reworded only as far as it needs to stand alone. Use the `debugging` category only for a note that records a bug or error investigation; give it all six sections from what the note says and write "Not recorded." under a section the note says nothing about. Never invent steps or evidence. Call `mcp__project-notes__list_legacy_notes` again until it says none are left, then reply with a count of notes per project and category.

If the first word is `audit`: call `mcp__project-notes__audit_note_folders`. Show the user its report. For each misplaced folder, call `mcp__project-notes__move_note_folder` with its store, from and to. For each folder with no repository found, ask the user which repository it belongs to, or whether to leave it, and move it only on their answer. Reply with one line per move made.

If the first word is `edit`: change a saved note as the rest of the arguments say, or ask the user which note to change and how when they say nothing. Notes, handoffs, small plans and brainstorms are Markdown files under ~/.local/share/handoffs, ~/.local/share/project-notes, ~/.local/share/small-plans and ~/.local/share/brainstorm, one folder per repository. Find the file with Glob or Grep there, Read it, then change it with Edit, never with a shell command, keeping its front matter lines (project:, status:, cwd:) unless the change is to them. Never edit an index.md: the plugins rewrite it. Change a small plan's status with `mcp__small-plans__set_small_plan_status`. Reply with one line naming each changed file.

Otherwise tell the user: run `claude-notes` in a terminal to browse every project note, and use `/project-notes-menu organise`, `edit <change>` or `audit`.
