/**
 * Lead pipeline vocabulary, shared by the client page and the server reads.
 * Pure by construction — no imports, so it is safe in either bundle.
 */
export const LEAD_STATUSES = ["new", "contacted", "demo_booked", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type Lead = {
  id: string;
  email: string;
  name: string;
  company: string;
  status: LeadStatus;
  note: string;
  marketingOptIn: boolean;
  marketingOptInAt: string | null;
  createdAt: string;
};

export type FunnelCounts = {
  orgs: number;
  signupProfile: number;
  firstRoleCreated: number;
  firstShortlistViewed: number;
  /** Founders who asked for a live shortlist on /teaser. */
  teaserShortlists: number;
  /** Founders who ran their own job description through the audit. */
  teaserJdAudits: number;
};

/**
 * A founder who asked for a public shortlist — the top of the funnel, ahead of
 * any workspace existing. `roleTitle` is joined for reading, not stored: the
 * lead has to outlive the posting it came from, so nothing here can assume the
 * role is still there.
 */
export type TeaserLead = {
  id: string;
  roleId: string;
  roleTitle: string;
  email: string;
  name: string;
  company: string;
  marketingOptIn: boolean;
  createdAt: string;
};
