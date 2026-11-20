/**
 * The teaser wedge — Vetta's reciprocity engine, and the most privacy-exposed
 * read in the product.
 *
 * The offer is deliberately uncomfortable for a competitor to copy: we show a
 * founder a real shortlist Vetta built for a live role, before asking for
 * anything. That is only survivable under DPDP because of three gates, all of
 * them in this file, none of them in the UI:
 *
 *   1. **Consent, per person.** The same `client_disclosure` purpose the
 *      client-share pack uses (`filterShareApplicationIds`). An application
 *      whose subject did not consent to be shown outside the workspace is not
 *      here. An application we cannot attribute to an org is dropped too —
 *      fail-closed, because "we could not find a consent record" is not consent.
 *   2. **Masking** (`domain/mask.ts`): initials, seniority band, region bucket,
 *      and Vetta's own scrubbed sentences. No name, city, employer, contact
 *      detail or verbatim resume line crosses this boundary.
 *   3. **The cohort floor.** Under MIN_PUBLISHABLE_COHORT publishable rows the
 *      teaser renders nothing, because five masked rows is a list and two is a
 *      person.
 *
 * The in-memory cache holds the *masked* result, never the rows it came from,
 * and lives five minutes. Consent withdrawal therefore has a short window to
 * take effect — `clearTeaserCache()` is called by privacy.server.ts on
 * withdrawal and erasure so the page can go stale for at most one request.
 */
import { getSql } from "../../../platform/db.ts";
import { iso, parseJson } from "../../../shared/utils.ts";
import { env } from "../../../platform/env.server.ts";
import { filterShareApplicationIds } from "../../people/server/privacy.server.ts";
import type { RankResult } from "../../recruiting/domain/types.ts";
import {
  FULL_ROWS,
  MIN_PUBLISHABLE_COHORT,
  maskShortlist,
  type MaskedRow,
  type MaskInput,
} from "../domain/mask.ts";
import {
  TEASER_NOT_OPEN_MESSAGE,
  teaserFloorMessage,
  type TeaserBoardEntry,
  type TeaserResult,
  type TeaserRole,
  type TeaserUnlockInput,
} from "../domain/teaser.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;
const BOARD_LIMIT = 24;

type CachedTeaser = {
  builtAt: number;
  role: TeaserRole;
  rows: MaskedRow[];
  publishable: boolean;
  /** Publishable rows in the whole shortlist, including the ones past the depth cap. */
  shortlistSize: number;
  suppressed: number;
};

const g = globalThis as typeof globalThis & {
  __vettaTeaserCache__?: Map<string, CachedTeaser>;
};

function cache(): Map<string, CachedTeaser> {
  g.__vettaTeaserCache__ ??= new Map();
  return g.__vettaTeaserCache__;
}

/** Called when consent changes: the masked view must not outlive the permission it came from. */
export function clearTeaserCache(): void {
  cache().clear();
}

/** Preview depth is a strict slice of the cached full view — one mask pass, one answer. */
function previewOf(rows: MaskedRow[]): MaskedRow[] {
  return rows.slice(0, 3).map((row) => ({
    ...row,
    bullets: row.bullets.slice(0, 1),
    probe: null,
  }));
}

type ApplicantRow = {
  id: string;
  org_id: string | null;
  candidate_org_id: string | null;
  full_name: string;
  location: string;
  current_title: string;
  current_company: string;
  years_experience: number | null;
  rank_score: number | null;
  rank_json: string | null;
};

async function loadRole(roleId: string): Promise<TeaserRole | null> {
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select id, title, company_name, company_stage, location, work_mode, employment_type,
           compensation_band, stack, must_haves, updated_at, created_at
    from roles
    where id = ${roleId} and status = 'open'
    limit 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    companyName: String(row.company_name),
    companyStage: String(row.company_stage),
    location: String(row.location ?? ""),
    workMode: String(row.work_mode ?? ""),
    employmentType: String(row.employment_type ?? ""),
    compensationBand: String(row.compensation_band ?? ""),
    stack: parseJson<string[]>(row.stack, []),
    mustHaves: parseJson<string[]>(row.must_haves, []),
    postedAt: iso(row.updated_at || row.created_at),
  };
}

