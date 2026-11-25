import type { EngineInterface } from "claude-code";

type NoteStore = { name: string; homeFolder?: string };
type FolderVerdict = {
  label: string;
  fileCount: number;
  target: string;
  evidence: string;
};

export const NOTE_STORES: NoteStore[] = [
  { name: "handoffs" },
  { name: "project-notes" },
  { name: "small-plans", homeFolder: ".local/share/small-plans" },
  { name: "brainstorm" },
];

const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const CLAUDE_WORKTREE_PATH = /^(.+?)\/\.claude\/worktrees\/[^/]+/;
const CWD_LINE = /^cwd: (.+)$/m;
const PROJECT_LINE = /^project: .*$/m;
const HANDOFF_NUMBER = /^(\d+)-(.*)$/;
const HANDOFF_NUMBER_WIDTH = 3;

export const toProjectName = (folder: string) => {
  const lastSegment = folder.split("/").filter(Boolean).pop() ?? "";
  const projectName = lastSegment.replace(/[^A-Za-z0-9._-]+/g, "-");
  return /[A-Za-z0-9]/.test(projectName) ? projectName : "";
};

function runGit(engine: EngineInterface, argv: string[]) {
  return engine.process
    .run(["git", ...argv])
    .then((outcome) => (outcome.exitCode === 0 ? outcome.stdout.trim() : ""))
    .catch(() => "");
}

async function resolveRepository(engine: EngineInterface, folder: string) {
  const commonGitFolder = await runGit(engine, [
    "-C",
    folder,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const repositoryFolder =
    commonGitFolder.replace(GIT_FOLDER_SUFFIX, "") ||
    folder.match(CLAUDE_WORKTREE_PATH)?.[1];
  return {
    folder: repositoryFolder || folder,
    isVerified: Boolean(repositoryFolder),
  };
}

export async function resolveRepositoryFolder(
  engine: EngineInterface,
  folder: string
) {
  return (await resolveRepository(engine, folder)).folder;
}

async function readStoreRootOverrides(engine: EngineInterface) {
  return {
    handoffs: await engine.env.get("HANDOFFS_DIR"),
    "project-notes": await engine.env.get("PROJECT_NOTES_DIR"),
    "small-plans": await engine.env.get("SMALL_PLANS_DIR"),
    brainstorm: await engine.env.get("BRAINSTORM_DIR"),
  } as Record<string, string | undefined>;
}

async function resolveStoreRoot(engine: EngineInterface, store: NoteStore) {
  return (
    (await readStoreRootOverrides(engine))[store.name] ??
    `${(await engine.env.get("HOME")) ?? ""}/${store.homeFolder ?? `.claude/${store.name}`}`
  );
}

export async function listStoreRoots(engine: EngineInterface) {
  return Promise.all(
    NOTE_STORES.map((store) => resolveStoreRoot(engine, store))
  );
}

async function listFilesUnder(
  engine: EngineInterface,
  folder: string
): Promise<string[]> {
  const entries = await engine.fs.list(folder).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.kind === "dir"
        ? listFilesUnder(engine, `${folder}/${entry.name}`)
        : [`${folder}/${entry.name}`]
    )
  );
  return nested.flat();
}

async function listProjectFolders(engine: EngineInterface, root: string) {
  return (await engine.fs.list(root).catch(() => []))
    .filter((entry) => entry.kind === "dir")
    .map((entry) => entry.name);
}

async function readRecordedCwds(engine: EngineInterface, files: string[]) {
  const texts = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map((file) => engine.fs.read(file).catch(() => ""))
  );
  return [
    ...new Set(
      texts.flatMap((text) => text.match(CWD_LINE)?.[1]?.trim() ?? [])
    ),
  ];
}

async function listWorktreeNames(engine: EngineInterface, folder: string) {
  return (
    await runGit(engine, ["-C", folder, "worktree", "list", "--porcelain"])
  )
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => toProjectName(line.slice("worktree ".length)));
}

