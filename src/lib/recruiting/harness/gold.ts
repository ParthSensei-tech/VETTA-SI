import type { FitLevel } from "../types";

export type GoldCase = {
  slug: string;
  title: string;
  companyName: string;
  companyStage: "seed" | "series_a" | "series_b";
  roleTitle: string;
  location: string;
  workMode: "hybrid" | "remote" | "onsite";
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
  resumeText: string;
  humanLabel: FitLevel;
  expectShortlist: boolean;
  notes: string;
};

const AE_JD = `First seller. Find the first twenty paying customers. Sit with the founder on discovery. You will build pipeline without a demand-gen machine, run discovery, and close.

Must-haves: closed B2B deals yourself; HubSpot hygiene; outbound that is not a spray.

Notice up to 60 days is workable.`;

const BE_JD = `Founding backend seat in Bengaluru. You will design the data model, write the first services, and sit on-call in a team of <8.

Stack: Go, PostgreSQL, Kafka, AWS.
Must-haves: shipped production services, not just CRUD; comfortable owning on-call; clear written communication.`;

export const GOLD_EVAL_CASES: GoldCase[] = [
  {
    slug: "ae-quota-carrier",
    title: "Quota-carrying AE for founding AE",
    companyName: "Nimbus",
    companyStage: "seed",
    roleTitle: "Founding Account Executive",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹18–28 LPA + variable + ESOP",
    stack: ["Outbound", "Discovery", "HubSpot", "Closing"],
    mustHaves: ["Closed B2B deals yourself", "Builds pipeline without a demand-gen machine"],
    niceToHaves: ["Prior 0→1 GTM"],
    jdText: AE_JD,
    humanLabel: "yes",
    expectShortlist: true,
    notes: "Should shortlist. Real closing evidence, local, HubSpot, outbound.",
    resumeText: `Ananya Rao
Bengaluru
Account Executive, Razorpay — 2022–present
ananya.rao@example.com
+91 98765 43210

Closed-won ₹1.8 Cr mid-market ARR last year against a ₹1.4 Cr quota. I run my own outbound (LinkedIn + email sequences), discovery, and HubSpot hygiene. No SDR pod. First twenty logos on a new billing SKU were mine.

Previously SDR at Freshworks (Chennai → Bengaluru). Notice period 30 days. Current 22 LPA, expected 28 LPA + variable.

I have sat with founders on messy discovery calls and written the notes the product team used.`,
  },
  {
    slug: "ae-function-mismatch",
    title: "Backend engineer for founding AE",
    companyName: "Nimbus",
    companyStage: "seed",
    roleTitle: "Founding Account Executive",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹18–28 LPA + variable + ESOP",
    stack: ["Outbound", "Discovery", "HubSpot", "Closing"],
    mustHaves: ["Closed B2B deals yourself", "Builds pipeline without a demand-gen machine"],
    niceToHaves: ["Prior 0→1 GTM"],
    jdText: AE_JD,
    humanLabel: "no",
    expectShortlist: false,
    notes: "Structural no. Strong engineer, wrong function. False-shortlist trap.",
    resumeText: `Rohit Menon
Bengaluru
Senior Backend Engineer, PhonePe — 2019–present
rohit.menon@example.com

Shipped Go services on PostgreSQL and Kafka. Owned on-call for payments reconciliation. AWS, Terraform, Kubernetes. IIT Madras, 8 years.

I write design docs and review PRs. No quota, no outbound, no HubSpot, no closing. Notice 90 days. Current 54 LPA.`,
  },
  {
    slug: "be-founding-go",
    title: "Founding backend with on-call Go",
    companyName: "Kite",
    companyStage: "seed",
    roleTitle: "Founding Backend Engineer",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹35–55 LPA + ESOP",
    stack: ["Go", "PostgreSQL", "Kafka", "AWS"],
    mustHaves: [
      "Shipped production services, not just CRUD",
      "Comfortable owning on-call in a team of <8",
    ],
    niceToHaves: ["Prior 0→1"],
    jdText: BE_JD,
    humanLabel: "yes",
    expectShortlist: true,
    notes: "Should shortlist. Evidence of services, on-call, early-stage.",
    resumeText: `Meera Iyer
Bengaluru
Backend Engineer, a 12-person seed fintech — 2021–present
meera.iyer@example.com

I designed the Postgres schema, wrote the first Go services, and took on-call in a team of six. Kafka for ledger events. AWS. Founding-adjacent — wore multiple hats, no playbook.

Shipped production services used daily by operators, not CRUD demos. Notice 45 days. Current 32 LPA, expected 42 LPA.`,
  },
  {
    slug: "be-intern-thin",
    title: "Campus intern for founding backend",
    companyName: "Kite",
    companyStage: "seed",
    roleTitle: "Founding Backend Engineer",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹35–55 LPA + ESOP",
    stack: ["Go", "PostgreSQL", "Kafka", "AWS"],
    mustHaves: [
      "Shipped production services, not just CRUD",
      "Comfortable owning on-call in a team of <8",
    ],
    niceToHaves: ["Prior 0→1"],
    jdText: BE_JD,
    humanLabel: "no",
    expectShortlist: false,
    notes: "No. Intern project, no on-call, no production ownership.",
    resumeText: `Aarav Shah
Pune
Intern, campus placement 2025
aarav.shah@example.com

Built a CRUD app in Python for a college fest. Followed tutorials on PostgreSQL. No on-call. No Go. No AWS in production. Fresher. Expected 12 LPA.`,
  },
  {
    slug: "pm-faang-no-zero-one",
    title: "Big-company PM for seed PM",
    companyName: "Harbor",
    companyStage: "seed",
    roleTitle: "Founding Product Manager",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹40–60 LPA + ESOP",
    stack: ["Discovery", "Specs", "SQL", "Amplitude"],
    mustHaves: [
      "Shipped a product end-to-end with engineers in the room",
      "Writes clearly — specs that engineers can build",
    ],
    niceToHaves: ["0→1"],
    jdText: `Seed. There is no PM org. You sit with the founders, talk to the first fifty customers, write the spec, and stand next to engineering until it ships.`,
    humanLabel: "maybe",
    expectShortlist: false,
    notes: "Maybe, not a shortlist. Strong pedigree, thin 0→1 and founder-proximate evidence.",
    resumeText: `Priya Nair
Gurugram
Product Manager, Google — 2018–present
priya.nair@example.com

Managed a slice of a mature surface. Wrote PRDs, ran reviews, looked at Amplitude dashboards. SQL for funnels. Specs that engineers built — with a research team and a PM org around me.

No 0→1. No first fifty customers. Notice 90 days. Current 78 LPA. IIT Delhi, ISB.`,
  },
  {
    slug: "design-gtm-mismatch",
    title: "GTM hire for founding design",
    companyName: "Lumen",
    companyStage: "seed",
    roleTitle: "Founding Product Designer",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹28–42 LPA + ESOP",
    stack: ["Figma", "Design system", "UX", "Prototyping"],
    mustHaves: ["Shipped screens with engineers", "Taste and finishing"],
    niceToHaves: ["Brand"],
    jdText: `First design hire. You will set the visual language, ship screens with the founding engineers, and sit in customer calls. Taste matters. So does finishing.`,
    humanLabel: "no",
    expectShortlist: false,
    notes: "Function mismatch. Seller, not a designer.",
    resumeText: `Vikram Joshi
Mumbai
Account Executive, HubSpot partner — 2020–present
vikram.joshi@example.com

Quota-carrying seller. Outbound, discovery, closing. HubSpot. No Figma. No design system. No shipped screens.

Closed 40 SMB deals last year. Notice 30 days.`,
  },
  {
    slug: "ae-relocating-sdr",
    title: "Chennai SDR with thin closing",
    companyName: "Nimbus",
    companyStage: "seed",
    roleTitle: "Founding Account Executive",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹18–28 LPA + variable + ESOP",
    stack: ["Outbound", "Discovery", "HubSpot", "Closing"],
    mustHaves: ["Closed B2B deals yourself", "Builds pipeline without a demand-gen machine"],
    niceToHaves: ["Prior 0→1 GTM"],
    jdText: AE_JD,
    humanLabel: "maybe",
    expectShortlist: false,
    notes: "Solid outbound, thinner on closing. Relocation. Hold, do not shortlist yet.",
    resumeText: `Karthik Iyer
Chennai
SDR, Freshworks — 2021–present
karthik.iyer@example.com

Solid outbound volume. HubSpot sequences. Booked meetings for AEs. A handful of small closes when an AE was out — not a full quota.

Willing to relocate to Bengaluru. Notice 45 days. Current 14 LPA, expected 20 LPA.`,
  },
  {
    slug: "be-sre-oncall",
    title: "SRE with on-call for founding backend",
    companyName: "Kite",
    companyStage: "seed",
    roleTitle: "Founding Backend Engineer",
    location: "Bengaluru",
    workMode: "hybrid",
    compensationBand: "₹35–55 LPA + ESOP",
    stack: ["Go", "PostgreSQL", "Kafka", "AWS"],
    mustHaves: [
      "Shipped production services, not just CRUD",
      "Comfortable owning on-call in a team of <8",
    ],
    niceToHaves: ["Prior 0→1"],
    jdText: BE_JD,
    humanLabel: "yes",
    expectShortlist: true,
    notes: "On-call, AWS, Postgres. Go is partial. Shortlist with a screen on services vs tickets.",
    resumeText: `Sana Qureshi
Hyderabad
SRE, a 30-person Series A — 2020–present
sana.qureshi@example.com

Owned on-call. AWS, Kubernetes, PostgreSQL replicas, Kafka lag. I write Go only for glue, not core services — Python for the rest.

Shipped production reliability work, not CRUD. Comfortable in a team of eight. Notice 60 days. Current 36 LPA. Open to Bengaluru hybrid.`,
  },
];
