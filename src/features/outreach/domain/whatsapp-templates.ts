/**
 * India-First Omnichannel Outreach Templates
 * 
 * Features:
 * - Proof-of-Work Hook: anchors on candidate's real git/code contributions
 * - Explicit Client Company Name: establishes immediate credibility over anonymous recruiter spam
 * - 1-Click Opt-Out: channels friction into a clean unsubscribe to keep WhatsApp Quality in the Green
 * - Multi-Channel Fallbacks: SMS and Email formats
 */

export interface HookParameters {
  candidateName: string;
  companyName: string;
  companyFunding?: string; // e.g. "Series A, backed by Peak XV"
  roleTitle: string;
  fixedLpa: number | string;
  proofOfWorkContext?: string; // e.g. "your open PR on the Apache Kafka Go client handling rebalances"
  applyUrl?: string;
}

/**
 * WhatsApp Primary Hook: Sent as an interactive message with Quick Reply chips
 */
export function buildProofOfWorkWhatsAppHook(params: HookParameters): {
  bodyText: string;
  quickReplyOptions: string[];
} {
  const firstName = params.candidateName.trim().split(" ")[0] || params.candidateName;
  const companyCred = params.companyFunding ? ` (${params.companyFunding})` : "";
  const proofLine = params.proofOfWorkContext
    ? `Saw ${params.proofOfWorkContext}. `
    : "Your background in high-velocity production systems caught our eye. ";

  const bodyText = [
    `Hey ${firstName},`,
    "",
    `${proofLine}We are heading talent acquisition for *${params.companyName}*${companyCred} for their *${params.roleTitle}* role (₹${params.fixedLpa} LPA fixed component).`,
    "",
    "No long recruiting loop — direct discussion with the founding engineering team.",
    "",
    "Would you be open to a quick 10-minute technical chat this week?",
  ].join("\n");

  return {
    bodyText,
    quickReplyOptions: [
      "Interested, tell me more",
      "What is the tech stack?",
      "Not looking right now",
    ],
  };
}

/**
 * SMS Fallback: Sent if WhatsApp remains unread after 6 hours
 */
export function buildSmsFallbackMessage(params: {
  candidateName: string;
  companyName: string;
  roleTitle: string;
  portalUrl: string;
}): string {
  const firstName = params.candidateName.trim().split(" ")[0] || params.candidateName;
  return `Hi ${firstName}, we sent details regarding ${params.companyName}'s ${params.roleTitle} role to your WhatsApp. Review direct founder slate: ${params.portalUrl}`;
}

/**
 * Email Official Dossier: Sent with full JD and team background
 */
export function buildEmailDossierMessage(params: HookParameters & { portalUrl: string }): {
  subject: string;
  bodyText: string;
} {
  const firstName = params.candidateName.trim().split(" ")[0] || params.candidateName;
  const subject = `Engineering at ${params.companyName} · ${params.roleTitle} (Direct Founder Slate)`;
  const bodyText = [
    `Hi ${firstName},`,
    "",
    params.proofOfWorkContext
      ? `We recently came across ${params.proofOfWorkContext} and were impressed by your work.`
      : `Your engineering background in scalable systems caught our attention.`,
    "",
    `We are partnering with the founders at ${params.companyName}${params.companyFunding ? ` (${params.companyFunding})` : ""} to hire their ${params.roleTitle}. The role carries a verified compensation band of ₹${params.fixedLpa} LPA fixed + equity.`,
    "",
    `You can inspect the full role specification and engineering team profile here:`,
    params.portalUrl,
    "",
    "If you prefer to connect directly on WhatsApp or phone, feel free to reply to this email.",
    "",
    "Best regards,",
    `Vetta Talent Partner for ${params.companyName}`,
  ].join("\n");

  return { subject, bodyText };
}

/**
 * Polite Opt-Out Confirmation
 */
export function buildOptOutConfirmationMessage(candidateName: string): string {
  const firstName = candidateName.trim().split(" ")[0] || candidateName;
  return `Understood, ${firstName}! We have updated your preferences and will not reach out again. Best of luck with your current work!`;
}
