import { recordingStatus, formatRecordingStatus } from "./recording-status.ts";
import { startVerifyServer } from "./live-verify.ts";
import { homedir } from "node:os";
import { entries, formPage, html, save, summary } from "./checkin-form.ts";
import { groupCodes, sessionAnswers, scale } from "./checkins.ts";
import { composeLedgerPage } from "./ledger-page.ts";
import {
  compareSessions,
  formatReport,
  formatAnalysis,
  formatVerification,
  verificationAnswers,
  readFixes,
  readNewestEntries,
  recordFix,
  recordReplyMeter,
  recordSession,
  takeReplyNote,
  waitForLastReply,
} from "./ledger.ts";

const LAST_REPLY_PAUSE_MILLISECONDS = 50;
const LAST_REPLY_ATTEMPTS = 40;
const userHome = process.env.HOME ?? homedir();
const command = process.argv[2];
const sessionCount = Number(process.argv[3]) || Infinity;

function printWorkResults() {
  console.log("\nManually entered work results\n" + summary(entries(userHome)));
}

if (command === "diagnose") {
  const fix = readFixes(userHome).sort((a, b) =>
    b.appliedAt.localeCompare(a.appliedAt)
  )[0];
  console.log(
    formatRecordingStatus(
      recordingStatus(readNewestEntries(userHome, Infinity), fix?.appliedAt)
    )
  );
} else if (command === "analyze") {
  const limit = Number(process.argv[3] ?? 40);
  if (process.argv.length > 4 || !Number.isSafeInteger(limit) || limit < 1) {
    console.error("Usage: claude-ledger analyze [positive session count]");
    process.exit(2);
  }
  console.log(formatAnalysis(readNewestEntries(userHome, limit)));
  printWorkResults();
} else if (command === "browser-verify") {
  const { url } = startVerifyServer(userHome);
  console.log(url);
  const opener = Bun.spawn([
    process.platform === "darwin" ? "open" : "xdg-open",
    url,
  ]);
  process.exitCode = await opener.exited;
  console.log(
    "Live deployment check-in. Keep this command running; Ctrl-C closes the local report."
  );
} else if (command === "report") {
  console.log(formatReport(readNewestEntries(userHome, sessionCount)));
} else if (command === "fixed") {
  const title = process.argv[3];
  if (!title) {
    console.error('Usage: claude-ledger --fixed "<title>"');
    process.exit(2);
  }
  recordFix(userHome, title);
  console.log(`Recorded fix: ${title}`);
} else if (command === "verify" || command === "compact-verify") {
  const date = process.argv[3];
  if (
    date !== undefined &&
    (Number.isNaN(Date.parse(date)) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(date) &&
        new Date(date).toISOString().slice(0, 10) !== date))
  ) {
    console.error("Usage: claude-ledger --verify [YYYY-MM-DD]");
    process.exit(2);
  }
  const checks = date
    ? [
        {
          title: "Sessions before and after " + date,
          since: new Date(date).toISOString(),
        },
      ]
    : readFixes(userHome).map((fix) => ({
        title: fix.title,
        since: fix.appliedAt,
      }));
  const sessions = readNewestEntries(userHome, Infinity);
  if (command === "compact-verify") {
    const check = checks.sort((a, b) => b.since.localeCompare(a.since))[0];
    if (check) {
      const { before, after } = compareSessions(sessions, check.since);
      console.log(
        [
          check.title + " · " + check.since.slice(0, 10),
          "Laptop check-in · " +
            scale +
            " · On your personal laptop, open claude-ledger → Record work results.",
          "Choose Before or After in the form, then select the matching codes shown below.",
          "Before   " +
            groupCodes(before) +
            "   (" +
            before.sessions +
            " sessions)",
          "After    " +
            groupCodes(after) +
            "   (" +
            after.sessions +
            " sessions)",
          ...(after.sessions < 5
            ? ["Too early to judge: fewer than five follow-up sessions."]
            : []),
        ].join("\n")
      );
    } else {
      console.log(
        "No fixes recorded. Use claude-ledger verify since YYYY-MM-DD."
      );
    }
    console.log("Full report: claude-ledger verify all");
  } else {
    console.log(
      checks.length
        ? formatVerification(sessions, checks) +
            "\n\n" +
            verificationAnswers(sessions, checks)
        : "No fixes recorded. Pass a date: claude-ledger --verify YYYY-MM-DD"
    );
    printWorkResults();
  }
} else if (command === "checkins") {
  console.log(summary(entries(userHome)));
} else if (command === "table") {
  const prefix = "/" + crypto.randomUUID();
  const formPath = prefix + "/record";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 8192,
    async fetch(request) {
      const url = new URL(request.url);
      const response = (body: string) =>
        new Response(body, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
          },
        });
      if (url.pathname === formPath && request.method === "POST") {
        if (request.headers.get("origin") !== url.origin)
          return new Response("Forbidden", { status: 403 });
        const form = new URLSearchParams(await request.text());
        try {
          save(userHome, form);
        } catch {
          return new Response("Could not save selections", { status: 400 });
        }
        const query = new URLSearchParams({
          experiment: form.get("experiment")!.trim(),
          phase: form.get("phase")!,
          saved: "1",
        });
        return Response.redirect(url.origin + formPath + "?" + query, 303);
      }
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      if (url.pathname === formPath)
        return response(formPage(entries(userHome), url.searchParams));
      if (url.pathname !== prefix)
        return new Response("Unknown page", { status: 404 });
      const sessions = readNewestEntries(userHome, Infinity);
      const fixes = readFixes(userHome).map((fix) => ({
        title: fix.title,
        since: fix.appliedAt,
      }));
      const shown = sessions.slice(0, sessionCount);
      const section =
        "<section><h2>Laptop check-in · " +
        scale +
        '</h2><a href="' +
        formPath +
        '">Record work results</a>' +
        fixes
          .map(
            (fix) =>
              "<details><summary>" +
              html(fix.title) +
              "</summary><pre>" +
              html(verificationAnswers(sessions, [fix])) +
              "</pre></details>"
          )
          .join("") +
        shown
          .map(
            (session) =>
              "<details><summary>Single session · " +
              html(
                session.project +
                  " · " +
                  session.updatedAt +
                  " · " +
                  session.session
              ) +
              "</summary><pre>" +
              html(sessionAnswers(session)) +
              "</pre></details>"
          )
          .join("") +
        "</section>";
      return response(composeLedgerPage(shown, section));
    },
  });
  const url = "http://127.0.0.1:" + server.port + prefix;
  console.log(url);
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url]);
  console.log("Press Ctrl-C to close this local report.");
} else {
  try {
    const event = JSON.parse(await Bun.stdin.text());
    if (command === "nudge") {
      const output = takeReplyNote(event.session_id, userHome);
      if (output) console.log(JSON.stringify(output));
    } else {
      await waitForLastReply(
        event.transcript_path,
        LAST_REPLY_PAUSE_MILLISECONDS,
        LAST_REPLY_ATTEMPTS
      );
      const output = recordSession(event, userHome, new Date());
      if (output) console.log(JSON.stringify(output));
      recordReplyMeter(event, userHome);
    }
  } catch (error) {
    console.error("token-ledger: recording failed: " + String(error));
  }
}
