import type { EngineInterface, Register, RenderElement } from "claude-code";

const KINDS = ["feature", "fix", "refactor", "test", "docs", "chore"];
const STATUSES = ["pending", "in-progress", "done", "blocked"];
const PLAN_SECTIONS = ["Goal", "Context", "Steps", "Check", "Review"];
const BANNED_PHRASES = [
  "as appropriate",
  "if needed",
  "as needed",
  "where appropriate",
  "consider",
  "similar to",
  "etc.",
  "and so on",
  "you may",
  "TODO",
];
const MAX_STEPS = 6;
const MAX_ORDER = 99;
const ORDER_WIDTH = 2;
const LEADING_ORDER_PREFIX = /^\d+-/;
const PLAN_FILE_PARTS = /^---\n([\s\S]*?\n)---\n\n([\s\S]*)$/;
const MAX_SLUG_LENGTH = 60;
const MAX_ASKED_OPTIONS = 4;
const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const CLAUDE_WORKTREE_PATH = /^(.+?)\/\.claude\/worktrees\/[^/]+/;
const NUMBERED_MARKDOWN_FILE = /^\d+-.*\.md$/;
const WHOLE_SET_OPTION = "Whole set";
const MAX_FIX_ROUNDS = 3;
const SET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SET_PREFIX = /^(\d{4}-\d{2}-\d{2}-\d{4}(?:-handoff-\d+)?)-/;
const STAMP_PREFIX = /^\d{4}-\d{2}-\d{2}-\d{4}-/;
const HANDOFF_SET_PREFIX = /^\d{4}-\d{2}-\d{2}-\d{4}-handoff-\d+-/;
const JOIN_WINDOW_MINUTES = 60;
const JOIN_FUTURE_SLACK_MINUTES = 1;
const REQUEST_WORDS = new Set([
  "plan",
  "plans",
  "planning",
  "planned",
  "small",
  "this",
  "that",
  "it",
  "these",
  "those",
  "the",
  "a",
  "an",
  "work",
  "task",
  "tasks",
  "todo",
  "todos",
  "stuff",
  "thing",
  "things",
  "set",
  "new",
  "next",
  "step",
  "steps",
  "rest",
  "remaining",
  "left",
  "all",
  "of",
  "for",
  "to",
  "do",
  "and",
  "my",
  "our",
  "now",
  "here",
  "above",
  "conversation",
  "discussion",
  "what",
  "we",
  "just",
  "talked",
  "about",
  "discussed",
  "break",
  "split",
  "down",
  "into",
  "up",
  "out",
  "please",
  "make",
  "create",
  "write",
]);
const CODE_FENCE = /```[\s\S]*?```/g;
const NUMBERED_STEP = /^\d+\.\s/gm;
const BACKTICKED_TEXT = /`[^`\n]+`/;
const EXPECT_LINE = /^-\s*Expect:\s*\S/m;
const BUILD_OR_LINT_ONLY_COMMAND =
  /^`\s*(?:(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?)?(?:lint|build|typecheck|type-check|tsc|eslint|prettier|format|fallow|cargo\s+(?:build|check|clippy)|go\s+(?:build|vet)|ruff)\b[^`&;|]*`$/;
const STATUS_LINE = /^status: .*$/m;
const SET_LINE = /^set: .*$/m;
const INDEX_FILE_NAME = "index.md";
const FILE_EDITING_TOOLS = ["Edit", "Write", "MultiEdit"];
const COMMAND_NAME = "small-plans";
const COMMAND_PREFIX = `/${COMMAND_NAME} `;
const SUBCOMMAND_SUGGESTIONS = [
  {
    text: "handoff",
    description:
      "Plan what a saved handoff leaves: one picked from the newest, or one by id, plus optional extra context",
  },
  {
    text: "build",
    description:
      "Have small-model agents implement a whole set or one plan of it, and review their work",
  },
  {
    text: "board",
    description: "Show the build board again after hiding it",
  },
  {
    text: "rename",
    description:
      "Give a saved set a new name, keeping its date or handoff prefix; the set and new name are optional",
  },
];
const WRITE_TOOL_NAME = "write_small_plan";
const QUALIFIED_WRITE_TOOL_NAME = `mcp__small-plans__${WRITE_TOOL_NAME}`;
const STATUS_TOOL_NAME = "set_small_plan_status";
const QUALIFIED_STATUS_TOOL_NAME = `mcp__small-plans__${STATUS_TOOL_NAME}`;
const START_TOOL_NAME = "start_small_plan";
const QUALIFIED_START_TOOL_NAME = `mcp__small-plans__${START_TOOL_NAME}`;
const CHECK_TOOL_NAME = "check_small_plan";
const QUALIFIED_CHECK_TOOL_NAME = `mcp__small-plans__${CHECK_TOOL_NAME}`;
const FINISH_TOOL_NAME = "finish_small_plan";
const QUALIFIED_FINISH_TOOL_NAME = `mcp__small-plans__${FINISH_TOOL_NAME}`;
const LIST_TOOL_NAME = "list_small_plans";
const QUALIFIED_LIST_TOOL_NAME = `mcp__small-plans__${LIST_TOOL_NAME}`;
const RENAME_TOOL_NAME = "rename_small_plan_set";
const QUALIFIED_RENAME_TOOL_NAME = `mcp__small-plans__${RENAME_TOOL_NAME}`;
const UPDATE_TOOL_NAME = "update_small_plan";
const QUALIFIED_UPDATE_TOOL_NAME = `mcp__small-plans__${UPDATE_TOOL_NAME}`;
const SHOWN_SET_COUNT = 5;
const MAX_GUARD_ROUNDS = 3;
const COMMAND_TIMEOUT_MS = 600_000;
const FAILURE_TAIL_LINES = 5;
const CHECK_OUTPUT_LINES = 40;
const GUARD_OUTPUT_LINES = 20;
const MISSING_COMMAND_EXIT_CODE = 127;
const FALLOW_COMMAND =
  "command -v fallow >/dev/null || exit 127; fallow audit --format compact";
const PACKAGE_RUNNERS = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
] as const;
const GUARD_LABELS = ["Lint", "Fallow", "Tests"];
const IMPLEMENTER_AGENT = "small-plans:small-plan-implementer";
const REVIEWER_AGENT_NAME = "small-plan-reviewer";
const REVIEWER_AGENT = `small-plans:${REVIEWER_AGENT_NAME}`;
const BRANCH_CONVENTION_FILE_NAME = "branch-convention.md";
const PLAN_SHAPE = `The body holds these "## " headings, in this order: ${PLAN_SECTIONS.join(", ")}.
- Goal: one sentence on what is true when the plan is done.
- Context: all that the implementer must know and cannot guess: each file by its path, the exact names of the functions, types and commands involved, and the decisions already made. The implementer sees this plan only, never this conversation or another plan.
- Steps: a numbered list of at most ${MAX_STEPS} steps. Each step is one edit: the file path, the place in it, and what to write there. Quote the exact code where the wording matters.
- Check: proves the behaviour the plan delivers works, not only that the code builds: "- Run:" with one command in backticks that exercises it, such as the test the plan adds or changes, or a command that runs the feature, and "- Expect:" with the exact output that counts as passing, such as the test name reported as passed or the value the command prints. A build, type-check, lint or format command alone is refused.
- Review: a list of what a reviewer confirms by reading the diff, each line a fact that is true or false.
Vague wording is refused outside code fences: ${BANNED_PHRASES.join(", ")}. Say the exact thing instead.`;
const PROJECT_PROPERTY = {
  type: "string",
  description:
    "The repository the plan changes, as an absolute folder path inside it. Leave it out when that is the working directory's repository.",
};
const KIND_DESCRIPTION =
  "feature: new behaviour. fix: a bug. refactor: same behaviour, better code. test: tests only. docs: documentation only. chore: tooling, config, releases.";
const WRITE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    set: {
      type: "string",
      description:
        'The set this plan joins; every plan of one planning run shares it. For a new set pass a short name: 2 to 5 lowercase words joined by hyphens that say what the work delivers, such as dark-mode-toggle. Take it from the work itself, never from the wording of the request: when the user says "plan this", name what "this" is. The tool puts the date and time in front and tells you the folder. For a saved set pass its folder name, or the name the instruction gives.',
    },
    order: {
      type: "number",
      description: `The plan's place in the build order, from 1 to ${MAX_ORDER}.`,
    },
    title: { type: "string", description: "A short title, under 10 words." },
    kind: {
      type: "string",
      enum: KINDS,
      description: KIND_DESCRIPTION,
    },
    body: { type: "string", description: "The plan, in Markdown." },
    depends_on: {
      type: "array",
      items: { type: "number" },
      description:
        "The orders of the earlier plans this plan needs done; [] when it needs none. Required: it declares the dependency order.",
    },
    project: PROJECT_PROPERTY,
  },
  required: ["set", "order", "title", "kind", "body", "depends_on"],
};
const UPDATE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "The plan file, as list_small_plans or write_small_plan gave it.",
    },
    title: {
      type: "string",
      description:
        "A new short title, under 10 words. The file is renamed to match.",
    },
    kind: { type: "string", enum: KINDS, description: KIND_DESCRIPTION },
    body: {
      type: "string",
      description:
        "The whole new plan body, in Markdown. It replaces the saved body.",
    },
    depends_on: {
      type: "array",
      items: { type: "number" },
      description:
        "The orders of the earlier plans this plan needs done; [] when it needs none.",
    },
  },
  required: ["path"],
};
const LIST_TOOL_SCHEMA = {
  type: "object",
  properties: {
    set: {
      type: "string",
      description:
        "Text the set name holds. Leave it out for the five newest sets.",
    },
    project: PROJECT_PROPERTY,
  },
  required: [],
};
const RENAME_TOOL_SCHEMA = {
  type: "object",
  properties: {
    set: {
      type: "string",
      description:
        "The set to rename: its folder name, or text only that set's name holds.",
    },
    name: {
      type: "string",
      description:
        "The new name: 2 to 5 lowercase words joined by hyphens that say what the set's plans deliver, such as dark-mode-toggle. Never the wording of the request.",
    },
    project: PROJECT_PROPERTY,
  },
  required: ["set", "name"],
};
const STATUS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "The plan file's absolute path." },
    status: { type: "string", enum: STATUSES },
  },
  required: ["path", "status"],
};

