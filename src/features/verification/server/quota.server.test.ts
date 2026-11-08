/**
 * The meter against a real database.
 *
 * `domain/quota.test.ts` proves the arithmetic — that an absent allowance is
 * four and not zero, and that a nonsense number cannot invent entitlement.
 * What only the door can prove is the three things a wire can get wrong:
 *
 *  1. a retry of the same report is not sold twice, and a charge that was
 *     refused says which of the two happened;
 *  2. the allowance is spent down to zero and then holds, in the same
 *     statement that writes the row, so two jobs finishing together cannot both
 *     take the last one;
 *  3. what the workspace is told it cost is what its reports actually cost —
 *     measured out of the charges, never out of a price list.
 *
 * The last is the one worth reading twice. Nothing in this repo takes money, so
 * the only honest number the product can show is the one the runs left behind:
 * the byte arms cost the pool CPU and the org nothing, and a page that printed
 * ₹500 because the registry says a lookup costs that would be selling a service
 * the arm never called out for.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getSql } from "../../../platform/db.ts";
import { ensureUserOrg } from "../../people/server/org.server.ts";
import { FREE_USE_ALLOWANCE } from "../domain/quota.ts";
import {
  chargeVerificationUse,
  entitlementForOrg,
  quotaStateForOrg,
  setVerificationPlan,
  verificationQuotaSummary,
} from "./quota.server.ts";

let seq = 0;
const uid = () => `vm-${Date.now().toString(36)}-${(seq += 1)}`;

async function workspace() {
  const userId = uid();
  const org = await ensureUserOrg(userId, "Vetta Meter Co");
  return { userId, orgId: org.orgId };
}

/** One report's charge, with the shape the queue passes. */
const charge = (
  w: { userId: string; orgId: string },
  candidateId: string,
  reportId: string,
  costPaise = 0,
) =>
  chargeVerificationUse({
    orgId: w.orgId,
    userId: w.userId,
    candidateId,
    reportId,
    engineVersion: "vetta-verify-2",
    costPaise,
  });

test("an org with no plan row is a workspace with an allowance, not a zero", async () => {
  const state = await quotaStateForOrg(uid());
  assert.deepEqual(state, { plan: "free", freeQuota: FREE_USE_ALLOWANCE, usesSpent: 0 });

  // And no id at all is the same answer: the feature must not be able to tell a
  // missing tenant apart from a new one by failing.
  assert.deepEqual(await quotaStateForOrg(""), state);
});

test("the allowance is spent down to nothing and then holds", async () => {
  const w = await workspace();
  await setVerificationPlan({ orgId: w.orgId, userId: w.userId, plan: "free", freeQuota: 2 });

  const first = await charge(w, uid(), uid());
  const second = await charge(w, uid(), uid());
  assert.deepEqual([first.charged, second.charged], [true, true]);
  assert.equal((await quotaStateForOrg(w.orgId)).usesSpent, 2);

  const third = await charge(w, uid(), uid());
  assert.equal(third.charged, false, "a meter at its allowance does not go negative");
  assert.match(third.reason, /switched off/i, "and the refusal is a sentence, not a code");

  const summary = await verificationQuotaSummary(w.orgId);
  assert.equal(summary.usesLeft, 0);
  assert.equal(summary.entitled, false, "an exhausted trial is not an entitlement");
  assert.equal(summary.plan, "free");
});

test("the same report charged twice is one use, and the answer says so", async () => {
  const w = await workspace();
  const candidateId = uid();
  const reportId = uid();

  const first = await charge(w, candidateId, reportId);
  const again = await charge(w, candidateId, reportId);
  assert.equal(first.charged, true);
  assert.equal(again.charged, false);
  assert.match(again.reason, /earlier attempt/i, "the retry is recorded, not re-sold");
  assert.equal(again.useId, first.useId, "and it names the row that already exists");
  assert.equal((await verificationQuotaSummary(w.orgId)).usesSpent, 1);

  // The same candidate, a genuinely different report — a re-ingest that changed
  // the claim set — is a new use: the key names the report row, not the person.
  const refreshed = await charge(w, candidateId, uid());
  assert.equal(refreshed.charged, true);
  assert.equal((await verificationQuotaSummary(w.orgId)).usesSpent, 2);
});

test("a paid plan is entitled whatever the meter says, and does not burn the trial", async () => {
  const w = await workspace();
  await setVerificationPlan({ orgId: w.orgId, userId: w.userId, plan: "paid" });

  for (let i = 0; i < 6; i += 1) {
    const result = await charge(w, uid(), uid());
    assert.equal(result.charged, true, `report ${i} on a paid plan`);
    assert.equal(result.kind, "paid");
  }

  const summary = await verificationQuotaSummary(w.orgId);
  assert.equal(summary.usesSpent, 0, "a workspace that never needed its trial did not spend it");
  assert.equal(summary.entitled, true);
  assert.equal(summary.charge, "paid");
});

