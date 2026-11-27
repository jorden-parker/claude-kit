import type { Rates, RequestUsage } from "./usage-metrics.ts";
export const fields = ["input", "cacheWrite", "cacheRead", "output"] as const;
// Standard short-context USD reference rates per million tokens, reviewed 2026-11-27.
export const referenceRates = new Map<string, Rates>([
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

export function price(request: RequestUsage, rates: Record<string, Rates>) {
  const rate = rates[request.resolvedModel];
  if (!rate || fields.some((field) => request[field] === undefined))
    return undefined;
  return (
    fields.reduce((cost, field) => cost + rate[field] * request[field]!, 0) /
    1_000_000
  );
}

export function reportPricing(
  configured: Record<string, Rates>,
  currencyCode = process.env.TOKEN_LEDGER_CURRENCY || "USD"
) {
  const currency = currencyCode.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw Error("Invalid TOKEN_LEDGER_CURRENCY");
  return {
    currency,
    rates: Object.assign(
      Object.create(null),
      currency === "USD" ? Object.fromEntries(referenceRates) : {},
      configured
    ) as Record<string, Rates>,
    configured,
  };
}
