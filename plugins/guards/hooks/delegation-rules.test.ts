import { afterEach, expect, test } from "bun:test";
import { decide } from "./delegation-rules.ts";

const sessionStart = { hook_event_name: "SessionStart" };

const contextOf = (result: ReturnType<typeof decide>) =>
  (result?.output as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;

afterEach(() => {
  delete process.env.GUARDS_DELEGATE_GUARD;
});

test("adds the delegation rules as session context", () => {
  const result = decide(sessionStart);
  expect(result?.output).toMatchObject({
    hookSpecificOutput: { hookEventName: "SessionStart" },
  });
  expect(contextOf(result)).toContain("guards:context-scout");
  expect(contextOf(result)).toContain('model: "haiku"');
});

test("adds nothing when GUARDS_DELEGATE_GUARD is 0", () => {
  process.env.GUARDS_DELEGATE_GUARD = "0";
  expect(decide(sessionStart)).toBeNull();
});
