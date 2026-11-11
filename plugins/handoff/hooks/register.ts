import type { EngineInterface, Register } from "claude-code";

const RECAP_RULES = `You write a prompt that a fresh coding-agent session could receive to continue the work in the conversation below.
The working directory and the conversation are the only sources: invent nothing they do not contain.
Include the goal, what has been done, what is left, the files and commands mentioned, and any open questions.
If a <focus> block is present, center the recap on it and keep the rest brief.
Output only the prompt, with no preamble, quotes or explanation.`;

const PLAN_SEPARATOR = "---handoff---";

const PER_PLAN_RULES = `You write prompts that fresh coding-agent sessions could each receive to carry out one plan suggested in the conversation below.
Find every separate plan, idea or task the conversation suggests, usually listed in the latest assistant message, and write one prompt per plan.
The working directory and the conversation are the only sources: invent nothing they do not contain.
Each prompt must stand alone: start with a one-line title naming the plan, then give its goal, the rationale and files the conversation gives for it, and what "done" means.
If a <focus> block is present, only cover the plans it names.
Separate the prompts with a line containing only ${PLAN_SEPARATOR}.
Output only the prompts and separators, with no preamble, numbering, quotes or explanation.`;

const RECENT_MESSAGE_COUNT = 40;
const RECENT_MESSAGE_MAX_LENGTH = 1500;

const NO_RECAP_MESSAGE = "Nothing to recap yet.";
const FILLED_MESSAGE =
  "Recap filled into the composer. Edit it or press Enter.";
const HANDING_OFF_MESSAGE = "Handing off to a new session…";

const NEW_SESSION_FLAG = /(^|\s)--new(?=\s|$)/;
const SAVE_FLAG = /(^|\s)--save(?=\s|$)/;
const LIST_FLAG = /(^|\s)--list(?=\s|$)/;
const RESUME_FLAG = /(^|\s)--resume(?:\s+(\S+))?(?=\s|$)/;
const EACH_PLAN_FLAG = /(^|\s)--each(?=\s|$)/;
const PENDING_HANDOFF_KEY = "pendingHandoff";
const HANDOFFS_KEY = "handoffs";
const STORED_HANDOFF_LIMIT = 50;
const SUMMARY_MAX_LENGTH = 80;

const NO_HANDOFFS_MESSAGE =
  "No handoffs stored yet. Run /handoff to create one.";
const RESUME_HINT =
  "Run /handoff --resume <id> to continue one in a new session.";
const NO_PLANS_MESSAGE = "No suggested plans found to hand off.";
const describeSavedPlanCount = (planCount: number) =>
  planCount === 1
    ? "Saved 1 handoff, one per suggested plan:"
    : `Saved ${planCount} handoffs, one per suggested plan:`;
const describeSavedHandoff = (handoffId: number) =>
  `Saved as handoff #${handoffId}. Run /handoff --resume ${handoffId} to continue it in a new session.`;
const describeMissingHandoff = (handoffId: string) =>
  `No handoff #${handoffId}. Run /handoff --list to see the stored handoffs.`;

type StoredHandoff = {
  handoffId: number;
  createdAt: number;
  cwd: string;
  focus: string;
  recap: string;
};

const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

const stripWrappingCodeFence = (text: string) =>
  text.trim().replace(WRAPPING_CODE_FENCE, "$1").trim();

const truncateMessageText = (text: string) =>
  text.length > RECENT_MESSAGE_MAX_LENGTH
    ? `${text.slice(0, RECENT_MESSAGE_MAX_LENGTH)}…`
    : text;

const describeRecentMessages = async (
  engine: EngineInterface,
  shouldKeepLatestAssistantWhole: boolean
) => {
  const messages = await engine.session.messages();
  const recentMessages = messages
    .filter((message) => message.text.trim())
    .slice(-RECENT_MESSAGE_COUNT);
  const latestAssistantIndex = shouldKeepLatestAssistantWhole
    ? recentMessages.findLastIndex((message) => message.role === "assistant")
    : -1;
  return recentMessages
    .map((message, index) => {
      const messageText =
        index === latestAssistantIndex
          ? message.text
          : truncateMessageText(message.text);
      return `${message.role}: ${messageText}`;
    })
    .join("\n");
};

const buildRecapPrompt = (
  workingDirectory: string,
  recentMessages: string,
  focus: string
) => {
  const focusSection = focus ? `\n\n<focus>\n${focus}\n</focus>` : "";
  return `Working directory: ${workingDirectory}\n\nConversation:\n${recentMessages}${focusSection}`;
};

type HandoffArguments =
  | { action: "list" }
  | { action: "resume"; handoffId: string | undefined }
  | { action: "each"; focus: string }
  | {
      action: "recap";
      isNewSession: boolean;
      isSaveOnly: boolean;
      focus: string;
    };