/**
 * Consented, org-attributed, ranked applicants — in the order the workspace
 * would shortlist them. Deliberately never selects email or phone: a column we
 * do not read cannot leak through a future refactor of the masker.
 */
async function loadPublishableApplicants(role: TeaserRole): Promise<MaskInput[]> {
  const sql = await getSql();
  const rows = await sql<ApplicantRow>`
    select a.id, a.org_id, a.rank_score, a.rank_json,
           c.full_name, c.location, c.current_title, c.current_company, c.years_experience,
           c.org_id as candidate_org_id
    from applications a
    join candidates c on c.id = a.candidate_id
    where a.role_id = ${role.id} and a.consent_granted = true`;

  const attributed = rows
    .map((row) => ({ row, orgId: row.org_id ?? row.candidate_org_id }))
    .filter((entry): entry is { row: ApplicantRow; orgId: string } => Boolean(entry.orgId));

  const byOrg = new Map<string, string[]>();
  for (const { row, orgId } of attributed) {
    byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), row.id]);
  }

  const allowed = new Set<string>();
  for (const [orgId, applicationIds] of byOrg) {
    for (const id of await filterShareApplicationIds({ orgId, applicationIds })) allowed.add(id);
  }

  const applicants: MaskInput[] = [];
  for (const { row } of attributed) {
    if (!allowed.has(row.id)) continue;
    const rank = parseJson<RankResult | null>(row.rank_json ?? "{}", null);
    const score = typeof rank?.score === "number" ? rank.score : row.rank_score;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    applicants.push({
      fullName: row.full_name,
      location: row.location ?? "",
      currentTitle: row.current_title ?? "",
      currentCompany: row.current_company ?? "",
      yearsExperience: row.years_experience === null ? null : Number(row.years_experience),
      rankScore: score,
      level: rank?.level ?? null,
      evidenceClaims: (rank?.evidence ?? []).map((item) => item.claim),
      probeLines: [...(rank?.gaps ?? []), ...(rank?.risks ?? [])],
    });
  }
  return applicants.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
}

async function buildTeaser(roleId: string): Promise<CachedTeaser | null> {
  const role = await loadRole(roleId);
  if (!role) return null;

  const applicants = await loadPublishableApplicants(role);
  const masked = maskShortlist({
    applicants,
    roleCompany: role.companyName,
    workMode: role.workMode,
    depth: "full",
  });
  // maskShortlist caps how many rows it *returns*; this is how many it could.
  const publishableRows = applicants.length - masked.suppressed;

  return {
    builtAt: Date.now(),
    role,
    rows: masked.rows,
    publishable: masked.publishable,
    shortlistSize: masked.publishable ? publishableRows : 0,
    suppressed: masked.suppressed,
  };
}

async function cachedTeaser(roleId: string): Promise<CachedTeaser | null> {
  const hit = cache().get(roleId);
  if (hit && Date.now() - hit.builtAt < CACHE_TTL_MS) return hit;
  const built = await buildTeaser(roleId);
  if (!built) {
    cache().delete(roleId);
    return null;
  }
  cache().set(roleId, built);
  return built;
}

/** Did this address already ask for this role's shortlist? Unlock state is per (role, email). */
async function alreadyUnlocked(roleId: string, email: string): Promise<boolean> {
  if (!email) return false;
  const sql = await getSql();
  const rows = await sql<{ one: number }>`
    select 1 as one from teaser_leads
    where role_id = ${roleId} and lower(email) = lower(${email})
    limit 1`;
  return rows.length > 0;
}

export async function readTeaser(opts: {
  roleId: string;
  email?: string;
}): Promise<TeaserResult> {
  const built = await cachedTeaser(opts.roleId);
  if (!built) return { state: "not_open", message: TEASER_NOT_OPEN_MESSAGE };
  if (!built.publishable) {
    return { state: "below_floor", message: teaserFloorMessage(MIN_PUBLISHABLE_COHORT) };
  }

  const unlocked = await alreadyUnlocked(built.role.id, (opts.email ?? "").trim());
  const rows = unlocked ? built.rows : previewOf(built.rows);
  return {
    state: "ready",
    role: built.role,
    unlocked,
    depth: unlocked ? "full" : "preview",
    rows,
    shortlistSize: built.shortlistSize,
    hiddenRows: Math.max(0, Math.min(built.shortlistSize, FULL_ROWS) - rows.length),
    minCohort: MIN_PUBLISHABLE_COHORT,
    builtAt: new Date(built.builtAt).toISOString(),
  };
}

