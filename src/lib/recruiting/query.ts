import { useQuery } from "@tanstack/react-query";
import { getRoleWorkspace, getWorkspace, listApprovals } from "./api";
import { searchTalent } from "./search-api";
import { listIngestBatches } from "./batch";
import { getPortalApplication, getPublicJob, listOpenJobs } from "./portal";
import { getPublicShare } from "./share";
import { getScreenByApplication, getScreenByToken } from "./screen-session";

export const queryKeys = {
  workspace: ["workspace"] as const,
  role: (id: string) => ["role", id] as const,
  approvals: ["approvals"] as const,
  talent: ["talent"] as const,
  jobs: ["public-jobs"] as const,
  job: (id: string) => ["public-job", id] as const,
  portalApplication: (id: string) => ["portal-application", id] as const,
  batches: (roleId: string) => ["ingest-batches", roleId] as const,
  allBatches: ["ingest-batches", "all"] as const,
  shares: (roleId: string) => ["shares", roleId] as const,
  publicShare: (token: string) => ["public-share", token] as const,
  screenToken: (token: string) => ["screen-token", token] as const,
  harness: ["harness"] as const,
};

export function useWorkspaceQuery() {
  return useQuery({
    queryKey: queryKeys.workspace,
    queryFn: () => getWorkspace(),
  });
}

export function useRoleQuery(roleId: string) {
  return useQuery({
    queryKey: queryKeys.role(roleId),
    queryFn: () => getRoleWorkspace({ data: { roleId } }),
    enabled: Boolean(roleId),
  });
}

export function useApprovalsQuery() {
  return useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => listApprovals({ data: {} }),
  });
}

export function useTalentQuery(filters: {
  q: string;
  location: string;
  noticeMaxDays: number | null;
  ctcMaxLakh: number | null;
}) {
  return useQuery({
    queryKey: ["talent", filters] as const,
    queryFn: () => searchTalent({ data: filters }),
  });
}

export function useOpenJobsQuery() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => listOpenJobs(),
  });
}

export function usePublicJobQuery(roleId: string) {
  return useQuery({
    queryKey: queryKeys.job(roleId),
    queryFn: () => getPublicJob({ data: { roleId } }),
    enabled: Boolean(roleId),
  });
}

export function usePortalApplicationQuery(applicationId: string) {
  return useQuery({
    queryKey: queryKeys.portalApplication(applicationId),
    queryFn: () => getScreenByApplication({ data: { applicationId } }).catch(() => getPortalApplication({ data: { applicationId } })),
    enabled: Boolean(applicationId),
    refetchInterval: (q) => {
      const stage = q.state.data?.stage;
      if (stage === "received") return 2000;
      return false;
    },
  });
}

export function useScreenTokenQuery(token: string) {
  return useQuery({
    queryKey: queryKeys.screenToken(token),
    queryFn: () => getScreenByToken({ data: { token } }),
    enabled: Boolean(token),
  });
}

export function usePublicShareQuery(token: string) {
  return useQuery({
    queryKey: queryKeys.publicShare(token),
    queryFn: () => getPublicShare({ data: { token } }),
    enabled: Boolean(token),
  });
}

export function useRoleBatchesQuery(roleId: string) {
  return useQuery({
    queryKey: queryKeys.batches(roleId),
    queryFn: () => listIngestBatches({ data: { roleId } }),
    enabled: Boolean(roleId),
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((b) => b.status === "queued" || b.status === "running") ? 1500 : 12_000;
    },
  });
}

export function useAllBatchesQuery() {
  return useQuery({
    queryKey: queryKeys.allBatches,
    queryFn: () => listIngestBatches({ data: {} }),
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((b) => b.status === "queued" || b.status === "running") ? 2000 : 15_000;
    },
  });
}

export function useHarnessQuery() {
  return useQuery({
    queryKey: queryKeys.harness,
    queryFn: async () => {
      const { getHarness } = await import("./harness/api");
      return getHarness();
    },
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong";
}
