---
name: ui-design
description: Design UI as themed mockups in the browser, built from the project's own colors, type, spacing and components, or audit the project's theme and components for consistency. Use whenever the user asks to design, mock up or sketch a new screen, page or component, to redesign, restyle or rethink existing UI, to audit or check the theme, design system, design tokens, hardcoded colors, typography or component consistency, or to apply, build or implement a design variant, or to fix audit findings. Changes no project code until the user picks a variant with apply, answers the go-ahead question after redesign, or names findings with fix.
user-invocable: false
argument-hint: "new <brief> | redesign <target> [notes] | audit [scope] | apply [design] <letter> | fix <numbers, all or errors>"
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
| none       | A target that exists in the project means `redesign`. Anything else: new.                                             |

A request in plain words picks the mode by what it asks for.

## Stay quiet

In `new`, `redesign` and `audit`, the page is the only output.

- Do not print the theme, the variants, the findings or a summary in the session, while you work or at the end.
- Do not edit project files. The tools write to `.claude/ui-design/` themselves.
- Your last message is the tool's one-line result, and nothing else. The one exception is a question the steps below allow, such as the go-ahead question that ends `redesign`.

## The tools

Three tools, all writing to `.claude/ui-design/` in the project. If a tool's schema is not loaded, load it with `ToolSearch` first. If the tool does not exist even then, stop and say in one line that the design plugin's tools are not loaded. Do not write a page yourself.

- `mcp__ui-design__save_design_theme` checks and saves the theme as `theme.json`.
- `mcp__ui-design__render_design` checks the variants against the saved theme, writes the mockup page and opens it.
- `mcp__ui-design__render_design_audit` scans the files, merges its findings with yours, writes the audit page and opens it.

A tool that refuses a call replies with one problem per line. Fix every problem and call it again.

The two render tools refuse with `No saved theme at <path>. Call save_design_theme first.` until a theme is saved.

Pages are named by the second: `design-YYYY-MM-DD-HHMMSS` and `audit-YYYY-MM-DD-HHMMSS`, in UTC. Call a render tool once, with everything.

## 1. Theme

Every mode starts here.

### Reuse a saved theme

If `.claude/ui-design/theme.json` exists, read it. From the project root, take the distinct paths of its tokens' `source` fields, without the `:line`, and add the theme's config files that exist: `package.json`, `components.json`, `tailwind.config.{ts,js,cjs,mjs}`, the global CSS entry, and the other "Look here first" locations in `theme-sources.md`. Leave out any path that does not exist, since `find` fails on a missing one. Then run:

```
find <path> <path> … -maxdepth 0 -newer .claude/ui-design/theme.json
```

No output and no error: the theme is current. Use it and skip to the mode. Any output, a missing file, or a request to refresh the theme: extract it again.

### Extract the theme

1. Find the stack: the framework, the styling method, how dark mode is switched and the icon set. `package.json` and the config files say.
2. Read the declared tokens, starting with the CSS. `theme-sources.md`, beside this file, lists the usual places in order under "Look here first", then says where each stack keeps them and how to read them.
3. With no declared tokens for a kind, count usage: the colors, font families, text sizes, spacing, radii and shadows the UI code uses most. Keep the common ones and mark each `isInferred: true`.
4. Read three to five core components: the button, the input, the card, the navigation, and one more the project leans on. Note their radius, borders, shadows, density, and their hover, focus, disabled and error states. A value they repeat that no token holds becomes an inferred token.
5. List near-duplicates in `inconsistencies`, one plain sentence each, with both values and where they are: two grays a shade apart, two radii one pixel apart, a font size off the scale.

A token is:

- `name`: the project's own name for it, without a leading `--`: `primary`, `muted-foreground`, `radius-lg`.
- `kind`: `color`, `font`, `text-size`, `space`, `radius` or `shadow`.
- `value`: a value CSS accepts as it stands. `222 47% 11%` is not one; `hsl(222 47% 11%)` is.
- `darkValue`: only when the project has one.
- `source`: `path:line`, relative to the project root, of the line that declares the token. For an inferred token, a line that uses it.

The tool refuses a token whose file is missing, or whose name and value both do not appear in that file. Cite the real line. Never invent a token to fill a gap.

```json
{
  "tokens": [
    {
      "name": "primary",
      "kind": "color",
      "value": "oklch(0.55 0.2 262)",
      "darkValue": "oklch(0.7 0.16 262)",
      "source": "src/app/globals.css:14"
    }
  ],
  "stack": {
    "framework": "Next.js 15",
    "styling": "Tailwind v4",
    "darkMode": "class",
    "iconSet": "lucide"
  },
  "components": [
    {
      "name": "Button",
      "path": "src/components/ui/button.tsx",
      "variants": ["default", "outline", "ghost", "sm", "lg"]
    }
  ],
  "inconsistencies": [
    "Two card radii: 8px in card.tsx:12 and 10px in panel.tsx:7."
  ]
}
```

