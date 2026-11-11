export const COMMENT_LABELS = {
  praise: "Highlights something positive. Sincere, never backhanded.",
  nitpick: "A trivial, preference-based request. Non-blocking by nature.",
  suggestion: "Proposes an improvement. Says what to change and why.",
  issue: "A specific problem with the change. Pair it with a suggestion.",
  todo: "A small, necessary change before the PR can be accepted.",
  question: "A possible concern you are not sure is relevant. Asks.",
  thought: "An idea that came up in review. Non-blocking by nature.",
  chore: "A simple task the process requires before acceptance.",
  note: "Something the reader should take note of. Non-blocking.",
  typo: "A todo whose problem is a misspelling.",
  polish: "A suggestion where nothing is wrong, but quality can rise.",
  quibble: "A nitpick, by a name that does not suggest lice.",
} as const;

export type CommentLabel = keyof typeof COMMENT_LABELS;

export const COMMENT_LABEL_NAMES = Object.keys(
  COMMENT_LABELS
) as CommentLabel[];

const STANDARD_DECORATIONS = {
  "non-blocking": "Should not stop the PR from being accepted.",
  blocking: "Must be resolved before the PR is accepted.",
  "if-minor": "Resolve it only if the change turns out to be small.",
} as const;

export const STANDARD_DECORATION_NAMES = Object.keys(STANDARD_DECORATIONS);

export type ConventionalComment = {
  label: CommentLabel;
  decorations: string[];
  subject: string;
  discussion: string;
};

type CommentReading = {
  comment: ConventionalComment | undefined;
  problems: string[];
};

const DECORATION_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const describeDecorations = (decorations: string[]) =>
  decorations.length ? ` (${decorations.join(", ")})` : "";

export const formatConventionalComment = ({
  label,
  decorations,
  subject,
  discussion,
}: ConventionalComment) => {
  const subjectLine = `**${label}${describeDecorations(decorations)}:** ${subject}`;
  return discussion ? `${subjectLine}\n\n${discussion}` : subjectLine;
};

const findDecorationProblems = (decorations: string[]) => {
  const hasClashingDecorations =
    decorations.includes("blocking") && decorations.includes("non-blocking");
  const malformedDecorationProblems = decorations
    .filter((decoration) => !DECORATION_PATTERN.test(decoration))
    .map(
      (decoration) =>
        `decoration "${decoration}" must be lowercase words joined by hyphens`
    );
  return [
    ...(hasClashingDecorations
      ? ["decorations hold both blocking and non-blocking"]
      : []),
    ...malformedDecorationProblems,
  ];
};

export const readConventionalComment = (
  rawComment: unknown
): CommentReading => {
  const fields =
    typeof rawComment === "object" && rawComment !== null
      ? (rawComment as Record<string, unknown>)
      : {};
  const requestedLabel = readText(fields.label);
  const label = COMMENT_LABEL_NAMES.find(
    (labelName) => labelName === requestedLabel.toLowerCase()
  );
  const subject = readText(fields.subject);
  const decorations = Array.isArray(fields.decorations)
    ? fields.decorations.map(readText).filter(Boolean)
    : [];
  const problems = [
    ...(label
      ? []
      : [
          `label "${requestedLabel}" is not one of ${COMMENT_LABEL_NAMES.join(", ")}`,
        ]),
    ...(subject ? [] : ["subject is empty"]),
    ...findDecorationProblems(decorations),
  ];
  if (!label || problems.length) return { comment: undefined, problems };
  return {
    comment: {
      label,
      decorations,
      subject,
      discussion: readText(fields.discussion),
    },
    problems,
  };
};
