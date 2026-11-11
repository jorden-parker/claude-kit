export type PlanFiles = {
  read: (path: string) => Promise<string | undefined>;
  list: (folder: string) => Promise<string[]>;
};

const joinPath = (...segments: string[]) =>
  segments
    .filter((segment) => segment !== "")
    .join("/")
    .replace(/\/{2,}/g, "/");

const PLAN_FILE_NAME = "plan.md";
const INDEX_FILE_NAME = "index.md";

type MarkdownSegment =
  | { isCode: false; rawLines: string[]; line: string }
  | {
      isCode: true;
      rawLines: string[];
      label: string | undefined;
      content: string;
    };

const FENCE_OPENING_PATTERN = /^(`{3,})[^`]*$/;

const readMarkdownSegments = (text: string): MarkdownSegment[] => {
  const lines = text.split("\n");
  const segments: MarkdownSegment[] = [];
  let pendingLabel: string | undefined;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const openingMatch = FENCE_OPENING_PATTERN.exec(line.trim());
    if (openingMatch) {
      const fenceMarker = openingMatch[1] ?? "";
      const closingIndex = findClosingFenceIndex(lines, index + 1, fenceMarker);
      const blockLines = lines.slice(index, closingIndex + 1);
      const contentLines = lines.slice(index + 1, closingIndex);
      segments.push({
        isCode: true,
        rawLines: blockLines,
        label: pendingLabel,
        content: contentLines.join("\n"),
      });
      pendingLabel = undefined;
      index = closingIndex + 1;
      continue;
    }
    const trimmedLine = line.trim();
    const labelMatch = /^([A-Za-z]+):$/.exec(trimmedLine);
    if (labelMatch) {
      pendingLabel = labelMatch[1];
    } else if (trimmedLine !== "") {
      pendingLabel = undefined;
    }
    segments.push({ isCode: false, rawLines: [line], line });
    index += 1;
  }
  return segments;
};

const findClosingFenceIndex = (
  lines: string[],
  startIndex: number,
  fenceMarker: string
) => {
  const closingOffset = lines
    .slice(startIndex)
    .findIndex((line) => line.trim() === fenceMarker);
  return closingOffset === -1 ? lines.length : startIndex + closingOffset;
};

const readTextOutsideFences = (text: string) =>
  readMarkdownSegments(text)
    .flatMap((segment) => (segment.isCode ? [] : [segment.line]))
    .join("\n");

const readIndexPlanFolders = (indexText: string) => {
  const orderBody = readSectionBody(indexText, "## ", "Order");
  const planLinkTargets = [
    ...orderBody.matchAll(/\]\(([^)]*\/plan\.md)\)/g),
  ].map((match) => match[1] ?? "");
  return planLinkTargets.map((target) =>
    target.slice(0, -`/${PLAN_FILE_NAME}`.length)
  );
};

const readSectionBody = (
  text: string,
  headingPrefix: string,
  heading: string
) => {
  const sections = splitIntoSections(text, headingPrefix);
  return sections.find((section) => section.heading === heading)?.body ?? "";
};

const splitIntoSections = (text: string, headingPrefix: string) => {
  const sections: { heading: string; body: string }[] = [];
  let currentLines: string[] = [];
  let currentHeading: string | undefined;
  for (const segment of readMarkdownSegments(text)) {
    const isHeading = !segment.isCode && segment.line.startsWith(headingPrefix);
    if (!segment.isCode && isHeading) {
      if (currentHeading !== undefined) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join("\n"),
        });
      }
      currentHeading = segment.line.slice(headingPrefix.length).trim();
      currentLines = [];
      continue;
    }
    currentLines.push(...segment.rawLines);
  }
  if (currentHeading !== undefined) {
    sections.push({ heading: currentHeading, body: currentLines.join("\n") });
  }
  return sections;
};

