# Where themes live

Find the stack in `package.json`, then read the matching sections. A project can match several. Read the source of a token, never the build output.

## Tailwind v4

- No config file by default. The theme is in CSS: the file with `@import "tailwindcss"`, often `src/app/globals.css`, `src/index.css` or `app/assets/css/main.css`.
- Tokens are the variables inside `@theme { … }`. The prefix gives the kind: `--color-*` color, `--font-*` font, `--text-*` text-size, `--spacing` and `--spacing-*` space, `--radius-*` radius, `--shadow-*` shadow.
- `--spacing` alone is the base step: `p-4` is four times it.
- `@theme inline { --color-primary: var(--primary); }` only maps names. The values are in `:root`, and the dark values in `.dark` or the selector that `@custom-variant dark` names.
- `@config "…"` loads a v3-style config file. Read it as below.
- A class with no token in the project (`bg-blue-600`) comes from Tailwind's defaults, in `node_modules/tailwindcss/theme.css`. Record it as inferred, with a line that uses it as the source.

## Tailwind v3

- `tailwind.config.{js,cjs,mjs,ts}`. `theme.extend` adds to the defaults. Keys directly under `theme` replace them.
- Kinds: `colors`, `fontFamily`, `fontSize`, `spacing`, `borderRadius`, `boxShadow`.
- `darkMode` says how dark mode is switched: `"class"`, `"selector"` or `"media"`.
- A value such as `hsl(var(--primary))` points at a CSS variable. The value is in the global CSS file, often as bare channels: `--primary: 222 47% 11%`. Record it wrapped: `hsl(222 47% 11%)`.

## CSS custom properties

- Declared under `:root`, in `globals.css`, `index.css`, `app.css`, `theme.css` or `styles/tokens.css`.
- Dark values sit under `.dark`, `[data-theme="dark"]` or `@media (prefers-color-scheme: dark)`.
- To find the files: `grep -rlE -- '--[a-z0-9-]+:' --include='*.css' . | head -20`, leaving out `node_modules` and build folders.

## shadcn/ui

- `components.json` at the project root. `tailwind.css` is the CSS file that holds the variables. `tailwind.config` is the config file, empty with Tailwind v4. `tailwind.baseColor` is the gray family. `iconLibrary` is the icon set. `aliases.ui` is the component folder, often `components/ui` or `src/components/ui`.
- Colors come in pairs: `--primary` with `--primary-foreground`, `--card` with `--card-foreground`. `:root` holds the light values and `.dark` the dark ones.
- `--radius` is the base radius. The other radii are computed from it.
- A component's variants are the keys of its `cva(…)` call: `variant` and `size`.

## MUI

- Search for `createTheme(` or `extendTheme(`. The object is passed to `ThemeProvider` or `CssVarsProvider`.
- Kinds: `palette` color, `typography.fontFamily` font, `typography.h1` to `caption` text-size, `spacing` space (a factor, 8px by default), `shape.borderRadius` radius, `shadows` shadow.
- Dark values: `colorSchemes.dark`, or a second theme with `palette.mode: "dark"`.
- Component styles: `components.MuiButton.styleOverrides`, `defaultProps` and `variants`.

## Chakra UI

- v2: `extendTheme({ … })` with `colors`, `fonts`, `fontSizes`, `space`, `radii`, `shadows`, `semanticTokens` and `components`.
- v3: `createSystem(defaultConfig, defineConfig({ theme: { tokens, semanticTokens, recipes } }))`. Each token is `{ value: … }`.
- Dark values are in `semanticTokens`: `{ default, _dark }` in v2, `{ value: { base, _dark } }` in v3.
- A component's variants are in its `variants` and `sizes` (v2) or its recipe (v3).

## styled-components and Emotion

- Search for `ThemeProvider` and follow its `theme` prop to the object, often `theme.ts` or `styles/theme.ts`.
- The shape is the project's own. Its type is declared as `DefaultTheme` in `styled.d.ts`, or as `Theme` in `emotion.d.ts`.
- Dark values are a second object, such as `darkTheme`, picked where the provider is rendered.
- Usage looks like `${({ theme }) => theme.colors.primary}`.

## Token files

- Style Dictionary: `tokens/**/*.json` or `.json5`, with a `config.json`, `sd.config.js` or `style-dictionary.config.js`. A leaf is `{ "value": … }`, or `{ "$value": …, "$type": … }` in the design tokens format. `{color.blue.500}` refers to another token: follow it to the real value.
- Tokens Studio: `tokens.json`, or a `tokens/` folder with `$themes.json` and `$metadata.json`. Token sets named light and dark hold the two values.
- The generated CSS or JS is build output. Cite the token file.

## Sass and Less

- Sass: `$name: value;` in `_variables.scss`, `_tokens.scss` or `abstracts/`. Maps such as `$colors: (primary: …)` hold groups.
- Less: `@name: value;` in `variables.less`.
- With Bootstrap, the overrides are the variables set before Bootstrap is imported.

## Components and Storybook

- Component folders: `components/ui`, `src/components`, `app/components`, `lib/components`, or `packages/ui/src` in a monorepo.
- Storybook: `.storybook/main.{js,ts}` lists the story globs. Stories are `*.stories.{tsx,jsx,ts,js,mdx}`, often beside the component.
- A component's stories and its `argTypes` name its variants and states. `.storybook/preview.*` shows how the theme is provided.
