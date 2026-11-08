import assert from "node:assert/strict";
import test from "node:test";
import type { ReportClaim } from "../domain/report.ts";
import { VERIFICATION_ENGINE_VERSION } from "../domain/checks/registry.ts";
import {
  claimNarrative,
  claimsInReportOrder,
  coverageSentence,
  headlineLabel,
  headlineTone,
  kindLabel,
  undisclosedArms,
  verdictLabel,
  verdictTone,
} from "./verdict-presentation.ts";

/** The ladder's own words for a check this engine never had. */
const engineGapNote = `Not enabled in engine ${VERIFICATION_ENGINE_VERSION}.`;

const claim = (over: Partial<ReportClaim>): ReportClaim => ({
  claimId: over.claimId ?? "c1",
  kind: over.kind ?? "employment_period",
  statement: over.statement ?? "Worked at Nimbus from Mar 2019 to the present.",
  quote: over.quote ?? "Mar 2019 - Present",
  verdict: over.verdict ?? "verified",
  definitive: over.definitive ?? true,
  cappedFrom: over.cappedFrom ?? "",
  note: over.note ?? "",
  restsOn: over.restsOn ?? "dates.range_reversed",
  outcomes: over.outcomes ?? [],
});

test("the headline chip distinguishes reach from blame", () => {
  assert.equal(headlineTone("none"), null, "nothing verified must render nothing");
  assert.equal(headlineTone("clean"), "success");
  assert.equal(headlineTone("flagged"), "danger");
  assert.equal(headlineTone("partial"), "warn");
  assert.equal(headlineLabel("flagged"), "Claims flagged");
});

test("an unverifiable claim is never coloured as a warning about the person", () => {
  assert.equal(verdictTone("unverifiable"), "outline");
  assert.equal(verdictTone("impossible"), "danger");
  assert.equal(verdictLabel("unverifiable"), "Unverifiable");
});

test("coverage is stated against checkable claims, including when there are none", () => {
  assert.equal(
    coverageSentence({ checked: 12, claims: 19, ratio: 12 / 19 }),
    "12 of 19 claims checked (63%)",
  );
  assert.equal(
    coverageSentence({ checked: 0, claims: 0, ratio: 0 }),
    "No checkable claims in this document.",
  );
  assert.equal(
    coverageSentence({ checked: 3, claims: 3, ratio: 1 }),
    "3 of 3 claims checked (100%)",
  );
});

test("the arms that did not speak are listed once each, with the reason a reader can act on", () => {
  const claims = [
    claim({
      claimId: "a",
      outcomes: [
        {
          checkId: "registry.employer_incorporation",
          observation: "skipped",
          note: "Outside this workspace's verification plan (paid arm).",
        },
        {
          checkId: "document.orphaned_text",
          observation: "skipped",
          note: "Needs the original document bytes, which are not retained for this candidate.",
        },
      ],
    }),
    claim({
      claimId: "b",
      kind: "credential",
      outcomes: [
        // The same arm on a second claim: one row in the disclosure, not two.
        {
          checkId: "registry.employer_incorporation",
          observation: "skipped",
          note: "Outside this workspace's verification plan (paid arm).",
        },
        {
          checkId: "identity.dns_mx",
          observation: "skipped",
          note: "Waiting on dns, which is not configured for this run.",
        },
      ],
    }),
    claim({
      claimId: "c",
      outcomes: [{ checkId: "dates.range_reversed", observation: "supported", note: "" }],
    }),
  ];

  const arms = undisclosedArms(claims);
  assert.deepEqual(
    arms.map((a) => a.id),
    ["registry.employer_incorporation", "document.orphaned_text", "identity.dns_mx"],
  );
  assert.equal(
    arms[0].label,
    "Employer incorporation date",
    "labelled from the registry, not invented",
  );
  assert.equal(arms[0].reason, "Not included in this plan");
  assert.equal(arms[1].reason, "Needs the original file");
  assert.equal(arms[2].reason, "Needs dns");

  const engineGap = undisclosedArms([
    claim({
      outcomes: [
        {
          checkId: "credential.issuer_lookup",
          observation: "skipped",
          note: engineGapNote,
        },
      ],
    }),
  ]);
  assert.equal(engineGap[0].reason, "Not in this engine version");

  // A check that threw is disclosed too: an error is not a clean report.
  const threw = undisclosedArms([
    claim({
      outcomes: [{ checkId: "dates.range_reversed", observation: "error", note: "bad month" }],
    }),
  ]);
  assert.equal(threw.length, 1);
  assert.equal(threw[0].reason, "bad month");
});

