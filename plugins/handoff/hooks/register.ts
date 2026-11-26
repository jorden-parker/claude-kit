import type {
  EngineInterface,
  ModelCompleteResult,
  PluginOptions,
  Register,
  RenderElement,
  RenderInput,
} from "claude-code";
import { findSecretKinds } from "./secret-patterns";

const OPEN_QUESTIONS_HEADING = "Open questions for the user:";

const RECAP_RULES = `You write a handoff note: background context about the conversation below, which a fresh coding-agent session reads to understand what happened. It is not a task and never asks for work.
The working directory, the conversation and the <guidance> and <decisions> blocks, when present, are the only sources: invent nothing they do not contain.
Start with a one-line title that names the work, in 60 characters at most and with no period at the end, then a blank line.
Right after the title line, when the work is about a git repository other than the working directory's, write a line "Repository: <absolute folder path>" naming it, judged from the files and commands in the conversation. When the work could belong to more than one repository, list each folder: "Repository: <path> | <path>". Leave the line out when the work is in the working directory's repository.
Include the goal, what has been done, what is still open, and the files and commands mentioned. Write it as a description of the state of things, and never phrase any of it as instructions to do work.
If decisions are left that only the user can make, end with a line reading exactly "${OPEN_QUESTIONS_HEADING}", then one line per decision in the form "- <question ending in a question mark> (<likely answer> | <likely answer>)", with two or three likely answers. Leave that section out when no such decision is left, and never list there what the next session can check for itself.
If a <focus> block is present, center the note on it and keep the rest brief.
If a <guidance> block is present, it holds the user's rough notes about the session. Work out what they mean and write that into the note in your own clear words, as context or a constraint. Do not quote the notes, label them, or add them as a separate block.
If a <decisions> block is present, the user has already been asked: it holds each question with the user's answer, or marked as left open. An answered question is settled: write it into the note in your own clear words, in the goal or as context or a constraint, and make the rest of the note agree with it. Do not quote the questions or the answers, label them, add them as a separate block, or list a settled question as open. The open questions are then only the ones the block marks as left open: list no others.
Output only the note, with no preamble, quotes or explanation.`;

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
  { text: "save", description: "Only save the recap" },
  { text: "list", description: "Show this project's handoffs" },
  {
    text: "resume",
    description:
      "Load the latest handoff, or one by id, plus optional extra context",
  },
];
const PENDING_HANDOFF_KEY = "pendingHandoff";
const LEGACY_HANDOFFS_KEY = "handoffs";
const LISTED_HANDOFF_LIMIT = 10;
const SUMMARY_MAX_LENGTH = 80;
const MAX_SLUG_LENGTH = 60;
const HANDOFF_ID_WIDTH = 3;
const HANDOFF_FILE_NAME = /^(\d+)-.*\.md$/;
const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const CLAUDE_WORKTREE_PATH = /^(.+?)\/\.claude\/worktrees\/[^/]+/;
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n+/;
const CREATED_FIELD = /^created: (.+)$/m;

const describeNoHandoffs = (projectName: string) =>
  `No handoffs for ${projectName} yet. Run /handoff to create one.`;
const RESUME_HINT =
  "Run /handoff resume <id> to load one into a new session, or claude-notes in a terminal to browse them all.";
const describeResumeCommand = (handoffId: number) =>
  `Run /handoff resume ${handoffId} to load it into a new session.`;

type HandoffFile = { handoffId: number; path: string };

