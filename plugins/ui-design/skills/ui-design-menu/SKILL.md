---
name: ui-design-menu
description: Design UI as themed mockups in the browser, or audit the theme and components
argument-hint: "new <brief> | redesign <target> [notes] | audit [scope] | apply [design] <letter> | fix <numbers, all or errors> | gallery"
disable-model-invocation: true
---

Arguments: $ARGUMENTS

If the arguments are exactly `gallery`, call `mcp__ui-design__open_design_gallery` and stop.

Otherwise run the `ui-design:ui-design` skill with the Skill tool, passing these arguments as they stand.
