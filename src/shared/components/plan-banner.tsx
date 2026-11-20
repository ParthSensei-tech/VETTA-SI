import { Link } from "@tanstack/react-router";
import { useEntitlementQuery } from "@/features/billing/api/query";

/**
 * The plan line in the workspace header.
 *
 * It only appears when there is something to say — a free workspace with a
 * screen allowance worth watching, or a gate already hit. A paid workspace
 * with headroom is not shown its meter: the number exists to prevent a
 * surprise, not to advertise a limit nobody is near.
 */
export function PlanBanner() {
  const { data } = useEntitlementQuery();
  if (!data) return null;
  const { entitlement } = data;
  const { tier } = entitlement;

  const nearCap =
    tier.plan === "free" &&
    entitlement.screeningsLeft !== null &&
    entitlement.screeningsLeft <= 5;
  const blocked = !entitlement.canCreateRole || !entitlement.canScreen;
  if (!nearCap && !blocked) return null;

  return (
    <div className="border-b border-border bg-[var(--glass-fill)] px-4 py-2 text-xs backdrop-blur-[var(--glass-blur)] md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={blocked ? "text-amber-400" : "text-muted"}>{entitlement.reason}</p>
        <Link
          to="/pricing"
          className="shrink-0 rounded-full soft-lime px-3 py-1 font-medium text-primary-foreground"
        >
          See plans
        </Link>
      </div>
    </div>
  );
}
