/**
 * Client reads for the verification feature.
 *
 * The keys are all derived from what the browser is already looking at — a role
 * for the slate, an application for one report, and nothing at all for the two
 * workspace-level reads, whose org comes from the session. The polling intervals
 * are the interesting part: a verdict is produced by a queue the page does not
 * own, so a chip that never refetches is a chip that shows nothing for the
 * candidates who arrived while the recruiter was reading the first ten.
 */
import { useQuery } from "@tanstack/react-query";
import {
  getDocumentStore,
  getSlateVerdicts,
  getVerificationQuota,
  getVerificationReport,
} from "./verification-api";

export const verificationQueryKeys = {
  slate: (roleId: string) => ["verification-slate", roleId] as const,
  report: (applicationId: string) => ["verification-report", applicationId] as const,
  store: ["verification-document-store"] as const,
  quota: ["verification-quota"] as const,
};

export function useSlateVerdictsQuery(roleId: string) {
  return useQuery({
    queryKey: verificationQueryKeys.slate(roleId),
    queryFn: () => getSlateVerdicts({ data: { roleId } }),
    enabled: Boolean(roleId),
    // The batch progress above this table already polls at 1.5 s while a rank is
    // running; the chips only have to keep up with it, and one read of two cached
    // columns for the whole slate is cheap enough to ask for every few seconds.
    refetchInterval: 8_000,
  });
}

export function useVerificationReportQuery(applicationId: string | null) {
  return useQuery({
    queryKey: verificationQueryKeys.report(applicationId ?? ""),
    queryFn: () => getVerificationReport({ data: { applicationId: applicationId ?? "" } }),
    enabled: Boolean(applicationId),
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === "queued" || status === "running" ? 2_000 : false;
    },
  });
}

/**
 * The workspace's file-shelf.
 *
 * No key argument, because there is nothing for the browser to name: the org is
 * derived from the session server-side, so a stale or hand-edited query key
 * cannot ask about another tenant's counts. It does not poll — a retention
 * posture changes when a person changes it, and the mutation invalidates this.
 */
export function useDocumentStoreQuery() {
  return useQuery({
    queryKey: verificationQueryKeys.store,
    queryFn: () => getDocumentStore(),
  });
}

/**
 * The workspace's plan and the meter under it.
 *
 * Unlike the store, this one does poll: the number moves while nobody is on the
 * page, because a use is spent by the verification worker finishing a report. A
 * strip that only refetched on a click would tell a recruiter they had four free
 * checks for the whole of a slate that was quietly spending them. Slow interval,
 * though — this is a caption, not a scoreboard.
 */
export function useVerificationQuotaQuery() {
  return useQuery({
    queryKey: verificationQueryKeys.quota,
    queryFn: () => getVerificationQuota(),
    refetchInterval: 15_000,
  });
}