const HANDOFF_GLYPH = "📜";
const PRIDE_STRIPE_COLORS = [
  "error",
  "claude",
  "warning",
  "success",
  "suggestion",
  "autoAccept",
] as const;
const BOX_PANE_ID = "handoff";
const BOX_ROWS = 11;
const HANDOFF_STEPS = [
  { word: "Asking", label: "Ask the open questions" },
  { word: "Writing", label: "Write the recap" },
  { word: "Saving", label: "Save the handoff" },
];
const ASKING_STEP = 0;
const WRITING_STEP = 1;
const SAVING_STEP = 2;
const SPINNER_FRAMES = [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"];
const SPINNER_INTERVAL_MS = 100;
const BOX_SIDE_PADDING = 2;
const NOTES_INPUT_ROWS = 3;
const NOTES_BOX_TITLE = "Handoff notes";
const RESUME_BOX_TITLE = "Resume a handoff";
const NOTES_BOX_MESSAGE =
  "Add notes for the next session in the box, then press Enter. Cancel drops it.";
const RESUME_BOX_MESSAGE =
  "Pick a handoff in the box and add notes if you like. Cancel drops it.";
const CANCELLED_MESSAGE = "Handoff cancelled.";
const CLOSED_BOX_HINT = "Run /handoff save or resume to use this box.";

const showToast = (
  engine: EngineInterface,
  text: string,
  options?: Parameters<EngineInterface["ui"]["toast"]>[1]
) => engine.ui.toast(`${HANDOFF_GLYPH} ${text}`, options);

const showStatus = (engine: EngineInterface, text: string | undefined) =>
  engine.ui.status(text === undefined ? undefined : `${HANDOFF_GLYPH} ${text}`);

type HandoffBox = { notes: string } & (
  | { kind: "notes"; request: RecapRequest }
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
    keysHint: "Enter hands off · Tab moves · Cancel to drop",
  },
  resume: {
    heading: "Resume a handoff",
    placeholder: "Optional: extra context for the new session",
    submitLabel: "resume",
    keysHint:
      "Enter resumes the latest · Tab to the list to pick another · Cancel to drop",
  },
};

type HandoffDraft = {
  recap: string;
  focus: string;
  cwd: string;
  createdAt: number;
  topic?: string;
};

type LegacyHandoff = {
  recap: string;
  createdAt?: number;
  cwd?: string;
  focus?: string;
};

const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

const PARAGRAPH = String.raw`(?:(?!\n\s*\n)[\s\S])*`;
const CLASSIFIER_NOTICES = new RegExp(
  `^(?:Note:(?=${PARAGRAPH}classifier)(?=${PARAGRAPH}unavailable)${PARAGRAPH}(?:\\n\\s*\\n|$))+`,
  "i"
);

const stripClassifierNotices = (text: string) =>
  text.replace(CLASSIFIER_NOTICES, "").trim();

const stripWrappingCodeFence = (text: string) =>
  stripClassifierNotices(
    stripClassifierNotices(text.trim()).replace(WRAPPING_CODE_FENCE, "$1")
  );

const truncateMessageText = (text: string) =>
  text.length > RECENT_MESSAGE_MAX_LENGTH
    ? `${text.slice(0, RECENT_MESSAGE_MAX_LENGTH)}…`
    : text;

const describeRecentMessages = async (engine: EngineInterface) => {
  const messages = await engine.session.messages();
  const recentMessages = messages
    .filter((message) => message.text.trim())
    .slice(-RECENT_MESSAGE_COUNT);
  return recentMessages
    .map((message) => `${message.role}: ${truncateMessageText(message.text)}`)
    .join("\n");
};

const describeFocus = (focus: string) =>
  focus ? `\n\n<focus>\n${focus}\n</focus>` : "";

const describeGuidance = (notes: string) =>
  notes ? `\n\n<guidance>\n${notes}\n</guidance>` : "";

const NO_DECISION_LINE = "No question was left for the user.";

const describeDecisions = (decisionLines: string | undefined) =>
  decisionLines === undefined
    ? ""
    : `\n\n<decisions>\n${decisionLines || NO_DECISION_LINE}\n</decisions>`;

const buildRecapPrompt = (
  workingDirectory: string,
  recentMessages: string,
  steering: string
) => {
  return `Working directory: ${workingDirectory}\n\nConversation:\n${recentMessages}${steering}`;
};

const NO_TOOLS_RULE =
  "Do not use any tools for this message: answer it straight away.";
const ASK_FIRST_RULE =
  "Use no tool for this message except AskUserQuestion. First ask the user, with AskUserQuestion, each decision that only they can make and that the work cannot continue without, offering two or three likely answers each; never ask what the next session can check for itself. Then answer straight away. For the rules below, a <decisions> block is present: it holds each question you asked, with the user's answer or marked as left open, and is empty when you asked nothing.";
const buildConversationPreamble = (toolRule: string) =>
  `Stop the work here. ${toolRule}
The conversation above is what the rules below call "the conversation below".`;

type HandoffArguments =
  | { action: "list"; topic?: string }
  | {
      action: "resume";
      handoffId: number | undefined;
      extraContext: string;
      topic?: string;
    }
  | {
      action: "recap";
      isSaveOnly: boolean;
      focus: string;
      notes: string;
      decisionLines?: string;
      topic?: string;
    };

