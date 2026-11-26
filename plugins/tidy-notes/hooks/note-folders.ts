import type { EngineInterface } from "claude-code";

type NoteStore = { name: string; homeFolder: string };

export const NOTE_STORES: NoteStore[] = [
  { name: "handoffs", homeFolder: ".local/share/handoffs" },
  { name: "project-notes", homeFolder: ".local/share/project-notes" },
  { name: "small-plans", homeFolder: ".local/share/small-plans" },
  { name: "brainstorm", homeFolder: ".local/share/brainstorm" },
];

async function readStoreRootOverrides(engine: EngineInterface) {
  return {
    handoffs: await engine.env.get("HANDOFFS_DIR"),
    "project-notes": await engine.env.get("PROJECT_NOTES_DIR"),
    "small-plans": await engine.env.get("SMALL_PLANS_DIR"),
    brainstorm: await engine.env.get("BRAINSTORM_DIR"),
  } as Record<string, string | undefined>;
}

export async function resolveStoreRoot(
  engine: EngineInterface,
  store: NoteStore
) {
  return (
    (await readStoreRootOverrides(engine))[store.name] ||
    `${(await engine.env.get("HOME")) ?? ""}/${store.homeFolder}`
  );
}

export async function listFilesUnder(
  engine: EngineInterface,
  folder: string
): Promise<string[]> {
  const entries = await engine.fs.list(folder).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.kind === "dir"
        ? listFilesUnder(engine, `${folder}/${entry.name}`)
        : entry.kind === "file"
          ? [`${folder}/${entry.name}`]
          : []
    )
  );
  return nested.flat();
}
