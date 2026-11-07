import { useState, type ReactNode } from "react";
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
import { CITIES, ROLE_TEMPLATES, STAGE_LABEL } from "@/features/recruiting/domain/constants";
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
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);

  function applyTemplate(id: string) {
    const t = ROLE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setActiveTemplate(id);
    setValue((prev) => ({
      ...prev,
      title: t.title,
      companyStage: t.companyStage,
      location: t.location,
      workMode: t.workMode,
      compensationBand: t.compensationBand,
      stack: t.stack,
      mustHaves: t.mustHaves,
      niceToHaves: t.niceToHaves,
      jdText: t.jdText,
    }));
    setStackText(t.stack.join(", "));
    setMustText(t.mustHaves.join("\n"));
    setNiceText(t.niceToHaves.join("\n"));
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...value,
          stack: splitList(stackText),
          mustHaves: splitList(mustText),
          niceToHaves: splitList(niceText),
        });
      }}
    >
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted">Start from a role shape</p>
        <div className="flex flex-wrap gap-2">
          {ROLE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplate(t.id)}
              className={cn(
                "h-9 rounded-full border px-3 text-xs transition-colors duration-150",
                activeTemplate === t.id
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company">
          <Input
            required
            value={value.companyName}
            onChange={(e) => setValue((v) => ({ ...v, companyName: e.target.value }))}
            placeholder="Company name"
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
          />
        </Field>
        <Field label="Location">
          <Select
            value={value.location}
            onValueChange={(v) => setValue((s) => ({ ...s, location: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="City" />
            </SelectTrigger>
            <SelectContent>
              {CITIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
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
        <Field label="Compensation band">
          <Input
            value={value.compensationBand}
            onChange={(e) => setValue((v) => ({ ...v, compensationBand: e.target.value }))}
            placeholder="₹35–55 LPA + ESOP"
          />
        </Field>
        <Field label="Stack" className="md:col-span-2">
          <Input
            value={stackText}
            onChange={(e) => setStackText(e.target.value)}
            placeholder="Go, PostgreSQL, Kafka"
          />
        </Field>
        <Field label="Must-haves" className="md:col-span-1">
          <Textarea
            value={mustText}
            onChange={(e) => setMustText(e.target.value)}
            placeholder="One per line"
            className="min-h-28"
          />
        </Field>
        <Field label="Nice-to-haves">
          <Textarea
            value={niceText}
            onChange={(e) => setNiceText(e.target.value)}
            placeholder="One per line"
            className="min-h-28"
          />
        </Field>
        <Field label="Job description" className="md:col-span-2">
          <Textarea
            required
            value={value.jdText}
            onChange={(e) => setValue((v) => ({ ...v, jdText: e.target.value }))}
            placeholder="Paste the JD. Be specific about ownership, not culture slogans."
            className="min-h-48"
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
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