const TOPIC_FLAG = /(?:^|\s)--topic(?=\s|$)(?:\s+(\S+))?/;

const parseHandoffArguments = (args: string): HandoffArguments => {
  const flag = TOPIC_FLAG.exec(args);
  const parsed = parseSubcommand(args.replace(TOPIC_FLAG, ""));
  return flag === null ? parsed : { ...parsed, topic: flag[1] ?? "" };
};

const parseSubcommand = (args: string): HandoffArguments => {
  const [, firstWord = "", laterWords = ""] =
    FIRST_WORD_AND_REST.exec(args.trim()) ?? [];
  const subcommand = firstWord.replace(/^--/, "");
  if (subcommand === "list") {
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
  const isSaveOnly = subcommand === "save";
  return {
    action: "recap",
    isSaveOnly,
    focus: isSaveOnly ? laterWords : args.trim(),
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
    commonGitFolder.replace(GIT_FOLDER_SUFFIX, "") ||
      folder.match(CLAUDE_WORKTREE_PATH)?.[1] ||
      folder
  );
};

const readHandoffsRoot = async (engine: EngineInterface) =>
  (await engine.env.get("HANDOFFS_DIR")) ??
  `${(await engine.env.get("HOME")) ?? ""}/.local/share/handoffs`;

const findHandoffFolder = async (
  engine: EngineInterface,
  folder: string,
  topic?: string
) => {
  const projectName = topic
    ? toProjectName(topic)
    : await resolveProjectName(engine, folder);
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
    draft.cwd,
    draft.topic
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
    ...(draft.topic ? [`topic: ${draft.topic}`] : []),
    ...(draft.focus ? [`focus: ${draft.focus.replace(/\s+/g, " ")}`] : []),
  ].join("\n");
  const path = `${folderPath}/${fileName}`;
  await engine.fs.write(path, `---\n${frontMatter}\n---\n\n${draft.recap}\n`);
  return { handoffId, path };
};

const REPOSITORY_LINE = /^Repository: (.+)\n/m;
const REPOSITORY_QUESTION = "Which repository is this handoff about?";

const readRepositoryCandidates = (recap: string) =>
  (REPOSITORY_LINE.exec(recap)?.[1] ?? "")
    .split("|")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.startsWith("/"));

const chooseRepositoryFolder = async (
  engine: EngineInterface,
  candidates: string[]
) => {
  if (candidates.length < 2) return candidates[0];
  try {
    return await engine.ui.ask(REPOSITORY_QUESTION, {
      header: QUESTION_DIALOG_HEADER,
      options: candidates,
    });
  } catch {
    return undefined;
  }
};

const saveSessionHandoff = async (
  engine: EngineInterface,
  recap: string,
  focus: string,
  topic?: string
) => {
  const repositoryFolder = topic
    ? undefined
    : await chooseRepositoryFolder(engine, readRepositoryCandidates(recap));
  return saveHandoff(engine, {
    recap: recap.replace(REPOSITORY_LINE, ""),
    focus,
    topic,
    cwd: repositoryFolder || (await engine.session.cwd()),
    createdAt: await engine.clock.now(),
  });
};

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

