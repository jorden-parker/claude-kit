import type { LedgerEntry, SessionGroup } from "./ledger.ts";

const counts = [0, 1, 5, 10, 20, 50];
export const scale = "v1";
const metrics = [
  ["A", "Sessions", counts],
  ["B", "Median context tokens", [0, 40000, 80000, 100000, 150000, 200000]],
  ["C", "Median tool-result characters", [0, 10000, 25000, 50000, 100000]],
  ["D", "Median total tokens", [0, 100000, 500000, 1000000, 5000000]],
  ["E", "Cache reads (%)", [0, 25, 50, 75, 90, 100]],
  ["F", "Nudged sessions", counts],
  ["G", "Session context tokens", [0, 40000, 80000, 100000, 150000, 200000]],
  ["H", "Input tokens", [0, 1000, 10000, 50000, 100000]],
  ["I", "Cache writes", [0, 10000, 50000, 100000, 500000]],
  ["J", "Cache reads", [0, 100000, 500000, 1000000, 5000000]],
  ["K", "Output tokens", [0, 1000, 10000, 25000, 50000]],
] as const;

const short = (n: number) => (n >= 1000 ? n / 1000 + "k" : String(n));
export const rows = metrics.map(([id, title, limits]) => ({
  id,
  title,
  choices: [
    ...limits.map((low, i) => {
      const high = limits[i + 1];
      const range =
        high === undefined
          ? id === "E"
            ? "100"
            : short(low) + "+"
          : high === low + 1
            ? short(low)
            : short(low) + "–<" + short(high);
      return { code: id + (i + 1), label: id + (i + 1) + " · " + range, low };
    }),
    { code: id + "?", label: id + "? · Unknown", low: Infinity },
  ],
}));

export function answer(index: number, value?: number) {
  const choices = rows[index].choices;
  if (value === undefined) return choices[choices.length - 1];
  return choices.filter((choice) => choice.low <= value).at(-1)!;
}

function describe(values: (number | undefined)[], start: number) {
  return values
    .map((value, i) => {
      const index = start + i;
      return (
        rows[index].title +
        ": " +
        (value?.toLocaleString("en-US") ?? "Unknown") +
        " → " +
        answer(index, value).label
      );
    })
    .join("\n");
}

export function groupValues(group: SessionGroup) {
  return [
    group.sessions,
    ...[
      group.medianContextTokens,
      group.medianToolResultCharacters,
      group.medianTokens,
      group.cacheReadPercent,
      group.nudgedSessions,
    ].map((n) => (group.sessions ? n : undefined)),
  ];
}

export function groupAnswers(group: SessionGroup) {
  return describe(groupValues(group), 0);
}

export function groupCodes(group: SessionGroup) {
  return groupValues(group)
    .map((value, index) => answer(index, value).code)
    .join("  ");
}

export function sessionAnswers(entry: LedgerEntry) {
  const totals = Object.values(entry.main).concat(
    Object.values(entry.subagents)
  );
  const keys = ["input", "cacheWrite", "cacheRead", "output"] as const;
  return describe(
    [
      entry.contextTokens,
      ...keys.map((key) =>
        totals.length
          ? totals.reduce((sum, model) => sum + model[key], 0)
          : undefined
      ),
    ],
    6
  );
}