const PLAN_PATH_PROPERTY = {
  type: "string",
  description: "The plan file's absolute path.",
};
const WORKTREE_PROPERTY = {
  type: "string",
  description: "The plan's worktree folder, as start_small_plan returned it.",
};
const START_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: PLAN_PATH_PROPERTY,
    repository: {
      type: "string",
      description:
        "An absolute folder path inside the repository the plan changes.",
    },
    branch: { type: "string", description: "The branch the plan is built on." },
    base: {
      type: "string",
      description: "The branch a new plan branch starts from.",
    },
  },
  required: ["path", "repository", "branch", "base"],
};
const FINISH_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: PLAN_PATH_PROPERTY,
    worktree: WORKTREE_PROPERTY,
    subject: {
      type: "string",
      description: "The commit subject: one short conventional commit line.",
    },
  },
  required: ["path", "worktree", "subject"],
};

const CHECK_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: PLAN_PATH_PROPERTY,
    worktree: WORKTREE_PROPERTY,
    command: {
      type: "string",
      description:
        "The plan's check command, exactly as the build instruction lists it.",
    },
  },
  required: ["path", "worktree", "command"],
};

const trimText = (requestedText: unknown) =>
  typeof requestedText === "string" ? requestedText.trim() : "";

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

const resolveProjectName = async (
  engine: EngineInterface,
  requestedFolder?: string
) => {
  const folder = requestedFolder || (await engine.session.root());
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

const readClaudeFolder = async (engine: EngineInterface) =>
  `${(await engine.env.get("HOME")) ?? ""}/.claude`;

const resolvePlansRoot = async (engine: EngineInterface) =>
  (await engine.env.get("SMALL_PLANS_DIR")) ??
  `${(await engine.env.get("HOME")) ?? ""}/.local/share/small-plans`;

const resolveProjectFolder = async (engine: EngineInterface) =>
  `${await resolvePlansRoot(engine)}/${await resolveProjectName(engine)}`;

const resolveRequestedProjectFolder = async (
  engine: EngineInterface,
  requestedProject: string
) => {
  const projectName =
    requestedProject && !requestedProject.startsWith("/")
      ? toProjectName(requestedProject)
      : await resolveProjectName(engine, requestedProject);
  return `${await resolvePlansRoot(engine)}/${projectName}`;
};

const resolveHandoffsRoot = async (engine: EngineInterface) =>
  (await engine.env.get("HANDOFFS_DIR")) ??
  `${await readClaudeFolder(engine)}/handoffs`;

const listNames = async (engine: EngineInterface, folderPath: string) =>
  (await engine.fs.list(folderPath).catch(() => [])).map((entry) => entry.name);

const listSavedSetNames = async (
  engine: EngineInterface,
  projectFolder: string
) =>
  (await listNames(engine, projectFolder))
    .filter((name) => SET_NAME.test(name) && !name.endsWith(".md"))
    .sort()
    .reverse();

const listSetsNewestFirst = async (engine: EngineInterface) =>
  listSavedSetNames(engine, await resolveProjectFolder(engine));

const isRequestName = (slug: string) =>
  slug.split("-").every((word) => REQUEST_WORDS.has(word));

const composeNewSetName = (slug: string) => {
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  return `${stamp}-${slug}`;
};

const isRecentSet = (setName: string) => {
  const stamp = setName.slice(0, 15);
  const stampedTime = Date.parse(
    `${stamp.slice(0, 10)}T${stamp.slice(11, 13)}:${stamp.slice(13, 15)}:00Z`
  );
  const minutesAgo = (Date.now() - stampedTime) / 60_000;
  return (
    minutesAgo <= JOIN_WINDOW_MINUTES &&
    minutesAgo >= -JOIN_FUTURE_SLACK_MINUTES
  );
};

const resolveSetName = async (
  engine: EngineInterface,
  projectFolder: string,
  requestedSet: string
) => {
  const savedSetNames = await listSavedSetNames(engine, projectFolder);
  if (
    savedSetNames.includes(requestedSet) ||
    HANDOFF_SET_PREFIX.test(requestedSet)
  )
    return requestedSet;
  if (STAMP_PREFIX.test(requestedSet))
    return isRequestName(requestedSet.replace(STAMP_PREFIX, ""))
      ? ""
      : requestedSet;
  const slug = toSlug(requestedSet);
  const joinedSetName = savedSetNames.find(
    (name) =>
      STAMP_PREFIX.test(name) &&
      name.replace(STAMP_PREFIX, "") === slug &&
      isRecentSet(name)
  );
  if (joinedSetName) return joinedSetName;
  if (isRequestName(slug)) return "";
  return composeNewSetName(slug);
};

const readSection = (body: string, section: string) =>
  new RegExp(
    `^##\\s+${section}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,
    "im"
  ).exec(body)?.[1];

const findBannedPhrases = (body: string) => {
  const prose = body.replace(CODE_FENCE, "");
  return BANNED_PHRASES.filter((phrase) =>
    new RegExp(
      `(?<![A-Za-z])${phrase.replace(".", "\\.")}(?![A-Za-z])`,
      "i"
    ).test(prose)
  );
};

const listCheckProblems = (checkSection: string) => {
  const checkCommand = checkSection.match(BACKTICKED_TEXT)?.[0];
  if (checkCommand === undefined)
    return ['"## Check" needs a command in backticks to run.'];
  return [
    ...(EXPECT_LINE.test(checkSection)
      ? []
      : [
          '"## Check" needs "- Expect:" with the exact output that counts as passing.',
        ]),
    ...(BUILD_OR_LINT_ONLY_COMMAND.test(checkCommand)
      ? [
          '"## Check" must run what the plan delivers, such as its test, not only a build, type-check, lint or format command.',
        ]
      : []),
  ];
};

const listBodyProblems = (body: string) => {
  const missingSections = PLAN_SECTIONS.filter(
    (section) => readSection(body, section) === undefined
  );
  const stepCount = (readSection(body, "Steps") ?? "").match(
    NUMBERED_STEP
  )?.length;
  const checkSection = readSection(body, "Check");
  const bannedPhrases = findBannedPhrases(body);
  return [
    ...missingSections.map((section) => `The body lacks "## ${section}".`),
    ...(stepCount === undefined && !missingSections.includes("Steps")
      ? ['"## Steps" needs a numbered list.']
      : []),
    ...(stepCount !== undefined && stepCount > MAX_STEPS
      ? [
          `The plan has ${stepCount} steps; the most is ${MAX_STEPS}. Split it into two plans.`,
        ]
      : []),
    ...(checkSection === undefined ? [] : listCheckProblems(checkSection)),
    ...(bannedPhrases.length > 0
      ? [
          `Replace the vague wording with the exact thing: ${bannedPhrases
            .map((phrase) => `"${phrase}"`)
            .join(", ")}.`,
        ]
      : []),
  ];
};

const normalizeTitle = (requestedTitle: unknown) =>
  trimText(requestedTitle).replace(/\s+/g, " ");

const listTitleProblems = (title: string) =>
  toSlug(title) ? [] : ["The title needs letters or digits."];

const listKindProblems = (kind: string) =>
  KINDS.includes(kind) ? [] : [`kind must be one of: ${KINDS.join(", ")}.`];

const listDependencyListProblems = (requestedDependencies: unknown) =>
  Array.isArray(requestedDependencies)
    ? []
    : [
        "depends_on is required: list the orders of the earlier plans this plan needs, or [] when it needs none.",
      ];

const listDependencyOrderProblems = (dependencies: number[], order: number) =>
  dependencies.every(
    (dependency) =>
      Number.isInteger(dependency) && dependency >= 1 && dependency < order
  )
    ? []
    : ["depends_on may only name the orders of earlier plans."];

const composeProblemDeny = (outcome: string, problems: string[]) => ({
  deny: `${outcome} Fix every problem and call this tool again:\n- ${problems.join("\n- ")}`,
});

const describePlanPathProblem = (plansRoot: string) =>
  `path must be a saved plan file under ${plansRoot}.`;

const describeMissingStatusLine = (planPath: string) =>
  `${planPath} has no "status:" line in its front matter.`;

const readPlanRequestFields = (toolInput: Record<string, unknown>) => ({
  title: normalizeTitle(toolInput.title),
  kind: trimText(toolInput.kind),
  body: trimText(toolInput.body),
  dependencies: Array.isArray(toolInput.depends_on)
    ? toolInput.depends_on.map(Number)
    : [],
});

const writeSmallPlan = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const setName = trimText(toolInput.set);
  const order = Number(toolInput.order);
  const { title, kind, body, dependencies } = readPlanRequestFields(toolInput);
  const problems = [
    ...(SET_NAME.test(setName)
      ? []
      : [
          "set must be a folder name of letters, digits, dots, dashes and underscores.",
        ]),
    ...(Number.isInteger(order) && order >= 1 && order <= MAX_ORDER
      ? []
      : [`order must be a whole number from 1 to ${MAX_ORDER}.`]),
    ...listTitleProblems(title),
    ...listKindProblems(kind),
    ...listDependencyListProblems(toolInput.depends_on),
    ...listDependencyOrderProblems(dependencies, order),
    ...listBodyProblems(body),
  ];
  if (problems.length > 0)
    return composeProblemDeny("The plan was not saved.", problems);

  const projectFolder = await resolveRequestedProjectFolder(
    engine,
    trimText(toolInput.project)
  );
  const projectName = projectFolder.split("/").pop() ?? "";
  const resolvedSetName = await resolveSetName(engine, projectFolder, setName);
  if (!resolvedSetName)
    return {
      deny: `The set name "${setName}" names the request, not the work. Name what the work delivers in 2 to 5 words, such as dark-mode-toggle.`,
    };
  const setFolder = `${projectFolder}/${resolvedSetName}`;
  const orderPrefix = `${String(order).padStart(ORDER_WIDTH, "0")}-`;
  const savedName = (await listNames(engine, setFolder)).find((name) =>
    name.startsWith(orderPrefix)
  );
  if (savedName)
    return {
      deny: `Plan ${order} is already saved at ${setFolder}/${savedName}, and a saved plan is never replaced. To change that plan call ${UPDATE_TOOL_NAME}; for a new plan use the next free order. For separate work pass a different set name.`,
    };

  const planPath = `${setFolder}/${orderPrefix}${toSlug(title)}.md`;
  const frontMatter = [
    `title: ${title}`,
    `project: ${projectName}`,
    `created: ${new Date().toISOString()}`,
    `set: ${resolvedSetName}`,
    `order: ${order}`,
    `kind: ${kind}`,
    `status: ${STATUSES[0]}`,
    ...(dependencies.length > 0
      ? [`depends_on: ${dependencies.join(", ")}`]
      : []),
  ].join("\n");
  await engine.fs.write(planPath, `---\n${frontMatter}\n---\n\n${body}\n`);
  await writeSetIndex(engine, setFolder);
  return {
    result: `Plan saved to ${planPath}. The set's index at ${setFolder}/${INDEX_FILE_NAME} is updated.`,
  };
};

