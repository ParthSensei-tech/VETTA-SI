import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CandidatePortalShell } from "@/shared/components/candidate-portal-shell";

export const Route = createFileRoute("/jobs")({ component: JobsLayout });

function JobsLayout() {
  return (
    <CandidatePortalShell>
      <Outlet />
    </CandidatePortalShell>
  );
}
