import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const CLI_PATH = join(import.meta.dirname, "..", "gallery.ts");

const buildSavedDesign = (subject) => ({
  project: "acme-notes",
  mode: "new",
  subject,
  theme: {
    tokens: [
      {
        name: "primary",
        kind: "color",
        value: "#2563eb",
        source: "src/app/globals.css:2",
      },
    ],
  },
  variants: [
    {
      name: "Three columns",
      rationale: "One column per plan.",
      html: "<main>Plans</main>",
      css: "",
    },
  ],
});

const makeFolder = () => mkdtempSync(join(tmpdir(), "ui-design-gallery-"));

const saveDesign = (project, designName, subject) => {
  const designFolder = join(project, ".claude", "ui-design");
  mkdirSync(designFolder, { recursive: true });
  writeFileSync(
    join(designFolder, `${designName}.json`),
    JSON.stringify(buildSavedDesign(subject))
  );
  return designFolder;
};

const runGallery = (home, projects = []) =>
  spawnSync("bun", [CLI_PATH, ...projects, "--no-open"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });

const readGalleryPath = (home) =>
  join(home, ".claude", "ui-design", "gallery.html");

test("with no folder, the gallery covers every project Claude Code knows", () => {
  const home = makeFolder();
  const pricingProject = makeFolder();
  const settingsProject = makeFolder();
  const pricingFolder = saveDesign(
    pricingProject,
    "design-2026-11-12-120000",
    "A pricing page"
  );
  saveDesign(settingsProject, "design-2026-11-12-130000", "A settings page");
  writeFileSync(join(pricingFolder, "design-2026-11-12-140000.json"), "{");
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      projects: {
        [pricingProject]: {},
        [settingsProject]: {},
        [join(home, "deleted-project")]: {},
      },
    })
  );

  const run = runGallery(home);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /2 designs and 0 audits from 2 projects/);
  assert.ok(run.stdout.includes(readGalleryPath(home)));
  const page = readFileSync(readGalleryPath(home), "utf8");
  assert.ok(page.includes("A pricing page"));
  assert.ok(page.includes("A settings page"));
  assert.ok(page.includes("<h1>All projects</h1>"));
  assert.ok(
    page.includes(
      `${pathToFileURL(pricingFolder).href}/design-2026-11-12-120000.html`
    )
  );
});

test("named folders limit the gallery to those projects", () => {
  const home = makeFolder();
  const pricingProject = makeFolder();
  saveDesign(pricingProject, "design-2026-11-12-120000", "A pricing page");

  const run = runGallery(home, [pricingProject]);

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /1 design and 0 audits from 1 project:/);
  assert.ok(
    readFileSync(readGalleryPath(home), "utf8").includes("A pricing page")
  );
});

test("with no saved designs anywhere it is refused, and nothing is written", () => {
  const home = makeFolder();

  const run = runGallery(home, [makeFolder()]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /No saved designs/);
  assert.throws(() => readFileSync(readGalleryPath(home)));
});
