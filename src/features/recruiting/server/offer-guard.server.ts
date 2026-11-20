import { getSql } from "../../../platform/db.ts";
import { SUCCESS_FEE_PAISE } from "../../billing/domain/razorpay.ts";
import type {
  BaselineHazardParams,
  HazardAssessment,
  IntentState,
  OfferGuardDashboard,
  OfferResolution,
  PlaybookKey,
  PreboardingIntervention,
  PreboardingOffer,
  PreboardingSignal,
  RiskTier,
  SignalType,
  TelemetrySnapshot,
} from "../domain/types.ts";
import {
  calculateFullHazardAssessment,
  classifyRiskTier,
  computeBaselineHazard,
} from "../domain/offer-guard-hazard.ts";

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Format helper for ISO dates.
 */
function toIso(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString();
  return typeof d === "string" ? d : d.toISOString();
}

/**
 * Maps raw database row to PreboardingOffer domain model.
 */
function mapOfferRow(row: any): PreboardingOffer {
  const offerAcceptedDate = toIso(row.offer_accepted_date);
  const targetJoiningDate = toIso(row.target_joining_date);

  const acceptedMs = new Date(offerAcceptedDate).getTime();
  const joiningMs = new Date(targetJoiningDate).getTime();
  const nowMs = Date.now();

  const totalNoticeDays = Number(row.total_notice_days) || Math.max(1, Math.round((joiningMs - acceptedMs) / (1000 * 60 * 60 * 24)));
  const daysServed = Math.max(0, Math.round((nowMs - acceptedMs) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalNoticeDays - daysServed);

  const offeredCtc = Number(row.offered_ctc) || 0;
  const currentCtc = Number(row.current_ctc) || 0;
  const hikePercentage = currentCtc > 0 ? Math.round(((offeredCtc - currentCtc) / currentCtc) * 100) : 0;

  return {
    id: String(row.id),
    orgId: String(row.org_id),
    roleId: String(row.role_id),
    candidateId: String(row.candidate_id),
    applicationId: String(row.application_id),
    offerAcceptedDate,
    targetJoiningDate,
    totalNoticeDays,
    offeredCtc,
    currentCtc,
    hikePercentage,
    placementFee: Number(row.placement_fee) || 0,
    currency: row.currency || "INR",
    intentState: (row.intent_state || "committed") as IntentState,
    hazardScore: Number(row.hazard_score) || 15.0,
    riskTier: (row.risk_tier || "low") as RiskTier,
    resignationSubmitted: Boolean(row.resignation_submitted),
    resignationSubmittedDate: row.resignation_submitted_date ? toIso(row.resignation_submitted_date) : null,
    resignationAccepted: Boolean(row.resignation_accepted),
    bgvDocumentsSubmitted: Boolean(row.bgv_documents_submitted),
    preboardingPortalVisits: Number(row.preboarding_portal_visits) || 0,
    lastResponseLatencyHours: Number(row.last_response_latency_hours) || 4.0,
    silverMedalistAppId: row.silver_medalist_application_id || null,
    silverMedalistWarmed: Boolean(row.silver_medalist_warmed),
    buddyAssignedName: row.buddy_assigned_name || "",
    buddyAssignedEmail: row.buddy_assigned_email || "",
    swagDispatched: Boolean(row.swag_dispatched),
    resolution: (row.resolution || "active") as any,
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    notes: row.notes || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    candidateName: row.candidate_name,
    roleTitle: row.role_title,
    companyName: row.company_name,
  };
}

/**
 * Fetches all preboarding offers for an organization, optionally filtered by role.
 */
export async function getPreboardingOffers(
  orgId: string,
  roleId?: string,
): Promise<PreboardingOffer[]> {
  const sql = await getSql();

  let rows: any[];
  if (roleId) {
    rows = await sql`
      select 
        o.*,
        c.full_name as candidate_name,
        r.title as role_title,
        r.company_name as company_name
      from preboarding_offers o
      join candidates c on c.id = o.candidate_id
      join roles r on r.id = o.role_id
      where o.org_id = ${orgId} and o.role_id = ${roleId}
      order by o.hazard_score desc, o.target_joining_date asc
    `;
  } else {
    rows = await sql`
      select 
        o.*,
        c.full_name as candidate_name,
        r.title as role_title,
        r.company_name as company_name
      from preboarding_offers o
      join candidates c on c.id = o.candidate_id
      join roles r on r.id = o.role_id
      where o.org_id = ${orgId}
      order by o.hazard_score desc, o.target_joining_date asc
    `;
  }

  return rows.map(mapOfferRow);
}

/**
 * Fetches a single preboarding offer by ID.
 */
export async function getPreboardingOfferById(offerId: string): Promise<PreboardingOffer | null> {
  const sql = await getSql();
  const rows = await sql`
    select 
      o.*,
      c.full_name as candidate_name,
      r.title as role_title,
      r.company_name as company_name
    from preboarding_offers o
    join candidates c on c.id = o.candidate_id
    join roles r on r.id = o.role_id
    where o.id = ${offerId}
    limit 1
  `;

  if (rows.length === 0) return null;
  return mapOfferRow(rows[0]);
}

export type CreatePreboardingOfferInput = {
  orgId: string;
  roleId: string;
  candidateId: string;
  applicationId: string;
  offerAcceptedDate?: string;
  targetJoiningDate: string;
  totalNoticeDays?: number;
  offeredCtc: number;
  currentCtc: number;
  placementFee?: number;
  currency?: string;
  currentEmployerType?: BaselineHazardParams["currentEmployerType"];
  requiresRelocation?: boolean;
  notes?: string;
};

/**
 * Creates or updates a preboarding offer record, calibrating Day-0 baseline hazard.
 */
export async function createOrUpdatePreboardingOffer(
  input: CreatePreboardingOfferInput,
): Promise<PreboardingOffer> {
  const sql = await getSql();
  const existing = await sql`
    select id, hazard_score from preboarding_offers where application_id = ${input.applicationId} limit 1
  `;

  const offerAcceptedDate = input.offerAcceptedDate ? new Date(input.offerAcceptedDate) : new Date();
  const targetJoiningDate = new Date(input.targetJoiningDate);

  const totalNoticeDays =
    input.totalNoticeDays ||
    Math.max(1, Math.round((targetJoiningDate.getTime() - offerAcceptedDate.getTime()) / (1000 * 60 * 60 * 24)));

  const hikePercentage =
    input.currentCtc > 0
      ? Math.round(((input.offeredCtc - input.currentCtc) / input.currentCtc) * 100)
      : 25;

  const placementFee = input.placementFee || Math.round(input.offeredCtc * 0.15);

  const baselineHazard = computeBaselineHazard({
    totalNoticeDays,
    hikePercentage,
    currentEmployerType: input.currentEmployerType || "unknown",
    requiresRelocation: Boolean(input.requiresRelocation),
  });

  const riskTier = classifyRiskTier(baselineHazard);

  if (existing.length > 0) {
    const offerId = String(existing[0].id);
    await sql`
      update preboarding_offers set
        target_joining_date = ${targetJoiningDate.toISOString()},
        total_notice_days = ${totalNoticeDays},
        offered_ctc = ${input.offeredCtc},
        current_ctc = ${input.currentCtc},
        placement_fee = ${placementFee},
        currency = ${input.currency || "INR"},
        notes = coalesce(${input.notes || null}, notes),
        updated_at = now()
      where id = ${offerId}
    `;
    const updated = await getPreboardingOfferById(offerId);
    return updated!;
  }

  const id = newId();
  await sql`
    insert into preboarding_offers (
      id, org_id, role_id, candidate_id, application_id,
      offer_accepted_date, target_joining_date, total_notice_days,
      offered_ctc, current_ctc, placement_fee, currency,
      intent_state, hazard_score, risk_tier, notes
    ) values (
      ${id}, ${input.orgId}, ${input.roleId}, ${input.candidateId}, ${input.applicationId},
      ${offerAcceptedDate.toISOString()}, ${targetJoiningDate.toISOString()}, ${totalNoticeDays},
      ${input.offeredCtc}, ${input.currentCtc}, ${placementFee}, ${input.currency || "INR"},
      'committed', ${baselineHazard}, ${riskTier}, ${input.notes || ""}
    )
  `;

  // Link initial intervention recommendation
  const initialInterventionId = newId();
  await sql`
    insert into preboarding_interventions (
      id, offer_id, playbook_key, status, recommended_by, action_summary
    ) values (
      ${initialInterventionId}, ${id}, 'resignation_escalation', 'recommended', 'system_hazard_engine',
      'Follow up for resignation submission acknowledgment within first 5 days'
    )
  `;

  const created = await getPreboardingOfferById(id);
  return created!;
}

/**
 * Close an offer out: the candidate joined, reneged, or the offer was pulled.
 *
 * This is the moment the commercial promise is settled. `/pricing` says a hire
 * that comes through Vetta on the waived-subscription arrangement costs a flat
 * success fee — and the only place that sentence can become true is here,
 * because this is the only place that knows a person actually walked in. The
 * fee is *drafted*, never charged: a ₹49,999 auto-debit with no human in the
 * loop is a refund dispute, and the claw-back on a 90-day renege is a
 * conversation we have to be able to have.
 *
 * A workspace already paying for a plan is not billed again for hiring — the
 * population that owes a success fee is the one that waived the subscription.
 */
export async function resolvePreboardingOffer(opts: {
  orgId: string;
  offerId: string;
  resolution: OfferResolution;
}): Promise<{ offer: PreboardingOffer; feeDrafted: boolean; feeReason: string }> {
  const sql = await getSql();
  const [row] = await sql`
    select id, application_id, role_id, candidate_id
    from preboarding_offers
    where id = ${opts.offerId} and org_id = ${opts.orgId}
    limit 1
  `;
  if (!row) throw new Error("Offer not found in your workspace.");

  const resolution = opts.resolution;
  // Only a joined/reneged outcome is also an intent state; a rescinded offer
  // keeps whatever intent the hazard model last believed.
  const intentState = resolution === "joined" || resolution === "reneged" ? resolution : null;

  await sql`
    update preboarding_offers set
      resolution = ${resolution},
      intent_state = coalesce(cast(${intentState} as text), intent_state),
      resolved_at = ${resolution === "active" ? null : new Date().toISOString()},
      hazard_score = case when ${resolution} = 'joined' then 0 else hazard_score end,
      updated_at = now()
    where id = ${opts.offerId}
  `;

  let feeDrafted = false;
  let feeReason = "";
  if (resolution === "joined") {
    const { draftSuccessFee, billableAsSuccessFee } = await import(
      "../../billing/server/razorpay.server.ts"
    );
    const billable = await billableAsSuccessFee(opts.orgId);
    if (billable) {
      const result = await draftSuccessFee({
        orgId: opts.orgId,
        roleId: String(row.role_id),
        applicationId: String(row.application_id),
        candidateId: String(row.candidate_id),
        amountPaise: SUCCESS_FEE_PAISE,
      });
      feeDrafted = result.drafted;
      feeReason = result.reason;
    } else {
      feeReason = "No fee: this workspace already pays for the plan that made the hire.";
    }
  }

  const offer = await getPreboardingOfferById(opts.offerId);
  return { offer: offer!, feeDrafted, feeReason };
}

export type LogSignalInput = {
  offerId: string;
  signalType: SignalType;
  signalValue: number;
  payload?: Record<string, string | number | boolean | null>;
  notes?: string;
};

/**
 * Ingests a new micro-telemetry signal, recomputes the dynamic Bayesian hazard score,
 * updates the offer intent state, and generates prescriptive playbooks.
 */
export async function logPreboardingSignal(
  input: LogSignalInput,
): Promise<{ signal: PreboardingSignal; updatedAssessment: HazardAssessment }> {
  const sql = await getSql();
  const offer = await getPreboardingOfferById(input.offerId);
  if (!offer) {
    throw new Error(`Preboarding offer not found: ${input.offerId}`);
  }

  const signalId = newId();
  const signalJson = JSON.stringify(input.payload || {});
  await sql`
    insert into preboarding_signals (
      id, offer_id, signal_type, signal_value, signal_payload, notes
    ) values (${signalId}, ${input.offerId}, ${input.signalType}, ${input.signalValue}, ${signalJson}::jsonb, ${input.notes || ""})
  `;

  // Milestone side-effects directly on the offer row
  if (input.signalType === "resignation_milestone" && input.signalValue >= 1) {
    await sql`
      update preboarding_offers set resignation_submitted = true, resignation_submitted_date = now() where id = ${input.offerId}
    `;
  } else if (input.signalType === "portal_dwell") {
    await sql`
      update preboarding_offers set preboarding_portal_visits = preboarding_portal_visits + 1 where id = ${input.offerId}
    `;
  }

  // Load all historical signals for this offer
  const rawSignals = await sql`
    select * from preboarding_signals where offer_id = ${input.offerId} order by detected_at asc
  `;

  // Compute telemetry snapshot
  const now = Date.now();
  const acceptedTime = new Date(offer.offerAcceptedDate).getTime();
  const daysSinceAcceptance = Math.max(0, Math.round((now - acceptedTime) / (1000 * 60 * 60 * 24)));

  let evasionCount = 0;
  let counterofferCount = 0;
  let dojDelay = false;
  let responseLatencyMultiplier = 1.0;
  let portalVisits = 0;

  for (const s of rawSignals as any[]) {
    const sVal = Number(s.signal_value) || 0;
    if (s.signal_type === "recruiter_sentiment" && sVal >= 1) evasionCount++;
    if (s.signal_type === "counteroffer_hint" && sVal >= 1) counterofferCount++;
    if (s.signal_type === "doj_delay_request") dojDelay = true;
    if (s.signal_type === "response_latency") {
      responseLatencyMultiplier = sVal > 0 ? sVal : 1.0;
    }
    if (s.signal_type === "portal_dwell") portalVisits++;
  }

  const snapshot: TelemetrySnapshot = {
    daysSinceAcceptance,
    totalNoticeDays: offer.totalNoticeDays,
    resignationSubmitted: offer.resignationSubmitted || (input.signalType === "resignation_milestone" && input.signalValue >= 1),
    daysSinceAcceptanceToResignation: offer.resignationSubmittedDate ? Math.round((new Date(offer.resignationSubmittedDate).getTime() - acceptedTime) / (1000 * 60 * 60 * 24)) : null,
    averageResponseLatencyHours: 4.0 * responseLatencyMultiplier,
    responseLatencyTrend: responseLatencyMultiplier,
    preboardingPortalVisits: portalVisits,
    bgvDocumentsSubmitted: offer.bgvDocumentsSubmitted,
    dojDelayRequested: dojDelay,
    evasionSignalCount: evasionCount,
    counterofferHintCount: counterofferCount,
  };

  const baselineParams: BaselineHazardParams = {
    totalNoticeDays: offer.totalNoticeDays,
    hikePercentage: offer.hikePercentage,
    currentEmployerType: "unknown",
    requiresRelocation: false,
  };

  const assessment = calculateFullHazardAssessment(
    baselineParams,
    offer.hazardScore,
    offer.intentState,
    snapshot,
  );

  // Update offer row with new state and hazard score
  await sql`
    update preboarding_offers set
      hazard_score = ${assessment.hazardScore},
      risk_tier = ${assessment.riskTier},
      intent_state = ${assessment.intentState},
      updated_at = now()
    where id = ${input.offerId}
  `;

  // Sync recommended playbooks into preboarding_interventions
  for (const pb of assessment.playbooks) {
    const existingPb = await sql`
      select id from preboarding_interventions where offer_id = ${input.offerId} and playbook_key = ${pb.key} and status != 'dismissed' limit 1
    `;
    if (existingPb.length === 0) {
      const pbId = newId();
      await sql`
        insert into preboarding_interventions (
          id, offer_id, playbook_key, status, recommended_by, action_summary
        ) values (${pbId}, ${input.offerId}, ${pb.key}, 'recommended', 'system_hazard_engine', ${pb.suggestedAction})
      `;
    }
  }

  const signal: PreboardingSignal = {
    id: signalId,
    offerId: input.offerId,
    signalType: input.signalType,
    signalValue: input.signalValue,
    signalPayload: input.payload || {},
    notes: input.notes || "",
    detectedAt: new Date().toISOString(),
  };

  return { signal, updatedAssessment: assessment };
}

/**
 * Returns all logged signals for an offer.
 */
export async function getPreboardingSignals(offerId: string): Promise<PreboardingSignal[]> {
  const sql = await getSql();
  const rows = await sql`
    select * from preboarding_signals where offer_id = ${offerId} order by detected_at desc
  `;

  return rows.map((r: any) => ({
    id: r.id,
    offerId: r.offer_id,
    signalType: r.signal_type as SignalType,
    signalValue: Number(r.signal_value) || 0,
    signalPayload: (r.signal_payload || {}) as Record<string, string | number | boolean | null>,
    notes: r.notes || "",
    detectedAt: toIso(r.detected_at),
  }));
}

/**
 * Returns all active interventions/playbooks for an offer.
 */
export async function getPreboardingInterventions(offerId: string): Promise<PreboardingIntervention[]> {
  const sql = await getSql();
  const rows = await sql`
    select * from preboarding_interventions where offer_id = ${offerId} order by created_at desc
  `;

  return rows.map((r: any) => ({
    id: r.id,
    offerId: r.offer_id,
    playbookKey: r.playbook_key as PlaybookKey,
    status: r.status,
    recommendedBy: r.recommended_by,
    actorUserId: r.actor_user_id || "",
    actionSummary: r.action_summary || "",
    outcomeNotes: r.outcome_notes || "",
    completedAt: r.completed_at ? toIso(r.completed_at) : null,
    createdAt: toIso(r.created_at),
  }));
}

export type ExecutePlaybookInput = {
  interventionId: string;
  status: "in_progress" | "completed" | "dismissed";
  actorUserId: string;
  outcomeNotes?: string;
};

/**
 * Executes or resolves a prescriptive intervention playbook.
 */
export async function executeInterventionPlaybook(
  input: ExecutePlaybookInput,
): Promise<PreboardingIntervention> {
  const sql = await getSql();
  const completedAt = input.status === "completed" ? new Date().toISOString() : null;

  await sql`
    update preboarding_interventions set
      status = ${input.status},
      actor_user_id = ${input.actorUserId},
      outcome_notes = coalesce(${input.outcomeNotes || null}, outcome_notes),
      completed_at = ${completedAt}
    where id = ${input.interventionId}
  `;

  const rows = await sql`
    select * from preboarding_interventions where id = ${input.interventionId} limit 1
  `;

  const r: any = rows[0];
  return {
    id: String(r.id),
    offerId: String(r.offer_id),
    playbookKey: r.playbook_key as PlaybookKey,
    status: r.status,
    recommendedBy: String(r.recommended_by),
    actorUserId: String(r.actor_user_id || ""),
    actionSummary: String(r.action_summary || ""),
    outcomeNotes: String(r.outcome_notes || ""),
    completedAt: r.completed_at ? toIso(r.completed_at) : null,
    createdAt: toIso(r.created_at),
  };
}

/**
 * Fetches dashboard aggregation metrics for the organization's preboarding pipeline.
 */
export async function getPreboardingDashboardSummary(orgId: string): Promise<OfferGuardDashboard> {
  const sql = await getSql();
  const offers = await getPreboardingOffers(orgId);

  let totalFeeProtected = 0;
  let totalNoticeDaysSum = 0;
  const riskDistribution: Record<RiskTier, number> = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  for (const o of offers) {
    if (o.resolution === "active") {
      totalFeeProtected += o.placementFee;
      totalNoticeDaysSum += o.totalNoticeDays;
      riskDistribution[o.riskTier] = (riskDistribution[o.riskTier] || 0) + 1;
    }
  }

  const activeCount = offers.filter((o) => o.resolution === "active").length;
  const avgNoticeDays = activeCount > 0 ? Math.round(totalNoticeDaysSum / activeCount) : 60;

  // Joined vs reneged past 30 days
  const joinedRows = await sql`
    select count(*) as count from preboarding_offers
    where org_id = ${orgId} and resolution = 'joined'
    and resolved_at >= now() - interval '30 days'
  `;
  const renegedRows = await sql`
    select count(*) as count from preboarding_offers
    where org_id = ${orgId} and resolution = 'reneged'
    and resolved_at >= now() - interval '30 days'
  `;

  const joinedThisMonth = Number(joinedRows[0]?.count) || 0;
  const renegedThisMonth = Number(renegedRows[0]?.count) || 0;
  const totalClosed = joinedThisMonth + renegedThisMonth;
  const joiningRatioThisMonth = totalClosed > 0 ? Math.round((joinedThisMonth / totalClosed) * 100) : 100;

  return {
    activeOffers: activeCount,
    totalFeeProtected,
    avgNoticeDays,
    riskDistribution,
    joinedThisMonth,
    renegedThisMonth,
    joiningRatioThisMonth,
    offers,
  };
}

/**
 * Finds top runner-up candidate applications (Silver Medalists) for a given role.
 */
export async function getSilverMedalistCandidates(
  roleId: string,
  currentCandidateId: string,
): Promise<Array<{ id: string; candidateName: string; rankScore: number; headline: string; email: string }>> {
  const sql = await getSql();
  const rows = await sql`
    select 
      a.id,
      c.full_name as candidate_name,
      c.email,
      c.current_title as headline,
      a.rank_score
    from applications a
    join candidates c on c.id = a.candidate_id
    where a.role_id = ${roleId}
      and a.candidate_id != ${currentCandidateId}
      and a.rank_score is not null
    order by a.rank_score desc
    limit 3
  `;

  return rows.map((r: any) => ({
    id: r.id,
    candidateName: r.candidate_name,
    rankScore: Number(r.rank_score) || 0,
    headline: r.headline || "Candidate",
    email: r.email,
  }));
}

/**
 * Marks the runner-up silver medalist candidate as warmed up on standby.
 */
export async function warmSilverMedalistStandby(
  offerId: string,
  silverMedalistAppId: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    update preboarding_offers set
      silver_medalist_application_id = ${silverMedalistAppId},
      silver_medalist_warmed = true,
      updated_at = now()
    where id = ${offerId}
  `;

  // Record intervention as completed
  await sql`
    update preboarding_interventions set
      status = 'completed',
      completed_at = now(),
      outcome_notes = 'Silver medalist warm touchpoint initiated. Candidate on warm standby.'
    where offer_id = ${offerId} and playbook_key = 'silver_medalist_warm'
  `;
}

/**
 * Tracks and updates tutorial bubble progress.
 */
export async function updateTutorialProgress(
  orgId: string,
  userId: string,
  stepKey: string,
  dismissed: boolean,
): Promise<void> {
  const sql = await getSql();
  const id = newId();
  await sql`
    insert into preboarding_tutorial_progress (id, org_id, user_id, step_key, dismissed, completed_at)
    values (${id}, ${orgId}, ${userId || ""}, ${stepKey}, ${dismissed}, now())
    on conflict (org_id, user_id, step_key)
    do update set dismissed = ${dismissed}, completed_at = now()
  `;
}

/**
 * Gets all dismissed tutorial steps for an organization user.
 */
export async function getTutorialProgress(orgId: string, userId: string): Promise<Record<string, boolean>> {
  const sql = await getSql();
  const rows = await sql`
    select step_key, dismissed from preboarding_tutorial_progress where org_id = ${orgId} and user_id = ${userId || ""}
  `;

  const res: Record<string, boolean> = {};
  for (const r of rows as any[]) {
    res[String(r.step_key)] = Boolean(r.dismissed);
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENTIC ORCHESTRATION: LLM Renege Intervention Synthesis
// Activated ONLY when B-SMDT hazard escalates to Amber (≥0.40) or Red (≥0.70).
// Falls back to deterministic playbook summary if OpenRouter is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

export type RenegeInterventionNarrative = {
  /** Source of the narrative */
  engine: "openrouter" | "deterministic";
  model?: string;
  reasoningTokens?: number;
  /** Personalized talking points for the hiring manager / founder */
  talkingPoints: string[];
  /** Suggested follow-up actions */
  suggestedActions: string[];
  /** One-line summary of the risk situation */
  riskSummary: string;
};

/**
 * Synthesizes personalized renege-prevention talking points using the LLM.
 *
 * Right-time trigger: hazardScore >= 0.40 (Amber) or >= 0.70 (Red).
 * Right-place: Called from the offer-guard dashboard when a recruiter views
 *              an at-risk candidate — not on every signal ingestion.
 *
 * Zero-cost fallback: Returns deterministic playbook bullets if OpenRouter
 * is unavailable, over budget, or circuit-broken.
 */
export async function synthesizeRenegeIntervention(params: {
  candidateName: string;
  roleName: string;
  companyName: string;
  hazardScore: number;
  riskTier: RiskTier;
  topRiskFactors: string[];
  playbookKeys: PlaybookKey[];
  offeredCtcInr?: number;
  daysUntilJoining?: number;
}): Promise<RenegeInterventionNarrative> {
  const { hazardScore, riskTier, candidateName, roleName, companyName } = params;

  // Only trigger LLM synthesis for high or critical risk tiers
  if (riskTier !== "high" && riskTier !== "critical") {
    return buildDeterministicNarrative(params);
  }

  // Attempt OpenRouter synthesis with Gemma-4-31B
  try {
    const { OpenRouter } = await import("../../ai/server/openrouter-client.server.ts");
    const { isOpenRouterCircuitTripped } = await import("../../ai/server/openrouter-guardrail.server.ts");

    if (isOpenRouterCircuitTripped()) {
      return buildDeterministicNarrative(params);
    }

    const client = new OpenRouter();

    const systemPrompt = `You are an expert recruitment consultant specializing in preventing candidate renege situations in the Indian tech hiring market. You help recruiters craft empathetic, effective retention interventions. Be concise, practical, and culturally aware. Output JSON only.`;

    const userPrompt = `A candidate has an elevated renege risk. Generate personalized retention intervention talking points.

Candidate: ${candidateName}
Role: ${roleName} at ${companyName}
Hazard Score: ${(hazardScore * 100).toFixed(0)}% renege probability
Risk Tier: ${riskTier.toUpperCase()}
Key Risk Factors: ${params.topRiskFactors.slice(0, 3).join("; ")}
Active Playbooks: ${params.playbookKeys.slice(0, 3).join(", ")}
${params.offeredCtcInr ? `Offered CTC: ₹${(params.offeredCtcInr / 100000).toFixed(1)}L` : ""}
${params.daysUntilJoining !== undefined ? `Days Until Joining: ${params.daysUntilJoining}` : ""}

Return JSON:
{
  "riskSummary": "<one sentence>",
  "talkingPoints": ["<point 1>", "<point 2>", "<point 3>"],
  "suggestedActions": ["<action 1>", "<action 2>"]
}`;

    const response = await client.chat.sendNonStreaming({
      chatRequest: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 512,
        temperature: 0.3,
      },
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "";
    // Strip markdown code fences if present
    const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(jsonStr) as {
      riskSummary?: string;
      talkingPoints?: string[];
      suggestedActions?: string[];
    };

    return {
      engine: "openrouter",
      model: response.model,
      reasoningTokens: response.usage?.completionTokensDetails?.reasoningTokens,
      riskSummary: parsed.riskSummary || `${riskTier.toUpperCase()} renege risk detected for ${candidateName}`,
      talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints : [],
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
    };
  } catch {
    // Any error (network, budget cap, injection detection) → graceful deterministic fallback
    return buildDeterministicNarrative(params);
  }
}

function buildDeterministicNarrative(params: {
  candidateName: string;
  roleName: string;
  companyName: string;
  hazardScore: number;
  riskTier: RiskTier;
  topRiskFactors: string[];
  playbookKeys: PlaybookKey[];
  offeredCtcInr?: number;
  daysUntilJoining?: number;
}): RenegeInterventionNarrative {
  const { candidateName, companyName, riskTier, hazardScore, topRiskFactors } = params;

  const talkingPoints: string[] = [
    `Acknowledge ${candidateName}'s decision to join ${companyName} and reinforce why this is the right career move.`,
    `Address the top concern directly: ${topRiskFactors[0] ?? "competing offer or counter-offer"}.`,
    `Highlight unique growth opportunities, team culture, and direct impact of the role.`,
  ];

  const suggestedActions: string[] = [
    "Schedule a check-in call with the hiring manager within 48 hours.",
    "Send a personalized onboarding preview — first-day plan, buddy introduction, and team welcome note.",
  ];

  if (params.daysUntilJoining !== undefined && params.daysUntilJoining <= 10) {
    suggestedActions.unshift("Expedite background verification to reduce anxiety in the final stretch.");
  }

  return {
    engine: "deterministic",
    riskSummary: `${riskTier.toUpperCase()} renege risk (${(hazardScore * 100).toFixed(0)}%) — deterministic playbook intervention recommended.`,
    talkingPoints,
    suggestedActions,
  };
}
