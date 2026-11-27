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
  expect(contextOf(result)).toContain("Handle a bounded task directly");
  expect(contextOf(result)).toContain("Resume the same worker");
  expect(contextOf(result)).toContain(
    "Saved per-agent model overrides remain authoritative"
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

const withDelegationModel = (value: string | undefined, run: () => void) => {
  const previous = process.env.GUARDS_DELEGATE_MODEL;
  if (value === undefined) delete process.env.GUARDS_DELEGATE_MODEL;
  else process.env.GUARDS_DELEGATE_MODEL = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.GUARDS_DELEGATE_MODEL;
    else process.env.GUARDS_DELEGATE_MODEL = previous;
  }
};

test("names the GUARDS_DELEGATE_MODEL model on every Agent call", () => {
  withDelegationModel("sonnet", () => {
    const context = contextOf(decide(sessionStart));
    expect(context).toContain(
      '- Every Agent call names model: `"sonnet"`, including `guards:context-scout` and `guards:worker`.'
    );
    expect(context).not.toContain("haiku");
    expect(context).not.toContain("Haiku delegation");
  });
});

test.each([undefined, ""])(
  "keeps the Haiku rules when GUARDS_DELEGATE_MODEL is %s",
  (value) => {
    withDelegationModel(value, () => {
      const context = contextOf(decide(sessionStart));
      expect(context).toContain(
        '- Any other Agent call names a model: `"haiku"` by default, `"sonnet"` only after Haiku failed the task.'
      );
    });
  }
);
