import type {
  EngineInterface,
  HttpResponse,
  ModelCompleteResult,
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

const extractRewrittenPrompt = (text: string, draft: string) => {
  const rewrittenPrompt = stripWrappingFenceAndQuotes(
    text.split(REWRITTEN_MARKER).at(-1)!
  );
  return UNSEEN_CONTEXT_ASIDE.test(draft)
    ? rewrittenPrompt
    : dropLeadingAsides(rewrittenPrompt);
};

const truncateMessageText = (text: string) => {
  const characters = Array.from(text);
  return characters.length > RECENT_MESSAGE_MAX_LENGTH
    ? `${characters.slice(0, RECENT_MESSAGE_MAX_LENGTH).join("")}…`
    : text;
};

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

const describeUnansweredReply = (
  reply: Extract<ModelCompleteResult, { isAnswered: false }>
) =>
  reply.reason === "api-error"
    ? `API error ${reply.status ?? "with no response"}, ${reply.error}`
    : reply.reason;

const BACKOFF_DELAYS_MS = [1000, 2000, 4000];
const TRANSIENT_API_ERRORS = new Set([
  "rate_limit",
  "overloaded",
  "server_error",
]);

const isTransientFailure = (reply: ModelCompleteResult) =>
  !reply.isAnswered &&
  reply.reason === "api-error" &&
  TRANSIENT_API_ERRORS.has(reply.error);

const completeWithBackoff = async (
  engine: EngineInterface,
  complete: () => Promise<ModelCompleteResult>
) => {
  let reply = await complete();
  for (const delayMs of BACKOFF_DELAYS_MS) {
    if (!isTransientFailure(reply)) break;
    await engine.clock.sleep(delayMs);
    reply = await complete();
  }
  return reply;
};

const LOCAL_MODEL = "local";
const OLLAMA_URL = "http://127.0.0.1:11434";
const OWN_OLLAMA_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
const OLLAMA_STATUS_TIMEOUT_MS = 3000;
const OLLAMA_REWRITE_TIMEOUT_SECONDS = 180;
const CURL_TIMED_OUT_EXIT_CODE = 28;
const STATUS_PREFIX = "✨ /optimize:";
const OLLAMA_MAX_REPLY_TOKENS = 1024;
const TIMED_OUT = Symbol("timed out");

type RewriteReply =
  { isAnswered: true; text: string } | { isAnswered: false; failure: string };

type OllamaReply = {
  models?: { name?: string }[];
  message?: { content?: string };
  done?: boolean;
  error?: string;
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const parseOllamaReply = (text: string): OllamaReply => {
  try {
    return JSON.parse(text) as OllamaReply;
  } catch {
    return {};
  }
};

const waitForever = () => new Promise<never>(() => {});

const fetchFromOllama = async (
  engine: EngineInterface,
  path: string,
  timeoutMs: number
): Promise<HttpResponse | string> => {
  const answerer = `Ollama at ${OLLAMA_URL}`;
  const stopWaiting = new AbortController();
  try {
    const response = await Promise.race([
      engine.http.fetch(`${OLLAMA_URL}${path}`),
      engine.clock
        .sleep(timeoutMs, { signal: stopWaiting.signal })
        .then((): typeof TIMED_OUT => TIMED_OUT, waitForever),
    ]);
    return response === TIMED_OUT
      ? `${answerer} did not answer within ${timeoutMs / 1000} seconds`
      : response;
  } catch (error) {
    return `${answerer} did not answer: ${describeError(error)}`;
  } finally {
    stopWaiting.abort();
  }
};

const countTokens = (tokenCount: number) =>
  tokenCount === 1 ? "1 token" : `${tokenCount} tokens`;

const streamRewrite = async (
  engine: EngineInterface,
  model: string,
  system: string,
  prompt: string,
  logStep: (step: string) => void
): Promise<RewriteReply> => {
  const answerer = `${model} on Ollama at ${OLLAMA_URL}`;
  const startedAt = Date.now();
  let rewrite = "";
  let tokenCount = 0;
  let unparsedText = "";
  let errorOutput = "";
  let ollamaError: string | undefined;

  const readChatLine = (line: string) => {
    if (!line.trim()) return;
    const chunk = parseOllamaReply(line);
    if (chunk.error) {
      ollamaError = chunk.error;
      return;
    }
    const content = chunk.message?.content ?? "";
    if (!content) return;
    if (tokenCount === 0) {
      logStep(`first token after ${Date.now() - startedAt}ms`);
    }
    tokenCount += 1;
    rewrite += content;
    engine.ui.status(
      `${STATUS_PREFIX} writing on ${model}, ${countTokens(tokenCount)}`
    );
  };

  try {
    const chat = engine.process.spawn({
      argv: [
        "curl",
        "--silent",
        "--show-error",
        "--no-buffer",
        "--max-time",
        String(OLLAMA_REWRITE_TIMEOUT_SECONDS),
        "--header",
        "content-type: application/json",
        "--data-binary",
        "@-",
        `${OLLAMA_URL}/api/chat`,
      ],
      input: JSON.stringify({
        model,
        stream: true,
        think: false,
        options: { num_predict: OLLAMA_MAX_REPLY_TOKENS },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    let exit: { code: number | null } = { code: null };
    while (true) {
      const piece = await chat.next();
      if (piece.done) {
        exit = piece.value;
        break;
      }
      if (piece.value.stream === "stderr") {
        errorOutput += piece.value.text;
        continue;
      }
      const lines = (unparsedText + piece.value.text).split("\n");
      unparsedText = lines.pop() ?? "";
      lines.forEach(readChatLine);
    }
    readChatLine(unparsedText);

    if (ollamaError) {
      logStep(`Ollama error: ${ollamaError}`);
      return {
        isAnswered: false,
        failure: `Ollama error from ${model}: ${ollamaError}`,
      };
    }
    if (exit.code !== 0) {
      logStep(`curl exited ${exit.code}: ${errorOutput.trim()}`);
      return {
        isAnswered: false,
        failure:
          exit.code === CURL_TIMED_OUT_EXIT_CODE
            ? `${answerer} did not answer within ${OLLAMA_REWRITE_TIMEOUT_SECONDS} seconds`
            : `${answerer} did not answer: ${errorOutput.trim() || `curl exit code ${exit.code}`}`,
      };
    }
    logStep(`done in ${Date.now() - startedAt}ms, ${countTokens(tokenCount)}`);
    return { isAnswered: true, text: rewrite };
  } catch (error) {
    logStep(`could not run curl: ${describeError(error)}`);
    return {
      isAnswered: false,
      failure: `could not run curl for ${answerer}: ${describeError(error)}`,
    };
  }
};

const rewriteLocally = async (
  engine: EngineInterface,
  system: string,
  prompt: string
): Promise<RewriteReply> => {
  const logStep = (step: string) =>
    engine.ui.log(`/optimize ${step}`, { to: "debug" });
  try {
    engine.ui.status(`${STATUS_PREFIX} checking Ollama…`);
    const status = await fetchFromOllama(
      engine,
      "/api/ps",
      OLLAMA_STATUS_TIMEOUT_MS
    );
    if (typeof status === "string") {
      logStep(status);
      return { isAnswered: false, failure: status };
    }
    const loadedModel = parseOllamaReply(status.text).models?.[0]?.name;
    const rewriteModel = loadedModel ?? OWN_OLLAMA_MODEL;
    logStep(
      `rewrite model ${rewriteModel} (${loadedModel ? "loaded" : "not loaded"})`
    );
    engine.ui.status(
      loadedModel
        ? `${STATUS_PREFIX} waiting for ${rewriteModel}…`
        : `${STATUS_PREFIX} loading ${rewriteModel} (the first load can take a minute)…`
    );
    return await streamRewrite(engine, rewriteModel, system, prompt, logStep);
  } finally {
    engine.ui.status(undefined);
  }
};

const buildFailureResult = (text: string) => ({
  text,
  exitCode: FAILURE_EXIT_CODE,
});

const rewriteInTheCloud = async (
  engine: EngineInterface,
  optimizerModel: string,
  system: string,
  prompt: string
): Promise<RewriteReply> => {
  const rewriteOnce = (model: string) =>
    engine.model.complete({
      model,
      system,
      prompt,
      effort: "low",
      timeoutMs: 15000,
    });
  let reply = await completeWithBackoff(engine, () =>
    rewriteOnce(optimizerModel)
  );
  if (!reply.isAnswered && reply.reason === "api-error") {
    const sessionModel = await engine.session.model();
    if (sessionModel !== optimizerModel) {
      reply = await rewriteOnce(sessionModel);
    }
  }
  return reply.isAnswered
    ? { isAnswered: true, text: reply.text }
    : { isAnswered: false, failure: describeUnansweredReply(reply) };
};

const EMPTY_REPLY_MESSAGE = "Could not optimize the prompt (empty reply).";
const REWRITE_AGENT_TYPE = "general-purpose";
const REWRITE_AGENT_DESCRIPTION = "Rewrite the draft prompt";
const AGENT_PREAMBLE =
  "Do not use any tools for this task and do not carry out the draft: answer straight away with the rewritten prompt.";
const SUBAGENT_REWRITING_MESSAGE = "A subagent is rewriting the prompt…";
const REWRITE_AGENT_DONE_NOTICE = "The /optimize subagent finished.";

type AwaitedRewrite = {
  draft: string;
  promptText: string;
  agentId?: string;
  turnId?: string;
};

const isAwaitedTurn = (
  awaitedRewrite: AwaitedRewrite,
  turn: { turnId: string; agentId?: string }
) =>
  awaitedRewrite.turnId === turn.turnId ||
  (turn.agentId !== undefined && awaitedRewrite.agentId === turn.agentId);

const isBehindApiProxy = async (engine: EngineInterface) =>
  Boolean(await engine.env.get("ANTHROPIC_BASE_URL"));

const offerRewrite = async (engine: EngineInterface, optimized: string) => {
  const fillResult = await engine.prompt.fill({
    text: optimized,
    mode: "replace",
  });
  if (fillResult.isFilled) {
    return { text: FILLED_MESSAGE, context: [optimized] };
  }

  const copy = await engine.ui.copy({ text: optimized });
  return {
    text: copy.isCopied ? `${optimized}\n\n(Copied to clipboard)` : optimized,
    context: [optimized],
  };
};

const deliverRewrite = async (
  engine: EngineInterface,
  replyText: string,
  draft: string
) => {
  const optimized = extractRewrittenPrompt(replyText, draft);
  return optimized
    ? offerRewrite(engine, optimized)
    : buildFailureResult(EMPTY_REPLY_MESSAGE);
};

export const register: Register = (on, options) => {
  const optimizerModel = readStringOption(options, "model") || LOCAL_MODEL;
  const optimizerRules = buildOptimizerRules(
    readStringOption(options, "instructions")
  );
  let pendingAttachedImageList: string | undefined;
  let awaitedRewrite: AwaitedRewrite | undefined;
  let rewriteAgentId: string | undefined;

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

    $.ui.toast("✨ Optimizing prompt…");
    const optimizerPrompt = await buildOptimizerPrompt(
      $,
      draft,
      attachedImageList
    );
    const isCloudModel = optimizerModel !== LOCAL_MODEL;
    if (isCloudModel && (await isBehindApiProxy($))) {
      const promptText = `${AGENT_PREAMBLE}\n\n${optimizerRules}\n\n${optimizerPrompt}`;
      const spawnResult = await $.agent.spawn({
        prompt: promptText,
        description: REWRITE_AGENT_DESCRIPTION,
        subagentType: REWRITE_AGENT_TYPE,
        model: optimizerModel,
      });
      if (spawnResult.deny !== undefined) {
        return buildFailureResult(
          `Could not optimize the prompt (${spawnResult.deny}).`
        );
      }
      awaitedRewrite = { draft, promptText, agentId: spawnResult.agentId };
      rewriteAgentId = spawnResult.agentId;
      $.ui.log(
        `/optimize subagent started on ${optimizerModel}, agent ${spawnResult.agentId ?? "with no id"}`,
        { to: "debug" }
      );
      $.ui.status(
        `${STATUS_PREFIX} a subagent is rewriting on ${optimizerModel}…`
      );
      return { text: SUBAGENT_REWRITING_MESSAGE };
    }
    const reply = isCloudModel
      ? await rewriteInTheCloud(
          $,
          optimizerModel,
          optimizerRules,
          optimizerPrompt
        )
      : await rewriteLocally($, optimizerRules, optimizerPrompt);

    if (!reply.isAnswered) {
      return buildFailureResult(
        `Could not optimize the prompt (${reply.failure}).`
      );
    }

    return deliverRewrite($, reply.text, draft);
  });

  on("turn.start", (_, e, next) => {
    if (awaitedRewrite && e.text.includes(awaitedRewrite.promptText)) {
      awaitedRewrite = { ...awaitedRewrite, turnId: e.turnId };
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const turnResult = await next(e);
    if (!awaitedRewrite || !isAwaitedTurn(awaitedRewrite, e)) {
      return turnResult;
    }
    const { draft } = awaitedRewrite;
    awaitedRewrite = undefined;
    rewriteAgentId = e.agentId;
    $.ui.log(`/optimize subagent ended with ${e.answer.length} characters`, {
      to: "debug",
    });

    const outcome = await deliverRewrite($, e.answer, draft);
    $.ui.status(undefined);
    $.ui.log(outcome.text);
    return turnResult;
  });

  on("prompt.submit", async (_, e, next) => {
    const isRewriteAgentReport =
      e.origin?.kind === "peer" &&
      rewriteAgentId !== undefined &&
      e.text.includes(`<agent-message from="${rewriteAgentId}">`);
    if (isRewriteAgentReport) {
      rewriteAgentId = undefined;
      return { drop: REWRITE_AGENT_DONE_NOTICE };
    }
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
