import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TeaserBoardEntry, TeaserResult, TeaserUnlockInput } from "../domain/teaser";

export type { TeaserBoardEntry, TeaserResult } from "../domain/teaser";

/**
 * The wire layer for the public teaser. No `authMiddleware` on purpose: this is
 * the page a founder reaches before they have an account, and the reciprocity
 * move is that we answer first. Everything that keeps it safe lives behind
 * these four handlers, in teaser.server.ts and domain/mask.ts.
 */

/** GET because the board holds nothing personal: role titles, companies, cities. */
export const getTeaserBoard = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ roles: TeaserBoardEntry[]; openRoles: number; unlocksThisWeek: number }> => {
    const { readTeaserBoard } = await import("../server/teaser.server.ts");
    return readTeaserBoard();
  },
);

/** POST, not GET: the visitor's email is the depth key and must not land in a URL or an access log. */
export const getTeaser = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        roleId: z.string().min(1).max(80),
        email: z.string().trim().email().max(254).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }): Promise<TeaserResult> => {
    const { readTeaser } = await import("../server/teaser.server.ts");
    return readTeaser(data);
  });

export const unlockTeaser = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        // "" is the JD-audit path: their text never left their browser, so there is no role to cite.
        roleId: z.string().max(80).default(""),
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
      .strict()
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ already: boolean }> => {
    const { unlockTeaser: record } = await import("../server/teaser.server.ts");
    return record(data as TeaserUnlockInput);
  });
