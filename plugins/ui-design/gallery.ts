#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  readGalleryEntry,
  renderGalleryPage,
  type GalleryEntry,
} from "./hooks/gallery-page";

const USAGE = `Usage: plugins/ui-design/gallery.ts [project folder …] [--no-open]
Writes ~/.claude/ui-design/gallery.html, a page of every design and audit that /ui-design saved, and opens it in the browser.
With no folder, it covers every project listed in ~/.claude.json. With folders, only those projects.`;

const DESIGN_FOLDER = ".claude/ui-design";

const BROWSER_OPENERS = [["open"], ["xdg-open"], ["cmd", "/c", "start", ""]];

const openInBrowser = (pagePath: string) =>
  BROWSER_OPENERS.some(
    ([command, ...leadingArguments]) =>
      spawnSync(command, [...leadingArguments, pagePath]).status === 0
  );

const listKnownProjects = () => {
  try {
    const settings = JSON.parse(
      readFileSync(join(homedir(), ".claude.json"), "utf8")
    );
    return Object.keys(settings.projects ?? {});
  } catch {
    return [];
  }
};

const listFileNames = (folder: string) => {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
};

const readProjectEntries = (project: string): GalleryEntry[] => {
  const designFolder = resolve(project, DESIGN_FOLDER);
  const folderUrl = pathToFileURL(designFolder).href;
  return listFileNames(designFolder).flatMap((fileName) => {
    try {
      const entry = readGalleryEntry(
        fileName,
        readFileSync(join(designFolder, fileName), "utf8")
      );
      return entry ? [{ ...entry, folderUrl }] : [];
    } catch {
      return [];
    }
  });
};

const pluralize = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

const projects = positionals.length ? positionals : listKnownProjects();
const entries = projects.flatMap(readProjectEntries);

if (!entries.length) {
  console.error(
    `No saved designs or audits in ${pluralize(projects.length, "project")}. Pass the folders of projects where /ui-design has run.`
  );
  process.exit(1);
}

const galleryFolder = join(homedir(), DESIGN_FOLDER);
const pagePath = join(galleryFolder, "gallery.html");
mkdirSync(galleryFolder, { recursive: true });
writeFileSync(pagePath, renderGalleryPage(entries, "All projects"));
const designCount = entries.filter((entry) => entry.kind === "design").length;
const projectCount = new Set(entries.map((entry) => entry.folderUrl)).size;
console.log(
  `${pluralize(designCount, "design")} and ${pluralize(entries.length - designCount, "audit")} from ${pluralize(projectCount, "project")}: ${pagePath}`
);
if (!flags["no-open"] && !openInBrowser(pagePath))
  console.log("Could not open the browser. Open the page yourself.");
