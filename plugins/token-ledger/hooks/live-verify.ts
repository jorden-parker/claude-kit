import { loadDay } from "./codeburn-usage.ts";
import { dailyPage, dayTotal } from "./daily-page.ts";
import { liveCodeburn, type loadCodeburnUsage } from "./codeburn-usage.ts";
import { shareUsagePage } from "./share-usage.ts";
import { parseRates } from "./usage-metrics.ts";
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
  options: {
    loadDaily?: typeof loadDay;
    loadUsage?: typeof loadCodeburnUsage;
    discover?: (home: string) => Promise<CodeburnStatus>;
  } = {}
) {
  const collect = createUsageCollector(userHome, options.discover);
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const event = new TextEncoder().encode("event: usage\ndata: updated\n\n");
  const external = liveCodeburn(userHome, options.loadUsage, () => {
    for (const listener of listeners) listener.enqueue(event);
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  type DailyData = Awaited<ReturnType<typeof loadDay>>;
  type DailyReading = { at: number; data?: DailyData; pending?: Promise<void> };
  const days = new Map<string, DailyReading>();
  function dailyReading(day: string) {
    let cached = days.get(day);
    if (!cached) {
      if (days.size >= 16) days.delete(days.keys().next().value!);
      cached = { at: 0 };
      days.set(day, cached);
    }
    const reading = cached;
    if (!reading.pending && Date.now() - reading.at >= 60000) {
      reading.pending = (options.loadDaily ?? loadDay)(userHome, day, zone)
        .then(
          (data) => {
            reading.data = data;
          },
          () => {
            reading.data = undefined;
          }
        )
        .finally(() => {
          reading.at = Date.now();
          reading.pending = undefined;
        });
    }
    return reading;
  }
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
    async fetch(request, connection) {
      const pathname = new URL(request.url).pathname;
      if (
        request.method === "GET" &&
        ["/assets/geist-sans.woff2", "/assets/geist-mono.woff2"].includes(
          pathname
        )
      ) {
        return new Response(
          Bun.file(new URL(".." + pathname, import.meta.url)),
          {
            headers: {
              "Content-Type": "font/woff2",
              "Cache-Control": "private, max-age=86400",
            },
          }
        );
      }
      if (pathname === path + "/events" && request.method === "GET") {
        connection.timeout(request, 0);
        let subscriber: ReadableStreamDefaultController<Uint8Array>;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              subscriber = controller;
              listeners.add(controller);
              controller.enqueue(new TextEncoder().encode(": connected\n\n"));
            },
            cancel() {
              listeners.delete(subscriber);
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
            },
          }
        );
      }
      if (pathname !== path) return new Response("Not found", { status: 404 });
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      const day = new URL(request.url).searchParams.get("day");
      if (day !== null) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day)) ||
          new Date(day).toISOString().slice(0, 10) !== day
        )
          return new Response("Invalid date", { status: 400 });
        const reading = dailyReading(day);
        await reading.pending;
        const report = dailyPage(day, zone, reading.data);
        return new Response(report, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
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

      const query = new URL(request.url).searchParams;
      if (
        !requested &&
        !query.has("cohort") &&
        query.get("view") !== "comparison"
      ) {
        void collect(fix?.appliedAt).catch(() => {});
        const sample = readNewestEntries(userHome, 20);
        const today = new Date().toLocaleDateString("sv-SE", {
          timeZone: zone,
        });
        const reading = dailyReading(today);
        return new Response(
          shareUsagePage(
            sample,
            parseRates(process.env.TOKEN_LEDGER_PRICING),
            external(sample),
            dayTotal(
              today,
              zone,
              reading.data,
              !!reading.pending && !reading.at
            )
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
      }
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
