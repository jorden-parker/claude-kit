import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  recordSession,
  summarizeTranscript,
  readNewestEntries,
} from "./ledger.ts";

export type SyncStatus = {
  synced: number;
  found: number;
  errors: number;
  pending: number;
};
function listTranscripts(root: string, depth = 0): string[] {
  if (depth > 12 || !existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === "subagents") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...listTranscripts(path, depth + 1));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(path);
  }
  return result;
}
function sourceMetadata(text: string) {
  let cwd = "";
  let latest = "";
  for (const line of text.split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.cwd === "string") cwd ||= entry.cwd;
      if (
        typeof entry?.timestamp === "string" &&
        Number.isFinite(Date.parse(entry.timestamp)) &&
        entry.timestamp > latest
      )
        latest = entry.timestamp;
    } catch {}
  }
  return { cwd, latest };
}
export function createTranscriptSync(
  home: string,
  configRoot = process.env.CLAUDE_CONFIG_DIR,
  allHistory = false
) {
  const seen = new Map<string, string>();
  const legacy = new Map(
    (allHistory ? [] : readNewestEntries(home, 20))
      .filter((entry) => !entry.tasks || !entry.workerTasks)
      .map((entry) => [entry.session, entry])
  );
  let previousCutoff: string | undefined;
  return (
    cutoff: string | undefined,
    additionalRoots: string[] = []
  ): SyncStatus => {
    if (cutoff !== previousCutoff) {
      seen.clear();
      previousCutoff = cutoff;
    }
    const status = { synced: 0, found: 0, errors: 0, pending: 0 };
    const boundary = allHistory ? 0 : cutoff ? Date.parse(cutoff) : Infinity;
    if (!legacy.size && !Number.isFinite(boundary)) return status;
    const roots = new Set([
      join(home, ".claude/projects"),
      ...(configRoot ? [join(configRoot, "projects")] : []),
      ...additionalRoots,
    ]);
    const paths = new Set<string>();
    for (const root of roots) {
      try {
        for (const path of listTranscripts(root)) paths.add(path);
      } catch {
        status.errors++;
      }
    }
    for (const path of paths) {
      try {
        const stats = statSync(path);
        const id = basename(path, ".jsonl");
        const target = join(home, ".cache/token-ledger/sessions", id + ".json");
        let existing;
        try {
          existing = JSON.parse(readFileSync(target, "utf8"));
        } catch {}
        const old =
          allHistory && existing && (!existing.tasks || !existing.workerTasks)
            ? existing
            : legacy.get(id);
        if (old) {
          const recovered = recordSession(
            { session_id: id, transcript_path: path, cwd: old.project },
            home,
            new Date(old.updatedAt),
            { background: true, restoreDetails: old }
          );
          if (recovered) status.synced++;
          legacy.delete(id);
        }
        if (!Number.isFinite(boundary)) continue;
        const children = join(path.slice(0, -6), "subagents");
        const childSignature = existsSync(children)
          ? readdirSync(children)
              .filter((name) => name.endsWith(".jsonl"))
              .map((name) => {
                const child = statSync(join(children, name));
                return name + child.size + child.mtimeMs;
              })
              .join(":")
          : "";
        if (stats.mtimeMs < boundary && !childSignature) continue;
        const signature =
          stats.size + ":" + stats.mtimeMs + ":" + childSignature;
        status.found++;
        if (seen.get(path) === signature) continue;
        const text = readFileSync(path, "utf8");
        const summary = summarizeTranscript(text);
        const { cwd, latest } = sourceMetadata(text);
        if (!latest || !Object.keys(summary.byModel).length) {
          status.pending++;
          continue;
        }
        let lastSourceTime = latest;
        if (existsSync(children))
          for (const name of readdirSync(children).filter((name) =>
            name.endsWith(".jsonl")
          )) {
            const childLatest = sourceMetadata(
              readFileSync(join(children, name), "utf8")
            ).latest;
            if (childLatest > lastSourceTime) lastSourceTime = childLatest;
          }
        if (Date.parse(lastSourceTime) < boundary) {
          seen.set(path, signature);
          continue;
        }
        if (
          existing?.updatedAt &&
          Date.parse(existing.updatedAt) >= Date.parse(lastSourceTime)
        ) {
          seen.set(path, signature);
          continue;
        }
        if (
          recordSession(
            {
              session_id: id,
              transcript_path: path,
              cwd: cwd || existing?.project || "Unknown project",
            },
            home,
            new Date(lastSourceTime),
            { background: true }
          )
        )
          status.synced++;
        seen.set(path, signature);
      } catch {
        status.errors++;
      }
    }
    return status;
  };
}
