import type {
  EngineInterface,
  PluginOptions,
  PromptSubmitAttachment,
  PromptSubmitInput,
  Register,
} from "claude-code";

const OPTIMIZER_RULES = `You rewrite a draft prompt for a coding agent so it is clearer and more specific.
The draft is inside <draft> tags. The working directory and recent conversation before it are context only:
use them to resolve references like "the bug" or "that file" to what they name, and nothing more.
Keep the author's intent exactly. State the goal and any constraints.
Name the files, inputs or commands the draft mentions, and say what "done" means.
Invent nothing the draft or the context does not imply: no new files, requirements or facts.
Output only the rewritten prompt, with no preamble, quotes or explanation.`;

const RECENT_MESSAGE_COUNT = 6;
const RECENT_MESSAGE_MAX_LENGTH = 500;

const FILLED_MESSAGE =
  "Prompt filled into the composer. Edit it or press Enter.";
const USAGE_MESSAGE =
  "Usage: /optimize <prompt>, or select text in the transcript and run /optimize.";
const FAILURE_EXIT_CODE = 1;
const OPTIMIZE_COMMAND_LINE = /^\/optimize(\s|$)/;

const REWRITTEN_MARKER = /rewritten prompt:\s*/i;

const WRAPPING_CODE_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;
const WRAPPING_QUOTES = /^(["'])([\s\S]*)\1$/;

const stripWrappingQuotes = (text: string) => {
  const wrappingQuoteMatch = WRAPPING_QUOTES.exec(text);
  if (!wrappingQuoteMatch) return text;
  const quote = wrappingQuoteMatch[1] ?? "";
  const innerText = wrappingQuoteMatch[2] ?? "";
  return innerText.includes(quote) ? text : innerText;
};

const stripWrappingFenceAndQuotes = (text: string) =>
  stripWrappingQuotes(
    text.trim().replace(WRAPPING_CODE_FENCE, "$1").trim()
  ).trim();

const extractRewrittenPrompt = (text: string) =>
  stripWrappingFenceAndQuotes(text.split(REWRITTEN_MARKER).at(-1)!);

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

const buildOptimizerPrompt = async (engine: EngineInterface, draft: string) => {
  const workingDirectory = await engine.session.cwd();
  const recentMessages = await describeRecentMessages(engine);
  const conversationSection = recentMessages
    ? `Recent conversation:\n${recentMessages}\n\n`
    : "";
  return `Working directory: ${workingDirectory}\n\n${conversationSection}<draft>\n${draft}\n</draft>`;
};

const readStringOption = (options: PluginOptions, key: string) => {
  const optionValue = options[key];
  return typeof optionValue === "string" ? optionValue.trim() : "";
};

const buildOptimizerRules = (instructions: string) =>
  instructions ? `${OPTIMIZER_RULES}\n${instructions}` : OPTIMIZER_RULES;

const readDraft = async (engine: EngineInterface, args: string) => {
  const typedDraft = args.trim();
  if (typedDraft) return typedDraft;
  const selection = await engine.ui.selection();
  return selection?.text.trim() ?? "";
};

const isOptimizeSubmission = (submission: PromptSubmitInput) =>
  submission.command
    ? submission.command.name === "optimize"
    : OPTIMIZE_COMMAND_LINE.test(submission.text);

const describeAttachedImage = (
  attachment: PromptSubmitAttachment,
  imageNumber: number
) => {
  const imageLabel = attachment.filename ?? `image ${imageNumber}`;
  return attachment.mediaType
    ? `${imageLabel} (${attachment.mediaType})`
    : imageLabel;
};

const describeAttachedImages = (
  attachments: readonly PromptSubmitAttachment[]
) => {
  const images = attachments.filter(
    (attachment) => attachment.type === "image"
  );
  if (images.length === 0) return undefined;
  const imageList = images
    .map((image, index) => describeAttachedImage(image, index + 1))
    .join(", ");
  const imageCount =
    images.length === 1
      ? "1 attached image"
      : `${images.length} attached images`;
  return `The /optimize command above was submitted with ${imageCount}: ${imageList}. They belong with the optimized prompt; refer to them when it runs.`;
};

const buildFailureResult = (text: string) => ({
  text,
  exitCode: FAILURE_EXIT_CODE,
});

export const register: Register = (on, options) => {
  const optimizerModel = readStringOption(options, "model") || "haiku";
  const optimizerRules = buildOptimizerRules(
    readStringOption(options, "instructions")
  );

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "optimize",
      description: "Rewrite a prompt to be clearer and more specific",
      argumentHint: "[draft, or select text first]",
    });

    return next(e);
  });

  on("command.run", { command: "optimize" }, async ($, e) => {
    const draft = await readDraft($, e.args);
    if (!draft) return buildFailureResult(USAGE_MESSAGE);

    $.ui.toast("Optimizing prompt…");
    const reply = await $.model.complete({
      model: optimizerModel,
      system: optimizerRules,
      prompt: await buildOptimizerPrompt($, draft),
      effort: "low",
      timeoutMs: 15000,
    });

    if (!reply.isAnswered) {
      return buildFailureResult(
        `Could not optimize the prompt (${reply.reason}).`
      );
    }

    const optimized = extractRewrittenPrompt(reply.text);
    if (!optimized) {
      return buildFailureResult("Could not optimize the prompt (empty reply).");
    }

    const fillResult = await $.prompt.fill({
      text: optimized,
      mode: "replace",
    });
    if (fillResult.isFilled) {
      return { text: FILLED_MESSAGE, context: [optimized] };
    }

    const copy = await $.ui.copy({ text: optimized });
    return {
      text: copy.isCopied ? `${optimized}\n\n(Copied to clipboard)` : optimized,
      context: [optimized],
    };
  });

  on("prompt.submit", async (_, e, next) => {
    if (!isOptimizeSubmission(e) || !e.attachments) return next(e);
    const attachedImagesNote = describeAttachedImages(e.attachments);
    if (!attachedImagesNote) return next(e);
    return next({ ...e, context: [...(e.context ?? []), attachedImagesNote] });
  });
};
