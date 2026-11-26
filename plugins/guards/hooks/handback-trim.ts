import { tmpdir } from "node:os";
import { join } from "node:path";
import { capCharacters } from "./bash-trim.ts";
import { canRewriteInput, rewriteInput } from "./types.ts";
import type { HookEvent, HookResult } from "./types.ts";

const MAX_MESSAGE_CHARACTERS = 4_000;
const CAPPED_AGENT_TYPES = [
  "guards:worker",
  "guards:context-scout",
  "Explore",
  "general-purpose",
  "claude",
  "claude-code-guide",
  "web-fetch",
];

export function decide(
  event: HookEvent,
  savedOutputFolder = join(tmpdir(), "guards-output")
): HookResult {
  const message = event.tool_input?.message;
  if (typeof message !== "string" || message.length <= MAX_MESSAGE_CHARACTERS)
    return null;
  if (!CAPPED_AGENT_TYPES.includes(event.agent_type ?? "")) return null;
  if (!canRewriteInput(event)) return null;
  const path = join(
    savedOutputFolder,
    `${event.session_id ?? "session"}-${event.tool_use_id ?? "output"}-message.txt`
  );
  const result = rewriteInput(
    {
      ...event.tool_input,
      message: capCharacters(message, MAX_MESSAGE_CHARACTERS, path),
    },
    `handback-trim: the report was ${message.length} characters; the middle was cut and the full copy saved to ${path}.`
  );
  return { ...result, savedOutputs: [{ path, text: message }] };
}
