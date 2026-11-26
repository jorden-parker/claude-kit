export const SHELL_TOOL_NAMES = ["Bash", "run_shell_command"];
export const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "edit", "write_file"];
export type HookEvent = {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_response?: unknown;
  tool_use_id?: string;
  agent_id?: string;
  agent_type?: string;
};

export type SavedOutput = { path: string; text: string };

export type HookResult = {
  output?: unknown;
  exitCode?: number;
  stderr?: string;
  hiddenLines?: number;
  savedOutputs?: SavedOutput[];
} | null;

export const deny = (
  reason: string,
  hookEventName = "PreToolUse"
): HookResult => ({
  output: {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  },
});

export const ask = (reason: string): HookResult => ({
  output: {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  },
});

const TOOLS_THAT_TAKE_A_REWRITE = ["Bash", "Read", "SubagentHandback"];

export const canRewriteInput = (event: HookEvent) =>
  process.env.CLAUDE_KIT_HOOK_BRIDGE !== "1" &&
  TOOLS_THAT_TAKE_A_REWRITE.includes(event.tool_name ?? "");

export const rewriteInput = (
  updatedInput: Record<string, any>,
  additionalContext: string
): HookResult => ({
  output: {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput,
      additionalContext,
    },
  },
});
