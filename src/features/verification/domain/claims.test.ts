/**
 * Extraction and the grounding gate.
 *
 * The rule these tests exist to protect is the one that makes an LLM admissible
 * anywhere near a verdict: a claim survives only if its quote is a contiguous,
 * whitespace-normalised substring of the document. Everything else here is
 * convenience — a regex that reads a résumé the way a recruiter does, so the
 * checks downstream get comparable fields instead of a shrug.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_KINDS,
  PUBLIC_MAILBOXES,
  canonicalClaimKey,
  claimIsGrounded,
  claimsSetHash,
  dropUngrounded,
  extractClaims,
  isCheckable,
  isPublicMailbox,
  monthKey,
  monthsBetween,
  normalizeText,
  parseMonthKey,
  yearsBetween,
  type ExtractedClaim,
} from "./claims.ts";

const HONEST = `PRIYA RAMESH
Senior Backend Engineer | Bengaluru, Karnataka
priya@nimbus.example | +91 98450 12345

PROFILE
Backend engineer with 7 years of experience building high-throughput services for fintech.
Scaled a payments platform to 40M monthly requests across three regions.

EMPLOYMENT
Nimbus Technologies, Bengaluru — Senior Backend Engineer
Mar 2019 - Present
- Owned the reconciliation pipeline processing 2.3 million records a day.

Zeta Labs, Pune — Backend Developer
Jun 2016 - Feb 2019

EDUCATION
B.E. in Computer Science, NIT Trichy - 2016

CERTIFICATIONS
- AWS Certified Solutions Architect - Associate
Credential ID: AWS-11223344`;

const byKind = (text: string, kind: string) => extractClaims(text).filter((c) => c.kind === kind);

const claim = (over: Partial<ExtractedClaim>): ExtractedClaim => ({
  kind: "employment_period",
  statement: "s",
  quote: "Mar 2019 - Present",
  detail: {},
  ...over,
});

test("every claim extracted from a real-shaped resume is grounded in it", () => {
  const corpus = [
    HONEST,
    `ARJUN P
Full stack developer with 4 years of experience.
Vertex Apps, Hyderabad — Full Stack Developer
Jan 2028 - Present
MBA, IIM Bangalore - 2022
arjun@vertex-apps.example`,
    `MEENA S
Data engineer with 9 years of experience in warehousing.
Cube Analytics, Pune
May 2020 - Present
Delta Retail, Bengaluru
Aug 2021 - Present
B.Tech, VIT Vellore 2017
meena.d@gmail.com`,
    `ROHAN D
Final year student looking for an entry level role.
B.Tech in Computer Science, NIT Trichy - 2027
Pre-University at Delhi Public School - 2023
internship at TechM, Hyderabad
Jun 2026 - Aug 2026`,
  ];
  for (const text of corpus) {
    const claims = extractClaims(text);
    assert.ok(claims.length > 0, "the corpus must produce something");
    for (const c of claims) {
      assert.ok(CLAIM_KINDS.includes(c.kind), `unknown kind ${c.kind}`);
      assert.ok(
        claimIsGrounded(c, text),
        `ungrounded quote escaped extraction: ${JSON.stringify(c.quote)}`,
      );
      // The month keys that arithmetic is done with must be real months, never
      // "0NaN-12" — the shape a mis-numbered capture group produces.
      for (const key of [c.detail.startMonth, c.detail.endMonth]) {
        if (!key || key === "present") continue;
        assert.ok(parseMonthKey(key), `month key ${key} is not a month`);
      }
    }
  }
});

test("the honest resume yields a dated history, an employer and a credential id", () => {
  const periods = byKind(HONEST, "employment_period");
  assert.equal(periods.length, 2);
  const senior = periods.find((p) => p.detail.startMonth === "2019-03");
  assert.ok(senior, "Mar 2019 must parse at month precision, not degrade to a bare year");
  assert.equal(senior!.detail.endMonth, "present");
  assert.equal(senior!.detail.monthPrecision, "month");
  assert.equal(senior!.detail.employer, "Nimbus Technologies");
  assert.equal(senior!.detail.role, "Senior Backend Engineer");

  assert.deepEqual(
    byKind(HONEST, "tenure").map((t) => t.detail.years),
    [7],
  );
  const [degree] = byKind(HONEST, "education");
  assert.equal(degree.detail.endMonth, "2016-12");
  assert.equal(degree.detail.institution, "NIT Trichy");
  const [aws] = byKind(HONEST, "credential");
  assert.equal(
    aws.detail.credentialId,
    "AWS-11223344",
    "the id on the next row belongs to this credential",
  );
  assert.equal(byKind(HONEST, "metric").length, 2);
  assert.equal(byKind(HONEST, "identity").length, 1);
});

test("a year-only range is widened, and the widening is recorded", () => {
  const text = `SUNITA M
Platform engineer with six years of experience in deployment tooling.
Ironclad Systems, Bengaluru — Platform Engineer
2019 - 2021
- Built the deployment pipeline used by every engineering team.`;
  const [period] = byKind(text, "employment_period");
  assert.equal(period.detail.startMonth, "2019-01");
  assert.equal(period.detail.endMonth, "2021-12");
  assert.equal(period.detail.monthPrecision, "year");
});

test("present in any of its spellings is not a date nobody can compare", () => {
  for (const wording of ["Present", "present", "Current", "Ongoing", "till date"]) {
    const text = `KAVITHA R
Backend engineer with 5 years of experience in retail systems.
North Retail, Mumbai — Backend Engineer
Jan 2022 - ${wording}`;
    const [period] = byKind(text, "employment_period");
    assert.ok(period, `no employment claim for "${wording}"`);
    assert.equal(period.detail.endMonth, "present");
  }
});

test("a tenure claim about other people is not the candidate's claim", () => {
  const theirs = `VIKRAM N
I lead a team of engineers with 12 years of experience in logistics platforms.
Freightline, Chennai — Software Engineer
Jan 2010 - Present`;
  assert.equal(byKind(theirs, "tenure").length, 0, "twelve years describes the team, not Vikram");

  const mine = `VIKRAM N
Backend engineer with 12 years of experience in logistics platforms.
Freightline, Chennai — Software Engineer
Jan 2010 - Present`;
  assert.deepEqual(
    byKind(mine, "tenure").map((t) => t.detail.years),
    [12],
  );

  // A bullet that merely opens with a leadership verb is still about the author.
  const led = `ANITA R
Led the platform team at Nimbus Technologies for 6 years and 60 engineers.
Nimbus Technologies, Bengaluru
Jan 2020 - Dec 2025`;
  assert.deepEqual(
    byKind(led, "tenure").map((t) => t.detail.years),
    [6],
  );
});

test("the same claim written twice is one claim", () => {
  const repeated = `SUDHA K
Backend developer with 3 years of experience.
Sudha wrote sudha@nimbus.example in her summary too: sudha@nimbus.example
Nimbus Technologies, Bengaluru
Mar 2019 - Present`;
  assert.equal(byKind(repeated, "identity").length, 1);
});

test("personal mailboxes name no employer, work domains name exactly one", () => {
  for (const domain of PUBLIC_MAILBOXES) assert.equal(isPublicMailbox(domain), true);
  assert.equal(
    isPublicMailbox("mail.gmail.com"),
    true,
    "a subdomain of a public mailbox is public",
  );
  assert.equal(
    isPublicMailbox("nimbus-gmail.com"),
    false,
    "a string that merely contains gmail is not",
  );

  const gmail = `KAVITHA R
Backend engineer with 5 years of experience in retail systems.
kavitha.rao@gmail.com
North Retail, Mumbai — Backend Engineer
Jan 2022 - Present`;
  assert.equal(byKind(gmail, "identity").length, 0, "a billion people share that domain");

  const work = HONEST;
  const [identity] = byKind(work, "identity");
  assert.equal(identity.detail.domain, "nimbus.example");
  assert.equal(identity.detail.employer, "nimbus");
});

test("an ungrounded claim is dropped, never flagged and never kept", () => {
  const invented = claim({ quote: "Feb 2011 - Mar 2013 at Meridian Bank, Chennai" });
  const real = claim({ quote: "Mar 2019 - Present" });
  const { kept, dropped } = dropUngrounded([invented, real], HONEST);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].quote, real.quote);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].quote, invented.quote);
});

test("grounding needs the whole quote contiguous, not its words scattered", () => {
  // The AI guard this feature sits beside tolerates token overlap; here that
  // tolerance would let a claim assembled from three unrelated words accuse.
  assert.equal(claimIsGrounded(claim({ quote: "Mar 2019" }), HONEST), true);
  assert.equal(
    claimIsGrounded(claim({ quote: "Present 2016 Nimbus" }), HONEST),
    false,
    "each word appears somewhere; the sentence does not",
  );
  assert.equal(
    claimIsGrounded(claim({ quote: "mar  2019 -\tpresent" }), HONEST),
    true,
    "spacing is not evidence",
  );
  assert.equal(
    claimIsGrounded(claim({ quote: "Mar" }), HONEST),
    false,
    "a fragment is not a claim",
  );
});

test("the claim set hash ignores order and notices a changed claim", async () => {
  const a = extractClaims(HONEST);
  const b = [...a].reverse();
  assert.equal(await claimsSetHash(a), await claimsSetHash(b));
  assert.equal(await claimsSetHash(a), await claimsSetHash(a));

  const edited = a.map((c) =>
    c.kind === "tenure" ? { ...c, detail: { ...c.detail, years: 15 } } : c,
  );
  assert.notEqual(await claimsSetHash(a), await claimsSetHash(edited));

  const withOneMore = [...a, claim({ quote: "Zeta Labs, Pune — Backend Developer" })];
  assert.notEqual(await claimsSetHash(a), await claimsSetHash(withOneMore));
  assert.equal((await claimsSetHash([])).length, 64);
});

test("canonicalClaimKey distinguishes two stints that share their dates", () => {
  const one = claim({
    quote: "Jan 2020 - Present",
    detail: { startMonth: "2020-01", endMonth: "present", employer: "A" },
  });
  const two = claim({
    quote: "Jan 2020 - Present",
    detail: { startMonth: "2020-01", endMonth: "present", employer: "B" },
  });
  assert.notEqual(canonicalClaimKey(one), canonicalClaimKey(two));
});

test("month arithmetic is total where the input is and null where it is not", () => {
  assert.equal(monthKey(2019, 3), "2019-03");
  assert.equal(parseMonthKey("2019-13"), null);
  assert.equal(parseMonthKey("19-03"), null);
  assert.equal(parseMonthKey("present"), null);
  assert.equal(monthsBetween("2019-03", "2021-03"), 24);
  assert.equal(monthsBetween("2021-03", "2019-03"), -24);
  assert.equal(monthsBetween("2019-03", "nonsense"), null);
  assert.equal(yearsBetween("2019-01", "2021-07"), 2.5);
});

test("metric claims are shown and never counted as coverage", () => {
  assert.equal(isCheckable("metric"), false);
  for (const kind of CLAIM_KINDS) {
    if (kind === "metric") continue;
    assert.equal(isCheckable(kind), true, `${kind} is checkable in principle`);
  }
});

test("normalisation is what the whole ledger compares through", () => {
  assert.equal(normalizeText("  Mar\u00a0 2019\t-\nPresent "), "mar 2019 -\npresent");
  assert.equal(normalizeText("A  B").length, 3);
});
