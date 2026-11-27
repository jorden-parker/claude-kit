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
          calls: 0,
          cost: 0,
          tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
        };
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

export function shareUsagePage(
  entries: LedgerEntry[],
  rates: Record<string, Rates>
) {
  const sample = usageSample(entries, rates);
  const number = (v: Metric) =>
    v === undefined ? "Unknown" : v.toLocaleString("en-US");
  const money = (v: Metric) =>
    v === undefined ? "Unknown" : String(Number(v.toPrecision(8)));
  const rowCells = (row: UsageRow) =>
    [
      row.role,
      number(row.sessions),
      number(row.calls),
      ...fields.map((f) => number(row.tokens[f])),
      money(row.cost),
    ]
      .map((v) => "<td>" + v + "</td>")
      .join("");
  const top = sample.rows[0];
  const dates = entries.map((e) => e.updatedAt.slice(0, 10)).sort();
  const ratesUsed = sample.rows
    .map((r) => r.model)
    .filter((m, i, a) => a.indexOf(m) === i && rates[m]);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session usage · Token Ledger</title><style>${geistStyle}
  main{max-width:1440px}.usage th,.usage td{padding:10px}.usage tbody th{width:auto}.usage td{text-align:right}.usage td:first-of-type{text-align:left}.share-line{overflow-wrap:anywhere;padding:12px 20px}.stats{margin:18px 0}.panel{margin-bottom:14px}</style>${productHeader("Session usage", true)}<main><div class="page-heading"><div><h1>Usage from the last ${entries.length} sessions</h1><p>${dates.length ? "Last updated " + dates[0] + " to " + dates.at(-1) + " UTC · " : ""}Newest 20 local records · ${sample.finished} with latest response finished</p></div><a class="button" href="?view=comparison">Compare deployments</a></div>
  <div class="stats">${[
    ["Fully priced sessions", sample.priced + " / " + entries.length],
    ["Median cost · finished responses", money(sample.median)],
    [
      "Top three sessions · share of cost",
      sample.share === undefined ? "Unknown" : sample.share.toFixed(1) + "%",
    ],
  ]
    .map(
      ([label, value]) =>
        '<div class="stat"><p>' +
        label +
        '</p><div class="stat-value numeric">' +
        value +
        "</div></div>"
    )
    .join("")}</div>
  <section class="panel"><div class="panel-heading"><h2>Usage by model and role</h2></div><div class="table-scroll"><table class="usage"><thead><tr>${["Model", "Role", "Sessions", "Calls", "Input", "Cache write", "Cache read", "Output", "Est. cost"].map((label) => "<th>" + label + "</th>").join("")}</tr></thead><tbody>${sample.rows.map((row) => '<tr><th class="model-name" scope="row">' + html(row.model) + "</th>" + rowCells(row) + "</tr>").join("")}</tbody></table></div><p class="panel-footer">${sample.rows.length ? "Sessions can appear in multiple rows. Unknown means the recorded usage or configured rates are incomplete." : "No recorded model usage in this sample."}</p></section>
  ${top && sample.priced === entries.length && top.cost !== undefined ? '<section class="panel share-line"><h2>Largest cost contributor</h2><p>' + html(top.model) + " · " + top.role + " · " + number(top.calls) + " calls · estimated cost " + money(top.cost) + "</p></section>" : ""}
  <details id="recording" class="details"><summary>Rates used for estimates</summary><div class="details-body"><p>Current TOKEN_LEDGER_PRICING per million tokens, in your configured currency. Estimates cover recorded usage and may differ from billing.</p>${ratesUsed.map((m) => "<p>" + html(m) + " · " + fields.map((f) => f + " " + rates[m][f]).join(" · ") + "</p>").join("") || "<p>No matching rates configured.</p>"}</div></details></main><script>${liveVerifyScript}</script></html>`;
}
