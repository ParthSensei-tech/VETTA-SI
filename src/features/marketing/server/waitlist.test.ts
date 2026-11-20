import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateUnlockedPerks } from "./waitlist.server.ts";

describe("Robinhood Waitlist Perk Calculation", () => {
  it("entitles default 10 credits and free ATS for zero referrals", () => {
    const perks = calculateUnlockedPerks(0);
    assert.equal(perks.length, 2);
    assert.ok(perks.some((p) => p.includes("Free ATS")));
    assert.ok(perks.some((p) => p.includes("10 Free Autonomous")));
  });

  it("unlocks 100 spot jump upon 1 referral", () => {
    const perks = calculateUnlockedPerks(1);
    assert.ok(perks.some((p) => p.includes("100 Spots")));
  });

  it("unlocks 15 bonus voice credits upon 3 referrals", () => {
    const perks = calculateUnlockedPerks(3);
    assert.ok(perks.some((p) => p.includes("15 Bonus Autonomous Voice")));
  });

  it("unlocks 1 Month Free Offer Guard upon 5 referrals", () => {
    const perks = calculateUnlockedPerks(5);
    assert.ok(perks.some((p) => p.includes("Offer Guard Pre-Boarding")));
    assert.ok(perks.some((p) => p.includes("VIP Priority")));
  });

  it("unlocks Founding 100 Circle upon 10 referrals", () => {
    const perks = calculateUnlockedPerks(10);
    assert.ok(perks.some((p) => p.includes("Founding 100 Circle")));
  });
});
