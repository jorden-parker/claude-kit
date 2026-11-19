import type { EngineInterface, Register } from "claude-code";

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
const MAX_SLUG_LENGTH = 60;
const VIEWER_BUILD_TIMEOUT_MS = 180_000;
const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const HANDOFF_FILE_NAME = /^\d+-.*\.md$/;
const SET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CODE_FENCE = /```[\s\S]*?```/g;
const NUMBERED_STEP = /^\d+\.\s/gm;
const BACKTICKED_TEXT = /`[^`\n]+`/;
const STATUS_LINE = /^status: .*$/m;
const COMMAND_NAME = "small-plans";
const WRITE_TOOL_NAME = "write_small_plan";
const QUALIFIED_WRITE_TOOL_NAME = `mcp__small-plans__${WRITE_TOOL_NAME}`;
const STATUS_TOOL_NAME = "set_small_plan_status";
const QUALIFIED_STATUS_TOOL_NAME = `mcp__small-plans__${STATUS_TOOL_NAME}`;
const IMPLEMENTER_AGENT = "small-plans:small-plan-implementer";
const REVIEWER_AGENT = "small-plans:small-plan-reviewer";
const PLAN_SHAPE = `The body holds these "## " headings, in this order: ${PLAN_SECTIONS.join(", ")}.
- Goal: one sentence on what is true when the plan is done.
- Context: all that the implementer must know and cannot guess: each file by its path, the exact names of the functions, types and commands involved, and the decisions already made. The implementer sees this plan only, never this conversation or another plan.
- Steps: a numbered list of at most ${MAX_STEPS} steps. Each step is one edit: the file path, the place in it, and what to write there. Quote the exact code where the wording matters.
- Check: "- Run:" with one command in backticks, and "- Expect:" with what its output shows when the plan worked.
- Review: a list of what a reviewer confirms by reading the diff, each line a fact that is true or false.
Vague wording is refused outside code fences: ${BANNED_PHRASES.join(", ")}. Say the exact thing instead.`;
const WRITE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    set: {
      type: "string",
      description:
        "The folder name of the group this plan belongs to; every plan of one split shares it. Use the set the instruction names, or name a new one as date, time and slug, such as 2026-11-19-1542-fix-login.",
    },
    order: {
      type: "number",
      description: `The plan's place in the build order, from 1 to ${MAX_ORDER}.`,
    },
    title: { type: "string", description: "A short title, under 10 words." },
    kind: {
      type: "string",
      enum: KINDS,
      description:
        "feature: new behaviour. fix: a bug. refactor: same behaviour, better code. test: tests only. docs: documentation only. chore: tooling, config, releases.",
    },
    body: { type: "string", description: "The plan, in Markdown." },
    depends_on: {
      type: "array",
      items: { type: "number" },
      description: "The orders of the earlier plans this plan needs done.",
    },
    project: {
      type: "string",
      description:
        "Only when the plan belongs to another project than this session's: that project's folder name.",
    },
  },
  required: ["set", "order", "title", "kind", "body"],
};
const STATUS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "The plan file's absolute path." },
    status: { type: "string", enum: STATUSES },
  },
  required: ["path", "status"],
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

const resolveProjectName = async (engine: EngineInterface) => {
  const folder = await engine.session.root();
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

const readClaudeFolder = async (engine: EngineInterface) =>
  `${(await engine.env.get("HOME")) ?? ""}/.claude`;

const resolvePlansRoot = async (engine: EngineInterface) =>
  (await engine.env.get("SMALL_PLANS_DIR")) ??
  `${await readClaudeFolder(engine)}/small-plans`;

const resolveProjectFolder = async (engine: EngineInterface) =>
  `${await resolvePlansRoot(engine)}/${await resolveProjectName(engine)}`;

const resolveHandoffsRoot = async (engine: EngineInterface) =>
  (await engine.env.get("HANDOFFS_DIR")) ??
  `${await readClaudeFolder(engine)}/handoffs`;

const listNames = async (engine: EngineInterface, folderPath: string) =>
  (await engine.fs.list(folderPath).catch(() => [])).map((entry) => entry.name);

const listSetsNewestFirst = async (engine: EngineInterface) =>
  (await listNames(engine, await resolveProjectFolder(engine)))
    .filter((name) => SET_NAME.test(name) && !name.endsWith(".md"))
    .sort()
    .reverse();

const composeNewSetName = (slug: string) => {
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  return `${stamp}-${slug}`;
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
    ...(checkSection !== undefined && !BACKTICKED_TEXT.test(checkSection)
      ? ['"## Check" needs a command in backticks to run.']
      : []),
    ...(bannedPhrases.length > 0
      ? [
          `Replace the vague wording with the exact thing: ${bannedPhrases
            .map((phrase) => `"${phrase}"`)
            .join(", ")}.`,
        ]
      : []),
  ];
};

