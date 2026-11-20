import { useState, type ReactNode } from "react";
import { Briefcase, Building2, Code2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { CITIES, STAGE_LABEL } from "@/features/recruiting/domain/constants";
import type { CompanyStage, EmploymentType, RoleInput, WorkMode } from "@/features/recruiting/domain/types";
import { cn } from "@/shared/utils";

const empty: RoleInput = {
  companyName: "",
  companyStage: "seed",
  title: "",
  location: "Bengaluru",
  workMode: "hybrid",
  employmentType: "full_time",
  compensationBand: "",
  stack: [],
  mustHaves: [],
  niceToHaves: [],
  jdText: "",
};

const LOCATION_HINTS = CITIES.filter((c) => c !== "Remote — anywhere");
// Keeps the whole JD inside the ranker's 8,000-char window (ai.server.ts MAX_JD_CHARS).
const MAX_JD_WORDS = 1300;
// Mirrors roleInputSchema in api.ts — the server rejects anything past these.
const MAX_STACK_ITEMS = 16;
const MAX_STACK_ITEM_CHARS = 60;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM_CHARS = 200;

function preview(item: string): string {
  return item.length > 48 ? `${item.slice(0, 48)}…` : item;
}

function listProblem(
  items: string[],
  maxItems: number,
  maxChars: number,
  label: string,
): string | null {
  if (items.length > maxItems) {
    return `That's ${items.length} ${label} — the limit is ${maxItems}.`;
  }
  const long = items.find((item) => item.length > maxChars);
  if (long) {
    return `Keep each ${label.replace(/s$/, "")} under ${maxChars} characters — “${preview(long)}” is ${long.length}.`;
  }
  return null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function clampWords(text: string, max: number): string {
  let seen = 0;
  const word = /\S+/g;
  for (let m = word.exec(text); m; m = word.exec(text)) {
    seen += 1;
    if (seen === max) return text.slice(0, m.index + m[0].length);
  }
  return text;
}

function applyJdText(prev: string, next: string, inputType: string): string {
  if (next.length <= prev.length) return next;
  // A paste that overshoots gets trimmed; once the limit is hit every growth gesture is
  // refused whole, so neither new words nor trailing characters can slip in.
  if (inputType === "insertFromPaste" || inputType === "insertFromDrop") {
    return countWords(next) <= MAX_JD_WORDS ? next : clampWords(next, MAX_JD_WORDS);
  }
  if (countWords(prev) >= MAX_JD_WORDS) return prev;
  return countWords(next) <= MAX_JD_WORDS ? next : prev;
}

function splitList(value: string): string[] {
  return value
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function RoleForm({
  initial,
  submitLabel,
  onSubmit,
  pending,
}: {
  initial?: Partial<RoleInput>;
  submitLabel: string;
  onSubmit: (value: RoleInput) => void;
  pending?: boolean;
}) {
  const [value, setValue] = useState<RoleInput>({ ...empty, ...initial });
  const [stackText, setStackText] = useState((initial?.stack ?? []).join(", "));
  const [mustText, setMustText] = useState((initial?.mustHaves ?? []).join("\n"));
  const [niceText, setNiceText] = useState((initial?.niceToHaves ?? []).join("\n"));
  const jdWords = countWords(value.jdText);
  const jdWordsLeft = Math.max(0, MAX_JD_WORDS - jdWords);
  const stackProblem = listProblem(splitList(stackText), MAX_STACK_ITEMS, MAX_STACK_ITEM_CHARS, "stack items");
  const mustProblem = listProblem(splitList(mustText), MAX_LIST_ITEMS, MAX_LIST_ITEM_CHARS, "must-haves");
  const niceProblem = listProblem(splitList(niceText), MAX_LIST_ITEMS, MAX_LIST_ITEM_CHARS, "nice-to-haves");
  const invalid = Boolean(stackProblem || mustProblem || niceProblem);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        onSubmit({
          ...value,
          stack: splitList(stackText),
          mustHaves: splitList(mustText),
          niceToHaves: splitList(niceText),
        });
      }}
    >
      {/* Miller's Law Chunk 1: Role Overview */}
      <div className="rounded-2xl border border-border/70 bg-elevated/40 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2.5 border-b border-border/40 pb-3">
          <Building2 className="size-4 text-accent" />
          <h3 className="font-display text-sm font-semibold tracking-wide text-fg">Role Overview</h3>
          <span className="text-xs text-muted">· Title & company profile</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company">
            <Input
              required
              value={value.companyName}
              onChange={(e) => setValue((v) => ({ ...v, companyName: e.target.value }))}
              placeholder="Company name"
              maxLength={120}
            />
          </Field>
          <Field label="Stage">
            <Select
              value={value.companyStage}
              onValueChange={(v) => setValue((s) => ({ ...s, companyStage: v as CompanyStage }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["seed", "series_a", "series_b"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Role title" className="md:col-span-2">
            <Input
              required
              value={value.title}
              onChange={(e) => setValue((v) => ({ ...v, title: e.target.value }))}
              placeholder="Role title"
              maxLength={160}
            />
          </Field>
        </div>
      </div>

      {/* Miller's Law Chunk 2: Work Mode & Compensation */}
      <div className="rounded-2xl border border-border/70 bg-elevated/40 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2.5 border-b border-border/40 pb-3">
          <Briefcase className="size-4 text-accent" />
          <h3 className="font-display text-sm font-semibold tracking-wide text-fg">Work Mode & Terms</h3>
          <span className="text-xs text-muted">· Location, schedule & compensation</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="role-location">Location</Label>
            <Input
              id="role-location"
              value={value.location}
              onChange={(e) => setValue((s) => ({ ...s, location: e.target.value }))}
              placeholder="Any city or region — e.g. Bengaluru, Remote — India"
              maxLength={80}
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-1.5">
              {LOCATION_HINTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={value.location === c}
                  onClick={() => setValue((s) => ({ ...s, location: c }))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-150 cursor-pointer",
                    value.location === c
                      ? "border-accent bg-accent text-accent-fg font-medium"
                      : "border-border text-muted hover:text-fg hover:border-fg/30",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <Field label="Work mode">
            <Select
              value={value.workMode}
              onValueChange={(v) => setValue((s) => ({ ...s, workMode: v as WorkMode }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="onsite">On-site</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="remote">Remote</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Employment">
            <Select
              value={value.employmentType}
              onValueChange={(v) => setValue((s) => ({ ...s, employmentType: v as EmploymentType }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full-time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Compensation band" className="md:col-span-2">
            <Input
              value={value.compensationBand}
              onChange={(e) => setValue((v) => ({ ...v, compensationBand: e.target.value }))}
              placeholder="₹35–55 LPA + ESOP"
              maxLength={120}
            />
          </Field>
        </div>
      </div>

      {/* Miller's Law Chunk 3: Technical Requirements & JD */}
      <div className="rounded-2xl border border-border/70 bg-elevated/40 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2.5 border-b border-border/40 pb-3">
          <Code2 className="size-4 text-accent" />
          <h3 className="font-display text-sm font-semibold tracking-wide text-fg">Technical Core & Requirements</h3>
          <span className="text-xs text-muted">· Evaluated by autonomous ranking engine</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Stack" className="md:col-span-2">
            <Input
              value={stackText}
              onChange={(e) => setStackText(e.target.value)}
              placeholder="Go, PostgreSQL, Kafka"
            />
            {stackProblem ? <p className="text-xs text-amber-400">{stackProblem}</p> : null}
          </Field>
          <Field label="Must-haves" className="md:col-span-1">
            <Textarea
              value={mustText}
              onChange={(e) => setMustText(e.target.value)}
              placeholder="One per line"
              className="min-h-28"
            />
            {mustProblem ? <p className="text-xs text-amber-400">{mustProblem}</p> : null}
          </Field>
          <Field label="Nice-to-haves" className="md:col-span-1">
            <Textarea
              value={niceText}
              onChange={(e) => setNiceText(e.target.value)}
              placeholder="One per line"
              className="min-h-28"
            />
            {niceProblem ? <p className="text-xs text-amber-400">{niceProblem}</p> : null}
          </Field>
          <Field label="Job description" className="md:col-span-2">
            <Textarea
              required
              value={value.jdText}
              onChange={(e) => {
                const { inputType } = e.nativeEvent as InputEvent;
                setValue((v) => ({
                  ...v,
                  jdText: applyJdText(v.jdText, e.target.value, inputType),
                }));
              }}
              placeholder="Paste the JD. Be specific about ownership, not culture slogans."
              className="min-h-48"
            />
            <p
              className={cn(
                "text-xs tabular-nums",
                jdWordsLeft <= 100 ? "text-amber-400" : "text-subtle",
              )}
            >
              {jdWordsLeft.toLocaleString()} {jdWordsLeft === 1 ? "word" : "words"} left
              {jdWordsLeft === 0 ? " — limit reached" : ""}
            </p>
          </Field>
        </div>
      </div>

      {/* Hick's Law & Fitts's Law: Dominant Primary CTA */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-border/50">
        <p className="text-xs text-muted">
          All criteria are compiled into candidate ranking rubrics automatically upon saving.
        </p>
        <Button
          type="submit"
          size="lg"
          className="w-full sm:w-auto min-w-[200px]"
          disabled={pending || invalid}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}
