import { createFileRoute } from "@tanstack/react-router";
import { processQueueSlice } from "@/features/pipeline/server/queue.server";

async function tick() {
  const result = await processQueueSlice({ maxJobs: 4, budgetMs: 50_000 });
  return Response.json({ ok: true, ...result });
}

export const Route = createFileRoute("/api/queue/tick")({
  server: {
    handlers: {
      GET: () => tick(),
      POST: () => tick(),
    },
  },
});
