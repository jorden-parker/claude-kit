import {
  listProblemUnless,
  listUnknownValue,
  readFields,
  readList,
  readText,
  readTextList,
} from "./input";

export const TOKEN_KINDS = [
  "color",
  "font",
  "text-size",
  "space",
  "radius",
  "shadow",
] as const;

export type TokenKind = (typeof TOKEN_KINDS)[number];

export type ThemeToken = {
  name: string;
  kind: TokenKind;
  value: string;
  darkValue?: string;
  source: string;
  isInferred: boolean;
};

export type ThemeStack = {
  framework: string;
  styling: string;
  darkMode: string;
  iconSet: string;
};

export type ThemeComponent = {
  name: string;
  path: string;
  variants: string[];
};

export type Theme = {
  tokens: ThemeToken[];
  stack: ThemeStack;
  components: ThemeComponent[];
  inconsistencies: string[];
};

export const readTokenVariable = (tokenName: string) =>
  `--${tokenName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;

const renderDeclaration = (tokenName: string, tokenValue: string) =>
  `${readTokenVariable(tokenName)}:${tokenValue.replace(/[;{}<>]/g, "").trim()}`;

export const hasDarkValues = (tokens: ThemeToken[]) =>
  tokens.some((token) => token.darkValue);

export const renderThemeCss = (tokens: ThemeToken[]) => {
  const lightBlock = `:root{${tokens.map((token) => renderDeclaration(token.name, token.value)).join(";")}}`;
  const darkDeclarations = tokens.flatMap((token) =>
    token.darkValue ? [renderDeclaration(token.name, token.darkValue)] : []
  );
  return darkDeclarations.length
    ? `${lightBlock}:root[data-theme="dark"]{color-scheme:dark;${darkDeclarations.join(";")}}`
    : lightBlock;
};

const SOURCE_PATTERN = /^(.+):(\d+)$/;
const PROPOSED_SOURCE = "proposed";

export const readTokenSource = (source: string) => {
  const [, path = "", line = ""] = SOURCE_PATTERN.exec(source.trim()) ?? [];
  return path
    ? { path: path.replace(/^\.\//, ""), line: Number(line) }
    : undefined;
};

const readToken = (
  rawToken: unknown,
  tokenIndex: number,
  needsSource: boolean
) => {
  const fields = readFields(rawToken);
  const name = readText(fields.name);
  const value = readText(fields.value);
  const kind = readText(fields.kind) as TokenKind;
  const darkValue = readText(fields.darkValue);
  const source = needsSource ? readText(fields.source) : PROPOSED_SOURCE;
  const label = name ? `Token "${name}"` : `Token ${tokenIndex + 1}`;
  const problems = [
    ...listProblemUnless(name && value, "needs a name and a value."),
    ...listUnknownValue("kind", kind, TOKEN_KINDS),
    ...listProblemUnless(
      !needsSource || readTokenSource(source),
      `source "${source}" must be path:line, such as src/app/globals.css:12.`
    ),
  ].map((problem) => `${label}: ${problem}`);
  const token: ThemeToken = {
    name,
    kind,
    value,
    ...(darkValue ? { darkValue } : {}),
    source,
    isInferred: fields.isInferred === true,
  };
  return { token, problems };
};

export const readTokens = (rawTokens: unknown, needsSource: boolean) => {
  const readings = readList(rawTokens).map((rawToken, tokenIndex) =>
    readToken(rawToken, tokenIndex, needsSource)
  );
  return {
    tokens: readings.map((reading) => reading.token),
    problems: readings.flatMap((reading) => reading.problems),
  };
};

const readComponent = (rawComponent: unknown): ThemeComponent => {
  const fields = readFields(rawComponent);
  return {
    name: readText(fields.name),
    path: readText(fields.path),
    variants: readTextList(fields.variants),
  };
};

export const readTheme = (rawTheme: unknown) => {
  const fields = readFields(rawTheme);
  const stack = readFields(fields.stack);
  const { tokens, problems } = readTokens(fields.tokens, true);
  const theme: Theme = {
    tokens,
    stack: {
      framework: readText(stack.framework),
      styling: readText(stack.styling),
      darkMode: readText(stack.darkMode),
      iconSet: readText(stack.iconSet),
    },
    components: readList(fields.components)
      .map(readComponent)
      .filter((component) => component.name),
    inconsistencies: readTextList(fields.inconsistencies),
  };
  return {
    theme,
    problems: tokens.length
      ? problems
      : ["The theme needs at least one token."],
  };
};
