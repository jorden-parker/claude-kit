---
name: mod-components
description: Best practices for custom UI in Claude Code mods, the plugin hooks modules that draw through `ui.render` and `$.ui`: components, state, animation, input, theming, fallbacks, testing and limits. Use whenever you write, restyle, review or debug a mod's pane, band, placed row, spinner, toast or Client widget, or the user asks how to build mod UI, even if they don't say "mod".
---

# Custom components for Claude Code mods

A mod is a plugin whose `hooks/hooks.json` lists a hooks module (`"modules": ["./register.js"]`). The module draws UI by answering `ui.render` events with element trees, and calls `$.ui` for panes, toasts and dialogs. This skill covers how to build your own components on top of that well.

Each point carries a label so you know how much to trust it:

- **[Docs]**: official Claude Code docs. Links are in `references/sources.md`.
- **[Types]**: the engine's TypeScript declarations (see below).
- **[Community]**: third-party mods and guides. Treat these as practice, not contract.

## Start from the types for this build

The engine writes its declarations into every mod at `.claude-plugin/types/claude-code/index.d.ts`. That copy is the authoritative reference for the installed Claude Code version. It is more complete than the docs, and the GitHub copy can be older. In this repo, read `plugins/ui-design/.claude-plugin/types/claude-code/index.d.ts`. [Docs, Types]

The file is huge (17k+ lines), so grep for a name rather than reading it whole:

| Name to grep | What it tells you |
| :- | :- |
| `ThemeKey`, `export type Color` | Colour keys that follow the user's theme |
| `export type Space` | Spacing steps `xs` to `xl` |
| `BoxHoverProps`, `position?:` | Hover styling and absolute popovers |
| `ClientModule`, `ClientSurface` | The custom-region API |
| `bodyColumns`, `isCollapsed` | Pane and band props for sizing and state |

The whole API is marked **early access** in the types and may change, so check names there before relying on this skill's examples. [Types]

## Pick the kind of component

There is no component registry. A "component" is one of two things. [Docs, Types]

| Need | Use |
| :- | :- |
| Reusable layout or styling: chips, rows, cards, headers | **Function component**: a function that returns elements |
| Local state, its own animation frames, mouse or per-key input | **`Client` region**: a separate surface module file |

Start with a function component. Reach for a `Client` only when you need what only it gives, because it has stricter rules (see `references/client-regions.md`) and doesn't draw in VS Code. [Docs, Types]

## Function components

Every element is a plain function that takes props, with nested elements and strings in `children`. So a component is just a function you write. The docs' own pane example uses a `tabButton` helper this way. [Docs]

```js
function statusRow({ Box, Text }, label, isOk) {
  return Box({ key: label, flexDirection: 'row', gap: 'sm', children: [
    Text({ backgroundColor: isOk ? 'success' : 'error', color: 'inverseText', weight: 'semibold',
      children: [isOk ? ' PASS ' : ' FAIL '] }),
    Text({ children: [label] }),
  ]})
}

on('ui.render', { component: 'Pane', requestId: 'build' }, async ($, e) => {
  const elements = $.ui.resolve(e)
  return elements.Box({ flexDirection: 'column', paddingX: 'sm', children: [
    statusRow(elements, 'Tests', true),
    statusRow(elements, 'Lint', false),
  ]})
})
```

- **Pass the resolved elements in.** Elements come from `$.ui.resolve(e)` per event, so take them as a parameter instead of capturing them once. [Docs]
- **JSX works** in `.tsx` and `.jsx` modules. `h` and `Fragment` are globals, so set tsconfig to `"jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"`. There are no string tags: every tag is an element from `$.ui.resolve(e)` or your own function. [Docs, Types]
- **Function components are stateless.** They rebuild on every `ui.render` and draw wherever their elements are supported. [Docs]

## Client regions, in brief

A `Client` is a region drawn by a second file in your plugin. It gets `props`, local `state`/`setState`, its own size, a frame timer, `onPointer`, `onKey`, and `post` to send data back to your hooks as a `ui.message`. It gets no mods API. [Types]

