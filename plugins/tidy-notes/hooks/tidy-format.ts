type Line = { text: string; isFenced: boolean; isProtected: boolean };
type FrontMatterSplit = { fields: string[] | null; body: string[] };
type TidyResult = { text: string; problems: string[] };

const KEY_ORDERS: Record<string, string[]> = {
  handoffs: ["title", "project", "created", "cwd", "focus"],
  "project-notes": ["title", "project", "created", "category", "source"],
};
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const TOP_HEADING = /^ {0,3}#(\s|$)/;
const THEMATIC_BREAK = /^\s*([*+-])(\s*\1){2,}\s*$/;
const STAR_OR_PLUS_BULLET = /^(\s*)[*+] /;
const SINGLE_LINE_FIELD = /^([A-Za-z0-9_-]+):( .*)?$/;
const BLOCK_SCALAR = /^[|>][+-]?$/;
const FRONT_MATTER_KEY = /^[A-Za-z_][\w-]*:/;
const INDENTED_CODE = /^( {4}|\t)/;
const HTML_BLOCK_START = /^ {0,3}<(pre|script|style|textarea|!--)/i;
const HTML_BLOCK_END: Record<string, string> = {
  pre: "</pre>",
  script: "</script>",
  style: "</style>",
  textarea: "</textarea>",
  "!--": "-->",
};
const HARD_BREAK = / {2,}$/;
const FILE_NAME = /^[a-z0-9]+([.-][a-z0-9]+)*\.md$/;
const GENERATED_INDEX = "index.md";
const HEADED_STORES = ["handoffs", "project-notes", "small-plans"];

const isBlank = (text: string) => text.trim() === "";

const classifyLines = (bodyLines: string[]): Line[] => {
  let openFence = "";
  let htmlEnd = "";
  return bodyLines.map((text) => {
    if (openFence) {
      const closer = FENCE_OPENER.exec(text)?.[1] ?? "";
      const isCloser =
        closer[0] === openFence[0] &&
        closer.length >= openFence.length &&
        text.trim() === closer;
      if (isCloser) openFence = "";
      return { text, isFenced: true, isProtected: true };
    }
    if (htmlEnd) {
      if (text.toLowerCase().includes(htmlEnd)) htmlEnd = "";
      return { text, isFenced: false, isProtected: true };
    }
    const opener = FENCE_OPENER.exec(text)?.[1] ?? "";
    if (opener) {
      openFence = opener;
      return { text, isFenced: true, isProtected: true };
    }
    const htmlTag = HTML_BLOCK_START.exec(text);
    if (htmlTag) {
      const ending = HTML_BLOCK_END[htmlTag[1]!.toLowerCase()]!;
      const rest = text.slice(htmlTag[0].length).toLowerCase();
      if (!rest.includes(ending)) htmlEnd = ending;
      return { text, isFenced: false, isProtected: true };
    }
    return {
      text,
      isFenced: false,
      isProtected: !isBlank(text) && INDENTED_CODE.test(text),
    };
  });
};

const isSimpleFieldList = (fields: string[]) =>
  fields.every((field) => {
    const match = SINGLE_LINE_FIELD.exec(field.trimEnd());
    return Boolean(match) && !BLOCK_SCALAR.test((match![2] ?? "").trim());
  });

const arrangeFields = (fields: string[], storeName: string) => {
  const nonBlankFields = fields.filter((field) => !isBlank(field));
  if (!isSimpleFieldList(nonBlankFields)) return fields;
  const trimmedFields = nonBlankFields.map((field) => field.trimEnd());
  const order = KEY_ORDERS[storeName];
  if (!order) return trimmedFields;
  const rank = (field: string) => {
    const position = order.indexOf(SINGLE_LINE_FIELD.exec(field)?.[1] ?? "");
    return position === -1 ? order.length : position;
  };
  return trimmedFields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => rank(a.field) - rank(b.field) || a.index - b.index)
    .map(({ field }) => field);
};

const splitFrontMatter = (allLines: string[]): FrontMatterSplit => {
  const firstIndex = allLines.findIndex((line) => !isBlank(line));
  const lines = firstIndex === -1 ? [] : allLines.slice(firstIndex);
  const closingIndex =
    lines[0]?.trimEnd() === "---" && FRONT_MATTER_KEY.test(lines[1] ?? "")
      ? lines.findIndex((line, index) => index > 1 && line.trimEnd() === "---")
      : -1;
  return closingIndex === -1
    ? { fields: null, body: lines }
    : {
        fields: lines.slice(1, closingIndex),
        body: lines.slice(closingIndex + 1),
      };
};

const blankLine = (): Line => ({
  text: "",
  isFenced: false,
  isProtected: false,
});

const normalizeBullet = (line: Line): Line =>
  line.isProtected || THEMATIC_BREAK.test(line.text)
    ? line
    : { ...line, text: line.text.replace(STAR_OR_PLUS_BULLET, "$1- ") };

