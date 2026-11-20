/**
 * The Vetta Index — the arithmetic behind the number we ask the market to
 * repeat, kept pure so it can be argued with in a test instead of in a thread.
 *
 * Two rules decide everything here, and both exist because a published
 * statistic is a promise:
 *
 *   1. **Medians and quartiles only.** A mean over twenty applications is a
 *      number one slow hire owns; a median over a floor of fifty is a property
 *      of the market. Nothing in this file computes, stores or exports
 *      anything about an individual application, and nothing publishes a
 *      distribution of people — only the shape of the funnel.
 *   2. **The floor is the product.** Below INDEX_FLOOR there is no Index, and
 *      the page says so with a reason. A benchmark published from three
 *      companies is marketing dressed as data, and the day a founder checks it
 *      is the day the whole "evidence-first" position stops being believed.
 */
import { computeMedian } from "../../analytics/domain/funnel-analytics.ts";

/** The smallest cohort we will put a public number on: companies, roles, applications. */
export const INDEX_FLOOR = { orgs: 5, roles: 25, applications: 50 } as const;

/** Rolling window the snapshot is cut over. Ninety days is a quarter of hiring, not a trend. */
export const INDEX_WINDOW_DAYS = 90;

/**
 * Pipeline statuses at or past the shortlist, in the vocabulary the product
 * actually writes (`PIPELINE_STATUSES`). A candidate counted here was called
 * worth the founder's time; the days between applying and that call are the
 * metric.
 */
const SHORTLISTED_OR_PAST = new Set([
  "shortlisted",
  "screening",
  "ready",
  "approved",
  "sent",
]);

/**
 * Where a pipeline ends, phrased for a reader who has never seen our schema.
 * The stage names come from a closed set we write, which is the entire reason
 * this metric is publishable: a recruiter's free-text reason for rejecting
 * someone can contain that someone's name, a client's name, anything. The
 * stage they were sitting in cannot.
 */
const EXIT_STAGE_LABELS: Record<string, string> = {
  ingested: "Still unread — applied, never ranked",
  ranked: "Ranked, before the shortlist",
  shortlisted: "Shortlisted, then cut",
  screening: "In the written screen",
  ready: "Reviewed and ready, then cut",
  approved: "Approved for the client, then cut",
  sent: "At the offer, then cut",
  hold: "Put on hold, then cut",
};

const UNKNOWN_EXIT_STAGE = "Another point in the pipeline";

/**
 * Statuses that end a pipeline. The product writes `rejected`; the enterprise
 * funnel vocabulary adds the three ways an offer dies. Anything else is a
 * candidate still in play, and counting them as exits would understate where
 * founders actually lose people.
 */
const EXIT_STATUSES = new Set(["rejected", "offer_declined", "reneged", "no_show"]);

/** Did this event put the candidate on a list someone will read? */
export function reachedShortlist(toStage: string): boolean {
  return SHORTLISTED_OR_PAST.has(toStage);
}

/** Did this event end the pipeline? */
export function isPipelineExit(toStage: string): boolean {
  return EXIT_STATUSES.has(toStage);
}

export type IndexCohorts = {
  orgs: number;
  roles: number;
  applications: number;
};

/** A spread worth publishing: the middle, the middle half, and what it took to get there. */
export type Spread = {
  medianDays: number;
  q1Days: number;
  q3Days: number;
  sampleCount: number;
};

export type ExitShare = {
  stage: string;
  label: string;
  count: number;
  /** Percent of recorded exits; rounds, so the column may not total exactly 100. */
  share: number;
};

export type IndexMetrics = {
  timeToShortlist: Spread;
  pipelineExits: ExitShare[];
};

/** One application inside the window, with the one number we ask of it. */
export type IndexedApplication = {
  orgId: string;
  roleId: string;
  applicationId: string;
  /** Null when the candidate was never shortlisted — it counts toward the floor, not the median. */
  daysToShortlist: number | null;
};

export type IndexExit = {
  /** The status the candidate was sitting in when the pipeline ended. */
  fromStage: string;
};

