# AGENTS.md

## Plugins

All plugins must have completion set up. Completion means that a person who types a plugin's slash command sees its subcommands suggested, each with a short description. A plugin with no slash command has nothing to complete.

A plugin's completion is set up when all four of these are true:

1. **The command is registered with an argument hint.** `hooks/register.ts` calls `$.command.register({ name, description, argumentHint })`, and the hint lists every subcommand.
2. **A `prompt.autocomplete` hook suggests each subcommand.** The same file keeps a `SUBCOMMAND_SUGGESTIONS` list of `{ text, description }` entries and an `on("prompt.autocomplete", ...)` hook. The hook acts only on the first argument after the command, filters the list by `e.token`, and adds its matches to the suggestions from `next(e)`.
3. **A test covers the hook.** `hooks/register.test.ts` calls the hook and checks the suggestions it returns.
4. **A `-menu` skill lists the command.** `skills/<command>-menu/SKILL.md` has `name`, `description`, `argument-hint` and `disable-model-invocation: true` in its frontmatter, and its body passes `$ARGUMENTS` on to the command's instructions. Hosts whose menus show only skills, such as Orca, list the command through this skill.

Copy the pattern from `plugins/handoff/` or `plugins/brainstorm/`.

Two kinds of command need fewer parts:

- A command that takes only free text, such as `/optimize`, has no subcommands to suggest, so it needs parts 1 and 4 only.
- A command that is itself a skill, such as `ledger-tune`, already appears in skill menus with its own `argument-hint`, so it needs parts 2 and 3 only.

### When a command changes

When you add, rename or remove a subcommand, update all of these in the same change:

- the `argumentHint` in `$.command.register`
- the `SUBCOMMAND_SUGGESTIONS` list
- the `argument-hint` in the `-menu` skill
- the hook's test
- the README text that lists the command's subcommands

Subcommands are plain words (`save`, `plan`), not dashed flags.

### Limits

- The `prompt.autocomplete` hook works only in Claude Code. The `sync-*` scripts do not port it, so other hosts get the argument hint only.
- No test and no part of `check` enforces completion, so confirm all four parts yourself before you finish.
