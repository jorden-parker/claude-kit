import type { Register } from "claude-code";
import { recordGrants } from "./hook-bypass.ts";

const TOOL_NAME = "request_hook_bypass";
const QUALIFIED_TOOL_NAME = `mcp__guards__${TOOL_NAME}`;
const MAX_FILES = 20;
const MAX_REASON_LENGTH = 200;
const SECONDS_PER_MILLISECOND = 1000;
const TOOL_DESCRIPTION =
  "Ask the user to let specific files skip the TDD, no-comments and naming checks for 15 minutes. Use only for files those checks do not fit, such as seed data, fixtures or configuration files. The user sees the files and the reason and approves or denies.";
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: MAX_FILES,
      description: "Absolute file paths",
    },
    reason: { type: "string", maxLength: MAX_REASON_LENGTH },
  },
  required: ["files", "reason"],
};

const localClock = (epochSeconds: number) => {
  const moment = new Date(epochSeconds * SECONDS_PER_MILLISECOND);
  const hours = String(moment.getHours()).padStart(2, "0");
  const minutes = String(moment.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

export const register: Register = (subscribe) => {
  subscribe("session.start", async (engine, event, next) => {
    await engine.tool.register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_SCHEMA,
      isDeferred: false,
    });
    return next(event);
  });

  subscribe("tool.call", async (engine, event, next) => {
    if (event.tool !== (QUALIFIED_TOOL_NAME as string)) return next(event);
    const toolInput = event as unknown as Record<string, unknown>;
    const files = toolInput.files as string[];
    try {
      const expiry = recordGrants(
        files,
        Math.floor(Date.now() / SECONDS_PER_MILLISECOND)
      );
      return {
        result: `Granted until ${localClock(expiry)}: ${files.join(", ")}`,
      };
    } catch (error) {
      if (error instanceof Error) return { deny: error.message };
      throw error;
    }
  });
};
