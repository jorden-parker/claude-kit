---
name: ui-design
description: Design UI as themed browser mockups built from the project's own colors, type, spacing and components, or audit its theme and components for consistency. Use to design, mock up, redesign or restyle a screen, page or component, to audit the theme, design tokens or hardcoded colors, to apply a design variant, or to fix audit findings.
user-invocable: false
argument-hint: "new <brief> | redesign <target> [notes] | audit [scope] | apply [design] <letter> | fix <numbers, all or errors> | gallery"
---

# Design

You design in mockups first. A mockup or an audit opens as a page in the browser. Project code changes only in `apply` and `fix` mode, and in `redesign` once the user picks a variant at the go-ahead question.

## Pick the mode

The first word of the request picks the mode:

| First word | Mode                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `new`      | Mockups of a screen or component that does not exist yet.                                                             |
| `redesign` | Mockups of new looks for an existing file, route or component. Asks for the go-ahead before any project code changes. |
| `audit`    | Checks the theme, the components and their consistency.                                                               |
| `apply`    | Builds the picked variant of a saved design in project code.                                                          |
| `fix`      | Fixes numbered audit findings in project code.                                                                        |
| `gallery`  | Opens a gallery of every saved design and audit in the browser.                                                       |
| none       | A target that exists in the project means `redesign`. Anything else: new.                                             |

A request in plain words picks the mode by what it asks for.

## Read the mode's steps

The steps of each mode are in files beside this one. Read the files the mode needs, in full, before you start, and no others:

| Mode              | Read                                                        |
| ----------------- | ----------------------------------------------------------- |
| `new`, `redesign` | `theme.md` (section 1), then `mockups.md` (sections 2 to 5) |
| `audit`           | `theme.md` (section 1), then `audit.md` (section 6)         |
| `apply`, `fix`    | `apply-fix.md` (sections 7 and 8)                           |
| `gallery`         | `apply-fix.md` (section 9)                                  |

A section number in any of these files means the section with that number, whichever file holds it.

## Stay quiet

In `new`, `redesign`, `audit` and `gallery`, the page is the only output.

- Do not print the theme, the variants, the findings or a summary in the session, while you work or at the end.
- Do not edit project files. The tools write to `.claude/ui-design/` themselves.
- Your last message is the tool's one-line result, and nothing else. The one exception is a question the steps below allow, such as the go-ahead question that ends `redesign`.

## The tools

Four tools, all writing to `.claude/ui-design/` in the project. If a tool's schema is not loaded, load it with `ToolSearch` first. If the tool does not exist even then, stop and say in one line that the design plugin's tools are not loaded. Do not write a page yourself.

- `mcp__ui-design__save_design_theme` checks and saves the theme as `theme.json`.
- `mcp__ui-design__render_design` checks the variants against the saved theme, writes the mockup page and opens it.
- `mcp__ui-design__render_design_audit` scans the files, merges its findings with yours, writes the audit page and opens it.
- `mcp__ui-design__open_design_gallery` writes `gallery.html` from every saved design and audit and opens it. It takes no input.

A tool that refuses a call replies with one problem per line. Fix every problem and call it again.

The two render tools refuse with `No saved theme at <path>. Call save_design_theme first.` until a theme is saved.

Pages are named by the second: `design-YYYY-MM-DD-HHMMSS` and `audit-YYYY-MM-DD-HHMMSS`, in UTC. Call a render tool once, with everything.

For apply, fix or gallery, read `apply-fix.md` in this skill folder and follow it.
