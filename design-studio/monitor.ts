import { join } from "node:path";
import type { StudioEvent } from "./studio";

const PAGE_PATH = join(import.meta.dir, "monitor.html");
const encoder = new TextEncoder();

const encodeEvent = (timedEvent: object) =>
  encoder.encode(`data: ${JSON.stringify(timedEvent)}\n\n`);

export const startMonitor = (port = 0) => {
  const history: object[] = [];
  const viewers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let isStopped = false;

  const openEventStream = () => {
    let viewer: ReadableStreamDefaultController<Uint8Array>;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          viewer = controller;
          for (const timedEvent of history) controller.enqueue(encodeEvent(timedEvent));
          if (isStopped) controller.close();
          else viewers.add(controller);
        },
        cancel() {
          viewers.delete(viewer);
        },
      }),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } }
    );
  };

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/events"
        ? openEventStream()
        : new Response(Bun.file(PAGE_PATH), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
  });

  return {
    url: `http://127.0.0.1:${server.port}/`,
    emit: (event: StudioEvent) => {
      const timedEvent = { ...event, at: Date.now() };
      history.push(timedEvent);
      for (const viewer of viewers) viewer.enqueue(encodeEvent(timedEvent));
    },
    stop: async () => {
      if (isStopped) return;
      isStopped = true;
      for (const viewer of viewers) viewer.close();
      viewers.clear();
      await server.stop();
    },
  };
};
