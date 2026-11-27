import type {
  EngineInterface,
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";
import { tidyStores } from "./register";

const TIDY_TOOL = "mcp__tidy-notes__tidy_notes";
const SHARE = "/home/tester/.local/share";
const MESSY_NOTE = "---\ntitle: t\n---\nbody \n* item\n";
const TIDY_NOTE = "---\ntitle: t\n---\n\nbody\n- item\n";
const CLEAN_BRAINSTORM = "# One\n\ntext\n";

type Recorded = {
  files: Map<string, string>;
  writes: string[];
  submittedPrompts: string[];
};

const mockEngine = (
  on: On,
  seededFiles: Record<string, string>,
  environment: Record<string, string> = {},
  odd: {
    linkNames?: string[];
    unreadable?: string[];
    unwritable?: string[];
  } = {}
): Recorded => {
  const recorded: Recorded = {
    files: new Map(Object.entries(seededFiles)),
    writes: [],
    submittedPrompts: [],
  };
  on("env.get", (_, e) => ({
    value: { HOME: "/home/tester", ...environment }[e.name],
  }));
  on("fs.read", (_, e) => {
    if (odd.unreadable?.includes(e.path)) return { deny: "permission denied" };
    return { value: recorded.files.get(e.path) ?? "" };
  });
  on("fs.write", (_, e) => {
    if (odd.unwritable?.includes(e.path)) return { deny: "disk full" };
    recorded.files.set(e.path, e.text);
    recorded.writes.push(e.path);
    return { value: undefined };
  });
  on("fs.list", (_, e) => {
    const childNames = new Map<string, "file" | "dir">();
    for (const path of recorded.files.keys()) {
      if (!path.startsWith(`${e.path}/`)) continue;
      const [childName, ...deeper] = path.slice(e.path.length + 1).split("/");
      childNames.set(childName ?? "", deeper.length ? "dir" : "file");
    }
    return {
      value: [...childNames].map(([name, kind]) => ({
        name,
        kind: odd.linkNames?.includes(name) ? "other" : kind,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("prompt.submit", (_, e) => {
    recorded.submittedPrompts.push(e.text);
    return { text: e.text };
  });
  return recorded;
};

const callTool = ($: Engine, toolInput: object = {}) =>
  $.tool.call({ tool: TIDY_TOOL, ...toolInput } as never) as Promise<{
    result?: string;
  }>;

const seededStores = {
  [`${SHARE}/handoffs/repo/001-a.md`]: MESSY_NOTE,
  [`${SHARE}/project-notes/repo/fact/2026-01-01-b.md`]: TIDY_NOTE,
  [`${SHARE}/brainstorm/repo/idea.md`]: CLEAN_BRAINSTORM,
  [`${SHARE}/brainstorm/repo/picture.png`]: "not markdown  \n",
};

test("a dry run reports what would change and writes nothing", async ($, on) => {
  const { writes } = mockEngine(on, seededStores);

  const reply = await callTool($);

  expect(writes).toEqual([]);
  expect(reply.result).toContain("Dry run");
  expect(reply.result).toContain("handoffs: 1 of 1 would change");
  expect(reply.result).toContain("handoffs/repo/001-a.md");
  expect(reply.result).toContain("project-notes: 0 of 1 would change");
  expect(reply.result).toContain("brainstorm: 0 of 1 would change");
});

test("apply writes the changed files only and leaves non-markdown alone", async ($, on) => {
  const { files, writes } = mockEngine(on, seededStores);

  const reply = await callTool($, { apply: true });

  expect(writes).toEqual([`${SHARE}/handoffs/repo/001-a.md`]);
  expect(files.get(`${SHARE}/handoffs/repo/001-a.md`)).toBe(TIDY_NOTE);
  expect(files.get(`${SHARE}/brainstorm/repo/picture.png`)).toBe(
    "not markdown  \n"
  );
  expect(reply.result).toContain("handoffs: 1 of 1 changed");
});

test("a store folder that does not exist is skipped silently", async ($, on) => {
  mockEngine(on, {});

  const reply = await callTool($);

  expect(reply.result).toContain("handoffs: 0 of 0 would change");
  expect(reply.result).not.toContain("Problems");
});

test("store folders follow the environment overrides", async ($, on) => {
  mockEngine(
    on,
    { "/elsewhere/repo/a.md": MESSY_NOTE },
    { HANDOFFS_DIR: "/elsewhere" }
  );

  const reply = await callTool($);

  expect(reply.result).toContain("handoffs: 1 of 1 would change");
});

test("problems are listed with their file", async ($, on) => {
  mockEngine(on, { [`${SHARE}/brainstorm/repo/Bad Name.md`]: "# One\n" });

  const reply = await callTool($);

  expect(reply.result).toContain("Problems (1)");
  expect(reply.result).toContain("brainstorm/repo/Bad Name.md: file name");
});

test("the content guard skips a file whose lines would change", async () => {
  const written: string[] = [];
  const fakeEngine = {
    env: {
      get: async (name: string) =>
        name === "HOME" ? "/home/tester" : undefined,
    },
    fs: {
      list: async (path: string) =>
        path === `${SHARE}/brainstorm`
          ? [
              {
                name: "odd.md",
                kind: "file",
                size: 0,
                mtimeMs: 0,
                isLink: false,
              },
            ]
          : [],
      read: async () => "# One\n\nkeep\nlose\n",
      write: async (path: string) => void written.push(path),
    },
  } as unknown as EngineInterface;
  const dropLine = (text: string) => ({
    text: text.replace("lose\n", ""),
    problems: [],
  });

  const report = await tidyStores(fakeEngine, true, dropLine);

  expect(written).toEqual([]);
  expect(report).toContain("Problems (1)");
  expect(report).toContain(
    "brainstorm/odd.md: skipped, tidying would change its content"
  );
});

test("a file that cannot be read becomes a problem and the walk goes on", async ($, on) => {
  const { files } = mockEngine(
    on,
    {
      [`${SHARE}/handoffs/repo/001-a.md`]: MESSY_NOTE,
      [`${SHARE}/handoffs/repo/002-b.md`]: MESSY_NOTE,
    },
    {},
    { unreadable: [`${SHARE}/handoffs/repo/001-a.md`] }
  );

  const reply = await callTool($, { apply: true });

  expect(files.get(`${SHARE}/handoffs/repo/002-b.md`)).toBe(TIDY_NOTE);
  expect(reply.result).toContain("handoffs: 1 of 2 changed");
  expect(reply.result).toContain("handoffs/repo/001-a.md: could not read: ");
  expect(reply.result).toContain("permission denied");
});

test("a file that cannot be written becomes a problem and the walk goes on", async ($, on) => {
  const { files } = mockEngine(
    on,
    {
      [`${SHARE}/handoffs/repo/001-a.md`]: MESSY_NOTE,
      [`${SHARE}/handoffs/repo/002-b.md`]: MESSY_NOTE,
    },
    {},
    { unwritable: [`${SHARE}/handoffs/repo/001-a.md`] }
  );

  const reply = await callTool($, { apply: true });

  expect(files.get(`${SHARE}/handoffs/repo/002-b.md`)).toBe(TIDY_NOTE);
  expect(reply.result).toContain("handoffs/repo/001-a.md: could not write: ");
  expect(reply.result).toContain("handoffs: 1 of 2 changed");
});

test("symbolic links and other non-regular entries are not read", async ($, on) => {
  mockEngine(
    on,
    { [`${SHARE}/handoffs/repo/link.md`]: MESSY_NOTE },
    {},
    { linkNames: ["link.md"] }
  );

  const reply = await callTool($);

  expect(reply.result).toContain("handoffs: 0 of 0 would change");
});

test("an empty environment override falls back to the default folder", async ($, on) => {
  mockEngine(
    on,
    { [`${SHARE}/handoffs/repo/001-a.md`]: MESSY_NOTE },
    { HANDOFFS_DIR: "" }
  );

  const reply = await callTool($);

  expect(reply.result).toContain("handoffs: 1 of 1 would change");
});

const runCommand = async ($: Engine, on: On, commandArguments: string) => {
  const clock = mock.clock(on);
  const recorded = mockEngine(on, {});
  await $.command.run({
    command: "tidy-notes",
    args: commandArguments,
  } as never);
  await clock.settle();
  return recorded;
};

test("/tidy-notes asks Claude for a dry run", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "");

  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(TIDY_TOOL);
  expect(submittedPrompts[0]).toContain("dry run");
  expect(submittedPrompts[0]).not.toContain("apply: true");
});

test("/tidy-notes apply asks Claude to apply", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "apply");

  expect(submittedPrompts[0]).toContain("apply: true");
});

const autocompleteAt = (text: string) => {
  const start = text.search(/\S*$/);
  return { text, cursor: text.length, token: text.slice(start), start };
};

type AutocompleteCall = {
  autocomplete: (
    input: PromptAutocompleteInput
  ) => Promise<PromptAutocompleteResult>;
};

const autocomplete = ($: Engine, text: string) =>
  ($.prompt as unknown as AutocompleteCall).autocomplete(autocompleteAt(text));

const suggestedTexts = (reply: { suggestions: readonly { text: string }[] }) =>
  reply.suggestions.map((suggestion) => suggestion.text);

test("typing the first word after /tidy-notes suggests apply", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/tidy-notes ");

  expect(suggestedTexts(reply)).toEqual(["apply"]);
});

test("a partly typed /tidy-notes action narrows the suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const matchingReply = await autocomplete($, "/tidy-notes ap");
  const otherReply = await autocomplete($, "/tidy-notes x");

  expect(suggestedTexts(matchingReply)).toEqual(["apply"]);
  expect(suggestedTexts(otherReply)).toEqual([]);
});

test("later words, other words and other commands get no /tidy-notes suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const laterWordReply = await autocomplete($, "/tidy-notes apply ap");
  const otherReply = await autocomplete($, "/optimize ap");
  const commandReply = await autocomplete($, "/tidy-notes");

  expect(suggestedTexts(laterWordReply)).toEqual([]);
  expect(suggestedTexts(otherReply)).toEqual([]);
  expect(suggestedTexts(commandReply)).toEqual([]);
});
