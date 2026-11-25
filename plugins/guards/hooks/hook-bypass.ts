export const GRANT_MINUTES = 15;
const GRANT_SECONDS = GRANT_MINUTES * 60;
const MAX_GRANT_FILES = 20;
const UNSAFE_PATH_CHARACTERS = /[\t\n]/;

const keepLiveLines = (existingText: string, nowSeconds: number) =>
  existingText
    .split("\n")
    .filter((line) => Number(line.split("\t")[0]) > nowSeconds);

const assertGrantablePath = (filePath: string) => {
  if (!filePath.startsWith("/") || UNSAFE_PATH_CHARACTERS.test(filePath))
    throw new Error(
      `Hook bypass path must be absolute with no tab or newline: ${filePath}`
    );
};

const normalizeAbsolutePath = (filePath: string) => {
  const segments: string[] = [];
  for (const segment of filePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
};

export function mergeGrants(
  existingText: string,
  filePaths: string[],
  nowSeconds: number
): { expiry: number; text: string } {
  if (filePaths.length < 1 || filePaths.length > MAX_GRANT_FILES)
    throw new Error(
      `Hook bypass takes 1 to ${MAX_GRANT_FILES} files, got ${filePaths.length}.`
    );
  filePaths.forEach(assertGrantablePath);
  const expiry = nowSeconds + GRANT_SECONDS;
  const newLines = filePaths.map(
    (filePath) => `${expiry}\t${normalizeAbsolutePath(filePath)}`
  );
  const lines = [...keepLiveLines(existingText, nowSeconds), ...newLines];
  return { expiry, text: lines.map((line) => `${line}\n`).join("") };
}
