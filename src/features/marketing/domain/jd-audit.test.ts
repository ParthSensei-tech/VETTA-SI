import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MUST_HAVES,
  auditJobDescription,
} from "./jd-audit.ts";

/**
 * The JD audit is the half of the teaser that runs on a stranger's text, so its
 * contract is the same one every public Vetta page has: it may quote what the
 * founder wrote and name what is absent, and it may never state a result we
 * have not measured.
 */

const FULL_JD = `Senior Backend Engineer — Series A fintech, Bengaluru

We are hiring a senior backend engineer to own our ledger service.

Requirements:
- Must have 5-8 years of experience building distributed systems
- Strong command of Node.js, TypeScript and PostgreSQL
- Hands-on experience with AWS and Kubernetes
- Minimum qualifications: B.Tech in Computer Science
- Excellent communication skills and ability to work in a fast-paced environment

Nice to have:
- Familiarity with Kafka

Compensation: ₹32–45L + 0.1% ESOPs. Hybrid in Bengaluru. Notice period negotiable up to 60 days.
`;

const VAGUE_JD = `Developer wanted.

We need a rockstar ninja who is great at communication and can wear many hats in a
fast-paced environment. Passionate about technology. Excellent culture fit.
`;

test("jd audit: quotes the founder's own words, in their own casing", () => {
  const audit = auditJobDescription(FULL_JD);
  assert.ok(audit.stack.includes("Node.js"), `stack was ${audit.stack.join(", ")}`);
  assert.ok(audit.stack.includes("TypeScript"));
  assert.ok(audit.gradedOn.some((line) => line.includes("5-8 years of experience")));
  // A skill we print is a skill we found; nothing here is invented.
  for (const skill of audit.stack) assert.ok(FULL_JD.toLowerCase().includes(skill.toLowerCase()));
});

test("jd audit: a JD with no checkable requirement says so instead of flattering the founder", () => {
  const audit = auditJobDescription(VAGUE_JD);
  assert.equal(audit.gradedOn.length, 0, "there is nothing here a resume can be scored against");
  assert.ok(audit.vagueDemands.length > 0);
  assert.ok(
    audit.gaps.some((gap) => /no explicit requirement list/i.test(gap)),
    audit.gaps.join(" | "),
  );
});

test("jd audit: every gap names an absence in this text, and disappears when the text fills it", () => {
  const bare = auditJobDescription(VAGUE_JD);
  assert.ok(bare.gaps.some((gap) => gap.startsWith("No band.")));
  assert.ok(bare.gaps.some((gap) => gap.startsWith("No ESOP statement")));
  assert.ok(bare.gaps.some((gap) => /Remote, hybrid or on-site is not stated/.test(gap)));

  const stated = auditJobDescription(FULL_JD);
  assert.ok(!stated.gaps.some((gap) => gap.startsWith("No band.")), "the band is in this JD");
  assert.ok(!stated.gaps.some((gap) => gap.startsWith("No ESOP statement")));
  assert.ok(!stated.gaps.some((gap) => /Remote, hybrid or on-site is not stated/.test(gap)));
});

test("jd audit: the audit never states a result Vetta has not measured", () => {
  const audit = auditJobDescription(FULL_JD);
  const prose = [...audit.gaps, ...audit.gradedOn, audit.seniority].join(" ").toLowerCase();
  for (const banned of ["%", "faster", "accurate", "accuracy", "top 1", "10×", "best", "guarantee"]) {
    assert.ok(!prose.includes(banned), `the audit claimed "${banned}"`);
  }
});

test("jd audit: deterministic, capped, and honest about how much it read", () => {
  assert.deepEqual(auditJobDescription(FULL_JD), auditJobDescription(FULL_JD));
  const long = Array.from({ length: 40 }, (_, i) => `Must have skill ${i} in the stack`).join("\n");
  assert.equal(auditJobDescription(long).mustHaves.length, MAX_MUST_HAVES);
  // linesRead is a count of what the reader actually split, so a longer JD must
  // report more of it — the number on the page is never a rounded guess.
  assert.ok(auditJobDescription(long).linesRead > auditJobDescription(FULL_JD).linesRead);
});
