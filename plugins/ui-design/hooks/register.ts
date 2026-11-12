import type { EngineInterface, Register } from "claude-code";
import {
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
  auditProject,
  compareFindings,
  describeFindingCounts,
  describeProgress,
  numberFindings,
  pickPreviousAuditName,
  readPreviousFindings,
  type Audit,
  type AuditCategory,
  type AuditFinding,
  type AuditProgress,
  type AuditSeverity,
} from "./audit";
import { renderAuditPage } from "./audit-page";
import {
  DISCREPANCY_ASPECTS,
  checkComponentGroups,
  readComponentGroups,
} from "./component-groups";
import {
  MAX_NEW_TOKENS,
  readVariantLetter,
  renderDesignPage,
  type Design,
  type DesignMode,
  type DesignVariant,
} from "./design-page";
import {
  listMarkupProblems,
  listNewTokenProblems,
  listRawCssProblems,
} from "./mockup-checks";
import {
  listProblemUnless,
  listUnknownValue,
  readFields,
  readList,
  readText,
  readTextList,
} from "./input";
import {
  TOKEN_KINDS,
  readTheme,
  readTokenSource,
  readTokens,
  type ThemeToken,
} from "./theme";

const DESIGN_FOLDER = ".claude/ui-design";
const THEME_FILE_NAME = "theme.json";
const THEME_TOOL_NAME = "save_design_theme";
const DESIGN_TOOL_NAME = "render_design";
const AUDIT_TOOL_NAME = "render_design_audit";
const QUALIFIED_THEME_TOOL_NAME = `mcp__ui-design__${THEME_TOOL_NAME}`;
const QUALIFIED_DESIGN_TOOL_NAME = `mcp__ui-design__${DESIGN_TOOL_NAME}`;
const QUALIFIED_AUDIT_TOOL_NAME = `mcp__ui-design__${AUDIT_TOOL_NAME}`;
const DESIGN_MODES: readonly DesignMode[] = ["redesign", "new"];
const DESIGN_COMMAND = "ui-design";
const DESIGN_SKILL = "ui-design:ui-design";
const DESIGN_COMMAND_PREFIXES = ["/ui-design ", "/ui-design:ui-design "];
const DESIGN_MODE_SUGGESTIONS = [
  {
    text: "new",
    description: "Mockups of a screen or component that does not exist yet",
  },
  {
    text: "redesign",
    description:
      "Mockups of new looks for an existing file, route or component",
  },
  {
    text: "audit",
    description: "Checks the theme, the components and their consistency",
  },
  {
    text: "apply",
    description: "Builds the picked variant of a saved design in project code",
  },
  { text: "fix", description: "Fixes numbered audit findings in project code" },
];
const MAX_VARIANTS = 4;

declare module "claude-code" {
  interface McpToolInputs {
    [QUALIFIED_THEME_TOOL_NAME]: Record<string, unknown>;
    [QUALIFIED_DESIGN_TOOL_NAME]: Record<string, unknown>;
    [QUALIFIED_AUDIT_TOOL_NAME]: Record<string, unknown>;
  }
}

const TOKEN_PROPERTIES = {
  name: {
    type: "string",
    description:
      "The token's name as the project spells it, such as primary or font-sans. Mockups use it as var(--name), in lowercase with every run of other characters turned into one dash.",
  },
  kind: { type: "string", enum: [...TOKEN_KINDS] },
  value: { type: "string", description: "The value in light mode." },
  darkValue: {
    type: "string",
    description: "The value in dark mode, when the project has one.",
  },
};

const THEME_TOOL_SCHEMA = {
  type: "object",
  properties: {
    tokens: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          ...TOKEN_PROPERTIES,
          source: {
            type: "string",
            description:
              "Where the token is declared, or most used when it is inferred, as path:line relative to the project. The token's name or its value must appear in that file.",
          },
          isInferred: {
            type: "boolean",
            description:
              "True when the project declares no such token and the value was taken from how the code uses it.",
          },
        },
        required: ["name", "kind", "value", "source"],
      },
    },
    stack: {
      type: "object",
      properties: {
        framework: { type: "string" },
        styling: {
          type: "string",
          description: "How styles are written, such as Tailwind v4.",
        },
        darkMode: {
          type: "string",
          description: "How dark mode is switched: class, media, or none.",
        },
        iconSet: { type: "string" },
      },
    },
    components: {
      type: "array",
      description: "The project's reusable UI components.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string", description: "Relative to the project." },
          variants: { type: "array", items: { type: "string" } },
        },
        required: ["name", "path"],
      },
    },
    inconsistencies: {
      type: "array",
      items: { type: "string" },
      description:
        "What the theme itself gets wrong, such as five near-identical grays. One sentence each.",
    },
  },
  required: ["tokens"],
};

