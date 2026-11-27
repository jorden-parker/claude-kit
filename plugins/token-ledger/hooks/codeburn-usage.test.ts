import { expect, test } from "bun:test";
import { parseExport } from "./codeburn-usage.ts";
import { shareUsagePage } from "./share-usage.ts";
import type { LedgerEntry } from "./ledger.ts";
const usage = { input: 4, cacheWrite: 0, cacheRead: 0, output: 2 };
const entry: LedgerEntry = {
  session: "exact",
  project: "private",
  startedAt: "2026-11-26",
  updatedAt: "2026-11-27",
  main: { sol: usage },
  subagents: {},
  contextTokens: 2,
  lastNudgeTokens: 0,
  resultCharactersByTool: {},
};
const record = {
  sessionId: "exact",
  provider: "claude",
  model: "sol",
  cost: 1.25,
  inputTokens: 4,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 2,
};
const base = {
  schema: "codeburn.export.v2",
  currency: { code: "GBP" },
  sessions: [],
  records: [record],
};
test("exact matching replaces overlap and preserves export currency", () => {
  const data = parseExport(
    { ...base, records: [record, { ...record, sessionId: "elsewhere" }] },
    [entry]
  );
  expect(data.costs.get("exact")).toBe(1.25);
  const page = shareUsagePage([entry], {}, { data, message: "" });
  expect(page).toContain("1.25 GBP");
  expect(page.match(/scope="row">sol/g)).toHaveLength(1);
  expect(page).not.toContain("private");
  expect(
    parseExport(base, [{ ...entry, subagents: { sol: usage } }]).rows[0].role
  ).toBe("Role unavailable");
});
test("zero unpriced, explicitly covered, and session-only totals stay distinct", () => {
  for (const [basis, cost] of [
    ["unpriced", undefined],
    ["included", 0],
  ] as const) {
    expect(
      parseExport(
        { ...base, records: [{ ...record, cost: 0, costBasis: basis }] },
        [entry]
      ).costs.get("exact")
    ).toBe(cost);
  }
  const sessions = [{ "Session ID": "exact", "Cost (GBP)": 3, "API Calls": 4 }];
  expect(parseExport({ ...base, sessions }, [entry]).costs.get("exact")).toBe(
    1.25
  );
  expect(
    parseExport({ ...base, sessions, records: [] }, [entry]).rows[0]
  ).toMatchObject({
    model: "Session total",
    role: "Role unavailable",
    cost: 3,
  });
  expect(() => parseExport({}, [entry])).toThrow("Unsupported");
});
