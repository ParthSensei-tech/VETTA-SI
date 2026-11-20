/**
 * Robinhood-Style Viral Waitlist & Referral Line-Jumping Engine
 *
 * Implements the pre-boarding acquisition engine:
 * 1. Sequential queue position calculation.
 * 2. Unique referral codes (`found_***`).
 * 3. Line-jumping: for every referred founder, jump 100 spots in line and unlock 5 bonus voice screens.
 * 4. VIP perks: Top founders unlock 1 month of free Offer Guard protection.
 */

import { randomUUID } from "node:crypto";
import { getSql } from "../../../platform/db.ts";

export interface WaitlistEntry {
  id: string;
  email: string;
  founderName: string;
  companyName: string;
  roleTitle: string;
  waitlistPosition: number;
  referralCode: string;
  referredByCode: string | null;
  referralCount: number;
  bonusCallingCredits: number;
  isActivated: boolean;
  createdAt: string;
}

export interface JoinWaitlistInput {
  email: string;
  founderName?: string;
  companyName?: string;
  roleTitle?: string;
  referredByCode?: string;
}

export interface WaitlistStatusResult {
  entry: WaitlistEntry;
  totalWaitlistCount: number;
  estimatedLaunchDate: string; // "VIP Cohort 1 (Rolling Early Access)"
  perksUnlocked: string[];
  spotsJumped: number;
}

function generateReferralCode(company: string): string {
  const cleanCompany = (company || "founder").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8);
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  return `${cleanCompany || "found"}_${randomSuffix}`;
}

/**
 * Calculates perks unlocked based on referral count
 */
export function calculateUnlockedPerks(referralCount: number): string[] {
  const perks = [
    "Permanent Free ATS with Unlimited Roles & Parsing ($0)",
    "10 Free Autonomous Hinglish Phone Screens upon Cohort 1 Activation",
  ];

  if (referralCount >= 1) {
    perks.push("Queue Line Jump: 100 Spots per referral");
  }
  if (referralCount >= 3) {
    perks.push("15 Bonus Autonomous Voice Screening Credits (Value: ₹3,000)");
  }
  if (referralCount >= 5) {
    perks.push("VIP Priority: 48-Hour Early Access for Cohort 1");
    perks.push("1 Month Free Offer Guard Pre-Boarding Protection (Value: ₹14,999)");
  }
  if (referralCount >= 10) {
    perks.push("Founding 100 Circle: Lifetime 50% Discount on GaaS Placements");
  }

  return perks;
}

/**
 * Join or retrieve existing waitlist position
 */
export async function joinLaunchWaitlist(input: JoinWaitlistInput): Promise<WaitlistStatusResult> {
  const sql = await getSql();
  const normalizedEmail = input.email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("A valid work email is required to join the VIP launch waitlist.");
  }

  // Check if email already registered
  const existingRows = await sql`
    select * from launch_waitlist where email = ${normalizedEmail} limit 1
  `;

  if (existingRows.length > 0) {
    const existing = existingRows[0]!;
    const totalCountRows = await sql`select count(*)::int as total from launch_waitlist`;
    const totalCount = Number(totalCountRows[0]?.total ?? 1);

    const entry: WaitlistEntry = {
      id: String(existing.id),
      email: String(existing.email),
      founderName: String(existing.founder_name || ""),
      companyName: String(existing.company_name || ""),
      roleTitle: String(existing.role_title || ""),
      waitlistPosition: Number(existing.waitlist_position),
      referralCode: String(existing.referral_code),
      referredByCode: existing.referred_by_code ? String(existing.referred_by_code) : null,
      referralCount: Number(existing.referral_count || 0),
      bonusCallingCredits: Number(existing.bonus_calling_credits || 10),
      isActivated: Boolean(existing.is_activated),
      createdAt: new Date(String(existing.created_at)).toISOString(),
    };

    return {
      entry,
      totalWaitlistCount: totalCount,
      estimatedLaunchDate: "VIP Cohort 1 (Rolling Early Access)",
      perksUnlocked: calculateUnlockedPerks(entry.referralCount),
      spotsJumped: entry.referralCount * 100,
    };
  }

  // Calculate next sequential position (starts at 340 for realistic pre-launch momentum)
  const countResult = await sql`select count(*)::int as total from launch_waitlist`;
  const currentCount = Number(countResult[0]?.total ?? 0);
  const basePosition = 340 + currentCount + 1;

  const id = randomUUID();
  const referralCode = generateReferralCode(input.companyName || "");
  const referredBy = input.referredByCode?.trim() || null;

  await sql`
    insert into launch_waitlist (
      id, email, founder_name, company_name, role_title,
      waitlist_position, referral_code, referred_by_code,
      referral_count, bonus_calling_credits, is_activated, created_at
    ) values (
      ${id}, ${normalizedEmail}, ${input.founderName || ""}, ${input.companyName || ""},
      ${input.roleTitle || ""}, ${basePosition}, ${referralCode}, ${referredBy},
      0, 10, false, now()
    )
  `;

  // If referred by another founder, reward the inviter with line-jump and bonus credits
  if (referredBy) {
    await sql`
      update launch_waitlist
      set
        referral_count = referral_count + 1,
        bonus_calling_credits = bonus_calling_credits + 5,
        waitlist_position = greatest(1, waitlist_position - 100)
      where referral_code = ${referredBy}
    `;
  }

  const entry: WaitlistEntry = {
    id,
    email: normalizedEmail,
    founderName: input.founderName || "",
    companyName: input.companyName || "",
    roleTitle: input.roleTitle || "",
    waitlistPosition: basePosition,
    referralCode,
    referredByCode: referredBy,
    referralCount: 0,
    bonusCallingCredits: 10,
    isActivated: false,
    createdAt: new Date().toISOString(),
  };

  return {
    entry,
    totalWaitlistCount: currentCount + 1,
    estimatedLaunchDate: "VIP Cohort 1 (Rolling Early Access)",
    perksUnlocked: calculateUnlockedPerks(0),
    spotsJumped: 0,
  };
}

/**
 * Get current waitlist status by email or referral code
 */
export async function getWaitlistStatus(emailOrCode: string): Promise<WaitlistStatusResult | null> {
  const sql = await getSql();
  const query = emailOrCode.trim().toLowerCase();

  const rows = await sql`
    select * from launch_waitlist
    where lower(email) = ${query} or lower(referral_code) = ${query}
    limit 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0]!;
  const countResult = await sql`select count(*)::int as total from launch_waitlist`;
  const totalCount = Number(countResult[0]?.total ?? 1);

  const entry: WaitlistEntry = {
    id: String(row.id),
    email: String(row.email),
    founderName: String(row.founder_name || ""),
    companyName: String(row.company_name || ""),
    roleTitle: String(row.role_title || ""),
    waitlistPosition: Number(row.waitlist_position),
    referralCode: String(row.referral_code),
    referredByCode: row.referred_by_code ? String(row.referred_by_code) : null,
    referralCount: Number(row.referral_count || 0),
    bonusCallingCredits: Number(row.bonus_calling_credits || 10),
    isActivated: Boolean(row.is_activated),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };

  return {
    entry,
    totalWaitlistCount: totalCount,
    estimatedLaunchDate: "VIP Cohort 1 (Rolling Early Access)",
    perksUnlocked: calculateUnlockedPerks(entry.referralCount),
    spotsJumped: entry.referralCount * 100,
  };
}
