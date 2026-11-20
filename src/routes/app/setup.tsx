import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  completeSignupProfile,
  getSignupProfile,
  signupProfileQueryKey,
} from "@/features/marketing/api/signups";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { queryKeys } from "@/features/recruiting/api/query";

export const Route = createFileRoute("/app/setup")({ component: Setup });

const COMPANY_SIZES = ["1-10", "11-30", "31-80", "80+"] as const;
const FOUNDER_ROLES = ["Founder", "Engineering lead", "HR / People", "Other"] as const;

/**
 * The one time we ask who the workspace belongs to.
 *
 * It lives after the account exists, not on the sign-up form: an account that
 * has already answered is sent straight to the desk, so a returning user never
 * sees this page — including on every later login.
 */
function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: signupProfileQueryKey,
    queryFn: () => getSignupProfile(),
  });

  const [companyName, setCompanyName] = useState("");
  const [companySize, setCompanySize] = useState<(typeof COMPANY_SIZES)[number]>("1-10");
  const [founderRole, setFounderRole] = useState<string>(FOUNDER_ROLES[0]);
  const [prefilled, setPrefilled] = useState(false);
  // Set synchronously when the save lands: the cache write below marks the
  // profile complete, and without this the page's own "already answered" guard
  // would fire first and take the founder to the desk instead of their first role.
  const savedRef = useRef(false);

  useEffect(() => {
    if (!profile.data || prefilled) return;
    if (profile.data.orgName && profile.data.orgName !== "My workspace") {
      setCompanyName(profile.data.orgName);
    }
    setPrefilled(true);
  }, [profile.data, prefilled]);

  const save = useMutation({
    mutationFn: () =>
      completeSignupProfile({
        data: { companyName: companyName.trim(), companySize, founderRole },
      }),
    onSuccess: () => {
      savedRef.current = true;
      // Write the answer into the cache the /app layout reads *before* leaving,
      // otherwise the layout still sees the pre-save "incomplete" profile and
      // sends the founder straight back here.
      qc.setQueryData(signupProfileQueryKey, {
        complete: true,
        orgName: companyName.trim(),
        companySize,
        founderRole,
      });
      void navigate({ to: "/app/onboarding" });
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save your workspace"),
  });

  if (profile.isPending) {
    return (
      <div className="mx-auto max-w-xl">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-8 h-64 rounded-2xl" />
      </div>
    );
  }
  if (profile.data?.complete && !savedRef.current) {
    return <Navigate to="/app" />;
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-xs tracking-[0.18em] text-muted uppercase">First run · asked once</p>
      <h1 className="mt-1 font-display text-4xl tracking-tight">Who is this workspace for?</h1>
      <p className="mt-2 mb-8 max-w-lg text-sm text-muted">
        Vetta calibrates its rubrics and the Vetta Index by stage and function, so it needs to know
        whose desk this is. You won't be asked again.
      </p>

      <form
        className="flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-[var(--shadow-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <Label>Company name</Label>
          <Input
            required
            maxLength={120}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            autoComplete="organization"
            placeholder="Acme Technologies"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <Label>Team size</Label>
            <select
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value as (typeof COMPANY_SIZES)[number])}
              className="h-10 rounded-md border border-border bg-bg px-3 text-sm text-fg"
            >
              {COMPANY_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} people
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>You are</Label>
            <select
              value={founderRole}
              onChange={(e) => setFounderRole(e.target.value)}
              className="h-10 rounded-md border border-border bg-bg px-3 text-sm text-fg"
            >
              {FOUNDER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit" disabled={save.isPending || !companyName.trim()}>
          {save.isPending ? "Saving…" : "Continue to your first role"}
        </Button>
      </form>
    </div>
  );
}
