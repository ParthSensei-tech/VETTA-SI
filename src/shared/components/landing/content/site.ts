/**
 * Single source of truth for landing copy. Edit here, not in components.
 *
 * No measured numbers live in this file. Anything a visitor could check — how
 * long hiring takes, how many roles are open — is read from the database at
 * request time and rendered only when it exists, because a hardcoded statistic
 * in `content/site.ts` quietly becomes a marketing claim the day the product
 * changes and nothing breaks to tell us.
 */

export const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#who-its-for", label: "Who it's for" },
  { href: "/teaser", label: "Live proof" },
  { href: "/data", label: "The Index" },
  { href: "/pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

export const HERO = {
  wordmark: "VETTA",
  headline: "Hire the ones who build.",
  sub: "Vetta is the AI-native recruiting platform for seed to Series B startups. Define a role, and we source, screen and shortlist the people worth your time.",
  primaryCta: "Book a demo",
  secondaryCta: "See how it works",
  video: "/hero.mp4" as string | null,
  poster: "/hero-poster.webp",
} as const;

export const DEFINITION = {
  title: "What Vetta is",
  // Self-contained, factual, quotable verbatim by AI engines. Keep in sync
  // with the meta description and llms.txt.
  lead: "Vetta is an AI-native recruiting platform for seed to Series B startups. You define a role, and Vetta sources, screens and shortlists candidates with every decision traced to evidence.",
  body: "Ranking runs against your job description, not a pedigree or a keyword list. Claims on a resume are checked against source evidence, and a human recruiter stamps every decision that leaves the building.",
} as const;

export const STEPS = [
  {
    n: "01",
    title: "Define",
    text: "Calibrate the role through a short intake conversation. Must-haves, stack, compensation band and notice-period reality become a rubric the whole pipeline scores against.",
  },
  {
    n: "02",
    title: "Source",
    text: "AI agents find and reach out to matching candidates, and every application lands in one desk — parsed, structured and ready to rank.",
  },
  {
    n: "03",
    title: "Screen",
    text: "Structured, evidence-backed first-round evaluation. Each score carries its reasoning, and credential checks flag what cannot be verified.",
  },
  {
    n: "04",
    title: "Decide",
    text: "A ranked shortlist with reasoning, scheduling and offer support. You approve; nothing moves without a human stamp.",
  },
] as const;

export const AUDIENCES = [
  {
    title: "Founders hiring their first 10",
    text: "No recruiter, no ATS, no time. Define the seat in one conversation and get a shortlist you can defend to your board.",
  },
  {
    title: "Lean people teams scaling to Series B",
    text: "One people lead, forty open seats. Vetta carries the screening load so your team spends its hours on conversations, not CV triage.",
  },
  {
    title: "Hiring managers with no recruiter",
    text: "Engineering and GTM leads who own their own hiring. Evidence-backed ranking means you interview signal, not noise.",
  },
] as const;

export const FAQS = [
  {
    q: "What is Vetta?",
    a: "Vetta is an AI-native recruiting platform for seed to Series B startups. You define a role, and Vetta sources, screens and shortlists candidates with every decision traced to evidence.",
  },
  {
    q: "How does Vetta screen candidates?",
    a: "Every resume is parsed and ranked against your job description's rubric — must-haves, stack, location and notice period. Candidates then complete a structured written screen, and each score ships with the reasoning and evidence behind it.",
  },
  {
    q: "Does AI make the final hiring decision?",
    a: "No. Vetta ranks, screens and verifies, but a human recruiter reviews and stamps every decision that leaves the building. AI output is always held for human review.",
  },
  {
    q: "Does Vetta check whether resume claims are true?",
    a: "Yes. Verification runs forensic checks on submitted documents and credentials — date and tenure arithmetic, document edit history and registry checks — and labels each claim verified, contradicted or unverifiable.",
  },
  {
    q: "How is candidate data handled?",
    a: "Candidates give itemized consent under India's DPDP Act (2023) before applying, and can withdraw consent or request erasure at any time. Model learning only happens where a candidate has consented to it.",
  },
  {
    q: "How do candidates apply?",
    a: "Through public role pages on this site. A candidate uploads or pastes a resume, adds a few facts, consents to processing, and the desk starts ranking immediately.",
  },
] as const;

export const FINAL_CTA = {
  headline: "Your next great hire is already out there.",
  sub: "Leave your email and we'll set up a walkthrough with your own open role.",
  placeholder: "you@company.com",
  button: "Book a demo",
  success: "Thanks — we'll be in touch shortly.",
} as const;

export const FOOTER = {
  tagline: "Vetta · AI-native technical recruiting for India's early-stage teams.",
  links: [
    { href: "/jobs", label: "Open roles" },
    { href: "/teaser", label: "Live shortlists" },
    { href: "/data", label: "The Vetta Index" },
    { href: "/pricing", label: "Pricing" },
    { href: "/login", label: "Recruiter sign in" },
  ],
} as const;