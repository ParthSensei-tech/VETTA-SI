import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RoleForm } from "@/features/recruiting/ui/role-form";
import { createRole } from "@/features/recruiting/api/api";
import { errorMessage, queryKeys } from "@/features/recruiting/api/query";
import type { RoleInput } from "@/features/recruiting/domain/types";

export const Route = createFileRoute("/app/roles/new")({ component: NewRole });

function NewRole() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (input: RoleInput) => createRole({ data: input }),
    onSuccess: (role) => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      toast.success("Role opened");
      void navigate({ to: "/app/roles/$roleId", params: { roleId: role.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-xs tracking-[0.18em] text-muted uppercase">New role</p>
      <h1 className="mt-1 font-display text-4xl tracking-tight">Write the seat, not the slogan</h1>
      <p className="mt-2 mb-8 max-w-xl text-sm text-muted">
        Ranking is only as good as this document. Name the work, the craft, and what “good” looks
        like at this stage.
      </p>
      <RoleForm submitLabel="Open role" pending={mut.isPending} onSubmit={(v) => mut.mutate(v)} />
    </div>
  );
}
