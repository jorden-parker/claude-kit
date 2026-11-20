import { homedir } from "node:os";
import {
  formatReport,
  readNewestEntries,
  recordReplyMeter,
  recordSession,
  takeReplyNote,
  waitForLastReply,
} from "./ledger.ts";

const DEFAULT_REPORTED_SESSIONS = 10;
const LAST_REPLY_PAUSE_MILLISECONDS = 50;
const LAST_REPLY_ATTEMPTS = 40;
const userHome = process.env.HOME ?? homedir();
const command = process.argv[2];

if (command === "report") {
  const sessionCount = Number(process.argv[3]) || DEFAULT_REPORTED_SESSIONS;
  console.log(formatReport(readNewestEntries(userHome, sessionCount)));
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
