import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { StageChip } from "@/shared/components/status-chip";
import { applyToJob } from "@/features/people/api/portal";
import { CITIES, EMPLOYMENT_LABEL, STAGE_LABEL, WORK_MODE_LABEL } from "@/lib/recruiting/constants";
import { errorMessage, usePublicJobQuery } from "@/lib/recruiting/query";
import { extractResumeText, resumeFileLabel } from "@/features/ingest/domain/resume-file";
import { cn } from "@/shared/utils";

export const Route = createFileRoute("/jobs/$roleId")({ component: JobApply });

const WORKFLOW = [
  "Parse resume",
  "Rank against this JD",
  "Draft written screen",
  "Hold for human review",
];

function JobApply() {
  const { roleId } = Route.useParams();
  const { data: job, isPending, error } = usePublicJobQuery(roleId);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [currentCompany, setCurrentCompany] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [noticePeriod, setNoticePeriod] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(0);
  const [consentToProcess, setConsentToProcess] = useState(false);

  const applyMut = useMutation({
    mutationFn: () =>
      applyToJob({
        data: {
          roleId,
          fullName,
          email,
          phone,
          location,
          linkedinUrl,
          currentTitle,
          currentCompany,
          yearsExperience,
          noticePeriod,
          expectedCtc,
          coverNote,
          resumeText,
          consentToProcess: true as const,
        },
      }),
    onSuccess: (app) => {
      toast.success("Application received. The desk is already ranking you.");
      void navigate({ to: "/apply/$applicationId", params: { applicationId: app.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function onFile(file: File | null) {
    if (!file) return;
    setReadingFile(true);
    setResumeFile(file);
    try {
      const text = await extractResumeText(file);
      setResumeText(text);
      toast.success("Resume text extracted");
    } catch (e) {
      setResumeFile(null);
      toast.error(errorMessage(e));
    } finally {
      setReadingFile(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (resumeText.trim().length < 40) {
      toast.error("Add a resume — upload a file or paste the text.");
      return;
    }
    if (!consentToProcess) {
      toast.error("Please consent to process your application data to continue.");
      return;
    }
    setWorkflowStep(0);
    const timer = window.setInterval(() => {
      setWorkflowStep((s) => Math.min(s + 1, WORKFLOW.length - 1));
    }, 1400);
    applyMut.mutate(undefined, {
      onSettled: () => window.clearInterval(timer),
    });
  }

  if (isPending) {
    return (
      <div className="grid gap-8 pt-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (error || !job) {
    return (
      <p className="pt-10 text-sm text-danger">
        This role is not open.{" "}
        <Link to="/jobs" className="underline">
          Browse other seats
        </Link>
      </p>
    );
  }

  return (
    <div className="grid gap-12 pt-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
      <article className="vetta-enter">
        <p className="text-xs text-muted">
          <Link to="/jobs" className="hover:text-fg">
            Open roles
          </Link>
          <span className="mx-2 text-subtle">/</span>
          {job.companyName}
        </p>
        <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3.4rem)] leading-[0.95] tracking-tight">
          {job.title}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <StageChip stage={job.companyStage} />
          <span>
            {job.location} · {WORK_MODE_LABEL[job.workMode]} ·{" "}
            {EMPLOYMENT_LABEL[job.employmentType]}
          </span>
        </div>
        {job.compensationBand ? (
          <p className="mt-3 text-sm text-fg/90">{job.compensationBand}</p>
        ) : null}

        {job.stack.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-1.5">
            {job.stack.map((s) => (
              <span key={s} className="rounded-full bg-elevated px-2.5 py-1 text-xs">
                {s}
              </span>
            ))}
          </div>
        ) : null}

        <section className="mt-8">
          <h2 className="font-display text-xl">The seat</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {job.jdText}
          </p>
        </section>

        {job.mustHaves.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Must-haves</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed">
              {job.mustHaves.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {job.niceToHaves.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
              Nice-to-haves
            </h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-muted">
              {job.niceToHaves.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-10 text-xs text-subtle">
          {STAGE_LABEL[job.companyStage]} · Applying starts parse, rank, and a written screen. A
          recruiter still stamps anything that leaves the building.
        </p>
      </article>

      <aside className="vetta-enter vetta-enter-delay-2 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] lg:sticky lg:top-8">
        <h2 className="font-display text-2xl tracking-tight">Apply</h2>
        <p className="mt-1 text-sm text-muted">Resume plus a few facts. One seat at a time.</p>

        {applyMut.isPending ? (
          <ol className="mt-6 flex flex-col gap-2">
            {WORKFLOW.map((label, i) => (
              <li
                key={label}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm",
                  i <= workflowStep ? "bg-elevated text-fg" : "text-subtle",
                )}
              >
                <span className="font-mono text-xs tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">{label}</span>
                {i === workflowStep ? <span className="text-xs text-muted">Working</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
            <Field label="Full name" required>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location">
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  list="vetta-cities"
                  placeholder="Bengaluru"
                />
                <datalist id="vetta-cities">
                  {CITIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="LinkedIn">
                <Input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/…"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Current title">
                <Input value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} />
              </Field>
              <Field label="Current company">
                <Input value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Years">
                <Input
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                  inputMode="decimal"
                  placeholder="6"
                />
              </Field>
              <Field label="Notice">
                <Input
                  value={noticePeriod}
                  onChange={(e) => setNoticePeriod(e.target.value)}
                  placeholder="30 days"
                />
              </Field>
              <Field label="Expected CTC">
                <Input
                  value={expectedCtc}
                  onChange={(e) => setExpectedCtc(e.target.value)}
                  placeholder="45 LPA"
                />
              </Field>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Resume</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,text/plain"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex min-h-20 flex-col items-start justify-center rounded-lg border border-dashed border-border bg-bg px-4 py-3 text-left transition-colors duration-150 hover:border-border-strong"
              >
                <span className="text-sm">
                  {readingFile
                    ? "Reading file…"
                    : resumeFile
                      ? "Replace file"
                      : "Upload PDF, Word, or text"}
                </span>
                <span className="mt-1 text-xs text-subtle">
                  {resumeFileLabel(resumeFile, resumeText.length)}
                </span>
              </button>
              <Textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Or paste the full resume text…"
                className="min-h-40 font-mono text-xs"
              />
            </div>

            <Field label="Note to the recruiter">
              <Textarea
                value={coverNote}
                onChange={(e) => setCoverNote(e.target.value)}
                placeholder="Why this seat, notice constraints, anything the resume hides."
                className="min-h-24"
              />
            </Field>

            <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                className="mt-1"
                checked={consentToProcess}
                onChange={(e) => setConsentToProcess(e.target.checked)}
              />
              <span>
                I consent to this company processing my personal data (resume, contact details,
                notice, and compensation signals) to evaluate me for this role, under applicable
                Indian data protection law. I can request withdrawal later via the employer.
              </span>
            </label>

            <Button type="submit" disabled={applyMut.isPending || readingFile || !consentToProcess}>
              Submit application
            </Button>
          </form>
        )}
      </aside>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required ? <span className="text-danger"> ·</span> : null}
      </Label>
      {children}
    </div>
  );
}