export type IndexBuild = {
  cohorts: IndexCohorts;
  metrics: IndexMetrics;
  meetsFloors: boolean;
  /** Floors we are short of, phrased for the page that has to say no. */
  missing: string[];
};

/**
 * Quantile by linear interpolation between the two ranks either side (the
 * method R calls type 7 and spreadsheets call QUARTILE.INC). Interpolated
 * rather than snapped to a member of the sample, because with fifty
 * applications a nearest-rank Q1 moves on one record and the number would
 * look unstable to anyone who checked.
 */
export function computeQuantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return round1(sorted[0] as number);
  const position = Math.min(Math.max(fraction, 0), 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  const low = sorted[lower] as number;
  const high = sorted[upper] as number;
  return round1(low + (high - low) * weight);
}

/**
 * The published shape of a duration distribution. `medianDays` comes from the
 * same `computeMedian` the workspace dashboards use, so a founder who is given
 * the raw export can reproduce our headline from their own copy of the data.
 */
export function computeSpread(durations: number[]): Spread {
  return {
    medianDays: computeMedian(durations),
    q1Days: computeQuantile(durations, 0.25),
    q3Days: computeQuantile(durations, 0.75),
    sampleCount: durations.length,
  };
}

export function countCohorts(applications: IndexedApplication[]): IndexCohorts {
  const orgs = new Set<string>();
  const roles = new Set<string>();
  for (const application of applications) {
    // An application we cannot attribute to a company is not evidence about
    // companies, so it widens no cohort. Fail-closed, as everywhere else.
    if (application.orgId) orgs.add(application.orgId);
    if (application.roleId) roles.add(application.roleId);
  }
  return { orgs: orgs.size, roles: roles.size, applications: applications.length };
}

