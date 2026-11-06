import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useRef, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  HelpCircle,
  MapPin,
  Send,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  getPublicPortal,
  submitAutonomousApplication,
  submitIntakeResponses,
  type PublicPortalRole,
} from "@/lib/recruiting/autonomous-portal-api";
import { extractResumeText } from "@/lib/recruiting/resume-file";

export const Route = createFileRoute("/portal/$slug")({ component: PublicCareerPortal });

function PublicCareerPortal() {
  const { slug } = Route.useParams();
  const [selectedRole, setSelectedRole] = useState<PublicPortalRole | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const portalQuery = useQuery({
    queryKey: ["public-portal", slug],
    queryFn: () => getPublicPortal({ data: { slug } }),
  });

  if (portalQuery.isPending) {
    return (
      <div className="mx-auto max-w-4xl p-6 md:p-12">
        <Skeleton className="h-40 rounded-3xl" />
        <div className="mt-8 flex flex-col gap-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (portalQuery.isError || !portalQuery.data) {
    return (
      <div className="mx-auto max-w-lg p-12 text-center">
        <h1 className="font-display text-2xl font-bold">Portal Not Found</h1>
        <p className="mt-2 text-sm text-muted">
          The requested career portal slug "{slug}" does not exist or is inactive.
        </p>
      </div>
    );
  }

  const { portal, roles } = portalQuery.data;

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Branded Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
              {portal.portalName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-display text-lg font-bold">{portal.portalName}</p>
              <p className="text-xs text-muted">Autonomous Careers</p>
            </div>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {roles.length} Open Positions
          </span>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-5xl px-6 py-12 md:py-16">
        <div className="flex flex-col gap-3">
          <span className="flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" />
            Evidence-Grounded Ingestion Engine
          </span>
          <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            {portal.headline || "Join Our Team & Build the Future"}
          </h1>
          <p className="max-w-2xl text-base text-muted">
            {portal.description ||
              "Experience our modern career portal backed by agentic multi-stage retrieval with human review at every stage."}
          </p>
        </div>
      </section>

      {/* Role Listings */}
      <main className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-6 font-display text-2xl font-bold">Open Positions</h2>

        {roles.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-12 text-center text-sm text-muted">
            No open roles listed at this time. Check back soon!
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-6 shadow-sm transition hover:border-primary/50 md:flex-row md:items-center"
              >
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-xl font-bold text-fg">{role.title}</h3>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" />
                      {role.location} ({role.workMode})
                    </span>
                    <span className="flex items-center gap-1">
                      <Coins className="size-3.5" />
                      {role.compensationBand}
                    </span>
                  </div>
                  {role.stack.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {role.stack.slice(0, 6).map((tech, i) => (
                        <span
                          key={i}
                          className="rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted"
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => {
                    setSelectedRole(role);
                    setApplyOpen(true);
                  }}
                  className="gap-2 shrink-0"
                >
                  Apply Now
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Application & Dynamic Intake Dialog */}
      {selectedRole && (
        <AutonomousApplicationModal
          portal={portal}
          role={selectedRole}
          open={applyOpen}
          onClose={() => {
            setApplyOpen(false);
            setSelectedRole(null);
          }}
        />
      )}
    </div>
  );
}

function AutonomousApplicationModal({
  portal,
  role,
  open,
  onClose,
}: {
  portal: any;
  role: PublicPortalRole;
  open: boolean;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [readingFile, setReadingFile] = useState(false);

  // Dynamic Intake State
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeToken, setIntakeToken] = useState("");
  const [intakeProbes, setIntakeProbes] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const applyMut = useMutation({
    mutationFn: () =>
      submitAutonomousApplication({
        data: {
          slug: portal.slug,
          roleId: role.id,
          fullName,
          email,
          phone,
          location,
          linkedinUrl,
          resumeText,
          coverNote,
        },
      }),
    onSuccess: (res) => {
      if (res.intakeRequired && res.probes && res.probes.length > 0 && res.intakeToken) {
        // Open dynamic interactive intake dialog
        setIntakeToken(res.intakeToken);
        setIntakeProbes(res.probes);
        setIntakeOpen(true);
      } else {
        setSubmitted(true);
        toast.success("Application submitted successfully!");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Submission failed"),
  });

  const intakeMut = useMutation({
    mutationFn: () =>
      submitIntakeResponses({
        data: {
          intakeToken,
          responses: intakeProbes.map((p) => ({
            id: p.id,
            prompt: p.prompt,
            answer: answers[p.id] || "No response provided",
          })),
        },
      }),
    onSuccess: () => {
      setIntakeOpen(false);
      setSubmitted(true);
      toast.success("Additional details received! The hiring team has been notified.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Intake submission failed"),
  });

  async function onFilePicked(file: File | null) {
    if (!file) return;
    setReadingFile(true);
    try {
      const extracted = await extractResumeText(file);
      setResumeText(extracted);
      toast.success("Resume text extracted from file");
    } catch {
      toast.error("Could not parse file. You can paste your resume text below.");
    } finally {
      setReadingFile(false);
    }
  }

  function handleApplicationSubmit(e: FormEvent) {
    e.preventDefault();
    if (resumeText.trim().length < 40) {
      toast.error("Please upload or paste your resume text.");
      return;
    }
    applyMut.mutate();
  }

  return (
    <>
      <Dialog open={open && !intakeOpen && !submitted} onOpenChange={onClose}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Apply for {role.title}</DialogTitle>
            <DialogDescription>
              Submit your resume. Our autonomous ingestion engine instantly extracts experience
              vectors with human review.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleApplicationSubmit} className="flex flex-col gap-4 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Full Name *</Label>
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Phone Number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Current Location (City)</Label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>LinkedIn Profile URL</Label>
              <Input
                placeholder="https://linkedin.com/in/username"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
              />
            </div>

            {/* Resume Upload / Text Area */}
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-elevated/40 p-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Resume / CV (PDF, DOCX, or Plain Text) *
                </Label>
                <input
                  type="file"
                  ref={fileRef}
                  className="hidden"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => onFilePicked(e.target.files?.[0] || null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={readingFile}
                  onClick={() => fileRef.current?.click()}
                  className="h-7 text-xs"
                >
                  <Upload className="size-3" />
                  {readingFile ? "Extracting..." : "Upload File"}
                </Button>
              </div>

              <Textarea
                rows={5}
                required
                placeholder="Or paste resume text here..."
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Cover Note / Extra Context (Optional)</Label>
              <Input
                placeholder="Brief note to the hiring team..."
                value={coverNote}
                onChange={(e) => setCoverNote(e.target.value)}
              />
            </div>

            <Button type="submit" disabled={applyMut.isPending} className="mt-2 w-full gap-2">
              <Send className="size-4" />
              {applyMut.isPending ? "Analyzing & Submitting..." : "Submit Application"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dynamic Interactive Intake Dialog for Missing Info */}
      <Dialog open={intakeOpen} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
                <HelpCircle className="size-4" />
              </span>
              <DialogTitle>Quick Clarification Questions</DialogTitle>
            </div>
            <DialogDescription>
              Our multi-stage match engine analyzed your CV and noticed a few unstated details.
              Answering these ensures accurate human review.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-3">
            {intakeProbes.map((probe, i) => (
              <div
                key={probe.id}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-3.5"
              >
                <Label className="text-xs font-semibold text-fg">
                  {i + 1}. {probe.prompt}
                </Label>
                <p className="text-[11px] text-muted">{probe.explanation}</p>
                <Input
                  required={probe.required}
                  placeholder="Your answer..."
                  value={answers[probe.id] || ""}
                  onChange={(e) => setAnswers({ ...answers, [probe.id]: e.target.value })}
                  className="mt-1 text-xs"
                />
              </div>
            ))}

            <Button
              onClick={() => intakeMut.mutate()}
              disabled={intakeMut.isPending}
              className="mt-2 w-full gap-2"
            >
              <CheckCircle2 className="size-4" />
              {intakeMut.isPending ? "Saving Responses..." : "Complete Application"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Submitted Confirmation Dialog */}
      <Dialog open={submitted} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
            <CheckCircle2 className="size-8" />
          </div>
          <DialogTitle className="mt-2 text-2xl font-bold">Application Received!</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted">
            Your application for <strong>{role.title}</strong> has been extracted, indexed, and
            routed into the hiring team's Human-in-the-Loop review queue.
          </DialogDescription>
          <Button onClick={onClose} className="mt-4 w-full">
            Close & Return to Jobs
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
