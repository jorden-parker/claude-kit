export const PAGE_STYLE = `
:root{--bg:#fff;--surface:#fafafa;--panel:#fff;--text:#171717;--muted:#666;--subtle:#8f8f8f;--line:#ebebeb;--line-strong:#d4d4d4;--blue:#0070f3;--red:#c00;--amber:#8a5a00;--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.04)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--surface:#111;--panel:#0a0a0a;--text:#ededed;--muted:#a1a1a1;--subtle:#7c7c7c;--line:#262626;--line-strong:#3d3d3d;--blue:#3291ff;--red:#ff6166;--amber:#f5a623;--shadow:0 0 0 1px rgba(255,255,255,.02)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Geist","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
code{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow-wrap:break-word}
[hidden]{display:none!important}
.muted{color:var(--muted)}
main{max-width:1280px;margin:0 auto;padding:40px 24px 96px}
.eyebrow{margin:0 0 8px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--subtle)}
h1{margin:0;font-size:32px;line-height:1.15;font-weight:600;letter-spacing:-.04em;overflow-wrap:anywhere}
h2{margin:0;font-size:18px;font-weight:600;letter-spacing:-.02em;overflow-wrap:anywhere}
h3,h4{margin:20px 0 6px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--subtle)}
.hero p.muted{margin:10px 0 0}
.toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-top:28px;padding:10px 0;border-bottom:1px solid var(--line);background:var(--bg)}
[role=tablist],.toggles,.apply{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
[role=tab]{font:inherit;font-weight:500;height:32px;padding:0 12px;border:1px solid transparent;border-radius:99px;background:none;color:var(--muted);cursor:pointer;white-space:nowrap}
[role=tab]:hover{color:var(--text)}
[role=tab][aria-selected=true]{border-color:var(--text);background:var(--text);color:var(--bg)}
.button{font:inherit;font-weight:500;height:32px;padding:0 12px;border-radius:6px;cursor:pointer;white-space:nowrap}
.button.secondary{border:1px solid var(--line);background:var(--panel);color:var(--text)}
.button.secondary:hover{border-color:var(--line-strong);background:var(--surface)}
.button.secondary[aria-pressed=true]{border-color:var(--text)}
.button.primary{border:1px solid var(--text);background:var(--text);color:var(--bg)}
.button.primary:hover{opacity:.86}
.button:focus-visible,[role=tab]:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
[role=tabpanel]{margin-top:24px}
.variant-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.apply code{padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
.stage{height:640px;min-height:240px;margin-top:16px;overflow:auto;resize:vertical;border:1px solid var(--line-strong);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}
iframe{display:block;width:100%;height:100%;margin:0 auto;border:0;background:#fff}
body[data-frame-width=mobile] iframe{width:390px;border-inline:1px solid var(--line-strong)}
.notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0 32px}
ul{margin:0;padding-left:18px}
.theme{margin-top:56px;padding:20px 24px 24px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:6px 12px 6px 0;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-weight:500;color:var(--muted)}
.swatch{display:inline-block;width:12px;height:12px;margin-right:6px;border:1px solid var(--line-strong);border-radius:3px;vertical-align:-1px}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0;padding:0;list-style:none}
.counts li{padding:4px 12px;border:1px solid var(--line);border-radius:99px;background:var(--surface);color:var(--muted)}
.counts strong{margin-left:4px;color:var(--text)}
.finding{margin-top:12px;padding:14px 18px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.finding p,.finding ul{margin:8px 0 0}
.number{font-variant-numeric:tabular-nums;color:var(--subtle)}
.finding-title{display:inline;margin:0 0 0 8px;font-size:15px;font-weight:600;letter-spacing:-.01em;text-transform:none;color:var(--text)}
.pill.recommended{border-color:var(--text);background:var(--text);color:var(--bg)}
.finding .table-wrap{margin-top:10px}
.pill.error{border-color:var(--red);color:var(--red)}
.pill.warning{border-color:var(--amber);color:var(--amber)}
.pill{margin-left:8px;padding:1px 8px;border:1px solid var(--line);border-radius:99px;background:var(--surface);font-size:11px;color:var(--muted)}
`;
