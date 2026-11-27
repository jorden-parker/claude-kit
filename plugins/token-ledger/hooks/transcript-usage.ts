import { existsSync } from "node:fs";
import { listTranscripts } from "./transcript-sync.ts";
import { readFile, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { normalizeUsage, type RequestUsage } from "./usage-metrics.ts";
import { price, type reportPricing } from "./usage-pricing.ts";
import type { LedgerEntry } from "./ledger.ts";

export type TranscriptCall = {
  session: string;
  source: string;
  messageId: string;
  requestId?: string;
  first: number;
  last: number;
  times: Set<number>;
  usage: RequestUsage;
  worker: boolean | undefined;
  workerInvocations?: Set<string>;
  agentType?: string;
  finished: boolean;
};
const safeLabel = (s: unknown) =>
  typeof s === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(s)
    ? s
    : undefined;

async function scanFile(path: string) {
  const source = basename(path, ".jsonl");
  const worker = basename(dirname(path)) === "subagents";
  let agentType: string | undefined;
  if (worker) {
    try {
      agentType = safeLabel(
        JSON.parse(await readFile(path.slice(0, -6) + ".meta.json", "utf8"))
          .agentType
      );
    } catch {}
  }
  const calls = new Map<string, TranscriptCall>();
  let skipped = 0;
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const m = row?.message;
    if (
      !m?.usage ||
      m.model === "<synthetic>" ||
      (row.type && row.type !== "assistant")
    )
      continue;
    const timestamp = Date.parse(row.timestamp);
    const messageId = typeof m.id === "string" ? m.id : undefined;
    if (!messageId || !Number.isFinite(timestamp)) {
      skipped++;
      continue;
    }
    const existing = calls.get(messageId);
    const times = existing?.times ?? new Set<number>();
    times.add(timestamp);
    if (existing && existing.last > timestamp) {
      existing.first = Math.min(existing.first, timestamp);
      continue;
    }
    const workerInvocations = existing?.workerInvocations ?? new Set<string>();
    if (Array.isArray(m.content))
      for (const block of m.content) {
        if (
          block?.type === "tool_use" &&
          ["Task", "Agent"].includes(block.name) &&
          typeof block.id === "string"
        )
          workerInvocations.add(block.id);
      }
    const usage = normalizeUsage(m);
    delete usage.requestedModel;
    usage.resolvedModel = safeLabel(m.model) ?? "unknown";
    calls.set(messageId, {
      source,
      session:
        typeof row.sessionId === "string"
          ? row.sessionId
          : worker
            ? basename(dirname(dirname(path)))
            : source,
      messageId,
      requestId: typeof row.requestId === "string" ? row.requestId : undefined,
      first: Math.min(existing?.first ?? timestamp, timestamp),
      last: timestamp,
      times,
      usage,
      worker,
      workerInvocations: workerInvocations.size ? workerInvocations : undefined,
      agentType: worker
        ? (agentType ?? safeLabel(row.attributionAgent))
        : undefined,
      finished: ["end_turn", "stop_sequence"].includes(m.stop_reason),
    });
  }
  return { calls, skipped };
}

