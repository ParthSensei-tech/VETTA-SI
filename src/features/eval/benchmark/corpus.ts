/**
 * Benchmark corpus — scales the 8 human-labelled gold cases into realistic
 * multi-resume slates (25 … the 200-per-batch production cap).
 *
 * The trap this file exists to defuse: `persistRanked` deduplicates candidates by
 * email (queue.server.ts:198) and applications by `resume_hash` (:210). If mutated
 * resumes keep the gold email, or hash identically, a 200-resume slate collapses into
 * 8 real applications and every "per resume" number is actually a cache-hit number.
 * So each row gets a unique email, phone and body salt, and `verifyUniqueness`
 * asserts it both in-memory and in the database.
 */

import { GOLD_EVAL_CASES, type GoldCase } from "../harness/gold.ts";

export type BenchRole = {
  roleId: string;
  companyName: string;
  companyStage: string;
  title: string;
  location: string;
  workMode: string;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
};

export type BenchResume = {
  index: number;
  slug: string;
  filename: string;
  resumeText: string;
  roleId: string;
  /** Which corpus variant this is, for per-variant latency breakdown. */
  variant: "typical" | "huge_resume" | "off_family" | "long_jd";
};

const SKILL_VARIANTS = [
  "Kafka",
  "Terraform",
  "gRPC",
  "ClickHouse",
  "React Native",
  "Airflow",
  "Prometheus",
  "Envoy",
  "DynamoDB",
  "Stripe API",
  "HubSpot",
  "dbt",
];

