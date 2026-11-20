import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/platform/db";

export const requestDemo = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(254),
        name: z.string().trim().max(120).default(""),
        company: z.string().trim().max(120).default(""),
        marketingOptIn: z.boolean().default(false),
        utmSource: z.string().trim().max(100).default(""),
        utmMedium: z.string().trim().max(100).default(""),
        utmCampaign: z.string().trim().max(120).default(""),
        utmTerm: z.string().trim().max(120).default(""),
        utmContent: z.string().trim().max(120).default(""),
        initialReferrer: z.string().trim().max(254).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const sql = await getSql();
    const email = data.email.toLowerCase();
    await sql`
      insert into demo_requests (
        id, email, name, company, marketing_opt_in, marketing_opt_in_at,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, initial_referrer
      )
      values (
        ${crypto.randomUUID()}, ${email}, ${data.name}, ${data.company},
        ${data.marketingOptIn}, ${data.marketingOptIn ? new Date().toISOString() : null},
        ${data.utmSource}, ${data.utmMedium}, ${data.utmCampaign}, ${data.utmTerm}, ${data.utmContent}, ${data.initialReferrer}
      )
      on conflict (email) do update set
        name = case when demo_requests.name = '' then excluded.name else demo_requests.name end,
        company = case when demo_requests.company = '' then excluded.company else demo_requests.company end,
        marketing_opt_in = demo_requests.marketing_opt_in or excluded.marketing_opt_in,
        marketing_opt_in_at = coalesce(demo_requests.marketing_opt_in_at, excluded.marketing_opt_in_at),
        utm_source = case when demo_requests.utm_source = '' then excluded.utm_source else demo_requests.utm_source end,
        utm_campaign = case when demo_requests.utm_campaign = '' then excluded.utm_campaign else demo_requests.utm_campaign end`;
    const { trySendEmail } = await import("@/platform/email/server");
    const { demoConfirmationEmail } = await import("@/platform/email/templates");
    void trySendEmail(demoConfirmationEmail({ to: email, name: data.name || undefined }));
    return { ok: true };
  });
