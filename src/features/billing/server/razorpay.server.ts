/**
 * Razorpay, on the server, with the webhook as the only writer of plans.
 *
 * The page that takes the card does not decide what the card bought. It opens
 * Razorpay's checkout; Razorpay tells us, by webhook, that money arrived; this
 * file is the only path that flips `org_plans` from a payment. That is not
 * caution for its own sake — a client that reported `success` would let anyone
 * buy nothing and be on Vetta Ops.
 *
 * The idempotency spine is `razorpay_events.applied_at`, not the mere existence
 * of the row: a delivery that arrived, was verified, and then failed halfway
 * through the plan flip must be applicable on the retry. A key that only
 * records "seen" would strand that workspace paid and unupgraded.
 */
import { getSql } from "../../../platform/db.ts";
import { env, isWorkspacePreview } from "../../../platform/env.server.ts";
import {
  checkoutAmountPaise,
  parsePurchaseEvent,
  verifyWebhookSignature,
  type PurchaseEvent,
} from "../domain/razorpay.ts";
import type { ProductPlan } from "../domain/plans.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";

/**
 * The preview-only webhook secret, mirrored by `scripts/simulate-razorpay-webhook.mjs`.
 *
 * Without it the local route answers 503 to itself and the one property worth
 * testing — a replayed event flips the plan exactly once — cannot be exercised
 * before there is a Razorpay dashboard to point at a URL. It is reachable only
 * where `isWorkspacePreview()` is true; a deployed host sets VERCEL/PROJECT_ID,
 * and there an unconfigured secret stays a 503.
 */
export const PREVIEW_WEBHOOK_SECRET = "vetta_preview_webhook_secret";

function newId(): string {
  return crypto.randomUUID();
}

function webhookSecret(): string {
  return env("RAZORPAY_WEBHOOK_SECRET") ?? (isWorkspacePreview() ? PREVIEW_WEBHOOK_SECRET : "");
}

export type WebhookOutcome = {
  status: number;
  applied: boolean;
  reason: string;
};

/**
 * One delivery, from raw bytes to a decision.
 *
 * `rawBody` must be the request body exactly as received — verify before
 * parse, because the signature is over the bytes and JSON that has been through
 * `request.json()` and back is not those bytes.
 */
export async function handleWebhookDelivery(input: {
  rawBody: string;
  signature: string;
}): Promise<WebhookOutcome> {
  const secret = webhookSecret();
  if (!secret) return { status: 503, applied: false, reason: "Razorpay webhook secret is not configured" };

  if (!verifyWebhookSignature({ rawBody: input.rawBody, signature: input.signature, secret })) {
    // Nothing has been read into the database at this point, by construction.
    return { status: 400, applied: false, reason: "invalid signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, applied: false, reason: "body is not JSON" };
  }

  const event = parsePurchaseEvent(payload);
  if (!event) return { status: 200, applied: false, reason: "not a captured payment for a self-serve plan" };

  const sql = await getSql();
  const inserted = await sql<{ event_id: string }>`
    insert into razorpay_events (event_id, event_type, payload_json)
    values (${event.eventId}, ${event.eventType}, ${JSON.stringify(payload)})
    on conflict (event_id) do nothing
    returning event_id`;

  if (!inserted[0]) {
    const [seen] = await sql<{ applied_at: Date | string | null }>`
      select applied_at from razorpay_events where event_id = ${event.eventId} limit 1`;
    if (seen?.applied_at) {
      return { status: 200, applied: false, reason: "already applied" };
    }
    // Seen but never applied: an earlier attempt died mid-flip. Fall through —
    // every write below is an upsert, so retrying is safe.
  }

  await applyPurchase(event);
  await sql`
    update razorpay_events set applied_at = now()
    where event_id = ${event.eventId} and applied_at is null`;

  return { status: 200, applied: true, reason: `${event.plan} activated` };
}

async function applyPurchase(event: PurchaseEvent): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into razorpay_payments (
      id, org_id, user_id, order_id, payment_id, plan, amount_paise, currency, status, event_id
    )
    values (
      ${newId()}, ${event.orgId}, ${event.userId}, ${event.orderId}, ${event.paymentId},
      ${event.plan}, ${event.amountPaise}, ${event.currency}, 'paid', ${event.eventId}
    )
    on conflict (order_id) do update set
      status = 'paid',
      payment_id = excluded.payment_id,
      plan = excluded.plan,
      amount_paise = excluded.amount_paise,
      event_id = excluded.event_id,
      updated_at = now()`;

  // The order notes carry the user who checked out, but an old order, or one
  // created by a teammate, may not — the plan and its verification bridge both
  // need a real author, so fall back to the workspace owner.
  const userId = event.userId || (await orgOwnerId(event.orgId));
  const { setProductPlan } = await import("./plans.server.ts");
  await setProductPlan({ orgId: event.orgId, userId, plan: event.plan as ProductPlan });
}

async function orgOwnerId(orgId: string): Promise<string> {
  const sql = await getSql();
  const [row] = await sql<{ user_id: string }>`
    select user_id from organization_members
    where org_id = ${orgId} and role = 'owner' and status = 'active'
    order by joined_at nulls last, created_at limit 1`;
  return row?.user_id ?? "";
}

export type CheckoutOrder = {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  plan: ProductPlan;
};

/**
 * Ask Razorpay for an order this workspace can pay for.
 *
 * The amount comes from the plan table, never from the caller: a checkout that
 * accepted `amount` from the browser would sell Vetta Ops for ₹1.
 */
export async function createOrderForPlan(opts: {
  orgId: string;
  userId: string;
  plan: ProductPlan;
}): Promise<CheckoutOrder> {
  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured yet — reply to the demo email and we will set your plan up by hand.");
  }
  const amount = checkoutAmountPaise(opts.plan);
  if (!amount) throw new Error("That plan is not self-serve — it is quoted, not checked out.");

  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `vetta_${opts.plan}_${Date.now()}`,
      notes: { org_id: opts.orgId, user_id: opts.userId, plan: opts.plan },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Could not start checkout (${res.status}): ${body.slice(0, 200)}`);
  }
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  return {
    keyId,
    orderId: order.id,
    amountPaise: order.amount ?? amount,
    currency: order.currency ?? "INR",
    plan: opts.plan,
  };
}

