import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeburnEngine } from "./codeburn.ts";
import type { LedgerEntry } from "./ledger.ts";

type Metric = number | undefined;
const numeric = (value: unknown): Metric =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
const plus = (a: Metric, b: Metric) =>
  a === undefined || b === undefined ? undefined : a + b;
type Row = {
  model: string;
  role: string;
  sessions: Set<string>;
  calls: Metric;
  input: Metric;
  output: Metric;
  cacheRead: Metric;
  cacheWrite: Metric;
  cost: Metric;
  basis: Set<string>;
  partial: boolean;
};
export type ExternalUsage = {
  currency: string;
  rows: Row[];
  matched: Set<string>;
  covered: Map<string, Set<string>>;
  costs: Map<string, Metric>;
};
const identity = (model: string, role: string) => JSON.stringify([model, role]);
export function parseExport(data: any, entries: LedgerEntry[]): ExternalUsage {
  const currentSchema = data?.schema === "codeburn.export.v3";
  if (
    (!currentSchema && data?.schema !== "codeburn.export.v2") ||
    !/^[A-Z]{3}$/.test(data.currency?.code ?? "") ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.sessions)
  )
    throw Error("Unsupported Codeburn export");
  const byId = new Map(entries.map((entry) => [entry.session, entry]));
  const rows = new Map<string, Row>(),
    matched = new Set<string>(),
    covered = new Map<string, Set<string>>(),
    costs = new Map<string, Metric>();
  const volumes = new Map<string, Map<string, number>>();
  function include(
    entry: LedgerEntry,
    model: string,
    role: string,
    record: any,
    calls: Metric
  ) {
    const id = entry.session,
      key = identity(model, role);
    const row: Row = rows.get(key) ?? {
      model,
      role,
      sessions: new Set(),
      calls: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      basis: new Set(),
      partial: false,
    };
    const value = numeric(record.cost);
    const basis =
      record.unpriced || record.costBasis === "unpriced"
        ? "Unpriced"
        : (record.costBasis ??
          (record.estimated ? "estimated" : "Codeburn-reported"));
    const cost =
      basis === "Unpriced" ||
      (value === 0 && basis !== "included" && basis !== "recorded")
        ? undefined
        : value;
    row.calls = plus(row.calls, calls);
    for (const field of ["input", "output", "cacheWrite", "cacheRead"] as const)
      row[field] = plus(row[field], numeric(record[field + "Tokens"]));
    row.cost = plus(row.cost, cost);
    row.basis.add(String(basis));
    row.sessions.add(id);
    rows.set(key, row);
    const sessionVolumes = volumes.get(id) ?? new Map<string, number>();
    for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
      const volumeKey = JSON.stringify([model, field]);
      sessionVolumes.set(
        volumeKey,
        (sessionVolumes.get(volumeKey) ?? 0) +
          (numeric(record[field + "Tokens"]) ?? 0)
      );
    }
    volumes.set(id, sessionVolumes);
    costs.set(id, plus(matched.has(id) ? costs.get(id) : 0, cost));
    matched.add(id);
    const keys = covered.get(id) ?? new Set();
    keys.add(key);
    covered.set(id, keys);
  }
  for (const r of data.records) {
    const entry = byId.get(r?.sessionId);
    if (
      !entry ||
      (r.provider && r.provider !== "claude") ||
      typeof r.model !== "string"
    )
      continue;
    const main = Object.hasOwn(entry.main, r.model),
      worker = Object.hasOwn(entry.subagents, r.model);
    const role = r.subagentType
      ? "Worker"
      : main !== worker
        ? main
          ? "Main"
          : "Worker"
        : "Role unavailable";
    include(entry, r.model, role, r, r.supplementary ? 0 : 1);
  }
  for (const r of data.sessions) {
    const entry = byId.get(currentSchema ? r?.sessionId : r?.["Session ID"]);
    if (!entry || matched.has(entry.session)) continue;
    include(
      entry,
      "Session total",
      "Role unavailable",
      { cost: currentSchema ? r.cost : r["Cost (" + data.currency.code + ")"] },
      numeric(currentSchema ? r.apiCalls : r["API Calls"])
    );
  }
  for (const entry of entries) {
    const keys = covered.get(entry.session);
    if (!keys || keys.has(identity("Session total", "Role unavailable")))
      continue;
    for (const model of new Set([
      ...Object.keys(entry.main),
      ...Object.keys(entry.subagents),
    ])) {
      const observed = volumes.get(entry.session);
      const partial = (
        ["input", "output", "cacheRead", "cacheWrite"] as const
      ).some(
        (field) =>
          (observed?.get(JSON.stringify([model, field])) ?? 0) <
          (entry.main[model]?.[field] ?? 0) +
            (entry.subagents[model]?.[field] ?? 0)
      );
      if (partial) {
        costs.set(entry.session, undefined);
        for (const role of ["Main", "Worker", "Role unavailable"]) {
          const row = rows.get(identity(model, role));
          if (row?.sessions.has(entry.session)) row.partial = true;
        }
      }
    }
    for (const [role, models] of [
      ["Main", entry.main],
      ["Worker", entry.subagents],
    ] as const)
      for (const [model, usage] of Object.entries(models))
        if (
          Object.values(usage).some((n) => n > 0) &&
          !keys.has(identity(model, role)) &&
          !keys.has(identity(model, "Role unavailable"))
        )
          costs.set(entry.session, undefined);
  }
  return {
    currency: data.currency.code,
    rows: [...rows.values()],
    matched,
    covered,
    costs,
  };
}
async function exportUsage(
  home: string,
  from: string,
  to: string,
  zone: string
) {
  const engine = codeburnEngine(home);
  if (!engine) throw Error("Codeburn unavailable");
  const dir = await mkdtemp(join(tmpdir(), "ledger-codeburn-"));
  try {
    const file = join(dir, "usage.json");
    const child = Bun.spawn(
      [
        ...engine.command,
        "--timezone",
        zone,
        "export",
        "--provider",
        "claude",
        "--from",
        from,
        "--to",
        to,
        "--format",
        "json",
        "--output",
        file,
      ],
      {
        env: engine.env,
        stdout: "ignore",
        stderr: "ignore",
      }
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      if ((await child.exited) !== 0) throw Error("Codeburn export failed");
    } finally {
      clearTimeout(timer);
    }
    return JSON.parse(await readFile(file, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function loadCodeburnUsage(home: string, entries: LedgerEntry[]) {
  const dates = entries
    .flatMap((e) => [e.startedAt, e.updatedAt])
    .filter((s): s is string => !!s)
    .sort();
  return parseExport(
    await exportUsage(
      home,
      dates[0].slice(0, 10),
      dates.at(-1)!.slice(0, 10),
      "UTC"
    ),
    entries
  );
}
export async function loadDay(home: string, day: string, zone: string) {
  return parseDay(await exportUsage(home, day, day, zone), day);
}
export function parseDay(data: any, day: string) {
  const v3 = data?.schema === "codeburn.export.v3";
  if (
    (!v3 && data?.schema !== "codeburn.export.v2") ||
    !Array.isArray(data.periods) ||
    !Array.isArray(data.records) ||
    !/^[A-Z]{3}$/.test(data.currency?.code ?? "")
  )
    throw Error("Unsupported Codeburn export");
  const currency = data.currency.code as string;
  const daily = data.periods
    .flatMap((period: any) => period.daily ?? [])
    .find((row: any) => (v3 ? row.date : row.Date) === day);
  const unpriced = data.records.some(
    (r: any) =>
      r.unpriced ||
      r.costBasis === "unpriced" ||
      (r.cost === 0 &&
        !["included", "recorded", "calculated"].includes(r.costBasis) &&
        (r.inputTokens ||
          r.outputTokens ||
          r.cacheReadTokens ||
          r.cacheWriteTokens))
  );
  return {
    currency,
    cost: daily
      ? numeric(v3 ? daily.cost : daily["Cost (" + currency + ")"])
      : data.records.length
        ? undefined
        : 0,
    unpriced,
    calls: daily ? numeric(v3 ? daily.apiCalls : daily["API Calls"]) : 0,
  };
}
export function liveCodeburn(
  home: string,
  load = loadCodeburnUsage,
  notify = () => {}
) {
  let snapshot: ExternalUsage | undefined,
    displayed = "",
    attempted = "",
    pending = false,
    next = 0,
    message = "";
  return (entries: LedgerEntry[]) => {
    const key = JSON.stringify(entries.map((e) => e.session));
    if (
      entries.length &&
      !pending &&
      (key !== attempted || Date.now() >= next)
    ) {
      pending = true;
      attempted = key;
      message = "Refreshing Codeburn";
      void load(home, entries)
        .then(
          (result) => {
            snapshot = result;
            displayed = key;
            message = "";
          },
          (error) => {
            message =
              error instanceof Error &&
              [
                "Unsupported Codeburn export",
                "Codeburn unavailable",
                "Codeburn export failed",
              ].includes(error.message)
                ? error.message
                : "Could not read Codeburn export";
          }
        )
        .finally(() => {
          pending = false;
          next = Date.now() + 15000;
          notify();
        });
    }
    return { data: displayed === key ? snapshot : undefined, message };
  };
}
