import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
export type CodeburnStatus = { roots: string[]; message: string };
export async function codeburnDiscovery(home: string): Promise<CodeburnStatus> {
  const engine = codeburnEngine(home);
  if (!engine)
    return {
      roots: [],
      message: "CLI not found; using standard Claude Code transcript paths",
    };
  try {
    const child = Bun.spawn(
      [...engine.command, "doctor", "--provider", "claude", "--json"],
      { env: engine.env, stdout: "pipe", stderr: "pipe" }
    );
    const timeout = setTimeout(() => child.kill(), 5000);
    try {
      const [text, , status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (status !== 0)
        return {
          roots: [],
          message: "Path discovery failed; using standard transcript paths",
        };
      return parseCodeburnDiscovery(JSON.parse(text));
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return {
      roots: [],
      message: "Unavailable or unsupported; using standard transcript paths",
    };
  }
}
export function parseCodeburnDiscovery(report: any): CodeburnStatus {
  const provider = report?.providers?.find(
    (provider: any) => provider?.provider === "claude"
  );
  if (!provider || !Array.isArray(provider.probePaths))
    return {
      roots: [],
      message: "Unsupported diagnostic format; using standard transcript paths",
    };
  const roots = provider.probePaths
    .filter(
      (probe: any) =>
        probe?.exists === true &&
        typeof probe.path === "string" &&
        isAbsolute(probe.path)
    )
    .map((probe: any) => probe.path as string);
  return {
    roots: [...new Set(roots)] as string[],
    message:
      "Connected · " +
      new Set(roots).size +
      " detected transcript locations · " +
      (Number.isFinite(provider.candidatesFound)
        ? provider.candidatesFound + " candidate sessions"
        : "session count unknown"),
  };
}

export function macDesktopEngine(app: string) {
  const contents = join(app, "Contents");
  const cli = join(contents, "Resources/cli");
  const launcher = join(cli, "codeburn");
  if (Bun.which(launcher)) return { command: [launcher], env: {} };
  const runtime = join(contents, "MacOS/CodeBurn");
  const script = join(cli, "dist/launch.js");
  if (Bun.which(runtime) && existsSync(script))
    return { command: [runtime, script], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export function codeburnEngine(home: string) {
  const env = { ...process.env, HOME: home };
  const executable =
    process.env.TOKEN_LEDGER_CODEBURN ||
    Bun.which("codeburn") ||
    [
      join(home, ".local/bin/codeburn"),
      "/opt/homebrew/bin/codeburn",
      "/usr/local/bin/codeburn",
    ].find((path) => Bun.which(path));
  if (executable) return { command: [executable], env };
  if (process.platform === "darwin") {
    for (const app of [
      join(home, "Applications/CodeBurn.app"),
      "/Applications/CodeBurn.app",
    ]) {
      const desktop = macDesktopEngine(app);
      if (desktop)
        return { command: desktop.command, env: { ...env, ...desktop.env } };
    }
  }
}
