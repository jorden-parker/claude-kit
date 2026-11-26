import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide as decideBash } from "./bash-trim.ts";
import { decide } from "./handback-trim.ts";

const captured = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/handback.jsonl"), "utf8")
);

const run = (message: string, agentType: string | undefined, bridge = "") => {
  process.env.CLAUDE_KIT_HOOK_BRIDGE = bridge;
  try {
    return decide(
      {
        tool_name: "SubagentHandback",
        agent_type: agentType,
        session_id: "s1",
        tool_use_id: "t1",
        tool_input: { message },
      },
      "/saved"
    ) as any;
  } finally {
    delete process.env.CLAUDE_KIT_HOOK_BRIDGE;
  }
};

const long = `start${"m".repeat(9_990)}end`;

test("the captured handback is short and passes", () => {
  expect(captured.tool_name).toBe("SubagentHandback");
  expect(run(captured.tool_input.message, captured.agent_type)).toBeNull();
});

test("a long message from a listed agent is cut to head and tail", () => {
  for (const type of [
    "guards:worker",
    "guards:context-scout",
    "Explore",
    "general-purpose",
    "claude",
    "claude-code-guide",
    "web-fetch",
  ]) {
    const result = run(long, type);
    const input = result.output.hookSpecificOutput.updatedInput;
    expect(input.message.startsWith("start")).toBe(true);
    expect(input.message.endsWith("end")).toBe(true);
    expect(input.message).toContain("full output in /saved/s1-t1-message.txt");
    expect(input.message.length).toBeLessThanOrEqual(4_000);
    expect(result.savedOutputs).toEqual([
      { path: "/saved/s1-t1-message.txt", text: long },
    ]);
  }
});

test("other agent types, short messages and a bridge pass", () => {
  expect(run(long, "my-agent")).toBeNull();
  expect(run(long, undefined)).toBeNull();
  expect(run("m".repeat(4_000), "Explore")).toBeNull();
  expect(run(long, "Explore", "1")).toBeNull();
});

test("a trimmed 6,000-character message fits and a second trim pass changes nothing", () => {
  const message = "m".repeat(6_000);
  const trimmed = run(message, "Explore").output.hookSpecificOutput.updatedInput
    .message;
  expect(trimmed.length).toBeLessThanOrEqual(4_000);
  expect(
    decideBash({
      tool_name: "Agent",
      tool_response: { handbackReport: { text: trimmed } },
    })
  ).toBeNull();
});
