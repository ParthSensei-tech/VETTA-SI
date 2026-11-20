import assert from "node:assert/strict";
import test from "node:test";
import {
  getLegalDocument,
  SAAS_TERMS_OF_SERVICE,
  DATA_PROCESSING_ADDENDUM,
  CANDIDATE_PRIVACY_NOTICE,
  ANTI_SCRAPING_SOURCING_POLICY,
} from "./legal-terms.ts";

test("legal-terms: getLegalDocument resolves all standard document types", () => {
  const terms = getLegalDocument("terms");
  const dpa = getLegalDocument("dpa");
  const candidatePrivacy = getLegalDocument("candidate_privacy");
  const antiScraping = getLegalDocument("anti_scraping");

  assert.equal(terms.id, "terms");
  assert.equal(terms.title, SAAS_TERMS_OF_SERVICE.title);

  assert.equal(dpa.id, "dpa");
  assert.equal(dpa.title, DATA_PROCESSING_ADDENDUM.title);

  assert.equal(candidatePrivacy.id, "candidate_privacy");
  assert.equal(candidatePrivacy.title, CANDIDATE_PRIVACY_NOTICE.title);

  assert.equal(antiScraping.id, "anti_scraping");
  assert.equal(antiScraping.title, ANTI_SCRAPING_SOURCING_POLICY.title);
});

test("legal-terms: all documents meet statutory disclosure and readability criteria", () => {
  const docs = [
    SAAS_TERMS_OF_SERVICE,
    DATA_PROCESSING_ADDENDUM,
    CANDIDATE_PRIVACY_NOTICE,
    ANTI_SCRAPING_SOURCING_POLICY,
  ];

  for (const doc of docs) {
    assert.ok(doc.id, "Must have an id");
    assert.ok(doc.title.length > 10, `Title too short for ${doc.id}`);
    assert.ok(doc.subtitle.length > 10, `Subtitle too short for ${doc.id}`);
    assert.ok(doc.governingLaw.length > 5, `Governing law missing for ${doc.id}`);
    assert.ok(doc.sections.length >= 3, `Expected at least 3 sections in ${doc.id}`);

    for (const section of doc.sections) {
      assert.ok(section.heading.length > 0, "Section heading required");
      assert.ok(section.content.length > 20, "Section content must be meaningful");
    }
  }
});

test("legal-terms: Candidate Privacy notice complies with DPDP Rule 4 requirements", () => {
  const doc = getLegalDocument("candidate_privacy");
  const fullText = doc.sections.map((s) => s.content + " " + (s.bullets ?? []).join(" ")).join(" ");

  assert.match(doc.governingLaw, /DPDP/i);
  assert.match(fullText, /Data Fiduciary/i);
  assert.match(fullText, /Data Processor/i);
  assert.match(fullText, /Right to Withdraw Consent/i);
  assert.match(fullText, /Right to Erasure/i);
  assert.match(fullText, /Grievance/i);
});

test("legal-terms: Anti-Scraping policy incorporates statutory anti-harvesting mandate", () => {
  const doc = getLegalDocument("anti_scraping");
  const fullText = doc.sections.map((s) => s.content + " " + (s.bullets ?? []).join(" ")).join(" ");

  assert.match(fullText, /scraping/i);
  assert.match(fullText, /provenance/i);
  assert.match(fullText, /₹50 Crore/i);
});
