import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_FLOOR,
  buildIndex,
  computeQuantile,
  countCohorts,
  formatDays,
  indexCitation,
  indexHeroStat,
  indexWithheldReason,
  isPipelineExit,
  missingFloors,
  publicHoldMessage,
  reachedShortlist,
  shortDate,
  summariseExits,
  withheldMessage,
  withheldIndex,
  type IndexedApplication,
  type PublicIndex,
} from "./vetta-index.ts";

/**
 * The Index is the number we ask competitors and AI engines to quote, so these
 * tests hold the two things that make a quote safe: the floor that decides
 * whether a number exists at all, and the closed vocabulary that decides what
 * can be said about a person's rejection.
 */

function applications(
  count: number,
  over: Partial<IndexedApplication> = {},
): IndexedApplication[] {
  return Array.from({ length: count }, (_, i) => ({
    orgId: `org-${i % INDEX_FLOOR.orgs}`,
    roleId: `role-${i}`,
    applicationId: `app-${i}`,
    daysToShortlist: 3,
    ...over,
  }));
}

/** The smallest cohort that clears every floor, so each test starts publishable. */
function publishableCohort(): IndexedApplication[] {
  return Array.from({ length: INDEX_FLOOR.applications }, (_, i) => ({
    orgId: `org-${i % INDEX_FLOOR.orgs}`,
    roleId: `role-${i}`,
    applicationId: `app-${i}`,
    daysToShortlist: i + 1,
  }));
}

test("a cohort short of any floor publishes nothing, and says which floor", () => {
  // Same fifty applications and fifty roles, one fewer company behind them.
  const fourOrgs = applications(INDEX_FLOOR.applications).map((a, i) => ({
    ...a,
    orgId: `org-${i % (INDEX_FLOOR.orgs - 1)}`,
  }));
  const build = buildIndex({ applications: fourOrgs, exits: [] });
  assert.equal(build.meetsFloors, false);
  assert.equal(build.cohorts.orgs, INDEX_FLOOR.orgs - 1);
  assert.deepEqual(build.missing, [
    `${INDEX_FLOOR.orgs - 1} of ${INDEX_FLOOR.orgs} companies have live pipelines in the window`,
  ]);
  // Not a small number. No number — a withheld snapshot must not carry a median
  // that a later refactor could mistake for a published one.
  assert.equal(build.metrics.timeToShortlist.medianDays, 0);
  assert.equal(build.metrics.timeToShortlist.sampleCount, 0);
  assert.deepEqual(build.metrics.pipelineExits, []);
});

test("each floor blocks on its own, in the order a reader would ask", () => {
  assert.equal(missingFloors({ orgs: 4, roles: 25, applications: 50 }).length, 1);
  assert.equal(missingFloors({ orgs: 5, roles: 24, applications: 50 }).length, 1);
  assert.equal(missingFloors({ orgs: 5, roles: 25, applications: 49 }).length, 1);
  assert.deepEqual(
    missingFloors({ orgs: 0, roles: 0, applications: 0 }),
    [
      `0 of ${INDEX_FLOOR.orgs} companies have live pipelines in the window`,
      `0 of ${INDEX_FLOOR.roles} open roles`,
      `0 of ${INDEX_FLOOR.applications} applications`,
    ],
    "the sentence names every shortfall, not only the first",
  );
  assert.deepEqual(missingFloors({ orgs: 5, roles: 25, applications: 50 }), []);
});

test("a cleared floor publishes a median, and the quartiles bracket it", () => {
  const cohort = publishableCohort();
  const { metrics, meetsFloors } = buildIndex({ applications: cohort, exits: [] });
  assert.equal(meetsFloors, true);
  // 1..50 days: the middle of an even sample is the mean of the two centre values.
  assert.equal(metrics.timeToShortlist.medianDays, 25.5);
  assert.ok(metrics.timeToShortlist.q1Days <= metrics.timeToShortlist.medianDays);
  assert.ok(metrics.timeToShortlist.q3Days >= metrics.timeToShortlist.medianDays);
  assert.equal(metrics.timeToShortlist.sampleCount, INDEX_FLOOR.applications);
});

