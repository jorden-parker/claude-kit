import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const GRANT_MINUTES = 15;
const GRANT_SECONDS = GRANT_MINUTES * 60;
const MAX_GRANT_FILES = 20;
const UNSAFE_PATH_CHARACTERS = /[\t\n]/;

const defaultGrantsFile = () =>
  join(homedir(), ".claude", "hook-bypass", "grants.tsv");

const readLiveLines = (grantsFile: string, nowSeconds: number) => {
  const text = existsSync(grantsFile) ? readFileSync(grantsFile, "utf8") : "";
  return text
    .split("\n")
    .filter((line) => Number(line.split("\t")[0]) > nowSeconds);
};

const assertGrantablePath = (filePath: string) => {
  if (!isAbsolute(filePath) || UNSAFE_PATH_CHARACTERS.test(filePath))
    throw new Error(
      `Hook bypass path must be absolute with no tab or newline: ${filePath}`
    );
};

export function recordGrants(
  filePaths: string[],
  nowSeconds: number,
  grantsFile = defaultGrantsFile()
): number {
  if (filePaths.length < 1 || filePaths.length > MAX_GRANT_FILES)
    throw new Error(
      `Hook bypass takes 1 to ${MAX_GRANT_FILES} files, got ${filePaths.length}.`
    );
  filePaths.forEach(assertGrantablePath);
  const expiry = nowSeconds + GRANT_SECONDS;
  const newLines = filePaths.map(
    (filePath) => `${expiry}\t${resolve(filePath)}`
  );
  const lines = [...readLiveLines(grantsFile, nowSeconds), ...newLines];
  mkdirSync(dirname(grantsFile), { recursive: true });
  writeFileSync(grantsFile, lines.map((line) => `${line}\n`).join(""));
  return expiry;
}
