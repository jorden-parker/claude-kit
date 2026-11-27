import { dayPicker } from "./daily-page.ts";
import type { ExternalUsage } from "./codeburn-usage.ts";
import type { LedgerEntry } from "./ledger.ts";
import type { Rates, RequestUsage } from "./usage-metrics.ts";
import { html } from "./checkin-form.ts";
import { geistStyle, productHeader } from "./geist-style.ts";
import { liveVerifyScript } from "./verify-page.ts";

const fields = ["input", "cacheWrite", "cacheRead", "output"] as const;
type Metric = number | undefined;
type UsageRow = {
  model: string;
  role: string;
  sessions: number;
  calls: Metric;
  cost: Metric;
  costIssues: Set<string>;
  tokens: Record<keyof Rates, Metric>;
};
function add(a: Metric, b: Metric) {
  return a === undefined || b === undefined ? undefined : a + b;
}
function price(request: RequestUsage, rates: Record<string, Rates>) {
  const rate = rates[request.resolvedModel];
  if (!rate || fields.some((field) => request[field] === undefined))
    return undefined;
  return (
    fields.reduce((cost, field) => cost + rate[field] * request[field]!, 0) /
    1_000_000
  );
}

export function usageSample(
  entries: LedgerEntry[],
  rates: Record<string, Rates>
) {
  const rows = new Map<string, UsageRow>();
  const costs: number[] = [],
    finishedCosts: number[] = [];
  let finished = 0;
  for (const entry of entries) {
    let sessionCost: Metric = 0;
    let observed = false;
    const workers = entry.workerTasks?.flat();
    if (
      entry.workerTasks === undefined ||
      (entry.tasks?.some((task) => task.workerCalls > 0) &&
        !workers?.some((task) => task.requests.length))
    )
      sessionCost = undefined;
    for (const [role, tasks, legacy] of [
      ["Main", entry.tasks, entry.main],
      ["Worker", workers, entry.subagents],
    ] as const) {
      const grouped = new Map<string, RequestUsage[]>();
      for (const request of tasks?.flatMap((task) => task.requests) ?? []) {
        const requests = grouped.get(request.resolvedModel) ?? [];
        requests.push(request);
        grouped.set(request.resolvedModel, requests);
      }
      const models = new Set([
        ...grouped.keys(),
        ...Object.keys(legacy).filter((model) =>
          fields.some((field) => legacy[model][field] > 0)
        ),
      ]);
      if (role === "Main" && !models.size) sessionCost = undefined;
      for (const model of models) {
        observed = true;
        const requests = grouped.get(model);
        const key = JSON.stringify([role, model]);
        const row: UsageRow = rows.get(key) ?? {
          model,
          role,
          sessions: 0,
          costIssues: new Set<string>(),
          calls: 0,
          cost: 0,
          tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
        };
        if (!Object.hasOwn(rates, model))
          row.costIssues.add("No matching rate");
        if (!requests) row.costIssues.add("Missing per-call records");
        for (const field of fields) {
          if (requests?.some((request) => request[field] === undefined))
            row.costIssues.add(
              "Missing " +
                {
                  cacheRead: "cache-read",
                  cacheWrite: "cache-write",
                  input: "input",
                  output: "output",
                }[field] +
                " tokens"
            );
        }
        row.sessions++;
        row.calls = add(row.calls, requests?.length);
        const cost = requests?.reduce<Metric>(
          (total, request) => add(total, price(request, rates)),
          0
        );
        row.cost = add(row.cost, cost);
        sessionCost = add(sessionCost, cost);
        for (const field of fields)
          row.tokens[field] = add(
            row.tokens[field],
            requests
              ? requests.reduce<Metric>(
                  (total, request) => add(total, request[field]),
                  0
                )
              : legacy[model]?.[field] || undefined
          );
        rows.set(key, row);
      }
    }
    if (entry.sessionState === "response-finished") finished++;
    if (observed && sessionCost !== undefined) {
      costs.push(sessionCost);
      if (entry.sessionState === "response-finished")
        finishedCosts.push(sessionCost);
    }
  }
  costs.sort((a, b) => b - a);
  finishedCosts.sort((a, b) => a - b);
  const middle = Math.floor(finished / 2);
  const total = costs.reduce((a, b) => a + b, 0);
  return {
    rows: [...rows.values()].sort(
      (a, b) =>
        (b.cost ?? -1) - (a.cost ?? -1) ||
        a.model.localeCompare(b.model) ||
        a.role.localeCompare(b.role)
    ),
    finished,
    priced: costs.length,
    median:
      finished && finishedCosts.length === finished
        ? (finishedCosts[middle] +
            finishedCosts[Math.floor((finished - 1) / 2)]) /
          2
        : undefined,
    share:
      costs.length === entries.length && costs.length >= 3 && total > 0
        ? (costs.slice(0, 3).reduce((a, b) => a + b, 0) / total) * 100
        : undefined,
  };
}

