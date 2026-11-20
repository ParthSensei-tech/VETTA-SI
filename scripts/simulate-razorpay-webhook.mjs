// @ts-check
/**
 * Deliver a synthetic Razorpay webhook to a running dev server.
 *
 * There is no Razorpay account pointing at localhost, so without this the
 * idempotency spine — the whole reason `razorpay_events` exists — is untestable
 * until launch. The script signs a `payment.captured` body with the same secret
 * the server reads, POSTs the bytes it signed (never a re-serialised copy —
 * that is the bug this file exists to be immune to), and prints the verdict.
 *
 *   node scripts/simulate-razorpay-webhook.mjs --org=<orgId>
 *   node scripts/simulate-razorpay-webhook.mjs --org=<orgId> --repeat=3
 *   node scripts/simulate-razorpay-webhook.mjs --org=<orgId> --tamper
 *
 * `--repeat` sends the *same* event id more than once; the run is only correct
 * if the first delivery applies and every later one says "already applied".
 * `--tamper` sends a valid signature over a body whose plan was changed after
 * signing, which must be refused with a 400 and write nothing.
 *
 * The default secret matches `PREVIEW_WEBHOOK_SECRET` in
 * `src/features/billing/server/razorpay.server.ts`. A real environment sets
 * `RAZORPAY_WEBHOOK_SECRET`, and this script reads it from the same place.
 */
import { createHmac, randomUUID } from "node:crypto";

const argv = process.argv.slice(2);

/** @param {string} name @param {string=} fallback */
function flag(name, fallback) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const has = (name) => argv.includes(`--${name}`);

const ORIGIN = flag("origin", "http://127.0.0.1:8080");
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || flag("secret", "vetta_preview_webhook_secret");
const PLAN = flag("plan", "starter");
const ORG = flag("org", "");
const REPEAT = Number(flag("repeat", "1"));
const EVENT_ID = flag("event-id", `evt_sim_${randomUUID()}`);
const ORDER_ID = flag("order-id", `order_sim_${randomUUID().slice(0, 8)}`);

const PRICES = { starter: 699_900, growth: 1_699_900 };

if (!ORG) {
  console.error(
    "Usage: node scripts/simulate-razorpay-webhook.mjs --org=<orgId> [--plan=starter|growth] [--repeat=N] [--tamper]\n" +
      "The org id must exist in the running dev database — it is the workspace the plan flips.",
  );
  process.exit(1);
}

const body = JSON.stringify({
  id: EVENT_ID,
  event: "payment.captured",
  payload: {
    payment: {
      entity: {
        id: `pay_${ORDER_ID.slice(-8)}`,
        order_id: ORDER_ID,
        amount: PRICES[/** @type {keyof typeof PRICES} */ (PLAN)] ?? 699_900,
        currency: "INR",
        status: "captured",
        notes: { org_id: ORG, plan: PLAN },
      },
    },
  },
});

const signature = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");

/** @param {{body: string, signature: string, label: string}} delivery */
async function deliver({ body: rawBody, signature: sig, label }) {
  const res = await fetch(`${ORIGIN}/api/razorpay/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": sig },
    body: rawBody,
  });
  const text = await res.text();
  console.log(`${label}: HTTP ${res.status} ${text}`);
  return res.status;
}

const tampered = has("tamper")
  ? { body, signature: "0".repeat(64) }
  : { body, signature };

for (let i = 0; i < Math.max(1, REPEAT); i++) {
  await deliver({ ...tampered, label: `delivery ${i + 1}${has("tamper") ? " (tampered)" : ""}` });
}
