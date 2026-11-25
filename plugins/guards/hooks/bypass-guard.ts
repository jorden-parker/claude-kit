import { ask, deny, type HookEvent, type HookResult } from "./types.ts";

const REQUEST_TOOL_NAME = "mcp__guards__request_hook_bypass";
const GRANT_STORE_PATH = ".claude/hook-bypass";
const EDIT_TOOL_NAMES = ["Edit", "Write", "NotebookEdit"];
const DENY_REASON =
  "Only the request_hook_bypass tool may write hook bypass grants.";

const requestDecision = (toolInput: Record<string, any>) =>
  ask(
    `Skip the TDD, no-comments and naming checks for 15 minutes on: ${toolInput.files.join(", ")}. Reason: ${toolInput.reason}`
  );

const touchesGrantStore = (event: HookEvent) => {
  const toolInput = event.tool_input ?? {};
  if (event.tool_name === "Bash")
    return String(toolInput.command ?? "").includes(GRANT_STORE_PATH);
  if (EDIT_TOOL_NAMES.includes(event.tool_name ?? ""))
    return String(
      toolInput.file_path ?? toolInput.notebook_path ?? ""
    ).includes(GRANT_STORE_PATH);
  return false;
};

export function decide(event: HookEvent): HookResult {
  if (event.tool_name === REQUEST_TOOL_NAME)
    return requestDecision(event.tool_input ?? {});
  if (touchesGrantStore(event)) return deny(DENY_REASON);
  return null;
}