export const checkPlan = async (
  planFiles: PlanFiles,
  folderPath: string,
  projectRoot: string
): Promise<string[]> => {
  const indexText = await planFiles.read(joinPath(folderPath, INDEX_FILE_NAME));
  const session: CheckSession = {
    planFiles,
    folderPath,
    projectRoot,
    simulatedContents: new Map(),
  };
  if (indexText === undefined) {
    const singlePlanText = await planFiles.read(
      joinPath(folderPath, PLAN_FILE_NAME)
    );
    if (singlePlanText === undefined) {
      return ["index.md: missing"];
    }
    return checkPlanText(session, "", singlePlanText);
  }
  const problems: string[] = checkBannedPhrases(INDEX_FILE_NAME, indexText);
  const listedPlanFolders = readIndexPlanFolders(indexText);
  const planTexts: { planFolder: string; planText: string }[] = [];
  for (const planFolder of listedPlanFolders) {
    const planText = await planFiles.read(
      joinPath(folderPath, planFolder, PLAN_FILE_NAME)
    );
    if (planText === undefined) {
      problems.push(
        `${INDEX_FILE_NAME}: Order entry ${planFolder} has no ${PLAN_FILE_NAME}`
      );
    } else {
      planTexts.push({ planFolder, planText });
    }
  }
  const entryNames = await planFiles.list(folderPath);
  const unlistedPlanFolders = entryNames
    .filter(isPlanFolderName)
    .filter((entryName) => !listedPlanFolders.includes(entryName))
    .sort();
  for (const unlistedFolder of unlistedPlanFolders) {
    problems.push(
      `${unlistedFolder}: plan folder is not listed in ${INDEX_FILE_NAME}`
    );
    const unlistedPlanText = await planFiles.read(
      joinPath(folderPath, unlistedFolder, PLAN_FILE_NAME)
    );
    if (unlistedPlanText !== undefined) {
      planTexts.push({
        planFolder: unlistedFolder,
        planText: unlistedPlanText,
      });
    }
  }
  for (const { planFolder, planText } of planTexts) {
    problems.push(...(await checkPlanText(session, planFolder, planText)));
  }
  return problems;
};

type CheckSession = {
  planFiles: PlanFiles;
  folderPath: string;
  projectRoot: string;
  simulatedContents: Map<string, string | undefined>;
};

const readSimulatedContents = async (
  session: CheckSession,
  projectFile: string
) => {
  if (!session.simulatedContents.has(projectFile)) {
    const diskContents = await session.planFiles.read(
      joinPath(session.projectRoot, projectFile)
    );
    session.simulatedContents.set(projectFile, diskContents);
  }
  return session.simulatedContents.get(projectFile);
};

const REQUIRED_PLAN_SECTIONS = ["Context", "Steps"];

const checkPlanText = async (
  session: CheckSession,
  planFolder: string,
  planText: string
) => {
  const { planFiles, folderPath } = session;
  const planPath = joinPath(planFolder, PLAN_FILE_NAME);
  const sectionHeadings = splitIntoSections(planText, "## ").map(
    (section) => section.heading
  );
  const problems = REQUIRED_PLAN_SECTIONS.filter(
    (heading) => !sectionHeadings.includes(heading)
  ).map((heading) => `${planPath}: missing ## ${heading} section`);
  problems.push(...checkBannedPhrases(planPath, planText));
  const stepFileNames = readStepLinkTargets(planText);
  const builtStepFileNames = readTickedStepLinkTargets(planText);
  for (const stepFileName of stepFileNames) {
    const stepText = await planFiles.read(
      joinPath(folderPath, planFolder, stepFileName)
    );
    if (stepText === undefined) {
      problems.push(
        `${planPath}: step link ${stepFileName} points to a missing file`
      );
    } else {
      const stepPath = joinPath(planFolder, stepFileName);
      problems.push(...checkStepStructure(stepPath, stepText));
      if (!builtStepFileNames.includes(stepFileName)) {
        problems.push(...(await checkStepEdits(session, stepPath, stepText)));
      }
    }
  }
  const folderEntryNames = await planFiles.list(
    joinPath(folderPath, planFolder)
  );
  for (const unlistedStepName of folderEntryNames
    .filter(isStepFileName)
    .filter((name) => !stepFileNames.includes(name))) {
    problems.push(
      `${joinPath(planFolder, unlistedStepName)}: step file is not listed in ${PLAN_FILE_NAME}`
    );
  }
  return problems;
};

const STEP_TITLE_PATTERN = /^# Step \d+[a-z]?: \S/;

const STEP_KINDS = ["test", "code", "docs", "spike"];

const readFieldValue = (text: string, fieldName: string) => {
  const fieldMatch = new RegExp(`^- ${fieldName}:[ \\t]*(.*)$`, "m").exec(
    readTextOutsideFences(text)
  );
  return fieldMatch?.[1]?.trim();
};

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

const checkBannedPhrases = (filePath: string, fileText: string) => {
  const proseText = readTextOutsideFences(fileText);
  return BANNED_PHRASES.filter((phrase) =>
    bannedPhraseMatcher(phrase).test(proseText)
  ).map(
    (phrase) =>
      `${filePath}: contains banned phrase "${phrase.toLowerCase()}" outside code fences`
  );
};

