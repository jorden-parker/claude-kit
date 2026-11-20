# House visual style: status pills on a strict grid

This is the default look for mod UI. Every recipe here was rendered in a real Claude Code terminal and checked at 160 and 90 columns. Earlier versions that read well as code still looked awkward on screen: they had missing structure lines, a crowded close ✕, ragged columns, pills that wrapped, and uneven padding. So follow the grid exactly, then render and look (see SKILL.md, "Render it and look").

**Target** (the CI panel in the band above the prompt, 90-column terminal; only the `[-]` belongs to the engine):

```
 CI · main · ✗ Failing                                                    [-]
 ─────────────────────────────────────────────────────────────────────────
  FAIL   unit-tests (node 22)                                      3m 08s
  RUN    e2e-browser                                    ▰▰▰▰▱▱▱▱   5m 05s
  PASS   lint                                                         42s
  PASS   build-docs-and-publish-preview-site-for-the-pu…           1m 35s
 ─────────────────────────────────────────────────────────────────────────
 ✗ 1  ● 1  ✓ 3                                   updated 2m ago   h: Hide
❯
```

Here FAIL, RUN and PASS are pills: dark text on a red, amber or green background.

## Where the panel goes: the band, not a Pane

Every `Pane` gets a close ✕ from Claude Code: on the frame corner for an inline pane, or on a row of its own above a docked pane. `$.ui.open` has no option to hide, move, relabel or style it, and no layout inside the pane made it look right. Users kept calling it out as misplaced. [Types: `PaneOpenArgs`; Pane `bodyColumns`]

So draw status panels in the band above the prompt (`ui.render` with `component: 'AbovePrompt'`). The engine adds only a small `[-]` at the band's right edge, and `e.props.bodyColumns` already leaves room for it. [Types: `AbovePrompt`]

```js
let isPanelShown = false

function setPanelShown($, isShown) {
  isPanelShown = isShown
  return $.ui.invalidate('ui.render')
}

on('command.run', { command: 'ci' }, async $ => { await setPanelShown($, !isPanelShown); return {} })

on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  if (!isPanelShown || e.props.hasSurvey) return next(e)
  const elements = $.ui.resolve(e)
  const hideButton = elements.Button({ key: 'hide', label: 'Hide', hotkey: 'h', plain: true, onPress: () => setPanelShown($, false) })
  return ciPanel(elements, e.props.bodyColumns, hideButton)
})
```

- **The slash command toggles** the panel, and an `h: Hide` button in the footer hides it.
- **Yield to surveys:** pass with `next(e)` while `hasSurvey` is true.
- **Height:** the band is capped (half the terminal in fullscreen); a taller tree scrolls. Keep a panel to about 15 rows.
- **One band per session:** only one hook draws the band, so if two of your panels can show at once, merge them into one tree.
- **VS Code draws no band.** There, open the same tree in a Pane instead (check `e.surface` or fall back when the band never renders).
- **Use a Pane only** when the content needs its own focus and scroll beside the chat (a log, a long table). Accept the engine ✕ there: keep the header's top-right empty and open it with `closeOnEscape: true`.

## Contents

- The grid
- Where the panel goes: the band, not a Pane
- Pill
- Header and divider
- Rows
- Footer and actions
- A one-line band
- Graphics (Raster)
- Empty, loading and error states
- Narrow widths
- Mistakes seen in renders

## The grid

1. **One side padding everywhere.** Use `paddingX: 1` on the root Box only, and compute `innerWidth = e.props.bodyColumns - 2`. Header, rows, dividers and footer all share those edges.
2. **Divider lines, not blank rows.** Put a full-width `─` line under the header and above the footer. Blank rows inside a pane read as missing lines.
3. **Fixed columns on every row.** Each cell except the name has a fixed `width` and `flexShrink: 0`. The name is the only `flexGrow` cell. Reserve a column even on rows that leave it empty, so the column after it still lines up.
4. **One gap size.** Use `columnGap: 2` between cells and `columnGap: 1` inside a label group (such as `CI · main`). No `gap` between rows.
5. **Colour only on status.** Pills and status words use `success`, `error` and `warning`, with `inverseText` on pills. Names are `text`; numbers, context and hints are `dimColor`; lines are `subtle`. These are all theme keys. [Types: `ThemeKey`]

