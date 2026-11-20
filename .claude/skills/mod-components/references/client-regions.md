# Client regions

A `Client` is a region of a mod's drawing that a second file, a "surface module", draws. Use it when a component needs local state, its own animation frames, mouse input or per-key input. For plain layout, a function component is simpler and works on more surfaces.

Facts here come from the engine types (`ClientProps`, `ClientModule`, `ClientSurface`, `UiMessageArgument`, `UiFaultInput`) unless marked otherwise. In this repo, grep for those names in `plugins/ui-design/.claude-plugin/types/claude-code/index.d.ts`.

## Contents

- Drawing a Client
- Writing the surface module
- The surface API
- Talking between hooks and the Client
- Failures
- Rules and limits
- Example

## Drawing a Client

Draw it from your `ui.render` hook like any element:

```js
Client({ key: 'meter', module: './meter.tsx', props: { percent: 40 }, flexGrow: 1 })
```

| Prop | Meaning |
| :- | :- |
| `key` | The instance's address in the tree. State and timers survive redraws while the key stays. Two Clients in one tree need two keys. |
| `module` | A **string literal** path relative to the declaring file (`.tsx`, `.jsx`, `.ts`, `.js`, `.mjs`). A variable, a path outside the plugin, or a missing file is refused at load. |
| `props` | Plain JSON (no closures), at most 100,000 characters serialized. New props reach the running instance with its state kept. |
| `width`, `height` | Cells, or a percentage of the parent. Without them, the region is as big as it draws. |
| `flexGrow` | Grows into free room along the parent's direction, as a Box does. |

**Surfaces:** the terminal and the Desktop app. VS Code doesn't draw a `Client`, so give it a fallback. [Docs: reference]

## Writing the surface module

The module's default export (or its one PascalCase export) is a `ClientModule`:

```ts
type ClientModule<P extends JsonValue = JsonValue, S = unknown> =
  (props: P, surface: ClientSurface<S>) => RenderElement
```

- **Where it runs:** on the drawing thread, with **at most one call per second**. A redraw is triggered by `setState`, new props, input or a tick.
- **No mods API:** draw only with `surface.elements`.
- **Reserved names:** `h` and `Fragment` come from the environment, so don't use those names in the module.
- **Unmounting:** a throw, an overrun, or a tree past the bounds unmounts the instance.

## The surface API

| Member | What it does |
| :- | :- |
| `elements` | The element constructors, which are the terminal elements minus `Client`, `Raster` and `Image`. Destructure, as in `const { Box, Text } = surface.elements`. |
| `state` | Local state, `undefined` until the first `setState`. It is kept across redraws and dropped with the instance. |
| `setState(next)` | Replaces state and schedules one more call on the next frame. Several calls coalesce into one redraw. |
| `columns`, `rows` | The region's size in cells as last laid out (0 before the first layout). Size your drawing to these. |
| `every(ms, fn)` | Calls `fn` on the frame clock until the returned stop function is called or the instance unmounts. |
| `onPointer(fn)` | Pointer events: `type` is `down`, `move`, `up`, `enter` or `leave`, with `x`/`y` cells relative to the region and optional sub-cell `fine`, `button`, `shift`, `alt`, `ctrl`. After a `down`, every `move` arrives until the `up`, even past the edges. There is one listener, and a later call replaces it. |
| `onKey(fn)` | Key events (`key` is a name such as `up`, `return`, `backspace`, or the typed character, plus `ctrl`, `shift`, `meta`). These fire only while a click has given the Client focus. Escape never arrives, because it returns focus to the prompt. There is one listener. |
| `post(data)` | Sends plain JSON to your hooks as a `ui.message`. Limits are 20,000 values, 32 levels deep, and 100,000 characters. One post per frame is delivered, and a later post in the same frame replaces an undelivered one. |

## Talking between hooks and the Client

- **Client to hooks:** `surface.post(data)` arrives as `e.data` on a `ui.message` event, along with `surface`, `component`, `requestId`, `element` (the Client's key) and `module`. Only your own plugin's hooks see your Client's posts. The data comes from client code, so **validate it** before using it.
- **Hooks to Client, without a redraw:** answer the `ui.message` with `{ props }`. The posting instance gets them directly, with its state kept, and no `ui.render` runs.
- **Hooks to Client, with a redraw:** call `$.ui.invalidate('ui.render')` and draw the Client again with new `props`.

## Failures

Handle `ui.fault` (v2.1.289+), which fires when your Client fails to load, render or run:

- **`e.phase`:** `load` means it failed before the module ran, `render` means it threw while drawing, and `run` means a listener, timer, handler, loop or flood failed.
- **`e.reason`:** 1 to 200 characters of untrusted text. Show or log it, and never parse it.
- **What to return:** the hook only observes, so return `next(e)` (the core answers `{}`). The engine then runs `ui.render` for that site again, unasked. **Your render hook must leave the `Client` out on that redraw** (record the fault in a variable and draw a fallback). If a Client drawn in that redraw also fails, the engine doesn't redraw again, so call `$.ui.invalidate('ui.render')` when you want to retry.

If you don't handle it, the terminal shows a dimmed failure line in the Client's place and the rest of the drawing still shows. [Docs: interface]

Give thrown errors a message. Otherwise the failure reads "the module failed without a message". [Docs: troubleshoot]

## Rules and limits

- **Render loop:** a `setState` on each of three renders in a row, with no key, pointer, tick, press or props change in between, counts as a render loop and unmounts the instance. Only call `setState` in response to input or a timer.
- **No nesting:** no `Client` inside a `Client`, and no `Raster` or `Image` inside one. For pixel art, draw a `Raster` from the hooks module and animate it with `$.ui.blit`.
- **`module` path:** the `module` prop is limited to 10,000 characters. [Docs: reference, from a summary]
- **Early access:** check the local types before relying on details here.

## Example

A clickable progress meter. This example is untested, so verify the names against your local types.

```tsx
import type { ClientModule } from 'claude-code'

type MeterProps = { percent: number }

const Meter: ClientModule<MeterProps, boolean> = (props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(pointer => {
    if (pointer.type === 'down') surface.post({ clicked: true })
    if (pointer.type === 'enter') surface.setState(true)
    if (pointer.type === 'leave') surface.setState(false)
  })
  const width = Math.max(surface.columns, 1)
  const filled = Math.round((props.percent / 100) * width)
  const isHovered = surface.state === true
  return Text({
    color: isHovered ? 'suggestion' : 'claude',
    children: ['█'.repeat(filled), '░'.repeat(width - filled)],
  })
}

export default Meter
```

And in the hooks module:

```js
on('ui.message', async ($, e) => {
  if (e.element !== 'meter' || typeof e.data?.clicked !== 'boolean') return {}
  await $.ui.open({ id: 'meter-details', title: 'Usage' })
  return {}
})

let hasMeterFailed = false

on('ui.fault', async ($, e, next) => {
  if (e.element === 'meter') hasMeterFailed = true
  $.ui.log('meter failed (' + e.phase + '): ' + e.reason)
  return next(e)
})
```

In the `ui.render` hook, draw `Text({ children: [percent + '%'] })` instead of the `Client` when `hasMeterFailed` is true, or when `e.surface` is `'vscode'`.