const pluralFiles = (count: number) => `${count} file${count === 1 ? "" : "s"}`;

const describeAudit = (
  misplaced: FolderVerdict[],
  unresolved: string[],
  inPlaceCount: number
) =>
  [
    `${inPlaceCount} folders are already under their repository's name.`,
    misplaced.length
      ? `Misplaced, move each with ${QUALIFIED_MOVE_TOOL_NAME}:\n${misplaced
          .map(
            (folder) =>
              `- ${folder.label} -> ${folder.target} (${pluralFiles(folder.fileCount)}; ${folder.evidence})`
          )
          .join("\n")}`
      : "No folder is misplaced.",
    unresolved.length
      ? `No repository found for these; ask the user where each belongs:\n${unresolved.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

export const QUALIFIED_MOVE_TOOL_NAME = "mcp__project-notes__move_note_folder";

type KnownTargets = Map<string, { target: string; evidence: string }>;
type ScannedFolder = {
  label: string;
  folderName: string;
  fileCount: number;
  hasCwd: boolean;
};

async function collectWorktreeTargets(
  engine: EngineInterface,
  sessionFolder: string,
  currentProject: string
) {
  const knownTargets: KnownTargets = new Map();
  for (const worktreeName of await listWorktreeNames(engine, sessionFolder))
    if (worktreeName !== currentProject)
      knownTargets.set(worktreeName, {
        target: currentProject,
        evidence: `a worktree of ${currentProject}`,
      });
  return knownTargets;
}

async function learnTargetsFromCwds(
  engine: EngineInterface,
  folderName: string,
  cwds: string[],
  knownTargets: KnownTargets
) {
  for (const cwd of cwds) {
    const repository = await resolveRepository(engine, cwd);
    if (repository.isVerified)
      knownTargets.set(folderName, {
        target: toProjectName(repository.folder),
        evidence: `cwd ${cwd}`,
      });
  }
}

async function scanStores(engine: EngineInterface, knownTargets: KnownTargets) {
  const scanned: ScannedFolder[] = [];
  for (const store of NOTE_STORES) {
    const root = await resolveStoreRoot(engine, store);
    for (const folderName of await listProjectFolders(engine, root)) {
      const files = await listFilesUnder(engine, `${root}/${folderName}`);
      const cwds = await readRecordedCwds(engine, files);
      await learnTargetsFromCwds(engine, folderName, cwds, knownTargets);
      scanned.push({
        label: `${store.name}/${folderName}`,
        folderName,
        fileCount: files.length,
        hasCwd: cwds.length > 0,
      });
    }
  }
  return scanned;
}

const classifyFolders = (
  scanned: ScannedFolder[],
  knownTargets: KnownTargets,
  currentProject: string
) => {
  const verifiedNames = new Set([
    currentProject,
    ...[...knownTargets.values()].map((known) => known.target),
  ]);
  const misplaced: FolderVerdict[] = [];
  const unresolved: string[] = [];
  let inPlaceCount = 0;
  for (const folder of scanned) {
    const known = knownTargets.get(folder.folderName);
    if (known && known.target !== folder.folderName)
      misplaced.push({ ...folder, ...known });
    else if (verifiedNames.has(folder.folderName) || !folder.hasCwd)
      inPlaceCount++;
    else
      unresolved.push(`- ${folder.label} (${pluralFiles(folder.fileCount)})`);
  }
  return describeAudit(misplaced, unresolved, inPlaceCount);
};

export async function auditNoteFolders(engine: EngineInterface) {
  const sessionFolder = await engine.session.root();
  const currentProject = toProjectName(
    (await resolveRepository(engine, sessionFolder)).folder
  );
  const knownTargets = await collectWorktreeTargets(
    engine,
    sessionFolder,
    currentProject
  );
  const scanned = await scanStores(engine, knownTargets);
  return classifyFolders(scanned, knownTargets, currentProject);
}

async function findFreePath(engine: EngineInterface, path: string) {
  const extensionStart = path.lastIndexOf(".");
  const hasExtension = extensionStart > path.lastIndexOf("/");
  const stem = hasExtension ? path.slice(0, extensionStart) : path;
  const extension = hasExtension ? path.slice(extensionStart) : "";
  let freePath = path;
  for (let copyNumber = 2; await engine.fs.exists(freePath); copyNumber++)
    freePath = `${stem}-${copyNumber}${extension}`;
  return freePath;
}

async function findHighestHandoffNumber(
  engine: EngineInterface,
  folder: string
) {
  return Math.max(
    0,
    ...(await engine.fs.list(folder).catch(() => [])).map((entry) =>
      Number(entry.name.match(HANDOFF_NUMBER)?.[1] ?? 0)
    )
  );
}

async function runChecked(engine: EngineInterface, argv: string[]) {
  const outcome = await engine.process.run(argv);
  if (outcome.exitCode !== 0)
    throw new Error(`${argv.join(" ")} failed: ${outcome.stderr.trim()}`);
}

const isPlainFolderName = (name: string) =>
  Boolean(name) && toProjectName(name) === name && !/^\.+$/.test(name);

const findMoveRefusal = (
  store: NoteStore | undefined,
  from: string,
  to: string
) => {
  if (!store)
    return `store must be one of ${NOTE_STORES.map((known) => known.name).join(", ")}.`;
  if (from === to || !isPlainFolderName(from) || !isPlainFolderName(to))
    return "from and to must be two different plain folder names.";
  return "";
};

const renumberHandoff = (
  storeName: string,
  relativePath: string,
  handoffNumber: number
) => {
  const handoffMatch =
    storeName === "handoffs" && !relativePath.includes("/")
      ? relativePath.match(HANDOFF_NUMBER)
      : null;
  return handoffMatch
    ? `${String(handoffNumber).padStart(HANDOFF_NUMBER_WIDTH, "0")}-${handoffMatch[2]}`
    : "";
};

async function moveOneFile(
  engine: EngineInterface,
  file: string,
  targetPath: string,
  to: string
) {
  await runChecked(engine, [
    "mkdir",
    "-p",
    targetPath.slice(0, targetPath.lastIndexOf("/")),
  ]);
  await runChecked(engine, ["mv", "-n", file, targetPath]);
  if (!targetPath.endsWith(".md")) return;
  const text = await engine.fs.read(targetPath);
  if (PROJECT_LINE.test(text))
    await engine.fs.write(
      targetPath,
      text.replace(PROJECT_LINE, `project: ${to}`)
    );
}

export async function moveNoteFolder(
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) {
  const store = NOTE_STORES.find((known) => known.name === toolInput.store);
  const from = String(toolInput.from ?? "");
  const to = String(toolInput.to ?? "");
  const refusal = findMoveRefusal(store, from, to);
  if (refusal || !store) return { deny: refusal };
  const root = await resolveStoreRoot(engine, store);
  const files = await listFilesUnder(engine, `${root}/${from}`);
  if (files.length === 0)
    return { deny: `${store.name}/${from} holds no files.` };

  let nextHandoffNumber =
    (await findHighestHandoffNumber(engine, `${root}/${to}`)) + 1;
  for (const file of files) {
    const relativePath = file.slice(`${root}/${from}/`.length);
    const renumberedPath = renumberHandoff(
      store.name,
      relativePath,
      nextHandoffNumber
    );
    if (renumberedPath) nextHandoffNumber++;
    const targetPath = await findFreePath(
      engine,
      `${root}/${to}/${renumberedPath || relativePath}`
    );
    await moveOneFile(engine, file, targetPath, to);
  }
  await engine.process
    .run([
      "find",
      `${root}/${from}`,
      "-depth",
      "-type",
      "d",
      "-empty",
      "-delete",
    ])
    .catch(() => undefined);
  return {
    result: `Moved ${pluralFiles(files.length)} from ${store.name}/${from} to ${store.name}/${to}.`,
  };
}
