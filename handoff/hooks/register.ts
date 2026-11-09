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
const HANDING_OFF_MESSAGE = "Handing off to a new session…";

const NEW_SESSION_FLAG = /(^|\s)--new(?=\s|$)/;
const PENDING_HANDOFF_KEY = "pendingHandoff";

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

const parseHandoffArguments = (args: string) => ({
  isNewSession: NEW_SESSION_FLAG.test(args),
  focus: args.replace(NEW_SESSION_FLAG, " ").trim(),
});

type RecapBuild = { recap: string; failure?: undefined } | { failure: string };

const buildRecap = async (
  engine: EngineInterface,
  focus: string
): Promise<RecapBuild> => {
  const recentMessages = await describeRecentMessages(engine);
  if (!recentMessages) return { failure: NO_RECAP_MESSAGE };

  engine.ui.toast("Building recap…");
  const reply = await engine.model.complete({
    model: "haiku",
    system: RECAP_RULES,
    prompt: buildRecapPrompt(await engine.session.cwd(), recentMessages, focus),
    effort: "low",
    timeoutMs: 15000,
  });

  if (!reply.isAnswered) {
    return { failure: `Could not build the recap (${reply.reason}).` };
  }

  const recap = stripWrappingCodeFence(reply.text);
  if (!recap) return { failure: "Could not build the recap (empty reply)." };
  return { recap };
};

const offerRecapInThisSession = async (
  engine: EngineInterface,
  recap: string
) => {
  const fillResult = await engine.prompt.fill({ text: recap, mode: "replace" });
  if (fillResult.isFilled) return { text: FILLED_MESSAGE, context: [recap] };

  const copy = await engine.ui.copy({ text: recap });
  return {
    text: copy.isCopied ? `${recap}\n\n(Copied to clipboard)` : recap,
    context: [recap],
  };
};

const clearSessionAndSubmitRecap = async (
  engine: EngineInterface,
  recap: string
) => {
  await engine.command.run({ command: "clear" });
  await engine.prompt.submit({ text: recap, asUser: true });
};

const handOffToNewSession = async (engine: EngineInterface, recap: string) => {
  try {
    await clearSessionAndSubmitRecap(engine, recap);
  } catch {
    engine.ui.toast("Could not start a new session.");
    await offerRecapInThisSession(engine, recap);
  }
  await engine.store.delete(PENDING_HANDOFF_KEY);
};

const readPendingHandoff = async (engine: EngineInterface) => {
  const storedHandoff = await engine.store.get(PENDING_HANDOFF_KEY);
  return typeof storedHandoff === "string" && storedHandoff
    ? storedHandoff
    : undefined;
};

const resumePendingHandoff = async (engine: EngineInterface) => {
  const recap = await readPendingHandoff(engine);
  if (!recap) return;
  const fillResult = await engine.prompt.fill({ text: recap, mode: "replace" });
  if (fillResult.isFilled) await engine.store.delete(PENDING_HANDOFF_KEY);
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "handoff",
      description:
        "Summarize the session into a prompt that resumes the work; --new continues it in a fresh session",
      argumentHint: "[--new] [focus]",
    });
    await resumePendingHandoff($);

    return next(e);
  });

  on("command.run", { command: "handoff" }, async ($, e) => {
    const { isNewSession, focus } = parseHandoffArguments(e.args);
    const recapBuild = await buildRecap($, focus);
    if (recapBuild.failure !== undefined) return { text: recapBuild.failure };
    const { recap } = recapBuild;

    if (!isNewSession) return offerRecapInThisSession($, recap);

    await $.store.set(PENDING_HANDOFF_KEY, recap);
    $.clock.after(0, () => void handOffToNewSession($, recap));
    return { text: HANDING_OFF_MESSAGE };
  });
};
