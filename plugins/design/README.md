# design

One skill, `/design`, designs UI in the project's own theme and opens the result as a page in the browser. Project code changes only when you pick a variant.

| Command                             | What it does                                                    |
| ----------------------------------- | --------------------------------------------------------------- |
| `/design new <brief>`               | Mockups of a screen or component that does not exist yet.       |
| `/design redesign <target> [notes]` | Mockups of new looks for an existing file, route or component.  |
| `/design audit [scope]`             | Checks the theme, the components and their consistency.         |
| `/design apply <letter>`            | Builds the picked variant of the newest design in project code. |

With no mode word, a target that exists in the project means `redesign`, and anything else means `new`.

Plain words work too: "redesign the settings page", "mock up a pricing page", "audit the design system".

The menu lists the skill by its full name, `/design:design`. The plugin registers no command of its own: the engine serves the skill as a command.

In `new`, `redesign` and `audit` the session stays quiet. Claude prints no theme, variant or finding: the result is on the page, and the last line in the session says the page opened.

## Usage

`/design new a pricing page with three plans and a FAQ` mocks up a new screen.

`/design redesign src/app/settings/page.tsx less scrolling` mocks up new looks for the settings page.

`/design redesign the sidebar` finds the sidebar component first.

`/design audit` checks the whole project. `/design audit src/components` checks one folder.

`/design apply B` builds variant B of the newest design.

## The theme

Every mode starts from the project's theme. Claude reads it once and saves it as `.claude/design/theme.json`:

- **Tokens**: each with a name, a kind (`color`, `font`, `text-size`, `space`, `radius` or `shadow`), a value, a dark value where the project has one, and its source as `path:line`.
- **Stack**: the framework, the styling method, how dark mode is switched, and the icon set.
- **Components**: the core components, their paths and their variants.
- **Inconsistencies**: near-duplicates, such as two grays a shade apart.

Declared tokens come first: a Tailwind config or `@theme` block, CSS custom properties, shadcn's `components.json`, a MUI, Chakra, styled-components or Emotion theme object, token files, Sass and Less variables. `skills/design/theme-sources.md` says where each stack keeps them. With no declared tokens, Claude counts what the UI code uses most and marks those tokens **inferred**.

The `save_design_theme` tool refuses a token whose source file is missing, or whose name and value both do not appear in that file. A token cannot be invented.

The saved theme is reused until a file one of its tokens cites is newer than it. Then it is read again.

With almost no theme to find, Claude stops and asks before it proposes one.

## The mockup page

`/design new` and `/design redesign` end with the `render_design` tool. It writes one self-contained page and opens it in the browser.

- One tab per variant, A to D. Two variants by default.
- Each variant renders in its own sandboxed frame, with the theme injected as CSS variables. A variant's CSS only uses `var(--token)`.
- **Desktop** and **Mobile** switch the frame's width. **Dark** appears when the theme has dark values.
- Each variant has a name and a rationale. A redesign also lists what it **Kept** and what it **Changed**.
- **Proposed additions**: up to three tokens a variant needs that the theme lacks.
- **Use this** copies `/design apply <letter>`. The command is also shown beside the button.
- A **Theme** panel: the tokens by kind, with swatches, sources and an **inferred** mark, and the inconsistencies.

The tool refuses a design with an unknown mode, or with no variant or more than four. It refuses a variant that:

- has no name or no HTML;
- uses a raw color or a raw font family, in its CSS or in an inline style;
- has a `<style>` element in its HTML: styles go in its CSS;
- puts a color literal in an SVG `fill`, `stroke`, `stop-color`, `flood-color` or `color` attribute;
- proposes more than three tokens, or a token with no name, no value or an unknown kind;
- is a redesign that lists nothing as changed.

A raw color is a hex color or a color function such as `rgb()` or `oklch()`. `var(--token)`, `currentColor`, `transparent` and `inherit` pass.

The tool names every problem, so a mockup cannot drift from the theme.

### Redesign and new

|              | Redesign                                      | New                                             |
| ------------ | --------------------------------------------- | ----------------------------------------------- |
| Input        | An existing file, route or component          | A brief                                         |
| Claude reads | The target, its callers and its states        | The nearest similar screens and components      |
| Fixed        | Content, data, behavior, props, accessibility | Only the theme and the component set            |
| Asks         | Only when the target is ambiguous             | One question when purpose or content is missing |
| Apply        | Edits the target in place                     | Creates files where the project puts such files |

## The audit

`/design audit` ends with the `render_design_audit` tool. It writes a page of numbered findings and opens it in the browser. The audit changes no project code.

The page:

- Counts per severity (`error`, `warning`, `note`) and per category.
- A tab per category, and **All**.
- One card per finding: its number, its severity, what is there now, the value with a swatch, every `file:line` it sits on, and a **Fix**.
- The **Theme** panel of the mockup page.

The session's last line gives the counts: `Opened <path> in the browser. 3 findings: 2 hardcoded, 1 typography. 2 component groups.`

The tool checks these itself, in the files Claude hands it:

