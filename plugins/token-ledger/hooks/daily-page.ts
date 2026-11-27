import { html } from "./checkin-form.ts";
import { geistStyle, productHeader } from "./geist-style.ts";
import type { parseDay } from "./codeburn-usage.ts";
export function dayPicker(day: string) {
  return (
    '<form method="get" class="toolbar"><label for="day">Daily cost</label><input style="width:auto" id="day" name="day" type="date" required value="' +
    html(day) +
    '"><button class="primary">Show total</button></form>'
  );
}
export function dailyPage(
  day: string,
  zone: string,
  data?: ReturnType<typeof parseDay>
) {
  const amount =
    data?.cost === undefined
      ? "Unavailable"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: data.currency,
          currencyDisplay: "code",
        }).format(data.cost);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Daily cost · Token Ledger</title><style>${geistStyle}.day-result{max-width:680px;margin:24px 0;background:var(--ds-background-200)}.day-result .stat-value{font-size:clamp(32px,6vw,54px);margin:10px 0}.day-result p{max-width:60ch}</style>${productHeader("Daily cost")}<main><div class="page-heading"><div><h1>Daily cost</h1><p>All Claude Code usage Codeburn recorded for the selected calendar day · ${html(zone)}</p></div><a class="button" href="?view=usage">Recent sessions</a></div>${dayPicker(day)}<section class="stat day-result"><h2>${html(day)} · ${data?.unpriced ? "Priced subtotal" : "Daily total"}</h2><div class="stat-value numeric">${amount}</div><p>${data ? (data.calls ?? "Unknown") + " recorded calls" + (data.unpriced ? ". This subtotal includes only the usage Codeburn could price." : "") : "Codeburn could not provide a daily report."}</p></section></main><script>setTimeout(()=>{if(!document.hidden && document.getElementById("day").value===new URLSearchParams(location.search).get("day") && document.activeElement?.tagName!=="INPUT")location.reload()},65000)</script></html>`;
}
