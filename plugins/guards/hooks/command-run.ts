import { spawnSync } from "node:child_process";

export type Run = (
  command: string[],
  cwd: string
) => { ok: boolean; output: string; status?: number | null } | null;

export const defaultRun: Run = (command, cwd) => {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
  });
  if (result.error) return null;
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
};
