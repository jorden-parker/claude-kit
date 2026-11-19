import type {
  EngineInterface,
  ModelCompleteResult,
  PluginOptions,
  Register,
} from "claude-code";

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
const HANDOFF_COMMAND_PREFIX = "/handoff ";

const HANDOFF_FLAG_SUGGESTIONS = [
  { text: "--new", description: "Continue the recap in a fresh session" },
  { text: "--save", description: "Only store the recap" },
  { text: "--each", description: "Store one handoff per suggested plan" },
  { text: "--list", description: "Show stored handoffs" },
  {
    text: "--resume",
    description: "Continue a stored handoff by id, plus optional extra context",
  },
];
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
const HANDOFF_FILE_FOLDER = ".claude/handoffs";
const describeResumeCommand = (handoffId: number) =>
  `Run /handoff --resume ${handoffId} to continue it in a new session.`;
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

const describeFocus = (focus: string) =>
  focus ? `\n\n<focus>\n${focus}\n</focus>` : "";

const buildRecapPrompt = (
  workingDirectory: string,
  recentMessages: string,
  focus: string
) => {
  return `Working directory: ${workingDirectory}\n\nConversation:\n${recentMessages}${describeFocus(focus)}`;
};

const CONVERSATION_PREAMBLE = `Stop the work here. Do not use any tools for this message: answer it straight away.
The conversation above is what the rules below call "the conversation below".`;

type HandoffArguments =
  | { action: "list" }
  | { action: "resume"; handoffId: string | undefined; extraContext: string }
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
  if (resumeMatch) {
    return {
      action: "resume",
      handoffId: resumeMatch[2],
      extraContext: args.replace(RESUME_FLAG, " ").trim(),
    };
  }
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