const listProjectHandoffs = async (engine: EngineInterface, topic?: string) => {
  const { projectName, folderPath } = await findHandoffFolder(
    engine,
    await engine.session.cwd(),
    topic
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
  isQuestionTurn?: boolean;
};

const RECAP_TIMEOUT_MS = 15000;

const describeSteering = (request: RecapRequest) =>
  describeFocus(request.focus) +
  describeGuidance(request.notes) +
  describeDecisions(request.decisionLines);

const buildConversationPrompt = (request: RecapRequest) => {
  const preamble = buildConversationPreamble(
    request.decisionLines === undefined ? ASK_FIRST_RULE : NO_TOOLS_RULE
  );
  return `${preamble}\n\n${RECAP_RULES}${describeSteering(request)}`;
};

const RECAP_MODEL = "haiku";
const HAIKU_WRITER = "haiku";
const CONVERSATION_WRITER = "conversation";
const RECAP_AGENT_TYPE = "handoff:recap";
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
  `${AGENT_PREAMBLE}\n\n${RECAP_RULES}\n\n${digest}`;

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
  const recentMessages = await describeRecentMessages(engine);
  if (!recentMessages) return { failure: NO_RECAP_MESSAGE };
  const digest = buildRecapPrompt(
    await engine.session.cwd(),
    recentMessages,
    describeSteering(request)
  );
  if (!isHaikuWriter) return { delegationPrefix: "", digest };

  showToast(engine, "Building recap…");
  const reply = await completeWithBackoff(engine, () =>
    engine.model.complete({
      model: RECAP_MODEL,
      system: RECAP_RULES,
      prompt: digest,
      effort: "low",
      timeoutMs: RECAP_TIMEOUT_MS,
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
  showToast(engine, text, { timeoutMs: OUTCOME_TOAST_MS });
};

const clearSessionAndPassRecap = async (
  engine: EngineInterface,
  recap: string
) => {
  await engine.command.run({ command: "clear" });
  await showRecapInComposer(engine, recap);
};

const handOffToNewSession = async (engine: EngineInterface, recap: string) => {
  try {
    await clearSessionAndPassRecap(engine, recap);
  } catch {
    showToast(engine, "Could not start a new session.");
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

const QUESTION_DIALOG_HEADER = "Handoff";
const QUESTION_BULLET = /^\s*[-*]\s+\S/;
const ASKING_QUESTIONS_MESSAGE =
  "Checking for open questions in the conversation…";
const QUESTION_TURN_RULES = `Stop the work here. Use no tool for this message except AskUserQuestion.
A prompt is about to be written that records this conversation as background for a fresh coding-agent session. If decisions are left that only the user can make and that the work cannot continue without, ask the user each one with AskUserQuestion, offering two or three likely answers. Never ask what the next session can check for itself, or what the conversation already settles.
If a <focus> block follows, only ask about it. A <guidance> block holds the user's notes for the next session: never ask what they settle.
Then reply with only one line per question you asked, in the form "- <question> Answer: <the user's answer>", or "- <question> Left open" when the user did not answer it. When you asked nothing, reply with only the word "none".`;

const readDecisionLines = (answer: string) =>
  answer
    .split("\n")
    .filter((line) => QUESTION_BULLET.test(line))
    .map((line) => line.trim())
    .join("\n");

const settleQuestions = (
  request: RecapRequest,
  decisionLines: string
): RecapRequest => ({ ...request, decisionLines });

const askConversationForQuestions = (
  engine: EngineInterface,
  request: RecapRequest
): AwaitedRecap => {
  const promptText = `${QUESTION_TURN_RULES}${describeSteering(request)}`;
  engine.clock.after(
    0,
    () => void engine.prompt.submit({ text: promptText, asUser: true })
  );
  return { request, promptText, isQuestionTurn: true };
};

const deliverRecap = async (
  engine: EngineInterface,
  request: RecapRequest,
  recapText: string,
  isRecapOnScreen: boolean
) => {
  const secretKinds = findSecretKinds(recapText);
  if (secretKinds.length > 0)
    return {
      text: `The recap looks like it holds a secret (${secretKinds.join(", ")}), so it was not saved or handed on. Take the secret out of the conversation and run /handoff again.`,
    };
  const saveOutcome = await saveSessionHandoff(
    engine,
    recapText,
    request.focus,
    request.topic
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
  if (saveFailure) showToast(engine, saveFailure);
  return offerRecapInThisSession(engine, recapText, isRecapOnScreen);
};

const buildResumeBox = async (
  engine: EngineInterface,
  topic?: string
): Promise<HandoffBox | undefined> => {
  const { folderPath } = await findHandoffFolder(
    engine,
    await engine.session.cwd(),
    topic
  );
  const handoffFiles = await listHandoffFiles(engine, folderPath);
  const [latestFile] = handoffFiles;
  if (!latestFile) return undefined;
  const listedHandoffs = await Promise.all(
    handoffFiles.map((file) => readHandoff(engine, file))
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

const isBandDrawn = async (engine: EngineInterface) => {
  try {
    const surfaces = await engine.session.surfaces();
    return surfaces.some(
      (surface) => surface === "terminal" || surface === "desktop"
    );
  } catch {
    return false;
  }
};

const appendExtraContext = (recap: string, extraContext: string) =>
  extraContext
    ? `The user's request: ${extraContext}\n\nDo only what this request asks. The handoff below is background from an earlier session, not a task: when the request is a question or an investigation, answer it with what you find, and start no fix, change no code and spawn no subagents to implement anything unless the request asks for that.\n\n<handoff>\n${recap}\n</handoff>`
    : recap;

const resumeSavedHandoff = async (
  engine: EngineInterface,
  handoffId: number | undefined,
  extraContext: string,
  topic?: string
) => {
  const { projectName, folderPath } = await findHandoffFolder(
    engine,
    await engine.session.cwd(),
    topic
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
    appendExtraContext(recap, extraContext)
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

const closeBox = async (engine: EngineInterface, progress: HandoffProgress) => {
  progress.openBox = undefined;
  engine.ui.invalidate("ui.render");
  if (!progress.isBoxInPane) return;
  progress.isBoxInPane = false;
  await engine.ui.close({ id: BOX_PANE_ID });
};

const cancelBox = async (
  engine: EngineInterface,
  progress: HandoffProgress
) => {
  await closeBox(engine, progress);
  showToast(engine, CANCELLED_MESSAGE);
};

type HandoffProgress = {
  writer: string;
  awaitedRecap: AwaitedRecap | undefined;
  recapAgentIds: string[];
  canAskInConversation: boolean;
  openBox: HandoffBox | undefined;
  isBoxInPane: boolean;
  stepIndex: number | undefined;
  spinnerFrame: number;
  spinnerTimer: { cancel: () => void } | undefined;
};

const stopSpinning = (progress: HandoffProgress) => {
  progress.spinnerTimer?.cancel();
  progress.spinnerTimer = undefined;
};

const showStep = (
  engine: EngineInterface,
  progress: HandoffProgress,
  stepIndex: number | undefined
) => {
  progress.stepIndex = stepIndex;
  if (stepIndex === undefined) {
    stopSpinning(progress);
  } else if (!progress.spinnerTimer) {
    progress.spinnerTimer = engine.clock.every(SPINNER_INTERVAL_MS, () => {
      progress.spinnerFrame += 1;
      engine.ui.invalidate("ui.render");
    });
  }
  engine.ui.invalidate("ui.render");
};

const shouldAskQuestionsFirst = (
  progress: HandoffProgress,
  request: RecapRequest
) =>
  progress.canAskInConversation &&
  progress.writer !== CONVERSATION_WRITER &&
  request.decisionLines === undefined;

const deliverWithProgress = async (
  engine: EngineInterface,
  progress: HandoffProgress,
  request: RecapRequest,
  recapText: string,
  isRecapOnScreen: boolean
) => {
  showStep(engine, progress, SAVING_STEP);
  try {
    return await deliverRecap(engine, request, recapText, isRecapOnScreen);
  } finally {
    showStep(engine, progress, undefined);
  }
};

const runRecap = async (
  engine: EngineInterface,
  progress: HandoffProgress,
  request: RecapRequest
): Promise<{ text: string }> => {
  if (shouldAskQuestionsFirst(progress, request)) {
    const recentMessages = await describeRecentMessages(engine);
    if (!recentMessages) return { text: NO_RECAP_MESSAGE };
    progress.awaitedRecap = askConversationForQuestions(engine, request);
    showStatus(engine, ASKING_QUESTIONS_MESSAGE);
    showStep(engine, progress, ASKING_STEP);
    return { text: ASKING_QUESTIONS_MESSAGE };
  }
  showStep(engine, progress, WRITING_STEP);
  const recapStart = await startRecap(engine, request, progress.writer);
  if (recapStart.delegation !== undefined) {
    const { delegation, delegationPrefix } = recapStart;
    progress.awaitedRecap = delegation.awaitedRecap;
    if (delegation.awaitedRecap.agentId !== undefined) {
      progress.recapAgentIds.push(delegation.awaitedRecap.agentId);
    }
    showStatus(engine, delegation.routeNotice);
    return { text: `${delegationPrefix}${delegation.routeNotice}` };
  }
  if (recapStart.failure !== undefined) {
    showStep(engine, progress, undefined);
    return { text: recapStart.failure };
  }
  return deliverWithProgress(
    engine,
    progress,
    request,
    recapStart.recap,
    false
  );
};

const showBox = async (
  engine: EngineInterface,
  progress: HandoffProgress,
  title: string,
  box: HandoffBox
) => {
  progress.openBox = box;
  progress.isBoxInPane = !(await isBandDrawn(engine));
  const isBoxPlaced =
    !progress.isBoxInPane || (await placeBoxPane(engine, title));
  if (isBoxPlaced) {
    engine.ui.invalidate("ui.render");
  } else {
    progress.openBox = undefined;
    progress.isBoxInPane = false;
  }
  return isBoxPlaced;
};

const finishBox = async (
  engine: EngineInterface,
  progress: HandoffProgress
) => {
  const box = progress.openBox;
  if (!box) return;
  await closeBox(engine, progress);
  const notes = box.notes.trim();
  const outcome =
    box.kind === "resume"
      ? await resumeSavedHandoff(engine, box.chosenHandoffId, notes)
      : await runRecap(engine, progress, { ...box.request, notes });
  showToast(engine, outcome.text, { timeoutMs: OUTCOME_TOAST_MS });
};

type BoxRenderInput = RenderInput<"Pane" | "AbovePrompt">;

const drawDivider = (
  Text: ReturnType<EngineInterface["ui"]["resolve"]>["Text"],
  bodyColumns: number
) =>
  h(
    Text,
    { color: "subtle", wrap: "clip" },
    "─".repeat(Math.max(bodyColumns - BOX_SIDE_PADDING * 2, 0))
  );

const drawBox = (
  engine: EngineInterface,
  e: BoxRenderInput,
  box: HandoffBox,
  progress: HandoffProgress
) => {
  const { Box, Text, Input, Select, Button } = engine.ui.resolve(e);
  const wording = BOX_WORDING[box.kind];
  return h(
    Box,
    {
      key: "handoff-box",
      flexDirection: "column",
      paddingX: BOX_SIDE_PADDING,
      marginTop: 1,
    },
    h(
      Box,
      { flexDirection: "row", columnGap: 1 },
      h(Text, { weight: "semibold" }, `${HANDOFF_GLYPH} ${wording.heading}`),
      h(
        Text,
        {},
        ...PRIDE_STRIPE_COLORS.map((color) => h(Text, { color }, "━━"))
      )
    ),
    drawDivider(Text, e.props.bodyColumns),
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
        return finishBox(engine, progress);
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
            return finishBox(engine, progress);
          },
        })
      : null,
    h(
      Box,
      {
        key: "handoff-footer",
        flexDirection: "row",
        justifyContent: "space-between",
        columnGap: 2,
      },
      h(
        Box,
        { flexDirection: "row", columnGap: 2, flexShrink: 0 },
        h(
          Button,
          {
            key: "continue",
            variant: "primary",
            onPress: () => finishBox(engine, progress),
          },
          box.kind === "resume" ? "Resume" : "Hand off"
        ),
        h(
          Button,
          {
            key: "cancel",
            role: "dismiss",
            onPress: () => cancelBox(engine, progress),
          },
          "Cancel"
        )
      ),
      h(
        Box,
        { flexShrink: 1, justifyContent: "flex-end" },
        h(Text, { dimColor: true, wrap: "truncate-end" }, wording.keysHint)
      )
    )
  ) as RenderElement;
};

const drawProgress = (
  engine: EngineInterface,
  e: BoxRenderInput,
  stepIndex: number,
  spinnerFrame: number
) => {
  const { Box, Text } = engine.ui.resolve(e);
  const spinner = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
  return h(
    Box,
    {
      key: "handoff-progress",
      flexDirection: "column",
      paddingX: BOX_SIDE_PADDING,
      marginTop: 1,
    },
    h(
      Box,
      { flexDirection: "row", columnGap: 1 },
      h(Text, { color: "claude" }, spinner),
      h(
        Text,
        { weight: "semibold" },
        `${HANDOFF_GLYPH} Handoff · ${HANDOFF_STEPS[stepIndex]?.word}`
      )
    ),
    drawDivider(Text, e.props.bodyColumns),
    ...HANDOFF_STEPS.map((step, i) =>
      h(
        Box,
        { key: step.word, flexDirection: "row", columnGap: 1 },
        i < stepIndex
          ? h(Text, { color: "success" }, "✓")
          : i === stepIndex
            ? h(Text, { color: "claude" }, spinner)
            : h(Text, { dimColor: true }, "○"),
        h(Text, { dimColor: i > stepIndex }, step.label)
      )
    )
  ) as RenderElement;
};

export const register: Register = (on, options) => {
  const progress: HandoffProgress = {
    writer: readStringOption(options, "writer"),
    canAskInConversation: options.hasConversationTurns !== false,
    awaitedRecap: undefined,
    recapAgentIds: [],
    openBox: undefined,
    isBoxInPane: false,
    stepIndex: undefined,
    spinnerFrame: 0,
    spinnerTimer: undefined,
  };
  let hasPinnedOutcome = false;

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "handoff",
      description:
        "Record the session as background context for a later session. save: only save it; list: this project's handoffs; resume [id] [extra context]: load the latest or a chosen one",
      argumentHint:
        "[save] [focus] | list | resume [id] [extra context] (add --topic <name> to file by topic)",
    });
    await resumePendingHandoff($);

    return next(e);
  });

  on("command.run", { command: "handoff" }, async ($, e) => {
    const handoffArguments = parseHandoffArguments(e.args);
    if (handoffArguments.topic === "") return { text: "--topic needs a name." };
    await fileLegacyHandoffs($);
    if (handoffArguments.action === "list")
      return listProjectHandoffs($, handoffArguments.topic);
    if (handoffArguments.action === "resume") {
      const isBareResume =
        handoffArguments.handoffId === undefined &&
        !handoffArguments.extraContext;
      const resumeBox = isBareResume
        ? await buildResumeBox($, handoffArguments.topic)
        : undefined;
      if (
        resumeBox &&
        (await showBox($, progress, RESUME_BOX_TITLE, resumeBox))
      ) {
        return { text: RESUME_BOX_MESSAGE };
      }
      return resumeSavedHandoff(
        $,
        handoffArguments.handoffId,
        handoffArguments.extraContext,
        handoffArguments.topic
      );
    }
    const isBareRecapAction =
      handoffArguments.action === "recap" &&
      handoffArguments.isSaveOnly &&
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
    const { Text } = $.ui.resolve(e);
    const box = progress.openBox;
    if (!box)
      return h(Text, { dimColor: true }, CLOSED_BOX_HINT) as RenderElement;
    return drawBox($, e, box, progress);
  });

  on("ui.render", { component: "AbovePrompt" }, ($, e, next) => {
    const box = progress.openBox;
    if (e.props.hasSurvey) return next(e);
    if (box) return drawBox($, e, box, progress);
    if (progress.stepIndex === undefined) return next(e);
    return drawProgress($, e, progress.stepIndex, progress.spinnerFrame);
  });

  on("session.end", ($, e, next) => {
    stopSpinning(progress);
    return next(e);
  });

  on("prompt.submit", (_, e, next) => {
    const reportingAgentId =
      e.origin?.kind === "peer"
        ? progress.recapAgentIds.find((agentId) =>
            e.text.includes(`<agent-message from="${agentId}">`)
          )
        : undefined;
    if (reportingAgentId === undefined) return next(e);
    progress.recapAgentIds = progress.recapAgentIds.filter(
      (agentId) => agentId !== reportingAgentId
    );
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
      showStatus($, undefined);
      hasPinnedOutcome = false;
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const turnResult = await next(e);
    if (!progress.awaitedRecap || !isAwaitedTurn(progress.awaitedRecap, e))
      return turnResult;
    const { request, isQuestionTurn } = progress.awaitedRecap;
    progress.awaitedRecap = undefined;
    if (isQuestionTurn) {
      showStatus($, undefined);
      if (e.isAborted) {
        showStep($, progress, undefined);
        showToast($, CANCELLED_MESSAGE);
        return turnResult;
      }
      const settledRequest = settleQuestions(
        request,
        readDecisionLines(e.answer)
      );
      const recapOutcome = await runRecap($, progress, settledRequest);
      return { ...turnResult, text: recapOutcome.text };
    }

    const isConversationTurn = e.agentId === undefined;
    if (e.agentId !== undefined) progress.recapAgentIds.push(e.agentId);
    const recap = stripWrappingCodeFence(e.answer);
    if (!recap && !isConversationTurn) {
      const delegation = askConversationForRecap($, request);
      progress.awaitedRecap = delegation.awaitedRecap;
      showStatus($, delegation.routeNotice);
      return turnResult;
    }
    const outcome = recap
      ? (
          await deliverWithProgress(
            $,
            progress,
            request,
            recap,
            isConversationTurn
          )
        ).text
      : EMPTY_REPLY_MESSAGE;
    showStep($, progress, undefined);
    if (isConversationTurn) {
      showStatus($, undefined);
      return { ...turnResult, text: outcome };
    }
    showToast($, outcome, { timeoutMs: OUTCOME_TOAST_MS });
    showStatus($, outcome);
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
