/**
 * The Vetta Index: one weekly cut of the pipeline audit trail, published only
 * when the cohort behind it is large enough to be a fact about the market
 * rather than a fact about a company.
 *
 * Why a snapshot table instead of a query behind the page. The Index is the
 * number we ask founders to retweet and ask AI engines to quote, so it needs an
 * as-of date that does not move when someone else shortlists a candidate five
 * minutes later. A live aggregate would also make the hero stat on the landing
 * page disagree with `/data` between two requests — and the first person to
 * notice that difference is the person writing about us.
 *
 * Two properties are worth more than the convenience of a view:
 *
 *   1. **The floor is here, not in the page.** `buildIndex` refuses to run its
 *      arithmetic on a short cohort, so no caller can accidentally render a
 *      median of three. A withheld cut is still written down, with the reason.
 *   2. **Nothing free-text is read.** Only stage names from our own vocabulary
 *      cross into the payload. A rejection *reason* is a sentence a recruiter
 *      typed about a named person, and there is no scrubbing rule strong enough
 *      to make that safe to publish.
 *
 * Erasure rebuilds the snapshot (`privacy.server.ts`), because a derived
 * statistic that keeps contributing an erased person's application is not a
 * deletion, it is a copy.
 */
import { getSql } from "../../../platform/db.ts";
import { iso, parseJson } from "../../../shared/utils.ts";
import {
  INDEX_WINDOW_DAYS,
  buildIndex,
  indexWithheldReason,
  isPipelineExit,
  publicHoldMessage,
  reachedShortlist,
  withheldIndex,
  type IndexedApplication,
  type IndexExit,
  type IndexMetrics,
  type PublicIndex,
  type PublishedIndex,
} from "../domain/vetta-index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The cadence the go-to-market plan commits to: a new cut is at most a week old. */
const SNAPSHOT_MAX_AGE_MS = 7 * DAY_MS;

/**
 * How long a published figure stays quotable after its own window closes. A
 * benchmark nobody refreshed for a year is a museum plaque, and the honest
 * failure mode is the empty state again — not a number with a stale date
 * wearing a fresh one.
 */
const PUBLISHED_TTL_DAYS = 30;

const CACHE_TTL_MS = 5 * 60 * 1000;

const EMPTY_METRICS: IndexMetrics = {
  timeToShortlist: { medianDays: 0, q1Days: 0, q3Days: 0, sampleCount: 0 },
  pipelineExits: [],
};

type CacheEntry = { at: number; index: PublicIndex };

const g = globalThis as typeof globalThis & { __vettaIndexCache__?: CacheEntry };

/** Consent withdrawal and erasure both call this: the page must not outlive the data it came from. */
export function clearIndexCache(): void {
  delete g.__vettaIndexCache__;
}