const DESIGN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    project: { type: "string", description: "The project's name." },
    mode: {
      type: "string",
      enum: [...DESIGN_MODES],
      description:
        "redesign for new looks of UI that exists, new for UI that does not exist yet.",
    },
    subject: {
      type: "string",
      description:
        "For a redesign, the file, route or component being redesigned. For a new design, the brief in one sentence.",
    },
    variants: {
      type: "array",
      minItems: 1,
      maxItems: MAX_VARIANTS,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Two to four words." },
          rationale: {
            type: "string",
            description: "One or two sentences on what this variant is for.",
          },
          html: {
            type: "string",
            description:
              "The markup inside the mockup's body, with real content and no style element. Scripts do not run and nothing loads from the network. Inline style attributes and SVG color attributes such as fill and stroke take colors and fonts only as var(--token) or currentColor.",
          },
          css: {
            type: "string",
            description:
              "The mockup's CSS. Every theme token is already defined as a CSS variable, so colors and fonts are written only as var(--token), never as a literal.",
          },
          kept: {
            type: "array",
            items: { type: "string" },
            description:
              "Redesign only: what stays as it is, such as content, fields and actions.",
          },
          changed: {
            type: "array",
            items: { type: "string" },
            description:
              "Redesign only, at least one: what this variant changes.",
          },
          newTokens: {
            type: "array",
            maxItems: MAX_NEW_TOKENS,
            description:
              "Tokens this variant needs and the theme lacks. Shown as proposed additions.",
            items: {
              type: "object",
              properties: TOKEN_PROPERTIES,
              required: ["name", "kind", "value"],
            },
          },
          restyledTokens: {
            type: "array",
            description:
              "New values for the theme's own color and font tokens, used in this variant only. Its css still writes var(--token).",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "A color or font token the theme already has.",
                },
                value: { type: "string" },
                darkValue: { type: "string" },
              },
              required: ["name", "value"],
            },
          },
        },
        required: ["name", "rationale", "html", "css"],
      },
    },
  },
  required: ["project", "mode", "subject", "variants"],
};

const AUDIT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    project: { type: "string", description: "The project's name." },
    files: {
      type: "array",
      items: { type: "string" },
      description:
        "Every UI source file to scan for hardcoded values, relative to the project: components, pages and stylesheets.",
    },
    findings: {
      type: "array",
      description:
        "What reading the code found and a scan cannot: inconsistent text styles, components that differ without reason, theme gaps. Leave out hardcoded values, duplicate tokens, missing dark values and contrast: the tool finds those itself.",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...AUDIT_CATEGORIES] },
          severity: { type: "string", enum: [...AUDIT_SEVERITIES] },
          title: { type: "string", description: "Under 10 words." },
          detail: {
            type: "string",
            description: "What is inconsistent, with the values seen.",
          },
          fix: { type: "string", description: "One concrete change." },
          file: { type: "string", description: "Relative to the project." },
          line: { type: "integer" },
        },
        required: ["category", "severity", "title", "fix"],
      },
    },
    componentGroups: {
      type: "array",
      description:
        "Components that serve one purpose in different ways, such as two ways to filter a list. One group per purpose, each with the one component the project should keep. The tool checks the shape only: every judgment here is yours.",
      items: {
        type: "object",
        properties: {
          purpose: {
            type: "string",
            description:
              "What the components are all for, such as Filtering and selecting results.",
          },
          components: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                path: {
                  type: "string",
                  description: "The component's file, relative to the project.",
                },
                usedIn: {
                  type: "integer",
                  description: "How many files use the component.",
                },
                notes: {
                  type: "string",
                  description:
                    "How this one differs from the others, or what it lacks.",
                },
              },
              required: ["name", "path", "usedIn", "notes"],
            },
          },
          discrepancies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                aspect: { type: "string", enum: [...DISCREPANCY_ASPECTS] },
                detail: { type: "string" },
              },
              required: ["aspect", "detail"],
            },
          },
          recommended: {
            type: "string",
            description:
              "The name of the one component in this group to keep and use everywhere.",
          },
          reasoning: {
            type: "string",
            description: "Why the recommended component wins.",
          },
        },
        required: [
          "purpose",
          "components",
          "discrepancies",
          "recommended",
          "reasoning",
        ],
      },
    },
  },
  required: ["project", "files", "findings"],
};

