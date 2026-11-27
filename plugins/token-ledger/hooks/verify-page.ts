import type { compareModelCohorts } from "./model-comparison.ts";
import {
  formatRecordingStatus,
  type recordingStatus,
} from "./recording-status.ts";
import { html } from "./checkin-form.ts";
import { answer, groupValues, rows, scale } from "./checkins.ts";
import type { SessionGroup } from "./ledger.ts";

export function verifyPage(
  check?: {
    title: string;
    since: string;
    before: SessionGroup;
    after: SessionGroup;
    spanningSessions?: number;
    models?: ReturnType<typeof compareModelCohorts>;
  },
  live = false,
  diagnostics?: ReturnType<typeof recordingStatus>,
  deployments?: {
    selected: string;
    options: { title: string; since: string }[];
  }
) {
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
    const excluded = check.spanningSessions ?? 0;
    content =
      '<p class="deployment">' +
      html(check.title) +
      " · " +
      html(check.since.slice(0, 10)) +
      "</p>" +
      "<p>On your personal laptop, open <code>claude-ledger</code> and choose <b>Record work results</b>. Select the matching codes for each column.</p>" +
      "<p>Source: all locally recorded sessions across projects, including subagent totals. When model matching is shown above, the readings below use only that selected model mix. Excludes " +
      excluded +
      " sessions spanning deployment or missing a start time. Sessions on other machines are not included automatically.</p>" +
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
  const models = check?.models;
  const number = (value: number | undefined) =>
    value === undefined ? "Unknown" : Math.round(value * 100) / 100 + "";
  const fairness = models
    ? '<section><h2>Comparison limits</h2><p class="note">' +
      (models.enough
        ? "Descriptive comparison only. Model matching and five sessions per side do not establish that the plugin caused a change."
        : "Insufficient comparable data. At least five sessions on each side with the same recorded main and worker model mix are needed for a descriptive summary.") +
      "</p><p>All recorded samples: " +
      models.allBefore +
      " Before, " +
      models.allAfter +
      " After. Matched model mix: " +
      models.before.sessions +
      " Before, " +
      models.after.sessions +
      " After.</p><p>" +
      html(models.selected?.label ?? "No model data") +
      "</p><p>Reasoning effort, provider/billing route and workload are not reliably recorded in these sessions. Task size and completed-task quality are uncontrolled. Per-call tokens reduce session-length bias; they do not establish savings.</p><table><caption>Session length and measurement coverage</caption><thead><tr><th>Measurement</th><th>Before</th><th>After</th></tr></thead><tbody>" +
      [
        [
          "Sessions with complete per-call measurements",
          models.normalizedBefore.sessionsMeasured,
          models.normalizedAfter.sessionsMeasured,
        ],
        [
          "Median model calls per measured session",
          models.normalizedBefore.medianCalls,
          models.normalizedAfter.medianCalls,
        ],
        [
          "Median tokens per model call",
          models.normalizedBefore.medianTokensPerCall,
          models.normalizedAfter.medianTokensPerCall,
        ],
        [
          "Median recorded session duration (minutes)",
          models.normalizedBefore.medianMinutes,
          models.normalizedAfter.medianMinutes,
        ],
        [
          "Sessions still working through tools",
          models.normalizedBefore.working,
          models.normalizedAfter.working,
        ],
        [
          "Sessions whose latest response finished",
          models.normalizedBefore.responseFinished,
          models.normalizedAfter.responseFinished,
        ],
        [
          "Sessions with unknown response state",
          models.before.sessions -
            models.normalizedBefore.working -
            models.normalizedBefore.responseFinished,
          models.after.sessions -
            models.normalizedAfter.working -
            models.normalizedAfter.responseFinished,
        ],
        [
          "Median estimated session cost (configured currency)",
          models.normalizedBefore.medianEstimatedCost,
          models.normalizedAfter.medianEstimatedCost,
        ],
      ]
        .map(
          ([label, before, after]) =>
            "<tr><th>" +
            label +
            "</th><td>" +
            number(before as number | undefined) +
            "</td><td>" +
            number(after as number | undefined) +
            "</td></tr>"
        )
        .join("") +
      "</tbody></table><details><summary>Recorded model mix in each period</summary><ul>" +
      models.distribution
        .map(
          (row) =>
            "<li>" +
            html(row.label) +
            ": " +
            row.before +
            " Before, " +
            row.after +
            " After</li>"
        )
        .join("") +
      "</ul></details></section>"
    : "";
  const picker = deployments
    ? '<form method="get"><label for="deployment">Compare since</label> <select id="deployment" name="deployment" onchange="this.form.submit()">' +
      deployments.options
        .map(
          (option) =>
            '<option value="' +
            html(option.since) +
            '"' +
            (option.since === deployments.selected ? " selected" : "") +
            ">" +
            html(option.title + " · " + option.since) +
            "</option>"
        )
        .join("") +
      "</select>" +
      (models
        ? '<label for="cohort"> Model mix </label><select id="cohort" name="cohort">' +
          models.options
            .map(
              (option) =>
                '<option value="' +
                html(option.key) +
                '"' +
                (option.key === models.selected?.key ? " selected" : "") +
                ">" +
                html(option.label) +
                "</option>"
            )
            .join("") +
          "</select>"
        : "") +
      '<button type="submit">Use comparison</button><p>Keep the original cost-change deployment selected when installing report updates.</p></form>'
    : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Token Ledger · Deployment check-in</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#171717;font:16px/1.5 "Geist",system-ui,sans-serif}header{border-bottom:1px solid #ddd;background:white;padding:14px max(5vw,20px);font-weight:650}main{max-width:800px;margin:36px auto;padding:0 20px}h1{font-size:clamp(28px,5vw,44px);letter-spacing:-.055em;margin:0}p{max-width:64ch}.deployment,small{color:#565656}.deployment{font-family:ui-monospace,monospace;overflow-wrap:anywhere}table{width:100%;background:white;border:1px solid #ddd;border-spacing:0;border-radius:10px;overflow:hidden}caption{text-align:left;font-weight:600;padding:6px 0}th,td{text-align:left;padding:7px clamp(7px,2vw,18px);border-bottom:1px solid #eee}thead{background:#f3f3f3}tbody th{font-size:14px;font-weight:550}tr:last-child td,tr:last-child th{border-bottom:0}strong{font:650 20px/1.1 ui-monospace,monospace}small{display:block;font:12px/1.5 ui-monospace,monospace}.note{border-left:3px solid #888;padding-left:12px;font-size:14px}</style><header>Token Ledger${live ? '<p id="live-status" role="status" aria-live="polite">Live · checks for new recorded results every 2 seconds</p>' : ""}</header><main><h1>Deployment check-in</h1>${picker}${fairness}${content}${diagnostics ? '<section aria-labelledby="recording-title"><h2 id="recording-title">Recording status</h2><p>Tell me the D-code below; no terminal output is needed.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">' + html(formatRecordingStatus(diagnostics)) + "</pre></section>" : ""}</main>${live ? "<script>" + liveVerifyScript + "</script>" : ""}</html>`;
}

export const liveVerifyScript = `
const status = document.getElementById("live-status");
async function refreshReadings() {
  try {
    if (document.hidden) return;
    const response = await fetch(location.href, { cache: "no-store" });
    if (!response.ok) throw new Error("Report unavailable");
    const next = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("main");
    const current = document.querySelector("main");
    if (!next || !current) throw new Error("Invalid report");
    if (next.innerHTML !== current.innerHTML && !getSelection()?.toString() && document.activeElement?.tagName !== "SELECT") current.innerHTML = next.innerHTML;
    status.textContent = "Live · checks for new recorded results every 2 seconds";
  } catch {
    status.textContent = "Disconnected · showing last results; retrying automatically. Keep claude-ledger verify browser running.";
  } finally { setTimeout(refreshReadings, 2000); }
}
setTimeout(refreshReadings, 2000);
`;
