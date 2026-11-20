/**
 * Teaser vocabulary shared by the public page, the server reads and the tests.
 * Pure by construction — no imports, so it is safe in either bundle.
 *
 * The two states that are not a shortlist get their copy here rather than in
 * JSX, because the reason a teaser is withheld is a privacy promise, and a
 * promise worded three ways in three components is a promise nobody can audit.
 */

export type TeaserRole = {
  id: string;
  title: string;
  companyName: string;
  companyStage: string;
  location: string;
  workMode: string;
  employmentType: string;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  postedAt: string;
};

export type TeaserBoardEntry = {
  id: string;
  title: string;
  companyName: string;
  location: string;
  workMode: string;
  compensationBand: string;
  postedAt: string;
};

export type TeaserRowView = {
  handle: string;
  seniority: string;
  region: string;
  experience: string;
  score: number | null;
  level: "strong_yes" | "yes" | "maybe" | "no" | null;
  bullets: string[];
  probe: string | null;
};

export type TeaserResult =
  | {
      state: "ready";
      role: TeaserRole;
      unlocked: boolean;
      depth: "preview" | "full";
      rows: TeaserRowView[];
      shortlistSize: number;
      hiddenRows: number;
      minCohort: number;
      builtAt: string;
    }
  | { state: "not_open"; message: string }
  | { state: "below_floor"; message: string };

export type TeaserUnlockInput = {
  /** "" for a JD audit — nothing is live yet, so there is no role to attach it to. */
  roleId: string;
  email: string;
  name: string;
  company: string;
  marketingOptIn: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  initialReferrer?: string;
};

export const TEASER_NOT_OPEN_MESSAGE =
  "This role is closed, so its shortlist is no longer published here.";

export function teaserFloorMessage(minCohort: number): string {
  return `Vetta does not publish a shortlist below ${minCohort} candidates. At three or four, a masked row is still a person — so the honest answer is nothing at all.`;
}

export const TEASER_FLOOR_MESSAGE = teaserFloorMessage(5);

export const TEASER_PRIVACY_NOTE =
  "What a teaser shows: how Vetta ranked the role, in the company's own words. What it never shows: a name, a city, an employer, a phone number, or a line copied out of someone's resume. Every row here is a person who consented to their application being shared outside the workspace that hired for it.";

export const UNLOCK_ASK = "Send me the full shortlist";
