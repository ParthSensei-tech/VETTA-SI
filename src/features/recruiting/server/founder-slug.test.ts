import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeFounderSlug, buildWhatsAppIntakeUrl } from "./founder-slug.server.ts";

describe("Founder WhatsApp Intake Slug & Link Construction", () => {
  it("normalizes vanity slugs correctly", () => {
    assert.equal(normalizeFounderSlug("Anupam Sharma / NexusCore"), "anupam-sharma-nexuscore");
    assert.equal(normalizeFounderSlug("---Rohit__Paytm@@---"), "rohit-paytm");
    assert.equal(normalizeFounderSlug("Go_Lead_2026"), "go-lead-2026");
  });

  it("builds clean WhatsApp click-to-chat URL with role and company context", () => {
    const url = buildWhatsAppIntakeUrl({
      whatsappNumber: "+91 98765 43210",
      founderName: "Anupam",
      companyName: "NexusCore",
      roleTitle: "Lead Backend Engineer",
      candidateSource: "LinkedIn",
    });

    assert.ok(url.startsWith("https://wa.me/919876543210?text="));
    assert.ok(url.includes("Anupam"));
    assert.ok(url.includes("NexusCore"));
    assert.ok(url.includes("Lead%20Backend%20Engineer"));
    assert.ok(url.includes("LinkedIn"));
  });
});