const parseHandoffArguments = (args: string): HandoffArguments => {
  if (LIST_FLAG.test(args)) return { action: "list" };
  const resumeMatch = RESUME_FLAG.exec(args);
  if (resumeMatch) return { action: "resume", handoffId: resumeMatch[2] };
  if (EACH_PLAN_FLAG.test(args)) {
    return { action: "each", focus: args.replace(EACH_PLAN_FLAG, " ").trim() };
  }
  return {
    action: "recap",
    isNewSession: NEW_SESSION_FLAG.test(args),
    isSaveOnly: SAVE_FLAG.test(args),
    focus: args.replace(NEW_SESSION_FLAG, " ").replace(SAVE_FLAG, " ").trim(),
  };
};

const isStoredHandoff = (value: unknown): value is StoredHandoff =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as StoredHandoff).handoffId === "number" &&
  typeof (value as StoredHandoff).recap === "string";

const readStoredHandoffs = async (
  engine: EngineInterface
): Promise<StoredHandoff[]> => {
  const storedValue = await engine.store.get(HANDOFFS_KEY);
  return Array.isArray(storedValue) ? storedValue.filter(isStoredHandoff) : [];
};

const storeHandoff = async (
  engine: EngineInterface,
  recap: string,
  focus: string
) => {
  const handoffs = await readStoredHandoffs(engine);
  const highestHandoffId = handoffs.reduce(
    (highest, { handoffId }) => Math.max(highest, handoffId),
    0
  );
  const newHandoff: StoredHandoff = {
    handoffId: highestHandoffId + 1,
    createdAt: await engine.clock.now(),
    cwd: await engine.session.cwd(),
    focus,
    recap,
  };
  await engine.store.set(
    HANDOFFS_KEY,
    [...handoffs, newHandoff].slice(-STORED_HANDOFF_LIMIT)
  );
  return newHandoff;
};

const formatCreatedAt = (createdAt: number) =>
  new Date(createdAt).toISOString().slice(0, 16).replace("T", " ");

const summarizeRecap = (recap: string) => {
  const firstLine =
    recap
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line) ?? "";
  return firstLine.length > SUMMARY_MAX_LENGTH
    ? `${firstLine.slice(0, SUMMARY_MAX_LENGTH)}…`
    : firstLine;
};

const describeStoredHandoff = (handoff: StoredHandoff) =>
  `#${handoff.handoffId}  ${formatCreatedAt(handoff.createdAt)}  ${handoff.cwd}  ${summarizeRecap(handoff.recap)}`;

const listStoredHandoffs = async (engine: EngineInterface) => {
  const handoffs = await readStoredHandoffs(engine);
  if (handoffs.length === 0) return { text: NO_HANDOFFS_MESSAGE };
  const handoffLines = [...handoffs].reverse().map(describeStoredHandoff);
  return { text: [...handoffLines, "", RESUME_HINT].join("\n") };
};

type RecapBuild = { recap: string; failure?: undefined } | { failure: string };

type RecapStyle = {
  rules: string;
  shouldKeepLatestAssistantWhole: boolean;
  timeoutMs: number;
};

const SINGLE_RECAP_STYLE: RecapStyle = {
  rules: RECAP_RULES,
  shouldKeepLatestAssistantWhole: false,
  timeoutMs: 15000,
};

const PER_PLAN_RECAP_STYLE: RecapStyle = {
  rules: PER_PLAN_RULES,
  shouldKeepLatestAssistantWhole: true,
  timeoutMs: 60000,
};

const buildRecap = async (
  engine: EngineInterface,
  focus: string,
  style: RecapStyle = SINGLE_RECAP_STYLE
): Promise<RecapBuild> => {
  const recentMessages = await describeRecentMessages(
    engine,
    style.shouldKeepLatestAssistantWhole
  );
  if (!recentMessages) return { failure: NO_RECAP_MESSAGE };

  engine.ui.toast("Building recap…");
  const reply = await engine.model.complete({
    model: "haiku",
    system: style.rules,
    prompt: buildRecapPrompt(await engine.session.cwd(), recentMessages, focus),
    effort: "low",
    timeoutMs: style.timeoutMs,
  });

  if (!reply.isAnswered) {
    return { failure: `Could not build the recap (${reply.reason}).` };
  }

  const recap = stripWrappingCodeFence(reply.text);
  if (!recap) return { failure: "Could not build the recap (empty reply)." };
  return { recap };
};

const splitPlanRecaps = (text: string) =>
  text
    .split(PLAN_SEPARATOR)
    .map(stripWrappingCodeFence)
    .filter((planRecap) => planRecap);

