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
const MAX_ASKED_OPTIONS = 4;
const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const CLAUDE_WORKTREE_PATH = /^(.+?)\/\.claude\/worktrees\/[^/]+/;
const NUMBERED_MARKDOWN_FILE = /^\d+-.*\.md$/;
const WHOLE_SET_OPTION = "Whole set";
const MAX_FIX_ROUNDS = 3;
const SET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CODE_FENCE = /```[\s\S]*?```/g;
const NUMBERED_STEP = /^\d+\.\s/gm;
const BACKTICKED_TEXT = /`[^`\n]+`/;
const STATUS_LINE = /^status: .*$/m;
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
];
const WRITE_TOOL_NAME = "write_small_plan";
const QUALIFIED_WRITE_TOOL_NAME = `mcp__small-plans__${WRITE_TOOL_NAME}`;
const STATUS_TOOL_NAME = "set_small_plan_status";
const QUALIFIED_STATUS_TOOL_NAME = `mcp__small-plans__${STATUS_TOOL_NAME}`;
const IMPLEMENTER_AGENT = "small-plans:small-plan-implementer";
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
      description:
        "The orders of the earlier plans this plan needs done; [] when it needs none. Required: it declares the dependency order.",
    },
    project: {
      type: "string",
      description:
        "Only when the plan belongs to another project than this session's: that project's folder name.",
    },
  },
  required: ["set", "order", "title", "kind", "body", "depends_on"],
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
    commonGitFolder.replace(GIT_FOLDER_SUFFIX, "") ||
      folder.match(CLAUDE_WORKTREE_PATH)?.[1] ||
      folder
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
    ...(Array.isArray(toolInput.depends_on)
      ? []
      : [
          "depends_on is required: list the orders of the earlier plans this plan needs, or [] when it needs none.",
        ]),
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
    `created: ${new Date().toISOString()}`,
    `set: ${setName}`,
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
  const setFolder = findPlanSetFolder(plansRoot, planPath);
  if (setFolder) await writeSetIndex(engine, setFolder);
  return {
    result: `Plan marked ${status}: ${planPath}${setFolder ? `. The set's index at ${setFolder}/${INDEX_FILE_NAME} is updated.` : ""}`,
  };
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
3. Declare the dependency order: number the plans from 1 so that each one needs earlier plans only, and its number is its place in the build order.
4. Save each plan with one ${QUALIFIED_WRITE_TOOL_NAME} call: set "${setName}", its order from 1, a title under 10 words, its kind, depends_on with the orders of the plans it needs ([] when it needs none), and its body.`,
    PLAN_SHAPE,
    `The plugin writes ${INDEX_FILE_NAME} in the set folder, listing every plan with its order, kind, status and dependencies, and rewrites it each time a plan is saved, edited with Edit or Write, or changes status. Never write or edit ${INDEX_FILE_NAME} yourself, and change a plan file only with Edit or Write, never with a shell command, so the index stays true.`,
    ...laterNotes,
    `When every plan is saved, reply with one line per plan (order, kind, title, the orders it depends on), then the work you left out and why. End by naming claude-notes, a terminal command, to read the plans and /${COMMAND_NAME} build to have small models build them.`,
  ].join("\n\n");

const composeBuildInstruction = (setFolder: string, planName: string) => `${
  planName
    ? `Build only the plan at ${setFolder}/${planName}.md. If its depends_on names a plan in ${setFolder} that is not done, stop and say which.`
    : `Build the plans in ${setFolder}.`
} You coordinate and review: never edit project files yourself. Change a plan's status only with ${QUALIFIED_STATUS_TOOL_NAME}, which also rewrites the set's ${INDEX_FILE_NAME}; never edit ${INDEX_FILE_NAME} or a status line by hand.

${
  planName
    ? ""
    : "Read each plan file's front matter and take the plans in file-name order. Skip a plan whose status is done. A plan whose depends_on names a plan that is not done waits until that plan is done.\n\n"
}For each plan:
1. Set its status to in-progress with ${QUALIFIED_STATUS_TOOL_NAME}. Run \`git status --short\` and note the files already changed, so the review can tell this plan's changes from earlier ones.
2. Start the ${IMPLEMENTER_AGENT} agent with the plan file's absolute path as its prompt. It answers DONE or BLOCKED.
3. On DONE, review the work yourself, like a tech lead reviewing a pull request against the plan. Trust nothing in the agent's report until a tool result shows it:
   a. Run the command under "## Check" and compare its output with "- Expect:".
   b. Run \`git diff --stat\`. Every file this plan changed is named in the plan; a change to any other file fails the review.
   c. Read the full \`git diff\` of those files. Every hunk traces to a step, the code the plan quotes is there as quoted, and each "## Review" line holds.
   d. Read what each new or changed test asserts. A test that would pass without the change fails the review.
   e. Run the project's lint command (the "lint" script in package.json, or the lintCommand in .claude/quality.json) and, in a JavaScript or TypeScript project, \`fallow audit\`. A lint error or a failing fallow verdict fails the review, even when the plan's check passes.
4. When the review passes, set the status to done.
5. When it fails, write numbered findings, each naming the step or "## Review" line, the file and line, and what the plan asks for that the work does not do. Start a new ${IMPLEMENTER_AGENT} agent with the plan file's absolute path, a blank line, then the findings. Review its work again from step 3. Allow at most ${MAX_FIX_ROUNDS} fix rounds.
6. When the implementer answers BLOCKED, or the work still fails review after ${MAX_FIX_ROUNDS} fix rounds, set the status to blocked with the reason and go on with the next plan that does not depend on it.

Finish with one line per plan: order, title, status and the fix rounds it took, with the reason for each plan that is blocked or still waiting.`;

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

