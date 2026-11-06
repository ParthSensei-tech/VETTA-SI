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
import { copyText, downloadBase64, ensureAbsoluteUrl } from "@/lib/recruiting/links";
import { errorMessage, queryKeys } from "@/lib/recruiting/query";
import { exportRoleSlate } from "@/lib/recruiting/share";
import { redirectToLoginIfRequired } from "@/platform/app-data/login";

export function ExportSlateDialog({
  open,
  onOpenChange,
  roleId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roleId: string;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      exportRoleSlate({
        data: {
          roleId,
          recipientEmail: email,
          recipientName: name,
          message,
          sendEmail: sendEmail && Boolean(email),
        },
      }),
    onSuccess: async (res) => {
      void qc.invalidateQueries({ queryKey: queryKeys.shares(roleId) });
      setResultUrl(res.share.shareUrl);
      downloadBase64(
        res.xlsxFilename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        res.xlsxBase64,
      );
      downloadBase64(res.pdfFilename, "application/pdf", res.pdfBase64);
      await copyText(res.share.shareUrl);
      toast.success("Sheet, PDF, and a shareable page are ready");
      if (res.loginUrl)
        redirectToLoginIfRequired({
          ok: false,
          data: null,
          loginRequired: true,
          loginUrl: res.loginUrl,
        });
      if (res.emailed) toast.message("Emailed via Gmail");
      else if (res.emailError && email)
        toast.message("Link copied — Gmail not connected", { description: res.emailError });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export the slate</DialogTitle>
          <DialogDescription>
            One click builds a Google-Sheet workbook, a Notion-style page, and a PDF. Send produces
            a live link — not just a status change.
          </DialogDescription>
        </DialogHeader>
        {resultUrl ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Share this with the hiring manager:</p>
            <p className="break-all rounded-xl bg-elevated px-3 py-2 font-mono text-xs">
              {ensureAbsoluteUrl(resultUrl)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  const ok = await copyText(resultUrl);
                  toast.success(ok ? "Link copied" : ensureAbsoluteUrl(resultUrl));
                }}
              >
                Copy link
              </Button>
              <Button variant="secondary" asChild>
                <a href={ensureAbsoluteUrl(resultUrl)} target="_blank" rel="noreferrer">
                  Open page
                </a>
              </Button>
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
              <Label>Client name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hiring manager"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Client email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="founders@company.com"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Note on the page</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Why these three, what to probe, what we skipped."
                className="min-h-24"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="size-4 accent-accent"
              />
              Email the link if Gmail is connected
            </label>
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Building pack…" : "Export sheet + PDF + page"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
