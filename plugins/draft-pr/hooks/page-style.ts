export const PAGE_STYLE = `
:root{--bg:#fff;--surface:#fafafa;--panel:#fff;--text:#171717;--muted:#666;--subtle:#8f8f8f;--line:#ebebeb;--line-strong:#d4d4d4;--ring:rgba(0,0,0,.08);--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.04);--lift:0 8px 30px rgba(0,0,0,.12);--red:#e5484d;--amber:#f5a524;--green:#45a557;--blue:#0070f3;--teal:#12a594;--purple:#8e4ec6;--pink:#d6409f;--gray:#8f8f8f;--added:rgba(69,165,87,.14);--removed:rgba(229,72,77,.12);--error-surface:rgba(229,72,77,.06);--success-surface:rgba(69,165,87,.07);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--surface:#111;--panel:#0a0a0a;--text:#ededed;--muted:#a1a1a1;--subtle:#7c7c7c;--line:#262626;--line-strong:#3d3d3d;--ring:rgba(255,255,255,.1);--shadow:0 0 0 1px rgba(255,255,255,.02);--lift:0 8px 30px rgba(0,0,0,.6);--red:#ff6369;--amber:#ffb224;--green:#62c073;--blue:#3291ff;--teal:#0ac5b3;--purple:#bf7af0;--pink:#f76ac0;--gray:#7c7c7c;--added:rgba(98,192,115,.16);--removed:rgba(255,99,105,.16);--error-surface:rgba(255,99,105,.08);--success-surface:rgba(98,192,115,.08);color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Geist","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
code,pre,kbd,.mono,.count,.location,textarea.source{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}
.is-hidden{display:none!important}
.muted{color:var(--muted)}
.topbar{position:sticky;top:0;z-index:5;min-height:56px;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 24px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:saturate(180%) blur(8px)}
.mark{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,var(--text),var(--subtle));flex:none}
.crumb{color:var(--muted)}
.slash{color:var(--line-strong);font-size:20px;font-weight:200}
.topbar strong{font-weight:500}
.topbar-actions{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:99px;border:1px solid var(--line);background:var(--surface);font-size:12px;color:var(--muted);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--gray)}
.tone-red{background:var(--red)}.tone-amber{background:var(--amber)}.tone-green{background:var(--green)}.tone-blue{background:var(--blue)}.tone-teal{background:var(--teal)}.tone-purple{background:var(--purple)}.tone-pink{background:var(--pink)}.tone-gray{background:var(--gray)}
.button{font:inherit;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,opacity .15s,color .15s}
.button.secondary{border:1px solid var(--line);background:var(--panel);color:var(--text)}
.button.secondary:hover{border-color:var(--line-strong);background:var(--surface)}
.button.primary{border:1px solid var(--text);background:var(--text);color:var(--bg)}
.button.primary:hover{opacity:.86}
.button:disabled{opacity:.45;cursor:not-allowed}
.button:focus-visible,.tab:focus-visible,.chip:focus-visible,.link:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.link{font:inherit;font-size:13px;padding:0;border:0;background:none;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.link:hover{color:var(--text)}
.confirm{position:sticky;top:64px;z-index:4;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;max-width:1152px;margin:16px auto 0;padding:12px 12px 12px 16px;border:1px solid var(--line-strong);border-radius:12px;background:var(--panel);box-shadow:var(--lift)}
.confirm p{margin:0;flex:1;min-width:240px}
.confirm-actions{display:flex;gap:8px}
.notice{display:flex;gap:12px;align-items:flex-start;max-width:1152px;margin:16px auto 0;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.notice .dot{margin-top:7px}
.notice p{margin:0}
.notice pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font-size:12px;color:var(--muted)}
.notice.is-error{border-color:color-mix(in srgb,var(--red) 40%,var(--line));background:var(--error-surface)}
.notice.is-success{border-color:color-mix(in srgb,var(--green) 40%,var(--line));background:var(--success-surface)}
.notice-body{flex:1;min-width:0}
main{max-width:1200px;margin:0 auto;padding:40px 24px 120px}
main.is-narrow{max-width:920px}
.eyebrow{margin:0 0 8px;font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--subtle)}
.hero h1{margin:0;font-size:32px;line-height:1.15;font-weight:600;letter-spacing:-.04em;overflow-wrap:anywhere}
.hero p.muted{margin:10px 0 0;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.branch{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--muted)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px;align-items:start;margin-top:32px}
.side-column{position:sticky;top:80px;display:flex;flex-direction:column;gap:16px}
.field{display:block;margin-bottom:20px}
.field-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;font-size:13px;font-weight:500}
.field-row{display:flex;gap:8px}
.field-row .button{height:40px}
.count{font-size:12px;font-weight:400;color:var(--subtle)}
input[type=text],select{font:inherit;width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);transition:border-color .15s,box-shadow .15s}
input[type=text]:hover,select:hover{border-color:var(--line-strong)}
input[type=text]:focus,select:focus,textarea:focus{outline:0;border-color:var(--text);box-shadow:0 0 0 4px var(--ring)}
#pr-title{font-size:16px;font-weight:500;letter-spacing:-.01em}
textarea{font:inherit;display:block;width:100%;padding:12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);resize:vertical;transition:border-color .15s,box-shadow .15s}
textarea.source{font-size:13px;line-height:1.65;tab-size:2}
.panel{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:48px;padding:8px 8px 8px 16px;border-bottom:1px solid var(--line)}
.panel-head h2{margin:0;font-size:14px;font-weight:600}
.panel-head .count{padding-right:8px}
.panel-tools{display:flex;align-items:center;gap:8px}
.panel-note{margin:0;padding:12px 16px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.tabs{display:flex;flex-wrap:wrap;gap:4px}
.tab{font:inherit;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer;transition:background .15s,color .15s}
.tab:hover{background:var(--surface);color:var(--text)}
.tab.is-active{background:var(--surface);color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.editor{display:grid;grid-template-columns:minmax(0,1fr)}
.editor textarea{min-height:520px;border:0;border-radius:0 0 12px 12px;padding:16px}
.editor textarea:focus{box-shadow:inset 0 0 0 1px var(--text)}
.editor .markdown{padding:16px 20px;min-height:200px}
.editor.is-split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.editor.is-split textarea{border-right:1px solid var(--line);border-radius:0 0 0 12px;resize:none;height:100%}
.editor.is-write .markdown,.editor.is-preview textarea{display:none}
.markdown{overflow-wrap:anywhere}
.markdown>:first-child{margin-top:0}
.markdown>:last-child{margin-bottom:0}
.markdown h1,.markdown h2,.markdown h3,.markdown h4{margin:20px 0 8px;line-height:1.3;font-weight:600;letter-spacing:-.02em}
.markdown h1{font-size:22px}.markdown h2{font-size:18px;padding-bottom:6px;border-bottom:1px solid var(--line)}.markdown h3{font-size:15px}.markdown h4{font-size:14px}
.markdown p{margin:0 0 12px}
.markdown ul,.markdown ol{margin:0 0 12px;padding-left:22px}
.markdown li{margin:2px 0}
.markdown li.task{list-style:none;margin-left:-20px;display:flex;gap:8px;align-items:baseline}
.markdown li.indent-1{margin-left:20px}.markdown li.indent-2{margin-left:40px}.markdown li.indent-3{margin-left:60px}
.markdown li.task.indent-1{margin-left:0}.markdown li.task.indent-2{margin-left:20px}.markdown li.task.indent-3{margin-left:40px}
.markdown code{font-size:12.5px;padding:2px 5px;border-radius:4px;background:var(--surface);border:1px solid var(--line)}
.markdown pre{margin:0 0 12px;padding:12px 14px;border-radius:8px;background:var(--surface);border:1px solid var(--line);overflow:auto}
.markdown pre code{padding:0;border:0;background:none;line-height:1.6}
.markdown blockquote{margin:0 0 12px;padding:2px 14px;border-left:3px solid var(--line-strong);color:var(--muted)}
.markdown hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.markdown table{border-collapse:collapse;margin:0 0 12px;display:block;overflow:auto}
.markdown th,.markdown td{padding:6px 12px;border:1px solid var(--line);text-align:left}
.markdown th{background:var(--surface);font-weight:600}
.markdown .empty{color:var(--subtle);font-style:italic}
input[type=checkbox],input[type=radio]{width:15px;height:15px;margin:0;accent-color:var(--text);cursor:pointer;flex:none}
.toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);cursor:pointer;user-select:none}
.toggle:hover{color:var(--text)}
.sections{list-style:none;margin:0;padding:6px 0}
.sections li{display:flex;align-items:center;gap:10px;padding:7px 16px;font-size:13px}
.sections li .state{margin-left:auto;font-size:12px;color:var(--subtle)}
.details{margin:0;padding:6px 0}
.details div{display:flex;justify-content:space-between;gap:12px;padding:7px 16px;font-size:13px}
.details dt{color:var(--muted)}
.details dd{margin:0;min-width:0;overflow-wrap:anywhere;text-align:right}
.details code{font-size:12px}
.panel-foot{padding:12px 16px;border-top:1px solid var(--line)}
.shortcuts{margin:0;padding:12px 16px;font-size:13px;color:var(--muted);display:flex;flex-direction:column;gap:6px}
.shortcuts span{display:flex;justify-content:space-between;gap:8px}
kbd{font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid var(--line);background:var(--surface);color:var(--text)}
.stats{margin:28px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
.stat{padding:14px 20px;display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--line);margin-right:-1px}
.stat .muted{font-size:13px}
.stat strong{font-size:24px;font-weight:600;letter-spacing:-.02em}
.summary textarea{min-height:120px;border:0;border-radius:0;padding:16px}
.summary textarea:focus{box-shadow:inset 0 0 0 1px var(--text)}
.summary .markdown{padding:16px 20px}
.events{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-top:1px solid var(--line);background:var(--surface);border-radius:0 0 12px 12px}
.event{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);font-size:13px;cursor:pointer;user-select:none;transition:border-color .15s}
.event:hover{border-color:var(--line-strong)}
.event:has(input:checked){border-color:var(--text);box-shadow:0 0 0 1px var(--text)}
.toolbar{position:sticky;top:56px;z-index:3;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-top:32px;padding:12px 0;background:var(--bg);border-bottom:1px solid var(--line)}
.file-group{margin-top:28px}
.file-group>h2{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:13px;font-weight:500}
.file-path{font-size:13px;overflow-wrap:anywhere}
.file-group>h2 .count{padding:1px 8px;border-radius:99px;border:1px solid var(--line)}
.comment{margin-bottom:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);transition:border-color .15s,opacity .15s}
.comment:hover{border-color:var(--line-strong)}
.comment.is-excluded{opacity:.5}
.comment-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px}
.badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:99px;background:var(--surface);border:1px solid var(--line);font-size:12px;font-weight:500}
.badge.is-blocking{border-color:color-mix(in srgb,var(--red) 50%,var(--line));color:var(--red)}
.location{font-size:12px;color:var(--subtle)}
.comment-top .toggle{margin-left:auto}
.diff{margin:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface);font-size:12px;line-height:1.7;overflow:auto}
.diff-line{display:flex;min-width:max-content}
.diff-line.is-added{background:var(--added)}
.diff-line.is-removed{background:var(--removed)}
.line-number{flex:none;width:52px;padding:0 10px;text-align:right;color:var(--subtle);user-select:none}
.marker{flex:none;width:16px;color:var(--subtle);user-select:none}
.code{white-space:pre;padding-right:16px}
.comment-preview{padding:14px 16px}
.comment-form{display:grid;gap:10px;padding:14px 16px;border-top:1px solid var(--line);background:var(--surface)}
.form-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.form-row select{width:auto;min-width:150px;height:32px}
.comment-form input[type=text]{height:36px}
.comment-form textarea{min-height:96px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:inherit;font-size:12px;height:26px;padding:0 10px;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s,background .15s}
.chip:hover{border-color:var(--line-strong);color:var(--text)}
.chip[aria-pressed=true]{border-color:var(--text);background:var(--text);color:var(--bg)}
.card-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:var(--surface);border-radius:0 0 12px 12px}
#toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);z-index:6;padding:8px 14px;border-radius:8px;background:var(--text);color:var(--bg);font-size:13px;font-weight:500;box-shadow:var(--lift);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
#toast.is-shown{opacity:1;transform:translate(-50%,0)}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}.side-column{position:static}.editor.is-split{grid-template-columns:minmax(0,1fr)}.editor.is-split textarea{border-right:0;border-bottom:1px solid var(--line);border-radius:0;min-height:320px}}
@media (max-width:640px){main{padding:28px 16px 120px}.topbar{padding:8px 16px}.hero h1{font-size:26px}.confirm,.notice{margin-left:16px;margin-right:16px}}
`;
