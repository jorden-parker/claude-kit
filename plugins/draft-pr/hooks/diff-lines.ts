export type DiffSide = "LEFT" | "RIGHT";

export type DiffLine = {
  marker: "+" | "-" | " ";
  leftNumber: number | undefined;
  rightNumber: number | undefined;
  hunkIndex: number;
  text: string;
};

export type FileDiff = { path: string; lines: DiffLine[] };

export type CommentPosition = {
  path: string;
  side: DiffSide;
  line: number;
  startLine?: number;
};

const CONTEXT_LINES_BEFORE = 4;
const FILE_START_PREFIX = "diff --git ";
const OLD_PATH_PATTERN = /^--- (?:a\/)?(.*?)\t?$/;
const NEW_PATH_PATTERN = /^\+\+\+ (?:b\/)?(.*?)\t?$/;
const ABSENT_FILE_PATH = "/dev/null";
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

type HunkProgress = {
  nextLeftNumber: number;
  nextRightNumber: number;
  remainingLeftLines: number;
  remainingRightLines: number;
};

type DiffReading = {
  fileDiffs: FileDiff[];
  oldPath: string;
  hunkCount: number;
  hunkProgress: HunkProgress | undefined;
};

const readLineCount = (lineCountText: string | undefined) =>
  lineCountText === undefined ? 1 : Number(lineCountText);

const startHunk = (headerMatch: RegExpExecArray): HunkProgress => ({
  nextLeftNumber: Number(headerMatch[1]),
  remainingLeftLines: readLineCount(headerMatch[2]),
  nextRightNumber: Number(headerMatch[3]),
  remainingRightLines: readLineCount(headerMatch[4]),
});

const isHunkOpen = (
  hunkProgress: HunkProgress | undefined
): hunkProgress is HunkProgress =>
  hunkProgress !== undefined &&
  (hunkProgress.remainingLeftLines > 0 || hunkProgress.remainingRightLines > 0);

const readHunkLine = (
  hunkProgress: HunkProgress,
  hunkIndex: number,
  line: string
): DiffLine | undefined => {
  const marker = line[0] ?? " ";
  const text = line.slice(1);
  if (marker === "+") {
    hunkProgress.remainingRightLines--;
    return {
      marker,
      leftNumber: undefined,
      rightNumber: hunkProgress.nextRightNumber++,
      hunkIndex,
      text,
    };
  }
  if (marker === "-") {
    hunkProgress.remainingLeftLines--;
    return {
      marker,
      leftNumber: hunkProgress.nextLeftNumber++,
      rightNumber: undefined,
      hunkIndex,
      text,
    };
  }
  if (marker !== " ") return undefined;
  hunkProgress.remainingLeftLines--;
  hunkProgress.remainingRightLines--;
  return {
    marker,
    leftNumber: hunkProgress.nextLeftNumber++,
    rightNumber: hunkProgress.nextRightNumber++,
    hunkIndex,
    text,
  };
};

const readHeaderLine = (diffReading: DiffReading, line: string) => {
  if (line.startsWith(FILE_START_PREFIX)) {
    diffReading.oldPath = "";
    diffReading.hunkCount = 0;
    return;
  }
  const oldPathMatch = OLD_PATH_PATTERN.exec(line);
  if (oldPathMatch) {
    diffReading.oldPath = oldPathMatch[1] ?? "";
    return;
  }
  const newPathMatch = NEW_PATH_PATTERN.exec(line);
  if (newPathMatch) {
    const newPath = newPathMatch[1] ?? "";
    diffReading.fileDiffs.push({
      path: newPath === ABSENT_FILE_PATH ? diffReading.oldPath : newPath,
      lines: [],
    });
    return;
  }
  const hunkHeaderMatch = HUNK_HEADER_PATTERN.exec(line);
  if (hunkHeaderMatch && diffReading.fileDiffs.length) {
    diffReading.hunkProgress = startHunk(hunkHeaderMatch);
    diffReading.hunkCount++;
  }
};

export const parseDiff = (diffText: string): FileDiff[] => {
  const diffReading: DiffReading = {
    fileDiffs: [],
    oldPath: "",
    hunkCount: 0,
    hunkProgress: undefined,
  };
  for (const line of diffText.split("\n")) {
    const { hunkProgress } = diffReading;
    if (!isHunkOpen(hunkProgress)) {
      readHeaderLine(diffReading, line);
      continue;
    }
    const diffLine = readHunkLine(
      hunkProgress,
      diffReading.hunkCount - 1,
      line
    );
    if (diffLine) diffReading.fileDiffs.at(-1)?.lines.push(diffLine);
  }
  return diffReading.fileDiffs;
};

const readSideNumber = (diffLine: DiffLine, side: DiffSide) =>
  side === "LEFT" ? diffLine.leftNumber : diffLine.rightNumber;

const findLineIndex = (
  fileDiff: FileDiff,
  side: DiffSide,
  lineNumber: number
) =>
  fileDiff.lines.findIndex(
    (diffLine) => readSideNumber(diffLine, side) === lineNumber
  );

export const readCommentContext = (
  fileDiffs: FileDiff[],
  { path, side, line, startLine }: CommentPosition
): DiffLine[] | undefined => {
  const fileDiff = fileDiffs.find((candidate) => candidate.path === path);
  if (!fileDiff) return undefined;
  const lastIndex = findLineIndex(fileDiff, side, line);
  const lastLine = fileDiff.lines[lastIndex];
  if (!lastLine) return undefined;
  const isSameHunk = (diffLine: DiffLine) =>
    diffLine.hunkIndex === lastLine.hunkIndex;
  if (startLine === undefined) {
    return fileDiff.lines
      .slice(Math.max(0, lastIndex - CONTEXT_LINES_BEFORE), lastIndex + 1)
      .filter(isSameHunk);
  }
  const firstIndex = findLineIndex(fileDiff, side, startLine);
  const firstLine = fileDiff.lines[firstIndex];
  if (!firstLine || !isSameHunk(firstLine) || firstIndex >= lastIndex) {
    return undefined;
  }
  return fileDiff.lines.slice(firstIndex, lastIndex + 1);
};
