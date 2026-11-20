import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getFounderSlugProfile,
  buildWhatsAppIntakeUrl,
  type FounderSlugProfile,
} from "../server/founder-slug.server";

export const getFounderSlugProfileFn = createServerFn({ method: "GET" })
  .validator((slug: unknown) => z.string().min(1).parse(slug))
  .handler(async ({ data }): Promise<FounderSlugProfile | null> => {
    return getFounderSlugProfile(data);
  });

export const getFounderWhatsAppUrlFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        whatsappNumber: z.string(),
        founderName: z.string(),
        companyName: z.string(),
        roleTitle: z.string().optional(),
        candidateSource: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const url = buildWhatsAppIntakeUrl(data);
    return { url };
  });
