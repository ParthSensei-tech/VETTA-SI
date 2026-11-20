/**
 * Personal Founder WhatsApp Intake Slug Engine
 *
 * Powers personalized hiring links (e.g. vetta.ai/f/anupam or vetta.ai/f/nexuscore)
 * that founders drop into LinkedIn hiring posts, Twitter/X bios, and WhatsApp groups.
 *
 * When an interested candidate clicks the link, it resolves the founder's active roles
 * and redirects into an interactive WhatsApp candidate intake session.
 */

import { getSql } from "../../../platform/db.ts";

export interface FounderSlugProfile {
  id: string;
  orgId: string;
  userId: string;
  slug: string;
  founderName: string;
  companyName: string;
  headline: string;
  whatsappNumber: string;
  activeRoles: Array<{
    id: string;
    title: string;
    location: string;
    experienceBand: string;
  }>;
  totalCandidatesIngested: number;
}

export interface WhatsAppIntakeUrlOptions {
  whatsappNumber: string;
  founderName: string;
  companyName: string;
  roleTitle?: string;
  candidateSource?: string;
}

/**
 * Builds the direct WhatsApp candidate intake URL with pre-filled conversational intent
 */
export function buildWhatsAppIntakeUrl(options: WhatsAppIntakeUrlOptions): string {
  const cleanNumber = options.whatsappNumber.replace(/[^0-9]/g, "");
  const defaultRole = options.roleTitle ? ` for the ${options.roleTitle} role` : "";
  const sourceTag = options.candidateSource ? ` (via ${options.candidateSource})` : "";

  const text =
    `Hi ${options.founderName || "Team"}! I saw your hiring post${sourceTag} and would like to apply${defaultRole} at ${options.companyName || "your team"}. Here is my background:`;

  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}

/**
 * Normalizes a requested vanity slug (e.g. "Anupam Sharma / NexusCore" -> "anupam-nexuscore")
 */
export function normalizeFounderSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

/**
 * Resolves a founder slug from the database
 */
export async function getFounderSlugProfile(slug: string): Promise<FounderSlugProfile | null> {
  const sql = await getSql();
  const normalized = normalizeFounderSlug(slug);

  const rows = await sql`
    select * from founder_intake_slugs
    where slug = ${normalized}
    limit 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0]!;
  let activeRoles = [];
  try {
    activeRoles = typeof row.active_roles_json === "string" ? JSON.parse(row.active_roles_json) : row.active_roles_json || [];
  } catch {
    activeRoles = [];
  }

  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    slug: String(row.slug),
    founderName: String(row.founder_name || ""),
    companyName: String(row.company_name || ""),
    headline: String(row.headline || ""),
    whatsappNumber: String(row.whatsapp_intake_number || "919999999999"),
    activeRoles,
    totalCandidatesIngested: Number(row.total_candidates_ingested || 0),
  };
}

/**
 * Upserts a founder's personal intake slug
 */
export async function registerFounderSlug(profile: {
  orgId: string;
  userId: string;
  slug: string;
  founderName: string;
  companyName: string;
  headline?: string;
  whatsappNumber: string;
  activeRoles?: Array<{ id: string; title: string; location: string; experienceBand: string }>;
}): Promise<FounderSlugProfile> {
  const sql = await getSql();
  const normalized = normalizeFounderSlug(profile.slug);
  const id = `fslug_${normalized}`;
  const rolesJson = JSON.stringify(profile.activeRoles || []);

  await sql`
    insert into founder_intake_slugs (
      id, org_id, user_id, slug, founder_name, company_name,
      headline, whatsapp_intake_number, active_roles_json,
      total_candidates_ingested, created_at, updated_at
    ) values (
      ${id}, ${profile.orgId}, ${profile.userId}, ${normalized},
      ${profile.founderName}, ${profile.companyName}, ${profile.headline || ""},
      ${profile.whatsappNumber}, ${rolesJson}, 0, now(), now()
    )
    on conflict (slug) do update set
      founder_name = excluded.founder_name,
      company_name = excluded.company_name,
      headline = excluded.headline,
      whatsapp_intake_number = excluded.whatsapp_intake_number,
      active_roles_json = excluded.active_roles_json,
      updated_at = now()
  `;

  return {
    id,
    orgId: profile.orgId,
    userId: profile.userId,
    slug: normalized,
    founderName: profile.founderName,
    companyName: profile.companyName,
    headline: profile.headline || "",
    whatsappNumber: profile.whatsappNumber,
    activeRoles: profile.activeRoles || [],
    totalCandidatesIngested: 0,
  };
}
