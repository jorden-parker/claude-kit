import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStylesheet } from "./catalog";
import {
  runStudio,
  type ChatMessage,
  type StudioEvent,
  type StudioTools,
} from "./studio";

const SAVED_THEME = {
  tokens: [
    { name: "primary", kind: "color", value: "#2563eb", source: "app.css:2" },
    { name: "Font Sans", kind: "font", value: "system-ui", source: "app.css:3" },
  ],
};
const DIRECTION = {
  style: { name: "Brutalism", keywords: "raw, bold" },
  pattern: { name: "Hero-Centric Design" },
  colors: {
    primary: "#9A3412",
    on_primary: "#FFFFFF",
    background: "#FFFBEB",
    notes: "Warm terracotta",
  },
};
const VARIANT_REPLY = [
  "NAME: Split hero",
  "RATIONALE: Clear.",
  '{"op":"add","path":"/root","value":"page"}',
  '{"op":"add","path":"/elements/page","value":{"type":"Page","props":{},"children":["title","intro","start"]}}',
  '{"op":"add","path":"/elements/title","value":{"type":"Heading","props":{"text":"Cook"}}}',
  '{"op":"add","path":"/elements/intro","value":{"type":"Text","props":{"text":"Tonight"}}}',
  '{"op":"add","path":"/elements/start","value":{"type":"Button","props":{"label":"Start"}}}',
].join("\n");
const VARIANT_HTML =
  '<main class="page"><div class="page-inner page-wide"><h2 class="heading heading-2">Cook</h2><p class="text text-default text-md">Tonight</p><button type="button" class="button button-secondary">Start</button></div></main>';
const BROKEN_REPLY = [
  "NAME: Split hero",
  "RATIONALE: Clear.",
  '{"op":"add","path":5,"value":"page"}',
].join("\n");
const INVALID_REPLY = [
  "NAME: Split hero",
  "RATIONALE: Clear.",
  '{"op":"add","path":"/root","value":"page"}',
  '{"op":"add","path":"/elements/page","value":{"type":"Page","props":{},"children":["ghost"]}}',
].join("\n");
const CALL_COUNTS = {
  promptTokens: 10,
  outputTokens: 20,
  tokensPerSecond: 40,
  firstTokenSeconds: 0.5,
  seconds: 1,
};

const makeProject = async (theme?: object) => {
  const projectFolder = await mkdtemp(join(tmpdir(), "design-studio-"));
  if (theme) {
    await mkdir(join(projectFolder, ".claude/ui-design"), { recursive: true });
    await writeFile(
      join(projectFolder, ".claude/ui-design/theme.json"),
      JSON.stringify(theme)
    );
  }
  return projectFolder;
};

const makeTools = (
  projectFolder: string,
  renderReplies: { text: string; isError: boolean }[]
) => {
  const events: StudioEvent[] = [];
  const conversations: ChatMessage[][] = [];
  const toolCalls: { toolName: string; input: any }[] = [];
  const tools: StudioTools = {
    chat: async (messages, hearText) => {
      conversations.push(messages);
      hearText("NAME", false);
      return { text: VARIANT_REPLY, ...CALL_COUNTS };
    },
    callTool: async (toolName, input) => {
      toolCalls.push({ toolName, input });
      if (toolName === "render_design") return renderReplies.shift()!;
      await writeFile(
        join(projectFolder, ".claude/ui-design/theme.json"),
        JSON.stringify({ tokens: input.tokens })
      );
      return { text: "Saved.", isError: false };
    },
    findDirection: async () => DIRECTION,
    emit: (event) => events.push(event),
  };
  return { tools, events, conversations, toolCalls };
};

const OPENED_REPLY = {
  text: "Opened /project/.claude/ui-design/design-1.html in the browser.",
  isError: false,
};

test("runStudio reuses a saved theme, asks the model once per variant and renders them", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const { tools, events, conversations, toolCalls } = makeTools(projectFolder, [
    OPENED_REPLY,
  ]);
  await runStudio(
    { brief: "Recipe onboarding", variantCount: 2, projectFolder },
    tools
  );
  expect(conversations).toHaveLength(2);
  expect(conversations[0]![0]!.content).toContain("The tokens: primary, font-sans.");
  expect(conversations[1]![1]!.content).toContain("Design direction: Brutalism (raw, bold).");
  expect(conversations[1]![1]!.content).not.toContain("#9A3412");
  expect(toolCalls).toHaveLength(1);
  expect(toolCalls[0]!.input).toMatchObject({
    mode: "new",
    subject: "Recipe onboarding",
    variants: [{ name: "Split hero", html: VARIANT_HTML }, {}],
  });
  expect(events.at(-1)).toMatchObject({
    kind: "done",
    pagePath: "/project/.claude/ui-design/design-1.html",
  });
  expect(events).toContainEqual({ kind: "text", callId: "variant-a", text: "NAME", isThinking: false });
  expect(events).toContainEqual({
    kind: "call",
    id: "variant-a",
    label: "Variant A",
    state: "done",
    ...CALL_COUNTS,
  });
});

test("runStudio saves a starter theme from the first direction when the project has none", async () => {
  const projectFolder = await makeProject();
  const { tools, toolCalls } = makeTools(projectFolder, [OPENED_REPLY]);
  await runStudio({ brief: "Recipe onboarding", variantCount: 1, projectFolder }, tools);
  const starterCss = await readFile(
    join(projectFolder, ".claude/ui-design/starter-theme.css"),
    "utf8"
  );
  expect(starterCss.split("\n")[2]).toBe("  --primary-foreground: #FFFFFF;");
  expect(toolCalls[0]!.toolName).toBe("save_design_theme");
  expect(toolCalls[0]!.input.tokens).toContainEqual({
    name: "primary-foreground",
    kind: "color",
    value: "#FFFFFF",
    source: ".claude/ui-design/starter-theme.css:3",
  });
  expect(
    toolCalls[0]!.input.tokens.some((token: any) => token.name === "notes")
  ).toBe(false);
});

