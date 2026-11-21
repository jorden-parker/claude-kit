import type { On } from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 21, 9, 0, 0);

const runMoney = async (
  $: Engine,
  on: On,
  commandArguments: string,
  seededStore: Record<string, unknown> = {},
  now = NOW
) => {
  const clock = mock.clock(on, { now });
  const store = new Map(Object.entries(seededStore));
  const submittedPrompts: string[] = [];
  const statusLines: (string | undefined)[] = [];
  on("store.get", (_, e) => ({ value: store.get(e.key) }));
  on("store.set", (_, e) => {
    store.set(e.key, e.value);
    return { value: undefined };
  });
  on("prompt.submit", (_, e) => {
    submittedPrompts.push(e.text);
    return { text: e.text };
  });
  on("ui.status", (_, e) => {
    statusLines.push(e.text);
    return { value: undefined };
  });
  const reply = (await $.command.run({
    command: "money",
    args: commandArguments,
  } as never)) as { text?: string };
  await clock.settle();
  return { reply, store, submittedPrompts, statusLines };
};

test("/money asks for a short check-in from Emma with one next step", async ($, on) => {
  const { submittedPrompts } = await runMoney($, on, "");
  expect(submittedPrompts[0]).toContain(
    "mcp__claude_ai_Emma_App__get_true_balance"
  );
  expect(submittedPrompts[0]).toContain(
    "mcp__claude_ai_Emma_App__list_recurring_payments"
  );
  expect(submittedPrompts[0]).toContain("one next step");
});

test("/money records the check-in time and shows it on the status line", async ($, on) => {
  const { store, statusLines } = await runMoney($, on, "");
  expect(store.get("lastCheckIn")).toBe(NOW);
  expect(statusLines.at(-1)).toBe("money: checked today");
});

test("/money bills asks for payments due in the next 14 days", async ($, on) => {
  const { submittedPrompts } = await runMoney($, on, "bills");
  expect(submittedPrompts[0]).toContain("next 14 days");
  expect(submittedPrompts[0]).toContain(
    "mcp__claude_ai_Emma_App__list_recurring_payments"
  );
});

test("/money week asks for spending against budgets", async ($, on) => {
  const { submittedPrompts } = await runMoney($, on, "week");
  expect(submittedPrompts[0]).toContain("mcp__claude_ai_Emma_App__get_budgets");
  expect(submittedPrompts[0]).toContain(
    "mcp__claude_ai_Emma_App__get_spending"
  );
});

test("/money pause parks an item for 48 hours without a model turn", async ($, on) => {
  const { reply, store, submittedPrompts } = await runMoney(
    $,
    on,
    "pause headphones 249"
  );
  expect(submittedPrompts).toEqual([]);
  expect(store.get("parkedBuys")).toEqual([
    { item: "headphones 249", parkedAt: NOW },
  ]);
  expect(reply.text).toContain("2026-11-23");
});

test("/money pause lists parked items and marks the ones ready to decide", async ($, on) => {
  const { reply } = await runMoney($, on, "pause", {
    parkedBuys: [
      { item: "lamp", parkedAt: NOW - 3 * DAY },
      { item: "boots", parkedAt: NOW - HOUR },
    ],
  });
  expect(reply.text).toContain("lamp: ready to decide");
  expect(reply.text).toContain("boots: wait until 2026-11-23");
});

test("/money pause done removes a parked item", async ($, on) => {
  const { store } = await runMoney($, on, "pause done lamp", {
    parkedBuys: [
      { item: "lamp", parkedAt: NOW - 3 * DAY },
      { item: "boots", parkedAt: NOW - HOUR },
    ],
  });
  expect(store.get("parkedBuys")).toEqual([
    { item: "boots", parkedAt: NOW - HOUR },
  ]);
});

test("/money brings up parked items that are ready to decide", async ($, on) => {
  const { submittedPrompts } = await runMoney($, on, "", {
    parkedBuys: [{ item: "lamp", parkedAt: NOW - 3 * DAY }],
  });
  expect(submittedPrompts[0]).toContain("lamp");
});

test("the status line counts days since the last check-in", async ($, on) => {
  const { statusLines } = await runMoney($, on, "pause", {
    lastCheckIn: NOW - 3 * DAY,
  });
  expect(statusLines.at(-1)).toBe("money: checked 3d ago · /money");
});

test("an unknown mode shows the usage", async ($, on) => {
  const { reply, submittedPrompts } = await runMoney($, on, "taxes");
  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("/money pause <item>");
});