Save it with `mcp__ui-design__save_design_theme`.

### When there is almost no theme

Fewer than about five tokens, declared and inferred together, is not a theme.

- In `new`, `redesign`, `apply` and `fix`: stop and ask once, with `AskUserQuestion`, whether to propose a starter theme. Never invent tokens silently.
- In `audit`: save what you found and report the missing theme as an `error` finding. The tool needs at least one token. With none at all, stop and say in one line that the project has no theme to audit.

## 2. Redesign

1. Resolve the target to a file. A route resolves to its page file, a component name to its definition. Ask, with `AskUserQuestion`, only when the words fit several files.
2. Read the target, the components it renders, and its callers. Find every state it has: empty, loading, error, disabled, signed out.
3. These are fixed: the content, the data, the behavior, the props and the accessibility. A redesign changes layout, hierarchy, grouping, density and emphasis.
4. Get one direction per variant from `ui-ux-pro-max`, as "Directions from ui-ux-pro-max" in section 4 says. Write two variants. Write more, up to four, only when the notes ask. Variants differ in structure, not just in color.
5. Draw the project's components the way they look: read the ones the mockup shows, from the paths in the theme's `components`.
6. Fill `kept` and `changed` for each variant, honestly. `changed` needs at least one entry. If something from step 3 had to change, it goes in `changed`, with the reason.

`subject` is the target's path.

## 3. New

1. A new design needs a purpose and its content: what the screen is for, and what it shows or collects. When either is missing, ask one question with `AskUserQuestion`, then carry on.
2. Read the nearest similar screens, for layout, density and tone. Read the components the mockup will reuse, from the paths in the theme's `components`.
3. Get one direction per variant from `ui-ux-pro-max`, as "Directions from ui-ux-pro-max" in section 4 says. Write two variants. Write more, up to four, only when the brief asks. Variants differ in structure, not just in color.
4. Leave `kept` and `changed` out.

`subject` is the brief, in one line.

## 4. Mockup rules

### Directions from ui-ux-pro-max

The variants come from the `ui-ux-pro-max` skill. Before writing any variant, run it once with the `Skill` tool. Give it the product type, the subject, the stack and the theme's look, and ask for as many distinct design directions as there are variants: a style, a layout pattern and the UX rules that apply.

- Each variant follows one direction. Name the variant after its direction and say in `rationale` what the direction is good at.
- Take style, layout, hierarchy, density and UX rules from it.
- Take its palette and font pairing too, when you judge they look better for this design than the theme's own. Put them in `restyledTokens`, as "Different colors and fonts" below says. Keep the theme's values when they already look good.
- Do not print its output in the session. Stay quiet still holds.
- If the skill is not installed, carry on without it.

### Web Interface Guidelines

The `web-design-guidelines` skill holds the Web Interface Guidelines: rules for focus, forms, motion, typography, touch targets, dark mode, performance and copy. Run it once with the `Skill` tool, before writing any variant, and keep its rules for this design.

- Every variant follows those rules, as far as a static mockup can show them.
- Where a rule and the theme disagree, the theme wins, and the rule goes in `rationale`.
- Do not print its output in the session. Stay quiet still holds.
- If the skill is not installed, carry on without it.

Apply and fix use it too, to review the files they changed, and audit uses it for findings.

### Different colors and fonts

A variant may give the theme's own color and font tokens new values, through `restyledTokens`. Use it when another palette or font pairing makes that variant look better. At least one variant keeps the theme as it is, so the user can compare.

- Each entry has the `name` of a color or font token the theme already has, a `value`, and a `darkValue` when the theme has dark values. The tool takes the kind from the theme and refuses any other name.
- The new value holds only inside that variant's frame. The css still writes `var(--<token name>)`.
- Fonts are system or generic stacks, such as `Georgia, serif` or `ui-rounded, system-ui, sans-serif`, since frames load no web fonts.
- The new colors still meet the contrast rule below, in both modes.
- Say in `rationale` that the variant changes the colors or fonts, and in `changed` in a redesign.

### Rules for every variant

For every variant, in both modes:

