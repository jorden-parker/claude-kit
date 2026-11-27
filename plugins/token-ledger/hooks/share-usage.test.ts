import { expect, test } from "bun:test";
import { usageSample } from "./share-usage.ts";
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