/**
 * Whether a hire at this workspace is the kind that owes a success fee.
 *
 * The pay-on-hire option on /pricing is the *alternative* to a subscription,
 * not a surcharge on one: a founder who waived the monthly fee owes the flat
 * fee when someone joins, and a founder already paying ₹6,999 or ₹16,999 a
 * month has bought the hire with it. An absent plan row is the free tier, which
 * is the waived arrangement — so it bills.
 */
export async function billableAsSuccessFee(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const sql = await getSql();
  const [row] = await sql<{ plan: string | null }>`
    select plan from org_plans where org_id = ${orgId} limit 1`;
  return !row?.plan || row.plan === "free";
}

/**
 * Record that a hire is billable, once per application.
 *
 * Drafted here, invoiced by hand: the claw-back promise on /pricing is a
 * conversation with a human for now, and a fee that auto-charges before that
 * conversation exists is a refund nobody can process.
 */
export async function draftSuccessFee(opts: {
  orgId: string;
  roleId: string;
  applicationId: string;
  candidateId: string;
  amountPaise: number;
}): Promise<{ drafted: boolean; reason: string }> {
  if (!opts.orgId || !opts.applicationId) {
    return { drafted: false, reason: "No workspace or application to bill." };
  }
  const sql = await getSql();
  const inserted = await sql<{ id: string }>`
    insert into hire_success_fees (
      id, org_id, role_id, application_id, candidate_id, amount_paise
    )
    values (${newId()}, ${opts.orgId}, ${opts.roleId}, ${opts.applicationId}, ${opts.candidateId},
      ${opts.amountPaise})
    on conflict (application_id) do nothing
    returning id`;
  if (inserted[0]) return { drafted: true, reason: "" };
  return { drafted: false, reason: "Already drafted: this hire was recorded once." };
}

export type SuccessFeeRow = {
  id: string;
  applicationId: string;
  roleId: string;
  amountPaise: number;
  status: string;
  createdAt: string;
};

export async function listSuccessFees(orgId: string): Promise<SuccessFeeRow[]> {
  if (!orgId) return [];
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`
    select id, application_id, role_id, amount_paise, status, created_at
    from hire_success_fees where org_id = ${orgId} order by created_at desc limit 200`;
  return rows.map((r) => ({
    id: String(r.id),
    applicationId: String(r.application_id),
    roleId: String(r.role_id ?? ""),
    amountPaise: Number(r.amount_paise),
    status: String(r.status),
    createdAt: String(r.created_at),
  }));
}