type ToolReply = { result: string } | { deny: string };

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const resolveProjectPath = (workingDirectory: string, requestedPath: string) =>
  requestedPath.startsWith("/")
    ? requestedPath
    : `${workingDirectory}/${requestedPath}`;

const padTwoDigits = (value: number) => String(value).padStart(2, "0");

const formatFileStamp = (milliseconds: number) => {
  const stampDate = new Date(milliseconds);
  const datePart = [
    stampDate.getUTCFullYear(),
    padTwoDigits(stampDate.getUTCMonth() + 1),
    padTwoDigits(stampDate.getUTCDate()),
  ].join("-");
  return `${datePart}-${padTwoDigits(stampDate.getUTCHours())}${padTwoDigits(stampDate.getUTCMinutes())}${padTwoDigits(stampDate.getUTCSeconds())}`;
};

const BROWSER_OPENERS = [
  (pagePath: string) => ["open", pagePath],
  (pagePath: string) => ["xdg-open", pagePath],
  (pagePath: string) => ["cmd", "/c", "start", "", pagePath],
];

const tryOpener = async (engine: EngineInterface, openerCommand: string[]) => {
  try {
    const { exitCode } = await engine.process.run(openerCommand, {
      timeoutMs: 10000,
    });
    return exitCode === 0;
  } catch {
    return false;
  }
};

const openInBrowser = async (engine: EngineInterface, pagePath: string) => {
  for (const buildOpener of BROWSER_OPENERS) {
    if (await tryOpener(engine, buildOpener(pagePath))) return true;
  }
  return false;
};

const readFileText = (engine: EngineInterface, filePath: string) =>
  engine.fs.read(filePath).then(
    (fileText) => String(fileText),
    () => undefined
  );

const readProjectFiles = async (
  engine: EngineInterface,
  workingDirectory: string,
  filePaths: string[]
) =>
  new Map(
    await Promise.all(
      [...new Set(filePaths)].map(
        async (filePath) =>
          [
            filePath,
            await readFileText(
              engine,
              resolveProjectPath(workingDirectory, filePath)
            ),
          ] as const
      )
    )
  );

const readDesignFolder = (workingDirectory: string) =>
  `${workingDirectory}/${DESIGN_FOLDER}`;

const readThemePath = (workingDirectory: string) =>
  `${readDesignFolder(workingDirectory)}/${THEME_FILE_NAME}`;

const serialize = (saved: unknown) => `${JSON.stringify(saved, null, 2)}\n`;

const loadTheme = async (engine: EngineInterface, themePath: string) => {
  const themeText = await readFileText(engine, themePath);
  return themeText === undefined
    ? undefined
    : readTheme(JSON.parse(themeText)).theme;
};

const readThemedCall = async (engine: EngineInterface, input: unknown) => {
  const workingDirectory = await engine.session.cwd();
  const themePath = readThemePath(workingDirectory);
  return {
    workingDirectory,
    theme: await loadTheme(engine, themePath),
    fields: readFields(input),
    missingTheme: {
      deny: `No saved theme at ${themePath}. Call ${THEME_TOOL_NAME} first.`,
    },
  };
};

