import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyHazardLevel,
  formatWhatsAppDailyBriefing,
} from "./daily-briefing.server.ts";

describe("09:00 AM WhatsApp Morning Executive Talent Briefing", () => {
  it("classifies hazard scores into appropriate traffic light levels", () => {
    assert.equal(classifyHazardLevel(15), "green");
    assert.equal(classifyHazardLevel(45), "amber");
    assert.equal(classifyHazardLevel(75), "red");
  });

  it("formats high-urgency WhatsApp message with hazard warning and actions", () => {
    const text = formatWhatsAppDailyBriefing({
      orgId: "org_test",
      founderName: "Anupam",
      companyName: "NexusCore",
      dateStr: "20 Nov 2026",
      activeNoticeOffers: [
        {
          candidateId: "cand_1",
          candidateName: "Rahul Sharma",
          roleTitle: "Lead Go Developer",
          offeredFixedLpa: 34,
          noticeTotalDays: 60,
          daysServed: 42,
          hazardScore: 48,
          hazardLevel: "amber",
          latestSignal: "Updated LinkedIn headline",
          recommendedAction: "Send retention nurture",
        },
      ],
      todayInterviews: [
        {
          applicationId: "app_1",
          candidateAlias: "Candidate A-101 (Vikram)",
          roleTitle: "Lead Go Developer",
          scheduledTimeStr: "02:30 PM IST",
          voiceScore: 94,
          keyTechnicalHighlight: "Explained Raft consensus",
        },
      ],
      overnightFinalists: [
        {
          applicationId: "app_2",
          candidateAlias: "Candidate A-102",
          roleTitle: "Lead Go Developer",
          matchScore: 92,
          currentCompanyTier: "Tier-1 Payments",
          yearsExperience: 5.4,
          fixedLpaExpected: 32,
        },
      ],
      totalOvernightParsed: 40,
    });

    assert.ok(text.includes("Good morning Anupam"));
    assert.ok(text.includes("OFFER GUARD & NOTICE HAZARD RADAR"));
    assert.ok(text.includes("Rahul Sharma"));
    assert.ok(text.includes("AMBER"));
    assert.ok(text.includes("TODAY'S SCHEDULED INTERVIEWS"));
    assert.ok(text.includes("Candidate A-101"));
    assert.ok(text.includes("OVERNIGHT APPLICANT TRIAGE"));
    assert.ok(text.includes("Candidate A-102"));
    assert.ok(text.includes("Reply \"CALL 1\""));
  });
});
