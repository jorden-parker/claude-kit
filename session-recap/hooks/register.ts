import type { EngineInterface, Register } from "claude-code";

const RECAP_RULES = `You write a prompt that a fresh coding-agent session could receive to continue the work in the conversation below.
The working directory and the conversation are the only sources: invent nothing they do not contain.
Include the goal, what has been done, what is left, the files and commands mentioned, and any open questions.
If a <focus> block is present, center the recap on it and keep the rest brief.
Output only the prompt, with no preamble, quotes or explanation.`;

const RECENT_MESSAGE_COUNT = 40;
const RECENT_MESSAGE_MAX_LENGTH = 1500;

const NO_RECAP_MESSAGE = "Nothing to recap yet.";
const FILLED_MESSAGE =
  "Recap filled into the composer. Edit it or press Enter.";

const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

const stripWrappingCodeFence = (text: string) =>
  text.trim().replace(WRAPPING_CODE_FENCE, "$1").trim();

const truncateMessageText = (text: string) =>
  text.length > RECENT_MESSAGE_MAX_LENGTH
    ? `${text.slice(0, RECENT_MESSAGE_MAX_LENGTH)}…`
    : text;

const describeRecentMessages = async (engine: EngineInterface) => {
  const messages = await engine.session.messages();
  return messages
    .filter((message) => message.text.trim())
    .slice(-RECENT_MESSAGE_COUNT)
    .map((message) => `${message.role}: ${truncateMessageText(message.text)}`)
    .join("\n");
};

const buildRecapPrompt = (
  workingDirectory: string,
  recentMessages: string,
  focus: string
) => {
  const focusSection = focus ? `\n\n<focus>\n${focus}\n</focus>` : "";
  return `Working directory: ${workingDirectory}\n\nConversation:\n${recentMessages}${focusSection}`;
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "recap",
      description: "Summarize the session into a prompt that resumes the work",
      argumentHint: "[focus]",
    });

    return next(e);
  });

  on("command.run", { command: "recap" }, async ($, e) => {
    const focus = e.args.trim();
    const recentMessages = await describeRecentMessages($);
    if (!recentMessages) return { text: NO_RECAP_MESSAGE };

    $.ui.toast("Building recap…");
    const reply = await $.model.complete({
      model: "haiku",
      system: RECAP_RULES,
      prompt: buildRecapPrompt(await $.session.cwd(), recentMessages, focus),
      effort: "low",
      timeoutMs: 15000,
    });

    if (!reply.isAnswered) {
      return { text: `Could not build the recap (${reply.reason}).` };
    }

    const recap = stripWrappingCodeFence(reply.text);
    if (!recap) {
      return { text: "Could not build the recap (empty reply)." };
    }

    const fillResult = await $.prompt.fill({ text: recap, mode: "replace" });
    if (fillResult.isFilled) {
      return { text: FILLED_MESSAGE, context: [recap] };
    }

    const copy = await $.ui.copy({ text: recap });
    return {
      text: copy.isCopied ? `${recap}\n\n(Copied to clipboard)` : recap,
      context: [recap],
    };
  });
};