## Pill

```js
const LOOK = {
  failing: { label: 'FAIL', glyph: '✗', word: 'Failing', color: 'error' },
  running: { label: 'RUN',  glyph: '●', word: 'Running', color: 'warning' },
  passing: { label: 'PASS', glyph: '✓', word: 'Passing', color: 'success' },
}

function statusPill({ Box, Text }, state) {
  return Box({ width: 6, flexShrink: 0, children: [
    Text({ backgroundColor: LOOK[state].color, color: 'inverseText', weight: 'semibold', wrap: 'clip',
      children: [' ' + LOOK[state].label.padEnd(4) + ' '] }),
  ]})
}
```

- **Wrap the pill** in a `Box` with `width: 6` and `flexShrink: 0`. Without that, a long name in the same row squeezes the pill, and its text wraps onto a second line. This happened in a real render.
- **Pad inside the label** (`' PASS '`), because `backgroundColor` paints only the text's own cells. [Docs: gallery]
- **Use pills in rows only.** Use a coloured status word in the header (next section).

## Header and divider

```js
function header({ Box, Text }, title, context, state) {
  return Box({ flexDirection: 'row', columnGap: 1, children: [
    Text({ weight: 'semibold', children: [title] }),
    Text({ dimColor: true, children: ['·'] }),
    Text({ dimColor: true, children: [context] }),
    Text({ dimColor: true, children: ['·'] }),
    Text({ color: LOOK[state].color, weight: 'semibold', children: [LOOK[state].glyph + ' ' + LOOK[state].word] }),
  ]})
}

function divider({ Text }, width) {
  return Text({ color: 'subtle', wrap: 'clip', children: ['─'.repeat(Math.max(width, 0))] })
}
```

- **Status inline after the title** (`CI · main · ✗ Failing`). The engine's `[-]` (band) or ✕ (Pane) sits at the right end of this row, so nothing of yours goes there.
- **No border box.** Dividers give the structure; a `borderStyle` box adds a second frame.
- **Divider width:** draw the divider at exactly `innerWidth`, with `wrap: 'clip'` (v2.1.326+) so it can never wrap.

## Rows

```js
function jobRow(elements, job, innerWidth) {
  const { Box, Text } = elements
  return Box({ key: 'job-' + job.name, flexDirection: 'row', columnGap: 2, children: [
    statusPill(elements, job.state),
    Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'truncate-end', children: [job.name] })] }),
    innerWidth >= 60 ? progressCell(elements, job) : null,
    innerWidth >= 40 ? Box({ width: 7, flexShrink: 0, justifyContent: 'flex-end', children: [
      Text({ dimColor: true, tabular: true, children: [formatDuration(job.seconds)] }),
    ]}) : null,
  ].filter(Boolean)})
}

function progressCell({ Box, Text }, job) {
  const segments = 8
  const hasProgress = job.state === 'running' && job.progress != null
  const filled = hasProgress ? Math.round(Math.min(Math.max(job.progress, 0), 1) * segments) : 0
  return Box({ width: segments + 2, flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', children: hasProgress
    ? [Text({ color: 'warning', children: ['▰'.repeat(filled)] }), Text({ color: 'subtle', children: ['▱'.repeat(segments - filled)] })]
    : [] })
}
```

- **Sort by urgency:** failing, then running, then passing.
- **Reserved cell:** the progress cell is drawn on every row, empty when there's no progress. That keeps the duration column straight.
- **Numbers:** right-align them in a fixed-width `Box`, with `tabular`.

## Footer and actions

```js
Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
  Box({ flexDirection: 'row', columnGap: 2, children: counts }),
  Text({ dimColor: true, children: ['updated 2m ago'] }),
]})
```

