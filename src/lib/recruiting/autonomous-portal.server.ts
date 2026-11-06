import { randomUUID } from "node:crypto";
import type {
  AutonomousPortal,
  HitlCheckpointType,
  HitlDecision,
  HitlDecisionStatus,
  HitlPolicy,
  PortalIntakeSession,
  RequirementEvaluation,
  AtsWebhookPayload,
} from "./types.ts";
import { getSql } from "../db.ts";
import { matchCandidateToRole } from "./match-engine.ts";
import { parseJson } from "../utils.ts";

// ============================================================================
// 1. ADVANCED DATA STRUCTURE: Aho-Corasick / Trie for Fast Stack Dictionary
// ============================================================================

export class TrieNode {
  children = new Map<string, TrieNode>();
  isWord = false;
  canonicalSkill: string | null = null;
}

export class SkillTrie {
  root = new TrieNode();

  insert(phrase: string, canonical: string): void {
    let curr = this.root;
    const lower = phrase.toLowerCase().trim();
    for (const char of lower) {
      if (!curr.children.has(char)) {
        curr.children.set(char, new TrieNode());
      }
      curr = curr.children.get(char)!;
    }
    curr.isWord = true;
    curr.canonicalSkill = canonical;
  }

  /**
   * Fast O(N) multi-pattern text search over candidate resume text.
   */
  search(text: string): Map<string, number> {
    const hits = new Map<string, number>();
    const lower = text.toLowerCase();
    const len = lower.length;

    for (let i = 0; i < len; i++) {
      let curr = this.root;
      let j = i;
      while (j < len && curr.children.has(lower[j])) {
        curr = curr.children.get(lower[j])!;
        if (curr.isWord && curr.canonicalSkill) {
          // Boundary check: ensure it's not a substring of an unrelated token
          const prevChar = i > 0 ? lower[i - 1] : " ";
          const nextChar = j + 1 < len ? lower[j + 1] : " ";
          const isWordBoundary = /[^a-z0-9+#]/.test(prevChar) && /[^a-z0-9+#]/.test(nextChar);
          if (isWordBoundary) {
            hits.set(curr.canonicalSkill, (hits.get(curr.canonicalSkill) || 0) + 1);
          }
        }
        j++;
      }
    }
    return hits;
  }
}

// Built-in high-value technology dictionary
export function buildTechTrie(extraSkills: string[] = []): SkillTrie {
  const trie = new SkillTrie();
  const defaultSkills = [
    "react",
    "react.js",
    "react native",
    "next.js",
    "vue",
    "vue.js",
    "angular",
    "typescript",
    "javascript",
    "node",
    "node.js",
    "python",
    "golang",
    "go",
    "rust",
    "java",
    "spring boot",
    "c++",
    "c#",
    ".net",
    "postgresql",
    "postgres",
    "mysql",
    "redis",
    "mongodb",
    "kafka",
    "apache kafka",
    "rabbitmq",
    "aws",
    "gcp",
    "azure",
    "docker",
    "kubernetes",
    "k8s",
    "terraform",
    "graphql",
    "rest api",
    "grpc",
    "ci/cd",
    "github actions",
    "distributed systems",
  ];

  for (const s of [...defaultSkills, ...extraSkills]) {
    trie.insert(s, s.toLowerCase());
  }
  return trie;
}

// ============================================================================
// 2. CLIENT HELPING STEPS & CONNECTION KNOWLEDGE BASE
// ============================================================================

export type ClientOptionGuide = {
  id: string;
  title: string;
  badge: string;
  description: string;
  tradeOffs: { pros: string[]; cons: string[] };
  steps: Array<{ stepNumber: number; instruction: string; detail: string }>;
  recommendedSettings: Record<string, string>;
  copySnippet?: { label: string; language: string; code: string };
};

export const CLIENT_HELPING_STEPS: Record<string, ClientOptionGuide> = {
  career_portal: {
    id: "career_portal",
    title: "Branded Autonomous Career Portal",
    badge: "Recommended · 2 Min Setup",
    description:
      "Launch a standalone, high-conversion career portal hosted on your custom slug with AI-assisted resume extraction and candidate intake.",
    tradeOffs: {
      pros: [
        "Zero engineering required",
        "Direct candidate missing-info intake",
        "Live real-time match feedback",
      ],
      cons: ["Hosted on portal slug rather than your primary root domain"],
    },
    steps: [
      {
        stepNumber: 1,
        instruction: "Claim Your Company Subpath Slug",
        detail:
          "Choose a memorable slug (e.g. acme or hypergrowth). Your live careers link will immediately be active at /portal/[slug].",
      },
      {
        stepNumber: 2,
        instruction: "Brand Your Portal",
        detail:
          "Upload company logo and set brand primary color to ensure consistent candidate trust.",
      },
      {
        stepNumber: 3,
        instruction: "Publish Open Roles",
        detail:
          "Mark active roles as 'open'. Candidates can apply immediately with drag-and-drop resume upload.",
      },
    ],
    recommendedSettings: {
      slug: "company-name",
      tier: "premium",
      hitlPolicy: "strict",
      interactiveIntake: "enabled",
    },
  },

  embed_widget: {
    id: "embed_widget",
    title: "Embeddable Career Widget / iFrame",
    badge: "No-Code Embed",
    description:
      "Drop a single responsive iframe or script snippet directly into your existing Webflow, Framer, WordPress, or React website.",
    tradeOffs: {
      pros: [
        "Keeps traffic on your company website",
        "Auto-resizing & zero CSS clash",
        "Works on any CMS",
      ],
      cons: ["Requires access to edit your company website HTML/CMS"],
    },
    steps: [
      {
        stepNumber: 1,
        instruction: "Copy the Embed Code Snippet",
        detail:
          "Copy the provided iframe snippet with pre-configured responsive boundaries and secure sandbox attributes.",
      },
      {
        stepNumber: 2,
        instruction: "Paste into Your Website's Careers Page",
        detail:
          "Open your CMS (Webflow, WordPress, Squarespace) and paste the code into an HTML Embed block.",
      },
      {
        stepNumber: 3,
        instruction: "Verify Responsive Mobile Layout",
        detail:
          "Test on mobile and desktop. The widget dynamically adapts height to avoid awkward scrollbars.",
      },
    ],
    recommendedSettings: {
      width: "100%",
      minHeight: "680px",
      border: "none",
    },
    copySnippet: {
      label: "Responsive Embed Snippet",
      language: "html",
      code: `<iframe src="{PORTAL_URL}?embed=true" width="100%" height="720px" frameborder="0" style="border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);" allow="clipboard-write"></iframe>`,
    },
  },

  ats_webhook: {
    id: "ats_webhook",
    title: "Legacy ATS Webhook Relay (Workday, Taleo, Greenhouse, Lever)",
    badge: "Enterprise Upgrade",
    description:
      "Keep your existing legacy ATS (Workday, Taleo, etc.) while routing incoming applicants through our agentic multi-stage retrieval and evidence grounding engine.",
    tradeOffs: {
      pros: [
        "No need to replace existing HR procurement contracts",
        "Eliminates keyword-parsing rejection errors",
        "Instant shortlist delivery to recruiter inbox",
      ],
      cons: ["Requires ATS Admin to add webhook URL and Secret"],
    },
    steps: [
      {
        stepNumber: 1,
        instruction: "Generate Webhook Secret",
        detail:
          "Click 'Generate Webhook Key'. This HMAC secret ensures all relayed applicants are cryptographically verified.",
      },
      {
        stepNumber: 2,
        instruction: "Configure Webhook in Workday / Taleo",
        detail:
          "Navigate to your ATS Admin Console > Integrations > Webhooks. Add Payload URL and select 'Application Created' event.",
      },
      {
        stepNumber: 3,
        instruction: "Send Test Ping",
        detail:
          "Click 'Verify Connection' to simulate an incoming candidate and confirm multi-stage retrieval scoring.",
      },
    ],
    recommendedSettings: {
      eventSubscription: "candidate.created, application.submitted",
      timeoutSeconds: "15",
      retryCount: "3",
    },
    copySnippet: {
      label: "Webhook Payload URL",
      language: "text",
      code: "{WEBHOOK_RELAY_URL}",
    },
  },

  direct_drop: {
    id: "direct_drop",
    title: "Direct Autonomous Folder Drop / Forwarding",
    badge: "Freemium & Premium Active",
    description:
      "Drop batches of resumes (PDF, DOCX) directly into the desk or forward recruiter emails to auto-parse and queue.",
    tradeOffs: {
      pros: [
        "Instant manual drop without portal setup",
        "Full support in Freemium tier",
        "Parallel batch parsing in NightQueue",
      ],
      cons: ["Requires manual file selection rather than candidate self-service"],
    },
    steps: [
      {
        stepNumber: 1,
        instruction: "Select Role",
        detail: "Choose the role you want to populate with candidates from your Desk.",
      },
      {
        stepNumber: 2,
        instruction: "Drop Files or Paste Text",
        detail:
          "Drag up to 50 resumes at once. The system parses names, contacts, and experience vectors automatically.",
      },
      {
        stepNumber: 3,
        instruction: "Review High-Confidence Shortlists",
        detail:
          "Watch real-time evidence-grounded scoring rank candidates into Strong Yes, Yes, Maybe, and No.",
      },
    ],
    recommendedSettings: {
      batchSize: "20-50",
      autoRerank: "enabled",
    },
  },
};

// ============================================================================
// 3. AUTONOMOUS INTERACTIVE INTAKE (MISSING INFO PROBING)
// ============================================================================

export type IntakeProbe = {
  id: string;
  field: string;
  prompt: string;
  explanation: string;
  required: boolean;
};

/**
 * Evaluates missing requirements and crafts personalized interactive probes.
 */
export function generateInteractiveProbes(requirements: RequirementEvaluation[]): IntakeProbe[] {
  const probes: IntakeProbe[] = [];
  const missing = requirements.filter((r) => r.status === "missing_info");

  for (const item of missing.slice(0, 4)) {
    const reqLower = item.requirement.toLowerCase();

    if (reqLower.includes("notice")) {
      probes.push({
        id: "probe_notice_period",
        field: "notice_period_days",
        prompt:
          "What is your official or negotiable notice period (in days)? Can your notice period be bought out if an offer is extended?",
        explanation:
          "Notice period was unstated on your CV. Early-stage startups prioritize swift start dates.",
        required: true,
      });
    } else if (reqLower.includes("compensation") || reqLower.includes("ctc")) {
      probes.push({
        id: "probe_expected_ctc",
        field: "expected_ctc_lakh",
        prompt: "What is your expected annual compensation (fixed + variable in LPA)?",
        explanation:
          "Compensation expectation was not specified on your CV. We verify alignment before scheduling interviews.",
        required: true,
      });
    } else if (reqLower.includes("location") || reqLower.includes("city")) {
      probes.push({
        id: "probe_location_relocation",
        field: "location_fit",
        prompt:
          "Are you currently based in the role's target city, or open to full relocation / in-office schedule?",
        explanation: "Role location requirement needs confirmation.",
        required: true,
      });
    } else {
      probes.push({
        id: `probe_${item.requirement.slice(0, 15).replace(/\W+/g, "_")}`,
        field: "technical_depth",
        prompt: `How much hands-on production experience do you have with ${item.requirement}? Could you briefly share a representative project?`,
        explanation: `${item.requirement} is a core requirement for this position and wasn't explicit on your resume.`,
        required: false,
      });
    }
  }

  return probes;
}

// ============================================================================
// 4. STRICT HUMAN-IN-THE-LOOP (HITL) DECISION ENGINE
// ============================================================================

export async function createHitlCheckpoint(opts: {
  orgId: string;
  roleId: string;
  applicationId?: string | null;
  portalId?: string | null;
  checkpointType: HitlCheckpointType;
  candidateName: string;
  roleTitle: string;
  aiRecommendation: "advance" | "probe" | "reject" | "calibrate";
  aiScore?: number | null;
  aiFitLevel?: string | null;
  aiConfidence?: number;
  evidenceSummary: string;
  missingRequirements?: string[];
  probeQuestions?: string[];
}): Promise<string> {
  const sql = await getSql();
  const id = randomUUID();

  await sql`
    insert into hitl_decisions (
      id, org_id, role_id, application_id, portal_id,
      checkpoint_type, status, candidate_name, role_title,
      ai_recommendation, ai_score, ai_fit_level, ai_confidence,
      evidence_summary, missing_requirements_json, probe_questions_json,
      candidate_responses_json, calibration_delta_json, created_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.roleId}, ${opts.applicationId ?? null}, ${opts.portalId ?? null},
      ${opts.checkpointType}, 'pending', ${opts.candidateName}, ${opts.roleTitle},
      ${opts.aiRecommendation}, ${opts.aiScore ?? null}, ${opts.aiFitLevel ?? null}, ${opts.aiConfidence ?? 0.85},
      ${opts.evidenceSummary}, ${JSON.stringify(opts.missingRequirements || [])}, ${JSON.stringify(opts.probeQuestions || [])},
      '[]', '{}', now()
    )
  `;

  return id;
}

export async function loadHitlCheckpoints(opts: {
  orgId: string;
  status?: HitlDecisionStatus;
  checkpointType?: HitlCheckpointType;
  roleId?: string;
  limit?: number;
}): Promise<HitlDecision[]> {
  const sql = await getSql();
  const limit = opts.limit || 50;

  let rows: Array<Record<string, unknown>>;
  if (opts.status && opts.checkpointType) {
    rows = await sql`
      select * from hitl_decisions
      where org_id = ${opts.orgId}
        and status = ${opts.status}
        and checkpoint_type = ${opts.checkpointType}
      order by created_at desc
      limit ${limit}
    `;
  } else if (opts.status) {
    rows = await sql`
      select * from hitl_decisions
      where org_id = ${opts.orgId}
        and status = ${opts.status}
      order by created_at desc
      limit ${limit}
    `;
  } else {
    rows = await sql`
      select * from hitl_decisions
      where org_id = ${opts.orgId}
      order by created_at desc
      limit ${limit}
    `;
  }

  return rows.map((r) => ({
    id: String(r.id),
    orgId: String(r.orgId || r.org_id),
    roleId: String(r.roleId || r.role_id),
    applicationId:
      r.applicationId || r.application_id ? String(r.applicationId || r.application_id) : null,
    portalId: r.portalId || r.portal_id ? String(r.portalId || r.portal_id) : null,
    checkpointType: String(r.checkpointType || r.checkpoint_type) as HitlCheckpointType,
    status: String(r.status) as HitlDecisionStatus,
    candidateName: String(r.candidateName || r.candidate_name || "Applicant"),
    roleTitle: String(r.roleTitle || r.role_title || "Open Role"),
    aiRecommendation: String(
      r.aiRecommendation || r.ai_recommendation,
    ) as HitlDecision["aiRecommendation"],
    aiScore:
      typeof r.aiScore === "number"
        ? r.aiScore
        : typeof r.ai_score === "number"
          ? r.ai_score
          : null,
    aiFitLevel: r.aiFitLevel || r.ai_fit_level ? String(r.aiFitLevel || r.ai_fit_level) : null,
    aiConfidence: Number(r.aiConfidence || r.ai_confidence || 0.8),
    evidenceSummary: String(r.evidenceSummary || r.evidence_summary || ""),
    missingRequirements: parseJson<string[]>(
      String(r.missingRequirementsJson || r.missing_requirements_json || "[]"),
      [],
    ),
    probeQuestions: parseJson<string[]>(
      String(r.probeQuestionsJson || r.probe_questions_json || "[]"),
      [],
    ),
    candidateResponses: parseJson<
      Array<{ question: string; answer: string; submittedAt?: string }>
    >(String(r.candidateResponsesJson || r.candidate_responses_json || "[]"), []),
    reviewerId: r.reviewerId || r.reviewer_id ? String(r.reviewerId || r.reviewer_id) : null,
    reviewerDecision:
      r.reviewerDecision || r.reviewer_decision
        ? String(r.reviewerDecision || r.reviewer_decision)
        : null,
    reviewerNotes: String(r.reviewerNotes || r.reviewer_notes || ""),
    calibrationDelta: parseJson<Record<string, string | number | boolean | null>>(
      String(r.calibrationDeltaJson || r.calibration_delta_json || "{}"),
      {},
    ),
    decidedAt:
      r.decidedAt || r.decided_at
        ? new Date(String(r.decidedAt || r.decided_at)).toISOString()
        : null,
    createdAt: new Date(String(r.createdAt || r.created_at)).toISOString(),
  }));
}

export async function decideHitlCheckpoint(opts: {
  checkpointId: string;
  reviewerId: string;
  decision: "approved" | "rejected" | "clarification_requested";
  reviewerNotes: string;
  calibrationDelta?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: HitlDecisionStatus }> {
  const sql = await getSql();

  const [row] = await sql`
    select * from hitl_decisions where id = ${opts.checkpointId} limit 1
  `;
  if (!row) throw new Error("Checkpoint not found");

  const newStatus: HitlDecisionStatus = opts.decision;

  await sql`
    update hitl_decisions
    set
      status = ${newStatus},
      reviewer_id = ${opts.reviewerId},
      reviewer_decision = ${opts.decision},
      reviewer_notes = ${opts.reviewerNotes},
      calibration_delta_json = ${JSON.stringify(opts.calibrationDelta || {})},
      decided_at = now()
    where id = ${opts.checkpointId}
  `;

  // Update application pipeline status according to human decision
  const appId = row.application_id || row.applicationId;
  if (appId) {
    if (opts.decision === "approved") {
      const checkpointType = String(row.checkpoint_type || row.checkpointType);
      const targetStatus = checkpointType === "shortlist_interview" ? "shortlisted" : "reviewed";
      await sql`
        update applications
        set pipeline_status = ${targetStatus}, updated_at = now()
        where id = ${appId}
      `;
    } else if (opts.decision === "rejected") {
      await sql`
        update applications
        set pipeline_status = 'rejected', updated_at = now()
        where id = ${appId}
      `;
    }
  }

  return { ok: true, status: newStatus };
}

// ============================================================================
// 5. AUTONOMOUS PORTAL CONFIGURATION & ATS WEBHOOK INGESTION
// ============================================================================

export async function ensureAutonomousPortal(opts: {
  orgId: string;
  defaultSlug: string;
  defaultName: string;
}): Promise<AutonomousPortal> {
  const sql = await getSql();

  const [existing] = await sql`
    select * from autonomous_portals where org_id = ${opts.orgId} limit 1
  `;
  if (existing) {
    return formatPortalRow(existing);
  }

  const id = randomUUID();
  const webhookSecret = `whsec_${randomUUID().replace(/-/g, "")}`;
  const slug = opts.defaultSlug
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 40);

  await sql`
    insert into autonomous_portals (
      id, org_id, slug, portal_name, headline, description,
      tier, hitl_policy, auto_shortlist_threshold, require_human_rejection,
      require_rubric_approval, interactive_intake_enabled, webhook_secret,
      connected_ats, channels_json, branding_json, is_active, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${slug}, ${opts.defaultName},
      'Join Our Team & Build the Future',
      'Autonomous career portal backed by agentic multi-stage retrieval with human review at every stage.',
      'premium', 'strict', 78, true, true, true, ${webhookSecret},
      'none',
      '{"career_portal": true, "embed_widget": true, "ats_webhook": true, "direct_drop": true}',
      '{"primaryColor": "#2563EB", "accentColor": "#38BDF8", "theme": "system"}',
      true, now(), now()
    )
  `;

  const [created] = await sql`select * from autonomous_portals where id = ${id} limit 1`;
  return formatPortalRow(created);
}

export async function getAutonomousPortalBySlug(slug: string): Promise<AutonomousPortal | null> {
  const sql = await getSql();
  const [row] = await sql`
    select * from autonomous_portals
    where slug = ${slug.toLowerCase()} and is_active = true
    limit 1
  `;
  if (!row) return null;
  return formatPortalRow(row);
}

export async function updateAutonomousPortal(
  portalId: string,
  updates: Partial<AutonomousPortal>,
): Promise<AutonomousPortal> {
  const sql = await getSql();

  const [existing] = await sql`select * from autonomous_portals where id = ${portalId} limit 1`;
  if (!existing) throw new Error("Portal not found");

  const slug = updates.slug
    ? updates.slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
    : existing.slug;
  const name = updates.portalName ?? existing.portal_name ?? existing.portalName;
  const headline = updates.headline ?? existing.headline;
  const description = updates.description ?? existing.description;
  const tier = updates.tier ?? existing.tier ?? "premium";
  const hitlPolicy = updates.hitlPolicy ?? existing.hitl_policy ?? "strict";
  const threshold = updates.autoShortlistThreshold ?? existing.auto_shortlist_threshold ?? 78;
  const requireRejection =
    updates.requireHumanRejection ?? existing.require_human_rejection ?? true;
  const interactiveIntake =
    updates.interactiveIntakeEnabled ?? existing.interactive_intake_enabled ?? true;
  const connectedAts = updates.connectedAts ?? existing.connected_ats ?? "none";
  const channels = updates.channels ? JSON.stringify(updates.channels) : existing.channels_json;
  const branding = updates.branding ? JSON.stringify(updates.branding) : existing.branding_json;

  await sql`
    update autonomous_portals
    set
      slug = ${slug},
      portal_name = ${name},
      headline = ${headline},
      description = ${description},
      tier = ${tier},
      hitl_policy = ${hitlPolicy},
      auto_shortlist_threshold = ${threshold},
      require_human_rejection = ${requireRejection},
      interactive_intake_enabled = ${interactiveIntake},
      connected_ats = ${connectedAts},
      channels_json = ${channels},
      branding_json = ${branding},
      updated_at = now()
    where id = ${portalId}
  `;

  const [updated] = await sql`select * from autonomous_portals where id = ${portalId} limit 1`;
  return formatPortalRow(updated);
}

export function formatPortalRow(r: Record<string, unknown>): AutonomousPortal {
  return {
    id: String(r.id),
    orgId: String(r.orgId || r.org_id),
    slug: String(r.slug),
    portalName: String(r.portalName || r.portal_name || "Career Portal"),
    headline: String(r.headline || ""),
    description: String(r.description || ""),
    tier: (r.tier as "freemium" | "premium") || "premium",
    hitlPolicy: ((r.hitlPolicy || r.hitl_policy) as HitlPolicy) || "strict",
    autoShortlistThreshold: Number(r.autoShortlistThreshold || r.auto_shortlist_threshold || 78),
    requireHumanRejection: Boolean(r.requireHumanRejection ?? r.require_human_rejection ?? true),
    requireRubricApproval: Boolean(r.requireRubricApproval ?? r.require_rubric_approval ?? true),
    interactiveIntakeEnabled: Boolean(
      r.interactiveIntakeEnabled ?? r.interactive_intake_enabled ?? true,
    ),
    webhookSecret: String(r.webhookSecret || r.webhook_secret || ""),
    connectedAts:
      ((r.connectedAts || r.connected_ats) as AutonomousPortal["connectedAts"]) || "none",
    channels: parseJson(String(r.channelsJson || r.channels_json || "{}"), {
      careerPortal: true,
      embedWidget: true,
      atsWebhook: true,
      directDrop: true,
    }),
    branding: parseJson(String(r.brandingJson || r.branding_json || "{}"), {
      primaryColor: "#2563EB",
      accentColor: "#38BDF8",
      theme: "system",
    }),
    isActive: Boolean(r.isActive ?? r.is_active ?? true),
    createdAt: new Date(String(r.createdAt || r.created_at)).toISOString(),
    updatedAt: new Date(String(r.updatedAt || r.updated_at)).toISOString(),
  };
}

// ============================================================================
// 6. ATS WEBHOOK RELAY PROCESSOR (WORKDAY, TALEO, GREENHOUSE, LEVER)
// ============================================================================

export async function processAtsWebhookIngestion(opts: {
  portalId: string;
  payload: AtsWebhookPayload;
}): Promise<{
  ok: boolean;
  applicationId: string;
  candidateName: string;
  score: number;
  fitLevel: string;
  checkpointCreated: boolean;
}> {
  const sql = await getSql();

  const [portalRow] = await sql`
    select * from autonomous_portals where id = ${opts.portalId} limit 1
  `;
  if (!portalRow) throw new Error("Autonomous portal not found");
  const portal = formatPortalRow(portalRow);

  // Find target role
  let roleId = opts.payload.job.roleId;
  if (!roleId && opts.payload.job.title) {
    const [matchingRole] = await sql`
      select id from roles
      where org_id = ${portal.orgId}
        and lower(title) = lower(${opts.payload.job.title})
        and status = 'open'
      limit 1
    `;
    if (matchingRole) roleId = String(matchingRole.id);
  }

  if (!roleId) {
    const [fallbackRole] = await sql`
      select id from roles where org_id = ${portal.orgId} and status = 'open' order by created_at desc limit 1
    `;
    if (!fallbackRole)
      throw new Error("No open role found in organization to match candidate against");
    roleId = String(fallbackRole.id);
  }

  // Load role details
  const [roleRow] = await sql`select * from roles where id = ${roleId} limit 1`;
  if (!roleRow) throw new Error("Role record not found");

  const roleInput = {
    companyName: String(roleRow.company_name || roleRow.companyName || "Company"),
    companyStage: String(roleRow.company_stage || roleRow.companyStage || "seed"),
    title: String(roleRow.title),
    location: String(roleRow.location || ""),
    workMode: String(roleRow.work_mode || "hybrid"),
    employmentType: String(roleRow.employment_type || "full_time"),
    compensationBand: String(roleRow.compensation_band || ""),
    stack: parseJson<string[]>(String(roleRow.stack || "[]"), []),
    mustHaves: parseJson<string[]>(String(roleRow.must_haves || "[]"), []),
    niceToHaves: parseJson<string[]>(String(roleRow.nice_to_haves || "[]"), []),
    jdText: String(roleRow.jd_text || ""),
  };

  // Run multi-stage retrieval & evidence-grounded match
  const matchResult = matchCandidateToRole({
    resumeText: opts.payload.candidate.resumeText,
    role: roleInput,
  });

  const { profile, rank } = matchResult;
  const candidateId = randomUUID();
  const applicationId = randomUUID();

  // Create candidate
  await sql`
    insert into candidates (
      id, user_id, org_id, full_name, email, phone, location,
      linkedin_url, current_title, current_company, years_experience,
      resume_text, parsed_json, created_at, updated_at
    ) values (
      ${candidateId}, ${portal.orgId}, ${portal.orgId},
      ${opts.payload.candidate.name || profile.full_name},
      ${opts.payload.candidate.email || profile.email},
      ${opts.payload.candidate.phone || profile.phone},
      ${opts.payload.candidate.location || profile.location},
      ${opts.payload.candidate.linkedinUrl || profile.linkedin_url},
      ${profile.current_title}, ${profile.current_company}, ${profile.years_experience},
      ${opts.payload.candidate.resumeText}, ${JSON.stringify(profile)}, now(), now()
    )
  `;

  // Create application
  await sql`
    insert into applications (
      id, user_id, org_id, role_id, candidate_id, pipeline_status,
      rank_score, rank_json, source, recruiter_notes, created_at, updated_at
    ) values (
      ${applicationId}, ${portal.orgId}, ${portal.orgId}, ${roleId}, ${candidateId},
      'ingested', ${rank.score}, ${JSON.stringify(rank)}, ${`ats_${opts.payload.ats}`},
      ${`Ingested from ${opts.payload.ats.toUpperCase()} via Autonomous Ingestion Engine.`},
      now(), now()
    )
  `;

  // Evaluate strict HITL checkpoints
  let checkpointCreated = false;
  const missingRequirements = rank.requirements?.filter((r) => r.status === "missing_info") || [];

  if (portal.hitlPolicy === "strict" || portal.hitlPolicy === "balanced") {
    if (rank.score >= portal.autoShortlistThreshold && rank.level !== "no") {
      // Shortlist Interview Checkpoint
      await createHitlCheckpoint({
        orgId: portal.orgId,
        roleId,
        applicationId,
        portalId: portal.id,
        checkpointType: "shortlist_interview",
        candidateName: profile.full_name,
        roleTitle: roleInput.title,
        aiRecommendation: "advance",
        aiScore: rank.score,
        aiFitLevel: rank.level,
        evidenceSummary: rank.summary,
        missingRequirements: missingRequirements.map((m) => m.requirement),
      });
      checkpointCreated = true;
    } else if (missingRequirements.length > 0) {
      // Missing Information Probe Checkpoint
      const probes = generateInteractiveProbes(rank.requirements || []);
      await createHitlCheckpoint({
        orgId: portal.orgId,
        roleId,
        applicationId,
        portalId: portal.id,
        checkpointType: "missing_info_probe",
        candidateName: profile.full_name,
        roleTitle: roleInput.title,
        aiRecommendation: "probe",
        aiScore: rank.score,
        aiFitLevel: rank.level,
        evidenceSummary: `Candidate has ${missingRequirements.length} unstated requirements that require intake clarification.`,
        missingRequirements: missingRequirements.map((m) => m.requirement),
        probeQuestions: probes.map((p) => p.prompt),
      });
      checkpointCreated = true;
    } else if (portal.requireHumanRejection && rank.level === "no") {
      // Rejection Safeguard Checkpoint
      await createHitlCheckpoint({
        orgId: portal.orgId,
        roleId,
        applicationId,
        portalId: portal.id,
        checkpointType: "candidate_rejection",
        candidateName: profile.full_name,
        roleTitle: roleInput.title,
        aiRecommendation: "reject",
        aiScore: rank.score,
        aiFitLevel: rank.level,
        evidenceSummary: rank.summary,
        missingRequirements: rank.gaps,
      });
      checkpointCreated = true;
    }
  }

  return {
    ok: true,
    applicationId,
    candidateName: profile.full_name,
    score: rank.score,
    fitLevel: rank.level,
    checkpointCreated,
  };
}
