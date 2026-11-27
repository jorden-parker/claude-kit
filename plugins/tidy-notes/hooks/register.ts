import type { EngineInterface, Register } from "claude-code";
import { listFilesUnder, NOTE_STORES, resolveStoreRoot } from "./note-folders";
import { isContentPreserved, tidyNote } from "./tidy-format";

type StoreReport = {
  name: string;
  fileCount: number;
  changedPaths: string[];
};

const COMMAND_NAME = "tidy-notes";
const TOOL_NAME = "tidy_notes";
const QUALIFIED_TOOL_NAME = `mcp__tidy-notes__${TOOL_NAME}`;
const APPLY_ARGUMENT = /^apply$/i;
const TIDY_NOTES_COMMAND_PREFIX = `/${COMMAND_NAME} `;
const SUBCOMMAND_SUGGESTIONS = [
  { text: "apply", description: "Write the changes instead of a dry run" },
];

const buildInstruction = (isApply: boolean) =>
  isApply
    ? `Call ${QUALIFIED_TOOL_NAME} with apply: true. Show the user its report as it is.`
    : `Call ${QUALIFIED_TOOL_NAME} with no arguments, which is a dry run that writes nothing. Show the user its report as it is, and tell them /tidy-notes apply writes the changes.`;

const askClaude = (engine: EngineInterface, instruction: string) => {
  engine.clock.after(0, () => void engine.prompt.submit({ text: instruction }));
};

type Formatter = typeof tidyNote;

const describeFailure = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function tidyStore(
  engine: EngineInterface,
  store: (typeof NOTE_STORES)[number],
  isApply: boolean,
  problems: string[],
  formatter: Formatter
): Promise<StoreReport> {
  const root = await resolveStoreRoot(engine, store);
  const paths = (await listFilesUnder(engine, root)).filter((path) =>
    path.endsWith(".md")
  );
  const changedPaths: string[] = [];
  for (const path of paths) {
    const label = `${store.name}${path.slice(root.length)}`;
    let before: string;
    try {
      before = String(await engine.fs.read(path));
    } catch (error) {
      problems.push(`${label}: could not read: ${describeFailure(error)}`);
      continue;
    }
    const result = formatter(before, store.name, path.split("/").pop() ?? "");
    problems.push(...result.problems.map((problem) => `${label}: ${problem}`));
    if (result.text === before) continue;
    if (!isContentPreserved(before, result.text)) {
      problems.push(`${label}: skipped, tidying would change its content`);
      continue;
    }
    try {
      if (isApply) await engine.fs.write(path, result.text);
    } catch (error) {
      problems.push(`${label}: could not write: ${describeFailure(error)}`);
      continue;
    }
    changedPaths.push(label);
  }
  return { name: store.name, fileCount: paths.length, changedPaths };
}

export async function tidyStores(
  engine: EngineInterface,
  isApply: boolean,
  formatter: Formatter = tidyNote
) {
  const problems: string[] = [];
  const reports: StoreReport[] = [];
  for (const store of NOTE_STORES)
    reports.push(await tidyStore(engine, store, isApply, problems, formatter));
  const verb = isApply ? "changed" : "would change";
  return [
    isApply ? "Applied." : "Dry run, nothing was written.",
    ...reports.map(
      (report) =>
        `${report.name}: ${report.changedPaths.length} of ${report.fileCount} ${verb}`
    ),
    ...reports.flatMap((report) =>
      report.changedPaths.map((path) => `  ${path}`)
    ),
    ...(problems.length
      ? [
          `Problems (${problems.length}):`,
          ...problems.map((problem) => `  ${problem}`),
        ]
      : []),
  ].join("\n");
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description:
        "Reformat the saved handoffs, project notes, small plans and brainstorms consistently without changing their content; a dry run unless you pass apply",
      argumentHint: "[apply]",
    });
    await $.tool.register({
      name: TOOL_NAME,
      description:
        "Reformats the Markdown files in the handoffs, project-notes, small-plans and brainstorm stores under ~/.local/share without changing their content. By default a dry run that lists the files that would change and the problems found, writing nothing; with apply true it writes the changed files. Call it for /tidy-notes or when the user asks to tidy, clean up or reformat saved notes.",
      inputSchema: {
        type: "object",
        properties: {
          apply: {
            type: "boolean",
            description: "Write the changes. Leave unset for a dry run.",
          },
        },
      },
      isDeferred: true,
    });
    return next(e);
  });

  on("command.run", { command: COMMAND_NAME }, async ($, e) => {
    const isApply = APPLY_ARGUMENT.test(e.args.trim());
    askClaude($, buildInstruction(isApply));
    return { text: isApply ? "Tidying the notes…" : "Checking the notes…" };
  });

  on("tool.call", async ($, e, next) => {
    if (e.tool !== (QUALIFIED_TOOL_NAME as string)) return next(e);
    const { apply } = e as unknown as { apply?: boolean };
    return { result: await tidyStores($, apply === true) };
  });

  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstTidyNotesArgument =
      e.text.startsWith(TIDY_NOTES_COMMAND_PREFIX) &&
      e.start === TIDY_NOTES_COMMAND_PREFIX.length;
    if (!isFirstTidyNotesArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingSubcommands = SUBCOMMAND_SUGGESTIONS.filter((subcommand) =>
      subcommand.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingSubcommands] };
  });
};