test("an application never shortlisted counts toward the floor but not the median", () => {
  const cohort = publishableCohort().map((a, i) =>
    i < 10 ? { ...a, daysToShortlist: null } : a,
  );
  const build = buildIndex({ applications: cohort, exits: [] });
  assert.equal(build.cohorts.applications, INDEX_FLOOR.applications);
  assert.equal(build.metrics.timeToShortlist.sampleCount, INDEX_FLOOR.applications - 10);
  assert.equal(build.meetsFloors, true, "the floor is about cohort size, not outcome rate");
});

test("a negative or non-finite duration is refused, not averaged in", () => {
  const cohort = publishableCohort();
  cohort[0] = { ...cohort[0]!, daysToShortlist: -2 };
  cohort[1] = { ...cohort[1]!, daysToShortlist: Number.NaN };
  const build = buildIndex({ applications: cohort, exits: [] });
  assert.equal(build.metrics.timeToShortlist.sampleCount, INDEX_FLOOR.applications - 2);
  assert.ok(Number.isFinite(build.metrics.timeToShortlist.medianDays));
});

test("an unattributable application widens no cohort", () => {
  const cohort = publishableCohort().map((a) => ({ ...a, orgId: "" }));
  const build = buildIndex({ applications: cohort, exits: [] });
  assert.equal(build.cohorts.orgs, 0);
  assert.equal(build.meetsFloors, false);
});

test("exits are labelled only from a closed vocabulary — no text we did not write", () => {
  const shares = summariseExits([
    { fromStage: "ranked" },
    { fromStage: "ranked" },
    { fromStage: "shortlisted" },
    { fromStage: "priya said no to the CTC" },
  ]);
  assert.equal(shares.length, 3);
  assert.equal(shares[0]?.label, "Ranked, before the shortlist");
  assert.equal(shares[0]?.share, 50);
  assert.ok(
    shares.some((s) => s.label === "Another point in the pipeline"),
    "an unknown stage is admitted, not dropped — dropping it would silently inflate the rest",
  );
  assert.ok(
    !JSON.stringify(shares).includes("priya"),
    "a recruiter's free text can never reach a published payload",
  );
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  assert.ok(Math.abs(total - 100) < 0.4, `shares round to within a hair of 100, got ${total}`);
});

test("no recorded exits publishes an empty distribution rather than a zero percent", () => {
  assert.deepEqual(summariseExits([]), []);
  const build = buildIndex({ applications: publishableCohort(), exits: [] });
  assert.deepEqual(build.metrics.pipelineExits, []);
});

test("quartiles interpolate between ranks instead of snapping to a member", () => {
  // [1,2,3,4]: the 25th percentile sits a quarter of the way between 1 and 2,
  // so a nearest-rank method would publish 1 — and one more application would
  // move the published quarter to 2. Rounded to the tenth of a day, as every
  // published value is.
  assert.equal(computeQuantile([1, 2, 3, 4], 0.25), 1.8);
  assert.equal(computeQuantile([1, 2, 3, 4], 0.75), 3.3);
  assert.equal(computeQuantile([4, 1, 3, 2], 0.25), 1.8, "input order is irrelevant");
  assert.equal(computeQuantile([1, 2, 3, 4], 0), 1);
  assert.equal(computeQuantile([1, 2, 3, 4], 1), 4);
  assert.ok(
    computeQuantile([1, 2, 3, 4], 0.25) < computeQuantile([1, 2, 3, 4], 0.75),
    "the spread is ordered",
  );
  assert.equal(computeQuantile([7], 0.25), 7);
  assert.equal(computeQuantile([], 0.5), 0);
});

