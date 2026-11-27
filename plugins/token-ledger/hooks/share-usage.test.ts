import { expect, test } from "bun:test";
import { shareUsagePage, usageSample } from "./share-usage.ts";
import type { LedgerEntry } from "./ledger.ts";
const tokens = { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 };
const task = {
  task: 1,
  workerCalls: 0,
  resumedWorkers: 0,
  hookDenials: 0,
  requests: [{ resolvedModel: "model", ...tokens }],
};
const entry: LedgerEntry = {
  session: "session",
  project: "project",
  updatedAt: "2026-11-27",
  contextTokens: 0,
  lastNudgeTokens: 0,
  main: { model: tokens },
  subagents: { model: tokens },
  resultCharactersByTool: {},
  tasks: [task],
  workerTasks: [[task]],
  sessionState: "response-finished",
};
test("keeps main and worker costs separate and uses complete sessions for cost statistics", () => {
  const rates = { model: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
  const result = usageSample([entry, entry, entry, entry], rates);
  expect(
    result.rows.map((r) => [r.role, r.sessions, r.calls, r.tokens.cacheWrite])
  ).toEqual([
    ["Main", 4, 4, 0],
    ["Worker", 4, 4, 0],
  ]);
  expect(result.median).toBeCloseTo(0.00025, 8);
  expect(result.share).toBeCloseTo(75);
  expect(usageSample([entry], {}).median).toBeUndefined();
});
test("legacy recorded counts remain visible while missing detail and costs remain unknown", () => {
  const result = usageSample(
    [{ ...entry, tasks: undefined, workerTasks: undefined }],
    {}
  );
  expect(result.rows[0].tokens.input).toBe(100);
  expect(result.rows[0].calls).toBeUndefined();
  expect(result.priced).toBe(0);
  expect(result.share).toBeUndefined();
});

test("cost cells identify missing rates, old records and absent counters independently", () => {
  const partial = {
    ...entry,
    tasks: [
      { ...task, requests: [{ ...task.requests[0], cacheRead: undefined }] },
    ],
    workerTasks: undefined,
  };
  const page = shareUsagePage([partial], {});
  expect(page).toContain("No matching rate · Missing cache-read tokens");
  expect(page).toContain("No matching rate · Missing per-call records");
  expect(
    shareUsagePage([partial], {
      model: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    })
  ).not.toContain("No matching rate ·");
});

test("legacy Opus readings get a labeled reference estimate independent of call count", () => {
  const main = {
    "claude-opus-5-5": {
      input: 506,
      cacheWrite: 451685,
      cacheRead: 14840309,
      output: 82225,
    },
  };
  const source = {
    ...entry,
    main,
    subagents: {},
    tasks: undefined,
    workerTasks: undefined,
  };
  expect(shareUsagePage([source], {})).toContain(
    '6.8730 USD<small class="cost-reason">Reference estimate'
  );
  const partial = {
    ...source,
    main: { "claude-opus-5-5": { ...main["claude-opus-5-5"], cacheRead: 0 } },
  };
  expect(shareUsagePage([partial], {})).toContain("known categories only");
  expect(usageSample([source], {}).priced).toBe(0);
});