const bannedPhraseMatcher = (phrase: string) =>
  new RegExp(`(?<![A-Za-z])${escapeRegExp(phrase)}(?![A-Za-z])`, "i");

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const checkStepTitle = (stepPath: string, stepText: string) => {
  const firstNonEmptyLine =
    stepText.split("\n").find((line) => line.trim() !== "") ?? "";
  return STEP_TITLE_PATTERN.test(firstNonEmptyLine)
    ? []
    : [`${stepPath}: missing title line`];
};

const checkStepKind = (stepPath: string, stepText: string) => {
  const kindValue = readFieldValue(stepText, "Kind");
  if (kindValue === undefined) return [`${stepPath}: missing Kind`];
  if (!STEP_KINDS.includes(kindValue))
    return [`${stepPath}: Kind must be test, code, docs or spike`];
  return [];
};

const checkStepCheckSection = (stepPath: string, stepText: string) => {
  const checkSection = splitIntoSections(stepText, "## ").find(
    (section) => section.heading === "Check"
  );
  if (checkSection === undefined)
    return [`${stepPath}: missing ## Check section`];
  const problems: string[] = [];
  if (
    !BACKTICKED_VALUE_PATTERN.test(
      readFieldValue(checkSection.body, "Run") ?? ""
    )
  ) {
    problems.push(`${stepPath}: ## Check needs a backticked Run`);
  }
  if (!readFieldValue(checkSection.body, "Expect")) {
    problems.push(`${stepPath}: ## Check has no Expect`);
  }
  return problems;
};

const checkStepEditBlocks = (
  stepPath: string,
  stepText: string,
  stepSectionHeadings: string[]
) => {
  if (readIsSpikeStep(stepText)) return [];
  const problems: string[] = stepSectionHeadings.includes("Edits")
    ? []
    : [`${stepPath}: non-spike step has no ## Edits section`];
  const stepEdits = readStepEdits(stepText);
  for (const edit of stepEdits) {
    problems.push(...checkEditStructure(stepPath, edit));
  }
  const changedLineCount = stepEdits.reduce(
    (total, edit) =>
      total + countLines(edit.replaceText) + countLines(edit.contentsText),
    0
  );
  if (changedLineCount > MAX_CHANGED_LINES_PER_STEP) {
    problems.push(
      `${stepPath}: Replace and Contents blocks total ${changedLineCount} lines, limit is ${MAX_CHANGED_LINES_PER_STEP}`
    );
  }
  return problems;
};

const checkStepStructure = (stepPath: string, stepText: string) => {
  const stepSectionHeadings = splitIntoSections(stepText, "## ").map(
    (section) => section.heading
  );
  const contextProblems = stepSectionHeadings.includes("Context")
    ? []
    : [`${stepPath}: missing ## Context section`];
  return [
    ...checkBannedPhrases(stepPath, stepText),
    ...checkStepTitle(stepPath, stepText),
    ...checkStepKind(stepPath, stepText),
    ...contextProblems,
    ...checkStepCheckSection(stepPath, stepText),
    ...checkStepEditBlocks(stepPath, stepText, stepSectionHeadings),
  ];
};

const MAX_CHANGED_LINES_PER_STEP = 60;

const countLines = (blockText: string | undefined) =>
  blockText === undefined || blockText === ""
    ? 0
    : blockText.split("\n").length;

const readIsSpikeStep = (stepText: string) =>
  readFieldValue(stepText, "Kind") === "spike";

const checkStepEdits = async (
  session: CheckSession,
  stepPath: string,
  stepText: string
) => {
  if (readIsSpikeStep(stepText)) {
    return [];
  }
  const problems: string[] = [];
  for (const edit of readStepEdits(stepText)) {
    problems.push(...(await checkEditAgainstFiles(session, stepPath, edit)));
  }
  return problems;
};

const checkEditAgainstFiles = async (
  session: CheckSession,
  stepPath: string,
  edit: StepEdit
) => {
  if (edit.file === undefined) {
    return [];
  }
  if (edit.action === "create") {
    return checkCreateEdit(
      session,
      stepPath,
      edit.label,
      edit.file,
      edit.contentsText
    );
  }
  if (edit.action !== "replace") {
    return [];
  }
  const currentContents = await readSimulatedContents(session, edit.file);
  if (currentContents === undefined) {
    return [
      `${stepPath}: ${edit.label} replaces ${edit.file}, which does not exist`,
    ];
  }
  if (edit.findText === undefined || edit.replaceText === undefined) {
    return [];
  }
  const findOccurrenceCount = countOccurrences(currentContents, edit.findText);
  if (findOccurrenceCount !== 1) {
    return [
      `${stepPath}: ${edit.label} Find text appears ${findOccurrenceCount} times in ${edit.file}, expected exactly once`,
    ];
  }
  session.simulatedContents.set(
    edit.file,
    replaceSingleOccurrence(currentContents, edit.findText, edit.replaceText)
  );
  return [];
};