```js
Client({ key: 'meter', module: './meter.tsx', props: { percent: 40 }, flexGrow: 1 })
```

Read `references/client-regions.md` before writing one. It covers the full surface API, the render-loop rule, failure handling and limits.

## Structure, reuse and state

- **Draw from state.** Change state in a handler, call `$.ui.invalidate('ui.render')`, and rebuild the tree from current values. Nothing redraws on its own: the engine doesn't poll or watch variables. [Docs]
- **One hook per job.** `session.start` registers commands and loads saved state. `command.run` calls `$.ui.open` and returns `{}`. `ui.render` draws. [Docs]
- **Pick the right storage.** [Docs, Community]
  - Module variables reset when the mod reloads.
  - `$.state` survives a reload but resets on `/clear`, `/resume` and `/branch`, so reload it at session start.
  - `$.store` (4 MiB of JSON) persists and is shared across sessions, and concurrent sessions can overwrite each other.
- **Keep `$` at the edge.** Put layout, logic and drawing helpers in files that never touch `$`, and only `register` calls the engine. That makes them testable in plain Node. [Community: OneWave code-pet, ruvnet]
- **Leave other mods alone.** Filter on your own pane with `on('ui.render', { component: 'Pane', requestId: 'my-pane' }, …)`, or check `e.requestId` and `return next(e)` for everything else. Without one of these you blank other mods' panes. Give every `Button`, `Input` and `Select` a unique, non-empty `key`. [Docs, Types]
- **Pass `$` only to top-level functions.** The mod compiler refuses a module where `$` goes to anything other than a function declared at the top level of the file (a `function` declaration, or a `const` bound to one) or one imported from the mod's own files. So `onPress: () => refresh($)`, where `refresh` is a closure inside `register`, makes the whole module fail to load. Declare such helpers at the top level, or call `$.noun.method(...)` directly in the handler. Run `claude plugin validate <mod dir>` to catch this before you finish. [Engine error text, seen in testing]
- **Don't style shared wrappers.** Don't put `width`, `height` or `position` on a Box that wraps other mods' band rows. Before v2.1.323 it clobbers their rows. [Docs]

## Animation and performance

- **Whole-site redraws:** `$.clock.every(ms, () => $.ui.invalidate('ui.render'))`. They are capped at 10 per second, or 30 in the terminal for the visible pane, the expanded band and the hint line. Faster calls coalesce. [Docs]
- **Fast pixel animation:** draw a keyed `Raster` and repaint it with `$.ui.blit({ requestId, key, columns, rows, cells })`. No `ui.render` runs. Cancel the timer when a blit returns `deny`. [Types, Community: OneWave burn-meter blits every 80 ms]
- **Smooth motion:** derive position from `await $.clock.now()` rather than fixed steps, because late timers make fixed steps drift. `$.clock.now()` returns a Promise. [Community: ruvnet]
- **Clean up:** stop timers on `ui.close` and `session.end`. [Community: ruvnet]
- **Time limit:** hooks get 10 seconds per event, or 50 ms for `prompt.edit`. [Docs]
- **Don't show stale data as live.** Drop the picture when its source goes quiet. [Community: ruvnet]

## Keyboard, mouse and focus

- **Mods never read the keyboard directly.** Keys reach controls only while the pane or band has focus. [Docs]
- **Getting focus:** open with `focus: true`, or the user presses Ctrl+X then Tab, or clicks in fullscreen. Focus is only granted when the prompt is empty and nothing else has focus. [Docs]
- **Keys:** Tab moves between controls, Enter presses, submits or picks, Esc returns to the prompt (and closes the pane with `closeOnEscape`). [Docs]
- **`true` only:** `focus`, `closeOnEscape`, `holdToasts` and `autoFocus` accept only `true`, and `false` throws. Leave the field out instead. [Docs]
- **Hotkeys** are one digit or one lowercase letter. They fail without focus, in a collapsed band, on a clash with another mod's hotkey, and in VS Code. Name the key in a bracketed label, or use `plain: true` so it shows as `1: One`. [Docs]
- **Show focus state.** Read `e.props.isFocused` and draw a hint like "Ctrl+X Tab to focus" when it's false. Offer the same actions as slash subcommands. [Community: ruvnet]
- **Hover with no code:** a keyed `Box` with `hover: { … }` restyles while the pointer is over it, and no hook runs. To reveal on hover, draw a Box with `display: 'none'` and `hover: { display: 'flex' }`. Add `position: 'absolute'` for a popover that doesn't reflow the layout. [Types: `BoxHoverProps`]
- **Mouse input** (down, move, up, enter, leave, per cell) is only available inside a `Client` via `onPointer`. [Types]

