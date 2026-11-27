---
name: project-note-menu
description: Have Claude write a categorised project note about what you name, or about what this session learned
argument-hint: "[topic]"
disable-model-invocation: true
---

Call the `mcp__project-notes__write_project_note` tool with a project note about: the topic below, or when it is empty, what this session learned that a later session on this project should know, one call per separate thing. Write it from what happened in this conversation, pick the category that fits, and pass as project a folder in the repository the note is about; when more than one repository fits, ask the user with AskUserQuestion which one first. Reply with one line naming each saved file.

Topic: $ARGUMENTS
