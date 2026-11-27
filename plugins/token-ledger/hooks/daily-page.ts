import { html } from "./checkin-form.ts";
import { geistStyle, productHeader } from "./geist-style.ts";
import type { parseDay } from "./codeburn-usage.ts";
export type DayUsage = ReturnType<typeof parseDay> & {
  priced?: number;
  unpricedModels?: string[];
  configuredCalls?: number;
  errors?: number;
  cacheRead?: number;
  cacheWrite?: number;
};
export function dayPicker(day: string) {
  return (
    '<form method="get" class="day-picker"><label for="day">Date</label><div class="day-controls"><input autocomplete="off" id="day" name="day" type="date" required value="' +
    html(day) +
    '"><button class="primary">Show total</button></div></form>'
  );
}
export function dayTotal(
  day: string,
  zone: string,
  data?: DayUsage,
  loading = false
) {
  const amount =
    data?.cost === undefined
      ? loading
        ? "Loading…"
        : "Unavailable"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: data.currency,
          currencyDisplay: "code",
          maximumFractionDigits: 6,
        }).format(data.cost);
  let detail = loading
    ? "Reading local transcripts."
    : "Transcript reading unavailable.";
  let breakdown = "";
  if (data) {
    detail = (data.calls ?? "Unknown") + " recorded calls";
    if (data.priced !== undefined) {
      const configured = data.configuredCalls ?? 0;
      detail += ` · ${data.priced} fully priced`;
      breakdown = `${data.cacheWrite?.toLocaleString("en-US")} known cache-write tokens · ${data.cacheRead?.toLocaleString("en-US")} known cache-read tokens. ${configured} calls at configured rates and ${data.priced - configured} at reference rates.`;
      if (data.errors)
        breakdown += ` ${data.errors} missing source roots, read errors or skipped records across all days.`;
      if (data.unpricedModels?.length)
        breakdown +=
          " Models with unpriced calls: " +
          data.unpricedModels.join(", ") +
          ".";
    }
  }
  return `<section class="day-result" aria-labelledby="daily-heading">
    <div class="day-reading"><h2 id="daily-heading">${data?.unpriced ? "Priced subtotal" : "Daily total"} · estimate</h2>
    <div class="day-amount numeric">${amount}</div>
    <p><time datetime="${html(day)}">${html(day)}</time> · ${html(zone)}</p></div>
    <p class="day-coverage">${html(detail)}</p>${dayPicker(day)}</section>
    ${breakdown ? '<details id="daily-breakdown" class="details"><summary>Daily pricing and token breakdown</summary><div class="details-body"><p>' + html(breakdown) + "</p></div></details>" : ""}`;
}
export function dailyPage(day: string, zone: string, data?: DayUsage) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Daily cost · Token Ledger</title><style>${geistStyle}</style>${productHeader("Daily cost")}<main id="report"><div class="page-heading"><div><h1>Daily cost</h1><p>Local Claude Code transcript usage across projects for the selected calendar day.</p></div><a class="button" href="?view=usage">Recent sessions</a></div>${dayTotal(day, zone, data)}</main><script>setTimeout(()=>{if(!document.hidden && document.getElementById("day").value===new URLSearchParams(location.search).get("day") && document.activeElement?.tagName!=="INPUT")location.reload()},65000)</script></html>`;
}