const writeAndOpenPage = async (
  engine: EngineInterface,
  workingDirectory: string,
  pageKind: string,
  fileStamp: string,
  saved: unknown,
  pageHtml: string
) => {
  const designFolder = readDesignFolder(workingDirectory);
  const pathWithoutExtension = `${designFolder}/${pageKind}-${fileStamp}`;
  const pagePath = `${pathWithoutExtension}.html`;
  await engine.fs.write(`${designFolder}/.gitignore`, "*\n");
  await engine.fs.write(`${pathWithoutExtension}.json`, serialize(saved));
  await engine.fs.write(pagePath, pageHtml);
  return (await openInBrowser(engine, pagePath))
    ? `Opened ${pagePath} in the browser.`
    : `Could not open the browser. The page is saved at ${pagePath}.`;
};

const findSourceProblems = async (
  engine: EngineInterface,
  workingDirectory: string,
  tokens: ThemeToken[]
) => {
  const sourcePaths = tokens.flatMap(
    (token) => readTokenSource(token.source)?.path ?? []
  );
  const textByPath = await readProjectFiles(
    engine,
    workingDirectory,
    sourcePaths
  );
  return tokens.flatMap((token) => {
    const sourcePath = readTokenSource(token.source)?.path;
    if (!sourcePath) return [];
    const sourceText = textByPath.get(sourcePath)?.toLowerCase();
    if (sourceText === undefined)
      return [`Token "${token.name}": ${sourcePath} does not exist.`];
    return listProblemUnless(
      [token.name, token.value].some(
        (searchedText) =>
          searchedText && sourceText.includes(searchedText.toLowerCase())
      ),
      `Token "${token.name}": neither its name nor its value appears in ${sourcePath}.`
    );
  });
};

const saveTheme = async (
  engine: EngineInterface,
  input: unknown
): Promise<ToolReply> => {
  const workingDirectory = await engine.session.cwd();
  const { theme, problems } = readTheme(input);
  const allProblems = [
    ...problems,
    ...(await findSourceProblems(engine, workingDirectory, theme.tokens)),
  ];
  if (allProblems.length) return { deny: allProblems.join("\n") };
  const themePath = readThemePath(workingDirectory);
  await engine.fs.write(
    `${readDesignFolder(workingDirectory)}/.gitignore`,
    "*\n"
  );
  await engine.fs.write(themePath, serialize(theme));
  return { result: `Saved ${theme.tokens.length} tokens to ${themePath}.` };
};

const RESTYLABLE_KINDS = ["color", "font"];

const readRestyledTokens = (rawTokens: unknown, themeTokens: ThemeToken[]) => {
  const problems: string[] = [];
  const tokens = readList(rawTokens).flatMap((rawToken) => {
    const fields = readFields(rawToken);
    const name = readText(fields.name);
    const value = readText(fields.value);
    const darkValue = readText(fields.darkValue) || undefined;
    const themeToken = themeTokens.find(
      (token) => token.name === name && RESTYLABLE_KINDS.includes(token.kind)
    );
    if (!themeToken) {
      problems.push(
        `restyled token "${name}" is not a color or font in the theme. A value the theme lacks goes in newTokens.`
      );
      return [];
    }
    if (!value) {
      problems.push(`restyled token "${name}" needs a value.`);
      return [];
    }
    return [{ ...themeToken, value, darkValue }];
  });
  return { tokens, problems };
};

const readVariant =
  (mode: string, themeTokens: ThemeToken[]) =>
  (rawVariant: unknown, variantIndex: number) => {
    const fields = readFields(rawVariant);
    const { tokens: restyledTokens, problems: restyleProblems } =
      readRestyledTokens(fields.restyledTokens, themeTokens);
    const { tokens: newTokens, problems: tokenProblems } = readTokens(
      fields.newTokens,
      false
    );
    const variant: DesignVariant = {
      name: readText(fields.name),
      rationale: readText(fields.rationale),
      html: readText(fields.html),
      css: readText(fields.css),
      kept: readTextList(fields.kept),
      changed: readTextList(fields.changed),
      newTokens,
      restyledTokens,
    };
    const problems = [
      ...listProblemUnless(
        variant.name && variant.html,
        "needs a name and html."
      ),
      ...listNewTokenProblems(newTokens, tokenProblems),
      ...restyleProblems,
      ...listProblemUnless(
        mode !== "redesign" || variant.changed.length,
        "a redesign lists at least one thing under changed."
      ),
      ...listRawCssProblems(variant.css),
      ...listMarkupProblems(variant.html),
    ].map(
      (problem) => `Variant ${readVariantLetter(variantIndex)}: ${problem}`
    );
    return { variant, problems };
  };

