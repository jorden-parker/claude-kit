import type { RecorderStatus } from "./recorder.ts";
import type { LedgerEntry } from "./ledger.ts";

export function recordingStatus(
  entries: LedgerEntry[],
  cutoff?: string,
  recorder?: RecorderStatus,
  launch?: RecorderStatus
) {
  const latest = [...entries].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )[0];
  const updated = cutoff
    ? entries.filter((entry) => entry.updatedAt >= cutoff)
    : [];
  const qualifying = cutoff
    ? updated.filter(
        (entry) => entry.startedAt !== undefined && entry.startedAt >= cutoff
      )
    : [];
  const code = !cutoff
    ? "D0"
    : !latest
      ? "D1"
      : !updated.length
        ? "D2"
        : !qualifying.length
          ? "D3"
          : "D4";
  const messages: Record<string, string> = {
    D0: "No deployment recorded. There is no After cutoff yet.",
    D1: "No session results recorded on this machine yet.",
    D2: "No results recorded since this deployment. The recording hook has not delivered a new result.",
    D3: "Results are arriving, but their sessions started before deployment or have no recorded start time. They are excluded from After.",
    D4: "Receiving After results. The session count increases only for another qualifying session; another response updates the existing session's readings.",
  };
  return {
    code,
    message: messages[code],
    deployment: cutoff ?? "Unknown",
    latestStartedAt: latest?.startedAt ?? "Unknown",
    latestUpdatedAt: latest?.updatedAt ?? "Unknown",
    qualifyingSessions: qualifying.length,
    excludedSessions: updated.length - qualifying.length,
    recorder,
    launch,
  };
}

export function formatRecordingStatus(
  status: ReturnType<typeof recordingStatus>
) {
  return [
    status.code + " · " + status.message,
    "Deployment cutoff: " + status.deployment,
    "Latest recorded session started: " + status.latestStartedAt,
    "Latest result recorded: " + status.latestUpdatedAt,
    "Recorder launch: " +
      (status.launch
        ? status.launch.outcome + " · " + status.launch.updatedAt
        : "No launcher attempt recorded yet"),
    "Recorder result: " +
      (status.recorder
        ? status.recorder.outcome +
          (status.recorder.reason ? " · " + status.recorder.reason : "") +
          " · " +
          status.recorder.updatedAt
        : "No runtime attempt recorded yet"),
    "After sessions: " +
      status.qualifyingSessions +
      "; excluded since deployment: " +
      status.excludedSessions,
  ].join("\n");
}
