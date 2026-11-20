import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import {
  SUCCESS_FEE_PAISE,
  checkoutAmountPaise,
  isPurchasablePlan,
  parsePurchaseEvent,
  verifyWebhookSignature,
} from "./razorpay.ts";

const SECRET = "whsec_test_secret";

function signedBody(notes: Record<string, unknown>, amount = 699_900): string {
  return JSON.stringify({
    id: `event_${randomUUID()}`,
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount, currency: "INR", notes } } },
  });
}

test("only the two self-serve plans have a checkout price", () => {
  assert.equal(checkoutAmountPaise("starter"), 699_900);
  assert.equal(checkoutAmountPaise("growth"), 1_699_900);
  assert.equal(checkoutAmountPaise("free"), null);
  assert.equal(checkoutAmountPaise("portfolio"), null);
  assert.equal(isPurchasablePlan("portfolio"), false);
  assert.equal(isPurchasablePlan("starter"), true);
});

test("the signature is checked over the raw bytes, not a re-serialised body", () => {
  const body = signedBody({ org_id: "org-1", plan: "starter" });
  const signature = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
  assert.equal(verifyWebhookSignature({ rawBody: body, signature, secret: SECRET }), true);

  // The same object, re-serialised with one extra space, is a different body.
  const reformatted = body.replace('{"id"', '{ "id"');
  assert.equal(verifyWebhookSignature({ rawBody: reformatted, signature, secret: SECRET }), false);
});

test("a truncated or absent signature is false, never an exception", () => {
  const body = signedBody({ org_id: "org-1", plan: "starter" });
  const signature = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: signature.slice(0, 16), secret: SECRET }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: "not-hex-at-all", secret: SECRET }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signature: "", secret: SECRET }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, signature, secret: "" }), false);
});

test("a captured payment with our order notes becomes a purchase", () => {
  const parsed = parsePurchaseEvent(
    JSON.parse(signedBody({ org_id: "org-1", user_id: "user-1", plan: "growth" })),
  );
  assert.ok(parsed);
  assert.equal(parsed.plan, "growth");
  assert.equal(parsed.orgId, "org-1");
  assert.equal(parsed.amountPaise, 699_900);
  assert.equal(parsed.orderId, "order_1");
});

test("anything that is not a captured payment of a purchasable plan applies nothing", () => {
  const good = { org_id: "org-1", plan: "starter" };
  assert.equal(parsePurchaseEvent(JSON.parse(signedBody(good)).payload), null);
  assert.equal(
    parsePurchaseEvent({ id: "event_x", event: "payment.failed", payload: {} }),
    null,
  );
  // No event id: we cannot prove we have not seen it before, so we do not act.
  const noId = JSON.parse(signedBody(good));
  delete noId.id;
  assert.equal(parsePurchaseEvent(noId), null);
  const quotedPlan = JSON.parse(signedBody({ org_id: "org-1", plan: "portfolio" }));
  assert.equal(parsePurchaseEvent(quotedPlan), null);
  const noOrg = JSON.parse(signedBody({ plan: "starter" }));
  assert.equal(parsePurchaseEvent(noOrg), null);
  const floatAmount = JSON.parse(signedBody(good, 699900.5));
  assert.equal(parsePurchaseEvent(floatAmount), null);
});

test("the success fee is the number the pricing page says it is", () => {
  assert.equal(SUCCESS_FEE_PAISE, 4_999_900);
});
