---
name: ui-design
description: Design UI as themed mockups in the browser, built from the project's own colors, type, spacing and components, or audit the project's theme and components for consistency. Use whenever the user asks to design, mock up or sketch a new screen, page or component, to redesign, restyle or rethink existing UI, to audit or check the theme, design system, design tokens, hardcoded colors, typography or component consistency, or to apply, build or implement a design variant, or to fix audit findings. Changes no project code until the user picks a variant with apply, answers the go-ahead question after redesign, or names findings with fix.
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

| Mode              | Read                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `new`, `redesign` | `theme.md` (section 1), then `mockups.md` (sections 2 to 5)        |
| `audit`           | `theme.md` (section 1), then `audit.md` (section 6)                |
| `apply`, `fix`    | Sections 7 and 8 below, and `theme.md` when a step names section 1 |
| `gallery`         | Section 9 below                                                    |

A section number in any of these files means the section with that number, whichever file holds it.

## Stay quiet

In `new`, `redesign` and `audit`, the page is the only output.

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

## 7. Apply

Apply builds one variant in the project's real code. This mode is not quiet.

1. Find the design. The words after `apply` are an optional design name, then the letter: `apply design-2026-11-12-153000 B`. The name is the file's name, with or without `.json`, and the file is in `.claude/ui-design/`. Without a name, use the last `design-*.json` there, by name. The design holds the `mode`, the `subject`, the `variants` in order, and the `theme` they were drawn with. With no design at all, say so in one line and suggest `/ui-design new` or `/ui-design redesign`. With a name that matches no file, list the saved designs, one line each with its name, mode and subject, and ask which.
2. Take the variant by its letter: A is the first. With no letter, or a letter the design lacks, list the variants and ask which.
3. Check the theme for drift. Load the current theme, as in section 1, and compare it with the design's `theme`:
   - A token whose name is gone is renamed when a current token of the same kind has the same value. Otherwise it is removed.
   - A token with the same name whose `value` or `darkValue` differs has changed.

   List these in a few short lines. If the variant uses a renamed, removed or changed token (a `var(--<name>)` in its `html` or `css`), say which, and build with the nearest current token: the renamed one, or the token of the same kind closest in value. Tell the user which token you used and why. Say nothing when nothing the variant uses has drifted.

4. Build the variant with the project's own components and tokens, used the way the project uses them: its utility classes, its theme object, its variables. The mockup is a picture. Never copy its HTML or CSS into the project.
5. `redesign`: edit the target in place. Everything in `kept` stays. Props, data and behavior do not change, so callers keep working.
6. `new`: put the files where the project puts such files, named the way it names them.
7. Add a token to the theme's source only when the variant lists it in `newTokens`. Change a token's value in the theme's source only when the variant lists it in `restyledTokens`, at the line its `source` cites. Add no other token and no raw value.
8. Follow every hook the project has installed. Where a test must come first, write it first.
9. Review the files you changed with the `web-design-guidelines` skill, and fix what it reports in them. If the skill is not installed, skip this step.
10. Run the project's type check and tests.
11. End with what to check in the browser: the route, the states, dark mode and the 390px width.

## 8. Fix

Fix changes the project's code for numbered findings of the newest audit. Like apply, it is not quiet.

1. Find the audit: the last `audit-*.json` in `.claude/ui-design/`, by name. It holds the `findings` and the `componentGroups`, each with its `number`. With none, say so in one line and suggest `/ui-design audit`.
2. Take the numbers the user gives: `fix 3 5 7`, `fix all` for every finding and group, or `fix errors` for every finding with severity `error`. With no numbers, or a number the audit lacks, list the valid numbers, one line each, and ask which to fix.
3. Load the theme, as in section 1.
4. Fix each number in turn, in the order given. Use the project's own tokens and components, as section 7 step 4 says. Add no token to the theme. A finding that needs a value no token holds is left as it is, and the reply says why.
5. A finding is fixed at its `file` and `line`. A theme finding, such as duplicate tokens or a missing dark value, is fixed where the token is declared. Read the code first: the finding's `fix` is a suggestion.
6. A component group is fixed by migrating its usages to the `recommended` member. First add what the group's `reasoning` says that member lacks, then move each other member's usages to it. Delete a member only when nothing imports it any more.
7. Review the files you changed with the `web-design-guidelines` skill, and fix what it reports in them. If the skill is not installed, skip this step.
8. Follow every hook the project has installed. Where a test must come first, write it first. Run the project's type check and tests.
9. End with one line per number: what changed and in which files, or why it was left. Then what to check in the browser. Last, suggest running `/ui-design audit` again to confirm the findings are gone.

## 9. Gallery

Gallery lists every saved design and audit on one page, newest first. Call `mcp__ui-design__open_design_gallery` once, with no input. Your last message is its one-line result, and nothing else.
