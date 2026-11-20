import { transcriptTail } from "./browser-check.ts";
import type { HookEvent, HookResult } from "./types.ts";

const RUN_VERB = /\b(?:run|re-?run|execute|try)\b/i;
const CHECK_WORD =
  /\b(?:tests?|typecheck|tsc|lint|build|pytest|vitest|jest|cargo|npm|pnpm|bun|yarn|make)\b/i;
const USER_CUE =
  /(?:next:|please|you can|can you|could you|you should|to confirm|to verify)/i;
const USER_COMMAND_MARK = "`!";
const MAX_TRANSCRIPT_BYTES = 20_000_000;
const STDERR =
  "Your reply asks the user to run a check. Run it yourself, or send it to guards:worker, then report the command and its result line. Ask the user only for steps that need them (interactive login, device, credentials) as a `! <command>` line.";

type TranscriptBlock = { type?: string; text?: unknown };
type TranscriptLine = { message?: { role?: string; content?: unknown } };

function parseLine(line: string): TranscriptLine | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function lastReplyLines(transcript: string): string[] {
  let lastText: string[] = [];
  for (const line of transcript.split("\n")) {
    const message = parseLine(line)?.message;
    if (message?.role !== "assistant" || !Array.isArray(message.content))
      continue;
    const texts = (message.content as TranscriptBlock[])
      .filter(
        (block) => block?.type === "text" && typeof block.text === "string"
      )
      .map((block) => block.text as string);
    if (texts.length > 0) lastText = texts;
  }
  return lastText.flatMap((text) => text.split("\n"));
}

const asksUserToRunCheck = (line: string) =>
  !line.includes(USER_COMMAND_MARK) &&
  RUN_VERB.test(line) &&
  CHECK_WORD.test(line) &&
  USER_CUE.test(line);

const isOff = (event: HookEvent) =>
  process.env.GUARDS_SELF_CHECK === "0" || event.stop_hook_active === true;

export function decideFromReply(
  event: HookEvent,
  transcript: string
): HookResult {
  if (isOff(event)) return null;
  if (!lastReplyLines(transcript).some(asksUserToRunCheck)) return null;
  return { exitCode: 2, stderr: STDERR };
}

export function decideFromTranscript(
  event: HookEvent,
  maxBytes = MAX_TRANSCRIPT_BYTES
): HookResult {
  if (!event.transcript_path || isOff(event)) return null;
  return decideFromReply(
    event,
    transcriptTail(event.transcript_path, maxBytes)
  );
}
