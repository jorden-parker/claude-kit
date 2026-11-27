import { compareModelCohorts } from "./model-comparison.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createUsageCollector } from "./usage-collector.ts";
import type { CodeburnStatus } from "./codeburn.ts";
import { readRecorderStatus } from "./recorder.ts";
import { recordingStatus } from "./recording-status.ts";
import { compareSessions, readFixes, readNewestEntries } from "./ledger.ts";
import { verifyPage } from "./verify-page.ts";

export function startVerifyServer(
  userHome: string,
  options: { discover?: (home: string) => Promise<CodeburnStatus> } = {}
) {
  const collect = createUsageCollector(userHome, options.discover);
  const path = "/" + crypto.randomUUID();
  const comparisonPath = join(
    userHome,
    ".cache/token-ledger/verify-comparison.json"
  );
  let selectedDeployment: string | undefined;
  try {
    selectedDeployment = JSON.parse(readFileSync(comparisonPath, "utf8")).since;
  } catch {}
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== path)
        return new Response("Not found", { status: 404 });
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      const fixes = readFixes(userHome).sort((a, b) =>
        b.appliedAt.localeCompare(a.appliedAt)
      );
      const requested = new URL(request.url).searchParams.get("deployment");
      if (requested && !fixes.some((fix) => fix.appliedAt === requested))
        return new Response("Unknown deployment", { status: 400 });
      if (requested && requested !== selectedDeployment) {
        selectedDeployment = requested;
        try {
          mkdirSync(join(userHome, ".cache/token-ledger"), { recursive: true });
          writeFileSync(comparisonPath, JSON.stringify({ since: requested }), {
            mode: 0o600,
          });
        } catch {}
      }
      const fix =
        fixes.find((fix) => fix.appliedAt === selectedDeployment) ?? fixes[0];
      const collection = await collect(fix?.appliedAt);
      const sessions = readNewestEntries(userHome, Infinity);
      const models = fix
        ? compareModelCohorts(
            sessions,
            fix.appliedAt,
            new URL(request.url).searchParams.get("cohort") ?? undefined
          )
        : undefined;
      return new Response(
        verifyPage(
          fix && {
            title: fix.title,
            since: fix.appliedAt,
            ...(models ?? compareSessions(sessions, fix.appliedAt)),
            models,
          },
          true,
          recordingStatus(
            sessions,
            fix?.appliedAt,
            readRecorderStatus(userHome),
            readRecorderStatus(userHome, "recorder-launch.json"),
            collection
          ),
          fix
            ? {
                selected: fix.appliedAt,
                options: fixes.map((fix) => ({
                  title: fix.title,
                  since: fix.appliedAt,
                })),
              }
            : undefined
        ),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
          },
        }
      );
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}${path}` };
}