function msOf(value: unknown): number {
  const raw = iso(value);
  if (!raw) return Number.NaN;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

type ApplicationRow = {
  application_id: string;
  org_id: string | null;
  role_id: string;
  created_at: unknown;
};

type EventRow = {
  application_id: string;
  to_stage: string;
  from_stage: string;
  created_at: unknown;
};

async function readWindow(windowStart: string) {
  const sql = await getSql();
  const [applicationRows, eventRows] = await Promise.all([
    sql<ApplicationRow>`
      select a.id as application_id, coalesce(a.org_id, r.org_id) as org_id, a.role_id, a.created_at
      from applications a
      join roles r on r.id = a.role_id
      where a.created_at > ${windowStart}::timestamptz`,
    sql<EventRow>`
      select e.application_id, e.to_stage, e.from_stage, e.created_at
      from pipeline_stage_events e
      join applications a on a.id = e.application_id
      where a.created_at > ${windowStart}::timestamptz
      order by e.application_id, e.created_at asc`,
  ]);
  return { applicationRows, eventRows };
}

/**
 * Days between a candidate applying and a human first putting them on a list.
 * The denominator is `applications.created_at` — the moment the person entered
 * the pipeline — not the first stage event, because the workspace only writes
 * an event when someone decides something, and "nobody decided for nine days"
 * is precisely the number the Index is trying to expose.
 */
function toIndexInput(
  applicationRows: ApplicationRow[],
  eventRows: EventRow[],
): { applications: IndexedApplication[]; exits: IndexExit[] } {
  const firstShortlist = new Map<string, number>();
  for (const event of eventRows) {
    if (!reachedShortlist(event.to_stage)) continue;
    const at = msOf(event.created_at);
    if (Number.isNaN(at)) continue;
    const existing = firstShortlist.get(event.application_id);
    if (existing === undefined || at < existing) firstShortlist.set(event.application_id, at);
  }

  const applications: IndexedApplication[] = applicationRows.map((row) => {
    const startedAt = msOf(row.created_at);
    const shortlistedAt = firstShortlist.get(row.application_id);
    const days =
      shortlistedAt === undefined || Number.isNaN(startedAt)
        ? null
        : (shortlistedAt - startedAt) / (1000 * 60 * 60 * 24);
    return {
      orgId: row.org_id ?? "",
      roleId: row.role_id,
      applicationId: row.application_id,
      daysToShortlist: days === null || Number.isNaN(days) ? null : days,
    };
  });

  const exits: IndexExit[] = eventRows
    .filter((event) => isPipelineExit(event.to_stage))
    .map((event) => ({ fromStage: event.from_stage }));

  return { applications, exits };
}

/**
 * Cut, store and return one snapshot. Every read that finds the newest cut more
 * than a week old calls this, which is how a solo product keeps a weekly cadence
 * without a scheduler: the traffic that wants the number is the traffic that
 * produces it.
 */
export async function buildIndexSnapshot(at = new Date()): Promise<PublicIndex> {
  const windowStart = new Date(at.getTime() - INDEX_WINDOW_DAYS * DAY_MS);
  const { applicationRows, eventRows } = await readWindow(windowStart.toISOString());
  const build = buildIndex(toIndexInput(applicationRows, eventRows));
  const reason = indexWithheldReason(build);

  const sql = await getSql();
  await sql`
    insert into vetta_index_snapshots (
      id, window_start, window_end, window_days,
      org_count, role_count, application_count,
      metrics_json, published, withheld_reason, built_at
    ) values (
      ${crypto.randomUUID()}, ${windowStart.toISOString()}::timestamptz,
      ${at.toISOString()}::timestamptz, ${INDEX_WINDOW_DAYS},
      ${build.cohorts.orgs}, ${build.cohorts.roles}, ${build.cohorts.applications},
      ${JSON.stringify(build.metrics)}, ${reason === ""}, ${reason},
      ${at.toISOString()}::timestamptz
    )`;

  clearIndexCache();
  return toPublicIndex({
    id: "just-built",
    metrics: build.metrics,
    cohorts: build.cohorts,
    windowDays: INDEX_WINDOW_DAYS,
    windowStart: windowStart.toISOString(),
    windowEnd: at.toISOString(),
    builtAt: at.toISOString(),
    publishedAt: reason === "" ? at.toISOString() : null,
  });
}

/** Erasure hook: the person's application must leave the published statistic, not just the database. */
export async function recomputePublicIndex(): Promise<void> {
  await buildIndexSnapshot();
}

type SnapshotShape = {
  id: string;
  metrics: IndexMetrics;
  cohorts: { orgs: number; roles: number; applications: number };
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  builtAt: string;
  /** Null when this cut cleared no floor. */
  publishedAt: string | null;
};

function toPublicIndex(snapshot: SnapshotShape): PublicIndex {
  if (!snapshot.publishedAt) {
    return withheldIndex({
      message: publicHoldMessage(),
      lastCheckedAt: snapshot.builtAt,
    });
  }
  return {
    state: "published",
    id: snapshot.id,
    metrics: snapshot.metrics,
    cohorts: snapshot.cohorts,
    windowDays: snapshot.windowDays,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    builtAt: snapshot.builtAt,
  };
}

function rowToSnapshot(row: Record<string, unknown>): SnapshotShape {
  return {
    id: String(row.id),
    metrics: parseJson<IndexMetrics>(row.metrics_json, EMPTY_METRICS),
    cohorts: {
      orgs: Number(row.org_count ?? 0),
      roles: Number(row.role_count ?? 0),
      applications: Number(row.application_count ?? 0),
    },
    windowDays: Number(row.window_days ?? INDEX_WINDOW_DAYS),
    windowStart: iso(row.window_start),
    windowEnd: iso(row.window_end),
    builtAt: iso(row.built_at),
    publishedAt: row.published ? iso(row.built_at) : null,
  };
}

/**
 * Raw SQL text, not a bound fragment: this is a column list, and the query
 * builder would otherwise try to hand it to Postgres as a value. The one reader
 * takes the newest row it can find — no filter a UI could forget.
 */
const SNAPSHOT_SELECT = `
  select id, window_start, window_end, window_days, org_count, role_count,
         application_count, metrics_json, published, withheld_reason, built_at
  from vetta_index_snapshots`;

async function newestSnapshot(): Promise<SnapshotShape | null> {
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    `${SNAPSHOT_SELECT} order by built_at desc limit 1`,
    [],
  );
  return rows[0] ? rowToSnapshot(rows[0]) : null;
}

/** The freshest figure still inside its own shelf life — after that, the page goes empty again. */
function isQuotable(snapshot: SnapshotShape): boolean {
  if (!snapshot.publishedAt) return false;
  const cut = msOf(snapshot.builtAt);
  return !Number.isNaN(cut) && Date.now() - cut <= PUBLISHED_TTL_DAYS * DAY_MS;
}

export async function readPublicIndex(): Promise<PublicIndex> {
  const cached = g.__vettaIndexCache__;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.index;

  let newest = await newestSnapshot();
  if (!newest || Date.now() - msOf(newest.builtAt) > SNAPSHOT_MAX_AGE_MS) {
    await buildIndexSnapshot();
    newest = await newestSnapshot();
  }

  // The Index is the newest cut, and only the newest cut. Searching backwards
  // for "the last published one" would keep a founder's median on the page for
  // a month after an erasure took the cohort under its floor — which is the
  // precise thing `recomputePublicIndex` exists to prevent.
  const index =
    newest && isQuotable(newest)
      ? toPublicIndex(newest)
      : withheldIndex({
          message: publicHoldMessage(),
          lastCheckedAt: newest?.builtAt ?? null,
        });
  g.__vettaIndexCache__ = { at: Date.now(), index };
  return index;
}
