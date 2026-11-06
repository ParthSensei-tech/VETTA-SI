import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import type { EvalRun, HarnessSettings, HarnessSnapshot, PromptVersion } from "../types";

export const getHarness = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HarnessSnapshot> => {
    const { loadHarnessSnapshot } = await import("./server");
    return loadHarnessSnapshot(context.userId);
  });

export const runHarnessEval = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        kind: z.enum(["production", "candidate"]).default("production"),
        engine: z.enum(["local", "live"]).default("local"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<EvalRun> => {
    const { runEvalSet } = await import("./server");
    return runEvalSet({ userId: context.userId, kind: data.kind, engine: data.engine });
  });

export const getEvalRun = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ runId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<EvalRun> => {
    const { loadRunDetail } = await import("./server");
    return loadRunDetail(context.userId, data.runId);
  });

export const saveHarnessPrompt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ body: z.string().min(40).max(20000), name: z.string().max(80).optional() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<PromptVersion> => {
    const { saveCandidatePrompt } = await import("./server");
    return saveCandidatePrompt(context.userId, data.body, data.name);
  });

export const promoteHarnessPrompt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HarnessSettings> => {
    const { promoteCandidatePrompt } = await import("./server");
    return promoteCandidatePrompt(context.userId);
  });

export const setHarnessShadow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ context, data }): Promise<HarnessSettings> => {
    const { setShadowEnabled } = await import("./server");
    return setShadowEnabled(context.userId, data.enabled);
  });

