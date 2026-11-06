import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import type { RubricVersion } from "../domain/rubric-types";

const criterionSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(120),
  weight: z.enum(["high", "medium", "low"]),
  kind: z.enum(["must", "nice"]),
  strongEvidence: z.string().trim().min(8).max(400),
});

const hardSchema = z.object({
  city: z.string().max(80).default(""),
  noticeMaxDays: z.number().int().min(0).max(180).nullable(),
  compMinLpa: z.number().min(0).max(200).nullable(),
  compMaxLpa: z.number().min(0).max(200).nullable(),
  strictFilter: z.boolean().default(false),
});

export const generateRoleRubric = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }) => {
    const { generateRubricDraft } = await import("../server/rubric-version.server");
    return generateRubricDraft({ userId: context.userId, roleId: data.roleId });
  });

export const getActiveRubric = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<RubricVersion | null> => {
    const { loadEditableRubric } = await import("../server/rubric-version.server");
    return loadEditableRubric(context.userId, data.roleId);
  });

export const saveRubricEdits = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1),
        criteria: z.array(criterionSchema).min(5).max(8),
        hardConstraints: hardSchema,
        activate: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(
    async ({ context, data }): Promise<{ rubric: RubricVersion; rerankTriggered: boolean }> => {
      const { persistRubricEdits } = await import("../server/rubric-version.server");
      return persistRubricEdits({
        userId: context.userId,
        roleId: data.roleId,
        criteria: data.criteria,
        hardConstraints: data.hardConstraints,
        activate: data.activate,
      });
    },
  );
