import type {
  EngineInterface,
  ModelCompleteResult,
  PluginOptions,
  Register,
  RenderElement,
} from "claude-code";

const RECAP_RULES = `You write a prompt that a fresh coding-agent session could receive to continue the work in the conversation below.
The working directory, the conversation and a <guidance> block, when present, are the only sources: invent nothing they do not contain.
Include the goal, what has been done, what is left, the files and commands mentioned, and any open questions.
If a <focus> block is present, center the recap on it and keep the rest brief.
If a <guidance> block is present, it holds the user's rough notes for the next session: a direction to take, or extra requests. Work out what they mean and write that into the prompt in your own clear words, where it belongs: as the next step, a priority, a constraint or an added task. Do not quote the notes, label them, or add them as a separate block.
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

const FIRST_WORD_AND_REST = /^(\S*)\s*([\s\S]*)$/;
const HANDOFF_ID_AND_REST = /^(?:#?(\d+)(?=\s|$))?\s*([\s\S]*)$/;
const HANDOFF_COMMAND_PREFIX = "/handoff ";

const SUBCOMMAND_SUGGESTIONS = [
  { text: "new", description: "Continue the recap in a fresh session" },
  { text: "save", description: "Only save the recap" },
  { text: "each", description: "Save one handoff per suggested plan" },
  { text: "list", description: "Show this project's handoffs" },
  {
    text: "resume",
    description:
      "Continue the latest handoff, or one by id, plus optional extra context",
  },
  { text: "open", description: "Browse every handoff in the browser" },
];
const PENDING_HANDOFF_KEY = "pendingHandoff";
const LEGACY_HANDOFFS_KEY = "handoffs";
const LISTED_HANDOFF_LIMIT = 10;
const SUMMARY_MAX_LENGTH = 80;
const MAX_SLUG_LENGTH = 60;
const HANDOFF_ID_WIDTH = 3;
const VIEWER_BUILD_TIMEOUT_MS = 180_000;
const HANDOFF_FILE_NAME = /^(\d+)-.*\.md$/;
const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n+/;
const CREATED_FIELD = /^created: (.+)$/m;

const describeNoHandoffs = (projectName: string) =>
  `No handoffs for ${projectName} yet. Run /handoff to create one.`;
const RESUME_HINT =
  "Run /handoff resume <id> to continue one in a new session, or /handoff open to browse them all.";
const NO_PLANS_MESSAGE = "No suggested plans found to hand off.";
const describeSavedPlanCount = (planCount: number) =>
  planCount === 1
    ? "Saved 1 handoff, one per suggested plan:"
    : `Saved ${planCount} handoffs, one per suggested plan:`;
const describeResumeCommand = (handoffId: number) =>
  `Run /handoff resume ${handoffId} to continue it in a new session.`;

type HandoffFile = { handoffId: number; path: string };

const BOX_PANE_ID = "handoff";
const BOX_ROWS = 9;
const NOTES_INPUT_ROWS = 3;
const NOTES_BOX_TITLE = "Handoff notes";
const RESUME_BOX_TITLE = "Resume a handoff";
const NOTES_BOX_MESSAGE =
  "Add notes for the next session in the box, then press Enter. Esc cancels.";
const RESUME_BOX_MESSAGE =
  "Pick a handoff in the box and add notes if you like. Esc cancels.";
const CANCELLED_MESSAGE = "Handoff cancelled.";
const CLOSED_BOX_HINT = "Run /handoff new, save or resume to use this box.";

type SingleRecapRequest = Extract<HandoffArguments, { action: "recap" }>;

type HandoffBox = { notes: string } & (
  | { kind: "notes"; request: SingleRecapRequest }
  | {
      kind: "resume";
      chosenHandoffId: number;
      handoffOptions: { value: string; label: string }[];
    }
);

const BOX_WORDING = {
  notes: {
    heading: "Notes for the next session",
    placeholder: "Optional: anything the recap should carry along",
    submitLabel: "hand off",
    keysHint: "Enter hands off · Tab moves · Esc cancels",
  },
  resume: {
    heading: "Resume a handoff",
    placeholder: "Optional: extra context for the new session",
    submitLabel: "resume",
    keysHint:
      "Enter resumes the latest · Tab to the list to pick another · Esc cancels",
  },
};

type HandoffDraft = {
  recap: string;
  focus: string;
  cwd: string;
  createdAt: number;
};

type LegacyHandoff = {
  recap: string;
  createdAt?: number;
  cwd?: string;
  focus?: string;
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

const describeGuidance = (notes: string) =>
  notes ? `\n\n<guidance>\n${notes}\n</guidance>` : "";

const buildRecapPrompt = (
  workingDirectory: string,
  recentMessages: string,
  steering: string
) => {
  return `Working directory: ${workingDirectory}\n\nConversation:\n${recentMessages}${steering}`;
};

const CONVERSATION_PREAMBLE = `Stop the work here. Do not use any tools for this message: answer it straight away.
The conversation above is what the rules below call "the conversation below".`;

type HandoffArguments =
  | { action: "list" }
  | { action: "open" }
  | { action: "resume"; handoffId: number | undefined; extraContext: string }
  | { action: "each"; focus: string }
  | {
      action: "recap";
      isNewSession: boolean;
      isSaveOnly: boolean;
      focus: string;
      notes: string;
    };

const parseHandoffArguments = (args: string): HandoffArguments => {
  const [, firstWord = "", laterWords = ""] =
    FIRST_WORD_AND_REST.exec(args.trim()) ?? [];
  const subcommand = firstWord.replace(/^--/, "");
  if (subcommand === "list" || subcommand === "open") {
    return { action: subcommand };
  }
  if (subcommand === "resume") {
    const [, handoffId, extraContext = ""] =
      HANDOFF_ID_AND_REST.exec(laterWords) ?? [];
    return {
      action: "resume",
      handoffId: handoffId === undefined ? undefined : Number(handoffId),
      extraContext,
    };
  }
  if (subcommand === "each") return { action: "each", focus: laterWords };
  const isRecapSubcommand = subcommand === "new" || subcommand === "save";
  return {
    action: "recap",
    isNewSession: subcommand === "new",
    isSaveOnly: subcommand === "save",
    focus: isRecapSubcommand ? laterWords : args.trim(),
    notes: "",
  };
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const summarizeRecap = (recap: string) => {
  const firstLine =
    recap
      .split("\n")
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line) ?? "";
  return firstLine.length > SUMMARY_MAX_LENGTH
    ? `${firstLine.slice(0, SUMMARY_MAX_LENGTH)}…`
    : firstLine;
};

const toSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, "");

const toProjectName = (folder: string) => {
  const lastSegment = folder.split("/").filter(Boolean).pop() ?? "";
  const projectName = lastSegment.replace(/[^A-Za-z0-9._-]+/g, "-");
  return /[A-Za-z0-9]/.test(projectName) ? projectName : "unknown";
};

const resolveProjectName = async (engine: EngineInterface, folder: string) => {
  const commonGitFolder = await engine.process
    .run([
      "git",
      "-C",
      folder,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
    .then((outcome) => (outcome.exitCode === 0 ? outcome.stdout.trim() : ""))
    .catch(() => "");
  return toProjectName(
    commonGitFolder.replace(GIT_FOLDER_SUFFIX, "") || folder
  );
};

const readHandoffsRoot = async (engine: EngineInterface) =>
  (await engine.env.get("HANDOFFS_DIR")) ??
  `${(await engine.env.get("HOME")) ?? ""}/.claude/handoffs`;

const findHandoffFolder = async (engine: EngineInterface, folder: string) => {
  const projectName = await resolveProjectName(engine, folder);
  return {
    projectName,
    folderPath: `${await readHandoffsRoot(engine)}/${projectName}`,
  };
};

const listHandoffFiles = async (
  engine: EngineInterface,
  folderPath: string
): Promise<HandoffFile[]> => {
  const folderEntries = await engine.fs.list(folderPath).catch(() => []);
  return folderEntries
    .flatMap((entry) => {
      const handoffId = HANDOFF_FILE_NAME.exec(entry.name)?.[1];
      return handoffId
        ? [
            {
              handoffId: Number(handoffId),
              path: `${folderPath}/${entry.name}`,
            },
          ]
        : [];
    })
    .sort((first, second) => second.handoffId - first.handoffId);
};

const saveHandoff = async (
  engine: EngineInterface,
  draft: HandoffDraft
): Promise<HandoffFile> => {
  const { projectName, folderPath } = await findHandoffFolder(
    engine,
    draft.cwd
  );
  const [newestFile] = await listHandoffFiles(engine, folderPath);
  const handoffId = (newestFile?.handoffId ?? 0) + 1;
  const title = summarizeRecap(draft.recap);
  const fileName = `${String(handoffId).padStart(HANDOFF_ID_WIDTH, "0")}-${toSlug(title) || "handoff"}.md`;
  const frontMatter = [
    `title: ${title}`,
    `project: ${projectName}`,
    `created: ${new Date(draft.createdAt).toISOString()}`,
    `cwd: ${draft.cwd}`,
    ...(draft.focus ? [`focus: ${draft.focus.replace(/\s+/g, " ")}`] : []),
  ].join("\n");
  const path = `${folderPath}/${fileName}`;
  await engine.fs.write(path, `---\n${frontMatter}\n---\n\n${draft.recap}\n`);
  return { handoffId, path };
};

const saveSessionHandoff = async (
  engine: EngineInterface,
  recap: string,
  focus: string
) =>
  saveHandoff(engine, {
    recap,
    focus,
    cwd: await engine.session.cwd(),
    createdAt: await engine.clock.now(),
  });

const readHandoff = async (engine: EngineInterface, file: HandoffFile) => {
  const fileText = String(await engine.fs.read(file.path));
  const frontMatter = FRONT_MATTER.exec(fileText)?.[1] ?? "";
  return {
    ...file,
    created: CREATED_FIELD.exec(frontMatter)?.[1] ?? "",
    recap: fileText.replace(FRONT_MATTER, "").trim(),
  };
};

const isLegacyHandoff = (value: unknown): value is LegacyHandoff =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as LegacyHandoff).recap === "string";

const fileLegacyHandoffs = async (engine: EngineInterface) => {
  const storedValue = await engine.store.get(LEGACY_HANDOFFS_KEY);
  if (!Array.isArray(storedValue)) return;
  try {
    for (const legacyHandoff of storedValue.filter(isLegacyHandoff)) {
      await saveHandoff(engine, {
        recap: legacyHandoff.recap,
        focus: legacyHandoff.focus ?? "",
        cwd: legacyHandoff.cwd ?? (await engine.session.cwd()),
        createdAt: legacyHandoff.createdAt ?? (await engine.clock.now()),
      });
    }
    await engine.store.delete(LEGACY_HANDOFFS_KEY);
  } catch {
    return;
  }
};

const describeListedHandoff = (handoff: {
  handoffId: number;
  created: string;
  recap: string;
}) =>
  `#${handoff.handoffId}  ${handoff.created.slice(0, 16).replace("T", " ")}  ${summarizeRecap(handoff.recap)}`;