const writeSmallPlan = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const setName = trimText(toolInput.set);
  const order = Number(toolInput.order);
  const title = trimText(toolInput.title).replace(/\s+/g, " ");
  const kind = trimText(toolInput.kind);
  const body = trimText(toolInput.body);
  const dependencies = Array.isArray(toolInput.depends_on)
    ? toolInput.depends_on.map(Number)
    : [];
  const problems = [
    ...(SET_NAME.test(setName)
      ? []
      : [
          "set must be a folder name of letters, digits, dots, dashes and underscores.",
        ]),
    ...(Number.isInteger(order) && order >= 1 && order <= MAX_ORDER
      ? []
      : [`order must be a whole number from 1 to ${MAX_ORDER}.`]),
    ...(toSlug(title) ? [] : ["The title needs letters or digits."]),
    ...(KINDS.includes(kind)
      ? []
      : [`kind must be one of: ${KINDS.join(", ")}.`]),
    ...(dependencies.every(
      (dependency) =>
        Number.isInteger(dependency) && dependency >= 1 && dependency < order
    )
      ? []
      : ["depends_on may only name the orders of earlier plans."]),
    ...listBodyProblems(body),
  ];
  if (problems.length > 0)
    return {
      deny: `The plan was not saved. Fix every problem and call this tool again:\n- ${problems.join("\n- ")}`,
    };

  const projectName = trimText(toolInput.project)
    ? toProjectName(trimText(toolInput.project))
    : await resolveProjectName(engine);
  const setFolder = `${await resolvePlansRoot(engine)}/${projectName}/${setName}`;
  const orderPrefix = `${String(order).padStart(ORDER_WIDTH, "0")}-`;
  const savedName = (await listNames(engine, setFolder)).find((name) =>
    name.startsWith(orderPrefix)
  );
  if (savedName)
    return {
      deny: `Plan ${order} is already saved at ${setFolder}/${savedName}, and a saved plan is never replaced. Use the next free order, or have the user delete that file.`,
    };

  const planPath = `${setFolder}/${orderPrefix}${toSlug(title)}.md`;
  const frontMatter = [
    `title: ${title}`,
    `project: ${projectName}`,
    `set: ${setName}`,
    `order: ${order}`,
    `kind: ${kind}`,
    `status: ${STATUSES[0]}`,
    ...(dependencies.length > 0
      ? [`depends_on: ${dependencies.join(", ")}`]
      : []),
    `created: ${new Date().toISOString()}`,
  ].join("\n");
  await engine.fs.write(planPath, `---\n${frontMatter}\n---\n\n${body}\n`);
  return { result: `Plan saved to ${planPath}` };
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
  const isPlanFile =
    planPath.startsWith(`${plansRoot}/`) &&
    planPath.endsWith(".md") &&
    !planPath.split("/").includes("..");
  if (!isPlanFile || !(await engine.fs.exists(planPath)))
    return { deny: `path must be a saved plan file under ${plansRoot}.` };
  const planText = String(await engine.fs.read(planPath));
  if (!STATUS_LINE.test(planText))
    return { deny: `${planPath} has no "status:" line in its front matter.` };
  await engine.fs.write(
    planPath,
    planText.replace(STATUS_LINE, `status: ${status}`)
  );
  return { result: `Plan marked ${status}: ${planPath}` };
};

const askClaude = (engine: EngineInterface, instruction: string) => {
  engine.clock.after(0, () => void engine.prompt.submit({ text: instruction }));
};

const composePlanInstruction = (
  workSource: string,
  setName: string,
  laterNotes: string[]
) =>
  [
    workSource,
    `1. List the work that is still left. Check each item against the project as it is now (the files it names, the recent commits) and drop what is already done. If nothing is left, say so and stop.
2. Split that work into plans. A plan is one change that a small model can implement in one sitting and a second small model can review in one read: one goal, at most ${MAX_STEPS} steps, few files. Work that needs more becomes two plans. Leave out work that waits on a decision only the user can make.
3. Order the plans so that each one needs earlier plans only.
4. Save each plan with one ${QUALIFIED_WRITE_TOOL_NAME} call: set "${setName}", its order from 1, a title under 10 words, its kind, depends_on with the orders of the plans it needs, and its body.`,
    PLAN_SHAPE,
    ...laterNotes,
    `When every plan is saved, reply with one line per plan (order, kind, title), then the work you left out and why. End by naming /${COMMAND_NAME} open to read the plans and /${COMMAND_NAME} build to have small models build them.`,
  ].join("\n\n");

const composeBuildInstruction = (
  setFolder: string
) => `Build the plans in ${setFolder}. You coordinate: never edit project files yourself.

Read each plan file's front matter and take the plans in file-name order. Skip a plan whose status is done. A plan whose depends_on names a plan that is not done waits until that plan is done.

For each plan:
1. Set its status to in-progress with ${QUALIFIED_STATUS_TOOL_NAME}.
2. Start the ${IMPLEMENTER_AGENT} agent with the plan file's absolute path as its prompt.
3. When it answers DONE, start the ${REVIEWER_AGENT} agent with the same path.
4. On PASS, set the status to done. On FAIL, start the implementer once more with the path followed by the reviewer's findings, then the reviewer once more.
5. When the implementer answers BLOCKED, or the second review fails, set the status to blocked and go on with the next plan that does not depend on it.

Finish with one line per plan: order, title and status, with the reason for each plan that is blocked or still waiting.`;

