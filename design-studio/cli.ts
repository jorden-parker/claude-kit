#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { startMonitor } from "./monitor";
import { runStudio, type StudioEvent } from "./studio";
import { loadQwen, startDesignTools } from "./tools";

const USAGE = `Usage: design-studio/cli.ts "<design brief>" [--variants 1-4] [--size <claude-lite size>] [--project <folder>] [--no-open]
Generates fresh UI mockups with claude-lite's Qwen model and the ui-design plugin, and shows the run live in a browser page.
The design is saved under <project>/.claude/ui-design/. CLAUDE_LITE_HOME overrides ~/src/claude-lite.`;

const STATE_MARKS = { running: "…", done: "✓", failed: "✗" };

const printEvent = (event: StudioEvent) => {
  if (event.kind === "step") {
    console.log(`${STATE_MARKS[event.state]} ${event.title}${event.detail ? `: ${event.detail}` : ""}`);
  }
  if (event.kind === "call" && event.state === "done") {
    console.log(
      `  qwen ${event.label}: ${event.promptTokens} prompt tokens, ${event.outputTokens} output tokens, ${event.tokensPerSecond} tokens/s, ${event.seconds?.toFixed(1)}s`
    );
  }
  if (event.kind === "call" && event.state === "running") {
    console.log(`  qwen ${event.label}: writing…`);
  }
};

const { values: flags, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    variants: { type: "string", default: "2" },
    size: { type: "string" },
    project: { type: "string", default: "." },
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const brief = positionals.join(" ").trim();
const variantCount = Number(flags.variants);
if (flags.help || !brief || ![1, 2, 3, 4].includes(variantCount)) {
  console.error(USAGE);
  process.exit(flags.help ? 0 : 2);
}

const projectFolder = resolve(flags.project);
const monitor = startMonitor();
const emit = (event: StudioEvent) => {
  printEvent(event);
  monitor.emit(event);
};
console.log(`Monitor: ${monitor.url}`);
if (!flags["no-open"]) {
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", monitor.url], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

const LOAD_STEP = { kind: "step", id: "model", title: "Load the Qwen model" } as const;
let exitCode = 0;
try {
  emit({ ...LOAD_STEP, state: "running" });
  const qwen = await loadQwen(flags.size).catch((error) => {
    emit({ ...LOAD_STEP, state: "failed", detail: error.message });
    emit({ kind: "failed", message: error.message });
    throw error;
  });
  emit({ kind: "run", brief, model: qwen.model, projectFolder });
  emit({ ...LOAD_STEP, state: "done", detail: qwen.model });
  await runStudio(
    { brief, variantCount, projectFolder },
    { ...(await startDesignTools(projectFolder)), chat: qwen.chat, emit }
  );
} catch (error) {
  console.error(`design-studio: ${error instanceof Error ? error.message : error}`);
  exitCode = 1;
}
await monitor.stop();
process.exit(exitCode);
