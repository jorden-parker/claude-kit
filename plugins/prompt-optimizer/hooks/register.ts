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
You cannot open files or view images, and that is expected: the agent that receives the rewritten prompt
runs inside the working directory and sees every attached image. Never say what you cannot see,
never apologise for it, and never ask the agent to check something on your behalf.
A token like [Image #N] names an image the agent will see: keep it verbatim where the draft uses it.
Keep the author's intent exactly. State the goal and any constraints.
Keep every action, target and constraint in the draft. Do not add, drop, swap or reorder tasks, and do not widen or narrow the scope.
Use the recent conversation only to name what a reference points to. If a reference is ambiguous, keep the draft's wording rather than guess.
If the draft is already clear, return it with minimal edits.
Name the files, inputs or commands the draft mentions, and say what "done" means.
Invent nothing the draft or the context does not imply: no new files, requirements or facts.
Do not restate the working directory; the agent already knows it.
Write in the author's voice, addressed to the agent, as a prompt ready to send.
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

const PARAGRAPH_BREAK = /\n\s*\n/;
const UNSEEN_CONTEXT_ASIDE =
  /\b(?:I|we)\s+(?:can(?:')?t|cannot|can not|could(?:n't| not)|do(?:n't| not)|did(?:n't| not))\s+(?:actually\s+|directly\s+)?(?:see|view|open|read|access|inspect|look at)\b|\bfrom here\b|\bwithout (?:seeing|viewing|access to)\b/i;
const WORKING_DIRECTORY_LINE = /^working directory:/i;

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

const isLeadingAside = (paragraph: string) =>
  UNSEEN_CONTEXT_ASIDE.test(paragraph) ||
  WORKING_DIRECTORY_LINE.test(paragraph);

const dropLeadingAsides = (text: string) => {
  const paragraphs = text.split(PARAGRAPH_BREAK);
  let firstKeptIndex = 0;
  while (
    firstKeptIndex < paragraphs.length - 1 &&
    isLeadingAside(paragraphs[firstKeptIndex]!.trim())
  ) {
    firstKeptIndex += 1;
  }
  return paragraphs.slice(firstKeptIndex).join("\n\n").trim();
};

const extractRewrittenPrompt = (text: string) =>
  dropLeadingAsides(
    stripWrappingFenceAndQuotes(text.split(REWRITTEN_MARKER).at(-1)!)
  );

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

const buildOptimizerPrompt = async (
  engine: EngineInterface,
  draft: string,
  attachedImageList: string | undefined
) => {
  const workingDirectory = await engine.session.cwd();
  const recentMessages = await describeRecentMessages(engine);
  const conversationSection = recentMessages
    ? `Recent conversation:\n${recentMessages}\n\n`
    : "";
  const attachedImagesSection = attachedImageList
    ? `Attached images (the agent will see them; the rewriter does not): ${attachedImageList}\n\n`
    : "";
  return `Working directory: ${workingDirectory}\n\n${conversationSection}${attachedImagesSection}<draft>\n${draft}\n</draft>`;
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

const listAttachedImages = (attachments: readonly PromptSubmitAttachment[]) => {
  const images = attachments.filter(
    (attachment) => attachment.type === "image"
  );
  if (images.length === 0) return undefined;
  return {
    imageCount: images.length,
    imageList: images
      .map((image, index) => describeAttachedImage(image, index + 1))
      .join(", "),
  };
};

const describeAttachedImages = (imageCount: number, imageList: string) => {
  const imageCountLabel =
    imageCount === 1 ? "1 attached image" : `${imageCount} attached images`;
  return `The /optimize command above was submitted with ${imageCountLabel}: ${imageList}. They belong with the optimized prompt; refer to them when it runs.`;
};

const buildFailureResult = (text: string) => ({
  text,
  exitCode: FAILURE_EXIT_CODE,
});

export const register: Register = (on, options) => {
  const optimizerModel = readStringOption(options, "model") || "sonnet";
  const optimizerRules = buildOptimizerRules(
    readStringOption(options, "instructions")
  );
  let pendingAttachedImageList: string | undefined;

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
    const attachedImageList = pendingAttachedImageList;
    pendingAttachedImageList = undefined;
    if (!draft) return buildFailureResult(USAGE_MESSAGE);

    $.ui.toast("Optimizing prompt…");
    const reply = await $.model.complete({
      model: optimizerModel,
      system: optimizerRules,
      prompt: await buildOptimizerPrompt($, draft, attachedImageList),
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
    const attachedImages = listAttachedImages(e.attachments);
    if (!attachedImages) return next(e);
    pendingAttachedImageList = attachedImages.imageList;
    const attachedImagesNote = describeAttachedImages(
      attachedImages.imageCount,
      attachedImages.imageList
    );
    return next({ ...e, context: [...(e.context ?? []), attachedImagesNote] });
  });
};
