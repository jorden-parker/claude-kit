# ui-design: the theme

Section 1 of the ui-design skill. `SKILL.md`, beside this file, picks the mode and names the tools.

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
