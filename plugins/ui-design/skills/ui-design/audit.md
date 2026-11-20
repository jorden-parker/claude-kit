# ui-design: the audit

Section 6 of the ui-design skill, for the `audit` mode. Section 1 is in `theme.md`, beside this file.

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