const listProjectHandoffs = async (engine: EngineInterface) => {
  const { projectName, folderPath } = await findHandoffFolder(
    engine,
    await engine.session.cwd()
  );
  const handoffFiles = await listHandoffFiles(engine, folderPath);
  if (handoffFiles.length === 0) {
    return { text: describeNoHandoffs(projectName) };
  }
  const shownHandoffs = await Promise.all(
    handoffFiles
      .slice(0, LISTED_HANDOFF_LIMIT)
      .map((file) => readHandoff(engine, file))
  );
  const olderCount = handoffFiles.length - shownHandoffs.length;
  return {
    text: [
      `Handoffs for ${projectName}, newest first:`,
      ...shownHandoffs.map(describeListedHandoff),
      ...(olderCount > 0 ? [`…and ${olderCount} older.`] : []),
      "",
      RESUME_HINT,
    ].join("\n"),
  };
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

const describeSteering = (request: RecapRequest) =>
  describeFocus(request.focus) +
  describeGuidance(request.action === "recap" ? request.notes : "");

const buildConversationPrompt = (request: RecapRequest) =>
  `${CONVERSATION_PREAMBLE}\n\n${chooseRecapStyle(request).rules}${describeSteering(request)}`;

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

const spawnRecapAgent = async (engine: EngineInterface, promptText: string) => {
  try {
    return await engine.agent.spawn({
      prompt: promptText,
      description: RECAP_AGENT_DESCRIPTION,
      subagentType: RECAP_AGENT_TYPE,
      model: RECAP_MODEL,
    });
  } catch {
    return undefined;
  }
};

const delegateRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  digest: string,
  canUseSubagent: boolean
): Promise<RecapDelegation | undefined> => {
  if (canUseSubagent) {
    const promptText = buildAgentPrompt(request, digest);
    const spawnResult = await spawnRecapAgent(engine, promptText);
    if (spawnResult === undefined) return undefined;
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
    describeSteering(request)
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

type RecapStart =
  | { recap: string; failure?: undefined; delegation?: undefined }
  | { failure: string; delegation?: undefined }
  | { delegation: RecapDelegation; delegationPrefix: string };

const startRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  writer: string | undefined
): Promise<RecapStart> => {
  const isHaikuWriter = writer === HAIKU_WRITER;
  const recapBuild = await buildRecap(engine, request, isHaikuWriter);
  if (recapBuild.delegationPrefix === undefined) return recapBuild;
  const delegation = await delegateRecap(
    engine,
    request,
    recapBuild.digest,
    writer !== CONVERSATION_WRITER
  );
  if (delegation) {
    return { delegation, delegationPrefix: recapBuild.delegationPrefix };
  }
  const modelRecapBuild = isHaikuWriter
    ? recapBuild
    : await buildRecap(engine, request, true);
  if (modelRecapBuild.delegationPrefix === undefined) return modelRecapBuild;
  return {
    delegation: askConversationForRecap(engine, request),
    delegationPrefix: modelRecapBuild.delegationPrefix,
  };
};

const splitPlanRecaps = (text: string) =>
  text
    .split(PLAN_SEPARATOR)
    .map(stripWrappingCodeFence)
    .filter((planRecap) => planRecap);

const savePlanHandoffs = async (
  engine: EngineInterface,
  recapText: string,
  focus: string
) => {
  const planRecaps = splitPlanRecaps(recapText);
  if (planRecaps.length === 0) return { text: NO_PLANS_MESSAGE };

  const savedHandoffLines: string[] = [];
  for (const planRecap of planRecaps) {
    const { handoffId } = await saveSessionHandoff(engine, planRecap, focus);
    savedHandoffLines.push(`#${handoffId}  ${summarizeRecap(planRecap)}`);
  }
  return {
    text: [
      describeSavedPlanCount(savedHandoffLines.length),
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

const showRecapInComposer = async (engine: EngineInterface, recap: string) => {
  const { text } = await offerRecapInThisSession(engine, recap);
  engine.ui.toast(text, { timeoutMs: OUTCOME_TOAST_MS });
};

const clearSessionAndPassRecap = async (
  engine: EngineInterface,
  recap: string,
  shouldSubmitRecap: boolean
) => {
  await engine.command.run({ command: "clear" });
  if (shouldSubmitRecap) {
    await engine.prompt.submit({ text: recap, asUser: true });
  } else {
    await showRecapInComposer(engine, recap);
  }
};

const handOffToNewSession = async (
  engine: EngineInterface,
  recap: string,
  shouldSubmitRecap: boolean
) => {
  try {
    await clearSessionAndPassRecap(engine, recap, shouldSubmitRecap);
  } catch {
    engine.ui.toast("Could not start a new session.");
    await offerRecapInThisSession(engine, recap);
  }
  await engine.store.delete(PENDING_HANDOFF_KEY);
};

const startNewSessionWithRecap = async (
  engine: EngineInterface,
  recap: string,
  shouldSubmitRecap: boolean
) => {
  await engine.store.set(PENDING_HANDOFF_KEY, recap);
  engine.clock.after(
    0,
    () => void handOffToNewSession(engine, recap, shouldSubmitRecap)
  );
  return { text: HANDING_OFF_MESSAGE };
};

const deliverRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  recapText: string,
  isRecapOnScreen: boolean
) => {
  if (request.action === "each") {
    return savePlanHandoffs(engine, recapText, request.focus);
  }
  const saveOutcome = await saveSessionHandoff(
    engine,
    recapText,
    request.focus
  ).catch(describeError);
  const saveFailure =
    typeof saveOutcome === "string"
      ? `The handoff could not be saved (${saveOutcome}).`
      : undefined;
  if (request.isSaveOnly) {
    return {
      text:
        typeof saveOutcome === "string"
          ? `${saveFailure} The recap:\n\n${recapText}`
          : `Saved as handoff #${saveOutcome.handoffId} in ${saveOutcome.path}. ${describeResumeCommand(saveOutcome.handoffId)}`,
    };
  }
  if (saveFailure) engine.ui.toast(saveFailure);
  if (!request.isNewSession) {
    return offerRecapInThisSession(engine, recapText, isRecapOnScreen);
  }
  return startNewSessionWithRecap(engine, recapText, true);
};

const buildResumeBox = async (
  engine: EngineInterface
): Promise<HandoffBox | undefined> => {
  const { folderPath } = await findHandoffFolder(
    engine,
    await engine.session.cwd()
  );
  const handoffFiles = await listHandoffFiles(engine, folderPath);
  const [latestFile] = handoffFiles;
  if (!latestFile) return undefined;
  const listedHandoffs = await Promise.all(
    handoffFiles
      .slice(0, LISTED_HANDOFF_LIMIT)
      .map((file) => readHandoff(engine, file))
  );
  return {
    kind: "resume",
    notes: "",
    chosenHandoffId: latestFile.handoffId,
    handoffOptions: listedHandoffs.map((handoff) => ({
      value: String(handoff.handoffId),
      label: describeListedHandoff(handoff),
    })),
  };
};

const placeBoxPane = async (engine: EngineInterface, title: string) => {
  try {
    const openResult = await engine.ui.open({
      id: BOX_PANE_ID,
      title,
      focus: true,
      closeOnEscape: true,
      holdToasts: true,
      rows: BOX_ROWS,
    });
    if (openResult?.isPlaced) return true;
    if (openResult) await engine.ui.close({ id: BOX_PANE_ID });
    return false;
  } catch {
    return false;
  }
};

const appendExtraContext = (recap: string, extraContext: string) =>
  extraContext
    ? `${recap}\n\nExtra context from the user: ${extraContext}`
    : recap;

const resumeSavedHandoff = async (
  engine: EngineInterface,
  handoffId: number | undefined,
  extraContext: string
) => {
  const { projectName, folderPath } = await findHandoffFolder(
    engine,
    await engine.session.cwd()
  );
  const handoffFiles = await listHandoffFiles(engine, folderPath);
  const chosenFile =
    handoffId === undefined
      ? handoffFiles[0]
      : handoffFiles.find((file) => file.handoffId === handoffId);
  if (!chosenFile) {
    return {
      text:
        handoffId === undefined
          ? describeNoHandoffs(projectName)
          : `No handoff #${handoffId} for ${projectName}. Run /handoff list to see its handoffs.`,
    };
  }
  const { recap } = await readHandoff(engine, chosenFile);
  return startNewSessionWithRecap(
    engine,
    appendExtraContext(recap, extraContext),
    false
  );
};

const openViewer = async (engine: EngineInterface) => {
  const launch = await engine.process
    .run(["bash", `${engine.plugin.root}/bin/handoffs`, "--background"], {
      timeoutMs: VIEWER_BUILD_TIMEOUT_MS,
    })
    .catch(() => undefined);
  if (launch?.exitCode === 0)
    return { text: "Handoffs are opening in the browser." };
  return {
    text: launch?.stderr.trim() || "Could not start the handoffs viewer.",
  };
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

const cancelBox = async (
  engine: EngineInterface,
  progress: HandoffProgress
) => {
  progress.openBox = undefined;
  await engine.ui.close({ id: BOX_PANE_ID });
  engine.ui.toast(CANCELLED_MESSAGE);
};

type HandoffProgress = {
  writer: string;
  awaitedRecap: AwaitedRecap | undefined;
  recapAgentId: string | undefined;
  openBox: HandoffBox | undefined;
};

const runRecap = async (
  engine: EngineInterface,
  progress: HandoffProgress,
  request: RecapRequest
) => {
  const recapStart = await startRecap(engine, request, progress.writer);
  if (recapStart.delegation !== undefined) {
    const { delegation, delegationPrefix } = recapStart;
    progress.awaitedRecap = delegation.awaitedRecap;
    progress.recapAgentId = delegation.awaitedRecap.agentId;
    engine.ui.status(delegation.routeNotice);
    return { text: `${delegationPrefix}${delegation.routeNotice}` };
  }
  if (recapStart.failure !== undefined) return { text: recapStart.failure };
  return deliverRecap(engine, request, recapStart.recap, false);
};

const showBox = async (
  engine: EngineInterface,
  progress: HandoffProgress,
  title: string,
  box: HandoffBox
) => {
  progress.openBox = box;
  const isBoxPlaced = await placeBoxPane(engine, title);
  if (!isBoxPlaced) progress.openBox = undefined;
  return isBoxPlaced;
};

const finishBox = async (
  engine: EngineInterface,
  progress: HandoffProgress
) => {
  const box = progress.openBox;
  if (!box) return;
  progress.openBox = undefined;
  await engine.ui.close({ id: BOX_PANE_ID });
  const notes = box.notes.trim();
  const outcome =
    box.kind === "resume"
      ? await resumeSavedHandoff(engine, box.chosenHandoffId, notes)
      : await runRecap(engine, progress, { ...box.request, notes });
  engine.ui.toast(outcome.text, { timeoutMs: OUTCOME_TOAST_MS });
};

export const register: Register = (on, options) => {
  const progress: HandoffProgress = {
    writer: readStringOption(options, "writer"),
    awaitedRecap: undefined,
    recapAgentId: undefined,
    openBox: undefined,
  };
  let hasPinnedOutcome = false;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "handoff",
      description:
        "Summarize the session into a prompt that resumes the work. new: continue it in a fresh session; save: only save it; each: one handoff per suggested plan; list: this project's handoffs; resume [id] [extra context]: continue the latest or a chosen one; open: browse every handoff in the browser",
      argumentHint:
        "[new | save | each] [focus] | list | resume [id] [extra context] | open",
    });
    await resumePendingHandoff($);

    return next(e);
  });

  on("command.run", { command: "handoff" }, async ($, e) => {
    const handoffArguments = parseHandoffArguments(e.args);
    if (handoffArguments.action === "open") return openViewer($);
    await fileLegacyHandoffs($);
    if (handoffArguments.action === "list") return listProjectHandoffs($);
    if (handoffArguments.action === "resume") {
      const isBareResume =
        handoffArguments.handoffId === undefined &&
        !handoffArguments.extraContext;
      const resumeBox = isBareResume ? await buildResumeBox($) : undefined;
      if (
        resumeBox &&
        (await showBox($, progress, RESUME_BOX_TITLE, resumeBox))
      ) {
        return { text: RESUME_BOX_MESSAGE };
      }
      return resumeSavedHandoff(
        $,
        handoffArguments.handoffId,
        handoffArguments.extraContext
      );
    }
    const isBareRecapAction =
      handoffArguments.action === "recap" &&
      (handoffArguments.isNewSession || handoffArguments.isSaveOnly) &&
      !handoffArguments.focus;
    if (
      isBareRecapAction &&
      (await showBox($, progress, NOTES_BOX_TITLE, {
        kind: "notes",
        notes: "",
        request: handoffArguments,
      }))
    ) {
      return { text: NOTES_BOX_MESSAGE };
    }
    return runRecap($, progress, handoffArguments);
  });

  on("ui.render", { component: "Pane", requestId: BOX_PANE_ID }, ($, e) => {
    const { Box, Text, Input, Select, Button } = $.ui.resolve(e);
    const box = progress.openBox;
    if (!box)
      return h(Text, { dimColor: true }, CLOSED_BOX_HINT) as RenderElement;
    const wording = BOX_WORDING[box.kind];
    return h(
      Box,
      { flexDirection: "column", gap: 1 },
      h(Text, { bold: true }, wording.heading),
      h(Input, {
        key: "notes",
        placeholder: wording.placeholder,
        submitLabel: wording.submitLabel,
        rows: NOTES_INPUT_ROWS,
        autoFocus: true,
        onInput: (typedNotes: string) => {
          box.notes = typedNotes;
        },
        onSubmit: (typedNotes: string) => {
          box.notes = typedNotes;
          return finishBox($, progress);
        },
      }),
      box.kind === "resume"
        ? h(Select, {
            key: "handoff",
            label: "Handoff",
            options: box.handoffOptions,
            value: String(box.chosenHandoffId),
            onSelect: (chosenValue: string) => {
              box.chosenHandoffId = Number(chosenValue);
              return finishBox($, progress);
            },
          })
        : null,
      h(
        Box,
        { flexDirection: "row", gap: 2 },
        h(
          Button,
          {
            key: "continue",
            variant: "primary",
            onPress: () => finishBox($, progress),
          },
          box.kind === "resume" ? "Resume" : "Hand off"
        ),
        h(
          Button,
          {
            key: "cancel",
            role: "dismiss",
            onPress: () => cancelBox($, progress),
          },
          "Cancel"
        )
      ),
      h(Text, { dimColor: true }, wording.keysHint)
    ) as RenderElement;
  });

  on("prompt.submit", (_, e, next) => {
    const isRecapAgentReport =
      e.origin?.kind === "peer" &&
      progress.recapAgentId !== undefined &&
      e.text.includes(`<agent-message from="${progress.recapAgentId}">`);
    if (!isRecapAgentReport) return next(e);
    progress.recapAgentId = undefined;
    return { drop: RECAP_AGENT_DONE_NOTICE };
  });

  on("turn.start", ($, e, next) => {
    if (
      progress.awaitedRecap &&
      e.text.includes(progress.awaitedRecap.promptText)
    ) {
      progress.awaitedRecap = { ...progress.awaitedRecap, turnId: e.turnId };
    }
    if (hasPinnedOutcome && e.agentId === undefined) {
      $.ui.status(undefined);
      hasPinnedOutcome = false;
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const turnResult = await next(e);
    if (!progress.awaitedRecap || !isAwaitedTurn(progress.awaitedRecap, e))
      return turnResult;
    const { request } = progress.awaitedRecap;
    progress.awaitedRecap = undefined;

    const isConversationTurn = e.agentId === undefined;
    progress.recapAgentId = e.agentId;
    const recap = stripWrappingCodeFence(e.answer);
    if (!recap && !isConversationTurn) {
      const delegation = askConversationForRecap($, request);
      progress.awaitedRecap = delegation.awaitedRecap;
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

  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstHandoffArgument =
      e.text.startsWith(HANDOFF_COMMAND_PREFIX) &&
      e.start === HANDOFF_COMMAND_PREFIX.length;
    if (!isFirstHandoffArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingSubcommands = SUBCOMMAND_SUGGESTIONS.filter((subcommand) =>
      subcommand.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingSubcommands] };
  });
};
