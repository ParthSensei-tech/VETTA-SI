/**
 * Robinhood-Style Launch Waitlist & Referral Line-Jumping Domain Types
 */

export interface LaunchWaitlistEntry {
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
  founderName: string;
  companyName: string;
  roleTitle?: string;
  referredByCode?: string | null;
}

export interface WaitlistStatusResult {
  entry: LaunchWaitlistEntry;
  totalInLine: number;
  queueAhead: number;
  spotsJumped: number;
  estimatedLaunchDate: string; // e.g. "December 10, 2026"
}

export const BASE_WAITLIST_OFFSET = 340; // Seed base offset for Robinhood momentum
export const JUMP_PER_REFERRAL = 100;
export const CREDITS_PER_REFERRAL = 5;
export const INITIAL_BONUS_CREDITS = 10;
export const LAUNCH_DATE_STR = "December 10, 2026";

/**
 * Normalizes email and enforces valid format
 */
export function normalizeWaitlistEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Generates an URL-safe referral code based on company or founder name
 */
export function generateReferralCode(companyOrName: string): string {
  const clean = companyOrName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${clean || "vetta"}_${rand}`;
}
