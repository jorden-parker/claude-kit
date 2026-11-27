---
name: tidy-notes-menu
description: Reformat the saved handoffs, project notes, small plans and brainstorms consistently without changing their content; a dry run unless you pass apply
argument-hint: "[apply]"
disable-model-invocation: true
---

Arguments: $ARGUMENTS

If the arguments are `apply`, call `mcp__tidy-notes__tidy_notes` with apply: true. Show the user its report as it is.

Otherwise call `mcp__tidy-notes__tidy_notes` with no arguments, which is a dry run that writes nothing. Show the user its report as it is, and tell them `/tidy-notes-menu apply` writes the changes.
