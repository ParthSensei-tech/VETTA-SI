import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureUserOrg } from "./org.server";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  type WorkspaceBackup,
} from "./backup.server";

export const exportWorkspaceBackup = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ roleId: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<WorkspaceBackup> => {
    const org = await ensureUserOrg(context.userId);
    return createWorkspaceBackup({
      userId: context.userId,
      orgId: org.orgId,
      roleId: data.roleId,
    });
  });

export const restoreWorkspaceBackupAction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        backup: z.custom<WorkspaceBackup>((val) => typeof val === "object" && val !== null),
        mode: z.enum(["merge", "overwrite"]).default("merge"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const org = await ensureUserOrg(context.userId);
    return restoreWorkspaceBackup({
      userId: context.userId,
      orgId: org.orgId,
      backup: data.backup,
      mode: data.mode,
    });
  });