- `html` is the content of the body: no `<html>`, `<head>` or `<body>` tag, and no `<style>` element. Every style goes in `css`, a plain style sheet. The tool refuses a `<style>` element in `html`.
- Plain HTML and CSS. Each variant runs in a sandboxed frame: no scripts, no `<link>`, no `@import`, no web fonts, no remote images. Icons and images are inline SVG or `data:` URLs.
- Every color and every `font-family` is `var(--<token name>)`. The page defines one variable per token, named by the token's name in lower case with every other character run turned into a hyphen. The tool refuses a raw color or a raw font family, in the CSS and in inline styles.
- In SVG, the `fill`, `stroke`, `stop-color`, `flood-color` and `color` attributes take `currentColor` or `var(--<token name>)`. The tool refuses a color literal there too.
- The keywords `transparent`, `currentColor` and `inherit` are allowed. So are `initial`, `unset` and `revert` for `font-family`.
- The tool reads hex colors, color functions such as `rgb()` and `oklch()`, and named colors such as `white` when they are the value of a color property or a color attribute. The rule holds where the tool cannot see.
- Text sizes, spacing, radii and shadows use the tokens too, wherever the theme has them.
- Real content, in the project's own words and data shapes. No lorem ipsum.
- Works from 390px wide to desktop.
- Every control has a visible focus state. Body text meets AA contrast: 4.5:1. Large text (24px, or 18.66px bold) may meet 3:1.
- Show the states that matter to the design, such as an error under a field or an empty list.
- `newTokens`: at most three per variant, and only when the theme truly lacks the value. Each has a `name`, a `kind` and a `value`, and a `darkValue` when the theme has dark values. It has no `source`.

## 5. Open the page

Call `mcp__ui-design__render_design` once, with every variant. It reads the saved theme itself.

```json
{
  "project": "<project name>",
  "mode": "redesign",
  "subject": "src/app/settings/page.tsx",
  "variants": [
    {
      "name": "Single card",
      "rationale": "<one or two sentences: what this layout is good at>",
      "html": "<main class=\"page\">…</main>",
      "css": ".page{background:var(--background);color:var(--foreground)}",
      "kept": ["All three fields and their labels"],
      "changed": ["The sidebar is gone; the page is one column"],
      "newTokens": [],
      "restyledTokens": [{ "name": "primary", "value": "oklch(0.55 0.12 170)" }]
    }
  ]
}
```

When the tool succeeds, reply with its result line.

In `new`, stop there.

In `redesign`, then ask for the go-ahead, once, with `AskUserQuestion`: which variant to build. Offer one option per variant, by letter and name, and a last option, `Not yet`.

- A letter: that is the go-ahead. Build it as section 7 says, from the design just rendered.
- `Not yet`, or any other answer: stop. Nothing in the project has changed. Say in one line that `/ui-design apply <letter>` builds a variant later.

Never edit a project file before the user picks a letter.

## 6. Audit

The audit reports. It fixes nothing.

1. Load or extract the theme, as in section 1.
2. Pick `files`: the UI source in scope, as paths relative to the project root. That is the components, the pages and the style sheets. Skip tests, stories, generated files, build output and vendored code. The scope is the words after `audit`. With none, it is the whole project. List files, never folders: the tool refuses a path it cannot read as a file.
3. The tool finds the hardcoded values in `files` itself: hex colors, color functions and named colors, font families, font sizes, Tailwind arbitrary values, and `px` and `rem` spacing when the theme has space tokens. It skips the files the theme's tokens cite. It also checks the theme for tokens that share a value, tokens with no dark value where others of their kind have one, and contrast under 4.5:1 for each `x` on `x-foreground` pair and for `foreground` on `background`. The 4.5:1 bar is for body text: a pair used only for large text needs 3:1, and its finding says so. Do not list any of these by hand.
4. Report as `hardcoded` findings only what that scan cannot see: the `font:` shorthand, a bare number in a style object such as `padding: 16`, and a declaration split over several lines.
5. Find the components that share a purpose, as "Same-purpose components" below says.
6. Read the files and write the findings that need judgment, as "Findings" below says.
7. Review `files` with the `web-design-guidelines` skill. Turn each rule it reports into a finding: `accessibility` for focus, labels, contrast, motion and touch targets, `typography` for type and copy, `components` for the rest. Skip what another finding already covers. If the skill is not installed, skip this step.

### Same-purpose components

A group is two or more components that do the same job for the user. The tool scans nothing for groups: every judgment here is yours.

**Find the groups**

1. List every component: the theme's `components`, the component folders, and UI that a page builds by hand instead of using a component. A page with its own filter bar is a member, named by what it is, with the page's file as its `path`.
2. Group by the job done for the user, not by name or by library:
   - filtering and selecting results
   - picking one of many
   - picking a date
   - confirming or dismissing: dialogs, drawers, popovers
   - showing a list or a table
   - paging
   - tabs
   - notices and toasts
   - empty states
   - form fields
   - search
   - navigation
   - buttons and button-like links
3. A group needs two or more members. A project with no such groups gets no `componentGroups`. Never invent a group.

**Compare the members**

Write each group's `discrepancies` under three aspects. Give the values and the files, not adjectives.

