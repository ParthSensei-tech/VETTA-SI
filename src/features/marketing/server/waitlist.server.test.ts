import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../../platform/db.ts";
import { joinLaunchWaitlist, getWaitlistStatus } from "./waitlist.server.ts";
import { BASE_WAITLIST_OFFSET, INITIAL_BONUS_CREDITS } from "../domain/waitlist-types.ts";

describe("Robinhood-Style Launch Waitlist & Referral Engine", () => {
  before(async () => {
    const sql = await getSql();
    await sql`drop table if exists launch_waitlist`;
    await sql`
      create table if not exists launch_waitlist (
        id text primary key,
        email text not null unique,
        founder_name text not null default '',
        company_name text not null default '',
        role_title text not null default '',
        waitlist_position integer not null,
        referral_code text not null unique,
        referred_by_code text,
        referral_count integer not null default 0,
        bonus_calling_credits integer not null default 10,
        is_activated boolean not null default false,
        created_at timestamptz not null default now()
      )
    `;
  });

  after(async () => {
    const sql = await getSql();
    await sql`delete from launch_waitlist where email like '%@testwaitlist.com'`;
  });

  test("adds a new founder to waitlist with offset position and bonus credits", async () => {
    const res = await joinLaunchWaitlist({
      email: "anupam@testwaitlist.com",
      founderName: "Anupam Mittal",
      companyName: "NexusCore",
      roleTitle: "Founder & CEO",
    });

    assert.ok(res.entry.id);
    assert.equal(res.entry.email, "anupam@testwaitlist.com");
    assert.equal(res.entry.companyName, "NexusCore");
    assert.ok(res.entry.waitlistPosition >= BASE_WAITLIST_OFFSET);
    assert.equal(res.entry.bonusCallingCredits, INITIAL_BONUS_CREDITS);
    assert.equal(res.entry.referralCount, 0);
    assert.ok(res.entry.referralCode.length > 3);
  });

  test("duplicate email returns existing entry without creating duplicates", async () => {
    const res1 = await getWaitlistStatus("anupam@testwaitlist.com");
    assert.ok(res1);

    const res2 = await joinLaunchWaitlist({
      email: "anupam@testwaitlist.com",
      founderName: "Anupam Mittal Duplicate",
      companyName: "NexusCore",
    });

    assert.equal(res1.entry.id, res2.entry.id);
    assert.equal(res1.entry.waitlistPosition, res2.entry.waitlistPosition);
  });

  test("referral link jump: referring a new founder jumps inviter 100 spots and awards 5 credits", async () => {
    const inviter = await getWaitlistStatus("anupam@testwaitlist.com");
    assert.ok(inviter);
    const initialPos = inviter.entry.waitlistPosition;
    const initialCredits = inviter.entry.bonusCallingCredits;

    // Second founder joins with inviter's referral code
    const res2 = await joinLaunchWaitlist({
      email: "rohan@testwaitlist.com",
      founderName: "Rohan Varma",
      companyName: "FintechAlpha",
      referredByCode: inviter.entry.referralCode,
    });

    assert.equal(res2.entry.referredByCode, inviter.entry.referralCode);

    // Verify inviter jumped spots
    const updatedInviter = await getWaitlistStatus("anupam@testwaitlist.com");
    assert.ok(updatedInviter);
    assert.equal(updatedInviter.entry.referralCount, 1);
    assert.equal(updatedInviter.entry.bonusCallingCredits, initialCredits + 5);
    assert.equal(updatedInviter.entry.waitlistPosition, Math.max(1, initialPos - 100));
    assert.equal(updatedInviter.spotsJumped, 100);
  });
});
