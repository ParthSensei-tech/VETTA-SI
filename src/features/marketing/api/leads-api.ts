import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import { LEAD_STATUSES } from "../domain/leads";
import type { FunnelCounts, Lead, LeadStatus, TeaserLead } from "../domain/leads";

export { LEAD_STATUSES };
export type { FunnelCounts, Lead, LeadStatus, TeaserLead } from "../domain/leads";

/** The founder's lead inbox. Gate and reads live in leads.server.ts. */
export const listLeads = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{
    leads: Lead[];
    teasers: TeaserLead[];
    funnel: FunnelCounts;
  }> => {
    const { readLeadsForAdmin } = await import("../server/leads.server");
    return readLeadsForAdmin(context.userId);
  });

export const markLeadStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        leadId: z.string().min(1),
        status: z.enum(LEAD_STATUSES),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { writeLeadStatusForAdmin } = await import("../server/leads.server");
    await writeLeadStatusForAdmin(context.userId, data as { leadId: string; status: LeadStatus; note?: string });
    return { ok: true };
  });