// Standard short-context USD reference rates per million tokens, reviewed 2026-11-27.
const referenceRates = new Map<string, Rates>([
  ["claude-opus-5-5", { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }],
  [
    "claude-sonnet-5-5",
    { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  ],
  [
    "claude-haiku-5-5",
    { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  ],
  ["gpt-6.2-sol", { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }],
]);

function aggregateEstimate(row: UsageRow, configured?: Rates) {
  const rate = configured ?? referenceRates.get(row.model);
  const present = fields.filter((field) => row.tokens[field] !== undefined);
  if (!rate || !present.length) return;
  const subtotal =
    present.reduce((sum, field) => sum + row.tokens[field]! * rate[field], 0) /
    1_000_000;
  const partial =
    present.length < fields.length ? " · known categories only" : "";
  return (
    subtotal.toFixed(4) +
    (configured ? "" : " USD") +
    '<small class="cost-reason">' +
    (configured ? "Configured rates" : "Reference estimate") +
    partial +
    "</small>"
  );
}

export function shareUsagePage(
  entries: LedgerEntry[],
  rates: Record<string, Rates>,
  external?: { data?: ExternalUsage; message: string },
  dailyTotal = ""
) {
  const sample = usageSample(entries, rates);
  const number = (v: Metric) =>
    v === undefined ? "Unknown" : v.toLocaleString("en-US");
  const money = (v: Metric) =>
    v === undefined ? "Unknown" : String(Number(v.toPrecision(8)));
  function modelCell(model: string) {
    return model === "<synthetic>"
      ? 'Transcript marker<small class="row-note"><code>&lt;synthetic&gt;</code> identifies a local assistant message, such as “No response requested.” Here, calls count those messages.</small>'
      : html(model);
  }
  function tableRow(model: string, cost: string, cells: string[]) {
    return (
      '<tr><th scope="row">' +
      modelCell(model) +
      '</th><td class="row-cost">' +
      cost +
      "</td>" +
      cells.map((cell) => "<td>" + cell + "</td>").join("") +
      "</tr>"
    );
  }
  const localRow = (row: UsageRow) =>
    tableRow(
      row.model,
      row.cost === undefined
        ? (aggregateEstimate(row, rates[row.model]) ??
            'Unknown<small class="cost-reason">Ledger: ' +
              [...row.costIssues].join(" · ") +
              "</small>")
        : money(row.cost) +
            '<small class="cost-reason">Configured rates</small>',
      [
        row.role,
        number(row.sessions),
        number(row.calls),
        ...fields.map((f) => number(row.tokens[f])),
      ]
    );
  const cb = external?.data;
  const localRows = cb
    ? sample.rows.flatMap((row) => {
        const remaining = entries.filter((entry) => {
          const keys = cb.covered.get(entry.session);
          return (
            !keys?.has(JSON.stringify([row.model, row.role])) &&
            !keys?.has(JSON.stringify([row.model, "Role unavailable"]))
          );
        });
        return usageSample(remaining, rates).rows.filter(
          (other) => other.model === row.model && other.role === row.role
        );
      })
    : sample.rows;
  const cbRows =
    cb?.rows
      .filter((row) => row.model !== "Session total")
      .map((row) => {
        const exactRole = usageSample(
          entries.filter((e) => row.sessions.has(e.session)),
          rates
        ).rows.find((r) => r.model === row.model && r.role === row.role);
        const cells = [
          row.role,
          number(row.sessions.size),
          number(exactRole?.calls ?? row.calls),
          ...fields.map((f) => number(exactRole?.tokens[f] ?? row[f])),
        ];
        const amount =
          row.cost === undefined
            ? "Unknown"
            : money(row.cost) + " " + html(cb.currency);
        return tableRow(
          row.model,
          amount +
            '<small class="cost-reason">Codeburn · ' +
            html([...row.basis].join(", ")) +
            (row.partial ? " · partial usage" : "") +
            "</small>",
          cells
        );
      })
      .join("") ?? "";
  const totals = cb
    ? [...cb.costs.values()]
        .filter((v): v is number => v !== undefined)
        .sort((a, b) => b - a)
    : [];
  const finished = entries.filter(
    (e) => e.sessionState === "response-finished"
  );
  const finishedTotals = finished
    .map((e) => cb?.costs.get(e.session))
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  const middle = Math.floor(finished.length / 2);
  const median =
    finished.length && finishedTotals.length === finished.length
      ? (finishedTotals[middle] +
          finishedTotals[Math.floor((finished.length - 1) / 2)]) /
        2
      : undefined;
  const total = totals.reduce((a, b) => a + b, 0);
  const share =
    totals.length === entries.length && totals.length >= 3 && total > 0
      ? (totals.slice(0, 3).reduce((a, b) => a + b, 0) / total) * 100
      : undefined;
  const supplemental = cb?.rows.find(
    (row) => row.model === "Session total" && row.role === "Role unavailable"
  );
  const top = cb?.matched.size ? undefined : sample.rows[0];
  const dates = entries.map((e) => e.updatedAt.slice(0, 10)).sort();
  const ratesUsed = sample.rows
    .map((r) => r.model)
    .filter((m, i, a) => a.indexOf(m) === i && rates[m]);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session usage · Token Ledger</title><style>${geistStyle}
  main{max-width:1440px}.usage{min-width:850px}.usage th,.usage td{padding:13px 14px}.usage th,.usage td{text-align:right}.usage th:first-child,.usage :nth-child(3){text-align:left}.usage tbody th{width:auto;max-width:32ch;font-weight:550;color:var(--ds-gray-1000);overflow-wrap:anywhere}.usage .row-cost{font-weight:600;background:var(--ds-background-200)}.usage tbody tr:hover>*{background:var(--ds-gray-100)}.cost-reason,.row-note{display:block;font:12px/1.45 Geist,system-ui,sans-serif;color:var(--muted);margin-top:3px}.row-cost{min-width:15ch}.row-note{max-width:30ch}.share-line{overflow-wrap:anywhere;padding:12px 20px}.stats{margin:18px 0}.stat{background:var(--ds-background-200)}.stat small{color:var(--muted);font-size:12px}.panel{margin-bottom:14px}.usage-guide{margin-bottom:12px}@media(max-width:700px){.stats{grid-template-columns:1fr}.page-heading .button{display:inline-block;margin-top:12px}}
  </style>${productHeader("Session usage", true)}<main><div class="page-heading"><div><h1>Usage from the last ${entries.length} sessions</h1><p>${dates.length ? "Last updated " + dates[0] + " to " + dates.at(-1) + " UTC · " : ""}${sample.finished} sessions with a finished latest response</p></div><a class="button" href="?view=comparison">Compare deployments</a></div>
  ${dailyTotal}${dayPicker(new Date().toLocaleDateString("sv-SE"))}<div class="stats">${[
    [
      "Fully priced sessions",
      (cb?.matched.size ? totals.length : sample.priced) +
        " / " +
        entries.length,
      "Sessions with a complete cost across recorded usage.",
    ],
    [
      "Median cost · finished responses",
      cb?.matched.size
        ? median === undefined
          ? "Unknown"
          : money(median) + " " + html(cb.currency)
        : money(sample.median),
      "Available when every finished session has a complete cost.",
    ],
    [
      "Top three sessions · share of cost",
      (cb?.matched.size ? share : sample.share)?.toFixed(1)?.concat("%") ??
        "Unknown",
      "Requires at least three sessions, complete prices and a positive total.",
    ],
  ]
    .map(
      ([label, value, note]) =>
        '<div class="stat"><p>' +
        label +
        '</p><div class="stat-value numeric">' +
        value +
        "</div><small>" +
        note +
        "</small></div>"
    )
    .join("")}</div>
  <section class="panel"><div class="panel-heading"><div><h2>Usage by model and role</h2><p>Each row groups sessions that used the same model in the same role.</p></div></div><div class="table-scroll"><table class="usage"><thead><tr>${["Model", "Est. cost", "Role", "Sessions", "Calls", "Input", "Cache write", "Cache read", "Output"].map((label) => '<th scope="col">' + label + "</th>").join("")}</tr></thead><tbody>${cbRows}${localRows.map(localRow).join("")}</tbody></table></div><p class="panel-footer">${external ? html((cb ? "Codeburn matched " + cb.matched.size + " of " + entries.length + " sessions. " : "") + external.message) + " " : ""}${cbRows || localRows.length ? "Sessions can appear in multiple rows. Unknown means the recorded usage or configured rates are incomplete." : "No recorded model usage in this sample."}</p></section>
  ${supplemental && cb ? "<p>Codeburn session-only total · " + supplemental.sessions.size + " sessions · " + money(supplemental.cost) + " " + html(cb.currency) + ". Included in session statistics; model allocation unavailable.</p>" : ""}
  ${top && sample.priced === entries.length && top.cost !== undefined ? '<section class="panel share-line"><h2>Largest cost contributor</h2><p>' + html(top.model) + " · " + top.role + " · " + number(top.calls) + " calls · estimated cost " + money(top.cost) + "</p></section>" : ""}
  <details id="usage-guide" class="details usage-guide"><summary>How to read roles, tokens and costs</summary><div class="details-body"><p><strong>Roles.</strong> Main is the assistant in your conversation. Worker is a delegated assistant. Role unavailable means the records could not identify which one used the model.</p><p><strong>Tokens.</strong> Input and output measure text sent to and generated by the model. Cache writes store input for reuse. Cache reads count input reused from that store.</p><p><strong>Costs.</strong> Codeburn supplies costs from its usage export. Partial usage means the ledger recorded more tokens than Codeburn covered. A reference estimate applies standard model prices to the available counts.</p><p><strong>Unknown.</strong> A missing value is different from a recorded zero. “No matching rate” means the ledger lacks a configured price for the model. “Missing per-call records” means it has session totals without individual request details.</p></div></details>
  <details id="recording" class="details"><summary>Rates used for estimates</summary><div class="details-body"><p>Reference estimates use published standard USD prices on 2026-11-27, short-context requests and short cache writes (Claude 5 minutes, Sol 30 minutes). Your billing route, prompt size, and retention can change the charge. These benchmarks are excluded from session cost statistics. <a href="https://platform.claude.com/docs/en/about-claude/pricing">Anthropic rates</a> · <a href="https://developers.openai.com/api/docs/models/gpt-6.2-sol">OpenAI rates</a></p><p>Current TOKEN_LEDGER_PRICING per million tokens, in your configured currency. Estimates cover recorded usage and may differ from billing.</p>${ratesUsed.map((m) => "<p>" + html(m) + " · " + fields.map((f) => f + " " + rates[m][f]).join(" · ") + "</p>").join("") || "<p>No matching rates configured. Set TOKEN_LEDGER_PRICING in the shell that starts this report, using the exact model IDs above and your provider’s input, output, cacheRead and cacheWrite prices per million tokens. Then relaunch the report.</p>"}</div></details></main><script>${liveVerifyScript}</script></html>`;
}
