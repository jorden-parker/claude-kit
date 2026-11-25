import { writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { composeLedgerPage } from "./ledger-page.ts";
import {
  formatReport,
  readNewestEntries,
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

if (command === "report") {
  console.log(formatReport(readNewestEntries(userHome, sessionCount)));
} else if (command === "table") {
  const pagePath = join(tmpdir(), "claude-ledger.html");
  writeFileSync(
    pagePath,
    composeLedgerPage(readNewestEntries(userHome, sessionCount))
  );
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", pagePath]);
  console.log(pagePath);
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
  } catch {}
}
