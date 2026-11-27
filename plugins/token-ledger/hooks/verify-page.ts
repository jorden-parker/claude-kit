import { html } from "./checkin-form.ts";
import { answer, groupValues, rows, scale } from "./checkins.ts";
import type { SessionGroup } from "./ledger.ts";

export function verifyPage(check?: {
  title: string;
  since: string;
  before: SessionGroup;
  after: SessionGroup;
}) {
  const cell = (index: number, value?: number) =>
    "<td><strong>" +
    answer(index, value).code +
    "</strong><small>" +
    (value === undefined ? "Unknown" : value.toLocaleString("en-US")) +
    "</small></td>";
  let content =
    '<p>No deployments recorded yet. Run <code>claude-ledger --fixed "description"</code> when a change reaches this machine.</p>';
  if (check) {
    const after = groupValues(check.after);
    content =
      '<p class="deployment">' +
      html(check.title) +
      " · " +
      html(check.since.slice(0, 10)) +
      "</p>" +
      "<p>On your personal laptop, open <code>claude-ledger</code> and choose <b>Record work results</b>. Select the matching codes for each column.</p>" +
      "<table><caption>Work-machine readings · " +
      scale +
      "</caption><thead><tr><th>Measurement</th><th>Before<small>" +
      check.before.sessions +
      " sessions</small></th><th>After<small>" +
      check.after.sessions +
      " sessions</small></th></tr></thead><tbody>" +
      groupValues(check.before)
        .map(
          (value, index) =>
            '<tr><th scope="row">' +
            html(rows[index].title) +
            "</th>" +
            cell(index, value) +
            cell(index, after[index]) +
            "</tr>"
        )
        .join("") +
      "</tbody></table>" +
      (check.after.sessions < 5
        ? '<p class="note">Fewer than five follow-up sessions. Save the baseline now and check again after more sessions.</p>'
        : "");
  }
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Token Ledger · Deployment check-in</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#171717;font:16px/1.5 "Geist",system-ui,sans-serif}header{border-bottom:1px solid #ddd;background:white;padding:14px max(5vw,20px);font-weight:650}main{max-width:800px;margin:36px auto;padding:0 20px}h1{font-size:clamp(28px,5vw,44px);letter-spacing:-.055em;margin:0}p{max-width:64ch}.deployment,small{color:#565656}.deployment{font-family:ui-monospace,monospace;overflow-wrap:anywhere}table{width:100%;background:white;border:1px solid #ddd;border-spacing:0;border-radius:10px;overflow:hidden}caption{text-align:left;font-weight:600;padding:6px 0}th,td{text-align:left;padding:7px clamp(7px,2vw,18px);border-bottom:1px solid #eee}thead{background:#f3f3f3}tbody th{font-size:14px;font-weight:550}tr:last-child td,tr:last-child th{border-bottom:0}strong{font:650 20px/1.1 ui-monospace,monospace}small{display:block;font:12px/1.5 ui-monospace,monospace}.note{border-left:3px solid #888;padding-left:12px;font-size:14px}</style><header>Token Ledger</header><main><h1>Deployment check-in</h1>${content}</main></html>`;
}