- **Counts:** coloured glyph-and-number pairs (`✗ 1  ● 1  ✓ 3`) on the left, and metadata (`dimColor`) on the right.
- **Actions** go in the footer row as `Button({ label, hotkey, plain: true })`, which draws as `r: Refresh`. Use one action style throughout. Don't mix bracketed and plain buttons.
- **Hide action, bottom-right:** every panel ends its footer with `h: Hide`, a plain Button. It is never dropped at narrow widths.
- **Footer order:** other actions on the left (`r: Refresh`), counts or metadata next, and `h: Hide` last on the right.

## A one-line band

```
  RUN    Indexing repo  ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   20%                click for details  [-]
```

```jsx
<Box flexDirection="row" columnGap={2} paddingX={1}>
  <Box width={6} flexShrink={0}>{pill}</Box>
  <Box flexShrink={0}><Text weight="semibold">Indexing repo</Text></Box>
  <Box flexDirection="row" flexShrink={0}>{segments}</Box>
  <Box width={4} flexShrink={0} justifyContent="flex-end"><Text tabular>{percent + '%'}</Text></Box>
  <Box flexGrow={1} />
  <Text dimColor>click for details</Text>
</Box>
```

- **Cap the bar at about 24 segments.** A bar stretched across the whole band, 100+ segments, looked awkward.
- **Push the hint right** with an empty `flexGrow` Box, so it sits beside the engine's `[-]`.
- **Narrow bands:** drop the hint first, then the bar. Keep the pill, label and percentage.

## Graphics (Raster)

- **Size to the pane.** Make the grid `innerWidth` wide, and generate exactly `columns × rows` cells for that width. A grid narrower than the pane looks unfinished.
- **Smooth data.** Use a smooth function or real data, not random noise per cell, so the picture reads as a heatmap.
- **Ramp colours:** keep the low end clearly brighter than the panel background, which is about `#262626` in dark themes. A near-black low colour disappears. Raster rounds colours to a smaller palette. [Docs: gallery]
- **Legend:** add a one-row `low ▇▇▇▇▇▇ high` legend under the grid, drawn as a small Raster.
- **Encoding:** encode cells with `new Uint8Array(words.buffer).toBase64()`. `Buffer` doesn't exist in the mod runtime; using it throws `ReferenceError: Buffer is not defined` and the pane doesn't draw.

## Empty, loading and error states

- **Empty:** a dim line where the rows go, such as `No jobs yet · run /ci again after a push`.
- **Loading:** a header status of `⠹ Loading` in `claude`, with the braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` advanced by a timer, and a dim `Fetching…` in the list.
- **Error:** a `FAIL` pill plus a one-line reason, with a dim retry hint in the footer.

## Narrow widths

| `innerWidth` | What to drop |
| :- | :- |
| 60 and up | Nothing |
| 40–59 | The progress column and footer metadata. `h: Hide` stays |
| Under 40 | The duration column. Show the pill and the truncated name only |

## Mistakes seen in renders

| Looked like | Cause | Fix |
| :- | :- | :- |
| Pill split across two lines | Pill shrank beside a long name | `Box({ width: 6, flexShrink: 0 })` around it |
| Columns not lining up | One row had an extra cell | Reserve the cell on every row |
| Close ✕ looked misplaced | Every Pane gets an engine ✕ that can't be moved or hidden | Draw the panel in the AbovePrompt band; `h: Hide` in the footer |
| Duration wrapped to `1m` / `35s` | A fixed-width cell without `flexShrink: 0` shrank beside a long name | `flexShrink: 0` on every fixed cell |
| Panel looked patchy, lines missing | Blank spacer rows, no dividers | `─` dividers at `innerWidth` |
| Band felt stretched | Bar with `flexGrow` across the whole row | Cap the bar at ~24 segments, spacer before the hint |
| Grid lost its low values | Low ramp colour near the panel background | Brighter low end |
