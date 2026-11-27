import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
export type CodeburnStatus = { roots: string[]; message: string };
export async function codeburnDiscovery(home: string): Promise<CodeburnStatus> {
  const executable = codeburnExecutable(home);
  if (!executable)
    return {
      roots: [],
      message: "CLI not found; using standard Claude Code transcript paths",
    };
  try {
    const child = Bun.spawn(
      [executable, "doctor", "--provider", "claude", "--json"],
      { env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" }
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

export function codeburnExecutable(home: string) {
  return (
    process.env.TOKEN_LEDGER_CODEBURN ||
    Bun.which("codeburn") ||
    [
      join(home, ".local/bin/codeburn"),
      "/opt/homebrew/bin/codeburn",
      "/usr/local/bin/codeburn",
    ].find((path) => existsSync(path))
  );
}
