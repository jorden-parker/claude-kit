import { expect, test } from "bun:test";
import { compareModelCohorts, modelCohort } from "./model-comparison.ts";
import { verifyPage } from "./verify-page.ts";
import type { LedgerEntry } from "./ledger.ts";
const since = "2026-11-27T14:00:00.000Z";
const sample = (model: string, after: boolean, calls = 1): LedgerEntry => ({
  session: crypto.randomUUID(),
  project: "work",
  updatedAt: after ? "2026-11-27T15:03:00.000Z" : "2026-11-27T13:03:00.000Z",
  startedAt: after ? "2026-11-27T15:00:00.000Z" : "2026-11-27T13:00:00.000Z",
  contextTokens: 10,
  lastNudgeTokens: 0,
  main: {
    [model]: {
      input: calls * 10,
      output: calls * 2,
      cacheWrite: 0,
      cacheRead: 0,
    },
  },
  subagents: {},
  resultCharactersByTool: {},
  tasks: [
    {
      task: 1,
      workerCalls: 0,
      resumedWorkers: 0,
      hookDenials: 0,
      requests: Array.from({ length: calls }, () => ({
        resolvedModel: model,
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
      })),
    },
  ],
  workerTasks: [],
  sessionState: after ? "working" : "response-finished",
});
test("70 historical sessions on another model are not pooled with a single Sol session", () => {
  const result = compareModelCohorts(
    [
      ...Array.from({ length: 70 }, () => sample("opus", false)),
      sample("sol", true),
    ],
    since
  );
  expect(result).toMatchObject({
    allBefore: 70,
    allAfter: 1,
    enough: false,
    before: { sessions: 0 },
    after: { sessions: 1 },
  });
  expect(result.selected?.label).toContain("sol");
  const page = verifyPage({
    title: "Change",
    since,
    ...result,
    models: result,
  });
  expect(page).toContain("Insufficient comparable data");
  expect(page).toContain("70 Before, 1 After");
  expect(page).toContain("Reasoning effort");
  expect(page).toContain("do not establish savings");
});
test("same-model unequal session lengths have the same per-call token reading", () => {
  const result = compareModelCohorts(
    [sample("sol", false, 100), sample("sol", true, 10)],
    since
  );
  expect(result.normalizedBefore.medianTokensPerCall).toBe(12);
  expect(result.normalizedAfter.medianTokensPerCall).toBe(12);
  expect(result.normalizedBefore.medianCalls).toBe(100);
  expect(result.normalizedAfter.medianCalls).toBe(10);
  expect(result.enough).toBe(false);
});
test("worker changes and mixed main sessions remain separate; legacy metrics stay unknown", () => {
  const baseline = sample("sol", false);
  const after = sample("sol", true);
  after.subagents = {
    haiku: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  };
  expect(compareModelCohorts([baseline, after], since).before.sessions).toBe(0);
  const mixed = sample("sol", true);
  mixed.main.opus = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  expect(modelCohort(mixed).key).not.toBe(modelCohort(baseline).key);
  baseline.tasks = undefined;
  baseline.workerTasks = undefined;
  expect(
    compareModelCohorts([baseline], since).normalizedBefore.medianTokensPerCall
  ).toBeUndefined();
});
test("five matching sessions per side satisfy only the reporting floor", () => {
  const result = compareModelCohorts(
    [
      ...Array.from({ length: 5 }, () => sample("sol", false)),
      ...Array.from({ length: 5 }, () => sample("sol", true)),
    ],
    since
  );
  expect(result.enough).toBe(true);
  expect(
    verifyPage({ title: "Change", since, ...result, models: result })
  ).toContain("do not establish that the plugin caused a change");
});
