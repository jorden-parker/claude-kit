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

test("v3 uses raw records first and camelCase session totals when no record matches", () => {
  const snapshot = {
    ...base,
    schema: "codeburn.export.v3",
    records: [{ ...record, costBasis: "calculated" }],
    sessions: [{ sessionId: entry.session, cost: 3, apiCalls: 4 }],
  };
  const detailed = parseExport(snapshot, [entry]);
  expect(detailed.costs.get(entry.session)).toBe(1.25);
  expect(detailed.rows[0].basis.has("calculated")).toBe(true);
  expect(
    shareUsagePage([entry], {}, { data: detailed, message: "" }).split(
      "</table>"
    )[0]
  ).not.toContain("Missing per-call records");
  expect(
    parseExport({ ...snapshot, records: [] }, [entry]).rows[0]
  ).toMatchObject({ model: "Session total", cost: 3, calls: 4 });
});

test("macOS desktop engine uses the packaged launcher or its bundled Electron runtime", async () => {
  const { macDesktopEngine } = await import("./codeburn.ts");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const app = mkdtempSync(join(tmpdir(), "CodeBurn Desktop "));
  try {
    const cli = join(app, "Contents/Resources/cli");
    const runtime = join(app, "Contents/MacOS/CodeBurn");
    mkdirSync(join(cli, "dist"), { recursive: true });
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    writeFileSync(runtime, "#!/bin/sh\n", { mode: 0o755 });
    expect(macDesktopEngine(app)).toBeUndefined();
    writeFileSync(join(cli, "dist/launch.js"), "");
    expect(macDesktopEngine(app)).toEqual({
      command: [runtime, join(cli, "dist/launch.js")],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    writeFileSync(join(cli, "codeburn"), "#!/bin/sh\n", { mode: 0o755 });
    expect(macDesktopEngine(app)?.command).toEqual([join(cli, "codeburn")]);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("daily cost uses only the selected day's call totals in export currency", async () => {
  const { parseDay } = await import("./codeburn-usage.ts");
  const day = "2026-11-27";
  expect(
    parseDay(
      {
        ...base,
        periods: [
          {
            daily: [
              { Date: "2026-11-26", "Cost (GBP)": 90 },
              { Date: day, "Cost (GBP)": 3.71, "API Calls": 50 },
            ],
          },
        ],
      },
      day
    )
  ).toMatchObject({ cost: 3.71, currency: "GBP", calls: 50 });
  expect(
    parseDay(
      {
        ...base,
        schema: "codeburn.export.v3",
        records: [{ unpriced: true }],
        periods: [{ daily: [{ date: day, cost: 4.19, apiCalls: 7 }] }],
      },
      day
    )
  ).toMatchObject({ cost: 4.19, unpriced: true });
});
