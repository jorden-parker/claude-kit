import type { Register } from "claude-code";

const OPTIMIZER_RULES = `You rewrite a draft prompt for a coding agent so it is clearer and more specific.
Keep the author's intent exactly. State the goal and any constraints.
Name the files, inputs or commands the draft mentions, and say what "done" means.
Invent nothing the draft does not imply: no new files, requirements or facts.
Output only the rewritten prompt, with no preamble, quotes or explanation.`;

const REWRITTEN_MARKER = /rewritten prompt:\s*/i;

const extractRewrittenPrompt = (text: string) =>
  text.split(REWRITTEN_MARKER).at(-1)!.trim();

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "optimize",
      description: "Rewrite a prompt to be clearer and more specific",
    });

    return next(e);
  });

  on("command.run", { command: "optimize" }, async ($, e) => {
    const draft = e.args.trim();
    if (!draft) return { text: "Usage: /optimize <prompt>" };

    const reply = await $.model.complete({
      model: "haiku",
      system: OPTIMIZER_RULES,
      prompt: draft,
      effort: "low",
      timeoutMs: 120000,
    });

    if (!reply.isAnswered) {
      return { text: `Could not optimize the prompt (${reply.reason}).` };
    }

    const optimized = extractRewrittenPrompt(reply.text);
    const copy = await $.ui.copy({ text: optimized });
    return {
      text: copy.isCopied ? `${optimized}\n\n(Copied to clipboard)` : optimized,
    };
  });
};
