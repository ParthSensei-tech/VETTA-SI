/**
 * The money arithmetic and the signature check, as pure functions.
 *
 * Same doctrine as `plans.ts`: nothing that decides how much a workspace is
 * charged, or whether a delivery is genuine, lives in a file that also does IO.
 * `verifyWebhookSignature` is here rather than in the server module so the
 * timing-safe comparison — the one line in this feature that a subtle mistake
 * would make decorative — is covered by a test.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLAN_TIERS, type ProductPlan } from "./plans.ts";

/** The pay-on-hire fee, ₹49,999 in paise. Quoted on /pricing; one number, one place.
 *
 * Flat, not a percentage of CTC: the pricing page says ₹49,999 per hire, and a
 * fee that quietly scales with the salary would make that sentence untrue.
 */
export const SUCCESS_FEE_PAISE = 4_999_900;

export const RAZORPAY_CURRENCY = "INR";

/** The one event that buys a plan. Everything else is bookkeeping we do not act on. */
export const PURCHASE_EVENT = "payment.captured";

const PURCHASABLE: ProductPlan[] = ["starter", "growth"];

export function isPurchasablePlan(plan: unknown): plan is "starter" | "growth" {
  return typeof plan === "string" && (PURCHASABLE as string[]).includes(plan);
}

/** What an order for this plan costs, or null when the plan is not self-serve. */
export function checkoutAmountPaise(plan: ProductPlan): number | null {
  const price = PLAN_TIERS[plan]?.pricePaiseMonthly ?? null;
  return price && price > 0 ? price : null;
}

/**
 * HMAC-SHA256 over the raw request body, exactly as Razorpay signs it.
 *
 * Two rules that are easy to get wrong and impossible to see: the body must be
 * the bytes as received (a re-serialised JSON differs by one space and every
 * signature fails), and the comparison must not leak where it diverged.
 * `timingSafeEqual` throws on length mismatch, so the length is checked first —
 * a wrong-length signature is simply false, not a 500.
 */
export function verifyWebhookSignature(opts: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  if (!opts.secret || !opts.signature || !opts.rawBody) return false;
  const expected = createHmac("sha256", opts.secret).update(opts.rawBody, "utf8").digest("hex");
  const given = opts.signature.trim().toLowerCase();
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
  } catch {
    return false;
  }
}

export type PurchaseEvent = {
  eventId: string;
  eventType: string;
  paymentId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  orgId: string;
  userId: string;
  plan: ProductPlan;
};

/**
 * Read a webhook payload into the one decision the webhook is allowed to make.
 *
 * Returns null for anything that is not a captured payment carrying our own
 * order notes — a probe, a refund, a `payment.created`, or an event written by
 * somebody who guessed the URL. Returning null is not an error: the route says
 * 200 and applies nothing, because Razorpay retries anything else.
 */
export function parsePurchaseEvent(payload: unknown): PurchaseEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (p.event !== PURCHASE_EVENT) return null;
  const eventId = typeof p.id === "string" ? p.id : "";
  if (!eventId) return null;

  const envelope = p.payload as Record<string, unknown> | undefined;
  const payment = envelope?.payment as Record<string, unknown> | undefined;
  const entity = payment?.entity as Record<string, unknown> | undefined;
  if (!entity) return null;

  const orderId = typeof entity.order_id === "string" ? entity.order_id : "";
  const amount = Number(entity.amount);
  const notes = (entity.notes ?? {}) as Record<string, unknown>;
  const plan = notes.plan;
  const orgId = notes.org_id;
  if (!orderId || !Number.isInteger(amount) || amount <= 0 || !isPurchasablePlan(plan)) return null;
  if (typeof orgId !== "string" || !orgId) return null;

  return {
    eventId,
    eventType: PURCHASE_EVENT,
    paymentId: typeof entity.id === "string" ? entity.id : "",
    orderId,
    amountPaise: amount,
    currency: typeof entity.currency === "string" ? entity.currency : RAZORPAY_CURRENCY,
    orgId,
    userId: typeof notes.user_id === "string" ? notes.user_id : "",
    plan,
  };
}

