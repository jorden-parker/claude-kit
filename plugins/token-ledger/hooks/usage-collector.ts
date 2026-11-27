import { codeburnDiscovery, type CodeburnStatus } from "./codeburn.ts";
import { createTranscriptSync } from "./transcript-sync.ts";
export function createUsageCollector(
  home: string,
  discover: (home: string) => Promise<CodeburnStatus> = codeburnDiscovery
) {
  const sync = createTranscriptSync(home);
  let discovery: CodeburnStatus = {
    roots: [],
    message: "Checking local Codeburn installation",
  };
  let checkedAt = 0;
  let lastSync = 0;
  let lastCutoff: string | undefined;
  let totals = 0;
  let result = {
    transcript: "Waiting for first scan",
    codeburn: discovery.message,
  };
  let pending: Promise<typeof result> | undefined;
  return (cutoff?: string) => {
    if (pending) return pending;
    if (cutoff === lastCutoff && Date.now() - lastSync < 1500)
      return Promise.resolve(result);
    pending = (async () => {
      if (Date.now() - checkedAt > 60_000) {
        discovery = await discover(home);
        checkedAt = Date.now();
      }
      const status = sync(cutoff, discovery.roots);
      totals += status.synced;
      lastSync = Date.now();
      lastCutoff = cutoff;
      result = {
        transcript: `${totals} session refreshes · ${status.found} recently modified transcripts · ${status.pending} awaiting usage · ${status.errors} read errors`,
        codeburn: discovery.message,
      };
      return result;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