const isBlankLine = (line: Line) => !line.isProtected && isBlank(line.text);

const isHeadingLine = (line: Line) =>
  !line.isProtected && HEADING.test(line.text);

const hasBlankBoundary = (
  pendingBlanks: Line[],
  isAfterHeading: boolean,
  isHeading: boolean
) => pendingBlanks.length > 0 || isAfterHeading || isHeading;

const keepsBlanks = (previous: Line, line: Line, pendingBlanks: Line[]) =>
  previous.isProtected && line.isProtected && pendingBlanks.length > 0;

const chooseSeparator = (
  previous: Line | undefined,
  line: Line,
  pendingBlanks: Line[],
  needsBlank: boolean
): Line[] => {
  if (!previous || !needsBlank) return [];
  return keepsBlanks(previous, line, pendingBlanks)
    ? pendingBlanks
    : [blankLine()];
};

const arrangeBody = (bodyLines: string[]) => {
  const arranged: Line[] = [];
  let pendingBlanks: Line[] = [];
  let isAfterHeading = false;
  for (const line of classifyLines(bodyLines)) {
    if (isBlankLine(line)) {
      pendingBlanks.push({ ...line, isProtected: true });
      continue;
    }
    const isHeading = isHeadingLine(line);
    arranged.push(
      ...chooseSeparator(
        arranged[arranged.length - 1],
        line,
        pendingBlanks,
        hasBlankBoundary(pendingBlanks, isAfterHeading, isHeading)
      ),
      normalizeBullet(line)
    );
    pendingBlanks = [];
    isAfterHeading = isHeading;
  }
  return arranged;
};

const trimTrailingSpace = (arranged: Line[]) =>
  arranged.map((line, index) => {
    if (line.isProtected) return line.text;
    const nextLine = arranged[index + 1];
    const isHardBreak =
      HARD_BREAK.test(line.text) &&
      Boolean(nextLine) &&
      !isBlank(nextLine!.text);
    return line.text.trimEnd() + (isHardBreak ? "  " : "");
  });

const findNameProblems = (fileName: string) =>
  FILE_NAME.test(fileName)
    ? []
    : [`file name does not match ${FILE_NAME.source}`];

export const isContentPreserved = (before: string, after: string) => {
  const toLines = (lines: string[]) =>
    lines
      .map((line) => line.trimEnd().replace(/^(\s*)[*+] /, "$1- "))
      .filter((line) => line !== "");
  const toParts = (text: string) => {
    const { fields, body } = splitFrontMatter(text.split(/\r\n|\r|\n/));
    return {
      fields: toLines(fields ?? [])
        .sort()
        .join("\n"),
      body: toLines(body).join("\n"),
    };
  };
  const beforeParts = toParts(before);
  const afterParts = toParts(after);
  return (
    beforeParts.fields === afterParts.fields &&
    beforeParts.body === afterParts.body
  );
};

const findStructureProblems = (
  storeName: string,
  fileName: string,
  hasFrontMatter: boolean,
  headingCount: number
) => {
  if (storeName === "brainstorm")
    return [
      ...(hasFrontMatter ? ["has front matter"] : []),
      ...(headingCount === 1 ? [] : [`expected one H1, found ${headingCount}`]),
    ];
  if (!HEADED_STORES.includes(storeName) || fileName === GENERATED_INDEX)
    return [];
  return [
    ...(hasFrontMatter ? [] : ["missing front matter"]),
    ...(headingCount
      ? ["H1 in the body, the title belongs in front matter"]
      : []),
  ];
};

export const tidyNote = (
  text: string,
  storeName: string,
  fileName = ""
): TidyResult => {
  const { fields, body } = splitFrontMatter(
    text
      .replace(/\r\n?/g, "\n")
      .replace(/(\n[ \t]*)+$/, "")
      .split("\n")
  );
  const hasFrontMatter = fields !== null;
  const arranged = arrangeBody(body);
  const bodyText = trimTrailingSpace(arranged);
  const frontMatterText = hasFrontMatter
    ? ["---", ...arrangeFields(fields, storeName), "---"]
    : [];
  const sections = [frontMatterText, bodyText].filter(
    (section) => section.length
  );
  const tidied = sections.map((section) => section.join("\n")).join("\n\n");

  const prose = arranged.filter((line) => !line.isProtected);
  const headingCount = prose.filter((line) =>
    TOP_HEADING.test(line.text)
  ).length;
  const hasTab = [
    ...(fields ?? []),
    ...arranged.filter((line) => !line.isFenced).map((line) => line.text),
  ].some((line) => line.includes("\t"));
  return {
    text: tidied ? `${tidied}\n` : "",
    problems: [
      ...(fileName ? findNameProblems(fileName) : []),
      ...findStructureProblems(
        storeName,
        fileName,
        hasFrontMatter,
        headingCount
      ),
      ...(hasTab ? ["tab character outside fenced code"] : []),
    ],
  };
};