const listHandoffNamesNewestFirst = async (
  engine: EngineInterface,
  handoffFolder: string
) =>
  (await listNames(engine, handoffFolder))
    .filter((name) => NUMBERED_MARKDOWN_FILE.test(name))
    .sort((first, second) => parseInt(second, 10) - parseInt(first, 10))
    .map((name) => name.replace(/\.md$/, ""));

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
        "Which handoff should be split into small plans?",
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

const listPlanNamesNotDone = async (
  engine: EngineInterface,
  setFolder: string
) => {
  const { planNames, planTexts } = await readSetPlans(engine, setFolder);
  return planNames
    .filter((_, i) => planTexts[i]?.match(STATUS_LINE)?.[0] !== "status: done")
    .map((name) => name.replace(/\.md$/, ""));
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
    "Build the whole set, or one plan of it?",
    "Plans",
    [WHOLE_SET_OPTION, ...planNames],
    (name) => (name === WHOLE_SET_OPTION ? name : labelNumbered("")(name))
  );
  if (pickedOption === WHOLE_SET_OPTION) return "";
  return pickedOption === undefined
    ? undefined
    : findPlanName(planNames, pickedOption);
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
    ? await pickFromList(
        engine,
        "Which set of small plans should be built?",
        "Plan set",
        setNames,
        labelSet
      )
    : requestedName;
  if (pickedName === undefined)
    return {
      text: `No set was picked. Run /${COMMAND_NAME} build <set> with one of: ${setNames.join(", ")}.`,
    };
  const setName =
    setNames.find((name) => name === pickedName) ??
    setNames.find((name) => name.includes(pickedName.trim()));
  if (!setName)
    return {
      text: `No plans are saved for this project${requestedName ? ` in a set named like "${requestedName}"` : ""}. Run /${COMMAND_NAME} <work to plan> first.`,
    };
  const setFolder = `${projectFolder}/${setName}`;
  const planNames = await listPlanNamesNotDone(engine, setFolder);
  if (planNames.length === 0)
    return { text: `Every plan in set ${setName} is done.` };
  const planName = await pickPlanName(engine, planNames, requestedPlan);
  if (planName === undefined)
    return {
      text: `No plan was picked. Run /${COMMAND_NAME} build ${setName} <order> with one of the plans not done: ${planNames.join(", ")}.`,
    };
  askClaude(engine, composeBuildInstruction(setFolder, planName));
  return {
    text: planName
      ? `Building plan ${planName} of set ${setName}…`
      : `Building the plans of set ${setName}…`,
  };
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description:
        "Plan work as small plans a weaker model can implement and review: name the work, or leave it out to plan what this conversation leaves; handoff [id] plans what a saved handoff leaves; build [set] [plan order] has small-model agents implement a whole set or one plan of it while this session reviews and sends back fixes",
      argumentHint:
        "[work to plan] | handoff [id] [extra context] | build [set] [plan order]",
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
    const isBuildOfOnePlan =
      laterWords.length === 2 && /^\d+$/.test(laterWords[1] ?? "");
    if (
      /^build$/i.test(firstWord) &&
      (laterWords.length <= 1 || isBuildOfOnePlan)
    )
      return buildPlans($, laterWords[0] ?? "", laterWords[1] ?? "");
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
    if (!FILE_EDITING_TOOLS.includes(e.tool)) return next(e);
    const toolResult = await next(e);
    const setFolder = findPlanSetFolder(
      await resolvePlansRoot($),
      trimText(toolInput.file_path)
    );
    if (setFolder) await writeSetIndex($, setFolder);
    return toolResult;
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
