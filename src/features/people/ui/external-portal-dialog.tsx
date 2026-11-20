import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Globe,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Copy,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Webhook,
  Radio,
  Clock,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
  getRolePortalConfig,
  updateRolePortalConfig,
  triggerPortalFeedSync,
  getRolePortalLogs,
} from "../api/external-portal-api";
import { formatRelative, cn } from "@/shared/utils";
import type { PortalSyncMode } from "@/features/recruiting/domain/types";

export function ExternalPortalDialog({
  open,
  onOpenChange,
  roleId,
  roleTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: string;
  roleTitle: string;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  // Load role portal configuration
  const configQuery = useQuery({
    queryKey: ["role-external-portal-config", roleId],
    queryFn: () => getRolePortalConfig({ data: { roleId } }),
    enabled: open,
  });

  // Load sync logs
  const logsQuery = useQuery({
    queryKey: ["role-external-portal-logs", roleId],
    queryFn: () => getRolePortalLogs({ data: { roleId, limit: 5 } }),
    enabled: open,
  });

  const [isEnabled, setIsEnabled] = useState(false);
  const [portalJobUrl, setPortalJobUrl] = useState("");
  const [syncMode, setSyncMode] = useState<PortalSyncMode>("webhook_push");
  const [feedApiUrl, setFeedApiUrl] = useState("");
  const [feedAuthToken, setFeedAuthToken] = useState("");
  const [certified, setCertified] = useState(false);

  useEffect(() => {
    if (configQuery.data) {
      setIsEnabled(configQuery.data.isEnabled);
      setPortalJobUrl(configQuery.data.portalJobUrl);
      setSyncMode(configQuery.data.syncMode);
      setFeedApiUrl(configQuery.data.feedApiUrl);
      setFeedAuthToken(configQuery.data.feedAuthToken);
      setCertified(configQuery.data.isEnabled);
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (opts: { isEnabled: boolean }) =>
      updateRolePortalConfig({
        data: {
          roleId,
          isEnabled: opts.isEnabled,
          portalJobUrl,
          syncMode,
          feedApiUrl,
          feedAuthToken,
          autoShortlist: true,
        },
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["role-external-portal-config", roleId] });
      toast.success(
        data.isEnabled
          ? "Official Portal Ingestion enabled with verified authorization"
          : "Official Portal Ingestion paused",
      );
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update portal settings");
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerPortalFeedSync({ data: { roleId } }),
    onSuccess: (summary) => {
      qc.invalidateQueries({ queryKey: ["role-external-portal-config", roleId] });
      qc.invalidateQueries({ queryKey: ["role-external-portal-logs", roleId] });
      qc.invalidateQueries({ queryKey: ["role", roleId] });
      toast.success(
        `Synced ${summary.syncedCount} candidates. Shortlisted ${summary.shortlistedCount} into pipeline.`,
      );
    },
    onError: (err: any) => {
      toast.error(err.message || "Sync failed");
    },
  });

  const webhookUrl =
    typeof window !== "undefined" && configQuery.data
      ? `${window.location.origin}/api/portal/ingest-job?token=${configQuery.data.webhookToken}`
      : "";

  const handleCopy = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("Webhook Ingestion URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggle = (nextChecked: boolean) => {
    if (nextChecked && !certified) {
      toast.error("Please confirm your authorization certification before enabling");
      return;
    }
    setIsEnabled(nextChecked);
    saveMutation.mutate({ isEnabled: nextChecked });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <Sparkles className="size-3.5" />
              Premium Feature
            </span>
            <span className="text-xs text-muted">Zero-Intrusion Bridge</span>
          </div>
          <DialogTitle className="font-display text-2xl tracking-tight">
            Official Career Portal Direct Ingestion
          </DialogTitle>
          <DialogDescription className="text-sm text-muted">
            Directly ingest, parse, and shortlist candidate resumes submitted to your official company
            career page for <strong>{roleTitle}</strong>.
          </DialogDescription>
        </DialogHeader>

        {configQuery.isPending ? (
          <div className="flex flex-col gap-4 py-4">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : configQuery.isError ? (
          <p className="text-sm text-danger">Failed to load portal configuration.</p>
        ) : (
          <div className="flex flex-col gap-6 py-2">
            {/* 1. Primary Permission Toggle */}
            <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <Globe className="mt-0.5 size-5 shrink-0 text-amber-500" />
                <div>
                  <h3 className="text-sm font-semibold text-fg">
                    Enable Direct Ingestion for this Role
                  </h3>
                  <p className="text-xs text-muted">
                    Permits Vetta to receive and parse applicant resumes from your official website for
                    this job and automatically evaluate candidates against your rubric.
                  </p>
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={isEnabled}
                  onChange={(e) => handleToggle(e.target.checked)}
                  disabled={saveMutation.isPending}
                />
                <div className="peer h-6 w-11 rounded-full bg-border peer-checked:bg-amber-500 peer-focus:outline-none after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
              </label>
            </div>

            {/* 2. Official Career Portal Job Link */}
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium text-fg">
                Official Company Career Page URL (for this job)
              </Label>
              <Input
                placeholder="https://careers.acmecorp.com/jobs/cloud-architect"
                value={portalJobUrl}
                onChange={(e) => setPortalJobUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted">
                The exact URL where candidates apply on your official company website.
              </p>
            </div>

            {/* 3. Ingestion Mode Selector */}
            <div className="flex flex-col gap-3">
              <Label className="text-xs font-medium text-fg">Ingestion Mode</Label>
              <Tabs value={syncMode} onValueChange={(v) => setSyncMode(v as PortalSyncMode)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="webhook_push" className="gap-2 text-xs">
                    <Webhook className="size-3.5" />
                    Webhook Push Relay (Real-Time)
                  </TabsTrigger>
                  <TabsTrigger value="feed_pull" className="gap-2 text-xs">
                    <Radio className="size-3.5" />
                    Read-Only Feed Pull (Scheduled / API)
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {syncMode === "webhook_push" ? (
                <div className="flex flex-col gap-2.5 rounded-xl border border-border/80 bg-elevated/40 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-fg">Per-Job Ingestion Relay URL</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCopy}
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
                      {copied ? "Copied" : "Copy URL"}
                    </Button>
                  </div>
                  <code className="break-all rounded-lg bg-surface px-2.5 py-1.5 font-mono text-xs text-muted">
                    {webhookUrl}
                  </code>
                  <p className="text-[11px] text-muted">
                    Configure your website form backend or ATS webhook to POST candidate resumes
                    directly to this isolated endpoint.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-elevated/40 p-3.5">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Secure Feed / Export API URL</Label>
                    <Input
                      placeholder="https://api.acmecorp.com/careers/openings/123/applicants"
                      value={feedApiUrl}
                      onChange={(e) => setFeedApiUrl(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Bearer Token / Secret Key (Optional)</Label>
                    <Input
                      type="password"
                      placeholder="Optional bearer token for read-only access"
                      value={feedAuthToken}
                      onChange={(e) => setFeedAuthToken(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => syncMutation.mutate()}
                      disabled={syncMutation.isPending || !feedApiUrl}
                      className="gap-1.5"
                    >
                      <RefreshCw className={cn("size-3.5", syncMutation.isPending && "animate-spin")} />
                      {syncMutation.isPending ? "Syncing..." : "Sync & Fetch Now"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Recruiter Legal Certification & Permission */}
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface p-3 text-xs">
              <input
                type="checkbox"
                id="recruiter-certification"
                checked={certified}
                onChange={(e) => setCertified(e.target.checked)}
                className="mt-0.5 rounded border-border text-amber-500 focus:ring-amber-500"
              />
              <label htmlFor="recruiter-certification" className="cursor-pointer text-muted">
                <strong className="text-fg">Authorization Certification:</strong> I certify that I am
                authorized to permit Vetta to ingest applicant resumes for this opening from our company
                website/portal. Vetta operates strictly as a read-only parsing, matching, and shortlisting
                engine.
              </label>
            </div>

            {/* 5. Zero-Threat Security & Non-Intrusive Isolation Box */}
            <div className="rounded-2xl border border-success/30 bg-success/5 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-fg">
                <ShieldCheck className="size-4 text-success" />
                Zero-Intrusion & Threat-Free Isolation Guarantees
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                <li>
                  <strong>No Web Injections:</strong> We never run tracking pixels, scripts, or client code on
                  your official website.
                </li>
                <li>
                  <strong>No Credentials Held:</strong> No administrator passwords, SSH keys, or write
                  access to your web server are ever stored.
                </li>
                <li>
                  <strong>SSRF Defense & DPDP Compliant:</strong> Outbound requests strictly block internal
                  LANs and cloud metadata IPs, while privacy filters reject government ID scans before storage.
                </li>
              </ul>
            </div>

            {/* 6. Recent Sync History */}
            {logsQuery.data && logsQuery.data.length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-semibold text-fg">Recent Sync Runs</h4>
                <div className="divide-y divide-border rounded-xl border border-border bg-surface text-xs">
                  {logsQuery.data.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2">
                        {log.status === "success" ? (
                          <CheckCircle2 className="size-3.5 text-success" />
                        ) : (
                          <AlertCircle className="size-3.5 text-amber-500" />
                        )}
                        <span className="font-medium text-fg capitalize">{log.syncType} Sync</span>
                        <span className="text-muted">
                          ({log.resumesParsed} parsed, {log.candidatesShortlisted} shortlisted)
                        </span>
                      </div>
                      <span className="text-[11px] text-muted">
                        {formatRelative(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate({ isEnabled })}
            disabled={saveMutation.isPending || (isEnabled && !certified)}
          >
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
