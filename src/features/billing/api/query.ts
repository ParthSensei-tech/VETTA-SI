import { useQuery } from "@tanstack/react-query";
import { getEntitlement } from "./plans-api";

export const billingQueryKeys = {
  entitlement: ["entitlement"] as const,
};

export function useEntitlementQuery() {
  return useQuery({
    queryKey: billingQueryKeys.entitlement,
    queryFn: () => getEntitlement(),
  });
}
