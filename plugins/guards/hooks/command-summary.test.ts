import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("compact-run retains full logs and propagates failure", async () => {
  const child = Bun.spawn(
    [
      "bun",
      `${import.meta.dir}/../bin/compact-run`,
      "bun",
      "-e",
      'console.log("x".repeat(9000)); console.error("FAIL: assertion"); process.exit(3)',
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(3);
  expect(output).toContain("FAIL: assertion");
  expect(output.length).toBeLessThan(4500);
  const path = output.match(/full log: (.+)/)?.[1];
  expect(path).toBeDefined();
  expect(readFileSync(path!, "utf8")).toContain("x".repeat(9000));
});
