import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";
import {
  PREVIEW_WEBHOOK_SECRET,
  billableAsSuccessFee,
  handleWebhookDelivery,
} from "./razorpay.server.ts";
import { productQuotaStateForOrg, setProductPlan } from "./plans.server.ts";
import { SUCCESS_FEE_PAISE } from "../domain/razorpay.ts";
import {
  createOrUpdatePreboardingOffer,
  resolvePreboardingOffer,
} from "../../recruiting/server/offer-guard.server.ts";

/**
 * The money path, end to end, against the real schema.
 *
 * The pricing page promises two things a founder can be burned by: that a
 * payment switches the plan exactly once, and that a hire costs a flat fee only
 * when they were not already paying for the plan. Both are claims about the
 * database, so both are tested here rather than in a browser.
 */

function signed(rawBody: string) {
  return createHmac("sha256", PREVIEW_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
}

function captureEvent(orgId: string, plan: string, amountPaise = 699_900) {
  const eventId = `evt_${randomUUID()}`;
  const rawBody = JSON.stringify({
    id: eventId,
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: `pay_${eventId.slice(-6)}`,
          order_id: `order_${eventId.slice(-6)}`,
          amount: amountPaise,
          currency: "INR",
          notes: { org_id: orgId, plan },
        },
      },
    },
  });
  return { eventId, rawBody, signature: signed(rawBody) };
}

async function seedWorkspace(label: string) {
  const sql = await getSql();
  const orgId = `org_${label}_${randomUUID().slice(0, 8)}`;
  const userId = `usr_${label}_${randomUUID().slice(0, 8)}`;
  await sql`
    insert into organizations (id, name, slug, created_by, retention_days)
    values (${orgId}, ${`B1 ${label} Labs`}, ${`slug-${orgId}`}, ${userId}, 180)`;
  return { sql, orgId, userId };
}

async function seedHiredOffer(orgId: string, userId: string, tag: string) {
  const sql = await getSql();
  const roleId = `role_${tag}_${randomUUID().slice(0, 8)}`;
  const candidateId = `cand_${tag}_${randomUUID().slice(0, 8)}`;
  const applicationId = `app_${tag}_${randomUUID().slice(0, 8)}`;
  await sql`
    insert into roles (id, user_id, title, company_name, company_stage, location, work_mode, jd_text)
    values (${roleId}, ${userId}, 'Staff Engineer', 'B1 Labs', 'seed', 'Bengaluru', 'hybrid', 'JD')`;
  await sql`
    insert into candidates (id, user_id, org_id, full_name, email, phone, resume_text, provenance_type)
    values (${candidateId}, ${userId}, ${orgId}, 'Rahul Verma', 'rahul@example.com', '+919999900001', 'Resume', 'direct_portal')`;
  await sql`
    insert into applications (id, user_id, role_id, candidate_id, pipeline_status)
    values (${applicationId}, ${userId}, ${roleId}, ${candidateId}, 'joined')`;
  const offer = await createOrUpdatePreboardingOffer({
    orgId,
    roleId,
    candidateId,
    applicationId,
    targetJoiningDate: new Date(Date.now() + 45 * 86_400_000).toISOString(),
    offeredCtc: 3_000_000,
    currentCtc: 2_200_000,
  });
  return offer;
}

test("a captured payment flips the plan, and its replay flips nothing", async () => {
  const { sql, orgId } = await seedWorkspace("pay");
  const delivery = captureEvent(orgId, "starter");

  const first = await handleWebhookDelivery(delivery);
  assert.equal(first.status, 200);
  assert.equal(first.applied, true);

  const second = await handleWebhookDelivery(delivery);
  assert.equal(second.status, 200);
  assert.equal(second.applied, false);
  assert.equal(second.reason, "already applied");

  const [payments] = await sql<{ n: number }>`
    select count(*)::int as n from razorpay_payments where org_id = ${orgId}`;
  assert.equal(payments.n, 1, "a retried delivery must not book the money twice");

  const [event] = await sql<{ applied_at: string | null }>`
    select applied_at from razorpay_events where event_id = ${delivery.eventId}`;
  assert.ok(event.applied_at);

  const state = await productQuotaStateForOrg(orgId);
  assert.equal(state.plan, "starter");
  assert.equal(state.screeningsUsed, 0);
});

