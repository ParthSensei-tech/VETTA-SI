import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createCheckoutOrder } from "@/features/billing/api/checkout-api";
import { useCurrentUserState } from "@/platform/auth/use-current-user";
import { PLAN_TIERS, type ProductPlan } from "@/features/billing/domain/plans";

type RazorpayOptions = Record<string, unknown> & {
  handler: (res: { razorpay_payment_id: string }) => void;
};
type RazorpayCheckout = { open: () => void; on: (event: string, cb: () => void) => void };

declare global {
  interface Window {
    Razorpay?: (options: RazorpayOptions) => RazorpayCheckout;
  }
}

let checkoutScript: Promise<void> | null = null;

/** Injected on first click, never at page load: the landing page must not pay for a script most visitors will not use. */
function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutScript = null;
      reject(new Error("Could not reach Razorpay."));
    };
    document.head.appendChild(script);
  });
  return checkoutScript;
}

const PRIMARY =
  "block rounded-full bg-mint px-5 py-2.5 text-center text-sm font-semibold text-l-bg disabled:opacity-60";
const SECONDARY =
  "block rounded-full border border-l-hairline px-5 py-2.5 text-center text-sm font-medium text-l-text transition-colors hover:border-mint/50 disabled:opacity-60";

/**
 * The buy button.
 *
 * Signed out it is a link to signup — the identity, not the card, is the ask.
 * Signed in it opens Razorpay's sheet for an order the *server* priced, and
 * says plainly that the plan arrives by webhook, not by this click. When
 * Razorpay is not configured the button degrades to the demo anchor rather than
 * a stack trace, because at launch the founder upgrading by hand is a feature,
 * not a failure.
 */
export function PlanCheckout({
  plan,
  label,
  variant = "primary",
}: {
  plan: Extract<ProductPlan, "starter" | "growth">;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const { user, isPending } = useCurrentUserState();
  const [note, setNote] = useState<string | null>(null);
  const className = variant === "primary" ? PRIMARY : SECONDARY;

  const mut = useMutation({
    mutationFn: async () => {
      const order = await createCheckoutOrder({ data: { plan } });
      await loadCheckoutScript();
      return order;
    },
    onSuccess: (order) => {
      if (!window.Razorpay) {
        setNote("Razorpay did not load — talk to us below and we will set it up by hand.");
        return;
      }
      const checkout = window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        order_id: order.orderId,
        name: "Vetta",
        description: `${PLAN_TIERS[order.plan].displayName} · monthly`,
        prefill: { name: user?.displayName ?? "", email: user?.primaryEmail ?? "" },
        theme: { color: "#07100f" },
        handler: () =>
          setNote("Paid. The plan switches the moment Razorpay confirms it to us — reload in a few seconds."),
      });
      checkout.on("payment.failed", () =>
        setNote("That payment did not go through. Nothing was charged to your workspace."),
      );
      checkout.open();
    },
    onError: (err) =>
      setNote(err instanceof Error ? err.message : "Checkout is unavailable right now."),
  });

  if (isPending || !user) {
    return (
      <Link to="/signup" className={className}>
        {label}
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className}
        disabled={mut.isPending}
        onClick={() => {
          setNote(null);
          mut.mutate();
        }}
      >
        {mut.isPending ? "Opening Razorpay…" : label}
      </button>
      {note ? (
        <p className="text-left text-[11px] leading-relaxed text-l-muted" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
