/**
 * Rank labels from recruiters → per-org learning-to-rank signal.
 * Not a demo harness: labels adjust the organization's match rubric weights.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { parseJson } from "@/lib/utils";
import type { RankResult } from "./types";

const LABEL_VALUES = [
  "shortlist",
  "hire",
  "yes",
  "strong_yes",
  "reject",
  "no",
  "false_positive",
  "hold",
] as const;

export const submitRankLabel = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        applicationId: z.string().min(1),
        label: z.enum(LABEL_VALUES),
        note: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true; learned: boolean }> => {
    const sql = await getSql();
    const { ensureUserOrg, assertOrgMember } = await import("./org.server");
    const org = await ensureUserOrg(context.userId);

    const apps = await sql<{
      id: string;
      role_id: string;
      rank_json: string;
      org_id: string | null;
      user_id: string;
    }>`
      select id, role_id, rank_json, org_id, user_id from applications
      where id = ${data.applicationId}
      limit 1`;
    const app = apps[0];
    if (!app) throw new Error("Application not found");

    if (app.org_id) {
      await assertOrgMember(context.userId, app.org_id);
    } else if (app.user_id !== context.userId) {
      throw new Error("Application not found");
    }

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

    const dimensionScores: Record<string, number> = {};
    for (const d of rank.match?.dimensions ?? []) {
      dimensionScores[d.id] = d.score;
    }

    await sql`
      insert into rank_labels (
        id, org_id, user_id, role_id, application_id, label, note, dimension_scores_json
      ) values (
        ${crypto.randomUUID()}, ${orgId}, ${context.userId}, ${app.role_id},
        ${app.id}, ${data.label}, ${data.note ?? ""}, ${JSON.stringify(dimensionScores)}
      )`;

    const positive = ["shortlist", "hire", "yes", "strong_yes"].includes(data.label);
    const negative = ["reject", "no", "false_positive"].includes(data.label);
    if (positive || negative) {
      try {
        const docs = await sql<{ resume_text: string; jd: string }>`
          select c.resume_text,
            r.title || E'\n' || r.jd_text || E'\n' || r.must_haves as jd
          from applications a
          join candidates c on c.id = a.candidate_id
          join roles r on r.id = a.role_id
          where a.id = ${app.id}
          limit 1`;
        const doc = docs[0];
        if (doc?.resume_text) {
          const people = await sql<{ candidate_id: string }>`
            select candidate_id from applications where id = ${app.id} limit 1`;
          const subjectId = people[0]?.candidate_id;
          const { mayProcess } = await import("./privacy.server");
          const learn = subjectId
            ? await mayProcess({ orgId, subjectId, purpose: "model_improvement" })
            : false;
          if (learn) {
            const { trainOnLabel } = await import("./domain-embed.server");
            await trainOnLabel({
              orgId,
              resumeText: doc.resume_text,
              roleText: doc.jd,
              positive,
            });
          }
        }
      } catch {
        /* embedding tables may be mid-migration */
      }
      try {
        const people = await sql<{ candidate_id: string }>`
          select candidate_id from applications where id = ${app.id} limit 1`;
        const subjectId = people[0]?.candidate_id;
        const { mayProcess } = await import("./privacy.server");
        const learn = subjectId
          ? await mayProcess({ orgId, subjectId, purpose: "model_improvement" })
          : false;
        if (learn) {
          const { trainCalibrationOnLabel } = await import("./calibrate.server");
          await trainCalibrationOnLabel({ orgId, rank, positive });
        }
      } catch {
        /* calibration table may be mid-migration */
      }
    }

    // Attempt to recompute org rubric from accumulated labels
    let learned = false;
    try {
      const { recomputeRubricFromLabels } = await import("./rubric.server");
      const next = await recomputeRubricFromLabels(orgId);
      learned = Boolean(next);
    } catch {
      learned = false;
    }

    return { ok: true, learned };
  });
