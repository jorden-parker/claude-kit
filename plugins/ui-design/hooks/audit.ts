import type { NumberedGroup } from "./component-groups";
import {
  LITERAL_KINDS,
  findHardcodedValues,
  normalizeLiteral,
  type HardcodedValue,
  type LiteralKind,
} from "./hardcoded-values";
import { readFields } from "./input";
import {
  readTokenSource,
  readTokenVariable,
  type Theme,
  type ThemeToken,
} from "./theme";

export const AUDIT_CATEGORIES = [
  "hardcoded",
  "typography",
  "components",
  "theme",
  "accessibility",
] as const;

export const AUDIT_SEVERITIES = ["error", "warning", "note"] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export type AuditFinding = {
  category: AuditCategory;
  severity: AuditSeverity;
  title: string;
  detail: string;
  fix: string;
  file?: string;
  lines: number[];
  value?: string;
};

export type NumberedFinding = AuditFinding & { number: number };

type FindingIdentity = Pick<AuditFinding, "category" | "title" | "file">;

export type AuditProgress = {
  previousAudit: string;
  fixed: number;
  new: number;
};

export type Audit = {
  project: string;
  files: string[];
  theme: Theme;
  componentGroups: NumberedGroup[];
  findings: NumberedFinding[];
  progress?: AuditProgress;
};

export type SourceFile = { path: string; text: string };

const MINIMUM_CONTRAST = 4.5;
const AUDIT_JSON_NAME = /^audit-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?\.json$/;
const FOREGROUND_SUFFIX = "-foreground";
const SOLID_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const LITERAL_LABELS: Record<LiteralKind, string> = {
  color: "color",
  font: "font",
  "text-size": "font size",
  space: "spacing",
};