test("the hero carries a number only when one exists, and carries its denominator", () => {
  assert.equal(indexHeroStat(withheldIndex({ lastCheckedAt: null })), null);

  const published: PublicIndex = {
    state: "published",
    id: "snap-1",
    metrics: {
      timeToShortlist: { medianDays: 4.623, q1Days: 2, q3Days: 9, sampleCount: 128 },
      pipelineExits: [],
    },
    cohorts: { orgs: 9, roles: 41, applications: 302 },
    windowDays: 90,
    windowStart: "2026-08-15T00:00:00.000Z",
    windowEnd: "2026-11-13T00:00:00.000Z",
    builtAt: "2026-11-08T09:30:00.000Z",
  };
  const stat = indexHeroStat(published);
  assert.equal(stat?.label, "Median time to shortlist");
  assert.equal(stat?.value, "4.6 days");
  assert.match(stat?.note ?? "", /128 applications/);
  assert.match(stat?.note ?? "", /9 companies/);
  assert.match(stat?.note ?? "", /as of 2026-11-08/);
});

test("day formatting never invents a measurement", () => {
  assert.equal(formatDays(0), "—");
  assert.equal(formatDays(Number.NaN), "—");
  assert.equal(formatDays(0.5), "12 hrs");
  assert.equal(formatDays(1 / 24), "1 hr");
  assert.equal(formatDays(25.5), "25.5 days");
  assert.equal(formatDays(45), "1.5 months");
  assert.equal(shortDate("not a date"), "—");
  assert.equal(withheldMessage([]), "No Index has met its floor yet.");
});

test("the stage vocabulary matches what the product actually writes", () => {
  assert.ok(reachedShortlist("shortlisted"));
  assert.ok(reachedShortlist("sent"), "a candidate at the offer was shortlisted once");
  assert.ok(!reachedShortlist("ranked"), "ranked is a score, not a list a human read");
  assert.ok(!reachedShortlist("ingested"));
  assert.ok(isPipelineExit("rejected"));
  assert.ok(isPipelineExit("reneged"));
  assert.ok(!isPipelineExit("hold"), "on hold is not an ending");
});

test("a cohort that clears the floor but shortlists nobody still publishes nothing", () => {
  const nobody = publishableCohort().map((a) => ({ ...a, daysToShortlist: null }));
  const build = buildIndex({ applications: nobody, exits: [] });
  assert.equal(build.meetsFloors, true);
  assert.match(indexWithheldReason(build), /no application in the window reached a shortlist/);
  assert.equal(indexWithheldReason(buildIndex({ applications: publishableCohort(), exits: [] })), "");
});

test("the public refusal states the rule and never our scale", () => {
  const message = publicHoldMessage();
  assert.match(message, /at least 5 companies/);
  assert.match(message, /25 open roles/);
  assert.match(message, /50 applications/);
  assert.match(message, /90-day window/);
  assert.ok(!message.includes("have live pipelines"), "the internal shortfall stays internal");
});

test("countCohorts counts distinct companies, not rows", () => {
  assert.deepEqual(countCohorts(applications(12)), {
    orgs: INDEX_FLOOR.orgs,
    roles: 12,
    applications: 12,
  });
});

test("the citation cannot be lifted out of its own provenance", () => {
  const line = indexCitation({
    state: "published",
    id: "snap-1",
    metrics: {
      timeToShortlist: { medianDays: 4.623, q1Days: 2, q3Days: 9, sampleCount: 128 },
      pipelineExits: [],
    },
    cohorts: { orgs: 9, roles: 41, applications: 302 },
    windowDays: 90,
    windowStart: "2026-08-15T00:00:00.000Z",
    windowEnd: "2026-11-13T00:00:00.000Z",
    builtAt: "2026-11-08T09:30:00.000Z",
  });
  assert.match(line, /^Vetta Index: across 128 applications at 9 companies/);
  assert.match(line, /median time from applying to being shortlisted was 4\.6 days/);
  assert.match(line, /middle half: 2 days to 9 days/);
  assert.match(line, /in the 90 days to 2026-11-13/);
  assert.match(line, /Cut 2026-11-08/);
});
