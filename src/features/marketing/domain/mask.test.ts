import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BULLET_CHARS,
  MIN_PUBLISHABLE_COHORT,
  PREVIEW_ROWS,
  entityBlocklist,
  experienceBand,
  initialsOf,
  maskShortlist,
  regionOf,
  scrubProse,
  seniorityOf,
  type MaskInput,
} from "./mask.ts";

/**
 * These tests are the teaser's privacy contract. A teaser page is Vetta showing
 * a stranger what it concluded about a real person, so every test here asserts
 * the absence of something.
 */

function applicant(over: Partial<MaskInput> = {}): MaskInput {
  return {
    fullName: "Rahul Verma",
    location: "Koramangala, Bengaluru",
    currentTitle: "Senior Backend Engineer",
    currentCompany: "Zettabyte Technologies",
    yearsExperience: 6,
    rankScore: 84,
    level: "strong_yes",
    evidenceClaims: ["Owns the payments ledger end to end, including the reconciliation job."],
    probeLines: ["Has not evidenced running a service under load."],
    ...over,
  };
}

function cohort(count: number): MaskInput[] {
  const names = [
    "Rahul Verma",
    "Ananya Iyer",
    "Md Farhan",
    "Priya Nair",
    "Karthik Reddy",
    "Sneha Kulkarni",
    "Aditya Joshi",
  ];
  const companies = [
    "Zettabyte Technologies",
    "Northbridge Labs",
    "Quantum Fintech",
    "Halcyon Systems",
    "Brightloom Software",
    "Cedarlane Health",
    "Vantage Grid",
  ];
  return Array.from({ length: count }, (_, i) =>
    applicant({
      fullName: names[i % names.length],
      currentCompany: companies[i % companies.length],
      rankScore: 90 - i,
    }),
  );
}

test("teaser masking: a row carries no name, no verbatim title, no city, no employer", () => {
  const result = maskShortlist({
    applicants: [
      applicant({
        fullName: "Meghana Deshpande",
        currentTitle: "Founding Backend Engineer",
        location: "Indiranagar, Bengaluru",
        currentCompany: "Quantum Fintech",
      }),
      ...cohort(6).slice(1),
    ],
    roleCompany: "Northbridge Labs",
    depth: "full",
  });

  assert.ok(result.publishable, "the cohort is big enough to publish");
  const wire = JSON.stringify(result.rows).toLowerCase();
  for (const forbidden of ["meghana", "deshpande", "indiranagar", "quantum fintech", "founding backend"]) {
    assert.ok(!wire.includes(forbidden), `teaser leaked "${forbidden}"`);
  }
  assert.equal(result.rows[0]?.handle, "M. D.");
  assert.ok(result.rows[0]?.region.includes("Bengaluru"));
});

test("teaser masking: every cohort employer is denied out of model-written prose", () => {
  const blocked = entityBlocklist({
    applicants: [...cohort(MIN_PUBLISHABLE_COHORT), applicant({ currentCompany: "Quantum Payments" })],
    roleCompany: "Northbridge Labs",
  });
  assert.ok(blocked.includes("zettabyte"));
  assert.ok(blocked.includes("northbridge"));
  // A word in two hundred company names is not an entity — denying it would
  // blank every verdict Vetta has ever written.
  assert.ok(!blocked.includes("technologies"));
  // Same reasoning for a sector: "payments" describes the work, "Quantum" names
  // the employer, and only the name is denied.
  assert.ok(!blocked.includes("payments"), "a sector noun must not suppress bullets");
  assert.ok(blocked.includes("quantum"));
  assert.equal(
    scrubProse("Owned reconciliation for a payments ledger, end to end.", blocked).safe,
    true,
  );
  assert.equal(scrubProse("Owned the ledger at Quantum Payments for four years.", blocked).safe, false);

  const claim = "Built the same ledger at Zettabyte Technologies, then led it.";
  assert.equal(scrubProse(claim, blocked).safe, false);
});