const stripLeadingDot = (filePath: string) => filePath.replace(/^\.\//, "");

const readTokenPlace = (token: ThemeToken) => {
  const tokenSource = readTokenSource(token.source);
  return tokenSource
    ? { file: tokenSource.path, lines: [tokenSource.line] }
    : { lines: [] };
};

const hasValue = (token: ThemeToken, normalizedValue: string) =>
  [token.value, token.darkValue ?? ""].some(
    (tokenValue) => normalizeLiteral(tokenValue) === normalizedValue
  );

const joinNames = (names: string[], lastJoiner = "and") =>
  `${names.slice(0, -1).join(", ")} ${lastJoiner} ${names.at(-1)}`;

const describeTokenUse = (token: ThemeToken) =>
  `${token.name} (${readTokenVariable(token.name)})`;

const adviseOnTokens = (label: string, matchingTokens: ThemeToken[]) => {
  const [firstToken, ...otherTokens] = matchingTokens;
  if (!firstToken)
    return {
      severity: "warning" as const,
      detail: `No ${label} token has this value.`,
      fix: `Add a ${label} token for it, or use the nearest existing one.`,
    };
  return otherTokens.length
    ? {
        severity: "error" as const,
        detail: `It has the same value as the ${joinNames(matchingTokens.map((token) => token.name))} tokens.`,
        fix: `Use the one that fits its role: ${joinNames(matchingTokens.map(describeTokenUse), "or")}.`,
      }
    : {
        severity: "error" as const,
        detail: `It has the same value as the ${firstToken.name} token.`,
        fix: `Use the ${firstToken.name} token (${readTokenVariable(firstToken.name)}).`,
      };
};

const describeHardcodedValue =
  (theme: Theme, filePath: string) =>
  ({ kind, value, lines }: HardcodedValue): AuditFinding => ({
    category: "hardcoded",
    title: `Hardcoded ${LITERAL_LABELS[kind]} ${value}`,
    ...adviseOnTokens(
      LITERAL_LABELS[kind],
      theme.tokens.filter(
        (token) =>
          token.kind === kind && hasValue(token, normalizeLiteral(value))
      )
    ),
    file: filePath,
    lines,
    value,
  });

const findHardcodedFindings = (theme: Theme, sourceFiles: SourceFile[]) => {
  const themeFilePaths = new Set(
    theme.tokens.map((token) => readTokenSource(token.source)?.path)
  );
  const searchedKinds = LITERAL_KINDS.filter(
    (kind) =>
      kind !== "space" || theme.tokens.some((token) => token.kind === "space")
  );
  return sourceFiles
    .filter(
      (sourceFile) => !themeFilePaths.has(stripLeadingDot(sourceFile.path))
    )
    .flatMap((sourceFile) =>
      findHardcodedValues(sourceFile.text, searchedKinds).map(
        describeHardcodedValue(theme, sourceFile.path)
      )
    );
};

const readValueKey = (token: ThemeToken) =>
  `${token.kind} ${normalizeLiteral(token.value)} ${normalizeLiteral(token.darkValue ?? "")}`;

const findSharedValues = (tokens: ThemeToken[]): AuditFinding[] =>
  tokens.flatMap((token) => {
    const sharingTokens = tokens.filter(
      (otherToken) => readValueKey(otherToken) === readValueKey(token)
    );
    return sharingTokens.length > 1 && sharingTokens[0] === token
      ? [
          {
            category: "theme",
            severity: "warning",
            title: `${joinNames(sharingTokens.map((sharingToken) => sharingToken.name))} share the value ${token.value}`,
            detail:
              "Tokens with one value drift apart when only one is changed.",
            fix: "Keep one token, or make the others refer to it.",
            ...readTokenPlace(token),
            value: token.value,
          },
        ]
      : [];
  });

const findMissingDarkValues = (tokens: ThemeToken[]): AuditFinding[] => {
  const kindsWithDarkValues = new Set(
    tokens.filter((token) => token.darkValue).map((token) => token.kind)
  );
  return tokens
    .filter((token) => !token.darkValue && kindsWithDarkValues.has(token.kind))
    .map((token) => ({
      category: "theme",
      severity: "warning",
      title: `${token.name} has no dark value`,
      detail: `Other ${token.kind} tokens change in dark mode.`,
      fix: "Give it a dark value, or confirm it is the same in both modes.",
      ...readTokenPlace(token),
    }));
};

const readLuminance = (hexColor: string) => {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((channelStart) => {
    const channel =
      parseInt(
        normalizeLiteral(hexColor).slice(channelStart, channelStart + 2),
        16
      ) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const readContrast = (firstColor: string, secondColor: string) => {
  const luminances = [readLuminance(firstColor), readLuminance(secondColor)];
  return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
};

const readBackgroundName = (foregroundName: string) =>
  foregroundName === "foreground"
    ? "background"
    : foregroundName.endsWith(FOREGROUND_SUFFIX)
      ? foregroundName.slice(0, -FOREGROUND_SUFFIX.length)
      : undefined;

const listColorPairs = (foreground: ThemeToken, background: ThemeToken) => [
  { mode: "light", text: foreground.value, surface: background.value },
  ...(foreground.darkValue || background.darkValue
    ? [
        {
          mode: "dark",
          text: foreground.darkValue ?? foreground.value,
          surface: background.darkValue ?? background.value,
        },
      ]
    : []),
];

const findLowContrastPairs = (tokens: ThemeToken[]): AuditFinding[] => {
  const colorTokens = tokens.filter((token) => token.kind === "color");
  return colorTokens.flatMap((foreground) => {
    const background = colorTokens.find(
      (token) => token.name === readBackgroundName(foreground.name)
    );
    return (background ? listColorPairs(foreground, background) : [])
      .filter(
        ({ text, surface }) => SOLID_HEX.test(text) && SOLID_HEX.test(surface)
      )
      .map((colorPair) => ({
        ...colorPair,
        contrast: readContrast(colorPair.text, colorPair.surface),
      }))
      .filter(({ contrast }) => contrast < MINIMUM_CONTRAST)
      .map(({ mode, contrast }) => ({
        category: "accessibility" as const,
        severity: "error" as const,
        title: `${foreground.name} on ${background?.name} is ${contrast.toFixed(2)}:1 in ${mode} mode`,
        detail: `WCAG AA asks for ${MINIMUM_CONTRAST}:1 for body text. Large text (24px, or 18.66px bold) needs only 3:1, so a pair used only for large text may stay at 3:1.`,
        fix: `Change one of the two until the pair reaches ${MINIMUM_CONTRAST}:1.`,
        ...readTokenPlace(foreground),
      }));
  });
};

export const auditProject = (
  theme: Theme,
  sourceFiles: SourceFile[]
): AuditFinding[] => [
  ...findHardcodedFindings(theme, sourceFiles),
  ...findSharedValues(theme.tokens),
  ...findMissingDarkValues(theme.tokens),
  ...findLowContrastPairs(theme.tokens),
];

export const numberFindings = (
  findings: AuditFinding[],
  numbersTaken = 0
): NumberedFinding[] =>
  findings
    .toSorted(
      (first, second) =>
        AUDIT_CATEGORIES.indexOf(first.category) -
          AUDIT_CATEGORIES.indexOf(second.category) ||
        AUDIT_SEVERITIES.indexOf(first.severity) -
          AUDIT_SEVERITIES.indexOf(second.severity)
    )
    .map((finding, findingIndex) => ({
      ...finding,
      number: numbersTaken + findingIndex + 1,
    }));

export const countFindings = <Key extends string>(
  keys: readonly Key[],
  findings: AuditFinding[],
  readKey: (finding: AuditFinding) => Key
) =>
  keys
    .map((key) => ({
      key,
      count: findings.filter((finding) => readKey(finding) === key).length,
    }))
    .filter(({ count }) => count);

const describeCategoryCounts = (findings: AuditFinding[]) => {
  if (!findings.length) return "No findings.";
  const categoryCounts = countFindings(
    AUDIT_CATEGORIES,
    findings,
    (finding) => finding.category
  ).map(({ key, count }) => `${count} ${key}`);
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${categoryCounts.join(", ")}.`;
};

export const describeFindingCounts = (
  findings: AuditFinding[],
  groupCount = 0
) =>
  `${describeCategoryCounts(findings)}${groupCount ? ` ${groupCount} component group${groupCount === 1 ? "" : "s"}.` : ""}`;

const readFindingKey = ({ category, title, file }: FindingIdentity) =>
  JSON.stringify([category, title, file ?? ""]);

const filterUnseenFindings = (
  findings: FindingIdentity[],
  otherFindings: FindingIdentity[]
) => {
  const otherKeys = new Set(otherFindings.map(readFindingKey));
  return findings.filter((finding) => !otherKeys.has(readFindingKey(finding)));
};

export const compareFindings = (
  previousFindings: FindingIdentity[],
  currentFindings: FindingIdentity[]
) => ({
  fixed: filterUnseenFindings(previousFindings, currentFindings).length,
  new: filterUnseenFindings(currentFindings, previousFindings).length,
});

export const pickPreviousAuditName = (
  fileNames: string[],
  currentName: string
) =>
  fileNames
    .filter(
      (fileName) => AUDIT_JSON_NAME.test(fileName) && fileName !== currentName
    )
    .toSorted()
    .at(-1);

const isFindingIdentity = (value: unknown): value is FindingIdentity => {
  const fields = readFields(value);
  return (
    typeof fields.category === "string" &&
    typeof fields.title === "string" &&
    (fields.file === undefined || typeof fields.file === "string")
  );
};

export const readPreviousFindings = (
  savedText: string | undefined
): FindingIdentity[] | undefined => {
  if (savedText === undefined) return undefined;
  try {
    const { findings } = readFields(JSON.parse(savedText));
    return Array.isArray(findings) && findings.every(isFindingIdentity)
      ? findings
      : undefined;
  } catch {
    return undefined;
  }
};

export const describeProgress = (progress?: AuditProgress) =>
  progress
    ? `Since the last audit: ${progress.fixed} fixed, ${progress.new} new.`
    : "";
