export const LITERAL_KINDS = ["color", "font", "text-size", "space"] as const;

export type LiteralKind = (typeof LITERAL_KINDS)[number];

export type HardcodedValue = {
  kind: LiteralKind;
  value: string;
  lines: number[];
};

const COLOR_LITERAL =
  /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)/gi;
const FONT_FAMILY =
  /(?<![\w-])font-family\s*:\s*([^;}<>]+)|\bfontFamily\s*:\s*(["'`])(.*?)\2/g;
const FONT_SIZE =
  /(?<![\w-])font-size\s*:\s*([^;}<>]+)|\bfontSize\s*:\s*([^;},<>]+)/g;
const SPACING_DECLARATION =
  /(?<![\w-])(?:margin|padding|inset|gap|row-gap|column-gap|rowGap|columnGap)(?:-[a-z-]+|[A-Z][a-zA-Z]*)?\s*:\s*([^;},<>]+)/g;
const ARBITRARY_VALUE =
  /(?<![\w-])-?(text|font|p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left)-\[([^\]\s]+)\]/g;
const SPACING_LITERAL = /(?<![\w.])\d*\.?\d+(?:px|rem)\b/g;
const WHOLE_SPACING_LITERAL = /^\d*\.?\d+(?:px|rem)$/;
const ABSOLUTE_SIZE = /\d(?:px|rem|pt)\b|^\d*\.?\d+$/;
const CSS_WIDE_KEYWORD = /^(?:inherit|initial|unset|revert)$/i;
const WHOLE_NUMBER = /^\d+$/;
const QUOTES = /["'`]/g;

const hasVariable = (value: string) => value.includes("var(--");

const stripQuotes = (value: string) => value.replace(QUOTES, "").trim();

const dropUnmatchedQuote = (value: string) =>
  ['"', "'"].reduce(
    (trimmedValue, quote) =>
      trimmedValue.split(quote).length % 2
        ? trimmedValue
        : trimmedValue.slice(0, trimmedValue.lastIndexOf(quote)),
    value
  );

const readDeclaredValues = (line: string, declaration: RegExp) =>
  [...line.matchAll(declaration)]
    .map((match) => match.slice(1).filter(Boolean).at(-1) ?? "")
    .filter((declaredValue) => !hasVariable(declaredValue));

const readArbitraryValues = (line: string, utility: RegExp) =>
  [...line.matchAll(ARBITRARY_VALUE)]
    .filter((match) => utility.test(match[1] ?? ""))
    .map((match) => stripQuotes((match[2] ?? "").replaceAll("_", " ")))
    .filter((arbitraryValue) => !hasVariable(arbitraryValue));

const FINDERS: Record<LiteralKind, (line: string) => string[]> = {
  color: (line) => line.match(COLOR_LITERAL) ?? [],
  font: (line) => [
    ...readDeclaredValues(line, FONT_FAMILY)
      .map((family) => dropUnmatchedQuote(family).trim())
      .filter((family) => !CSS_WIDE_KEYWORD.test(family)),
    ...readArbitraryValues(line, /^font$/).filter(
      (family) => !WHOLE_NUMBER.test(family)
    ),
  ],
  "text-size": (line) =>
    [
      ...readDeclaredValues(line, FONT_SIZE).map(stripQuotes),
      ...readArbitraryValues(line, /^text$/),
    ].filter((size) => ABSOLUTE_SIZE.test(size)),
  space: (line) => [
    ...readDeclaredValues(line, SPACING_DECLARATION).flatMap(
      (spacing) => spacing.match(SPACING_LITERAL) ?? []
    ),
    ...readArbitraryValues(line, /^(?!text$|font$)/).filter((spacing) =>
      WHOLE_SPACING_LITERAL.test(spacing)
    ),
  ],
};

export const normalizeLiteral = (value: string) =>
  value
    .toLowerCase()
    .replace(QUOTES, "")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^#[0-9a-f]{3,4}$/,
      (shortHex) =>
        `#${[...shortHex.slice(1)].map((digit) => digit + digit).join("")}`
    );

export const findHardcodedValues = (
  sourceText: string,
  wantedKinds: readonly LiteralKind[] = LITERAL_KINDS
) => {
  const uses = sourceText.split("\n").flatMap((line, lineIndex) =>
    wantedKinds.flatMap((kind) =>
      FINDERS[kind](line).map((value) => ({
        kind,
        value,
        lineNumber: lineIndex + 1,
      }))
    )
  );
  const valuesByKey = new Map<string, HardcodedValue>();
  for (const { kind, value, lineNumber } of uses) {
    const key = `${kind} ${normalizeLiteral(value)}`;
    const foundValue = valuesByKey.get(key) ?? { kind, value, lines: [] };
    valuesByKey.set(key, {
      ...foundValue,
      lines: [...new Set([...foundValue.lines, lineNumber])],
    });
  }
  return [...valuesByKey.values()];
};