const renderDesign = async (
  engine: EngineInterface,
  input: unknown
): Promise<ToolReply> => {
  const { workingDirectory, theme, fields, missingTheme } =
    await readThemedCall(engine, input);
  if (!theme) return missingTheme;
  const mode = readText(fields.mode) as DesignMode;
  const readings = readList(fields.variants).map(
    readVariant(mode, theme.tokens)
  );
  const problems = [
    ...listUnknownValue("mode", mode, DESIGN_MODES),
    ...listProblemUnless(
      readings.length && readings.length <= MAX_VARIANTS,
      `The design needs one to four variants, and has ${readings.length}.`
    ),
    ...readings.flatMap((reading) => reading.problems),
  ];
  if (problems.length) return { deny: problems.join("\n") };
  const design: Design = {
    project: readText(fields.project) || "This project",
    mode,
    subject: readText(fields.subject),
    theme,
    variants: readings.map((reading) => reading.variant),
  };
  const fileStamp = formatFileStamp(await engine.clock.now());
  return {
    result: await writeAndOpenPage(
      engine,
      workingDirectory,
      "design",
      fileStamp,
      design,
      renderDesignPage(design, `design-${fileStamp}`)
    ),
  };
};

const readFinding = (rawFinding: unknown) => {
  const fields = readFields(rawFinding);
  const file = readText(fields.file);
  const finding: AuditFinding = {
    category: readText(fields.category) as AuditCategory,
    severity: readText(fields.severity) as AuditSeverity,
    title: readText(fields.title),
    detail: readText(fields.detail),
    fix: readText(fields.fix),
    ...(file ? { file } : {}),
    lines: Number.isInteger(fields.line) ? [fields.line as number] : [],
  };
  const problems = [
    ...listUnknownValue("category", finding.category, AUDIT_CATEGORIES),
    ...listUnknownValue("severity", finding.severity, AUDIT_SEVERITIES),
    ...listProblemUnless(
      finding.title && finding.fix,
      "needs a title and a fix."
    ),
  ];
  return { finding, problems };
};

const readProgress = async (
  engine: EngineInterface,
  designFolder: string,
  currentFileName: string,
  findings: AuditFinding[]
): Promise<AuditProgress | undefined> => {
  try {
    const entries = await engine.fs.list(designFolder);
    const previousAudit = pickPreviousAuditName(
      entries.map((entry) => entry.name),
      currentFileName
    );
    if (!previousAudit) return undefined;
    const previousFindings = readPreviousFindings(
      await readFileText(engine, `${designFolder}/${previousAudit}`)
    );
    return previousFindings
      ? { previousAudit, ...compareFindings(previousFindings, findings) }
      : undefined;
  } catch {
    return undefined;
  }
};

const renderAudit = async (
  engine: EngineInterface,
  input: unknown
): Promise<ToolReply> => {
  const { workingDirectory, theme, fields, missingTheme } =
    await readThemedCall(engine, input);
  if (!theme) return missingTheme;
  const scannedPaths = readTextList(fields.files);
  const readings = readList(fields.findings).map(readFinding);
  const groups = readComponentGroups(fields.componentGroups);
  const textByPath = await readProjectFiles(engine, workingDirectory, [
    ...scannedPaths,
    ...readings.flatMap((reading) => reading.finding.file ?? []),
    ...groups.flatMap((group) =>
      group.components.map((component) => component.path)
    ),
  ]);
  const describeMissingFile = (filePath: string | undefined) =>
    filePath && textByPath.get(filePath) === undefined
      ? [`${filePath} does not exist.`]
      : [];
  const problems = [
    ...readings.flatMap((reading, findingIndex) =>
      [...reading.problems, ...describeMissingFile(reading.finding.file)].map(
        (problem) => `Finding ${findingIndex + 1}: ${problem}`
      )
    ),
    ...scannedPaths.flatMap(describeMissingFile),
    ...checkComponentGroups(
      groups,
      (filePath) => textByPath.get(filePath) !== undefined
    ),
  ];
  if (problems.length) return { deny: problems.join("\n") };
  const findings = numberFindings(
    [
      ...readings.map((reading) => reading.finding),
      ...auditProject(
        theme,
        scannedPaths.map((path) => ({ path, text: textByPath.get(path) ?? "" }))
      ),
    ],
    groups.length
  );
  const fileStamp = formatFileStamp(await engine.clock.now());
  const progress = await readProgress(
    engine,
    readDesignFolder(workingDirectory),
    `audit-${fileStamp}.json`,
    findings
  );
  const audit: Audit = {
    project: readText(fields.project) || "This project",
    files: scannedPaths,
    theme,
    componentGroups: groups.map((group, groupIndex) => ({
      ...group,
      number: groupIndex + 1,
    })),
    findings,
    ...(progress ? { progress } : {}),
  };
  const openedLine = await writeAndOpenPage(
    engine,
    workingDirectory,
    "audit",
    fileStamp,
    audit,
    renderAuditPage(audit)
  );
  return {
    result: [
      openedLine,
      describeFindingCounts(findings, groups.length),
      describeProgress(progress),
    ]
      .filter(Boolean)
      .join(" "),
  };
};

