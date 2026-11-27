import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LedgerEntry } from "../hooks/ledger.ts";

export function summarizeRuns(entries: LedgerEntry[]) {
  const tasks = entries.flatMap((entry) => [
    ...(entry.tasks ?? []),
    ...(entry.workerTasks ?? []).flat(),
  ]);
  const requests = tasks.flatMap((task) => task.requests);
  const complete =
    entries.length > 0 &&
    entries.every(
      (entry) =>
        entry.tasks !== undefined &&
        entry.workerTasks !== undefined &&
        [...entry.tasks, ...entry.workerTasks.flat()].every(
          (task) => task.requests.length > 0
        ) &&
        (entry.tasks.every((task) => task.workerCalls === 0) ||
          entry.workerTasks.length > 0)
    ) &&
    requests.length > 0 &&
    requests.every((request) => request.estimatedCost !== undefined);
  return {
    sessions: entries.length,
    workerCalls: tasks.reduce((sum, task) => sum + task.workerCalls, 0),
    resumes: tasks.reduce((sum, task) => sum + task.resumedWorkers, 0),
    hookDenials: tasks.reduce((sum, task) => sum + task.hookDenials, 0),
    estimatedCost: complete
      ? requests.reduce((sum, request) => sum + request.estimatedCost!, 0)
      : "unknown",
    reasoning:
      requests.length &&
      requests.every((request) => request.reasoning !== undefined)
        ? requests.reduce((sum, request) => sum + request.reasoning!, 0)
        : "unknown",
    correctness: "record in run sheet",
    elapsedSeconds: "record in run sheet",
  };
}
if (import.meta.main) {
  const folders = process.argv.slice(2);
  if (folders.length !== 2) {
    console.error(
      "Usage: bun compare-runs.ts <baseline-folder> <candidate-folder>"
    );
    process.exit(2);
  }
  for (const [index, folder] of folders.entries()) {
    const entries = readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map(
        (name) =>
          JSON.parse(readFileSync(join(folder, name), "utf8")) as LedgerEntry
      );
    console.log(
      JSON.stringify({
        group: index ? "candidate" : "baseline",
        ...summarizeRuns(entries),
      })
    );
  }
}
