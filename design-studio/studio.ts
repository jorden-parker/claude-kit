import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readVariantLetter } from "../plugins/ui-design/hooks/design-page";
import {
  buildCatalogPrompt,
  findSpecProblems,
  renderSpecToHtml,
  renderStylesheet,
} from "./catalog";
import { parseVariantReply, readReplySpec } from "./variant-reply";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CallCounts = {
  promptTokens: number;
  outputTokens: number;
  tokensPerSecond: number;
  firstTokenSeconds: number;
  seconds: number;
};

type WorkState = "running" | "done" | "failed";

export type StudioEvent =
  | { kind: "run"; brief: string; model: string; projectFolder: string }
  | { kind: "step"; id: string; title: string; state: WorkState; detail?: string }
  | ({ kind: "call"; id: string; label: string; state: WorkState } & Partial<CallCounts>)
  | { kind: "text"; callId: string; text: string; isThinking: boolean }
  | { kind: "stylesheet"; css: string }
  | { kind: "preview"; callId: string; html: string }
  | { kind: "done"; resultLine: string; pagePath: string }
  | { kind: "failed"; message: string };

type Direction = Record<string, any>;

export type StudioTools = {
  chat: (
    messages: ChatMessage[],
    hearText: (text: string, isThinking: boolean) => void
  ) => Promise<{ text: string } & CallCounts>;
  callTool: (
    toolName: string,
    input: Record<string, any>
  ) => Promise<{ text: string; isError: boolean }>;
  findDirection: (brief: string, variance: number) => Promise<Direction>;
  emit: (event: StudioEvent) => void;
};

type StudioRequest = {
  brief: string;
  variantCount: number;
  projectFolder: string;
};

type ThemeToken = { name: string; kind: string; value: string };

type Draft = { label: string; messages: ChatMessage[]; replyText: string };

const DESIGN_FOLDER = ".claude/ui-design";
const STARTER_THEME_PATH = `${DESIGN_FOLDER}/starter-theme.css`;
const VARIANCE_BY_VARIANT = [2, 9, 5, 7];
const MAX_REPAIRS = 2;
const STARTER_EXTRA_TOKENS = [
  { name: "font-heading", kind: "font", value: "system-ui, sans-serif" },
  { name: "font-body", kind: "font", value: "system-ui, sans-serif" },
  { name: "radius", kind: "radius", value: "8px" },
];
const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const readSavedTokens = async (projectFolder: string) => {
  try {
    const theme = JSON.parse(
      await readFile(join(projectFolder, DESIGN_FOLDER, "theme.json"), "utf8")
    );
    return theme.tokens as ThemeToken[];
  } catch {
    return undefined;
  }
};

const nameColorToken = (colorKey: string) =>
  colorKey.replace(/^on_(.+)$/, "$1_foreground").replaceAll("_", "-");