const readFrontMatterField = (planText: string, field: string) =>
  new RegExp(`^${field}: (.*)$`, "m").exec(planText)?.[1]?.trim() ?? "";

const replaceFrontMatterLine = (
  frontMatter: string,
  field: string,
  line: string
) => frontMatter.replace(new RegExp(`^${field}: .*$`, "m"), () => line);

const replaceDependencyLine = (frontMatter: string, dependencies: number[]) => {
  const withoutDependencies = frontMatter.replace(/^depends_on: .*\n/m, "");
  return dependencies.length === 0
    ? withoutDependencies
    : withoutDependencies.replace(
        /^status: .*\n/m,
        (statusLine) => `${statusLine}depends_on: ${dependencies.join(", ")}\n`
      );
};

const readUpdateFlags = (toolInput: Record<string, unknown>) => ({
  hasTitle: toolInput.title !== undefined,
  hasKind: toolInput.kind !== undefined,
  hasBody: toolInput.body !== undefined,
  hasDependencies: toolInput.depends_on !== undefined,
});

const hasAnyUpdateField = (toolInput: Record<string, unknown>) =>
  Object.values(readUpdateFlags(toolInput)).includes(true);

const readUpdatablePlan = async (
  engine: EngineInterface,
  planPath: string
): Promise<{ deny: string } | { frontMatter: string; savedBody: string }> => {
  const planText = await engine.fs
    .read(planPath)
    .then(String)
    .catch(() => undefined);
  if (planText === undefined) return { deny: `${planPath} cannot be read.` };
  const planParts = PLAN_FILE_PARTS.exec(planText);
  if (!planParts || !STATUS_LINE.test(planParts[1] ?? ""))
    return { deny: describeMissingStatusLine(planPath) };
  const [, frontMatter = "", savedBody = ""] = planParts;
  if (readFrontMatterField(frontMatter, "status") === "in-progress")
    return {
      deny: `Plan ${planPath} is in-progress: a build is using it. Update it when the build ends.`,
    };
  return { frontMatter, savedBody };
};

const listUpdateFieldProblems = (
  frontMatter: string,
  toolInput: Record<string, unknown>
) => {
  const { hasTitle, hasKind, hasBody, hasDependencies } =
    readUpdateFlags(toolInput);
  const order = Number(readFrontMatterField(frontMatter, "order"));
  const { title, kind, body, dependencies } = readPlanRequestFields(toolInput);
  return [
    ...(hasTitle ? listTitleProblems(title) : []),
    ...(hasKind ? listKindProblems(kind) : []),
    ...(hasDependencies
      ? [
          ...listDependencyListProblems(toolInput.depends_on),
          ...listDependencyOrderProblems(dependencies, order),
        ]
      : []),
    ...(hasBody ? listBodyProblems(body) : []),
  ];
};

const resolveUpdatedPlanPath = (
  setFolder: string,
  planPath: string,
  toolInput: Record<string, unknown>
) => {
  if (toolInput.title === undefined) return planPath;
  const planName = planPath.slice(planPath.lastIndexOf("/") + 1);
  const { title } = readPlanRequestFields(toolInput);
  return `${setFolder}/${planName.match(LEADING_ORDER_PREFIX)?.[0] ?? ""}${toSlug(title)}.md`;
};

const applyUpdateToPlanText = (
  frontMatter: string,
  savedBody: string,
  toolInput: Record<string, unknown>
) => {
  const { hasTitle, hasKind, hasBody, hasDependencies } =
    readUpdateFlags(toolInput);
  const { title, kind, body, dependencies } = readPlanRequestFields(toolInput);
  let updatedFrontMatter = frontMatter;
  if (hasTitle)
    updatedFrontMatter = replaceFrontMatterLine(
      updatedFrontMatter,
      "title",
      `title: ${title}`
    );
  if (hasKind)
    updatedFrontMatter = replaceFrontMatterLine(
      updatedFrontMatter,
      "kind",
      `kind: ${kind}`
    );
  if (hasDependencies)
    updatedFrontMatter = replaceDependencyLine(
      updatedFrontMatter,
      dependencies
    );
  const updatedBody = hasBody ? `${body}\n` : savedBody;
  return `---\n${updatedFrontMatter}---\n\n${updatedBody}`;
};

const moveRetitledPlan = async (
  engine: EngineInterface,
  planPath: string,
  finalPath: string
) => {
  if (finalPath === planPath) return "";
  const moveOutcome = await engine.process.run(["mv", planPath, finalPath]);
  return moveOutcome.exitCode === 0 ? "" : moveOutcome.stderr.trim();
};

const updateSmallPlan = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const planPath = trimText(toolInput.path);
  const plansRoot = await resolvePlansRoot(engine);
  const setFolder = findPlanSetFolder(plansRoot, planPath);
  if (!setFolder || (await findPlanPathProblem(engine, planPath)))
    return { deny: describePlanPathProblem(plansRoot) };
  if (!hasAnyUpdateField(toolInput))
    return { deny: "Give at least one of title, kind, body or depends_on." };
  const planOutcome = await readUpdatablePlan(engine, planPath);
  if ("deny" in planOutcome) return planOutcome;
  const { frontMatter, savedBody } = planOutcome;

  const problems = listUpdateFieldProblems(frontMatter, toolInput);
  if (problems.length > 0)
    return composeProblemDeny("The plan was not updated.", problems);

  const planName = planPath.slice(planPath.lastIndexOf("/") + 1);
  const finalPath = resolveUpdatedPlanPath(setFolder, planPath, toolInput);
  const isRenamed = finalPath !== planPath;
  if (isRenamed && (await engine.fs.exists(finalPath)))
    return {
      deny: `${finalPath} already exists, so ${planName} was not renamed.`,
    };

  await engine.fs.write(
    planPath,
    applyUpdateToPlanText(frontMatter, savedBody, toolInput)
  );
  const renameFailure = await moveRetitledPlan(engine, planPath, finalPath);
  await writeSetIndex(engine, setFolder);
  return renameFailure
    ? {
        deny: `Could not rename ${planName}, so it was updated under its old name: ${renameFailure}`,
      }
    : {
        result: `Plan updated at ${finalPath}. The set's index is updated.`,
      };
};

const composeIndexRow = (planName: string, planText: string) => {
  const title = readFrontMatterField(planText, "title") || planName;
  const dependencies = readFrontMatterField(planText, "depends_on") || "none";
  return `| ${parseInt(planName, 10)} | [${title}](${planName}) | ${readFrontMatterField(planText, "kind")} | ${readFrontMatterField(planText, "status")} | ${dependencies} |`;
};

const readSetPlans = async (engine: EngineInterface, setFolder: string) => {
  const planNames = (await listNames(engine, setFolder))
    .filter((name) => NUMBERED_MARKDOWN_FILE.test(name))
    .sort();
  const planTexts = await Promise.all(
    planNames.map(async (name) =>
      String(await engine.fs.read(`${setFolder}/${name}`).catch(() => ""))
    )
  );
  return { planNames, planTexts };
};

const writeSetIndex = async (engine: EngineInterface, setFolder: string) => {
  const { planNames, planTexts } = await readSetPlans(engine, setFolder);
  const setName = setFolder.split("/").pop() ?? "";
  await engine.fs.write(
    `${setFolder}/${INDEX_FILE_NAME}`,
    [
      `# Plans: ${setName}`,
      "",
      "This index is rewritten each time a plan of this set is saved, edited, moved, deleted or changes status. Build the plans in this order: a plan waits until every plan in its Depends on column is done.",
      "",
      "| Order | Plan | Kind | Status | Depends on |",
      "| --- | --- | --- | --- | --- |",
      ...planNames.map((name, i) => composeIndexRow(name, planTexts[i] ?? "")),
      "",
    ].join("\n")
  );
};

const findPlanSetFolder = (plansRoot: string, filePath: string) => {
  const relativeSegments = filePath.startsWith(`${plansRoot}/`)
    ? filePath.slice(plansRoot.length + 1).split("/")
    : [];
  const isPlanFile =
    relativeSegments.length === 3 &&
    !relativeSegments.includes("..") &&
    NUMBERED_MARKDOWN_FILE.test(relativeSegments[2] ?? "");
  return isPlanFile ? filePath.slice(0, filePath.lastIndexOf("/")) : undefined;
};

const findPlanPathProblem = async (
  engine: EngineInterface,
  planPath: string
) => {
  const plansRoot = await resolvePlansRoot(engine);
  const isPlanFile =
    planPath.startsWith(`${plansRoot}/`) &&
    planPath.endsWith(".md") &&
    !planPath.split("/").includes("..");
  return isPlanFile && (await engine.fs.exists(planPath))
    ? ""
    : describePlanPathProblem(plansRoot);
};