test("runStudio sends a refusal back to the model of the refused variant, then renders again", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const { tools, conversations, toolCalls, events } = makeTools(projectFolder, [
    { text: "Variant B: writes the raw color #fff.", isError: true },
    OPENED_REPLY,
  ]);
  await runStudio({ brief: "Recipe onboarding", variantCount: 2, projectFolder }, tools);
  expect(conversations).toHaveLength(3);
  expect(conversations[2]!.at(-1)!.content).toContain("writes the raw color #fff.");
  expect(conversations[2]!.at(-2)).toEqual({ role: "assistant", content: VARIANT_REPLY });
  expect(toolCalls).toHaveLength(2);
  expect(events.at(-1)!.kind).toBe("done");
});

test("runStudio emits the stylesheet once, after the theme loads and before the first model call", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const { tools, events } = makeTools(projectFolder, [OPENED_REPLY]);
  await runStudio({ brief: "Recipe onboarding", variantCount: 2, projectFolder }, tools);
  const stylesheetIndex = events.findIndex((event) => event.kind === "stylesheet");
  expect(events.filter((event) => event.kind === "stylesheet")).toEqual([
    { kind: "stylesheet", css: renderStylesheet(SAVED_THEME.tokens) },
  ]);
  expect(stylesheetIndex).toBeGreaterThan(
    events.findIndex((event) => event.kind === "step" && event.id === "theme" && event.state === "done")
  );
  expect(stylesheetIndex).toBeLessThan(events.findIndex((event) => event.kind === "call"));
});

test("runStudio previews the spec after each finished line and once more for the whole reply, ignoring thinking text", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const { tools, events } = makeTools(projectFolder, [OPENED_REPLY]);
  const streamingTools: StudioTools = {
    ...tools,
    chat: async (_messages, hearText) => {
      hearText("NAME: Split hero\n", false);
      hearText('{"op":"add","path":"/root","value":"page"}\n', false);
      hearText("Maybe a card.", true);
      hearText('{"op":"add","path":"/elements/page","value":{"type":"Page","props":{},"children":[]}}', false);
      hearText("\n", false);
      return { text: VARIANT_REPLY, ...CALL_COUNTS };
    },
  };
  await runStudio({ brief: "Recipe onboarding", variantCount: 1, projectFolder }, streamingTools);
  expect(events.filter((event) => event.kind === "preview")).toEqual([
    { kind: "preview", callId: "variant-a", html: '<main class="page"><div class="page-inner page-wide"></div></main>' },
    { kind: "preview", callId: "variant-a", html: VARIANT_HTML },
  ]);
});

test("runStudio sends a spec that shows next to nothing back to the model, then renders the repaired one", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const { tools, conversations, toolCalls } = makeTools(projectFolder, [OPENED_REPLY]);
  const replies = [INVALID_REPLY, VARIANT_REPLY];
  const repairingTools: StudioTools = {
    ...tools,
    chat: async (messages, hearText) => {
      conversations.push(messages);
      hearText("NAME", false);
      return { text: replies.shift()!, ...CALL_COUNTS };
    },
  };
  await runStudio({ brief: "Recipe onboarding", variantCount: 1, projectFolder }, repairingTools);
  expect(conversations).toHaveLength(2);
  expect(conversations[1]!.at(-1)!.content).toContain("shows only 1 of its elements");
  expect(toolCalls).toHaveLength(1);
  expect(toolCalls[0]!.input.variants).toEqual([
    expect.objectContaining({ name: "Split hero", html: VARIANT_HTML }),
  ]);
});

test("runStudio asks for a repair when no patch line of the reply can be applied", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const { tools, conversations, toolCalls } = makeTools(projectFolder, [OPENED_REPLY]);
  const replies = [BROKEN_REPLY, VARIANT_REPLY];
  const repairingTools: StudioTools = {
    ...tools,
    chat: async (messages, hearText) => {
      conversations.push(messages);
      hearText(replies[0]!, false);
      return { text: replies.shift()!, ...CALL_COUNTS };
    },
  };
  await runStudio({ brief: "Recipe onboarding", variantCount: 1, projectFolder }, repairingTools);
  expect(conversations).toHaveLength(2);
  expect(conversations[1]!.at(-1)!.content).toContain("has no root element");
  expect(toolCalls).toHaveLength(1);
});

test("runStudio drops a variant the tool still refuses after two repairs and renders the rest", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const refusal = { text: "Variant A: needs a name and html.", isError: true };
  const { tools, toolCalls } = makeTools(projectFolder, [
    refusal,
    refusal,
    refusal,
    OPENED_REPLY,
  ]);
  await runStudio({ brief: "Recipe onboarding", variantCount: 2, projectFolder }, tools);
  expect(toolCalls.at(-1)!.input.variants).toHaveLength(1);
});

test("runStudio reports a failure and throws when every variant stays refused", async () => {
  const projectFolder = await makeProject(SAVED_THEME);
  const refusal = { text: "Variant A: needs a name and html.", isError: true };
  const { tools, events } = makeTools(projectFolder, [refusal, refusal, refusal]);
  await expect(
    runStudio({ brief: "Recipe onboarding", variantCount: 1, projectFolder }, tools)
  ).rejects.toThrow("needs a name and html.");
  expect(events.at(-1)!.kind).toBe("failed");
});
