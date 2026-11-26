# ui-design: apply, fix and gallery

Sections 7 to 9 of the ui-design skill, for the `apply`, `fix` and `gallery` modes. Section 1 is in `theme.md`, beside this file.

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
7. Follow apply's steps 8 and 9: the project's hooks, then the `web-design-guidelines` review.
8. Run the project's type check and tests.
9. End with one line per number: what changed and in which files, or why it was left. Then what to check in the browser. Last, suggest running `/ui-design audit` again to confirm the findings are gone.

## 9. Gallery

Gallery lists every saved design and audit on one page, newest first. Call `mcp__ui-design__open_design_gallery` once, with no input.