// Cache only reduced usage records. Replacing, appending or deleting a file updates its contribution.
export function createTranscriptIndex(
  home: string,
  config = process.env.CLAUDE_CONFIG_DIR,
  refreshMs = 10000
) {
  const cache = new Map<
    string,
    { signature: string; data: Awaited<ReturnType<typeof scanFile>> }
  >();
  async function scan() {
    const paths = new Set<string>();
    let errors = 0;
    let foundRoot = false;
    for (const root of new Set([
      join(home, ".claude/projects"),
      ...(config ? [join(config, "projects")] : []),
    ]))
      try {
        if (!existsSync(root)) continue;
        foundRoot = true;
        for (const path of listTranscripts(root, true)) paths.add(path);
      } catch {
        errors++;
      }

    for (const path of cache.keys()) if (!paths.has(path)) cache.delete(path);
    for (const path of paths) {
      try {
        const info = await stat(path);
        const side =
          basename(dirname(path)) === "subagents"
            ? await stat(path.slice(0, -6) + ".meta.json").catch(
                () => undefined
              )
            : undefined;
        const signature = [
          info.ino,
          info.size,
          info.mtimeMs,
          side?.mtimeMs,
        ].join(":");
        if (cache.get(path)?.signature !== signature)
          cache.set(path, { signature, data: await scanFile(path) });
      } catch {
        errors++;
        cache.delete(path);
      }
    }
    const unique = new Map<string, TranscriptCall>();
    for (const { data } of cache.values()) {
      errors += data.skipped;
      for (const call of data.calls.values()) {
        const old = unique.get(call.messageId);
        // Replayed conversation history can appear in another file. Prefer the original transcript.
        const rank = (c: TranscriptCall) =>
          Number(c.worker !== false || c.source === c.session);
        if (!old || rank(call) > rank(old)) {
          unique.set(call.messageId, call);
          continue;
        }
        if (rank(call) < rank(old)) continue;
        const latest = call.last > old.last ? call : old;
        const worker = old.worker === call.worker ? call.worker : undefined;
        unique.set(call.messageId, {
          ...latest,
          worker,
          agentType:
            worker && old.agentType === call.agentType
              ? call.agentType
              : undefined,
          first: Math.min(old.first, call.first),
          times: new Set([...old.times, ...call.times]),
        });
      }
    }
    return { calls: [...unique.values()], errors: errors + Number(!foundRoot) };
  }
  let pending: ReturnType<typeof scan> | undefined,
    expires = 0;
  return () => {
    if (!pending || Date.now() >= expires) {
      expires = Infinity;
      pending = scan().finally(() => {
        expires = Date.now() + refreshMs;
      });
    }
    return pending;
  };
}
export function transcriptDay(
  calls: TranscriptCall[],
  day: string,
  zone: string,
  pricing: ReturnType<typeof reportPricing>,
  errors: number
) {
  const format = new Intl.DateTimeFormat("sv-SE", { timeZone: zone });
  const unpricedModels = new Set<string>();
  let configuredCalls = 0;
  let cost = 0,
    count = 0,
    priced = 0,
    cacheRead = 0,
    cacheWrite = 0;
  for (const call of calls) {
    if (format.format(call.first) !== day) continue;
    count++;
    cacheRead += call.usage.cacheRead ?? 0;
    cacheWrite += call.usage.cacheWrite ?? 0;
    const value = price(call.usage, pricing.rates);
    if (value !== undefined) {
      priced++;
      if (Object.hasOwn(pricing.configured, call.usage.resolvedModel))
        configuredCalls++;
      cost += value;
    } else {
      unpricedModels.add(call.usage.resolvedModel);
    }
  }
  return {
    currency: pricing.currency,
    cost: priced || (!count && !errors) ? cost : undefined,
    calls: count,
    configuredCalls,
    unpricedModels: [...unpricedModels].sort(),
    priced,
    errors,
    cacheRead,
    cacheWrite,
    unpriced: priced < count || errors > 0,
  };
}

export type UsageEntry = LedgerEntry & { unattributed?: RequestUsage[] };

export function recentTranscripts(
  calls: TranscriptCall[],
  recorded: LedgerEntry[]
) {
  const groups = new Map<string, TranscriptCall[]>();
  for (const call of calls) {
    const group = groups.get(call.session) ?? [];
    group.push(call);
    groups.set(call.session, group);
  }
  const entries = new Map<string, UsageEntry>(
    recorded.map((e) => [e.session, e])
  );
  const task = () => ({
    task: 1,
    workerCalls: 0,
    resumedWorkers: 0,
    hookDenials: 0,
    requests: [] as RequestUsage[],
  });
  for (const [session, group] of groups) {
    const main = task(),
      worker = task(),
      unknown = task();
    let start = Infinity,
      end = 0,
      lastMain: TranscriptCall | undefined;
    for (const call of group) {
      start = Math.min(start, call.first);
      end = Math.max(end, call.last);
      (call.worker === undefined
        ? unknown
        : call.worker
          ? worker
          : main
      ).requests.push({
        ...call.usage,
        agentType: call.agentType,
      });
      if (call.worker === false)
        main.workerCalls += call.workerInvocations?.size ?? 0;
      if (call.worker === false && (!lastMain || call.last >= lastMain.last))
        lastMain = call;
    }
    entries.set(session, {
      session,
      project: "",
      updatedAt: new Date(end).toISOString(),
      startedAt: new Date(start).toISOString(),
      contextTokens: 0,
      lastNudgeTokens: 0,
      main: {},
      subagents: {},
      resultCharactersByTool: {},
      tasks: [main],
      unattributed: unknown.requests,
      workerTasks: [[worker]],
      sessionState: lastMain?.finished ? "response-finished" : "unknown",
    });
  }
  return [...entries.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 20);
}
