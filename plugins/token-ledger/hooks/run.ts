import { homedir } from "node:os";
import { formatReport, readNewestEntries, recordSession } from "./ledger.ts";

const DEFAULT_REPORTED_SESSIONS = 10;
const userHome = process.env.HOME ?? homedir();

if (process.argv[2] === "report") {
  const sessionCount = Number(process.argv[3]) || DEFAULT_REPORTED_SESSIONS;
  console.log(formatReport(readNewestEntries(userHome, sessionCount)));
} else {
  try {
    const output = recordSession(
      JSON.parse(await Bun.stdin.text()),
      userHome,
      new Date()
    );
    if (output) console.log(JSON.stringify(output));
  } catch {}
}