## Making it look good

**Read `references/visual-style.md` before drawing anything a person will look at.** It is the house style: status panels drawn in the band above the prompt (a Pane always gets an engine ✕ that can't be moved or hidden), coloured status pills, an inline status in the header, divider lines, fixed columns, segmented progress bars, band and empty/loading/error recipes, and what to drop at narrow widths. In testing, UI built only from the rules below came out correct but plain, and the user rejected it. The official docs have no visual design guide, so the points below (from the types, the gallery and community practice) are the building blocks that style uses.

**Colour**
- **Use theme keys for colour** so it follows the user's theme, including the colour-blind (`daltonized`) themes. [Types: `ThemeKey`]
  - `text`, `inverseText`, `inactive`, `subtle`, `suggestion`, `remember`
  - `success`, `error`, `warning`, `merged`, `claude`, `permission`
  - `planMode`, `autoAccept`, `promptBorder`, `bashBorder`, `ide`
  - `diffAdded`, `diffRemoved`, plus their `Dimmed` and `Word` variants
- **Raw colours** (a name such as `"red"`, or hex) are allowed by the `Color` type, and a surface decides what to draw for strings it doesn't know. Community mods use hex; the docs only show names. Prefer keys. [Types, Community]
- **Don't hard-code pane backgrounds.** Users theme them through `composerSidebarBackground`. [Docs: terminal-config]
- **Use one accent colour** and keep everything else `text`, `subtle` or `dimColor`. [Community: OneWave]
- **Pair colour with a glyph** (✓ ✗ ● ▸) so status survives without colour. A good pattern is colour by threshold, as burn-meter does: red above 75%, orange above 45%. [Community: OneWave]
- **Raster rounds colours** to a smaller palette, so `0x2e7d32` draws as `#337733`. [Docs: gallery]

**Layout and spacing**
- **Flexbox:** `flexDirection` (`row`, `column`, and the `-reverse` forms only, anything else gets the tree skipped), `flexWrap`, `alignItems`, `justifyContent` (`space-between` and so on), `gap`, `columnGap`, `rowGap`. [Types, Docs]
- **Spacing scale:** use the named steps for a consistent rhythm instead of raw numbers. In the terminal, `xs` and `sm` are 1 across and **0 down**, `md` is 2 and 1, `lg` is 3 and 1, `xl` is 4 and 2. So a vertical `gap: 'xs'` adds no blank row, and you need `'md'` or `1` for that. The steps need v2.1.299+. [Types: `Space`, Docs]
- **Size to the room you have:** lay out to `e.props.bodyColumns`, not the terminal width. Truncate long text with `wrap: 'truncate-end'` (`maxLines` and `clip` need v2.1.326+). [Types, Docs]
- **Inline panes** get a third of the screen by default and can cut off a bottom button row. Request `rows` for the view you need. [Docs, Community: ruvnet]

**Typography and borders**
- **Weight:** use `weight: 'semibold'` for headers, since `bold: true` is deprecated. Use `dimColor` for labels. `size` and `mono` are ignored in the terminal. [Docs]
- **Text styles:** `italic`, `underline`, `strikethrough`, `inverse`. `backgroundColor` fills only the width of the text, which suits a status badge with dark text. [Docs: gallery, Community: OneWave]
- **Borders:** `'round'`, `'single'`, `'double'`, `'bold'`, `'dashed'`, `'classic'`, `'arrow'`, `'quote'`, `'singleDouble'`, `'doubleSingle'`. A misspelling such as `'rounded'` silently draws no border. A round Box stretches to full pane width. [Docs]
- **Buttons have a fixed look:** brackets by default, inverse when focused, and `variant: 'primary'` uses the accent colour. `plain: true` removes the brackets. You can't change their shape or colour. [Docs: gallery]
- **Dense charts:** use half-block and braille characters, and draw one `Raster`, not one `Box` per cell. [Community: ruvnet]
- **Use plain Unicode** rather than Powerline or Nerd Font glyphs, which many terminals lack.

## Customisation and theming

- **Expose options as parameters.** A function component's parameters are its options. A `Client`'s `props` must be plain JSON (no closures, at most 100k characters), and new props reach the running instance with its state kept. [Types]
- **Terminal colours belong to the user.** Themes are JSON with `name`, `base` and `overrides` in `~/.claude/themes/`, or in a plugin's `themes/` folder. `base` is one of `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi` or `light-ansi`. Theme keys in your components pick up whatever the user chose. [Docs: terminal-config]
- **Desktop only:** `$.theme.set({ colors, backdrop })` and `$.theme.clear()` (v2.1.324+ for colours). A later call from any mod replaces the earlier one, so send colours and backdrop in one call. [Docs]
- **Light or dark:** no API detects a light or dark *terminal*. `colorScheme` exists only on the Desktop `Backdrop`. Theme keys are the way to adapt. [Types]

## Fallbacks for surfaces and terminals that can't draw it

Not every surface draws every element, and an unsupported element can get the whole tree refused. Check `e.surface` and return something that surface can draw. [Docs, Community: ruvnet]

| Surface | Draws | Missing |
| :- | :- | :- |
| Terminal | Everything, including `Raster`, `Image`, `Placed` | `Svg` (a pane returning only `Svg` opens empty) |
| Desktop Code tab | Panes, band, `Svg`, `Client`, backdrop, colours | `Raster`, `Image`, `Placed`. WSL runs no plugins |
| VS Code | `Pane`, toasts, status lines | Band, hotkeys, `autoFocus`, `Raster`, `Image`, `Client` |
| `claude -p`, Agent SDK, cloud | Nothing (hooks still run) | All UI |

`Image` draws only in kitty 0.28+, Ghostty and iTerm2 3.5+. Elsewhere it shows dimmed `alt` text. Under tmux it needs 3.3+, `allow-passthrough on` and `focus-events on`. [Docs]

```js
const chart = e.surface === 'terminal'
  ? Raster({ key: 'chart', columns, rows, cells })
  : Text({ dimColor: true, children: [summaryLine] })
```

**Narrow terminals and placement:** [Docs]
- **Auto-opened panes:** a pane the mod opens without user action needs 144 columns, or 110 after the user has opened it once. Check the result of `$.ui.open` and fall back when `isPlaced` is false.
- **Transcript rows:** where nothing draws them, reply with text instead:

  ```js
  const placed = await $.ui.place({ id: 'build-status' })
  return placed.isPlaced ? {} : { text: 'Build: passing' }
  ```
- **Collapsed band:** a collapsed band draws no buttons. Read `e.props.isCollapsed` and offer the action elsewhere.
- **Last resort:** `$.ui.log` (a dim transcript line Claude doesn't read) or a command's text reply works on every drawing surface.

## Render it and look

Code review alone isn't enough. In testing, a module that read correctly failed to load, and a band that looked fine in code drew as a truncated `| [=====  35% (click for`. Before you call a component done, load the mod in a real Claude Code terminal and look at what it draws:

```bash
claude plugin validate ./my-mod
bash <this skill>/scripts/render-mod.sh ./my-mod ./out/pane /my-command 160 45 /path/to/a/trusted/folder
bash <this skill>/scripts/render-mod.sh ./my-mod ./out/pane-narrow /my-command 90 40 /path/to/a/trusted/folder
```

- **What it does:** starts `claude --plugin-dir` in a hidden tmux terminal of the given size, types the slash command (pass `null` for UI that draws at session start), and saves the screen as `.txt`, `.ansi` and, with `uvx`, `.html`.
- **What to check:** read the `.txt`. Look for "hook skipped" lines, cut-off text, and ragged columns, and compare against the target in `references/visual-style.md`. Open the `.html` to see the colours, or show it to the user. Fix the code and render again until it matches.
- **Requirements:**
  - `tmux`, and a **folder Claude Code already trusts** as the last argument. An untrusted folder makes Claude Code exit at the trust prompt.
  - Run it outside the Bash sandbox, because the sandbox kills the tmux server. Ask the user for that permission.
  - The script clears this session's `CLAUDE*` environment variables, so the inner `claude` starts as a normal interactive session, and it launches through bash, so a fish login shell doesn't break it.
- **Noise:** the user's other plugins also draw on screen, so tell their lines apart from yours.
- **HTML artifacts:** in the `.html`, a wide glyph such as `⏺` on the left of a row can shift that row by a column, and full-block Raster rows show thin gaps. The `.txt` grid is the truth for alignment; check it there before changing code.

## Testing and previewing

- **Live preview:** run `claude --plugin-dir ./my-mod`. The module reloads on save. Editing an installed copy has no effect. [Docs]
- **Gallery loop:** the docs' gallery mod (`/gallery`) lets you paste element samples and see them drawn. [Docs: gallery]
- **Unit tests:** write `*.test.ts` files that import `expect` and `test` from `'claude-code/testing'`, and run `claude plugin test`. `$.ui.mount({ ...PANE, surface })` returns a handle with `press`, `input`, `select`, `find` and `unmount`, and `mock.clock` tests timers without waiting. Loop the tests over `'terminal'` and `'desktop'`. [Docs: test]
- **Check by eye too:** tests don't check how a tree paints, so look at new layouts in a real session. [Docs: test]
- **Demo subcommand:** add one (for example `/burn demo`) that cycles through every state without waiting for real events. [Community: OneWave]
- **Debugging:** an invalid tree is skipped with a "hook skipped" line that names the cause. Run `claude --debug-file ./mod-debug.log --plugin-dir ./my-mod` and grep for your mod. `claude plugin validate ./my-mod` checks the manifest and module. [Docs: troubleshoot]

## Limits and what's not possible

**Per-tree limits** [Docs, Types]
- 100,000 characters of text
- 32 levels of nesting
- 20,000 elements and text children
- 262,144 `Raster` cells (`columns` up to 512, `rows` up to 256)
- 2 MiB of `Image` data

**Other limits** [Docs, Types]
- `Svg` source: 131,072 characters
- Side pane width: at most 45% of the terminal
- Placed rows: 500 per mod
- Names (panes, commands, placed row ids): 64 characters of letters, digits, `_` and `-`

**Not possible**
- Changing the permission prompt [Docs]
- Sharing a component registry between mods. The nearest thing is a plugin adding a typed noun to `$` for its dependents. [Types]
- Nesting a `Client` inside a `Client`, or using `Raster` or `Image` inside one [Types]

## Uncertain or undocumented

- **Hex colours:** hex on `Text.color` is allowed by the types and used by community mods, but not shown in the docs.
- **Single-author reports** [Community: ruvnet]:
  - Blits are accepted at about 120 per second.
  - `focus: true` sometimes leaves `isFocused` false.
- **Partial reads:** parts of the interface and reference pages were read as summaries. Verify exact prop names in the types.
- **Version-gated features:** check the version notes in the types before relying on these.

## Before you finish a component

1. Does every site that isn't yours return `next(e)` (or does the hook filter on its own `requestId`), and does every control have a unique `key`?
2. Does it follow `references/visual-style.md`: panels in the band rather than a Pane, pills for status, theme-key colours, divider lines and fixed columns?
3. Does `claude plugin validate` pass, with `$` only ever passed to top-level functions?
4. Have you rendered it with `scripts/render-mod.sh` at 160 and 90 columns, and does the capture match the target?
5. Does the layout fit `bodyColumns`, with truncation on long text?
6. Is there a fallback for each surface that can't draw an element you used, and for `isPlaced: false`?
7. Are timers stopped on close and session end, and redraws under the rate cap?
8. Has a `$.ui.mount` test run on both `terminal` and `desktop`?