test("what the workspace is told it cost is what its reports cost", async () => {
  const w = await workspace();
  await setVerificationPlan({ orgId: w.orgId, userId: w.userId, plan: "free", freeQuota: 4 });

  await charge(w, uid(), uid(), 4200);
  await charge(w, uid(), uid(), 0);

  const summary = await verificationQuotaSummary(w.orgId);
  assert.equal(summary.measuredCostPaise, 4200, "summed from the charges, not from a price list");
  assert.equal(summary.measuredCostPerUsePaise, 2100, "per report, including the free-to-produce one");
  assert.equal(
    summary.reason.length > 0,
    true,
    "and there is always a sentence explaining the entitlement",
  );

  // A workspace that has never been charged has no cost to report — and no
  // invented one either.
  const fresh = await verificationQuotaSummary((await workspace()).orgId);
  assert.deepEqual(
    [fresh.measuredCostPaise, fresh.measuredCostPerUsePaise, fresh.lastUsedAtMs],
    [0, 0, null],
  );
});

test("the settings wire cannot set the meter", async () => {
  const w = await workspace();
  await charge(w, uid(), uid());

  const after = await setVerificationPlan({
    orgId: w.orgId,
    userId: w.userId,
    plan: "free",
    freeQuota: 10,
  });
  assert.equal(after.usesSpent, 1, "the read-back is the database's count, not a parameter");
  assert.equal((await verificationQuotaSummary(w.orgId)).usesSpent, 1);
  assert.equal(after.freeQuota, 10, "the allowance is the only number a caller may move");
});

test("a charge nobody can attribute is refused before it reaches the meter", async () => {
  const w = await workspace();
  const noOrg = await chargeVerificationUse({
    orgId: "",
    userId: w.userId,
    candidateId: uid(),
    reportId: uid(),
    engineVersion: "vetta-verify-2",
  });
  assert.equal(noOrg.charged, false);
  assert.match(noOrg.reason, /no tenant/i);

  const noReport = await chargeVerificationUse({
    orgId: w.orgId,
    userId: w.userId,
    candidateId: uid(),
    reportId: "",
    engineVersion: "vetta-verify-2",
  });
  assert.equal(noReport.charged, false, "a charge with no report behind it is a charge for nothing");
  assert.equal((await verificationQuotaSummary(w.orgId)).usesSpent, 0);
});

test("a plan string nobody wrote is read as the free plan, with its allowance", async () => {
  const w = await workspace();
  const sql = await getSql();
  await sql`
    insert into org_verification_plans (org_id, user_id, plan, free_quota)
    values (${w.orgId}, ${w.userId}, 'enterprise-annual', 4)`;

  const { state, entitlement } = await entitlementForOrg(w.orgId);
  assert.equal(state.plan, "free", "an unrecognised plan is not an entitlement");
  assert.equal(entitlement.entitled, true, "and it is still the four reports the product promises");

  for (let i = 0; i < 4; i += 1) await charge(w, uid(), uid());
  const after = await entitlementForOrg(w.orgId);
  assert.equal(after.entitlement.entitled, false, "and no more than four");
});

/**
 * The wire and the page, checked as text.
 *
 * A test cannot click here, and the two lines worth fearing are one line each:
 * a settings route that takes an org id would let any page aim the plan at
 * another tenant, and a handler that passes `freeQuota` from the client would
 * hand its own workspace an unlimited trial. Both are invisible to every other
 * test in this file because both are about what a caller *may send*.
 */
test("the settings wire takes an agreement, and neither a tenant nor an allowance", () => {
  const source = readFileSync(new URL("../api/verification-api.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const setVerificationPlan");
  assert.ok(start > -1, "the plan wire exists");
  const wire = source.slice(start).replace(/\s+/g, " ");

  assert.match(wire, /plan: z\.enum\(\["free", "paid"\]\)/, "the only field a caller may send");
  // The tenant is derived server-side and the allowance is counted from the
  // charges, so neither may arrive on the request — `orgId` appears in this
  // handler, but only ever as `org.orgId` from the verified session.
  assert.ok(!/data\.orgId/.test(wire), "no caller-chosen tenant");
  assert.ok(!/data\.freeQuota/.test(wire), "no caller-chosen allowance");
  assert.match(wire, /orgId: org\.orgId/, "the org comes from the session");
  assert.match(wire, /plan: data\.plan/, "and the agreement is the one thing it carries");

  const page = readFileSync(
    new URL("../../../routes/app/roles.$roleId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    page,
    /<VerificationQuotaStrip \/>/,
    "the meter is shown where the work is read, not only in a settings page nobody opens",
  );
});
