import { geistStyle, productHeader } from "./geist-style.ts";
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
    '<td><strong class="transfer-code">' +
    answer(index, value).code +
    '</strong><span class="reading">' +
    (value === undefined ? "Unknown" : value.toLocaleString("en-US")) +
    "</span></td>";
  let content =
    '<p>No deployments recorded yet. Run <code>claude-ledger --fixed "description"</code> when a change reaches this machine.</p>';
  if (check) {
    const after = groupValues(check.after);
    const excluded = check.spanningSessions ?? 0;
    content =
      '<section class="panel"><div class="panel-heading"><div><h2>Laptop check-in</h2><p>On your personal laptop, open <code>claude-ledger</code>, choose <b>Record work results</b> and select these codes.</p></div></div><div class="table-scroll"><table><caption class="sr-only">Work-machine readings · ' +
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
      '</tbody></table></div><p class="panel-footer">Source: all locally recorded sessions across projects, including subagent totals, filtered to the selected model mix. Excludes ' +
      excluded +
      " sessions spanning deployment or missing a start time. Sessions on other machines have separate reports.</p></section>" +
      (check.after.sessions < 5
        ? '<p class="note">Fewer than five follow-up sessions. Save the baseline now and check again after more sessions.</p>'
        : "");
  }
  const models = check?.models;
  const number = (value: number | undefined) =>
    value === undefined ? "Unknown" : Math.round(value * 100) / 100 + "";
  const names = (values: string[], fallback: string) =>
    values
      .map((name) => '<span class="model-name">' + html(name) + "</span>")
      .join("") || fallback;
  const modelTable = models
    ? '<section class="panel"><div class="panel-heading"><div><h2>Models by deployment period</h2><p>Session counts for each main and worker model combination.</p></div></div><div class="table-scroll"><table class="model-table"><thead><tr><th>Main models</th><th>Worker models</th><th class="number">Before</th><th class="number">After</th></tr></thead><tbody>' +
      [...models.distribution]
        .sort(
          (a, b) =>
            Number(b.selected) - Number(a.selected) ||
            b.after - a.after ||
            b.before - a.before
        )
        .map(
          (row) =>
            '<tr><th scope="row">' +
            names(row.main, "Unknown") +
            (row.selected ? '<span class="badge">Selected</span>' : "") +
            "</th><td>" +
            names(row.workers, "None recorded") +
            '</td><td class="number">' +
            row.before +
            '</td><td class="number">' +
            row.after +
            "</td></tr>"
        )
        .join("") +
      "</tbody></table></div></section>"
    : "";
  const fairness = models
    ? '<section class="notice"><div><h2>Comparison limits</h2><p>' +
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
      " After.</p></div></section>" +
      modelTable +
      content +
      '<section class="panel"><div class="panel-heading"><div><h2>Session length and measurement coverage</h2><p>Reasoning effort, workload and billing route can differ within a model mix. Per-call readings alone do not establish savings.</p></div></div><div class="table-scroll"><table><thead><tr><th>Measurement</th><th>Before</th><th>After</th></tr></thead><tbody>' +
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
      "</tbody></table></div></section>"
    : content;
  const picker = deployments
    ? '<form class="filters" method="get"><div class="field"><label for="deployment">Compare since</label> <select id="deployment" name="deployment" onchange="this.form.submit()">' +
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
      "</select></div>" +
      (models
        ? '<div class="field"><label for="cohort"> Model mix </label><select id="cohort" name="cohort">' +
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
          "</select></div>"
        : "") +
      '<button class="primary" type="submit">Use comparison</button><p class="filter-note">Keep the original cost-change deployment selected when installing report updates.</p></form>'
    : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Token Ledger · Deployment check-in</title><style>${geistStyle}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.transfer-code{margin:0 12px 0 0;color:var(--ds-gray-1000);font-weight:600}.model-table th:first-child{width:34%}.reading{display:inline-block}.note{margin:-12px 0 24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.panel-heading code{white-space:nowrap}</style>${productHeader("Verification", live)}<main><a class="button" href="?view=usage">Session usage</a><div class="page-heading"><div><h1>Deployment check-in</h1>${check ? "<p>" + html(check.title) + " · " + html(check.since.slice(0, 10)) + "</p>" : ""}</div></div>${picker}${fairness}${diagnostics ? '<details class="details" id="recording"><summary>Recording status</summary><div class="details-body"><pre>' + html(formatRecordingStatus(diagnostics)) + "</pre></div></details>" : ""}</main>${live ? "<script>" + liveVerifyScript + "</script>" : ""}</html>`;
}

export const liveVerifyScript = `
const status = document.getElementById("live-status");
let scheduled;
let refreshing = false;
async function refreshReadings() {
  if (refreshing) return;
  refreshing = true;
  if (scheduled) clearTimeout(scheduled);
  try {
    if (document.hidden) return;
    const response = await fetch(location.href, { cache: "no-store" });
    if (!response.ok) throw new Error("Report unavailable");
    const next = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("main");
    const current = document.querySelector("main");
    if (!next || !current) throw new Error("Invalid report");
    if (next.innerHTML !== current.innerHTML && !getSelection()?.toString() && document.activeElement?.tagName !== "SELECT") {
      const expanded = document.getElementById("recording")?.open;
      current.innerHTML = next.innerHTML;
      const recording = document.getElementById("recording");
      if (recording && expanded) recording.open = true;
    }
    status.textContent = "Live · checks for new recorded results every 2 seconds";
  } catch {
    status.textContent = "Disconnected · showing last results; retrying automatically. Keep claude-ledger verify browser running.";
  } finally { refreshing=false; scheduled=setTimeout(refreshReadings, 2000); }
}
if (typeof EventSource !== "undefined" && document.querySelector(".usage")) {
  const events = new EventSource(location.pathname + "/events");
  events.addEventListener("usage", refreshReadings);
}
scheduled=setTimeout(refreshReadings, 2000);
`;