- `look`: the tokens used, sizes, radius, density, icons.
- `behavior`: keyboard, multi-select, clear and reset, loading, the empty and error states, where the results update.
- `implementation`: the library underneath, the props API, controlled or uncontrolled, ARIA roles, hardcoded values.

Each member's `notes` says how that member differs from the others, or what it lacks.

**Count the use**

`usedIn` is the number of files that import or render the member, as a whole number. Count with grep. Do not estimate.

Every member needs a `name` and a `path` that exists, and is listed once. The tool refuses a group that breaks this.

**Recommend one**

`recommended` is the `name` of one member of the group, never a new component. Weigh, in this order:

1. It covers the states and the accessibility the others lack.
2. It is built on the theme's tokens.
3. Its API can serve every current use.
4. It is the most used, so the migration is the smallest.

`reasoning` says why it wins, what it still lacks that another member has and must gain before the migration, and how many files the migration touches. When no member is fit to keep, recommend the closest and say so plainly in `reasoning`.

**Do not double-report**

A discrepancy listed in a group is not repeated as a `components` finding.

### Findings

**typography**

- Each text role has one style everywhere: page title, section heading, body, caption, label, button text.
- Sizes, weights and line heights sit on the scale.
- Heading levels are not skipped.
- Text is not restyled by hand where a text component or variant exists.

**components**

- Variants of one component that differ in radius, height or padding for no reason.
- A raw element where the project has a component for it.
- A missing state: hover, focus-visible, disabled, loading or error.
- Mixed icon sets or icon sizes.
- Spacing off the scale.

**theme**

- A token nothing uses.
- A literal that appears three or more times and should be a token.
- Dark-mode gaps the tool cannot see: a component with a hardcoded light-only value.

**accessibility**

- Focus that cannot be seen.
- Contrast the tool cannot compute: colors that are not hex, text on an image.
- A touch target under 44px.
- Color as the only signal.

Add what the project shows beyond these. Leave a category empty when it has no findings. Never pad.

A finding is:

- `category`: `hardcoded`, `typography`, `components`, `theme` or `accessibility`.
- `severity`: `error` for what a user can see or cannot use, `warning` for an inconsistency, `note` for cleanup.
- `title`: under ten words, naming the problem.
- `detail`: what is there now, with the values.
- `fix`: the concrete change, naming the token, component or variant to use.
- `file` and `line`: where it is. One finding per place, unless one cause covers a whole file. The tool refuses a `file` that does not exist.

Do not number anything. The tool numbers the groups first, in the order you pass them, then the findings, sorted by category and then by severity.

Call `mcp__ui-design__render_design_audit` once. Leave `componentGroups` out when there are no groups.

```json
{
  "project": "<project name>",
  "files": ["src/components/ui/button.tsx", "src/app/settings/page.tsx"],
  "componentGroups": [
    {
      "purpose": "Filtering and selecting results",
      "components": [
        {
          "name": "FilterBar",
          "path": "src/components/filter-bar.tsx",
          "usedIn": 6,
          "notes": "Multi-select with a clear button. No loading state."
        },
        {
          "name": "FacetSidebar",
          "path": "src/components/search/facet-sidebar.tsx",
          "usedIn": 2,
          "notes": "Checkbox groups with result counts. No clear button, no keyboard support for the groups."
        },
        {
          "name": "Orders page filter row",
          "path": "src/app/orders/page.tsx",
          "usedIn": 1,
          "notes": "Three native selects built in the page. Single-select only."
        }
      ],
      "discrepancies": [
        {
          "aspect": "look",
          "detail": "FilterBar chips are 32px high with radius-md; FacetSidebar rows are 40px with no radius; the orders selects are 36px with a hardcoded 6px radius (orders/page.tsx:41)."
        },
        {
          "aspect": "behavior",
          "detail": "FilterBar updates results on each change; FacetSidebar waits for an Apply button; the orders row reloads the page."
        },
        {
          "aspect": "implementation",
          "detail": "FilterBar is built on Radix Popover and is controlled; FacetSidebar keeps its own state; the orders row reads and writes the query string by hand."
        }
      ],
      "recommended": "FilterBar",
      "reasoning": "It is the only member with keyboard support and a clear action, it uses theme tokens throughout, and it is already in 6 of the 9 files. It lacks FacetSidebar's result counts: add those first. The migration touches 3 files."
    }
  ],
  "findings": [
    {
      "category": "typography",
      "severity": "warning",
      "title": "Section headings use two sizes",
      "detail": "Settings uses text-lg font-semibold; Billing uses text-xl font-bold.",
      "fix": "Use text-lg font-semibold in billing/page.tsx, as the other sections do.",
      "file": "src/app/billing/page.tsx",
      "line": 18
    }
  ]
}
```

When the tool succeeds, reply with its result line and stop.

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