const setPlanStatus = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const planPath = trimText(toolInput.path);
  const status = trimText(toolInput.status);
  const plansRoot = await resolvePlansRoot(engine);
  if (!STATUSES.includes(status))
    return { deny: `status must be one of: ${STATUSES.join(", ")}.` };
  const pathProblem = await findPlanPathProblem(engine, planPath);
  if (pathProblem) return { deny: pathProblem };
  const planText = String(await engine.fs.read(planPath));
  if (!STATUS_LINE.test(planText))
    return { deny: describeMissingStatusLine(planPath) };
  await engine.fs.write(
    planPath,
    planText.replace(STATUS_LINE, `status: ${status}`)
  );
  const setFolder = findPlanSetFolder(plansRoot, planPath);
  if (setFolder) await writeSetIndex(engine, setFolder);
  await recordPlanStatus(engine, planPath, status);
  return {
    result: `Plan marked ${status}: ${planPath}${setFolder ? `. The set's index at ${setFolder}/${INDEX_FILE_NAME} is updated.` : ""}`,
  };
};

const gitOutput = (
  engine: EngineInterface,
  folder: string,
  ...args: string[]
) =>
  engine.process
    .run(["git", "-C", folder, ...args])
    .then((outcome) => (outcome.exitCode === 0 ? outcome.stdout.trim() : ""))
    .catch(() => "");

type CommandOutcome = { exitCode: number; output: string };

const runLongCommand = (
  engine: EngineInterface,
  argv: string[],
  folder?: string
): Promise<CommandOutcome> =>
  engine.process
    .run(argv, {
      env: { GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: COMMAND_TIMEOUT_MS,
      ...(folder ? { cwd: folder } : {}),
    })
    .then(({ exitCode, stdout, stderr }) => ({
      exitCode,
      output: `${stdout}\n${stderr}`.trim(),
    }))
    .catch((failure: unknown) => ({ exitCode: 1, output: String(failure) }));

const keepLastLines = (output: string, lineCount: number) =>
  output.split("\n").slice(-lineCount).join("\n");

const pickWorktreeFolder = async (
  engine: EngineInterface,
  repository: string,
  slug: string
) => {
  const top =
    (await gitOutput(engine, repository, "rev-parse", "--show-toplevel")) ||
    (await gitOutput(
      engine,
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir"
    ));
  if (!top) return "";
  const parent = top.slice(0, top.lastIndexOf("/"));
  let candidate = `${parent}/${slug}`;
  for (let copy = 2; await engine.fs.exists(candidate); copy++)
    candidate = `${parent}/${slug}-${copy}`;
  return candidate;
};

const findBranchWorktree = (worktreeList: string, branch: string) =>
  worktreeList
    .split("\n\n")
    .find((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`))
    ?.split("\n")[0]
    ?.replace(/^worktree /, "") ?? "";

const addPlanWorktree = async (
  engine: EngineInterface,
  repository: string,
  planPath: string,
  branch: string,
  base: string
): Promise<{ folder: string } | { deny: string }> => {
  const slug = planPath
    .slice(planPath.lastIndexOf("/") + 1)
    .replace(/^\d+-/, "")
    .replace(/\.md$/, "");
  const folder = await pickWorktreeFolder(engine, repository, slug);
  if (!folder) return { deny: `${repository} is not inside a git repository.` };
  const hasBranch =
    (await gitOutput(
      engine,
      repository,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`
    )) !== "";
  const added = await runLongCommand(engine, [
    "git",
    "-C",
    repository,
    "worktree",
    "add",
    ...(hasBranch ? [folder, branch] : ["-b", branch, folder, base]),
  ]);
  return added.exitCode === 0
    ? { folder }
    : {
        deny: `git worktree add failed:\n${keepLastLines(added.output, FAILURE_TAIL_LINES)}`,
      };
};

const startSmallPlan = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const planPath = trimText(toolInput.path);
  const repository = trimText(toolInput.repository);
  const branch = trimText(toolInput.branch);
  const base = trimText(toolInput.base);
  const pathProblem = await findPlanPathProblem(engine, planPath);
  if (pathProblem) return { deny: pathProblem };
  if (!branch || !base || branch.startsWith("-") || base.startsWith("-"))
    return { deny: "branch and base must be branch names." };
  const reusedFolder = findBranchWorktree(
    await gitOutput(engine, repository, "worktree", "list", "--porcelain"),
    branch
  );
  const added = reusedFolder
    ? { folder: reusedFolder }
    : await addPlanWorktree(engine, repository, planPath, branch, base);
  if ("deny" in added) return added;
  const marked = await setPlanStatus(engine, {
    path: planPath,
    status: "in-progress",
  });
  return "deny" in marked ? marked : { result: `Worktree: ${added.folder}` };
};

const findFirstFailure = async (
  engine: EngineInterface,
  gitSteps: { label: string; argv: string[] }[]
) => {
  for (const { label, argv } of gitSteps) {
    const outcome = await runLongCommand(engine, argv);
    if (outcome.exitCode !== 0) return { label, output: outcome.output };
  }
  return undefined;
};

const finishSmallPlan = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const planPath = trimText(toolInput.path);
  const worktree = trimText(toolInput.worktree);
  const subject = trimText(toolInput.subject);
  const pathProblem = await findPlanPathProblem(engine, planPath);
  if (pathProblem) return { deny: pathProblem };
  if (!subject || subject.includes("\n"))
    return { deny: "subject must be one line." };
  const branch = await gitOutput(
    engine,
    worktree,
    "rev-parse",
    "--abbrev-ref",
    "HEAD"
  );
  const commonGitFolder = await gitOutput(
    engine,
    worktree,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  );
  const ownGitFolder = await gitOutput(
    engine,
    worktree,
    "rev-parse",
    "--path-format=absolute",
    "--git-dir"
  );
  if (
    !branch ||
    branch === "HEAD" ||
    !commonGitFolder ||
    ownGitFolder === commonGitFolder
  )
    return { deny: `${worktree} is not a plan worktree on a branch.` };
  const hasChanges =
    (await gitOutput(engine, worktree, "status", "--porcelain")) !== "";
  const failure = await findFirstFailure(engine, [
    ...(hasChanges
      ? [
          { label: "git add", argv: ["git", "-C", worktree, "add", "-A"] },
          {
            label: "git commit",
            argv: ["git", "-C", worktree, "commit", "-m", subject],
          },
        ]
      : []),
    {
      label: "git push",
      argv: ["git", "-C", worktree, "push", "-u", "origin", branch],
    },
    {
      label: "git worktree remove",
      argv: [
        "git",
        `--git-dir=${commonGitFolder}`,
        "worktree",
        "remove",
        worktree,
      ],
    },
  ]);
  const marked = await setPlanStatus(engine, {
    path: planPath,
    status: "done",
  });
  if ("deny" in marked) return marked;
  return {
    result: failure
      ? `Plan marked done, but ${failure.label} failed and the worktree is kept at ${worktree}:\n${keepLastLines(failure.output, FAILURE_TAIL_LINES)}`
      : `Plan marked done: ${branch} is committed and pushed, and the worktree is removed.`,
  };
};

const readJsonFile = (engine: EngineInterface, filePath: string) =>
  engine.fs
    .read(filePath)
    .then((fileText) => JSON.parse(String(fileText)) as Record<string, unknown>)
    .catch(() => ({}) as Record<string, unknown>);

const listChangedFiles = async (engine: EngineInterface, worktree: string) =>
  [
    await gitOutput(engine, worktree, "diff", "--name-only", "HEAD"),
    await gitOutput(
      engine,
      worktree,
      "ls-files",
      "--others",
      "--exclude-standard"
    ),
  ]
    .join("\n")
    .split("\n")
    .filter(Boolean);

const findPackageFolder = async (
  engine: EngineInterface,
  worktree: string,
  changedFile: string
) => {
  const segments = changedFile.split("/").slice(0, -1);
  for (let depth = segments.length; depth > 0; depth--) {
    const folder = [worktree, ...segments.slice(0, depth)].join("/");
    if (await engine.fs.exists(`${folder}/package.json`)) return folder;
  }
  return worktree;
};

const pickPackageRunner = async (
  engine: EngineInterface,
  folder: string,
  worktree: string
) => {
  for (const [lockFile, runner] of PACKAGE_RUNNERS)
    if (
      (await engine.fs.exists(`${folder}/${lockFile}`)) ||
      (await engine.fs.exists(`${worktree}/${lockFile}`))
    )
      return runner;
  return "npm";
};

const findGuardCommands = async (
  engine: EngineInterface,
  folder: string,
  worktree: string
) => {
  const readSetting = async (fileName: string, settingName: string) =>
    trimText(
      (await readJsonFile(engine, `${folder}/.claude/${fileName}`))[settingName]
    ) ||
    trimText(
      (await readJsonFile(engine, `${worktree}/.claude/${fileName}`))[
        settingName
      ]
    );
  const packageJson = await readJsonFile(engine, `${folder}/package.json`);
  const scripts = (packageJson.scripts ?? {}) as Record<string, unknown>;
  const runner = await pickPackageRunner(engine, folder, worktree);
  const hasPackage = Object.keys(packageJson).length > 0;
  return [
    {
      label: "Lint",
      command:
        (await readSetting("quality.json", "lintCommand")) ||
        (scripts.lint ? `${runner} run lint` : ""),
    },
    {
      label: "Fallow",
      command:
        (await readSetting("quality.json", "fallowCommand")) ||
        (hasPackage ? FALLOW_COMMAND : ""),
    },
    {
      label: "Tests",
      command:
        (await readSetting("tdd.json", "testCommand")) ||
        (scripts.test ? `${runner} run test` : ""),
    },
  ];
};

type GuardResult = { label: string; verdict: string; detail: string };

const runGuard = async (
  engine: EngineInterface,
  folder: string,
  label: string,
  command: string
): Promise<GuardResult> => {
  if (!command) return { label, verdict: "none", detail: "" };
  const outcome = await runLongCommand(engine, ["sh", "-c", command], folder);
  if (
    command === FALLOW_COMMAND &&
    outcome.exitCode === MISSING_COMMAND_EXIT_CODE
  )
    return { label, verdict: "none", detail: "" };
  return outcome.exitCode === 0
    ? { label, verdict: "PASS", detail: `$ ${command} (in ${folder})` }
    : {
        label,
        verdict: "FAIL",
        detail: `$ ${command} (in ${folder})\n${keepLastLines(outcome.output, GUARD_OUTPUT_LINES)}`,
      };
};