const buildHandoffFilePath = (handoff: StoredHandoff) => {
  const minuteStamp = new Date(handoff.createdAt)
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  return `${HANDOFF_FILE_FOLDER}/${minuteStamp}-handoff-${handoff.handoffId}.md`;
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const saveHandoffFile = async (
  engine: EngineInterface,
  handoff: StoredHandoff
) => {
  const filePath = buildHandoffFilePath(handoff);
  const resumeCommand = describeResumeCommand(handoff.handoffId);
  try {
    await engine.fs.write(`${handoff.cwd}/${filePath}`, `${handoff.recap}\n`);
    return `Saved as handoff #${handoff.handoffId} in ${filePath}. ${resumeCommand}`;
  } catch (error) {
    return `Saved as handoff #${handoff.handoffId}, but ${filePath} could not be written (${describeError(error)}). ${resumeCommand}`;
  }
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

type RecapRequest = Extract<HandoffArguments, { focus: string }>;

type RecapBuild =
  | { recap: string; failure?: undefined; delegationPrefix?: undefined }
  | { failure: string; delegationPrefix?: undefined }
  | { delegationPrefix: string; digest: string; failure?: undefined };

type AwaitedRecap = {
  request: RecapRequest;
  promptText: string;
  turnId?: string;
  agentId?: string;
};

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

const chooseRecapStyle = (request: RecapRequest) =>
  request.action === "each" ? PER_PLAN_RECAP_STYLE : SINGLE_RECAP_STYLE;

const buildConversationPrompt = (request: RecapRequest) =>
  `${CONVERSATION_PREAMBLE}\n\n${chooseRecapStyle(request).rules}${describeFocus(request.focus)}`;

const RECAP_MODEL = "haiku";
const HAIKU_WRITER = "haiku";
const CONVERSATION_WRITER = "conversation";
const RECAP_AGENT_TYPE = "general-purpose";
const AGENT_PREAMBLE =
  "Do not use any tools for this task: answer straight away from the conversation below.";
const RECAP_AGENT_DESCRIPTION = "Write the handoff recap";
const RECAP_AGENT_DONE_NOTICE =
  "The handoff subagent finished; its result is in the status line.";
const OUTCOME_TOAST_MS = 15000;
const SUBAGENT_WRITING_MESSAGE = "A subagent is writing the recap…";
const EMPTY_REPLY_MESSAGE = "Could not build the recap (empty reply).";
const RECAP_ABOVE_MESSAGE = "The recap is the message above.";
const WRITING_IN_CONVERSATION_MESSAGE =
  "Writing the recap in the conversation…";
const describeHaikuRefusal = (apiError: string) =>
  `Haiku could not write the recap (${apiError}). `;

const readStringOption = (options: PluginOptions, key: string) => {
  const optionValue = options[key];
  return typeof optionValue === "string" ? optionValue.trim() : "";
};
const BACKOFF_DELAYS_MS = [1000, 2000, 4000];
const TRANSIENT_API_ERRORS = new Set([
  "rate_limit",
  "overloaded",
  "server_error",
]);

const isTransientFailure = (reply: ModelCompleteResult) =>
  !reply.isAnswered &&
  reply.reason === "api-error" &&
  TRANSIENT_API_ERRORS.has(reply.error);

const completeWithBackoff = async (
  engine: EngineInterface,
  complete: () => Promise<ModelCompleteResult>
) => {
  let reply = await complete();
  for (const delayMs of BACKOFF_DELAYS_MS) {
    if (!isTransientFailure(reply)) break;
    await engine.clock.sleep(delayMs);
    reply = await complete();
  }
  return reply;
};

const describeUnansweredReply = (
  reply: Extract<ModelCompleteResult, { isAnswered: false }>
) =>
  reply.reason === "api-error"
    ? `API error ${reply.status ?? "with no response"}, ${reply.error}`
    : reply.reason;

type RecapDelegation = { awaitedRecap: AwaitedRecap; routeNotice: string };

const askConversationForRecap = (
  engine: EngineInterface,
  request: RecapRequest
): RecapDelegation => {
  const promptText = buildConversationPrompt(request);
  engine.clock.after(
    0,
    () => void engine.prompt.submit({ text: promptText, asUser: true })
  );
  return {
    awaitedRecap: { request, promptText },
    routeNotice: WRITING_IN_CONVERSATION_MESSAGE,
  };
};

const buildAgentPrompt = (request: RecapRequest, digest: string) =>
  `${AGENT_PREAMBLE}\n\n${chooseRecapStyle(request).rules}\n\n${digest}`;

const delegateRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  digest: string,
  canUseSubagent: boolean
): Promise<RecapDelegation> => {
  if (canUseSubagent) {
    const promptText = buildAgentPrompt(request, digest);
    const spawnResult = await engine.agent.spawn({
      prompt: promptText,
      description: RECAP_AGENT_DESCRIPTION,
      subagentType: RECAP_AGENT_TYPE,
      model: RECAP_MODEL,
    });
    if (spawnResult.deny === undefined) {
      return {
        awaitedRecap: { request, promptText, agentId: spawnResult.agentId },
        routeNotice: SUBAGENT_WRITING_MESSAGE,
      };
    }
  }
  return askConversationForRecap(engine, request);
};

const isAwaitedTurn = (
  awaitedRecap: AwaitedRecap,
  turn: { turnId: string; agentId?: string }
) =>
  awaitedRecap.turnId === turn.turnId ||
  (turn.agentId !== undefined && awaitedRecap.agentId === turn.agentId);

const buildRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  isHaikuWriter: boolean
): Promise<RecapBuild> => {
  const style = chooseRecapStyle(request);
  const recentMessages = await describeRecentMessages(
    engine,
    style.shouldKeepLatestAssistantWhole
  );
  if (!recentMessages) return { failure: NO_RECAP_MESSAGE };
  const digest = buildRecapPrompt(
    await engine.session.cwd(),
    recentMessages,
    request.focus
  );
  if (!isHaikuWriter) return { delegationPrefix: "", digest };

  engine.ui.toast("Building recap…");
  const reply = await completeWithBackoff(engine, () =>
    engine.model.complete({
      model: RECAP_MODEL,
      system: style.rules,
      prompt: digest,
      effort: "low",
      timeoutMs: style.timeoutMs,
    })
  );

  if (!reply.isAnswered) {
    const unansweredReason = describeUnansweredReply(reply);
    return reply.reason === "api-error"
      ? { delegationPrefix: describeHaikuRefusal(unansweredReason), digest }
      : { failure: `Could not build the recap (${unansweredReason}).` };
  }

  const recap = stripWrappingCodeFence(reply.text);
  if (!recap) return { failure: EMPTY_REPLY_MESSAGE };
  return { recap };
};

const splitPlanRecaps = (text: string) =>
  text
    .split(PLAN_SEPARATOR)
    .map(stripWrappingCodeFence)
    .filter((planRecap) => planRecap);