/** Counts per exit stage, biggest first, each as a percent of every exit recorded. */
export function summariseExits(exits: IndexExit[]): ExitShare[] {
  if (exits.length === 0) return [];
  const counts = new Map<string, number>();
  for (const exit of exits) {
    const stage = EXIT_STAGE_LABELS[exit.fromStage] ? exit.fromStage : "";
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([stage, count]) => ({
      stage,
      label: stage ? (EXIT_STAGE_LABELS[stage] as string) : UNKNOWN_EXIT_STAGE,
      count,
      share: round1((count / exits.length) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The floor, in the order a reader would want to be told which one is missing. */
export function missingFloors(cohorts: IndexCohorts): string[] {
  const missing: string[] = [];
  if (cohorts.orgs < INDEX_FLOOR.orgs) {
    missing.push(
      `${cohorts.orgs} of ${INDEX_FLOOR.orgs} companies have live pipelines in the window`,
    );
  }
  if (cohorts.roles < INDEX_FLOOR.roles) {
    missing.push(`${cohorts.roles} of ${INDEX_FLOOR.roles} open roles`);
  }
  if (cohorts.applications < INDEX_FLOOR.applications) {
    missing.push(`${cohorts.applications} of ${INDEX_FLOOR.applications} applications`);
  }
  return missing;
}

export function buildIndex(input: {
  applications: IndexedApplication[];
  exits: IndexExit[];
}): IndexBuild {
  const cohorts = countCohorts(input.applications);
  const durations = input.applications
    .map((application) => application.daysToShortlist)
    .filter((days): days is number => days !== null && Number.isFinite(days) && days >= 0);

  const missing = missingFloors(cohorts);
  return {
    cohorts,
    meetsFloors: missing.length === 0,
    missing,
    metrics: {
      // Below the floor nothing is published, so the arithmetic is not run on a
      // cohort that could not survive being quoted: the medians of a withheld
      // snapshot are empty, not small.
      timeToShortlist: missing.length
        ? { medianDays: 0, q1Days: 0, q3Days: 0, sampleCount: 0 }
        : computeSpread(durations),
      pipelineExits: missing.length ? [] : summariseExits(input.exits),
    },
  };
}

/**
 * Why nothing was published, in the terms an operator needs: the floor and our
 * distance from it. This goes in the snapshot table and the admin's funnel view,
 * not on the public page — a stranger does not need to be told how many
 * companies are hiring on Vetta this quarter, and the difference between those
 * two audiences is the difference between an honest page and a scoreboard.
 */
export function withheldMessage(missing: string[]): string {
  if (missing.length === 0) return "No Index has met its floor yet.";
  return `Not published yet: ${missing.join("; ")}.`;
}

/**
 * The one sentence the public gets instead: the rule, not our scale. It states
 * the floor exactly as the code enforces it, so the page cannot drift from the
 * gate, and it promises no date — a date we miss becomes the scarcity theatre
 * this strategy bans.
 */
export function publicHoldMessage(
  floor: typeof INDEX_FLOOR = INDEX_FLOOR,
  windowDays: number = INDEX_WINDOW_DAYS,
): string {
  return `Not published yet. The Index needs at least ${floor.orgs} companies, ${floor.roles} open roles and ${floor.applications} applications inside one ${windowDays}-day window, and Vetta publishes nothing below that — including this page, which shows no number until there is one worth quoting.`;
}

/** Empty string means publish. Called once per snapshot, and its answer is stored. */
export function indexWithheldReason(build: IndexBuild): string {
  if (build.missing.length > 0) return withheldMessage(build.missing);
  if (build.metrics.timeToShortlist.sampleCount === 0) {
    return withheldMessage([
      "the cohort cleared its floor, but no application in the window reached a shortlist",
    ]);
  }
  return "";
}

export type PublishedIndex = {
  state: "published";
  id: string;
  metrics: IndexMetrics;
  cohorts: IndexCohorts;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  builtAt: string;
};

export type WithheldIndex = {
  state: "not_published";
  message: string;
  floor: typeof INDEX_FLOOR;
  windowDays: number;
  /** When we last looked, so the page can point at a check rather than a feeling. */
  lastCheckedAt: string | null;
};

export type PublicIndex = PublishedIndex | WithheldIndex;

/** The Index is empty until the first cohort clears the floor — that is a state, not an error. */
export function withheldIndex(opts: {
  message?: string;
  lastCheckedAt?: string | null;
}): WithheldIndex {
  return {
    state: "not_published",
    message: opts.message ?? publicHoldMessage(),
    floor: INDEX_FLOOR,
    windowDays: INDEX_WINDOW_DAYS,
    lastCheckedAt: opts.lastCheckedAt ?? null,
  };
}

export function formatDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "—";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }
  if (days >= 30) return `${round1(days / 30)} months`;
  return `${round1(days)} days`;
}

export type HeroStat = { label: string; value: string; note: string };

/**
 * The hero's proof block. Deliberately carries the denominator and the date in
 * the note: a headline number without a sample size is the exact thing we
 * accuse the rest of the market of. Null is the honest state — the hero renders
 * no stat rather than a placeholder one.
 */
export function indexHeroStat(index: PublicIndex): HeroStat | null {
  if (index.state !== "published") return null;
  return {
    label: "Median time to shortlist",
    value: formatDays(index.metrics.timeToShortlist.medianDays),
    note: `${index.metrics.timeToShortlist.sampleCount} applications · ${index.cohorts.orgs} companies · as of ${shortDate(index.builtAt)}`,
  };
}

export function shortDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

/**
 * The sentence we want quoted, with its own provenance welded to it. It lives
 * here rather than in the page because a citation written by a template literal
 * in JSX is a citation that drifts from the number it describes — and a
 * half-sourced statistic is the thing we accuse job boards of.
 */
export function indexCitation(index: PublishedIndex): string {
  const spread = index.metrics.timeToShortlist;
  return `Vetta Index: across ${spread.sampleCount} applications at ${index.cohorts.orgs} companies, ` +
    `the median time from applying to being shortlisted was ${formatDays(spread.medianDays)} ` +
    `(middle half: ${formatDays(spread.q1Days)} to ${formatDays(spread.q3Days)}) in the ${index.windowDays} days ` +
    `to ${shortDate(index.windowEnd)}. Cut ${shortDate(index.builtAt)}.`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