/**
 * The public board of roles with a teaser. No per-role applicant counts here:
 * a number that small is a hint about who applied, so the board advertises the
 * role and the depth is decided when the teaser itself is opened.
 */
export async function readTeaserBoard(): Promise<{
  roles: TeaserBoardEntry[];
  openRoles: number;
  unlocksThisWeek: number;
}> {
  const sql = await getSql();
  const [roleRows, leadRows, totalRows] = await Promise.all([
    sql<Record<string, unknown>>`
      select id, title, company_name, location, work_mode, compensation_band, updated_at, created_at
      from roles where status = 'open'
      order by updated_at desc
      limit ${BOARD_LIMIT}`,
    sql<{ count: unknown }>`
      select count(*)::text as count from teaser_leads
      where created_at > now() - interval '7 days'`,
    sql<{ count: unknown }>`select count(*)::text as count from roles where status = 'open'`,
  ]);
  return {
    roles: roleRows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      companyName: String(row.company_name),
      location: String(row.location ?? ""),
      workMode: String(row.work_mode ?? ""),
      compensationBand: String(row.compensation_band ?? ""),
      postedAt: iso(row.updated_at || row.created_at),
    })),
    openRoles: Number(totalRows[0]?.count ?? roleRows.length),
    unlocksThisWeek: Number(leadRows[0]?.count ?? 0),
  };
}

/**
 * The public half of the activation trail. `org_id` is empty on purpose: this is
 * not a customer's workspace doing something, it is a stranger asking for proof,
 * and the number the financial model wants is "how many founders did we hand a
 * real shortlist to". It goes in directly rather than through `recordActivation`
 * because that helper dedupes once per org — and forty unlocks on one role are
 * forty leads, not one.
 */
async function recordTeaserUnlock(roleId: string): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into activation_events (id, org_id, user_id, kind, role_id)
    values (${crypto.randomUUID()}, '', '', 'teaser_unlock', ${roleId})`;
}

/**
 * Take the email, give the shortlist. The lead row is the whole point — this is
 * the top of the funnel and the first real number in the financial model — so
 * the write happens before the email is even attempted, and a mail outage never
 * loses a founder who asked.
 *
 * `roleId: ""` is the JD-audit path: their checklist is already on the screen,
 * so there is nothing to post them and we send nothing. An email that says
 * "here is what you just saw" is spam with better manners.
 */
export async function unlockTeaser(input: TeaserUnlockInput): Promise<{ already: boolean }> {
  const sql = await getSql();
  const email = input.email.trim().toLowerCase();
  const roleId = input.roleId.trim();

  const inserted = await sql<{ id: string }>`
    insert into teaser_leads (
      id, role_id, email, name, company, marketing_opt_in, marketing_opt_in_at,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content, initial_referrer
    )
    values (
      ${crypto.randomUUID()}, ${roleId}, ${email}, ${input.name.trim()}, ${input.company.trim()},
      ${input.marketingOptIn}, ${input.marketingOptIn ? new Date().toISOString() : null},
      ${input.utmSource?.trim() || ""}, ${input.utmMedium?.trim() || ""}, ${input.utmCampaign?.trim() || ""},
      ${input.utmTerm?.trim() || ""}, ${input.utmContent?.trim() || ""}, ${input.initialReferrer?.trim() || ""}
    )
    on conflict (role_id, email) do nothing
    returning id`;
  const already = inserted.length === 0;
  if (already) return { already: true };

  await recordTeaserUnlock(roleId);

  if (roleId && env("RESEND_API_KEY")) {
    const role = await loadRole(roleId);
    const { seoOrigin } = await import("../../../platform/seo/origin.ts");
    const { trySendEmail } = await import("../../../platform/email/server.ts");
    const { teaserUnlockEmail } = await import("../../../platform/email/templates.ts");
    const query = new URLSearchParams({ role: roleId, email });
    await trySendEmail(
      teaserUnlockEmail({
        to: email,
        jobTitle: role?.title ?? "that shortlist",
        unlockUrl: `${seoOrigin()}/teaser?${query.toString()}`,
      }),
    );
  }
  return { already: false };
}
