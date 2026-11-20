import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleForm } from "@/features/recruiting/ui/role-form";
import { createRole } from "@/features/recruiting/api/api";
import { errorMessage, queryKeys } from "@/features/recruiting/api/query";
import { markRoleCreated } from "@/features/marketing/api/signups";
import type { RoleInput } from "@/features/recruiting/domain/types";

export const Route = createFileRoute("/app/onboarding")({ component: Onboarding });

/**
 * The activation step, not a settings page.
 *
 * One action — paste the open role — and the workspace's first ranked slate is
 * minutes away. The full form is deliberately the same `RoleForm` the desk
 * uses, so nothing here is a demo copy of the real thing.
 */
function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (input: RoleInput) => {
      const role = await createRole({ data: input });
      await markRoleCreated({ data: { roleId: role.id } });
      return role;
    },
    onSuccess: (role) => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success("Role opened — drop resumes and Vetta starts ranking");
      void navigate({ to: "/app/roles/$roleId", params: { roleId: role.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs tracking-[0.18em] text-muted uppercase">Step 1 of 1</p>
      <h1 className="mt-1 font-display text-4xl tracking-tight">
        Paste the role you can't fill.
      </h1>
      <p className="mt-2 mb-8 max-w-xl text-sm text-muted">
        Vetta turns it into a ranked shortlist with a cited reason behind every verdict — the first
        30 screens a month are free, no card. When you're ready, drop resumes on the next screen.
      </p>
      <RoleForm submitLabel="Open my first role" pending={mut.isPending} onSubmit={(v) => mut.mutate(v)} />
    </div>
  );
}
