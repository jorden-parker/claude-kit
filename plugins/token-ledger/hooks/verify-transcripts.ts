import type { TranscriptCall } from "./transcript-usage.ts";
import { fields } from "./usage-pricing.ts";

// Reserve one export record per call. A collision on the strongest shared key is inconclusive.
export function verifyTranscripts(
  records: any[],
  calls: TranscriptCall[],
  sessions: Set<string>,
  evidence?: { roles: Map<object, string>; ambiguous: Set<object> }
) {
  const indexes = new Map<string, Set<TranscriptCall>>();
  const candidates = calls.filter((c) => sessions.has(c.session));
  const sources = new Set([...sessions, ...candidates.map((c) => c.source)]);
  function add(key: string, c: TranscriptCall) {
    const set = indexes.get(key) ?? new Set();
    set.add(c);
    indexes.set(key, set);
  }
  for (const c of candidates)
    for (const source of new Set([c.source, c.session])) {
      add(JSON.stringify([source, "message", c.messageId]), c);
      if (c.requestId) add(JSON.stringify([source, "request", c.requestId]), c);
      for (const t of c.times)
        add(JSON.stringify([source, c.usage.resolvedModel, t]), c);
    }
  const pairs = new Map<TranscriptCall, any[]>();
  let missingTranscript = 0,
    inconclusive = 0,
    matched = 0,
    mismatched = 0;
  for (const r of records) {
    if (
      !sources.has(r?.sessionId) ||
      r.supplementary ||
      (r.provider && r.provider !== "claude")
    )
      continue;
    const keys = r.messageId
      ? ["message", r.messageId]
      : r.requestId
        ? ["request", r.requestId]
        : [r.model, Date.parse(r.timestamp)];
    const set = indexes.get(JSON.stringify([r.sessionId, ...keys]));
    if (!set) {
      missingTranscript++;
      continue;
    }
    if (set.size !== 1) {
      evidence?.ambiguous.add(r);
      inconclusive++;
      continue;
    }
    const call = [...set][0];
    const rows = pairs.get(call) ?? [];
    rows.push(r);
    pairs.set(call, rows);
  }
  for (const [call, rows] of pairs) {
    if (rows.length !== 1) {
      for (const r of rows) evidence?.ambiguous.add(r);
      inconclusive += rows.length;
      continue;
    }
    const r = rows[0];
    if (call.worker !== undefined)
      evidence?.roles.set(r, call.worker ? "Worker" : "Main");
    if (
      (r.requestId && call.requestId && r.requestId !== call.requestId) ||
      r.model !== call.usage.resolvedModel ||
      (r.subagentType &&
        (call.worker === false ||
          (call.agentType && r.subagentType !== call.agentType))) ||
      fields.some(
        (f) =>
          typeof r[f + "Tokens"] === "number" &&
          call.usage[f] !== undefined &&
          call.usage[f] !== r[f + "Tokens"]
      )
    )
      mismatched++;
    else if (
      (Boolean(r.subagentType) && call.worker === undefined) ||
      fields.some(
        (f) =>
          typeof r[f + "Tokens"] !== "number" || call.usage[f] === undefined
      )
    )
      inconclusive++;
    else matched++;
  }
  return {
    matched,
    mismatched,
    missingTranscript,
    inconclusive,
    missingExport: candidates.filter((c) => !pairs.has(c)).length,
  };
}