const describeFailure = (failedAction: string, error: unknown) => ({
  deny: `Could not ${failedAction}: ${describeError(error)}`,
});

const buildSkillPrompt = (commandArguments: string) =>
  `Run the ${DESIGN_SKILL} skill with the Skill tool, passing these arguments as they stand: ${commandArguments}`;

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: DESIGN_COMMAND,
      description:
        "Design UI as themed mockups in the browser, or audit the theme and components",
      argumentHint:
        "new <brief> | redesign <target> [notes] | audit [scope] | apply [design] <letter> | fix <numbers, all or errors>",
    });
    await $.tool.register({
      name: THEME_TOOL_NAME,
      description:
        "Saves the project's theme to .claude/ui-design/theme.json, after checking that every token cites a real file that holds its name or its value. Call it once the theme is extracted, before render_design or render_design_audit. A refusal lists every problem: fix them all, then call again.",
      inputSchema: THEME_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: DESIGN_TOOL_NAME,
      description:
        "Renders design variants as one self-contained page of themed mockups, saves it under .claude/ui-design/ and opens it in the browser. It reads the saved theme itself and defines every token as a CSS variable, and refuses a variant that writes a color or a font as a literal instead of var(--token). Call it once, with every variant.",
      inputSchema: DESIGN_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: AUDIT_TOOL_NAME,
      description:
        "Audits the project's UI against its saved theme and opens the result as a page in the browser. It scans the listed files for hardcoded colors, fonts, font sizes and spacing, checks the theme for duplicate tokens, missing dark values and low-contrast pairs, and adds the findings and the same-purpose component groups passed in. Call it once, at the end of a design audit.",
      inputSchema: AUDIT_TOOL_SCHEMA,
      isDeferred: false,
    });
    return next(e);
  });

  on("command.run", { command: DESIGN_COMMAND }, async ($, e) => {
    const commandArguments = e.args.trim();
    $.clock.after(
      0,
      () => void $.prompt.submit({ text: buildSkillPrompt(commandArguments) })
    );
    return { text: "Starting the ui-design skill…" };
  });

  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstDesignArgument = DESIGN_COMMAND_PREFIXES.some(
      (prefix) =>
        e.text.startsWith(prefix) &&
        e.text.slice(prefix.length, e.start).trim() === ""
    );
    if (!isFirstDesignArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingModes = DESIGN_MODE_SUGGESTIONS.filter((mode) =>
      mode.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingModes] };
  });

  on("tool.call", { tool: QUALIFIED_THEME_TOOL_NAME }, async ($, e) => {
    try {
      return await saveTheme($, e);
    } catch (error) {
      return describeFailure("save the theme", error);
    }
  });

  on("tool.call", { tool: QUALIFIED_DESIGN_TOOL_NAME }, async ($, e) => {
    try {
      return await renderDesign($, e);
    } catch (error) {
      return describeFailure("write the design", error);
    }
  });

  on("tool.call", { tool: QUALIFIED_AUDIT_TOOL_NAME }, async ($, e) => {
    try {
      return await renderAudit($, e);
    } catch (error) {
      return describeFailure("write the audit", error);
    }
  });
};