const listStarterTokens = (direction: Direction) => [
  ...Object.entries(direction.colors ?? {})
    .filter(([, colorValue]) => /^#[0-9a-f]{3,8}$/i.test(String(colorValue)))
    .map(([colorKey, colorValue]) => ({
      name: nameColorToken(colorKey),
      kind: "color",
      value: String(colorValue),
    })),
  ...STARTER_EXTRA_TOKENS,
];

const describeDirection = (direction: Direction | undefined) =>
  direction?.style
    ? `Design direction: ${direction.style.name} (${direction.style.keywords}). Let it shape the layout and the wording, and name the design after it.`
    : "";

const buildVariantPrompt = (
  { brief, variantCount }: StudioRequest,
  variantIndex: number,
  direction: Direction | undefined
) =>
  [
    `Design brief: ${brief}`,
    `This is variant ${readVariantLetter(variantIndex)} of ${variantCount}. Variants differ in structure, not just in color.`,
    describeDirection(direction),
    variantIndex === 0 && variantCount > 1
      ? "Keep the theme's colors and fonts: write no TOKENS line."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const groupProblemsByVariant = (refusalText: string) => {
  const problemsByIndex = new Map<number, string[]>();
  for (const line of refusalText.split("\n")) {
    const variantMatch = /^Variant ([A-D]): /.exec(line);
    if (!variantMatch) continue;
    const variantIndex = variantMatch[1]!.charCodeAt(0) - "A".charCodeAt(0);
    problemsByIndex.set(variantIndex, [
      ...(problemsByIndex.get(variantIndex) ?? []),
      line,
    ]);
  }
  return problemsByIndex;
};

export const runStudio = async (request: StudioRequest, tools: StudioTools) => {
  const { brief, variantCount, projectFolder } = request;
  const { emit } = tools;

  const runStep = async <Result>(
    stepId: string,
    title: string,
    doWork: () => Promise<{ result: Result; detail: string }>
  ) => {
    emit({ kind: "step", id: stepId, title, state: "running" });
    try {
      const { result, detail } = await doWork();
      emit({ kind: "step", id: stepId, title, state: "done", detail });
      return result;
    } catch (error) {
      emit({ kind: "step", id: stepId, title, state: "failed", detail: describeError(error) });
      throw error;
    }
  };

  const askModel = async (callId: string, label: string, messages: ChatMessage[]) => {
    emit({ kind: "call", id: callId, label, state: "running" });
    let heardReply = "";
    let shownHtml = "";
    const emitPreview = (replyText: string) => {
      const html = renderSpecToHtml(readReplySpec(replyText));
      if (html === shownHtml) return;
      shownHtml = html;
      emit({ kind: "preview", callId, html });
    };
    try {
      const { text, ...counts } = await tools.chat(messages, (heardText, isThinking) => {
        emit({ kind: "text", callId, text: heardText, isThinking });
        if (isThinking) return;
        heardReply += heardText;
        if (heardText.includes("\n")) emitPreview(heardReply.slice(0, heardReply.lastIndexOf("\n")));
      });
      emitPreview(text);
      emit({ kind: "call", id: callId, label, state: "done", ...counts });
      return text;
    } catch (error) {
      emit({ kind: "call", id: callId, label, state: "failed" });
      throw error;
    }
  };

  const findDirections = async () => {
    const directions: Direction[] = [];
    try {
      for (let i = 0; i < variantCount; i++) {
        directions.push(await tools.findDirection(brief, VARIANCE_BY_VARIANT[i]!));
      }
    } catch (error) {
      return {
        result: directions,
        detail: `ui-ux-pro-max gave no direction (${describeError(error)}); carrying on without`,
      };
    }
    return {
      result: directions,
      detail: directions.map((direction) => direction.style?.name).join(", "),
    };
  };

  const loadTheme = async (firstDirection: Direction | undefined) => {
    const savedTokens = await readSavedTokens(projectFolder);
    if (savedTokens) {
      return {
        result: savedTokens,
        detail: `reused the project's saved theme, ${savedTokens.length} tokens`,
      };
    }
    if (!firstDirection) {
      throw new Error(
        "The project has no saved theme, and ui-ux-pro-max gave no palette for a starter theme."
      );
    }
    const starterTokens = listStarterTokens(firstDirection);
    await mkdir(join(projectFolder, DESIGN_FOLDER), { recursive: true });
    await writeFile(
      join(projectFolder, STARTER_THEME_PATH),
      [
        ":root {",
        ...starterTokens.map((token) => `  --${token.name}: ${token.value};`),
        "}",
        "",
      ].join("\n")
    );
    const saveOutcome = await tools.callTool("save_design_theme", {
      tokens: starterTokens.map((token, tokenIndex) => ({
        ...token,
        source: `${STARTER_THEME_PATH}:${tokenIndex + 2}`,
      })),
    });
    if (saveOutcome.isError) throw new Error(saveOutcome.text);
    return {
      result: starterTokens,
      detail: `no saved theme, so wrote a starter theme of ${starterTokens.length} tokens from ui-ux-pro-max`,
    };
  };

  const checkDrafts = async (drafts: Draft[], tokens: ThemeToken[]) => {
    const specRefusal = drafts
      .flatMap((draft, draftIndex) =>
        findSpecProblems(readReplySpec(draft.replyText)).map(
          (problem) => `Variant ${readVariantLetter(draftIndex)}: ${problem}`
        )
      )
      .join("\n");
    if (specRefusal) return { isError: true, text: specRefusal };
    return tools.callTool("render_design", {
      project: basename(projectFolder),
      mode: "new",
      subject: brief,
      variants: drafts.map((draft) => parseVariantReply(draft.replyText, tokens)),
    });
  };

  const renderDrafts = async (firstDrafts: Draft[], tokens: ThemeToken[]) => {
    let drafts = firstDrafts;
    for (let round = 0; ; round++) {
      const outcome = await checkDrafts(drafts, tokens);
      if (!outcome.isError) return { result: outcome.text, detail: outcome.text };
      const problemsByIndex = groupProblemsByVariant(outcome.text);
      if (!problemsByIndex.size) throw new Error(outcome.text);
      if (round >= MAX_REPAIRS) {
        drafts = drafts.filter((_, draftIndex) => !problemsByIndex.has(draftIndex));
        if (!drafts.length) throw new Error(outcome.text);
        continue;
      }
      for (const [draftIndex, problems] of problemsByIndex) {
        const draft = drafts[draftIndex]!;
        draft.messages = [
          ...draft.messages,
          { role: "assistant", content: draft.replyText },
          {
            role: "user",
            content: `The design tool refused this variant:\n${problems.join("\n")}\n\nWrite the whole reply again, in the same shape: the NAME line, the RATIONALE line, then the JSON Patch lines of the spec, with the TOKENS line only when it is needed. Fix every problem.`,
          },
        ];
        draft.replyText = await askModel(
          `${draft.label.toLowerCase().replace(" ", "-")}-repair-${round + 1}`,
          `${draft.label}, repair ${round + 1}`,
          draft.messages
        );
      }
    }
  };

  try {
    const directions = await runStep("directions", "Get design directions", findDirections);
    const tokens = await runStep("theme", "Load the theme", () => loadTheme(directions[0]));
    emit({ kind: "stylesheet", css: renderStylesheet(tokens) });
    const systemPrompt = buildCatalogPrompt(tokens);
    const drafts = await runStep("variants", "Write the variants", async () => {
      const writtenDrafts: Draft[] = [];
      for (let i = 0; i < variantCount; i++) {
        const label = `Variant ${readVariantLetter(i)}`;
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildVariantPrompt(request, i, directions[i]) },
        ];
        const replyText = await askModel(
          label.toLowerCase().replace(" ", "-"),
          label,
          messages
        );
        writtenDrafts.push({ label, messages, replyText });
      }
      return { result: writtenDrafts, detail: `${writtenDrafts.length} writtenDrafts` };
    });
    const resultLine = await runStep("render", "Check and render the page", () =>
      renderDrafts(drafts, tokens)
    );
    emit({
      kind: "done",
      resultLine,
      pagePath: /(\/.*\.html)/.exec(resultLine)?.[1] ?? "",
    });
  } catch (error) {
    emit({ kind: "failed", message: describeError(error) });
    throw error;
  }
};
