# Sources

Researched 2026-11-20. Labels in SKILL.md map to these.

## [Docs]: official Claude Code documentation

- Draw in the interface: https://code.claude.com/docs/en/plugins/mods/interface
- Mods reference (render sites, elements, limits): https://code.claude.com/docs/en/plugins/mods/reference
- Mods overview: https://code.claude.com/docs/en/plugins/mods/overview
- Mods events: https://code.claude.com/docs/en/plugins/mods/events
- Mods API: https://code.claude.com/docs/en/plugins/mods/api
- Gallery (what each element looks like): https://code.claude.com/docs/en/plugins/mods/gallery
- Testing mods: https://code.claude.com/docs/en/plugins/mods/test
- Troubleshooting mods: https://code.claude.com/docs/en/plugins/mods/troubleshoot
- Create a mod (types for your build): https://code.claude.com/docs/en/plugins/mods/create
- Terminal config (themes and tokens): https://code.claude.com/docs/en/terminal-config

The interface and reference pages were read partly verbatim and partly as summaries. Prefer the local types for exact names.

## [Types]: engine type declarations

- Local, authoritative for the installed version: `.claude-plugin/types/claude-code/index.d.ts` in each mod. In this repo: `plugins/ui-design/.claude-plugin/types/claude-code/index.d.ts`
- GitHub copy (can be older): https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts

## [Community]: third-party sources

- OneWave-AI mods (burn-meter, code-pet and others): https://github.com/OneWave-AI/claude-code-mods
- burn-meter source: https://github.com/OneWave-AI/claude-code-mods/blob/main/burn-meter/hooks/register.tsx
- code-pet source: https://github.com/OneWave-AI/claude-code-mods/blob/main/code-pet/hooks/register.tsx
- OneWave blog, "Claude Code Mods Explained": https://www.onewave-ai.com/blog/claude-code-mods
- ruvnet, "Claude Code Mods: a field guide": https://gist.github.com/ruvnet/a485e930b148185197fc53fd38b429ea
- DEV, side pane with `$.ui.open`: https://dev.to/nakadadev/how-to-add-a-side-pane-to-claude-code-with-a-mod-using-uiopen-and-uirender-3c24
- Official example plugin, theme-examples: https://github.com/anthropics/claude-plugins-official/tree/c4a79ce6b7c21a4b2ea908767f4adeab32695ae4/plugins/theme-examples
