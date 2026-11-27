import { compareSessions, type LedgerEntry } from "./ledger.ts";

function modelNames(values: LedgerEntry["main"]) {
  return Object.entries(values)
    .filter(
      ([, usage]) =>
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0
    )
    .map(([model]) => model)
    .sort();
}
export function modelCohort(entry: LedgerEntry) {
  const main = modelNames(entry.main);
  const workers = modelNames(entry.subagents);
  return {
    main,
    workers,
    key: JSON.stringify([main, workers]),
    label:
      "Main: " +
      (main.join(", ") || "Unknown") +
      " · Workers: " +
      (workers.join(", ") || "None recorded"),
    known: main.length > 0 && ![...main, ...workers].includes("unknown"),
  };
}
const median = (values: number[]) => {
  if (!values.length) return undefined;
  const sorted = values.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
function normalized(entries: LedgerEntry[]) {
  const measured = entries.flatMap((entry) => {
    if (!entry.tasks || !entry.workerTasks) return [];
    const requests = [...entry.tasks, ...entry.workerTasks.flat()].flatMap(
      (task) => task.requests
    );
    if (
      !requests.length ||
      requests.some((request) =>
        [
          request.input,
          request.output,
          request.cacheRead,
          request.cacheWrite,
        ].some((value) => value === undefined)
      )
    )
      return [];
    if (Object.keys(entry.subagents).length && !entry.workerTasks.length)
      return [];
    const tokens = requests.reduce(
      (sum, request) =>
        sum +
        request.input! +
        request.output! +
        request.cacheRead! +
        request.cacheWrite!,
      0
    );
    return [
      {
        calls: requests.length,
        perCall: tokens / requests.length,
        cost: requests.every((request) => request.estimatedCost !== undefined)
          ? requests.reduce((sum, request) => sum + request.estimatedCost!, 0)
          : undefined,
      },
    ];
  });
  return {
    sessionsMeasured: measured.length,
    medianCalls: median(measured.map((value) => value.calls)),
    medianTokensPerCall: median(measured.map((value) => value.perCall)),
    medianEstimatedCost:
      measured.length === entries.length &&
      measured.every((value) => value.cost !== undefined)
        ? median(measured.map((value) => value.cost!))
        : undefined,
    medianMinutes: median(
      entries.flatMap((entry) =>
        entry.startedAt &&
        Date.parse(entry.updatedAt) >= Date.parse(entry.startedAt)
          ? [
              (Date.parse(entry.updatedAt) - Date.parse(entry.startedAt)) /
                60_000,
            ]
          : []
      )
    ),
    working: entries.filter((entry) => entry.sessionState === "working").length,
    responseFinished: entries.filter(
      (entry) => entry.sessionState === "response-finished"
    ).length,
  };
}
export function compareModelCohorts(
  entries: LedgerEntry[],
  since: string,
  requested?: string
) {
  const before = entries.filter((entry) => entry.updatedAt < since);
  const after = entries.filter(
    (entry) =>
      entry.updatedAt >= since &&
      entry.startedAt !== undefined &&
      entry.startedAt >= since
  );
  const options = [
    ...new Map(
      [...before, ...after].map((entry) => {
        const cohort = modelCohort(entry);
        return [cohort.key, cohort];
      })
    ).values(),
  ];
  const current = [...after].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )[0];
  const selected =
    options.find((option) => option.key === requested) ??
    (current ? modelCohort(current) : options[0]);
  const matches = (entry: LedgerEntry) =>
    selected !== undefined && modelCohort(entry).key === selected.key;
  const matchedBefore = before.filter(matches);
  const matchedAfter = after.filter(matches);
  const comparison = compareSessions(entries.filter(matches), since);
  return {
    ...comparison,
    selected,
    options,
    allBefore: before.length,
    allAfter: after.length,
    enough:
      selected?.known === true &&
      matchedBefore.length >= 5 &&
      matchedAfter.length >= 5,
    normalizedBefore: normalized(matchedBefore),
    normalizedAfter: normalized(matchedAfter),
    distribution: options.map((option) => ({
      main: option.main,
      workers: option.workers,
      selected: option.key === selected?.key,
      label: option.label,
      before: before.filter((entry) => modelCohort(entry).key === option.key)
        .length,
      after: after.filter((entry) => modelCohort(entry).key === option.key)
        .length,
    })),
  };
}