test("the sentence under a claim is what the checks that ran said", () => {
  // The live shape of a Tier A report: one arithmetic finding, and the whole
  // unbought ladder recorded as the reason it did not speak.
  const found = claim({
    verdict: "impossible",
    note:
      "Its own start date, 2027-03, is 4 months after the reference month 2026-11. " +
      "Outside this workspace's verification plan (paid arm). " +
      "Outside this workspace's verification plan (paid arm). " +
      "Needs the original document bytes, which are not retained for this candidate.",
    outcomes: [
      {
        checkId: "dates.dated_in_future",
        observation: "impossible",
        note: "Its own start date, 2027-03, is 4 months after the reference month 2026-11.",
      },
      {
        checkId: "registry.employer_incorporation",
        observation: "skipped",
        note: "Outside this workspace's verification plan (paid arm).",
      },
      {
        checkId: "credential.issuer_lookup",
        observation: "skipped",
        note: "Outside this workspace's verification plan (paid arm).",
      },
      {
        checkId: "document.orphaned_text",
        observation: "skipped",
        note: "Needs the original document bytes, which are not retained for this candidate.",
      },
    ],
  });
  assert.equal(
    claimNarrative(found),
    "Its own start date, 2027-03, is 4 months after the reference month 2026-11.",
    "the finding, once, with no plan prose repeating",
  );

  // Two checks that ran and said the same thing is one sentence.
  const twice = claim({
    outcomes: [
      { checkId: "dates.range_reversed", observation: "supported", note: "Dates run forward." },
      {
        checkId: "dates.overlapping_current",
        observation: "supported",
        note: "Dates run forward.",
      },
    ],
  });
  assert.equal(claimNarrative(twice), "Dates run forward.");

  // A capped accusation keeps its evidence: the drawer must still show what the
  // non-definitive check found, next to the line that says why it was capped.
  const capped = claim({
    verdict: "unverifiable",
    cappedFrom: "contradicted",
    note: "The degree is dated 2015-12 but the document dates work from 2016-06.",
    outcomes: [
      {
        checkId: "education.timeline_order",
        observation: "inconsistent",
        note: "The degree is dated 2015-12 but the document dates work from 2016-06.",
      },
      {
        checkId: "identity.dns_mx",
        observation: "skipped",
        note: "Waiting on dns, which is not configured for this run.",
      },
    ],
  });
  assert.match(claimNarrative(capped), /^The degree is dated 2015-12/);

  // Nothing reached: say that, rather than reciting the plan.
  const untouched = claim({
    verdict: "unverifiable",
    note: "Outside this workspace's verification plan (paid arm).",
    outcomes: [
      {
        checkId: "template.slate_duplicate",
        observation: "skipped",
        note: "Outside this workspace's verification plan (paid arm).",
      },
    ],
  });
  assert.equal(claimNarrative(untouched), "No check in this plan reached this claim.");

  // The other empty case, and the one that must not be confused with it: an arm
  // that ran, agreed and had nothing to add. Saying "no check reached this"
  // under a verified row would be the drawer contradicting its own badge.
  const clean = claim({
    verdict: "verified",
    note: "Outside this workspace's verification plan (paid arm).",
    outcomes: [
      { checkId: "dates.range_reversed", observation: "supported", note: "" },
      {
        checkId: "registry.employer_incorporation",
        observation: "skipped",
        note: "Outside this workspace's verification plan (paid arm).",
      },
    ],
  });
  assert.equal(claimNarrative(clean), "", "checked, clean, and not pretending otherwise");

  // A check that declined is still a check that reached the claim.
  assert.equal(
    claimNarrative(
      claim({
        verdict: "unverifiable",
        outcomes: [
          {
            checkId: "metric.no_authoritative_source",
            observation: "silent",
            note: "no comparator",
          },
        ],
      }),
    ),
    "no comparator",
  );

  // An outcome list we cannot read the note from still shows the stored note:
  // the ledger's own sentence is the fallback, not a blank row.
  assert.equal(
    claimNarrative(claim({ note: "No check could run against this claim.", outcomes: [] })),
    "No check could run against this claim.",
  );
});

test("the ledger leads with what it can prove and ends with what it cannot", () => {
  const ordered = claimsInReportOrder([
    claim({ claimId: "v", verdict: "verified" }),
    claim({ claimId: "u", verdict: "unverifiable" }),
    claim({ claimId: "x", verdict: "contradicted" }),
    claim({ claimId: "i", verdict: "impossible" }),
    claim({ claimId: "v2", verdict: "verified", kind: "credential" }),
  ]);
  assert.deepEqual(
    ordered.map((c) => c.claimId),
    ["i", "x", "u", "v2", "v"],
    "impossible, then contradicted, then unverifiable, then verified by kind",
  );
});

test("the kinds read as the sections of a resume, not as our enum", () => {
  assert.equal(kindLabel("tenure"), "Experience length");
  assert.equal(kindLabel("employment_period"), "Employment dates");
  assert.equal(kindLabel("education"), "Education");
  assert.equal(kindLabel("credential"), "Certifications");
  assert.equal(kindLabel("metric"), "Stated scale");
  assert.equal(kindLabel("identity"), "Identity");
});
