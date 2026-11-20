import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildProofOfWorkWhatsAppHook,
  buildSmsFallbackMessage,
  buildEmailDossierMessage,
  buildOptOutConfirmationMessage,
} from "../domain/whatsapp-templates.ts";

describe("Omnichannel Outreach Engine & India Templates", () => {
  test("buildProofOfWorkWhatsAppHook explicitly includes company name and funding", () => {
    const hook = buildProofOfWorkWhatsAppHook({
      candidateName: "Rahul Sharma",
      companyName: "NexusCore",
      companyFunding: "Series A, backed by Peak XV",
      roleTitle: "Staff Go Engineer",
      fixedLpa: 45,
      proofOfWorkContext: "your open PR on the Apache Kafka Go client handling rebalances",
    });

    assert.ok(hook.bodyText.includes("Hey Rahul,"));
    assert.ok(hook.bodyText.includes("*NexusCore* (Series A, backed by Peak XV)"));
    assert.ok(hook.bodyText.includes("*Staff Go Engineer*"));
    assert.ok(hook.bodyText.includes("₹45 LPA fixed component"));
    assert.ok(hook.bodyText.includes("Apache Kafka Go client"));

    // Crucial: 1-Click Opt-Out Button must be in quick-replies to safeguard WhatsApp quality rating
    assert.ok(hook.quickReplyOptions.includes("Not looking right now"));
    assert.ok(hook.quickReplyOptions.includes("Interested, tell me more"));
  });

  test("buildSmsFallbackMessage generates concise link for unread WhatsApps", () => {
    const sms = buildSmsFallbackMessage({
      candidateName: "Priya Nair",
      companyName: "HyperScale",
      roleTitle: "Lead DevOps",
      portalUrl: "https://vetta.app/c/xyz123",
    });

    assert.ok(sms.includes("Hi Priya"));
    assert.ok(sms.includes("HyperScale's Lead DevOps"));
    assert.ok(sms.includes("https://vetta.app/c/xyz123"));
    assert.ok(sms.length <= 160); // Must fit comfortably in standard SMS 160 char limit
  });

  test("buildEmailDossierMessage formats verified compensation and spec link", () => {
    const email = buildEmailDossierMessage({
      candidateName: "Aarav Gupta",
      companyName: "DataGrid",
      companyFunding: "Seed backed by Matrix",
      roleTitle: "Distributed Systems Architect",
      fixedLpa: 55,
      portalUrl: "https://vetta.app/roles/abc",
    });

    assert.equal(
      email.subject,
      "Engineering at DataGrid · Distributed Systems Architect (Direct Founder Slate)",
    );
    assert.ok(email.bodyText.includes("₹55 LPA fixed + equity"));
    assert.ok(email.bodyText.includes("https://vetta.app/roles/abc"));
  });

  test("buildOptOutConfirmationMessage returns polite, respectful unsubscribe acknowledgment", () => {
    const confirm = buildOptOutConfirmationMessage("Vikram Singh");
    assert.ok(confirm.includes("Understood, Vikram!"));
    assert.ok(confirm.includes("will not reach out again"));
  });
});
