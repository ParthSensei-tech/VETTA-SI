import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copyText, ensureAbsoluteUrl, mailtoUrl } from "@/lib/recruiting/links";
import { errorMessage, queryKeys } from "@/lib/recruiting/query";
import { sendPackToClient } from "@/lib/recruiting/share";
import { redirectToLoginIfRequired } from "@/lib/app-data/login";
import type { Approval } from "@/lib/recruiting/types";

export function SendToClientDialog({
  open,
  onOpenChange,
  approval,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  approval: Approval;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [includeSlate, setIncludeSlate] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(approval.shareUrl);

  const mut = useMutation({
    mutationFn: () =>
      sendPackToClient({
        data: {
          approvalId: approval.id,
          recipientEmail: email,
          recipientName: name,
          message,
          sendEmail: sendEmail && Boolean(email),
          includeSlate,
        },
      }),
    onSuccess: async (res) => {
      void qc.invalidateQueries({ queryKey: queryKeys.approvals });
      void qc.invalidateQueries({ queryKey: queryKeys.workspace });
      void qc.invalidateQueries({ queryKey: queryKeys.role(approval.roleId) });
      setShareUrl(res.share.shareUrl);
      await copyText(res.share.shareUrl);
      toast.success("Client page is live — link copied");
      if (res.loginUrl) {
        redirectToLoginIfRequired({ ok: false, data: null, loginRequired: true, loginUrl: res.loginUrl });
      }
      if (res.emailed) toast.message("Sent via Gmail");
      else if (email && !res.emailed) {
        toast.message("Link copied. Open Email to send from your mail app.");
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send to client</DialogTitle>
          <DialogDescription>
            This creates a shareable page with the client card{includeSlate ? " and the ranked slate" : ""}. Status
            changes only after the link exists.
          </DialogDescription>
        </DialogHeader>
        {shareUrl && !mut.isPending ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Live link</p>
            <p className="break-all rounded-xl bg-elevated px-3 py-2 font-mono text-xs">
              {ensureAbsoluteUrl(shareUrl)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  const ok = await copyText(shareUrl);
                  toast.success(ok ? "Copied" : ensureAbsoluteUrl(shareUrl));
                }}
              >
                Copy link
              </Button>
              <Button variant="secondary" asChild>
                <a href={ensureAbsoluteUrl(shareUrl)} target="_blank" rel="noreferrer">
                  Open
                </a>
              </Button>
              {email ? (
                <Button variant="secondary" asChild>
                  <a href={mailtoUrl(email, approval.title, ensureAbsoluteUrl(shareUrl))}>
                    Email
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              mut.mutate();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <Label>Hiring manager</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="founders@…" />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Cover note</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-24" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSlate}
                onChange={(e) => setIncludeSlate(e.target.checked)}
                className="size-4 accent-accent"
              />
              Attach the rest of the ranked slate
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="size-4 accent-accent"
              />
              Send email (Gmail if connected, else your mail app)
            </label>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Creating link…" : "Create link and send"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