const FIRST_NAMES = [
  "Aarav",
  "Diya",
  "Ishaan",
  "Meera",
  "Nikhil",
  "Pooja",
  "Rahul",
  "Sana",
  "Tanvi",
  "Vikram",
  "Yash",
  "Zoya",
  "Aditya",
  "Bhavana",
  "Chirag",
  "Divya",
];
const LAST_NAMES = [
  "Nair",
  "Sharma",
  "Iyer",
  "Gupta",
  "Menon",
  "Patel",
  "Reddy",
  "Bose",
  "Kulkarni",
  "Chauhan",
  "Verma",
  "Pillai",
  "Joshi",
  "Rao",
  "Kaur",
  "Das",
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?91[\s-]?\d{5}[\s-]?\d{5}|\b98\d{8}\b|\b\d{10}\b/;

/** A short, deterministic per-row token that guarantees a distinct resume_hash. */
function salt(i: number, slug: string): string {
  return `${slug}-${String(i).padStart(4, "0")}`;
}

function pad(i: number, n: number): string {
  return String(i).padStart(n, "0");
}

/**
 * Mutate a gold resume into a distinct-but-realistic candidate: unique contact
 * details, varied India-specific signals the engine extracts (notice, CTC, city),
 * and a body salt that makes `hashResumeText` differ.
 */
function materialize(
  g: GoldCase,
  i: number,
  roleId: string,
  variant: BenchResume["variant"],
): BenchResume {
  const s = salt(i, g.slug);
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_NAMES[(i >> 4) % LAST_NAMES.length];
  const email = `bench-${s}@bench.invalid`;
  const phone = `+91 98${pad(((i * 7919) % 1000000000) % 100000000, 8).slice(0, 3)} ${pad(i % 100000, 5)}`;
  const notice = [15, 30, 45, 60, 75, 90][i % 6];
  const current = 14 + (i % 21);
  const expected = current + 6 + (i % 9);
  const skill = SKILL_VARIANTS[i % SKILL_VARIANTS.length];
  const cities = ["Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai", "Gurugram"];
  const city = cities[i % cities.length];

  // Replace the real contact details, not just append — otherwise dedupe collapses.
  let text = g.resumeText;
  if (EMAIL_RE.test(text)) text = text.replace(new RegExp(EMAIL_RE.source, "g"), email);
  else text = `${text}\n${email}`;
  if (PHONE_RE.test(text)) text = text.replace(new RegExp(PHONE_RE.source, ""), phone);
  else text = `${text}\n${phone}`;
  // Line 1 is the name the extractor falls back to; keep it distinct.
  text = text.replace(/^.*?\n/, `${first} ${last}\n`);

  let body = `${text}

Benchmark record ${s}. Additional depth: ${skill}. Location: ${city}. Notice period ${notice} days. Current ${current} LPA, expected ${expected} LPA.`;

  if (variant === "huge_resume") {
    // Push to the ingest cap (batch.ts MAX_RESUME_CHARS = 40_000) to find the
    // worst-case regex/scan cost, not the average case.
    const filler =
      `Led migration of ${skill} workloads; cut p99 latency and cost across a 6-engineer pod. `.repeat(
        4,
      );
    const blocks: string[] = [];
    let size = body.length;
    for (let k = 0; size < 39_000; k++) {
      const chunk = `\nRole ${k}: ${filler}`;
      blocks.push(chunk);
      size += chunk.length;
    }
    body = body + blocks.join("");
  }

  if (variant === "off_family") {
    // Sales resume against the backend JD: exercises the structural-mismatch gate
    // (match-engine.ts resumeFamily/roleFamily branch) and its requirement walk.
    body = `${first} ${last}
${city}
Enterprise Sales Manager, ${g.companyName} — 2019–present
${email}
${phone}

Carried a ₹6 Cr annual quota closing SMB and mid-market accounts. Built an outbound motion from cold email and LinkedIn, ran discovery, and negotiated contracts. CRM hygiene in Salesforce. No engineering background, no production systems owned, no on-call.

Notice period ${notice} days. Current ${current} LPA, expected ${expected} LPA. Benchmark record ${s}.`;
  }

  return {
    index: i,
    slug: g.slug,
    filename: `${s}.pdf`,
    resumeText: body,
    roleId,
    variant,
  };
}

/** The two roles every slate is matched against. */
export function buildRoles(): BenchRole[] {
  const ae = GOLD_EVAL_CASES.find((c) => c.slug === "ae-quota-carrier") ?? GOLD_EVAL_CASES[0];
  const be = GOLD_EVAL_CASES.find((c) => c.slug === "be-founding-go") ?? GOLD_EVAL_CASES[1];
  return [
    {
      roleId: "bench_role_ae",
      companyName: ae.companyName,
      companyStage: ae.companyStage,
      title: ae.roleTitle,
      location: ae.location,
      workMode: ae.workMode,
      compensationBand: ae.compensationBand,
      stack: ae.stack,
      mustHaves: ae.mustHaves,
      niceToHaves: ae.niceToHaves,
      jdText: ae.jdText,
    },
    {
      roleId: "bench_role_be",
      companyName: be.companyName,
      companyStage: be.companyStage,
      title: be.roleTitle,
      location: be.location,
      workMode: be.workMode,
      compensationBand: be.compensationBand,
      stack: be.stack,
      mustHaves: be.mustHaves,
      niceToHaves: be.niceToHaves,
      // Long-JD variant: MAX_JD_CHARS is 8000 (ai.server.ts:38), so overshoot it to
      // exercise the clipping path on the full/deepen side.
      jdText: `${be.jdText}\n\n${"Additional context for the founding backend seat: you will own the data model, review every schema change, write the ingestion service, and be first on-call. ".repeat(95)}`,
    },
  ];
}

/** A JD over the 8000-char prompt clip, for the long-JD measurement. */
export function longJdText(role: BenchRole): string {
  return role.jdText;
}

/**
 * Build a slate of `count` resumes. The first rows include the adversarial variants;
 * the rest cycle the 8 gold cases against alternating roles.
 */
export function buildResumeList(opts: { count: number; roles?: BenchRole[] }): BenchResume[] {
  const roles = opts.roles ?? buildRoles();
  const out: BenchResume[] = [];
  for (let i = 0; i < opts.count; i++) {
    const g = GOLD_EVAL_CASES[i % GOLD_EVAL_CASES.length];
    const role = roles[i % roles.length];
    let variant: BenchResume["variant"] = "typical";
    if (i === 0) variant = "huge_resume";
    else if (i === 1) variant = "off_family";
    else if (i === 2) variant = "long_jd";
    out.push(materialize(g, i, role.roleId, variant));
  }
  return out;
}

/** In-memory uniqueness check for email + resume text, before touching the DB. */
export function verifyUniqueness(list: BenchResume[]): {
  ok: boolean;
  n: number;
  distinctEmails: number;
  distinctTexts: number;
} {
  const emails = new Set<string>();
  const texts = new Set<string>();
  for (const r of list) {
    const m = r.resumeText.match(EMAIL_RE);
    if (m) emails.add(m[0].toLowerCase());
    texts.add(r.resumeText);
  }
  return {
    ok: emails.size === list.length && texts.size === list.length,
    n: list.length,
    distinctEmails: emails.size,
    distinctTexts: texts.size,
  };
}

export { GOLD_EVAL_CASES };