const runGuards = async (
  engine: EngineInterface,
  worktree: string,
  guardFolders: string[]
) => {
  const guardResults: GuardResult[] = [];
  for (const folder of guardFolders)
    for (const { label, command } of await findGuardCommands(
      engine,
      folder,
      worktree
    ))
      guardResults.push(await runGuard(engine, folder, label, command));
  return guardResults;
};

const mergeVerdicts = (verdicts: string[]) => {
  if (verdicts.includes("FAIL")) return "FAIL";
  return verdicts.includes("PASS") ? "PASS" : "none (no command found)";
};

const readCheckCommand = (planText: string) =>
  (readSection(planText, "Check") ?? "")
    .match(BACKTICKED_TEXT)?.[0]
    ?.slice(1, -1)
    .trim() ?? "";

const formatCheckCommand = (planText: string) => {
  const checkCommand = readCheckCommand(planText);
  return checkCommand ? `\`${checkCommand}\`` : "none";
};

const checkSmallPlan = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const planPath = trimText(toolInput.path);
  const worktree = trimText(toolInput.worktree);
  const pathProblem = await findPlanPathProblem(engine, planPath);
  if (pathProblem) return { deny: pathProblem };
  if (
    (await gitOutput(
      engine,
      worktree,
      "rev-parse",
      "--is-inside-work-tree"
    )) !== "true"
  )
    return { deny: `${worktree} is not a git worktree.` };
  const planText = String(await engine.fs.read(planPath));
  const checkCommand = readCheckCommand(planText);
  if (!checkCommand)
    return {
      deny: `${planPath} has no command in backticks under "## Check".`,
    };
  if (trimText(toolInput.command) !== checkCommand)
    return {
      deny: `command must be the plan's check command, exactly: ${checkCommand}`,
    };
  const check = await runLongCommand(
    engine,
    ["sh", "-c", checkCommand],
    worktree
  );
  const changedFiles = await listChangedFiles(engine, worktree);
  const fileLines = changedFiles.map((changedFile) =>
    planText.includes(changedFile)
      ? changedFile
      : `${changedFile} (not in plan)`
  );
  const guardFolders = [
    ...new Set(
      await Promise.all(
        changedFiles.map((changedFile) =>
          findPackageFolder(engine, worktree, changedFile)
        )
      )
    ),
  ];
  const guardResults = await runGuards(
    engine,
    worktree,
    guardFolders.length > 0 ? guardFolders : [worktree]
  );
  const guardBlocks = GUARD_LABELS.map((label) => {
    const labelResults = guardResults.filter(
      (guardResult) => guardResult.label === label
    );
    return {
      summary: `${label}: ${mergeVerdicts(labelResults.map((guardResult) => guardResult.verdict))}`,
      details: labelResults
        .map((guardResult) => guardResult.detail)
        .filter(Boolean),
    };
  });
  const reportPath = planPath.replace(/\.md$/, ".check.txt");
  await engine.fs.write(
    reportPath,
    [
      `Check: exit ${check.exitCode}\n$ ${checkCommand}\n${keepLastLines(check.output, CHECK_OUTPUT_LINES)}`,
      `Files:\n${fileLines.join("\n")}`,
      ...guardBlocks.map(({ summary, details }) =>
        [summary, ...details].join("\n")
      ),
    ].join("\n\n")
  );
  return {
    result: [
      `Check: exit ${check.exitCode}`,
      `Files: ${changedFiles.length} changed, ${fileLines.length - changedFiles.filter((changedFile) => planText.includes(changedFile)).length} not in plan`,
      ...guardBlocks.map(({ summary }) => summary),
      `Report: ${reportPath}`,
    ].join("\n"),
  };
};

const saveReviewFindings = async (
  engine: EngineInterface,
  reviewText: string
) => {
  const planPath = /^Plan: (.+)$/m.exec(reviewText)?.[1]?.trim() ?? "";
  if (!planPath || (await findPlanPathProblem(engine, planPath)))
    return reviewText;
  const lastLine =
    reviewText.trimEnd().split("\n").pop()?.replace(/[`*]/g, "").trim() ?? "";
  if (lastLine === "PASS") return "PASS";
  if (!/^[`*]*FAIL\b/m.test(reviewText)) return reviewText;
  const findingsPath = planPath.replace(/\.md$/, ".review.txt");
  await engine.fs.write(findingsPath, reviewText);
  return `FAIL\nFindings: ${findingsPath}`;
};

const askClaude = (engine: EngineInterface, instruction: string) => {
  engine.clock.after(0, () => void engine.prompt.submit({ text: instruction }));
};

const composePlanInstruction = (
  workSource: string,
  setRule: string,
  laterNotes: string[]
) =>
  [
    workSource,
    `1. List the work that is still left. Check each item against the project as it is now (the files it names, the recent commits) and drop what is already done. If nothing is left, say so and stop.
2. Split that work into plans. A plan is one change that a small model can implement in one sitting and a second small model can review in one read: one goal, at most ${MAX_STEPS} steps, few files. Work that needs more becomes two plans. Leave out work that waits on a decision only the user can make.
3. Declare the dependency order: number the plans from 1 so that each one needs earlier plans only, and its number is its place in the build order.
4. Save each plan with one ${QUALIFIED_WRITE_TOOL_NAME} call: set ${setRule}, its order from 1, a title under 10 words, its kind, depends_on with the orders of the plans it needs ([] when it needs none), and its body. Set "project" from the work being planned (the files, services and repositories it names), not from the working directory; when it could be more than one repository, ask the user with AskUserQuestion, listing the candidate folders, before saving.`,
    `Load ${QUALIFIED_WRITE_TOOL_NAME} before you draft the first plan: its description states the shape every plan body must have, and the tool refuses a body that breaks it.`,
    `The plugin writes ${INDEX_FILE_NAME} in the set folder, listing every plan with its order, kind, status and dependencies, and rewrites it each time a plan is saved, edited with Edit or Write, or changes status. Never write or edit ${INDEX_FILE_NAME} yourself, and change a saved plan with ${QUALIFIED_UPDATE_TOOL_NAME}, or Edit for a wording fix, never with a shell command, so the index stays true.`,
    ...laterNotes,
    `When every plan is saved, reply with one line per plan (order, kind, title, the orders it depends on), then the work you left out and why. End by naming claude-notes, a terminal command, to read the plans and /${COMMAND_NAME} build to have small models build them, and say to run /clear first: the build reads the saved plans and needs nothing from this conversation.`,
  ].join("\n\n");

const composeBuildInstruction = (
  setFolder: string,
  planName: string,
  projectFolder: string,
  planLines: string[]
) => `${
  planName
    ? `Build only the plan at ${setFolder}/${planName}.md. If it depends on another plan listed below, which is not done, stop and say which.`
    : `Build the plans in ${setFolder}, in the order listed below. A plan waits until every plan it depends on is done.`
} You coordinate: never edit project files or read diffs yourself, and read a plan, report or findings file only in step 7. A plan's status changes through ${QUALIFIED_START_TOOL_NAME}, ${QUALIFIED_FINISH_TOOL_NAME} and, for blocked, ${QUALIFIED_STATUS_TOOL_NAME}; never edit ${INDEX_FILE_NAME} or a status line by hand. Load those three tools and ${QUALIFIED_CHECK_TOOL_NAME} with one ToolSearch call.

Plans not done (file, title, kind, status, depends on, check command):
${planLines.join("\n")}

Each plan is built in its own git worktree, on its own branch:
- Branch name: when ${projectFolder}/${BRANCH_CONVENTION_FILE_NAME} exists, follow the convention it states. Otherwise start an Explore agent with model "haiku" to read the repository's CONTRIBUTING.md, CLAUDE.md, AGENTS.md, the guides under .github/ and docs/, and \`git branch -a --sort=-committerdate | head -n 20\`, and reply with the branch naming convention in one line, or "none"; write that line to the file with Write. When the convention is none, name the branch \`<type>/<plan slug>\`, the type from the plan's kind: feat for a feature, bug for a fix, refactor, test, docs or chore.
- Base: the branch of the plan it depends on, when it depends on one; otherwise the branch checked out where the build started.

For each plan:
1. Call ${QUALIFIED_START_TOOL_NAME} with the plan's path, a folder inside the repository, the branch and the base. It marks the plan in-progress, creates the worktree or reuses the one an earlier build left on that branch, and answers \`Worktree: <path>\`.
2. Start the ${IMPLEMENTER_AGENT} agent. Its prompt is the plan file's absolute path, then a line \`Worktree: <path>\`. It answers DONE or BLOCKED.
3. On DONE, call ${QUALIFIED_CHECK_TOOL_NAME} with the plan's path, the worktree and the plan's check command as listed above. It runs the plan's check, lint, fallow and the tests, saves their output to a report file and answers one line for each, then \`Report: <path>\`. When Lint, Fallow or Tests is FAIL, start a new ${IMPLEMENTER_AGENT} agent with the two lines, then a line \`Fix: <report path>\`, and call ${QUALIFIED_CHECK_TOOL_NAME} again. Allow at most ${MAX_GUARD_ROUNDS} such rounds, then go to step 7; a failing guard does not count as a fix round.
4. Start the ${REVIEWER_AGENT} agent with the two lines, then a line \`Report: <report path>\`. It answers PASS, or FAIL and \`Findings: <path>\`.
5. On PASS, call ${QUALIFIED_FINISH_TOOL_NAME} with the plan's path, the worktree and one short conventional commit subject in the style of \`git log --oneline -n 10\`. It commits everything changed in the worktree with that subject alone, pushes the branch, removes the worktree, which keeps the branch, and marks the plan done. Never call it before the reviewer answers PASS. When it answers that a git step failed, the worktree is kept: say so in the plan's report line.
6. On FAIL, start a new ${IMPLEMENTER_AGENT} agent with the two lines, then a line \`Fix: <findings path>\`, and go again from step 3. Allow at most ${MAX_FIX_ROUNDS} fix rounds.
7. When the implementer answers BLOCKED, or the work still fails after ${MAX_FIX_ROUNDS} fix rounds, find the root cause: for this step only, read the plan and its report or findings file. When another plan provides the missing piece, build that plan first and base this branch on it; when the plan is wrong, correct the plan file; otherwise start a new ${IMPLEMENTER_AGENT} agent with the two lines, a \`Fix: <path>\` line and the cause. Keep going while each attempt changes the failure. Set the status to blocked only when the fix needs something only the user can give, or two attempts in a row leave the failure unchanged; the reason says what you tried and what is still needed. Keep its worktree and go on with the next plan that does not depend on it.

When every plan is handled, run \`git status --short\` in the checkout where the build started. When it shows changes, ask the user with AskUserQuestion whether to commit and push them as logical conventional commits, never a file that holds a secret such as \`.env\`.

Finish with one line per plan: order, title, status, branch and the fix rounds it took, with the reason for each plan that is blocked or still waiting.`;

