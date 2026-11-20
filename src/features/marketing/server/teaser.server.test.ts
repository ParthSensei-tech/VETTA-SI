import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import { recordConsent, withdrawConsent } from "../../people/server/privacy.server.ts";
import { clearTeaserCache, readTeaser, unlockTeaser } from "./teaser.server.ts";
import type { TeaserResult } from "../domain/teaser.ts";

/**
 * The teaser is the only place Vetta renders one customer's candidates to a
 * stranger, so this test asserts the absence of things: no name, no employer,
 * no contact detail, and no rows at all once consent or the cohort size says so.
 * A unit test of `mask.ts` cannot catch a gate that was never applied — this one
 * runs the real read, against the real schema, with real consent records.
 */

type Ready = Extract<TeaserResult, { state: "ready" }>;

function ready(result: TeaserResult): Ready {
  assert.equal(result.state, "ready", `expected a published teaser, got ${result.state}`);
  return result as Ready;
}

function verdictFor(company: string) {
  return JSON.stringify({
    score: 80,
    level: "strong_yes",
    summary: "Strong match for the ledger role.",
    evidence: [
      {
        // Vetta's own sentence, the kind that survives the deny check.
        claim: "Owned reconciliation and payout retries for a payments ledger, end to end.",
        // The candidate's own words, with a phone number in them. Never publishable.
        quote: `I ran the ledger at ${company} — reach me any time on 98765 43210`,
      },
      {
        claim: "Cut settlement failures by rewriting the retry policy around idempotency keys.",
        quote: "took over on-call and fixed the retries",
      },
    ],
    gaps: ["No evidence of carrying a service alone through a peak."],
    risks: [],
    india: { location_fit: "local", notice_period_days: 60 },
    stack_match: [],
    screen_focus: [],
  });
}

async function seedWorkspace(label: string) {
  const sql = await getSql();
  const orgId = `org_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const slug = `teaser-${randomUUID().slice(0, 8)}`;
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, ${label}, ${slug}, ${userId}, 180)`;
  return { orgId, userId };
}

async function seedOpenRole(orgId: string, userId: string, title: string) {
  const sql = await getSql();
  const roleId = `role_${randomUUID().slice(0, 8)}`;
  await sql`
    insert into roles (id, user_id, org_id, company_name, company_stage, title, location,
                       work_mode, employment_type, compensation_band, stack, must_haves,
                       nice_to_haves, jd_text, status)
    values (${roleId}, ${userId}, ${orgId}, 'Kestrel Robotics', 'series_a', ${title},
      'Bengaluru', 'hybrid', 'full_time', '₹32–45L + 0.1% ESOPs', '["node","postgres"]',
      '["5-8 years of backend"]', '["kafka"]', 'Own the ledger.', 'open')`;
  return roleId;
}