const storePlanHandoffs = async (
  engine: EngineInterface,
  recapText: string,
  focus: string
) => {
  const planRecaps = splitPlanRecaps(recapText);
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
  recap: string,
  isRecapOnScreen = false
) => {
  const fillResult = await engine.prompt.fill({ text: recap, mode: "replace" });
  if (fillResult.isFilled) return { text: FILLED_MESSAGE, context: [recap] };

  const copy = await engine.ui.copy({ text: recap });
  const shownRecap = isRecapOnScreen ? RECAP_ABOVE_MESSAGE : recap;
  return {
    text: copy.isCopied ? `${shownRecap}\n\n(Copied to clipboard)` : shownRecap,
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

const deliverRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  recapText: string,
  isRecapOnScreen: boolean
) => {
  if (request.action === "each") {
    return storePlanHandoffs(engine, recapText, request.focus);
  }
  const savedHandoff = await storeHandoff(engine, recapText, request.focus);
  if (request.isSaveOnly) {
    return { text: await saveHandoffFile(engine, savedHandoff) };
  }
  if (!request.isNewSession) {
    return offerRecapInThisSession(engine, recapText, isRecapOnScreen);
  }
  return startNewSessionWithRecap(engine, recapText);
};

const appendExtraContext = (recap: string, extraContext: string) =>
  extraContext
    ? `${recap}\n\nExtra context from the user: ${extraContext}`
    : recap;

const resumeStoredHandoff = async (
  engine: EngineInterface,
  handoffId: string | undefined,
  extraContext: string
) => {
  if (handoffId === undefined) return listStoredHandoffs(engine);
  const handoffs = await readStoredHandoffs(engine);
  const chosenHandoff = handoffs.find(
    (handoff) => String(handoff.handoffId) === handoffId
  );
  if (!chosenHandoff) return { text: describeMissingHandoff(handoffId) };
  return startNewSessionWithRecap(
    engine,
    appendExtraContext(chosenHandoff.recap, extraContext)
  );
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

export const register: Register = (on, options) => {
  const writer = readStringOption(options, "writer");
  const isHaikuWriter = writer === HAIKU_WRITER;
  let awaitedRecap: AwaitedRecap | undefined;
  let hasPinnedOutcome = false;
  let recapAgentId: string | undefined;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "handoff",
      description:
        "Summarize the session into a prompt that resumes the work; --new continues it in a fresh session; --save only stores it; --each stores one handoff per suggested plan; --list shows stored handoffs; --resume <id> [extra context] continues one, with the extra context added to its recap",
      argumentHint:
        "[--new | --save | --each] [focus] | --list | --resume <id> [extra context]",
    });
    await resumePendingHandoff($);

    return next(e);
  });

  on("command.run", { command: "handoff" }, async ($, e) => {
    const handoffArguments = parseHandoffArguments(e.args);
    if (handoffArguments.action === "list") return listStoredHandoffs($);
    if (handoffArguments.action === "resume") {
      return resumeStoredHandoff(
        $,
        handoffArguments.handoffId,
        handoffArguments.extraContext
      );
    }
    const recapBuild = await buildRecap($, handoffArguments, isHaikuWriter);
    if (recapBuild.delegationPrefix !== undefined) {
      const delegation = await delegateRecap(
        $,
        handoffArguments,
        recapBuild.digest,
        writer !== CONVERSATION_WRITER
      );
      awaitedRecap = delegation.awaitedRecap;
      recapAgentId = delegation.awaitedRecap.agentId;
      $.ui.status(delegation.routeNotice);
      return {
        text: `${recapBuild.delegationPrefix}${delegation.routeNotice}`,
      };
    }
    if (recapBuild.failure !== undefined) return { text: recapBuild.failure };
    return deliverRecap($, handoffArguments, recapBuild.recap, false);
  });

  on("prompt.submit", (_, e, next) => {
    const isRecapAgentReport =
      e.origin?.kind === "peer" &&
      recapAgentId !== undefined &&
      e.text.includes(`<agent-message from="${recapAgentId}">`);
    if (!isRecapAgentReport) return next(e);
    recapAgentId = undefined;
    return { drop: RECAP_AGENT_DONE_NOTICE };
  });

  on("turn.start", ($, e, next) => {
    if (awaitedRecap && e.text.includes(awaitedRecap.promptText)) {
      awaitedRecap = { ...awaitedRecap, turnId: e.turnId };
    }
    if (hasPinnedOutcome && e.agentId === undefined) {
      $.ui.status(undefined);
      hasPinnedOutcome = false;
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const turnResult = await next(e);
    if (!awaitedRecap || !isAwaitedTurn(awaitedRecap, e)) return turnResult;
    const { request } = awaitedRecap;
    awaitedRecap = undefined;

    const isConversationTurn = e.agentId === undefined;
    recapAgentId = e.agentId;
    const recap = stripWrappingCodeFence(e.answer);
    if (!recap && !isConversationTurn) {
      const delegation = askConversationForRecap($, request);
      awaitedRecap = delegation.awaitedRecap;
      $.ui.status(delegation.routeNotice);
      return turnResult;
    }
    const outcome = recap
      ? (await deliverRecap($, request, recap, isConversationTurn)).text
      : EMPTY_REPLY_MESSAGE;
    if (isConversationTurn) {
      $.ui.status(undefined);
      return { ...turnResult, text: outcome };
    }
    $.ui.toast(outcome, { timeoutMs: OUTCOME_TOAST_MS });
    $.ui.status(outcome);
    hasPinnedOutcome = true;
    return turnResult;
  });

  on("prompt.autocomplete", { token: /^-/ }, async (_, e, next) => {
    const isHandoffArgument =
      e.text.startsWith(HANDOFF_COMMAND_PREFIX) &&
      e.start >= HANDOFF_COMMAND_PREFIX.length;
    if (!isHandoffArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingFlags = HANDOFF_FLAG_SUGGESTIONS.filter((flag) =>
      flag.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingFlags] };
  });
};