const renameSet = async (
  engine: EngineInterface,
  requestedSet: string,
  newName: string,
  requestedProject = ""
) => {
  const projectFolder = await resolveRequestedProjectFolder(
    engine,
    requestedProject
  );
  const matches = matchSetNames(
    await listSavedSetNames(engine, projectFolder),
    requestedSet
  );
  if (matches.length === 0)
    return {
      text: `No plans are saved for this project in a set named like "${requestedSet}".`,
    };
  if (matches.length > 1)
    return {
      text: `Several sets match "${requestedSet}": ${matches.join(", ")}. Name one of them exactly.`,
    };
  const setName = matches[0] ?? "";
  const prefix = setName.match(SET_PREFIX)?.[1];
  if (prefix === undefined)
    return {
      text: `${setName} has no date prefix to keep, so it cannot be renamed.`,
    };
  const newSlug = toSlug(newName);
  if (!newSlug) return { text: "The new name needs letters or digits." };
  const newSetName = `${prefix}-${newSlug}`;
  if (newSetName === setName)
    return { text: `The set is already named ${setName}.` };
  if ((await listNames(engine, projectFolder)).includes(newSetName))
    return {
      text: `${newSetName} already exists, so ${setName} was not renamed.`,
    };
  const oldFolder = `${projectFolder}/${setName}`;
  const newFolder = `${projectFolder}/${newSetName}`;
  if (
    board.setFolder === oldFolder &&
    board.plans.some((plan) => stateOf(plan) === "running")
  )
    return {
      text: `A build of set ${setName} is running. Rename it when the build finishes.`,
    };
  const moveOutcome = await engine.process.run(["mv", oldFolder, newFolder]);
  if (moveOutcome.exitCode !== 0)
    return {
      text: `Could not rename ${setName}: ${moveOutcome.stderr.trim()}`,
    };
  const { planNames, planTexts } = await readSetPlans(engine, newFolder);
  await Promise.all(
    planNames.map((name, i) =>
      engine.fs.write(
        `${newFolder}/${name}`,
        (planTexts[i] ?? "").replace(SET_LINE, `set: ${newSetName}`)
      )
    )
  );
  await writeSetIndex(engine, newFolder);
  if (board.setFolder === oldFolder) {
    board.setFolder = newFolder;
    board.setLabel = labelSet(newSetName);
    await engine.ui.invalidate("ui.render");
  }
  return { text: `Renamed set ${setName} -> ${newSetName}.` };
};

