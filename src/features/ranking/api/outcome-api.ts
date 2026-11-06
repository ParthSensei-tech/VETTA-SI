import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/platform/auth/middleware";
import { getSql } from "@/platform/db";
import { parseJson } from "@/shared/utils";
import { OUTCOME_KINDS } from "../domain/outcome";
import type { RankResult } from "../../../lib/recruiting/types";

export const recordOutcome = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ applicationId: z.string().min(1), kind: z.enum(OUTCOME_KINDS) }).parse(input),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{ ok: true; forecast: import("../domain/outcome").OutcomeForecast }> => {
      const sql = await getSql();
      const { ensureUserOrg, assertOrgMember } = await import("../../../lib/recruiting/org.server");
      const org = await ensureUserOrg(context.userId);

      const apps = await sql<{
        id: string;
        org_id: string | null;
        user_id: string;
        rank_json: string;
      }>`
      select id, org_id, user_id, rank_json from applications
      where id = ${data.applicationId}
      limit 1`;
      const app = apps[0];
      if (!app) throw new Error("Application not found");

      if (app.org_id) {
        await assertOrgMember(context.userId, app.org_id);
      } else if (app.user_id !== context.userId) {
        throw new Error("Application not found");
      }

      const { trainOutcome, forecastOutcome } = await import("../server/outcome.server");
      const orgId = app.org_id || org.orgId;
      const rank = parseJson<RankResult>(app.rank_json, {
        score: 0,
        level: "maybe",
        summary: "",
        evidence: [],
        gaps: [],
        risks: [],
        india: {
          location_fit: "unknown",
          notice_period_days: null,
          current_ctc_lakh: null,
          expected_ctc_lakh: null,
          early_stage_fit: "unknown",
          notes: "",
        },
        stack_match: [],
        screen_focus: [],
      });
      await sql`
      insert into outcome_events (id, org_id, user_id, application_id, kind)
      values (${crypto.randomUUID()}, ${orgId}, ${context.userId}, ${app.id}, ${data.kind})`;
      await trainOutcome({ orgId, rank, kind: data.kind });
      const forecast = await forecastOutcome(rank, orgId);
      const nextRank = { ...rank, outcome: forecast };
      await sql`
      update applications set rank_json = ${JSON.stringify(nextRank)}, updated_at = now()
      where id = ${app.id} and (org_id = ${orgId} or (org_id is null and user_id = ${context.userId}))`;
      return { ok: true, forecast };
    },
  );
