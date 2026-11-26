import { afterEach, expect, test } from "bun:test";
import { decide } from "./delegation-rules.ts";

const sessionStart = { hook_event_name: "SessionStart" };

const contextOf = (result: ReturnType<typeof decide>) =>
  (result?.output as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

afterEach(() => {
  delete process.env.GUARDS_DELEGATE_GUARD;
  delete process.env.ANTHROPIC_BASE_URL;
});

test("adds the delegation rules as session context", () => {
  const result = decide(sessionStart);
  expect(result?.output).toMatchObject({
    hookSpecificOutput: { hookEventName: "SessionStart" },
  });
  expect(contextOf(result)).toContain("guards:context-scout");
  expect(contextOf(result)).toContain("guards:worker");
  expect(contextOf(result)).toContain("orchestrator");
  expect(contextOf(result)).toContain('names a model: `"haiku"` by default');
  expect(contextOf(result)).toContain("only after Haiku failed the task");
  expect(contextOf(result)).toContain(
    "Send independent pieces as several Agent calls in one message"
  );
  expect(contextOf(result)).toContain("never the user's");
  expect(contextOf(result)).toContain("up to 1,000 changed characters");
  expect(contextOf(result)).toContain("offset and limit");
  expect(contextOf(result)).toContain(
    "Read one file or symbol you can already name yourself"
  );
});

test("adds nothing when GUARDS_DELEGATE_GUARD is 0", () => {
  process.env.GUARDS_DELEGATE_GUARD = "0";
  expect(decide(sessionStart)).toBeNull();
});

test("adds nothing when launched by claude-lite", () => {
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:11434";
  expect(decide(sessionStart)).toBeNull();
});
