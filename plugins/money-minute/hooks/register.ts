import type { EngineInterface, Register } from "claude-code";

const COMMAND_NAME = "money";
const DAY_MS = 24 * 60 * 60 * 1000;
const PARK_MS = 2 * DAY_MS;
const LAST_CHECK_IN_KEY = "lastCheckIn";
const PARKED_BUYS_KEY = "parkedBuys";
const EMMA = "mcp__claude_ai_Emma_App__";

type ParkedBuy = { item: string; parkedAt: number };

const USAGE = [
  "/money             one-minute check-in: safe-to-spend, bills due soon, one next step",
  "/money bills       what leaves your account in the next 14 days",
  "/money week        this week's spending against your budgets",
  "/money pause <item>       park an impulse buy for 48 hours",
  "/money pause              list parked buys",
  "/money pause done <item>  remove a parked buy once you've decided",
].join("\n");

const TONE = [
  "The reader has ADHD and may have been avoiding their money. Be calm and matter-of-fact: no shame, no lectures, no 'you should have'.",
  "Lead with numbers, keep the whole reply under 12 lines, and end with exactly one next step that takes under two minutes.",
  "Emma gives information, never financial advice: follow the Emma server's own instructions on advice, investments and money worries.",
  "If an Emma tool fails or Emma is not connected, say so in one line and tell the reader to connect Emma at claude.ai under Settings, Connectors.",
].join("\n");

const formatDate = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

const isReadyToDecide = (parkedBuy: ParkedBuy, now: number) =>
  now - parkedBuy.parkedAt >= PARK_MS;

const describeCheckIn = (lastCheckIn: number | undefined, now: number) => {
  if (lastCheckIn === undefined) return "money: not checked yet · /money";
  const daysSince = Math.floor((now - lastCheckIn) / DAY_MS);
  return daysSince === 0
    ? "money: checked today"
    : `money: checked ${daysSince}d ago · /money`;
};

const checkInPrompt = (readyBuys: ParkedBuy[]) =>
  [
    "Run my money minute, a one-minute check-in on my Emma data.",
    `1. Call ${EMMA}get_true_balance for what I can safely spend until payday.`,
    `2. Call ${EMMA}list_recurring_payments and name only the bills and subscriptions due in the next 7 days, with amounts and dates.`,
    `3. Call ${EMMA}get_spending for this month so far, and name the single biggest category.`,
    ...(readyBuys.length
      ? [
          `4. These parked buys have waited 48 hours: ${readyBuys.map((parkedBuy) => parkedBuy.item).join(", ")}. Ask whether I still want each one, and tell me to run /money pause done <item> once decided.`,
        ]
      : []),
    "Then give me one next step.",
    TONE,
  ].join("\n");

const billsPrompt = () =>
  [
    `Call ${EMMA}list_recurring_payments (this period and next) and ${EMMA}get_true_balance.`,
    "List every bill and subscription due in the next 14 days, soonest first, as date, name, amount.",
    "Mark any that the current balance would not cover, any whose amount went up, and any subscription I have not used a merchant for recently, so I can cancel before the next charge.",
    "Total the 14 days, then give one next step.",
    TONE,
  ].join("\n");

const weekPrompt = () =>
  [
    `Call ${EMMA}get_budgets for this month and ${EMMA}get_spending for this week and for this month.`,
    "Show each budget as category, spent, left, and a 10-character bar like ███████░░░. Put the ones closest to or over budget first.",
    `Call ${EMMA}search_transactions for this week and name the three largest non-bill purchases.`,
    "Name one win from the week before anything else, then give one next step.",
    TONE,
  ].join("\n");

const askClaude = ($: EngineInterface, instruction: string) => {
  $.clock.after(0, () => void $.prompt.submit({ text: instruction }));
};

const readParkedBuys = async ($: EngineInterface) =>
  ((await $.store.get(PARKED_BUYS_KEY)) as ParkedBuy[] | undefined) ?? [];

const showCheckInStatus = async ($: EngineInterface) => {
  const lastCheckIn = (await $.store.get(LAST_CHECK_IN_KEY)) as
    number | undefined;
  $.ui.status(describeCheckIn(lastCheckIn, await $.clock.now()));
};

const runPause = async ($: EngineInterface, pauseArguments: string) => {
  const now = await $.clock.now();
  const parkedBuys = await readParkedBuys($);
  if (pauseArguments.startsWith("done ")) {
    const doneItem = pauseArguments.slice("done ".length).trim().toLowerCase();
    const remaining = parkedBuys.filter(
      (parkedBuy) => parkedBuy.item.toLowerCase() !== doneItem
    );
    await $.store.set(PARKED_BUYS_KEY, remaining);
    return remaining.length === parkedBuys.length
      ? `Nothing parked as "${doneItem}". Run /money pause to see the list.`
      : `Removed "${doneItem}". Deciding counts, whichever way you went.`;
  }
  if (pauseArguments) {
    await $.store.set(PARKED_BUYS_KEY, [
      ...parkedBuys,
      { item: pauseArguments, parkedAt: now },
    ]);
    return `Parked "${pauseArguments}". Decide on or after ${formatDate(now + PARK_MS)}; /money will remind you.`;
  }
  if (!parkedBuys.length)
    return "Nothing parked. Next time you want to buy something, run /money pause <item>.";
  return parkedBuys
    .map((parkedBuy) =>
      isReadyToDecide(parkedBuy, now)
        ? `${parkedBuy.item}: ready to decide`
        : `${parkedBuy.item}: wait until ${formatDate(parkedBuy.parkedAt + PARK_MS)}`
    )
    .join("\n");
};

const runMoney = async ($: EngineInterface, commandArguments: string) => {
  const [mode = "", ...rest] = commandArguments.trim().split(/\s+/);
  if (mode === "") {
    const now = await $.clock.now();
    const readyBuys = (await readParkedBuys($)).filter((parkedBuy) =>
      isReadyToDecide(parkedBuy, now)
    );
    await $.store.set(LAST_CHECK_IN_KEY, now);
    askClaude($, checkInPrompt(readyBuys));
    return "Money minute: reading Emma…";
  }
  if (mode === "bills") {
    askClaude($, billsPrompt());
    return "Bills for the next 14 days: reading Emma…";
  }
  if (mode === "week") {
    askClaude($, weekPrompt());
    return "This week against your budgets: reading Emma…";
  }
  if (mode === "pause") return runPause($, rest.join(" "));
  return USAGE;
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description: "ADHD-friendly money check-in on your Emma data",
      argumentHint: "[bills | week | pause <item>]",
    });
    await showCheckInStatus($);
    return next(e);
  });

  on("command.run", { command: COMMAND_NAME }, async ($, e) => {
    const text = await runMoney($, e.args ?? "");
    await showCheckInStatus($);
    return { text };
  });
};