async function seedApplicant(opts: {
  orgId: string;
  userId: string;
  roleId: string;
  fullName: string;
  company: string;
  withShareConsent?: boolean;
}) {
  const sql = await getSql();
  const candidateId = `cand_${randomUUID().slice(0, 8)}`;
  const applicationId = `app_${randomUUID().slice(0, 8)}`;
  const email = `${candidateId}@candidate.test`;
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, location,
                            current_title, current_company, years_experience, resume_text, provenance_type)
    values (${candidateId}, ${opts.userId}, ${opts.orgId}, ${opts.fullName}, ${email},
      '+919876500000', 'Koramangala, Bengaluru', 'Senior Backend Engineer', ${opts.company},
      6, 'A resume we must never publish.', 'direct_portal')`;
  await sql`
    insert into applications (id, user_id, org_id, role_id, candidate_id, pipeline_status,
                              rank_score, rank_json, source, consent_granted, consent_at)
    values (${applicationId}, ${opts.userId}, ${opts.orgId}, ${opts.roleId}, ${candidateId},
      'ranked', 80, ${verdictFor(opts.company)}, 'portal', true, now())`;
  if (opts.withShareConsent !== false) {
    await recordConsent({
      orgId: opts.orgId,
      subjectType: "applicant",
      subjectId: candidateId,
      purpose: "client_disclosure",
      source: "test",
    });
  }
  return { candidateId, applicationId };
}

const COHORT = [
  ["Rahul Verma", "Zettabyte Systems"],
  ["Ananya Iyer", "Northbridge Analytics"],
  ["Md Farhan", "Quantum Payments"],
  ["Priya Nair", "Halcyon Commerce"],
  ["Karthik Reddy", "Brightloom Retail"],
  ["Sneha Kulkarni", "Cedarlane Logistics"],
] as const;

test("teaser: a live shortlist publishes masked rows and never a name, employer or contact detail", async () => {
  const { orgId, userId } = await seedWorkspace("Kestrel Robotics");
  const roleId = await seedOpenRole(orgId, userId, "Senior Backend Engineer");
  for (const [fullName, company] of COHORT) {
    await seedApplicant({ orgId, userId, roleId, fullName, company });
  }
  clearTeaserCache();

  const preview = ready(await readTeaser({ roleId }));
  assert.equal(preview.depth, "preview");
  assert.equal(preview.rows.length, 3, "the free preview is three rows deep");
  assert.equal(preview.shortlistSize, COHORT.length);
  assert.ok(preview.hiddenRows > 0, "the preview admits there is more behind it");

  const wire = JSON.stringify(preview).toLowerCase();
  const forbidden = [
    // Every name part and every employer's distinctive word from the cohort.
    ...COHORT.flatMap(([name, company]) => [
      ...name.toLowerCase().split(" ").filter((w) => w.length > 3),
      company.toLowerCase().split(" ")[0]!,
    ]),
    "candidate.test",
    "+919876500000",
    "98765 43210",
    "koramangala",
    "reach me any time",
  ];
  for (const token of forbidden) {
    assert.ok(!wire.includes(token), `the teaser published "${token}"`);
  }
  assert.deepEqual(
    preview.rows.map((row) => row.seniority),
    ["Senior", "Senior", "Senior"],
  );
  assert.equal(preview.rows[0]?.region, "Bengaluru");

  // The quote is the candidate's own sentence; only Vetta's claim is publishable.
  assert.ok(preview.rows[0]!.bullets[0]!.startsWith("Owned reconciliation"));
  assert.equal(preview.rows[0]!.probe, null, "the preview does not hand over the probe list");
});

test("teaser: an email is the whole key — unlock deepens, and the lead is recorded once", async () => {
  const { orgId, userId } = await seedWorkspace("Kestrel Robotics");
  const roleId = await seedOpenRole(orgId, userId, "Staff Infrastructure Engineer");
  for (const [fullName, company] of COHORT) {
    await seedApplicant({ orgId, userId, roleId, fullName, company });
  }
  clearTeaserCache();

  const email = "founder@kestrel-hire.test";
  assert.equal(ready(await readTeaser({ roleId, email })).unlocked, false);

  assert.equal((await unlockTeaser({ roleId, email, name: "", company: "", marketingOptIn: false })).already, false);
  assert.equal((await unlockTeaser({ roleId, email, name: "", company: "", marketingOptIn: false })).already, true);

  const full = ready(await readTeaser({ roleId, email }));
  assert.equal(full.unlocked, true);
  assert.equal(full.depth, "full");
  assert.equal(full.rows.length, COHORT.length);
  assert.ok(full.rows[0]?.probe, "the unlocked view carries what the screen still has to answer");
  assert.ok(!JSON.stringify(full).toLowerCase().includes("zettabyte"));

  const sql = await getSql();
  const leads = await sql<{ count: unknown }>`
    select count(*)::text as count from teaser_leads where role_id = ${roleId}`;
  assert.equal(Number(leads[0]?.count), 1, "one founder, one row, however many times they clicked");

  // The same rule for the funnel meter the admin page reads: an unlock is a
  // founder, not a click.
  const meters = await sql<{ count: unknown }>`
    select count(*)::text as count from activation_events
    where kind = 'teaser_unlock' and role_id = ${roleId}`;
  assert.equal(Number(meters[0]?.count), 1);
});

test("teaser: withdrawn consent leaves the shortlist on the next read", async () => {
  const { orgId, userId } = await seedWorkspace("Kestrel Robotics");
  const roleId = await seedOpenRole(orgId, userId, "Founding Backend Engineer");
  const seeded = [];
  for (const [fullName, company] of COHORT) {
    seeded.push(await seedApplicant({ orgId, userId, roleId, fullName, company }));
  }
  clearTeaserCache();
  assert.equal(ready(await readTeaser({ roleId })).shortlistSize, COHORT.length);

  await withdrawConsent({ orgId, subjectId: seeded[0]!.candidateId, purpose: "client_disclosure" });

  // No manual clear: withdrawal takes the cache with it.
  const after = ready(await readTeaser({ roleId }));
  assert.equal(after.shortlistSize, COHORT.length - 1);
});

test("teaser: below the cohort floor nothing is published, and a closed role publishes nothing either", async () => {
  const { orgId, userId } = await seedWorkspace("Kestrel Robotics");
  const roleId = await seedOpenRole(orgId, userId, "Backend Engineer");
  for (const [fullName, company] of COHORT.slice(0, 4)) {
    await seedApplicant({ orgId, userId, roleId, fullName, company });
  }
  clearTeaserCache();

  const small = await readTeaser({ roleId });
  assert.equal(small.state, "below_floor");
  assert.ok(!("rows" in small) || small.rows === undefined, "a withheld teaser carries no rows");
  assert.match(small.message, /4|5/);

  // Fourteen rows in a cohort of four is a list of people, not a demonstration.
  const closed = await readTeaser({ roleId: "role_that_does_not_exist" });
  assert.equal(closed.state, "not_open");
});

test("teaser: an applicant whose org cannot be attributed is not publishable at all", async () => {
  const { orgId, userId } = await seedWorkspace("Kestrel Robotics");
  const roleId = await seedOpenRole(orgId, userId, "Senior Platform Engineer");
  for (const [fullName, company] of COHORT) {
    await seedApplicant({ orgId, userId, roleId, fullName, company });
  }
  const sql = await getSql();
  // A row that predates org attribution: consent cannot be verified for it, and
  // "we could not find a record" is not consent.
  await sql`update applications set org_id = null, consent_granted = false where role_id = ${roleId}`;
  clearTeaserCache();

  const result = await readTeaser({ roleId });
  assert.equal(result.state, "below_floor");
});
