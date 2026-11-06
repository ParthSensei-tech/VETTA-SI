import type { CompanyStage, EmploymentType, FitLevel, KnowledgeKind, PipelineStatus, WorkMode } from "./types";

export const APP_NAME = "Vetta";

export const STAGE_LABEL: Record<CompanyStage, string> = {
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
};

export const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  ingested: "Received",
  ranked: "Sorted",
  shortlisted: "Shortlist",
  screening: "In screen",
  ready: "Ready",
  approved: "Approved",
  sent: "Sent",
  hold: "On hold",
  rejected: "Out",
};

export const FIT_LABEL: Record<FitLevel, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  contract: "Contract",
};

export const KNOWLEDGE_LABEL: Record<KnowledgeKind, string> = {
  practical: "Practical",
  basic: "Basics",
  common: "Common sense",
};

export const KNOWLEDGE_HINT: Record<KnowledgeKind, string> = {
  practical: "How you actually ship — incidents, tradeoffs, ownership.",
  basic: "Core knowledge for this stack, in your own words.",
  common: "Judgement a senior engineer would expect on a small team.",
};

export const CITIES = [
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Gurugram",
  "Mumbai",
  "Chennai",
  "Noida",
  "Remote — India",
  "Remote — anywhere",
];

export const ROLE_TEMPLATES: Array<{
  id: string;
  label: string;
  title: string;
  companyStage: CompanyStage;
  location: string;
  workMode: "onsite" | "hybrid" | "remote";
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
}> = [
  {
    id: "founding-backend",
    label: "Founding backend",
    title: "Founding Backend Engineer",
    companyStage: "seed",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹35–55 LPA + 0.4–1.0% ESOP",
    stack: ["Go", "PostgreSQL", "Kafka", "AWS"],
    mustHaves: [
      "Shipped production services, not just CRUD",
      "Comfortable owning on-call in a team of <8",
      "Clear written communication",
    ],
    niceToHaves: ["Prior 0→1", "Payments or marketplace domain"],
    jdText: `We are a Seed team in Bengaluru building a B2B product used daily by operators. This is a founding backend seat — you will design the data model, write the first services, and set the engineering bar.

You will:
- Own core APIs and the Postgres schema
- Make pragmatic calls on consistency, queues, and observability
- Sit with the founder on customer calls when the product breaks in the wild

You are likely a fit if you have 4–8 years writing backend systems, have been on-call, and prefer a small team over a platform org. Notice period up to 60 days is workable; 90 days needs a strong overlap plan.`,
  },
  {
    id: "senior-frontend",
    label: "Senior frontend",
    title: "Senior Frontend Engineer",
    companyStage: "series_a",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹40–65 LPA + ESOP",
    stack: ["TypeScript", "React", "Next.js", "Tailwind"],
    mustHaves: [
      "Production TypeScript React",
      "Design-system thinking",
      "Performance and accessibility instincts",
    ],
    niceToHaves: ["Playwright", "Design background"],
    jdText: `Series A product team. The frontend is the product — operators live in it 6 hours a day. We need someone who can take a messy workflow and make it feel inevitable.

You will own a surface end-to-end: data fetching, empty states, permissions, and the last 10% of polish. We care more about taste and ownership than a FAANG stamp.

4–9 years of product frontend. Hybrid Bengaluru; remote-India for exceptional candidates.`,
  },
  {
    id: "product-engineer",
    label: "Product engineer",
    title: "Product Engineer",
    companyStage: "series_a",
    location: "Remote — India",
    workMode: "remote",
    compensationBand: "₹30–50 LPA + ESOP",
    stack: ["TypeScript", "Node.js", "React", "PostgreSQL"],
    mustHaves: [
      "Full-stack product delivery",
      "Can talk to users without a PM translating",
      "Ships weekly",
    ],
    niceToHaves: ["Early-stage experience", "SQL fluency"],
    jdText: `We hire product engineers, not ticket-takers. You will pick up a customer problem, shape the spec, ship the slice, and watch usage.

Stack is TypeScript across the board. Remote-India, overlap 11:00–19:00 IST. Seed-to-A DNA matters more than years.`,
  },
  {
    id: "platform",
    label: "Platform / DevOps",
    title: "Platform Engineer",
    companyStage: "series_b",
    location: "Hyderabad",
    workMode: "hybrid",
    compensationBand: "₹45–70 LPA + ESOP",
    stack: ["Kubernetes", "Terraform", "AWS", "Go"],
    mustHaves: [
      "Production Kubernetes",
      "Infrastructure as code",
      "Incident response",
    ],
    niceToHaves: ["Cost control at scale", "Security baselines"],
    jdText: `Series B. The product works; the platform is starting to creak. We need someone who has lived through growth, not someone who only wrote Helm charts in a platform-as-a-service team.

You will raise the reliability bar, kill snowflake environments, and make deploys boring. Hyderabad hub, hybrid.`,
  },
];
