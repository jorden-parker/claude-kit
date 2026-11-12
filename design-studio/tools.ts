import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginHost } from "../plugin-host/engine";
import { register } from "../plugins/ui-design/hooks/register";
import type { StudioTools } from "./studio";

type OllamaCounters = {
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  first_token_seconds?: number;
};

const NANOSECONDS_PER_SECOND = 1_000_000_000;
const KIT_ROOT = join(import.meta.dir, "..");
const DIRECTION_PARTS = ["style", "pattern", "colors", "typography"];

const findLiteHome = () =>
  process.env.CLAUDE_LITE_HOME ?? join(homedir(), "src/claude-lite");

const findSearchScript = () =>
  join(
    process.env.UI_UX_PRO_MAX_HOME ?? join(homedir(), ".claude/skills/ui-ux-pro-max"),
    "scripts/search.py"
  );

export const readCallCounts = (counters: OllamaCounters) => ({
  promptTokens: counters.prompt_eval_count ?? 0,
  outputTokens: counters.eval_count ?? 0,
  tokensPerSecond: counters.eval_duration
    ? Math.round(((counters.eval_count ?? 0) / counters.eval_duration) * NANOSECONDS_PER_SECOND)
    : 0,
  firstTokenSeconds: counters.first_token_seconds ?? 0,
  seconds: (counters.total_duration ?? 0) / NANOSECONDS_PER_SECOND,
});

const findDirection: StudioTools["findDirection"] = async (brief, variance) => {
  const searchProcess = Bun.spawn(
    ["python3", findSearchScript(), brief, "--design-system", "--json", "--variance", String(variance)],
    { cwd: tmpdir(), stdout: "pipe", stderr: "pipe" }
  );
  const [searchOutput, errorOutput, exitCode] = await Promise.all([
    new Response(searchProcess.stdout).text(),
    new Response(searchProcess.stderr).text(),
    searchProcess.exited,
  ]);
  if (exitCode !== 0) throw new Error(errorOutput.trim().split("\n").at(-1));
  const designSystem = JSON.parse(searchOutput).design_system;
  return Object.fromEntries(DIRECTION_PARTS.map((part) => [part, designSystem[part]]));
};

export const loadQwen = async (sizeName: string | undefined) => {
  const liteHome = findLiteHome();
  const { resolveSize } = await import(join(liteHome, "src/ollama/sizes.ts"));
  const { fetchApi, streamChat, ollamaUrl } = await import(
    join(liteHome, "src/ollama/api.ts")
  );
  const { size } = resolveSize(liteHome, sizeName ? [sizeName] : []);
  const loadProblem: string | null = await fetchApi.load(size.model);
  if (loadProblem) {
    throw new Error(
      `Ollama could not load ${size.model}: ${loadProblem}. Build it with "cl ollama", or pass --size with a size whose model is built.`
    );
  }
  const chat: StudioTools["chat"] = async (messages, hearText) => {
    const reply = await streamChat(
      { model: size.model, messages, think: size.thinking },
      ollamaUrl(),
      (chunk: { message: { content?: string; thinking?: string } }) => {
        if (chunk.message.thinking) hearText(chunk.message.thinking, true);
        if (chunk.message.content) hearText(chunk.message.content, false);
      }
    );
    return { text: reply.message.content, ...readCallCounts(reply) };
  };
  return { model: size.model as string, chat };
};

export const startDesignTools = async (projectFolder: string) => {
  const host = createPluginHost({
    pluginName: "ui-design",
    pluginRoot: join(KIT_ROOT, "plugins/ui-design"),
    workingDirectory: projectFolder,
    storePath: join(tmpdir(), "design-studio-store.json"),
    register,
  });
  await host.start();
  return { callTool: host.callTool, findDirection };
};