test("teaser masking: contact shapes never survive, and a row with no surviving evidence is dropped", () => {
  const blocked = ["rahul"];
  for (const text of [
    "Reach the author at rahul@example.com for the write-up",
    "Migrated 12 services, details on 9876543210",
    "See github.com/rverma/ledger for the design notes",
    "Documented in onboarding-guide.pdf",
  ]) {
    assert.equal(scrubProse(text, blocked).safe, false, `leaked: ${text}`);
  }

  const result = maskShortlist({
    applicants: [applicant({ evidenceClaims: ["Ping rahul@example.com to confirm scope."] }), ...cohort(6).slice(1)],
    roleCompany: "Northbridge Labs",
    depth: "full",
  });
  // Six applicants went in, one had nothing safe to say about them.
  assert.equal(result.suppressed, 1);
  assert.equal(result.rows.length, 5);
});

test("teaser masking: a cohort under the floor publishes nothing at all", () => {
  const result = maskShortlist({
    applicants: cohort(MIN_PUBLISHABLE_COHORT - 1),
    roleCompany: "Northbridge Labs",
    depth: "full",
  });
  assert.equal(result.publishable, false);
  assert.deepEqual(result.rows, []);
});

test("teaser masking: preview is three rows and one bullet, and keeps the probe back", () => {
  const preview = maskShortlist({ applicants: cohort(8), roleCompany: "Kestrel", depth: "preview" });
  const full = maskShortlist({ applicants: cohort(8), roleCompany: "Kestrel", depth: "full" });

  assert.equal(preview.rows.length, PREVIEW_ROWS);
  assert.ok(preview.rows.every((row) => row.bullets.length === 1 && row.probe === null));
  assert.ok(full.rows.length > preview.rows.length);
  assert.ok(full.rows.every((row) => row.probe !== null));
});

test("teaser masking: a long verdict is cut at a word, never mid-token", () => {
  const long = `Delivered ${"settlement reconciliation ".repeat(20)} for the merchant suite`;
  const [row] = maskShortlist({
    applicants: [applicant({ evidenceClaims: [long] }), ...cohort(6).slice(1)],
    roleCompany: "Kestrel",
    depth: "full",
  }).rows;
  const bullet = row!.bullets[0]!;
  assert.ok(bullet.length <= MAX_BULLET_CHARS);
  assert.ok(bullet.endsWith("…"));
  assert.ok(!bullet.endsWith(" "));
});

test("teaser buckets: location becomes a region, seniority becomes a band", () => {
  assert.equal(regionOf("HITEC City, Hyderabad"), "Hyderabad");
  assert.equal(regionOf("Gurugram"), "Delhi NCR");
  assert.equal(regionOf("Kochi"), "Rest of India");
  assert.equal(regionOf("Berlin"), "Outside India");
  assert.equal(regionOf(""), "Not stated");
  assert.equal(regionOf("", "remote"), "Remote");
  // A short metro code only counts as a whole word.
  assert.equal(regionOf("Blr Road, Mangaluru", ""), "Bengaluru");
  assert.notEqual(regionOf("Bolor Forest, Shillong", ""), "Bengaluru");

  assert.equal(seniorityOf("Engineering Manager, Payments"), "Lead / Manager");
  assert.equal(seniorityOf("VP Engineering"), "Executive");
  assert.equal(seniorityOf("Staff Software Engineer"), "Staff / Principal");
  assert.equal(seniorityOf("Backend Engineer"), "Individual contributor");

  assert.equal(experienceBand(null), "Experience not stated");
  assert.equal(experienceBand(1.4), "Under 2 yrs");
  assert.equal(experienceBand(13), "12+ yrs");

  assert.equal(initialsOf("Md Farhan"), "M. F.");
  assert.equal(initialsOf("Cheruth"), "C.");
});
