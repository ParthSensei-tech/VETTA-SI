/**
 * The signup funnel wire.
 *
 * `completeSignupProfile` runs right after better-auth creates the account: it
 * names the workspace after the real company — `ensureUserOrg` is first-write-
 * wins, so a founder who touched `/app` before finishing signup would otherwise
 * be permanently "My workspace" — and records the first activation moment.
 * `markRoleCreated` is the second; the third is written by the rerank path
 * itself, where a shortlist actually exists.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../../../platform/auth/middleware.ts";
import { getSql } from "../../../platform/db.ts";

const COMPANY_SIZES = ["1-10", "11-30", "31-80", "80+"] as const;

export const signupProfileQueryKey = ["signup-profile"] as const;

/**
 * Whether this account has ever answered the workspace questions.
 *
 * The company name, team size and "you are" belong to the first run, not to the
 * login form: an existing user must never be asked again. `company_size` is
 * written only by `completeSignupProfile` and defaults to '', so it is the one
 * column that can answer "has this person set up a workspace yet".
 */
export const getSignupProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{
      complete: boolean;
      orgName: string;
      companySize: string;
      founderRole: string;
    }> => {
      const { ensureUserOrg } = await import("../../people/server/org.server.ts");
      const org = await ensureUserOrg(context.userId);
      const sql = await getSql();
      const rows = await sql<{ name: string; company_size: string; founder_role: string }>`
        select name, company_size, founder_role from organizations
        where id = ${org.orgId} limit 1`;
      const row = rows[0];
      return {
        complete: Boolean(row?.company_size),
        orgName: row?.name ?? "",
        companySize: row?.company_size ?? "",
        founderRole: row?.founder_role ?? "",
      };
    },
  );

export const completeSignupProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        companyName: z.string().trim().min(1).max(120),
        companySize: z.enum(COMPANY_SIZES),
        founderRole: z.string().trim().max(60).default(""),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ orgId: string }> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId, data.companyName);
    const sql = await getSql();
    await sql`
      update organizations
      set name = case when name = 'My workspace' then ${data.companyName} else name end,
          company_size = ${data.companySize},
          founder_role = ${data.founderRole},
          updated_at = now()
      where id = ${org.orgId}`;
    const { recordActivation } = await import("../server/activation.server.ts");
    await recordActivation({ orgId: org.orgId, userId: context.userId, kind: "signup_profile" });
    // Courtesy email, off the response path: a founder waiting on signup gets
    // the workspace, not our SMTP latency. trySendEmail never throws.
    const [{ email }] =
      await sql`select email::text as email from "user" where id = ${context.userId}`;
    const { trySendEmail } = await import("@/platform/email/server");
    const { welcomeEmail } = await import("@/platform/email/templates");
    void trySendEmail(welcomeEmail({ to: String(email ?? ""), companyName: data.companyName }));
    return { orgId: org.orgId };
  });

export const markRoleCreated = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ roleId: z.string().min(1) }).parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { ensureUserOrg } = await import("../../people/server/org.server.ts");
    const org = await ensureUserOrg(context.userId);
    const { recordActivation } = await import("../server/activation.server.ts");
    await recordActivation({
      orgId: org.orgId,
      userId: context.userId,
      kind: "first_role_created",
      roleId: data.roleId,
    });
    return { ok: true };
  });
