import type { ExternalUsage } from "./codeburn-usage.ts";
import type { UsageEntry } from "./transcript-usage.ts";
import type { Rates, RequestUsage } from "./usage-metrics.ts";
import { html } from "./checkin-form.ts";
import { geistStyle, productHeader } from "./geist-style.ts";
import { liveVerifyScript } from "./verify-page.ts";

import { fields, price, referenceRates } from "./usage-pricing.ts";
type Metric = number | undefined;
type UsageRow = {
  model: string;
  role: string;
  sessions: number;
  calls: Metric;
  cost: Metric;
  costIssues: Set<string>;
  pricedCalls: number;
  pricedSubtotal: number;
  agentTypes: Set<string>;
  tokens: Record<keyof Rates, Metric>;
};
function add(a: Metric, b: Metric) {
  return a === undefined || b === undefined ? undefined : a + b;
}
export function usageSample(
  entries: UsageEntry[],
  rates: Record<string, Rates>
) {
  const rows = new Map<string, UsageRow>();
  const sessionCosts = new Map<string, number>();
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
      [
        "Role unavailable",
        [{ requests: entry.unattributed ?? [] }],
        {} as typeof entry.main,
      ],
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
          agentTypes: new Set<string>(),
          pricedCalls: 0,
          pricedSubtotal: 0,
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
        for (const req of requests ?? [])
          if (role === "Worker" && req.agentType)
            row.agentTypes.add(req.agentType);
        row.sessions++;
        row.calls = add(row.calls, requests?.length);
        let cost: Metric = requests ? 0 : undefined;
        for (const request of requests ?? []) {
          const amount = price(request, rates);
          if (amount !== undefined) {
            row.pricedCalls++;
            row.pricedSubtotal += amount;
          }
          cost = add(cost, amount);
        }
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
      sessionCosts.set(entry.session, sessionCost);
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
    sessionCosts,
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

function aggregateEstimate(
  row: UsageRow,
  configured?: Rates,
  pricing?: ReturnType<typeof import("./usage-pricing.ts").reportPricing>
) {
  const rate =
    configured ?? (pricing ? undefined : referenceRates.get(row.model));
  const present = fields.filter((field) => row.tokens[field] !== undefined);
  if (!rate || !present.length) return;
  const subtotal =
    present.reduce((sum, field) => sum + row.tokens[field]! * rate[field], 0) /
    1_000_000;
  const partial =
    present.length < fields.length ? " · known categories only" : "";
  return (
    subtotal.toFixed(4) +
    (pricing ? " " + pricing.currency : configured ? "" : " USD") +
    '<small class="cost-reason">' +
    ((pricing ? Object.hasOwn(pricing.configured, row.model) : configured)
      ? "Configured rates"
      : "Reference estimate") +
    partial +
    "</small>"
  );
}

function comparisonPanel(
  external: { data?: ExternalUsage; message: string },
  sessions: number
) {
  const { data, message } = external;
  const status = data
    ? `Codeburn matched ${data.matched.size} of ${sessions} session IDs. `
    : "";
  const counts = data?.verification;
  const verification = counts
    ? `<p>${counts.matched} matching calls · ${counts.mismatched} mismatches · ${counts.inconclusive} inconclusive export records · ${counts.missingTranscript} export records without transcript evidence · ${counts.missingExport} transcript calls without a unique export candidate.</p>`
    : "";
  const costs =
    data?.rows
      .map((row) => {
        const amount =
          row.cost === undefined
            ? "Unknown"
            : Number(row.cost.toPrecision(8)) + " " + html(data.currency);
        return `<p>${html(row.model)} · ${html(row.role)} · ${amount} · ${html([...row.basis].join(", "))}${row.partial ? " · partial usage" : ""}</p>`;
      })
      .join("") ?? "";
  return `<details class="details" id="independent"><summary>Independent Codeburn comparison</summary><div class="details-body"><p>${html(status + message)}</p>${verification}${costs}</div></details>`;
}

export function shareUsagePage(
  entries: UsageEntry[],
  rates: Record<string, Rates>,
  external?: { data?: ExternalUsage; message: string },
  dailyTotal = "",
  pricing?: ReturnType<typeof import("./usage-pricing.ts").reportPricing>,
  sourceNote = ""
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
        ? pricing && row.pricedCalls
          ? money(row.pricedSubtotal) +
            " " +
            pricing.currency +
            '<small class="cost-reason">Priced subtotal · ' +
            row.pricedCalls +
            " fully priced calls</small>"
          : (aggregateEstimate(row, rates[row.model], pricing) ??
            'Unknown<small class="cost-reason">Ledger: ' +
              [...row.costIssues].join(" · ") +
              "</small>")
        : money(row.cost) +
            (pricing ? " " + html(pricing.currency) : "") +
            '<small class="cost-reason">' +
            (pricing && !Object.hasOwn(pricing.configured, row.model)
              ? "Reference estimate"
              : "Configured rates") +
            "</small>",
      [
        row.role +
          (row.agentTypes.size
            ? "<small>" +
              "Known types: " +
              html([...row.agentTypes].sort().join(", ")) +
              "</small>"
            : ""),
        number(row.sessions),
        number(row.calls),
        ...fields.map((f) => number(row.tokens[f])),
      ]
    );

  const pricedCalls = sample.rows.reduce((n, r) => n + r.pricedCalls, 0);
  const knownCalls = sample.rows.reduce((n, r) => n + (r.calls ?? 0), 0);
  const pricedSubtotal = sample.rows.reduce((n, r) => n + r.pricedSubtotal, 0);
  const coverage =
    pricing && sample.rows.length
      ? `Priced subtotal from ${pricedCalls} fully priced calls: ${pricedCalls ? money(pricedSubtotal) + " " + pricing.currency : "unavailable"}. ${sample.rows.some((r) => r.calls === undefined) ? "Some call counts are unavailable." : knownCalls + " recorded calls in this sample."} `
      : "";
  const top = sample.rows[0];
  const dates = entries.map((e) => e.updatedAt.slice(0, 10)).sort();
  const ratesUsed = sample.rows
    .map((r) => r.model)
    .filter(
      (m, i, a) =>
        a.indexOf(m) === i && Object.hasOwn(pricing?.configured ?? rates, m)
    );
  const sessionRows = entries
    .map((entry) => {
      const cost = sample.sessionCosts.get(entry.session);
      const state =
        entry.sessionState === "response-finished"
          ? "Finished response"
          : entry.sessionState === "working"
            ? "Working through tools"
            : "Unknown";
      const source =
        cost === undefined
          ? "Incomplete pricing"
          : pricing
            ? "Fully priced"
            : "Configured rates";
      return `<tr><th scope="row"><time>${html(entry.updatedAt.replace("T", " ").replace(/(?:\.\d+)?Z$/, ""))}</time></th>
      <td>${state}</td><td>${money(cost)}${pricing && cost !== undefined ? " " + html(pricing.currency) : ""}</td><td>${source}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session usage · Token Ledger</title><style>${geistStyle}
  main{max-width:1440px}.usage{min-width:850px}.usage th,.usage td{padding:13px 14px}.usage th,.usage td{text-align:right}.usage th:first-child,.usage :nth-child(3){text-align:left}.usage tbody th{width:auto;max-width:32ch;font-weight:550;color:var(--ds-gray-1000);overflow-wrap:anywhere}.usage .row-cost{font-weight:600;background:var(--ds-background-200)}.usage tbody tr:hover>*{background:var(--ds-gray-100)}.cost-reason,.row-note{display:block;font:12px/1.45 Geist,system-ui,sans-serif;color:var(--muted);margin-top:3px}.row-cost{min-width:15ch}.row-note{max-width:30ch}.share-line{overflow-wrap:anywhere;padding:12px 20px}.stats{margin:18px 0}.stat{background:var(--ds-background-200)}.stat small{color:var(--muted);font-size:12px}.panel{margin-bottom:14px}.usage-guide{margin-bottom:12px}@media(max-width:700px){.stats{grid-template-columns:1fr}.page-heading .button{display:inline-block;margin-top:12px}}
  </style>${productHeader("Session usage", true)}<main id="report"><div class="page-heading"><div><h1>Session usage</h1><p>Last ${entries.length} ${entries.length === 1 ? "session" : "sessions"} · ${dates.length ? "Updated " + dates[0] + " to " + dates.at(-1) + " UTC · " : ""}${sample.finished} sessions with a finished latest response</p></div><a class="button" href="?view=comparison">Compare deployments</a></div>
  ${dailyTotal}<p>${html(sourceNote)}</p><div class="stats">${[
    [
      "Fully priced sessions",
      sample.priced + " / " + entries.length,
      "Sessions with a complete cost across recorded usage.",
    ],
    [
      "Median cost · finished responses",
      money(sample.median) +
        (pricing && sample.median !== undefined ? " " + pricing.currency : ""),
      "Available when every finished session has a complete cost.",
    ],
    [
      "Top three sessions · share of cost",
      sample.share?.toFixed(1)?.concat("%") ?? "Unknown",
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
  <section class="panel"><div class="panel-heading"><div><h2>Usage by model and role</h2><p>Each row groups sessions that used the same model in the same role.</p></div></div><div class="table-scroll" role="region" aria-label="Usage by model and role" tabindex="0"><table class="usage"><thead><tr>${["Model", "Est. cost", "Role", "Sessions", "Calls", "Input", "Cache write", "Cache read", "Output"].map((label) => '<th scope="col">' + label + "</th>").join("")}</tr></thead><tbody>${sample.rows.map(localRow).join("")}</tbody></table></div><p class="panel-footer">${html(coverage)}${sample.rows.length ? "Sessions can appear in multiple rows. Unknown means the recorded usage or configured rates are incomplete." : "No recorded model usage in this sample."}</p></section>
  ${sessionRows ? `<details id="session-costs" class="details"><summary>Individual session costs</summary><div class="table-scroll" role="region" aria-label="Individual session costs" tabindex="0"><table class="session-costs"><thead><tr><th>Updated (UTC)</th><th>Latest response</th><th>Est. cost</th><th>Pricing coverage</th></tr></thead><tbody>${sessionRows}</tbody></table></div></details>` : ""}
  ${external ? comparisonPanel(external, entries.length) : ""}
  ${top && sample.priced === entries.length && top.cost !== undefined ? '<section class="panel share-line"><h2>Largest cost contributor</h2><p>' + html(top.model) + " · " + top.role + " · " + number(top.calls) + " calls · estimated cost " + money(top.cost) + (pricing ? " " + pricing.currency : "") + "</p></section>" : ""}
  <details id="usage-guide" class="details usage-guide"><summary>How to read roles, tokens and costs</summary><div class="details-body"><p><strong>Roles.</strong> Main is the assistant in your conversation. Worker is a delegated assistant. Role unavailable means the records could not identify which one used the model.</p><p><strong>Tokens.</strong> Input and output measure text sent to and generated by the model. Cache writes store input for reuse. Cache reads count input reused from that store.</p><p><strong>Costs.</strong> The report estimates cost from local usage counters. Codeburn export amounts appear separately when available. A matching call agrees on model and recorded token counters. Ambiguous identifiers or missing counters make a comparison inconclusive.</p><p><strong>Unknown.</strong> A missing value is different from a recorded zero. “No matching rate” means the ledger lacks a configured price for the model. “Missing per-call records” means it has session totals without individual request details.</p></div></details>
  <details id="recording" class="details"><summary>Rates used for estimates</summary><div class="details-body"><p>Reference estimates use published standard USD prices on 2026-11-27, short-context requests and short cache writes (Claude 5 minutes, Sol 30 minutes). Your billing route, prompt size, and retention can change the charge. The live report includes fully priced requests in session statistics. <a href="https://platform.claude.com/docs/en/about-claude/pricing">Anthropic rates</a> · <a href="https://developers.openai.com/api/docs/models/gpt-6.2-sol">OpenAI rates</a></p><p>Current TOKEN_LEDGER_PRICING per million tokens, in your configured currency (TOKEN_LEDGER_CURRENCY, default USD). Estimates cover recorded usage and may differ from billing.</p>${ratesUsed.map((m) => "<p>" + html(m) + " · " + fields.map((f) => f + " " + rates[m][f]).join(" · ") + "</p>").join("") || "<p>No matching rates configured. Set TOKEN_LEDGER_PRICING in the shell that starts this report, using the exact model IDs above and your provider’s input, output, cacheRead and cacheWrite prices per million tokens. Then relaunch the report.</p>"}</div></details></main><script>${liveVerifyScript}</script></html>`;
}
