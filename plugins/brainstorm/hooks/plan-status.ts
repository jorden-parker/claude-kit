export const PLAN_FILE_NAME = "plan.md";
export const INDEX_FILE_NAME = "index.md";

export const PLAN_STATUSES = ["pending", "in-progress", "done", "blocked"];

export const PLAN_STATUSES_AS_TEXT = `${PLAN_STATUSES.slice(0, -1).join(", ")} or ${PLAN_STATUSES.at(-1)}`;

const PLAN_STATUS_LINE_PATTERN = /^- Status:[ \t]*(.*)$/m;

export const readPlanStatus = (planText: string) =>
  PLAN_STATUS_LINE_PATTERN.exec(planText)?.[1]?.trim();

const INDEX_ROW_PATTERN =
  /^(\|[^|\n]*\|[ \t]*\[.*\]\(([^)\s]+)\/plan\.md\)[ \t]*\|)[ \t]*([^|\n]*?)[ \t]*\|/gm;

export const readIndexEntries = (indexText: string) =>
  [...indexText.matchAll(INDEX_ROW_PATTERN)].map((rowMatch) => ({
    planFolder: rowMatch[2] ?? "",
    status: rowMatch[3] ?? "",
  }));

const replaceIndexStatus = (
  indexText: string,
  planFolder: string,
  status: string
) =>
  indexText.replace(
    INDEX_ROW_PATTERN,
    (rowText: string, rowStart: string, rowPlanFolder: string) =>
      rowPlanFolder === planFolder ? `${rowStart} ${status} |` : rowText
  );

export type StatusFiles = {
  read: (path: string) => Promise<string | undefined>;
  write: (path: string, text: string) => Promise<void>;
};

const TRAILING_SLASHES_PATTERN = /\/+$/;

export const readPlanFolderName = (planFolderPath: string) =>
  planFolderPath.replace(TRAILING_SLASHES_PATTERN, "").split("/").at(-1) ?? "";

export const setPlanStatus = async (
  statusFiles: StatusFiles,
  requestedFolderPath: string,
  status: string
): Promise<string[]> => {
  if (!PLAN_STATUSES.includes(status)) {
    return [`Status must be ${PLAN_STATUSES_AS_TEXT}`];
  }
  const planFolderPath = requestedFolderPath.replace(
    TRAILING_SLASHES_PATTERN,
    ""
  );
  const planFolder = readPlanFolderName(planFolderPath);
  const runFolderPath = planFolderPath.slice(0, -(planFolder.length + 1));
  const planPath = `${planFolderPath}/${PLAN_FILE_NAME}`;
  const indexPath = `${runFolderPath}/${INDEX_FILE_NAME}`;
  const planText = await statusFiles.read(planPath);
  const indexText = await statusFiles.read(indexPath);
  if (planText === undefined || indexText === undefined) {
    return [
      ...(planText === undefined ? [`${planPath}: missing`] : []),
      ...(indexText === undefined ? [`${indexPath}: missing`] : []),
    ];
  }
  if (readPlanStatus(planText) === undefined) {
    return [`${planPath}: has no Status line`];
  }
  const isListedInIndex = readIndexEntries(indexText).some(
    (entry) => entry.planFolder === planFolder
  );
  if (!isListedInIndex) {
    return [`${indexPath}: has no row for ${planFolder}`];
  }
  await statusFiles.write(
    planPath,
    planText.replace(PLAN_STATUS_LINE_PATTERN, () => `- Status: ${status}`)
  );
  await statusFiles.write(
    indexPath,
    replaceIndexStatus(indexText, planFolder, status)
  );
  return [];
};
