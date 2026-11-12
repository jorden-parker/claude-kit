export const PAGE_STYLE = `
:root{--bg:#fff;--surface:#fafafa;--panel:#fff;--text:#171717;--muted:#666;--subtle:#8f8f8f;--line:#ebebeb;--line-strong:#d4d4d4;--grid:rgba(0,0,0,.05);--dot:rgba(0,0,0,.09);--blue:#0070f3;--pink:#eb367f;--amber-bright:#f5a623;--green:#0a7c42;--red:#c00;--amber:#8a5a00;--shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px -8px rgba(0,0,0,.08);--ease:cubic-bezier(.2,.8,.2,1)}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--surface:#111;--panel:#0a0a0a;--text:#ededed;--muted:#a1a1a1;--subtle:#7c7c7c;--line:#262626;--line-strong:#3d3d3d;--grid:rgba(255,255,255,.06);--dot:rgba(255,255,255,.1);--blue:#3291ff;--pink:#ff4d94;--amber-bright:#ffb224;--green:#3ecf8e;--red:#ff6166;--amber:#f5a623;--shadow:0 0 0 1px rgba(255,255,255,.02),0 8px 24px -8px rgba(0,0,0,.6)}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Geist","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
::selection{background:var(--blue);color:#fff}
code{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow-wrap:break-word}
[hidden]{display:none!important}
.muted{color:var(--muted)}
main{max-width:1280px;margin:0 auto;padding:0 24px 64px}
.hero{position:relative;padding:72px 0 36px;isolation:isolate}
.hero::before{content:"";position:absolute;inset:0 -24px;z-index:-1;background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:32px 32px;background-position:-1px -1px;-webkit-mask-image:radial-gradient(ellipse 70% 90% at 20% 0%,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse 70% 90% at 20% 0%,#000 30%,transparent 75%)}
.mark{display:inline-flex;color:var(--text)}
.mark svg>*{transform-box:fill-box;transform-origin:center;transition:transform .5s var(--ease),stroke .3s}
.hero .mark{margin-bottom:20px}
.hero .mark svg>*{animation:bob 3.6s var(--ease) infinite}
.hero .mark svg>:nth-child(2){animation-delay:.25s}
.hero .mark svg>:nth-child(3){animation-delay:.5s}
.mark:hover svg>:nth-child(1){stroke:var(--blue);transform:scale(1.15)}
.mark:hover svg>:nth-child(2){stroke:var(--pink);transform:rotate(45deg)}
.mark:hover svg>:nth-child(3){stroke:var(--amber-bright);transform:rotate(180deg)}
@keyframes bob{0%,70%,100%{translate:0 0}80%{translate:0 -3px}90%{translate:0 1px}}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 14px;padding:2px 10px 2px 8px;border:1px solid var(--line);border-radius:99px;background:var(--panel);font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--muted)}
.eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 20%,transparent)}
.hero .mark+.eyebrow{display:flex;width:max-content}
h1{margin:0;font-size:clamp(32px,5vw,56px);line-height:1.05;font-weight:700;letter-spacing:-.055em;overflow-wrap:anywhere}
h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.03em;overflow-wrap:anywhere}
h3,h4{margin:24px 0 8px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--subtle)}
.hero p.muted{margin:14px 0 0;font-size:16px;max-width:68ch}
.tagline{margin:6px 0 0;font-size:14px;color:var(--subtle)}
.toolbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 82%,transparent);-webkit-backdrop-filter:saturate(1.8) blur(10px);backdrop-filter:saturate(1.8) blur(10px)}
[role=tablist],.toggles,.apply{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
[role=tablist]{gap:2px;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
[role=tab]{font:inherit;font-weight:500;height:32px;padding:0 14px;border:0;border-radius:7px;background:none;color:var(--muted);cursor:pointer;white-space:nowrap;transition:color .2s,background-color .2s,box-shadow .2s}
[role=tab]:hover{color:var(--text)}
[role=tab][aria-selected=true]{background:var(--panel);color:var(--text);box-shadow:0 0 0 1px var(--line-strong),0 1px 2px rgba(0,0,0,.06)}
.button{font:inherit;font-weight:500;height:36px;padding:0 14px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background-color .2s,border-color .2s,opacity .2s,transform .15s var(--ease)}
.button:active{transform:scale(.97)}
.button.secondary{border:1px solid var(--line);background:var(--panel);color:var(--text)}
.button.secondary:hover{border-color:var(--line-strong);background:var(--surface)}
.button.secondary[aria-pressed=true]{border-color:var(--text);background:var(--surface)}
.button.primary{border:1px solid var(--text);background:var(--text);color:var(--bg)}
.button.primary:hover{opacity:.86}
.button.primary::after{content:"→";display:inline-block;margin-left:6px;transition:translate .2s var(--ease)}
.button.primary:hover::after{translate:3px 0}
.button:focus-visible,[role=tab]:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
#copy-status{margin:12px 0 0;min-height:22px;font-size:13px}
#copy-status:not(:empty){color:var(--green);animation:pop .35s var(--ease)}
#copy-status:not(:empty)::before{content:"✓ "}
@keyframes pop{from{opacity:0;translate:0 4px}}
[role=tabpanel]{margin-top:16px;animation:rise .35s var(--ease)}
@keyframes rise{from{opacity:0;translate:0 6px}}
.variant-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.variant-head+.muted{margin:8px 0 0;max-width:72ch}
.apply code{display:inline-flex;align-items:center;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted)}
.apply code::before{content:"$ ";white-space:pre;color:var(--subtle)}
.window{margin-top:20px;overflow:hidden;border:1px solid var(--line-strong);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.window-bar{position:relative;display:flex;align-items:center;height:40px;padding:0 14px;border-bottom:1px solid var(--line);background:var(--surface)}
.lights{display:flex;gap:6px}
.lights i{width:10px;height:10px;border-radius:50%;background:var(--line-strong);transition:background-color .3s}
.window:hover .lights i:nth-child(1){background:#ff5f57}
.window:hover .lights i:nth-child(2){background:#febc2e}
.window:hover .lights i:nth-child(3){background:#28c840}
.address{position:absolute;left:50%;translate:-50% 0;max-width:calc(100% - 120px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 14px;border:1px solid var(--line);border-radius:6px;background:var(--panel);font:12px/1.5 "Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.stage{height:var(--stage-height,640px);overflow:auto;background-color:var(--surface);background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:16px 16px}
iframe{display:block;width:100%;height:100%;margin:0 auto;border:0;background:#fff;transition:width .4s var(--ease)}
body[data-frame-width=mobile] iframe{width:390px;border-inline:1px solid var(--line-strong);box-shadow:0 0 0 6px var(--surface),0 12px 32px -12px rgba(0,0,0,.25)}
.resizer{position:relative;display:grid;place-items:center;height:20px;border-top:1px solid var(--line);background:var(--surface);cursor:row-resize;touch-action:none;outline:none;-webkit-user-select:none;user-select:none}
.resizer::before{content:"";position:absolute;inset:-8px 0 -4px}
.grip{width:36px;height:4px;border-radius:99px;background:var(--line-strong);transition:width .25s var(--ease),background-color .2s,box-shadow .2s}
.resizer:hover .grip,body[data-resizing] .grip{width:64px;background:var(--text)}
.resizer:focus-visible .grip{width:64px;background:var(--blue);box-shadow:0 0 0 4px color-mix(in srgb,var(--blue) 25%,transparent)}
.resizer[data-edge=min] .grip,.resizer[data-edge=max] .grip{background:var(--amber-bright)}
.resizer::after{content:attr(aria-valuenow) "px";position:absolute;bottom:calc(100% + 10px);left:50%;padding:2px 8px;border-radius:6px;background:var(--text);color:var(--bg);font:500 11px/1.6 "Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;box-shadow:0 0 0 1px var(--line-strong),0 4px 12px rgba(0,0,0,.18);pointer-events:none;opacity:0;translate:-50% 4px;transition:opacity .15s,translate .2s var(--ease)}
.resizer[data-edge=min]::after{content:attr(aria-valuenow) "px · cozy"}
.resizer[data-edge=max]::after{content:attr(aria-valuenow) "px · roomy"}
.resizer:hover::after,.resizer:focus-visible::after,body[data-resizing] .resizer::after{opacity:1;translate:-50% 0}
body[data-resizing]{cursor:row-resize;-webkit-user-select:none;user-select:none}
body[data-resizing] iframe{pointer-events:none}
.notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0 32px}
ul{margin:0;padding-left:18px}
li::marker{color:var(--subtle)}
.theme{margin-top:72px;padding:24px 28px 28px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 12px 8px 0;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
tbody tr{transition:background-color .15s}
tbody tr:hover{background:var(--surface)}
th{font-weight:500;color:var(--muted)}
.swatch{display:inline-block;width:14px;height:14px;margin-right:8px;border:1px solid var(--line-strong);border-radius:50%;vertical-align:-2px;transition:transform .2s var(--ease)}
tr:hover .swatch,p:hover>.swatch{transform:scale(1.35)}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0;padding:0;list-style:none}
.counts li{padding:4px 12px;border:1px solid var(--line);border-radius:99px;background:var(--surface);color:var(--muted)}
.counts strong{margin-left:4px;color:var(--text)}
.finding{margin-top:12px;padding:16px 20px 18px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);transition:border-color .2s}
.finding:hover{border-color:var(--line-strong)}
.finding p,.finding ul{margin:8px 0 0}
.number{font-variant-numeric:tabular-nums;color:var(--subtle)}
.finding-title{display:inline;margin:0 0 0 8px;font-size:15px;font-weight:600;letter-spacing:-.01em;text-transform:none;color:var(--text)}
.pill.recommended{border-color:var(--text);background:var(--text);color:var(--bg)}
.finding .table-wrap{margin-top:10px}
.pill.error{border-color:var(--red);color:var(--red)}
.pill.warning{border-color:var(--amber);color:var(--amber)}
.pill{margin-left:8px;padding:1px 8px;border:1px solid var(--line);border-radius:99px;background:var(--surface);font-size:11px;color:var(--muted)}
.signoff{text-align:center;margin-top:72px;padding-top:24px;border-top:1px solid var(--line);font-size:13px;color:var(--subtle)}
.signoff .mark{margin-right:10px;vertical-align:-3px;color:var(--subtle)}
@media (max-width:640px){.hero{padding-top:48px}.toolbar{position:static}.address{display:none}body[data-frame-width=mobile] iframe{width:100%}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