const checkCreateEdit = async (
  session: CheckSession,
  stepPath: string,
  editLabel: string,
  file: string,
  createdContents: string | undefined
) => {
  const currentContents = await readSimulatedContents(session, file);
  if (currentContents !== undefined) {
    return [`${stepPath}: ${editLabel} creates ${file}, which already exists`];
  }
  session.simulatedContents.set(file, createdContents);
  return [];
};

const countOccurrences = (text: string, searchText: string) =>
  searchText === "" ? 0 : text.split(searchText).length - 1;

const replaceSingleOccurrence = (
  text: string,
  searchText: string,
  replacementText: string
) => {
  const matchIndex = text.indexOf(searchText);
  return (
    text.slice(0, matchIndex) +
    replacementText +
    text.slice(matchIndex + searchText.length)
  );
};

type StepEdit = {
  label: string;
  file: string | undefined;
  action: string | undefined;
  findText: string | undefined;
  replaceText: string | undefined;
  contentsText: string | undefined;
};

const readStepEdits = (stepText: string): StepEdit[] => {
  const editsSection = splitIntoSections(stepText, "## ").find(
    (section) => section.heading === "Edits"
  );
  if (editsSection === undefined) {
    return [];
  }
  return splitIntoSections(editsSection.body, "### ").map((section) =>
    readStepEdit(section)
  );
};

const readStepEdit = (section: {
  heading: string;
  body: string;
}): StepEdit => ({
  label: section.heading,
  file: readFieldValue(section.body, "File")?.replace(/`/g, "") || undefined,
  action: readFieldValue(section.body, "Action") || undefined,
  findText: readBlockContent(section.body, "Find"),
  replaceText: readBlockContent(section.body, "Replace"),
  contentsText: readBlockContent(section.body, "Contents"),
});

const readBlockContent = (text: string, blockLabel: string) => {
  for (const segment of readMarkdownSegments(text)) {
    if (segment.isCode && segment.label === blockLabel) {
      return segment.content;
    }
  }
  return undefined;
};

const EDIT_ACTIONS = ["replace", "create"];

const checkEditStructure = (stepPath: string, edit: StepEdit) => {
  const problems: string[] = [];
  if (edit.file === undefined) {
    problems.push(`${stepPath}: ${edit.label} has no File`);
  }
  if (edit.action === undefined || !EDIT_ACTIONS.includes(edit.action)) {
    problems.push(
      `${stepPath}: ${edit.label} has no Action (replace or create)`
    );
  } else if (edit.action === "replace") {
    if (edit.findText === undefined) {
      problems.push(
        `${stepPath}: ${edit.label} is replace but has no Find block`
      );
    }
    if (edit.replaceText === undefined) {
      problems.push(
        `${stepPath}: ${edit.label} is replace but has no Replace block`
      );
    }
  } else if (edit.contentsText === undefined) {
    problems.push(
      `${stepPath}: ${edit.label} is create but has no Contents block`
    );
  }
  return problems;
};

const BACKTICKED_VALUE_PATTERN = /`[^`]+`/;

const STEP_FILE_NAME_PATTERN = /^step-.+\.md$/;

const isStepFileName = (entryName: string) =>
  STEP_FILE_NAME_PATTERN.test(entryName);

const readStepLinkTargets = (planText: string) => {
  const stepsBody = readSectionBody(planText, "## ", "Steps");
  return [
    ...readTextOutsideFences(stepsBody).matchAll(/\]\(([^)\s]+\.md)\)/g),
  ].map((match) => match[1] ?? "");
};

const TICKED_STEP_LINK_PATTERN = /^\s*- \[x\].*\]\(([^)\s]+\.md)\)/gim;

const readTickedStepLinkTargets = (planText: string) => {
  const stepsBody = readSectionBody(planText, "## ", "Steps");
  return [
    ...readTextOutsideFences(stepsBody).matchAll(TICKED_STEP_LINK_PATTERN),
  ].map((match) => match[1] ?? "");
};

const PLAN_FOLDER_NAME_PATTERN = /^\d{2}-[a-z0-9-]+$/;

const isPlanFolderName = (entryName: string) =>
  PLAN_FOLDER_NAME_PATTERN.test(entryName);
