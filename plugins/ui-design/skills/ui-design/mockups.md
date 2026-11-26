# ui-design: mockups

Sections 2 to 5 of the ui-design skill, for the `new` and `redesign` modes. Section 1 is in `theme.md` and section 7 in `apply-fix.md`, both beside this file.

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

The `web-design-guidelines` skill holds the Web Interface Guidelines: rules for focus, forms, motion, typography, touch targets, dark mode, performance and copy. Run it once with the `Skill` tool, before writing any variant, and keep its rules for this design. Always pass it files, or it stops to ask for them: in `redesign`, the target's file; in `new`, the similar screens read in step 2.

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