const planWork = (engine: EngineInterface, requestedWork: string) => {
  const setName = composeNewSetName(toSlug(requestedWork) || "plans");
  askClaude(
    engine,
    composePlanInstruction(
      requestedWork
        ? `Plan this work as small plans: ${requestedWork}\n\nTake what you need to know from this conversation and from the project.`
        : "Plan the work this conversation still leaves to do, as small plans. Take it from what was asked for and agreed in this conversation and is not done yet.",
      setName,
      []
    )
  );
  return { text: `Planning the work as small plans in set ${setName}…` };
};

const findHandoffFileName = async (
  engine: EngineInterface,
  handoffFolder: string,
  requestedNumber: string
) => {
  const newestFirst = (await listNames(engine, handoffFolder))
    .filter((name) => HANDOFF_FILE_NAME.test(name))
    .sort((first, second) => parseInt(second, 10) - parseInt(first, 10));
  return requestedNumber
    ? newestFirst.find((name) => parseInt(name, 10) === Number(requestedNumber))
    : newestFirst[0];
};

const splitHandoff = async (
  engine: EngineInterface,
  requestedNumber: string,
  extraContext: string
) => {
  const projectName = await resolveProjectName(engine);
  const handoffFolder = `${await resolveHandoffsRoot(engine)}/${projectName}`;
  const handoffFileName = await findHandoffFileName(
    engine,
    handoffFolder,
    requestedNumber
  );
  if (!handoffFileName)
    return {
      text: `No handoff ${requestedNumber ? `${requestedNumber} ` : ""}is saved for ${projectName}. Run /handoff save first, or name the work: /${COMMAND_NAME} <work to plan>.`,
    };
  const setSlug = `handoff-${handoffFileName.replace(/\.md$/, "")}`;
  const savedSetName = (await listSetsNewestFirst(engine)).find((name) =>
    name.endsWith(`-${setSlug}`)
  );
  const setName = savedSetName ?? composeNewSetName(setSlug);
  askClaude(
    engine,
    composePlanInstruction(
      `Read the handoff at ${handoffFolder}/${handoffFileName}. It records a session's goal, what was done and what is left. Plan the work it leaves as small plans.`,
      setName,
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

const buildPlans = async (engine: EngineInterface, requestedName: string) => {
  const setName = (await listSetsNewestFirst(engine)).find((name) =>
    name.includes(requestedName)
  );
  if (!setName)
    return {
      text: `No plans are saved for this project${requestedName ? ` in a set named like "${requestedName}"` : ""}. Run /${COMMAND_NAME} <work to plan> first.`,
    };
  askClaude(
    engine,
    composeBuildInstruction(`${await resolveProjectFolder(engine)}/${setName}`)
  );
  return { text: `Building the plans of set ${setName}…` };
};

const openViewer = async (engine: EngineInterface) => {
  const launch = await engine.process
    .run(["bash", `${engine.plugin.root}/bin/small-plans`, "--background"], {
      timeoutMs: VIEWER_BUILD_TIMEOUT_MS,
    })
    .catch(() => undefined);
  if (launch?.exitCode === 0)
    return { text: "Small plans are opening in the browser." };
  return {
    text: launch?.stderr.trim() || "Could not start the small plans viewer.",
  };
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description:
        "Plan work as small plans a weaker model can implement and review: name the work, or leave it out to plan what this conversation leaves; handoff [id] plans what a saved handoff leaves; build [set] has small-model agents implement and review a set; open shows every plan in the browser",
      argumentHint:
        "[work to plan] | handoff [id] [extra context] | build [set] | open",
    });
    await $.tool.register({
      name: WRITE_TOOL_NAME,
      description: `Saves one small plan as a Markdown file under ~/.claude/small-plans/<project>/<set>/. Call it once per plan when the user asks to break work into small plans that a weaker model can implement and review. ${PLAN_SHAPE}`,
      inputSchema: WRITE_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: STATUS_TOOL_NAME,
      description: `Sets the status of one saved small plan (${STATUSES.join(", ")}) in its front matter. Call it each time a plan's status changes.`,
      inputSchema: STATUS_TOOL_SCHEMA,
      isDeferred: false,
    });
    return next(e);
  });

  on("command.run", { command: COMMAND_NAME }, async ($, e) => {
    const requestedWork = e.args.trim();
    const [firstWord = "", ...laterWords] = requestedWork.split(/\s+/);
    if (/^open$/i.test(requestedWork)) return openViewer($);
    if (/^build$/i.test(firstWord) && laterWords.length <= 1)
      return buildPlans($, laterWords[0] ?? "");
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
    return next(e);
  });
};