- Hardcoded colors, font families and font sizes.
- Tailwind arbitrary values, such as `text-[13px]` or `bg-[#123456]`.
- Hardcoded `px` and `rem` spacing, when the theme has space tokens.
- Theme tokens of one kind with the same value, and the same dark value.
- Tokens with no dark value, when other tokens of their kind have one.
- Contrast under 4.5:1 between a token and its `-foreground` partner, and for `foreground` on `background`, in light and in dark mode.

A hardcoded value is reported once per file, with every line it is on. When a token has that value, the finding is an error and its fix names the token. When several tokens have it, the fix names them all and says to use the one that fits the role. When none has it, the finding is a warning.

The files the theme's tokens cite are skipped: a token has to be declared somewhere.

The tool refuses a file in the list that does not exist, a finding with an unknown category or severity, a finding with no title or no fix, and a finding whose file does not exist.

Claude adds the findings that need judgment:

- **Typography**: one style per text role (page title, heading, body, caption, label, button text), sizes and weights on the scale, heading levels in order, no hand-restyled text where a text component exists.
- **Components**: variants that differ for no reason, raw elements where a component exists, missing hover, focus, disabled, loading or error states, mixed icon sets, spacing off the scale.
- **Theme**: unused tokens, a literal repeated three or more times, hardcoded light-only values in components.
- **Accessibility**: invisible focus, contrast the tool cannot compute, touch targets under 44px, color as the only signal.

### Same-purpose components

Claude also groups the components that do one job for the user, such as three ways to filter results or two kinds of dialog. UI that a page builds by hand counts as a member. For each group it lists the discrepancies in look, behavior and implementation, counts the files that use each member, and recommends one member to standardize on. It never recommends a new component.

The page shows these in a **Same-purpose components** section, before the findings:

- One card per group, named by its purpose.
- The recommended component is marked and listed first. Each member has its path, the number of files that use it, and what it lacks.
- The discrepancies, by aspect.
- **Why this one**: why it wins, what it must gain from the others first, and how many files the migration touches.

The tool checks only the shape of a group: a purpose and a reasoning, two or more members, each named, listed once and at a path that exists, discrepancies with a known aspect and a detail, and a recommendation that names a member. The judgment is Claude's. A project with no such groups has no section.

Groups are numbered first, in the order Claude lists them. The findings carry on from there, sorted by category and then by severity.

## Apply

`/design apply B` reads the newest saved design and builds variant B with the project's real components and tokens. The mockup's HTML is never copied into the project. A redesign edits the target in place. A new design goes where the project puts such files. A proposed token is added to the theme only when the variant listed it. The hooks of the project still apply, so a test comes first where one is required.

## Limits

- Mockups are plain HTML and CSS. They approximate the project's components; they do not render them.
- Mockups load no web fonts and no remote images. A project font falls back to the next family in its stack.
- The scan for hardcoded values works on text patterns, one line at a time. It misses named colors such as `red`, the `font:` shorthand, bare numbers in style objects such as `padding: 16`, and a declaration split over several lines. Claude reports those it sees.
- The same scan reads any text like `#123` in a source file as a hex color.
- The mockup check has the same blind spot: a named color passes it.
- Contrast is computed for pairs of solid hex colors only.
- A listed path that is a folder, or a file over 4 MiB, reports as missing.
- The pages were checked in Chrome only.
- Web UI only.

## Where things are saved

Everything goes to `.claude/design/` in the project:

- `theme.json`: the saved theme.
- `design-YYYY-MM-DD-HHMM.html` (UTC): a mockup page. The `.json` beside it holds the project, the mode, the subject, the theme and the variants. `/design apply` reads the newest one.
- `audit-YYYY-MM-DD-HHMM.html` (UTC): an audit page. The `.json` beside it holds the project, the files, the theme, the component groups and the findings, each with its `number`. A finding has its `lines` as a list, and the tool's own findings add the `value` they found.

Two pages of one kind rendered in the same minute share a name: the second overwrites the first.

The folder gets a `.gitignore` of `*`, so pages stay out of git.

If no browser opens, the tool reports the page's path instead.

## Where things live

| File                             | Holds                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| `hooks/register.ts`              | The three tools and their checks.                            |
| `hooks/theme.ts`                 | The theme's shape, and its tokens as CSS variables.          |
| `hooks/design-page.ts`           | The HTML of the mockup page.                                 |
| `hooks/hardcoded-values.ts`      | The finder of hardcoded colors, fonts, sizes and spacing.    |
| `hooks/audit.ts`                 | The findings, the theme's self-checks, numbering and counts. |
| `hooks/audit-page.ts`            | The HTML of the audit page.                                  |
| `hooks/component-groups.ts`      | The same-purpose groups and their shape checks.              |
| `hooks/input.ts`                 | The shared readers of tool input.                            |
| `hooks/page-style.ts`            | The CSS of both pages.                                       |
| `hooks/page-script.ts`           | The behaviour of both pages: tabs, width, dark and copy.     |
| `skills/design/SKILL.md`         | How Claude reads the theme, designs, audits and applies.     |
| `skills/design/theme-sources.md` | Where each stack keeps its theme.                            |

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install design@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install design@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir` while it is installed. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall design@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```