const askClaudeToRename = (engine: EngineInterface, requestedSet: string) => {
  askClaude(
    engine,
    `Rename a saved set of small plans${requestedSet ? `. The user typed "${requestedSet}": if a saved set's name holds it, that is the set to rename; if none does, it is the new name for the set this conversation made or talks about.` : "."} Call ${QUALIFIED_LIST_TOOL_NAME} to find it: the set this conversation made or talks about, else ask the user with AskUserQuestion which of the newest sets they mean. Then call ${QUALIFIED_RENAME_TOOL_NAME} with a name of 2 to 5 words taken from what the set's plans deliver, and reply with the old and new names.`
  );
  return { text: "Renaming a set of small plans…" };
};

const runRenameCommand = (engine: EngineInterface, laterWords: string[]) => {
  const requestedSet = laterWords[0] ?? "";
  const newName = laterWords.slice(1).join(" ");
  return requestedSet && newName
    ? renameSet(engine, requestedSet, newName)
    : askClaudeToRename(engine, requestedSet);
};

const listSmallPlans = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const requestedSet = trimText(toolInput.set);
  const projectFolder = await resolveRequestedProjectFolder(
    engine,
    trimText(toolInput.project)
  );
  const savedSetNames = await listSavedSetNames(engine, projectFolder);
  const shownSetNames = requestedSet
    ? matchSetNames(savedSetNames, requestedSet)
    : savedSetNames.slice(0, SHOWN_SET_COUNT);
  if (shownSetNames.length === 0)
    return {
      result: requestedSet
        ? `No saved set holds "${requestedSet}" in ${projectFolder}.`
        : `No small plans are saved in ${projectFolder}.`,
    };
  const setTexts = await Promise.all(
    shownSetNames.map(async (setName) => {
      const indexPath = `${projectFolder}/${setName}/${INDEX_FILE_NAME}`;
      const indexText = (await engine.fs.exists(indexPath))
        ? String(await engine.fs.read(indexPath))
        : "No index.";
      return `Set ${setName} (${projectFolder}/${setName})\n${indexText}`;
    })
  );
  const olderSetNames = requestedSet
    ? []
    : savedSetNames.slice(SHOWN_SET_COUNT);
  return {
    result: [
      setTexts.join("\n\n"),
      ...(olderSetNames.length > 0
        ? [`Older sets: ${olderSetNames.join(", ")}`]
        : []),
    ].join("\n"),
  };
};

const renameSmallPlanSet = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const requestedSet = trimText(toolInput.set);
  const newName = trimText(toolInput.name);
  if (!requestedSet)
    return {
      deny: "set is required: the folder name of the set, or text its name holds.",
    };
  if (isRequestName(toSlug(newName)))
    return {
      deny: `The name "${newName}" names the request, not the work. Name what the plans deliver in 2 to 5 words, such as dark-mode-toggle.`,
    };
  const outcome = await renameSet(
    engine,
    requestedSet,
    newName,
    trimText(toolInput.project)
  );
  return outcome.text.startsWith("Renamed")
    ? { result: outcome.text }
    : { deny: outcome.text };
};

const NEW_SET_RULE =
  'a name you choose for this work: 2 to 5 lowercase words joined by hyphens that say what the work delivers, such as dark-mode-toggle. Take it from the work itself, never from the wording of the request: when the user says "plan this", name what "this" is. Use the same name for every plan; the tool puts the date and time in front';

const planWork = (engine: EngineInterface, requestedWork: string) => {
  askClaude(
    engine,
    composePlanInstruction(
      requestedWork
        ? `Plan this work as small plans: ${requestedWork}\n\nTake what you need to know from this conversation and from the project.`
        : "Plan the work this conversation still leaves to do, as small plans. Take it from what was asked for and agreed in this conversation and is not done yet.",
      NEW_SET_RULE,
      []
    )
  );
  return { text: "Planning the work as small plans…" };
};

const listHandoffNamesNewestFirst = async (
  engine: EngineInterface,
  handoffFolder: string
) =>
  (await listNames(engine, handoffFolder))
    .filter((name) => NUMBERED_MARKDOWN_FILE.test(name))
    .sort((first, second) => parseInt(second, 10) - parseInt(first, 10))
    .map((name) => name.replace(/\.md$/, ""));

const SET_QUESTION = "🧺 Which plan set shall we build?";
const PLAN_QUESTION = "🧩 The whole set, or just one plan?";
const HANDOFF_QUESTION = "📜 Which handoff should become small plans?";
const PICKER_HEADING = "🧩 Small plans";
const PRIDE_STRIPE_COLORS = [
  "error",
  "claude",
  "warning",
  "success",
  "suggestion",
  "autoAccept",
] as const;
const PICKER_QUESTIONS = [SET_QUESTION, PLAN_QUESTION, HANDOFF_QUESTION];

const isPickerQuestion = (questions: unknown[]) =>
  PICKER_QUESTIONS.includes(
    (questions[0] as { question?: string } | undefined)?.question ?? ""
  );

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const STAMPED_SET_NAME = /^\d{4}-(\d{2})-(\d{2})-(\d{2})(\d{2})-(.+)$/;
const NUMBERED_NAME = /^(\d+)-(.+)$/;

const toSentence = (slug: string) => {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const labelSet = (setName: string) => {
  const stamp = setName.match(STAMPED_SET_NAME);
  if (!stamp) return toSentence(setName);
  const [, month, day, hour, minute, slug] = stamp;
  return `${toSentence(slug ?? "")} · ${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${hour}:${minute}`;
};

const labelNumbered = (prefix: string) => (name: string) => {
  const numbered = name.match(NUMBERED_NAME);
  return numbered
    ? `${prefix}${Number(numbered[1])} · ${toSentence(numbered[2] ?? "")}`
    : name;
};

const pickFromList = async (
  engine: EngineInterface,
  question: string,
  header: string,
  namesNewestFirst: string[],
  labelName: (name: string) => string
) => {
  const askedNames = namesNewestFirst.slice(0, MAX_ASKED_OPTIONS);
  try {
    const answer = await engine.ui.ask(question, {
      header,
      options: askedNames.map(labelName),
    });
    return askedNames.find((name) => labelName(name) === answer) ?? answer;
  } catch {
    return undefined;
  }
};

const splitHandoff = async (
  engine: EngineInterface,
  requestedNumber: string,
  extraContext: string
) => {
  const projectName = await resolveProjectName(engine);
  const handoffFolder = `${await resolveHandoffsRoot(engine)}/${projectName}`;
  const handoffNames = await listHandoffNamesNewestFirst(engine, handoffFolder);
  if (handoffNames.length === 0)
    return {
      text: `No handoffs for ${projectName} yet. Run /handoff save first, or name the work: /${COMMAND_NAME} <work to plan>.`,
    };
  const shouldAsk = !requestedNumber && handoffNames.length > 1;
  const pickedName = shouldAsk
    ? await pickFromList(
        engine,
        HANDOFF_QUESTION,
        "Handoff",
        handoffNames,
        labelNumbered("#")
      )
    : handoffNames.find(
        (name) =>
          !requestedNumber || parseInt(name, 10) === Number(requestedNumber)
      );
  if (shouldAsk && pickedName === undefined)
    return {
      text: `No handoff was picked. Run /${COMMAND_NAME} handoff <id> with one of: ${handoffNames.map((name) => parseInt(name, 10)).join(", ")}.`,
    };
  const handoffName = handoffNames.find((name) => name === pickedName);
  if (!handoffName)
    return {
      text: `No handoff #${requestedNumber} for ${projectName}. Run /handoff list to see its handoffs.`,
    };
  const handoffFileName = `${handoffName}.md`;
  const setSlug = `handoff-${handoffName}`;
  const savedSetName = (await listSetsNewestFirst(engine)).find((name) =>
    name.endsWith(`-${setSlug}`)
  );
  const setName = savedSetName ?? composeNewSetName(setSlug);
  askClaude(
    engine,
    composePlanInstruction(
      `Read the handoff at ${handoffFolder}/${handoffFileName}. It records a session's goal, what was done and what is left. Plan the work it leaves as small plans.`,
      `"${setName}"`,
      [
        ...(savedSetName
          ? [
              `This handoff already has plans in ${await resolveProjectFolder(engine)}/${savedSetName}. Read them first and keep them as they are. Save plans only for work they do not cover, with orders after the highest one there.`,
            ]
          : []),
        ...(extraContext ? [`From the user: ${extraContext}`] : []),
      ]
    )
  );
  return { text: `Splitting the handoff into small plans in set ${setName}…` };
};

const listPlanNamesNotDone = async (
  engine: EngineInterface,
  setFolder: string
) => {
  const { planNames, planTexts } = await readSetPlans(engine, setFolder);
  return planNames
    .filter((_, i) => planTexts[i]?.match(STATUS_LINE)?.[0] !== "status: done")
    .map((name) => name.replace(/\.md$/, ""));
};

const listPlanLinesNotDone = async (
  engine: EngineInterface,
  setFolder: string
) => {
  const { planNames, planTexts } = await readSetPlans(engine, setFolder);
  return planNames.flatMap((name, i) => {
    const planText = planTexts[i] ?? "";
    const status = readFrontMatterField(planText, "status");
    return status === "done"
      ? []
      : [
          `- ${name} | ${readFrontMatterField(planText, "title") || name} | ${readFrontMatterField(planText, "kind")} | ${status} | depends on ${readFrontMatterField(planText, "depends_on") || "none"} | check: ${formatCheckCommand(planText)}`,
        ];
  });
};

const findPlanName = (planNames: string[], requestedPlan: string) => {
  const wantedText = requestedPlan.trim();
  return /^\d+$/.test(wantedText)
    ? planNames.find((name) => parseInt(name, 10) === Number(wantedText))
    : (planNames.find((name) => name === wantedText) ??
        planNames.find((name) => name.includes(wantedText)));
};

const pickPlanName = async (
  engine: EngineInterface,
  planNames: string[],
  requestedPlan: string
) => {
  if (requestedPlan) return findPlanName(planNames, requestedPlan);
  if (planNames.length === 1) return "";
  const pickedOption = await pickFromList(
    engine,
    PLAN_QUESTION,
    "Plans",
    [WHOLE_SET_OPTION, ...planNames],
    (name) => (name === WHOLE_SET_OPTION ? name : labelNumbered("")(name))
  );
  if (pickedOption === WHOLE_SET_OPTION) return "";
  return pickedOption === undefined
    ? undefined
    : findPlanName(planNames, pickedOption);
};

const matchSetNames = (setNames: string[], wantedName: string) => {
  const exactNames = setNames.filter((name) => name === wantedName);
  return exactNames.length > 0
    ? exactNames
    : setNames.filter((name) => name.includes(wantedName.trim()));
};

const buildPlans = async (
  engine: EngineInterface,
  requestedName: string,
  requestedPlan: string
) => {
  const projectFolder = await resolveProjectFolder(engine);
  const savedSetNames = await listSetsNewestFirst(engine);
  const setNamesNotDone = (
    await Promise.all(
      savedSetNames.map(async (name) =>
        (await listPlanNamesNotDone(engine, `${projectFolder}/${name}`))
          .length > 0
          ? name
          : ""
      )
    )
  ).filter(Boolean);
  if (
    !requestedName &&
    savedSetNames.length > 0 &&
    setNamesNotDone.length === 0
  )
    return { text: `Every plan of this project is done.` };
  const setNames = requestedName ? savedSetNames : setNamesNotDone;
  const shouldAsk = !requestedName && setNames.length > 1;
  const pickedName = shouldAsk
    ? await pickFromList(engine, SET_QUESTION, "Plan set", setNames, labelSet)
    : requestedName;
  if (pickedName === undefined)
    return {
      text: `No set was picked. Run /${COMMAND_NAME} build <set> with one of: ${setNames.join(", ")}.`,
    };
  const setName = matchSetNames(setNames, pickedName)[0];
  if (!setName)
    return {
      text: `No plans are saved for this project${requestedName ? ` in a set named like "${requestedName}"` : ""}. Run /${COMMAND_NAME} <work to plan> first.`,
    };
  const setFolder = `${projectFolder}/${setName}`;
  await writeSetIndex(engine, setFolder);
  const planNames = await listPlanNamesNotDone(engine, setFolder);
  if (planNames.length === 0)
    return { text: `Every plan in set ${setName} is done.` };
  const planName = await pickPlanName(engine, planNames, requestedPlan);
  if (planName === undefined)
    return {
      text: `No plan was picked. Run /${COMMAND_NAME} build ${setName} <order> with one of the plans not done: ${planNames.join(", ")}.`,
    };
  await startBoard(engine, setFolder, setName);
  askClaude(
    engine,
    composeBuildInstruction(
      setFolder,
      planName,
      projectFolder,
      await listPlanLinesNotDone(engine, setFolder)
    )
  );
  return {
    text: planName
      ? `Building plan ${planName} of set ${setName}…`
      : `Building the plans of set ${setName}…`,
  };
};

type BoardPlan = {
  name: string;
  label: string;
  status: string;
  startedAt?: number;
  endedAt?: number;
};

const BOARD_LOOKS = {
  failing: { label: "FAIL", glyph: "✗", word: "Failing", color: "error" },
  running: { label: "RUN", glyph: "●", word: "Building", color: "warning" },
  passing: { label: "PASS", glyph: "✓", word: "Done", color: "success" },
  waiting: { label: "WAIT", glyph: "○", word: "Waiting", color: "subtle" },
} as const;
type BoardState = keyof typeof BOARD_LOOKS;
const BOARD_STATES = Object.keys(BOARD_LOOKS) as BoardState[];
const STATE_OF_STATUS: Record<string, BoardState> = {
  blocked: "failing",
  "in-progress": "running",
  done: "passing",
  pending: "waiting",
};

const board = {
  isShown: false,
  setLabel: "",
  setFolder: "",
  plans: [] as BoardPlan[],
  ticker: undefined as
    ReturnType<EngineInterface["clock"]["every"]> | undefined,
};

const stateOf = (plan: BoardPlan): BoardState =>
  STATE_OF_STATUS[plan.status] ?? "waiting";

const syncBoardTicker = (engine: EngineInterface) => {
  const shouldTick =
    board.isShown && board.plans.some((plan) => stateOf(plan) === "running");
  if (shouldTick && !board.ticker)
    board.ticker = engine.clock.every(1000, () => {
      void engine.ui.invalidate("ui.render");
    });
  if (!shouldTick && board.ticker) {
    board.ticker.cancel();
    board.ticker = undefined;
  }
};

const startBoard = async (
  engine: EngineInterface,
  setFolder: string,
  setName: string
) => {
  const { planNames, planTexts } = await readSetPlans(engine, setFolder);
  const now = await engine.clock.now();
  board.setFolder = setFolder;
  board.setLabel = labelSet(setName);
  board.plans = planNames.map((fileName, i) => {
    const name = fileName.replace(/\.md$/, "");
    const planText = planTexts[i] ?? "";
    const title = readFrontMatterField(planText, "title");
    const status = readFrontMatterField(planText, "status") || "pending";
    return {
      name,
      label: title
        ? `${parseInt(name, 10)} · ${title}`
        : labelNumbered("")(name),
      status,
      startedAt: status === "in-progress" ? now : undefined,
    };
  });
  board.isShown = true;
  syncBoardTicker(engine);
  await engine.ui.invalidate("ui.render");
};

const recordPlanStatus = async (
  engine: EngineInterface,
  planPath: string,
  status: string
) => {
  const plan = board.plans.find(
    (candidate) => `${board.setFolder}/${candidate.name}.md` === planPath
  );
  if (!plan) return;
  const now = await engine.clock.now();
  if (status === "in-progress" && plan.status !== status) {
    plan.startedAt = now;
    plan.endedAt = undefined;
  }
  if (status === "done" || status === "blocked") plan.endedAt = now;
  plan.status = status;
  syncBoardTicker(engine);
  await engine.ui.invalidate("ui.render");
};

const hideBoard = async (engine: EngineInterface) => {
  board.isShown = false;
  syncBoardTicker(engine);
  await engine.ui.invalidate("ui.render");
  await engine.ui.toast(
    `Build board hidden. /${COMMAND_NAME} board shows it again.`
  );
};

const showBoard = async (engine: EngineInterface) => {
  if (board.plans.length === 0)
    return {
      text: `No build board to show yet. Run /${COMMAND_NAME} build first.`,
    };
  board.isShown = true;
  syncBoardTicker(engine);
  await engine.ui.invalidate("ui.render");
  return {};
};

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  const pad = (count: number) => String(count).padStart(2, "0");
  return minutes < 60
    ? `${minutes}m ${pad(seconds % 60)}s`
    : `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
};

const renderBoard = (
  elements: ReturnType<EngineInterface["ui"]["resolve"]>,
  bodyColumns: number,
  now: number,
  hideButton: RenderElement
) => {
  const { Box, Text } = elements;
  const innerWidth = bodyColumns - 4;
  const countOf = (state: BoardState) =>
    board.plans.filter((plan) => stateOf(plan) === state).length;
  const headerState: BoardState =
    countOf("failing") > 0
      ? "failing"
      : countOf("passing") === board.plans.length
        ? "passing"
        : "running";
  const headerLook = BOARD_LOOKS[headerState];
  const divider = h(
    Text,
    { color: "subtle", wrap: "clip" },
    "─".repeat(Math.max(innerWidth, 0))
  );
  const rows = BOARD_STATES.flatMap((state) =>
    board.plans
      .filter((plan) => stateOf(plan) === state)
      .map((plan) => {
        const look = BOARD_LOOKS[stateOf(plan)];
        const elapsed =
          plan.startedAt === undefined
            ? ""
            : formatElapsed((plan.endedAt ?? now) - plan.startedAt);
        return h(
          Box,
          { key: `plan-${plan.name}`, flexDirection: "row", columnGap: 2 },
          h(
            Box,
            { width: 6, flexShrink: 0 },
            h(
              Text,
              {
                backgroundColor: look.color,
                color: "inverseText",
                weight: "semibold",
                wrap: "clip",
              },
              ` ${look.label.padEnd(4)} `
            )
          ),
          h(
            Box,
            { flexGrow: 1, flexShrink: 1 },
            h(Text, { wrap: "truncate-end" }, plan.label)
          ),
          innerWidth >= 60 ? h(Box, { width: 10, flexShrink: 0 }) : null,
          innerWidth >= 40
            ? h(
                Box,
                { width: 7, flexShrink: 0, justifyContent: "flex-end" },
                h(Text, { dimColor: true, tabular: true }, elapsed)
              )
            : null
        );
      })
  );
  return h(
    Box,
    {
      key: "small-plans-board",
      flexDirection: "column",
      paddingX: 2,
      marginTop: 1,
    },
    h(
      Box,
      { flexDirection: "row", columnGap: 1 },
      h(Text, { weight: "semibold" }, PICKER_HEADING),
      h(Text, { dimColor: true }, "·"),
      h(Text, { dimColor: true }, board.setLabel),
      h(Text, { dimColor: true }, "·"),
      h(
        Text,
        { color: headerLook.color, weight: "semibold" },
        `${headerLook.glyph} ${headerLook.word}`
      )
    ),
    divider,
    ...rows,
    divider,
    h(
      Box,
      { flexDirection: "row", justifyContent: "space-between" },
      h(
        Box,
        { flexDirection: "row", columnGap: 2 },
        ...(["failing", "running", "passing"] as const).map((state) =>
          h(
            Text,
            { dimColor: true },
            `${BOARD_LOOKS[state].glyph} ${countOf(state)}`
          )
        )
      ),
      hideButton
    )
  ) as RenderElement;
};

export const register: Register = (on) => {
  on("ui.render", { component: "AskUserQuestion" }, async ($, e, next) => {
    const dialog = await next(e);
    if (!isPickerQuestion(e.props.questions)) return dialog;
    const { Box, Text } = $.ui.resolve(e);
    return h(
      Box,
      { key: "small-plans-picker", flexDirection: "column", paddingY: 1 },
      h(
        Box,
        { flexDirection: "row", gap: 1, paddingX: 1 },
        h(Text, { weight: "semibold" }, PICKER_HEADING),
        h(
          Text,
          {},
          ...PRIDE_STRIPE_COLORS.map((color) => h(Text, { color }, "━━"))
        )
      ),
      dialog
    ) as RenderElement;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!board.isShown || e.props.hasSurvey) return next(e);
    const { Button } = $.ui.resolve(e);
    const hideButton = h(Button, {
      key: "hide",
      label: "Hide",
      hotkey: "h",
      plain: true,
      onPress: () => hideBoard($),
    }) as RenderElement;
    return renderBoard(
      $.ui.resolve(e),
      e.props.bodyColumns,
      await $.clock.now(),
      hideButton
    );
  });

  on("session.end", async (_, e, next) => {
    board.ticker?.cancel();
    board.ticker = undefined;
    return next(e);
  });

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description:
        "Split work into small plans a small model can build, then build a set or one plan with small-model agents. Words: build [set] [order], handoff, rename, board.",
      argumentHint:
        "[work to plan] | handoff [id] [extra context] | build [set] [plan order] | rename [set] [new name]",
    });
    await $.tool.register({
      name: WRITE_TOOL_NAME,
      description: `Saves one small plan as a Markdown file under ~/.local/share/small-plans/<project>/<set>/, where <project> is the repository the plan changes, chosen from the work rather than the working directory; when that is unclear, ask the user with AskUserQuestion before saving. Call it once per plan when the user asks, in any words ("plan this", "break that into small plans"), to break work into small plans that a weaker model can implement and review. ${PLAN_SHAPE}`,
      inputSchema: WRITE_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: STATUS_TOOL_NAME,
      description: `Sets the status of one saved small plan (${STATUSES.join(", ")}) in its front matter. Call it each time a plan's status changes.`,
      inputSchema: STATUS_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: START_TOOL_NAME,
      description:
        "Starts one small plan's build: marks it in-progress and creates its git worktree beside the repository, or reuses the worktree already on that branch. Returns the worktree folder.",
      inputSchema: START_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: FINISH_TOOL_NAME,
      description:
        "Finishes one reviewed small plan: commits everything changed in its worktree with the given subject, pushes the branch, removes the worktree and marks the plan done.",
      inputSchema: FINISH_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: CHECK_TOOL_NAME,
      description:
        "Runs one small plan's check command, lint, fallow and tests in its worktree, saves their output to a report file beside the plan and answers one result line for each. The command input must match the plan's check command.",
      inputSchema: CHECK_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: LIST_TOOL_NAME,
      description:
        'Lists a project\'s saved small plans: its five newest sets, or the sets whose name holds the given text, each with every plan\'s order, title, kind, status and file. Call it first whenever the user refers to plans or a set without its exact name ("that plan", "the plans we just made", "the login set"), and before you rename, update or build one.',
      inputSchema: LIST_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: UPDATE_TOOL_NAME,
      description:
        "Changes one saved small plan: its title, kind, body or depends_on. Fields left out stay as they are. Call it when the user asks to change, fix, retitle or rewrite a saved plan, and instead of Edit when the change touches a heading, a step or the check, because it applies the shape checks of write_small_plan. It does not change a plan's order or status, and refuses a plan that is in-progress.",
      inputSchema: UPDATE_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: RENAME_TOOL_NAME,
      description:
        'Renames one saved set of small plans: its date or handoff prefix stays and the rest becomes the new name. Call it when the user asks, in any words, to rename plans or a set ("rename the plans", "give that set a better name", "call it X"). "The plan" means the set unless the user names one plan by its order or title. When the user gives no name, choose one from what the set\'s plans deliver.',
      inputSchema: RENAME_TOOL_SCHEMA,
      isDeferred: true,
    });
    return next(e);
  });

  on("command.run", { command: COMMAND_NAME }, async ($, e) => {
    const requestedWork = e.args.trim();
    const [firstWord = "", ...laterWords] = requestedWork.split(/\s+/);
    const isBuildOfOnePlan =
      laterWords.length === 2 && /^\d+$/.test(laterWords[1] ?? "");
    if (
      /^build$/i.test(firstWord) &&
      (laterWords.length <= 1 || isBuildOfOnePlan)
    )
      return buildPlans($, laterWords[0] ?? "", laterWords[1] ?? "");
    if (/^board$/i.test(requestedWork)) return showBoard($);
    if (/^rename$/i.test(firstWord)) return runRenameCommand($, laterWords);
    if (!/^handoff$/i.test(firstWord)) return planWork($, requestedWork);
    return /^\d+$/.test(laterWords[0] ?? "")
      ? splitHandoff($, laterWords[0] ?? "", laterWords.slice(1).join(" "))
      : splitHandoff($, "", laterWords.join(" "));
  });

  on("tool.call", async ($, e, next) => {
    const toolInput = e as unknown as Record<string, unknown>;
    if (e.tool === (QUALIFIED_WRITE_TOOL_NAME as string))
      return writeSmallPlan($, toolInput);
    if (e.tool === (QUALIFIED_STATUS_TOOL_NAME as string))
      return setPlanStatus($, toolInput);
    if (e.tool === (QUALIFIED_START_TOOL_NAME as string))
      return startSmallPlan($, toolInput);
    if (e.tool === (QUALIFIED_FINISH_TOOL_NAME as string))
      return finishSmallPlan($, toolInput);
    if (e.tool === (QUALIFIED_CHECK_TOOL_NAME as string))
      return checkSmallPlan($, toolInput);
    if (e.tool === (QUALIFIED_LIST_TOOL_NAME as string))
      return listSmallPlans($, toolInput);
    if (e.tool === (QUALIFIED_RENAME_TOOL_NAME as string))
      return renameSmallPlanSet($, toolInput);
    if (e.tool === (QUALIFIED_UPDATE_TOOL_NAME as string))
      return updateSmallPlan($, toolInput);
    if (!FILE_EDITING_TOOLS.includes(e.tool)) return next(e);
    const toolResult = await next(e);
    const setFolder = findPlanSetFolder(
      await resolvePlansRoot($),
      trimText(toolInput.file_path)
    );
    if (setFolder) await writeSetIndex($, setFolder);
    return toolResult;
  });

  on("agent.report", async ($, e, next) => {
    const report = await next(e);
    if (
      !e.subagentType.endsWith(REVIEWER_AGENT_NAME) ||
      report.consumed !== undefined
    )
      return report;
    return { ...report, text: await saveReviewFindings($, report.text) };
  });

  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstArgument =
      e.text.startsWith(COMMAND_PREFIX) && e.start === COMMAND_PREFIX.length;
    if (!isFirstArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingSubcommands = SUBCOMMAND_SUGGESTIONS.filter((subcommand) =>
      subcommand.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingSubcommands] };
  });
};
