import { compareSessions, readFixes, readNewestEntries } from "./ledger.ts";
import { verifyPage } from "./verify-page.ts";

export function startVerifyServer(userHome: string) {
  const path = "/" + crypto.randomUUID();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== path)
        return new Response("Not found", { status: 404 });
      if (request.method !== "GET")
        return new Response("Method not allowed", { status: 405 });
      const fix = readFixes(userHome).sort((a, b) =>
        b.appliedAt.localeCompare(a.appliedAt)
      )[0];
      return new Response(
        verifyPage(
          fix && {
            title: fix.title,
            since: fix.appliedAt,
            ...compareSessions(
              readNewestEntries(userHome, Infinity),
              fix.appliedAt
            ),
          },
          true
        ),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
          },
        }
      );
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}${path}` };
}
