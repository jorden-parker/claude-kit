# ui-design

One skill, `/ui-design`, designs UI in the project's own theme and opens the result as a page in the browser. Project code changes only when you pick a variant, through `apply` or the go-ahead after `redesign`, or when you name findings with `fix`.

| Command                                | What it does                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/ui-design new <brief>`               | Mockups of a screen or component that does not exist yet.                                                             |
| `/ui-design redesign <target> [notes]` | Mockups of new looks for an existing file, route or component. Asks for the go-ahead before any project code changes. |
| `/ui-design audit [scope]`             | Checks the theme, the components and their consistency.                                                               |
| `/ui-design apply [design] <letter>`   | Builds the picked variant of a saved design in project code.                                                          |
| `/ui-design fix <numbers>`             | Fixes numbered audit findings in project code.                                                                        |
| `/ui-design gallery`                   | Opens every saved design and audit on one page, with search, filters and apply commands.                              |

With no mode word, a target that exists in the project means `redesign`, and anything else means `new`.

Plain words work too: "redesign the settings page", "mock up a pricing page", "audit the design system".

The plugin registers the bare `/ui-design` command, which runs the skill. Plugin skills are always namespaced as `/<plugin>:<skill>`, so the skill itself is hidden from the menu with `user-invocable: false`; Claude can still pick it from plain words.

`new` and `redesign` ask the `ui-ux-pro-max` skill for one design direction per variant, then open every variant side by side on one page. A variant may also try other colors and fonts when they look better. It does this by giving the theme's color and font tokens new values inside its own frame, through `restyledTokens`, and `apply` writes them into the theme. Without `ui-ux-pro-max` installed, Claude writes the variants on its own.

Every mode follows the Web Interface Guidelines from the `web-design-guidelines` skill. `new` and `redesign` write the variants to its rules. `audit` turns what it reports into findings. `apply` and `fix` review the files they changed with it, and fix what it reports. Without the skill installed, Claude carries on without it. Install it with `npx skills add vercel-labs/agent-skills --skill web-design-guidelines`.

In `new`, `redesign` and `audit` the session stays quiet. Claude prints no theme, variant or finding: the result is on the page, and the last line in the session says the page opened.

`redesign` then asks which variant to build, with a `Not yet` option. Picking a letter is the go-ahead: Claude builds it as `/ui-design apply` does. Until then, no project file changes. Only `.claude/ui-design/` is written, to hold the page, its `.json` and the theme.

## Usage

`/ui-design new a pricing page with three plans and a FAQ` mocks up a new screen.

`/ui-design redesign src/app/settings/page.tsx less scrolling` mocks up new looks for the settings page.

`/ui-design redesign the sidebar` finds the sidebar component first.

`/ui-design audit` checks the whole project. `/ui-design audit src/components` checks one folder.

`/ui-design apply B` builds variant B of the newest design. `/ui-design apply design-2026-11-12-153000 B` builds variant B of that saved design instead.

`/ui-design fix 3 5 7` fixes findings 3, 5 and 7 of the newest audit. `/ui-design fix all` fixes every finding and group. `/ui-design fix errors` fixes every finding with severity `error`.

## The theme

Every mode starts from the project's theme. Claude reads it once and saves it as `.claude/ui-design/theme.json`:

- **Tokens**: each with a name, a kind (`color`, `font`, `text-size`, `space`, `radius` or `shadow`), a value, a dark value where the project has one, and its source as `path:line`.
- **Stack**: the framework, the styling method, how dark mode is switched, and the icon set.
- **Components**: the core components, their paths and their variants.
- **Inconsistencies**: near-duplicates, such as two grays a shade apart.

Declared tokens come first: a Tailwind config or `@theme` block, CSS custom properties, shadcn's `components.json`, a MUI, Chakra, styled-components or Emotion theme object, token files, Sass and Less variables. `skills/ui-design/theme-sources.md` says where each stack keeps them. With no declared tokens, Claude counts what the UI code uses most and marks those tokens **inferred**.

The `save_design_theme` tool refuses a token whose source file is missing, or whose name and value both do not appear in that file. A token cannot be invented.

The saved theme is reused until a file is newer than it. The files checked are the ones its tokens cite, plus the project's config files that exist: `package.json`, `components.json`, the Tailwind config, the global CSS entry and the other locations `theme-sources.md` lists. Then it is read again.

With almost no theme to find, Claude stops and asks before it proposes one.

## The mockup page

`/ui-design new` and `/ui-design redesign` end with the `render_design` tool. It writes one self-contained page and opens it in the browser.

- One tab per variant, A to D. Two variants by default.
- Each variant renders in a browser-style window with its own address, such as `variant-a.preview`, on a dotted stage.
- The handle under each window sets the preview height for every variant at once. Drag it, use the arrow keys, Home and End, or double-click it to reset. A badge shows the height while you drag.
- The hero counts the variants, and a footer signs the page off. Motion stays off under `prefers-reduced-motion`.
- Each variant renders in its own sandboxed frame, with the theme injected as CSS variables. A variant's CSS only uses `var(--token)`.
- **Desktop** and **Mobile** switch the frame's width. **Dark** appears when the theme has dark values.
- Each variant has a name and a rationale. A redesign also lists what it **Kept** and what it **Changed**.
- **Proposed additions**: up to three tokens a variant needs that the theme lacks.
- **Use this** copies `/ui-design apply <design> <letter>`, naming this page's own design, so a newer design cannot take its place. The command is also shown beside the button.
- A **Theme** panel: the tokens by kind, with swatches, sources and an **inferred** mark, and the inconsistencies.
- The browser tab reads `Redesign · <project>` or `New design · <project>`.

The tool refuses a design with an unknown mode, or with no variant or more than four. It refuses a variant that:

- has no name or no HTML;
- uses a raw color or a raw font family, in its CSS or in an inline style;
- has a `<style>` element in its HTML: styles go in its CSS;
- puts a color literal in an SVG `fill`, `stroke`, `stop-color`, `flood-color` or `color` attribute;
- proposes more than three tokens, or a token with no name, no value or an unknown kind;
- is a redesign that lists nothing as changed.

A raw color is a hex color, a color function such as `rgb()` or `oklch()`, or a named color such as `red` or `white`. `var(--token)`, `currentColor`, `transparent` and `inherit` pass.

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

`/ui-design audit` ends with the `render_design_audit` tool. It writes a page of numbered findings and opens it in the browser. The audit changes no project code.

The page:

- Counts per severity (`error`, `warning`, `note`) and per category.
- A tab per category, and **All**.
- One card per finding: its number, its severity, what is there now, the value with a swatch, every `file:line` it sits on, and a **Fix**.
- The **Theme** panel of the mockup page.
- The browser tab reads `Design audit · <project>`.

The session's last line gives the counts: `Opened <path> in the browser. 3 findings: 2 hardcoded, 1 typography. 2 component groups.`

When an earlier audit is saved in `.claude/ui-design/`, the tool compares the findings with the newest one. A finding is the same when its category, title and file match, so a moved line or a new number is not a change. The hero and the session's last line then add `Since the last audit: 3 fixed, 1 new.` With no earlier audit, or one that cannot be read, nothing is added.

The tool checks these itself, in the files Claude hands it:

- Hardcoded colors, font families and font sizes.
- Tailwind arbitrary values, such as `text-[13px]` or `bg-[#123456]`.
- Hardcoded `px` and `rem` spacing, when the theme has space tokens.
- Theme tokens of one kind with the same value, and the same dark value.
- Tokens with no dark value, when other tokens of their kind have one.
- Contrast under 4.5:1 between a token and its `-foreground` partner, and for `foreground` on `background`, in light and in dark mode. The 4.5:1 bar is for body text. A pair used only for large text (24px, or 18.66px bold) needs 3:1, and the finding says so.

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

`/ui-design apply B` reads the newest saved design and builds variant B with the project's real components and tokens. Name another saved design before the letter to build from it instead: `/ui-design apply design-2026-11-12-153000 B`, or the file name with `.json`. An unknown name lists the saved designs and asks which.

Before it builds, Apply compares the design's theme with the current one. It lists the tokens renamed, removed or changed since. If the variant uses one of them, it names the token and builds with the nearest current token, telling you which.

The mockup's HTML is never copied into the project. A redesign edits the target in place. A new design goes where the project puts such files. A proposed token is added to the theme only when the variant listed it. The hooks of the project still apply, so a test comes first where one is required.

## Fix

`/ui-design fix <numbers>` fixes numbered findings of the newest audit in project code. `fix all` takes every finding and group, and `fix errors` every finding with severity `error`. With no numbers, or an unknown one, it lists the valid numbers and asks.

Each finding is fixed at its file and line, and a theme finding where its token is declared. A same-purpose group is fixed by moving its usages to the recommended member, after adding what that member lacks. Fix adds no token to the theme. Project hooks still apply, and the type check and tests run.

It ends with one line per number and a suggestion to run `/ui-design audit` again to confirm.

## Gallery

`/ui-design gallery` writes `gallery.html` into `.claude/ui-design/` and opens it. The page lists every saved design and audit, newest first:

- Search by project, subject, variant or file name, and filter to All, New, Redesign or Audit. The sort toggle puts the oldest first.
- Each design shows a live thumbnail of its variants, and a copyable `/ui-design apply` command for each one.
- Each audit shows its finding counts by severity and its component groups.

Saved files that do not parse, or lack what the page needs, are skipped. In plain words, Claude opens the same page through the `open_design_gallery` tool.

### Outside a session

`gallery.ts` builds the same page from a terminal, across projects. It needs `bun`.

```
plugins/ui-design/gallery.ts                      # every project in ~/.claude.json
plugins/ui-design/gallery.ts ~/src/app ~/src/web  # only these projects
```

It writes `~/.claude/ui-design/gallery.html` and opens it. `--no-open` leaves the browser alone. Each card links to the page in its own project. An apply command still has to run in a session inside that project.

## Limits

- Mockups are plain HTML and CSS. They approximate the project's components; they do not render them.
- Mockups load no web fonts and no remote images. A project font falls back to the next family in its stack.
- The scan for hardcoded values works on text patterns, one line at a time. It misses the `font:` shorthand, bare numbers in style objects such as `padding: 16`, and a declaration split over several lines. Claude reports those it sees.
- The same scan reads any text like `#123` in a source file as a hex color.
- A named color counts only as the value of a color property or a color attribute. `const brand = "red"` passes both the scan and the mockup check.
- Contrast is computed for pairs of solid hex colors only.
- A listed path that is a folder, or a file over 4 MiB, reports as missing.
- The pages were checked in Chrome only.
- Web UI only.

## Where things are saved

Everything goes to `.claude/ui-design/` in the project:

- `theme.json`: the saved theme.
- `design-YYYY-MM-DD-HHMMSS.html` (UTC): a mockup page. The `.json` beside it holds the project, the mode, the subject, the theme and the variants. `/ui-design apply` reads the newest one.
- `audit-YYYY-MM-DD-HHMMSS.html` (UTC): an audit page. The `.json` beside it holds the project, the files, the theme, the component groups and the findings, each with its `number`. A finding has its `lines` as a list, and the tool's own findings add the `value` they found. After an earlier audit, it also has `progress`: the earlier file's name as `previousAudit`, and the counts `fixed` and `new`.
- `gallery.html`: the gallery of every saved design and audit. `/ui-design gallery` rewrites it each time it runs.

The folder gets a `.gitignore` of `*`, so pages stay out of git.

If no browser opens, the tool reports the page's path instead.

## Where things live

| File                                | Holds                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| `hooks/register.ts`                 | The four tools, the wiring of their checks and the autocomplete. |
| `hooks/mockup-checks.ts`            | The checks on a variant's CSS, markup and proposed tokens.       |
| `hooks/theme.ts`                    | The theme's shape, and its tokens as CSS variables.              |
| `hooks/design-page.ts`              | The HTML of the mockup page.                                     |
| `hooks/hardcoded-values.ts`         | The finder of hardcoded colors, fonts, sizes and spacing.        |
| `hooks/audit.ts`                    | The findings, the theme's self-checks, numbering and counts.     |
| `hooks/audit-page.ts`               | The HTML of the audit page.                                      |
| `hooks/gallery-page.ts`             | The gallery page's HTML and the reader of the saved files.       |
| `hooks/component-groups.ts`         | The same-purpose groups and their shape checks.                  |
| `hooks/input.ts`                    | The shared readers and small checks of tool input.               |
| `hooks/page-style.ts`               | The CSS of both pages.                                           |
| `hooks/page-script.ts`              | The behavior of both pages: tabs, width, dark and copy.          |
| `skills/ui-design/SKILL.md`         | How Claude reads the theme, designs, audits and applies.         |
| `skills/ui-design/theme-sources.md` | Where each stack keeps its theme.                                |

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install ui-design@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install ui-design@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir` while it is installed. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall ui-design@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```

`pnpm test` runs the hook tests, then `node --test tests/` for the page script, which needs `eval` and so cannot run in the hooks sandbox.