const storeHandoffPerPlan = async (engine: EngineInterface, focus: string) => {
  const recapBuild = await buildRecap(engine, focus, PER_PLAN_RECAP_STYLE);
  if (recapBuild.failure !== undefined) return { text: recapBuild.failure };
  const planRecaps = splitPlanRecaps(recapBuild.recap);
  if (planRecaps.length === 0) return { text: NO_PLANS_MESSAGE };

  const savedHandoffs: StoredHandoff[] = [];
  for (const planRecap of planRecaps) {
    savedHandoffs.push(await storeHandoff(engine, planRecap, focus));
  }
  const savedHandoffLines = savedHandoffs.map(
    (handoff) => `#${handoff.handoffId}  ${summarizeRecap(handoff.recap)}`
  );
  return {
    text: [
      describeSavedPlanCount(savedHandoffs.length),
      ...savedHandoffLines,
      "",
      RESUME_HINT,
    ].join("\n"),
  };
};

const offerRecapInThisSession = async (
  engine: EngineInterface,
  recap: string
) => {
  const fillResult = await engine.prompt.fill({ text: recap, mode: "replace" });
  if (fillResult.isFilled) return { text: FILLED_MESSAGE, context: [recap] };

  const copy = await engine.ui.copy({ text: recap });
  return {
    text: copy.isCopied ? `${recap}\n\n(Copied to clipboard)` : recap,
    context: [recap],
  };
};

const clearSessionAndSubmitRecap = async (
  engine: EngineInterface,
  recap: string
) => {
  await engine.command.run({ command: "clear" });
  await engine.prompt.submit({ text: recap, asUser: true });
};

const handOffToNewSession = async (engine: EngineInterface, recap: string) => {
  try {
    await clearSessionAndSubmitRecap(engine, recap);
  } catch {
    engine.ui.toast("Could not start a new session.");
    await offerRecapInThisSession(engine, recap);
  }
  await engine.store.delete(PENDING_HANDOFF_KEY);
};

const startNewSessionWithRecap = async (
  engine: EngineInterface,
  recap: string
) => {
  await engine.store.set(PENDING_HANDOFF_KEY, recap);
  engine.clock.after(0, () => void handOffToNewSession(engine, recap));
  return { text: HANDING_OFF_MESSAGE };
};

const resumeStoredHandoff = async (
  engine: EngineInterface,
  handoffId: string | undefined
) => {
  if (handoffId === undefined) return listStoredHandoffs(engine);
  const handoffs = await readStoredHandoffs(engine);
  const chosenHandoff = handoffs.find(
    (handoff) => String(handoff.handoffId) === handoffId
  );
  if (!chosenHandoff) return { text: describeMissingHandoff(handoffId) };
  return startNewSessionWithRecap(engine, chosenHandoff.recap);
};

const readPendingHandoff = async (engine: EngineInterface) => {
  const storedHandoff = await engine.store.get(PENDING_HANDOFF_KEY);
  return typeof storedHandoff === "string" && storedHandoff
    ? storedHandoff
    : undefined;
};

const resumePendingHandoff = async (engine: EngineInterface) => {
  const recap = await readPendingHandoff(engine);
  if (!recap) return;
  const fillResult = await engine.prompt.fill({ text: recap, mode: "replace" });
  if (fillResult.isFilled) await engine.store.delete(PENDING_HANDOFF_KEY);
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "handoff",
      description:
        "Summarize the session into a prompt that resumes the work; --new continues it in a fresh session; --save only stores it; --each stores one handoff per suggested plan; --list shows stored handoffs; --resume <id> continues one",
      argumentHint:
        "[--new | --save | --each] [focus] | --list | --resume <id>",
    });
    await resumePendingHandoff($);

    return next(e);
  });

  on("command.run", { command: "handoff" }, async ($, e) => {
    const handoffArguments = parseHandoffArguments(e.args);
    if (handoffArguments.action === "list") return listStoredHandoffs($);
    if (handoffArguments.action === "resume") {
      return resumeStoredHandoff($, handoffArguments.handoffId);
    }
    if (handoffArguments.action === "each") {
      return storeHandoffPerPlan($, handoffArguments.focus);
    }

    const { isNewSession, isSaveOnly, focus } = handoffArguments;
    const recapBuild = await buildRecap($, focus);
    if (recapBuild.failure !== undefined) return { text: recapBuild.failure };
    const { recap } = recapBuild;
    const savedHandoff = await storeHandoff($, recap, focus);

    if (isSaveOnly)
      return { text: describeSavedHandoff(savedHandoff.handoffId) };
    if (!isNewSession) return offerRecapInThisSession($, recap);
    return startNewSessionWithRecap($, recap);
  });
};