test("a delivery we cannot verify is refused before it is read", async () => {
  const { sql, orgId } = await seedWorkspace("forged");
  const delivery = captureEvent(orgId, "growth");
  const forged = { ...delivery, signature: "f".repeat(64) };

  const outcome = await handleWebhookDelivery(forged);
  assert.equal(outcome.status, 400);
  assert.equal(outcome.applied, false);

  const [events] = await sql<{ n: number }>`
    select count(*)::int as n from razorpay_events where event_id = ${delivery.eventId}`;
  assert.equal(events.n, 0);
  const state = await productQuotaStateForOrg(orgId);
  assert.equal(state.plan, "free", "a forged delivery must not buy a plan");
});

test("the amount the event carries is the amount we book, not the tier we guess", async () => {
  const { sql, orgId } = await seedWorkspace("amount");
  const delivery = captureEvent(orgId, "growth", 1_699_900);
  assert.equal((await handleWebhookDelivery(delivery)).applied, true);

  const [row] = await sql<{ amount_paise: number; plan: string }>`
    select amount_paise, plan from razorpay_payments where org_id = ${orgId} limit 1`;
  assert.equal(row.amount_paise, 1_699_900);
  assert.equal(row.plan, "growth");
});

test("a hire on the waived subscription drafts the flat success fee, once", async () => {
  const { sql, orgId, userId } = await seedWorkspace("fee");
  const offer = await seedHiredOffer(orgId, userId, "fee");

  assert.equal(await billableAsSuccessFee(orgId), true, "no plan row is the waived arrangement");

  const joined = await resolvePreboardingOffer({ orgId, offerId: offer.id, resolution: "joined" });
  assert.equal(joined.feeDrafted, true);
  assert.equal(joined.offer.resolution, "joined");

  const repeat = await resolvePreboardingOffer({ orgId, offerId: offer.id, resolution: "joined" });
  assert.equal(repeat.feeDrafted, false);
  assert.match(repeat.feeReason, /Already drafted/);

  const fees = await sql<{ amount_paise: number; status: string }>`
    select amount_paise, status from hire_success_fees where org_id = ${orgId}`;
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amount_paise, SUCCESS_FEE_PAISE);
  assert.equal(fees[0].status, "drafted");
});

test("a subscriber is not billed a success fee for hiring", async () => {
  const { sql, orgId, userId } = await seedWorkspace("subscribed");
  await setProductPlan({ orgId, userId, plan: "growth" });
  assert.equal(await billableAsSuccessFee(orgId), false);

  const offer = await seedHiredOffer(orgId, userId, "sub");
  const joined = await resolvePreboardingOffer({ orgId, offerId: offer.id, resolution: "joined" });
  assert.equal(joined.feeDrafted, false);
  assert.match(joined.feeReason, /already pays/);

  const [fees] = await sql<{ n: number }>`
    select count(*)::int as n from hire_success_fees where org_id = ${orgId}`;
  assert.equal(fees.n, 0);
});

test("a renege closes the offer and bills nothing", async () => {
  const { sql, orgId, userId } = await seedWorkspace("reneged");
  const offer = await seedHiredOffer(orgId, userId, "renege");

  const closed = await resolvePreboardingOffer({ orgId, offerId: offer.id, resolution: "reneged" });
  assert.equal(closed.feeDrafted, false);
  assert.equal(closed.offer.resolution, "reneged");

  const [fees] = await sql<{ n: number }>`
    select count(*)::int as n from hire_success_fees where org_id = ${orgId}`;
  assert.equal(fees.n, 0);
});

test("pulling an offer over does not rewrite what the hazard model believed", async () => {
  const { sql, orgId, userId } = await seedWorkspace("rescinded");
  const offer = await seedHiredOffer(orgId, userId, "rescind");
  const believed = offer.intentState;

  const pulled = await resolvePreboardingOffer({
    orgId,
    offerId: offer.id,
    resolution: "rescinded",
  });
  assert.equal(pulled.offer.resolution, "rescinded");
  assert.equal(pulled.offer.intentState, believed, "only a join or a renege is an intent state");
});

test("closing an offer in somebody else's workspace is refused", async () => {
  const a = await seedWorkspace("mine");
  const b = await seedWorkspace("theirs");
  const offer = await seedHiredOffer(a.orgId, a.userId, "cross");

  await assert.rejects(
    () => resolvePreboardingOffer({ orgId: b.orgId, offerId: offer.id, resolution: "joined" }),
    /not found in your workspace/,
  );
});
