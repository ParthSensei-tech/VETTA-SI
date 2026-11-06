import { getSql } from "../../platform/db.ts";
import {
  type AnalyticsFilter,
  type CycleTimeMetric,
  type CycleTimesSummary,
  type FunnelAnalyticsReport,
  type FunnelStage,
  type FunnelStageCounts,
  type GrossMarginSummary,
  type InvoiceStatus,
  type JoiningStatus,
  type RepeatMandatesSummary,
  type RetentionStatus,
  type RoleMarginMetric,
  type StageConversionMetrics,
  calculateCycleTime,
  calculateGrossMargin,
} from "./funnel-analytics.ts";

function newId(): string {
  return crypto.randomUUID();
}

export type StageEventRecord = {
  id: string;
  orgId: string;
  applicationId: string;
  candidateId: string;
  roleId: string;
  fromStage: string;
  toStage: FunnelStage;
  actorUserId: string;
  reason: string;
  metadata: Record<string, any>;
  createdAt: string;
};

export type PlacementRecord = {
  id: string;
  orgId: string;
  roleId: string;
  candidateId: string;
  applicationId: string;
  offeredCtc: number;
  feePercentage: number;
  grossPlacementFee: number;
  directSourcingCost: number;
  recruiterCommission: number;
  grossMarginAmount: number;
  grossMarginPercentage: number;
  currency: string;
  offerDate: string | null;
  offerAcceptedDate: string | null;
  joiningDate: string | null;
  joiningStatus: JoiningStatus;
  retentionStatus: RetentionStatus;
  retentionDays: number;
  clawbackAmount: number;
  invoiceStatus: InvoiceStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Records an audit-logged candidate pipeline stage movement.
 * Updates both the immutable stage event log and the application's current state.
 */
export async function recordStageTransition(opts: {
  orgId: string;
  applicationId: string;
  candidateId?: string;
  roleId?: string;
  toStage: FunnelStage;
  fromStage?: string;
  actorUserId?: string;
  reason?: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}): Promise<StageEventRecord> {
  const sql = await getSql();

  // Load application details if candidateId or roleId wasn't passed
  let candidateId = opts.candidateId;
  let roleId = opts.roleId;
  let fromStage = opts.fromStage;

  if (!candidateId || !roleId || fromStage === undefined) {
    const appRows = await sql<{
      candidate_id: string;
      role_id: string;
      pipeline_status: string;
    }>`
      select candidate_id, role_id, pipeline_status
      from applications
      where id = ${opts.applicationId} and (org_id = ${opts.orgId} or org_id is null)
      limit 1`;
    const app = appRows[0];
    if (!app) {
      throw new Error(`Application ${opts.applicationId} not found`);
    }
    candidateId = candidateId ?? app.candidate_id;
    roleId = roleId ?? app.role_id;
    fromStage = fromStage ?? app.pipeline_status;
  }

  if (!candidateId || !roleId) {
    throw new Error(`Application ${opts.applicationId} not found in database`);
  }

  const id = newId();
  const createdAt = opts.timestamp ?? new Date().toISOString();
  const metaJson = JSON.stringify(opts.metadata ?? {});

  await sql`
    insert into pipeline_stage_events (
      id, org_id, application_id, candidate_id, role_id,
      from_stage, to_stage, actor_user_id, reason, metadata_json, created_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.applicationId}, ${candidateId}, ${roleId},
      ${fromStage ?? ""}, ${opts.toStage}, ${opts.actorUserId ?? ""},
      ${opts.reason ?? ""}, ${metaJson}, ${createdAt}
    )`;

  // Update application's current pipeline_status
  await sql`
    update applications set
      pipeline_status = ${opts.toStage},
      updated_at = now()
    where id = ${opts.applicationId}`;

  return {
    id,
    orgId: opts.orgId,
    applicationId: opts.applicationId,
    candidateId,
    roleId,
    fromStage: fromStage ?? "",
    toStage: opts.toStage,
    actorUserId: opts.actorUserId ?? "",
    reason: opts.reason ?? "",
    metadata: opts.metadata ?? {},
    createdAt,
  };
}

/**
 * Creates or updates placement financial record with gross margin computation.
 */
export async function recordPlacement(opts: {
  orgId: string;
  roleId: string;
  candidateId: string;
  applicationId: string;
  offeredCtc: number;
  feePercentage?: number;
  directSourcingCost?: number;
  recruiterCommission?: number;
  currency?: "INR" | "USD";
  offerDate?: string;
  offerAcceptedDate?: string;
  joiningDate?: string;
  notes?: string;
}): Promise<PlacementRecord> {
  const sql = await getSql();

  const appCheck = await sql<{ id: string; org_id: string | null }>`
    select id, org_id from applications where id = ${opts.applicationId} and (org_id = ${opts.orgId} or org_id is null) limit 1`;
  if (!appCheck[0]) {
    throw new Error(`Application ${opts.applicationId} not found`);
  }

  const feePct = opts.feePercentage ?? 15.0;
  const currency = opts.currency ?? "INR";
  const directCost = opts.directSourcingCost ?? 0;
  const commission = opts.recruiterCommission ?? 0;

  const { grossFee, marginAmount, marginPercentage } = calculateGrossMargin({
    offeredCtc: opts.offeredCtc,
    feePercentage: feePct,
    directCost,
    recruiterCommission: commission,
  });

  const id = newId();
  const offerDateVal = opts.offerDate ?? null;
  const acceptedDateVal = opts.offerAcceptedDate ?? null;
  const joiningDateVal = opts.joiningDate ?? null;

  await sql`
    insert into placement_financials (
      id, org_id, role_id, candidate_id, application_id,
      offered_ctc, fee_percentage, gross_placement_fee,
      direct_sourcing_cost, recruiter_commission, gross_margin_amount,
      gross_margin_percentage, currency, offer_date, offer_accepted_date,
      joining_date, joining_status, retention_status, retention_days,
      clawback_amount, invoice_status, notes, created_at, updated_at
    ) values (
      ${id}, ${opts.orgId}, ${opts.roleId}, ${opts.candidateId}, ${opts.applicationId},
      ${opts.offeredCtc}, ${feePct}, ${grossFee},
      ${directCost}, ${commission}, ${marginAmount},
      ${marginPercentage}, ${currency}, ${offerDateVal}, ${acceptedDateVal},
      ${joiningDateVal}, 'pending', 'pending', 0,
      0, 'draft', ${opts.notes ?? ""}, now(), now()
    )
    on conflict (application_id) do update set
      offered_ctc = excluded.offered_ctc,
      fee_percentage = excluded.fee_percentage,
      gross_placement_fee = excluded.gross_placement_fee,
      direct_sourcing_cost = excluded.direct_sourcing_cost,
      recruiter_commission = excluded.recruiter_commission,
      gross_margin_amount = excluded.gross_margin_amount,
      gross_margin_percentage = excluded.gross_margin_percentage,
      currency = excluded.currency,
      offer_date = coalesce(excluded.offer_date, placement_financials.offer_date),
      offer_accepted_date = coalesce(excluded.offer_accepted_date, placement_financials.offer_accepted_date),
      joining_date = coalesce(excluded.joining_date, placement_financials.joining_date),
      notes = case when excluded.notes <> '' then excluded.notes else placement_financials.notes end,
      updated_at = now()`;

  const rows = await sql<{
    id: string;
    org_id: string;
    role_id: string;
    candidate_id: string;
    application_id: string;
    offered_ctc: number;
    fee_percentage: number;
    gross_placement_fee: number;
    direct_sourcing_cost: number;
    recruiter_commission: number;
    gross_margin_amount: number;
    gross_margin_percentage: number;
    currency: string;
    offer_date: string | null;
    offer_accepted_date: string | null;
    joining_date: string | null;
    joining_status: string;
    retention_status: string;
    retention_days: number;
    clawback_amount: number;
    invoice_status: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }>`
    select * from placement_financials
    where application_id = ${opts.applicationId}
    limit 1`;

  const r = rows[0];
  if (!r) throw new Error("Failed to load saved placement record");

  return {
    id: r.id,
    orgId: r.org_id,
    roleId: r.role_id,
    candidateId: r.candidate_id,
    applicationId: r.application_id,
    offeredCtc: Number(r.offered_ctc),
    feePercentage: Number(r.fee_percentage),
    grossPlacementFee: Number(r.gross_placement_fee),
    directSourcingCost: Number(r.direct_sourcing_cost),
    recruiterCommission: Number(r.recruiter_commission),
    grossMarginAmount: Number(r.gross_margin_amount),
    grossMarginPercentage: Number(r.gross_margin_percentage),
    currency: r.currency,
    offerDate: r.offer_date,
    offerAcceptedDate: r.offer_accepted_date,
    joiningDate: r.joining_date,
    joiningStatus: r.joining_status as JoiningStatus,
    retentionStatus: r.retention_status as RetentionStatus,
    retentionDays: Number(r.retention_days),
    clawbackAmount: Number(r.clawback_amount),
    invoiceStatus: r.invoice_status as InvoiceStatus,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Updates post-offer lifecycle for a placement:
 * Joining status (joined, reneged), retention milestone (30d, 60d, 90d, attrited), and clawback deductions.
 */
export async function updatePlacementLifecycle(opts: {
  orgId?: string;
  applicationId: string;
  joiningStatus?: JoiningStatus;
  retentionStatus?: RetentionStatus;
  retentionDays?: number;
  clawbackAmount?: number;
  invoiceStatus?: InvoiceStatus;
  notes?: string;
}): Promise<PlacementRecord> {
  const sql = await getSql();

  // Load current record
  const currentRows = await sql<{
    id: string;
    org_id: string;
    gross_placement_fee: number;
    direct_sourcing_cost: number;
    recruiter_commission: number;
  }>`
    select id, org_id, gross_placement_fee, direct_sourcing_cost, recruiter_commission
    from placement_financials
    where application_id = ${opts.applicationId}
      and (${opts.orgId ?? ""} = '' or org_id = ${opts.orgId ?? ""} or org_id is null)
    limit 1`;

  const cur = currentRows[0];
  if (!cur) throw new Error(`Placement for application ${opts.applicationId} not found`);

  const clawback = opts.clawbackAmount !== undefined ? opts.clawbackAmount : null;

  await sql`
    update placement_financials set
      joining_status = coalesce(${opts.joiningStatus ?? null}, joining_status),
      retention_status = coalesce(${opts.retentionStatus ?? null}, retention_status),
      retention_days = coalesce(${opts.retentionDays !== undefined ? opts.retentionDays : null}, retention_days),
      clawback_amount = coalesce(${clawback}, clawback_amount),
      invoice_status = coalesce(${opts.invoiceStatus ?? null}, invoice_status),
      notes = case when ${opts.notes !== undefined} and ${opts.notes ?? ""} <> '' then ${opts.notes ?? ""} else notes end,
      updated_at = now()
    where application_id = ${opts.applicationId}
      and (${opts.orgId ?? ""} = '' or org_id = ${opts.orgId ?? ""} or org_id is null)`;

  // If clawback occurred, recalculate gross margin
  if (clawback !== null && clawback > 0) {
    const netGrossFee = Math.max(0, Number(cur.gross_placement_fee) - clawback);
    const newMarginAmount =
      netGrossFee - Number(cur.direct_sourcing_cost) - Number(cur.recruiter_commission);
    const newMarginPct = netGrossFee > 0 ? (newMarginAmount / netGrossFee) * 100 : 0;

    await sql`
      update placement_financials set
        gross_margin_amount = ${newMarginAmount},
        gross_margin_percentage = ${newMarginPct}
      where application_id = ${opts.applicationId}`;
  }

  const rows = await sql<{
    id: string;
    org_id: string;
    role_id: string;
    candidate_id: string;
    application_id: string;
    offered_ctc: number;
    fee_percentage: number;
    gross_placement_fee: number;
    direct_sourcing_cost: number;
    recruiter_commission: number;
    gross_margin_amount: number;
    gross_margin_percentage: number;
    currency: string;
    offer_date: string | null;
    offer_accepted_date: string | null;
    joining_date: string | null;
    joining_status: string;
    retention_status: string;
    retention_days: number;
    clawback_amount: number;
    invoice_status: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }>`
    select * from placement_financials
    where application_id = ${opts.applicationId}
    limit 1`;

  const r = rows[0]!;
  return {
    id: r.id,
    orgId: r.org_id,
    roleId: r.role_id,
    candidateId: r.candidate_id,
    applicationId: r.application_id,
    offeredCtc: Number(r.offered_ctc),
    feePercentage: Number(r.fee_percentage),
    grossPlacementFee: Number(r.gross_placement_fee),
    directSourcingCost: Number(r.direct_sourcing_cost),
    recruiterCommission: Number(r.recruiter_commission),
    grossMarginAmount: Number(r.gross_margin_amount),
    grossMarginPercentage: Number(r.gross_margin_percentage),
    currency: r.currency,
    offerDate: r.offer_date,
    offerAcceptedDate: r.offer_accepted_date,
    joiningDate: r.joining_date,
    joiningStatus: r.joining_status as JoiningStatus,
    retentionStatus: r.retention_status as RetentionStatus,
    retentionDays: Number(r.retention_days),
    clawbackAmount: Number(r.clawback_amount),
    invoiceStatus: r.invoice_status as InvoiceStatus,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Enterprise Funnel Analytics Aggregation Engine.
 * Calculates time-to-shortlist, shortlist-to-interview, interview-to-offer,
 * offer acceptance, joining ratio, 90-day retention, repeat mandates, and gross margins.
 */
export async function getFunnelAnalytics(filter: AnalyticsFilter): Promise<FunnelAnalyticsReport> {
  const sql = await getSql();

  // 1. Build Filter Conditions for Stages and Placements
  const eventConditions = ["e.org_id = $1"];
  const eventParams: unknown[] = [filter.orgId];

  if (filter.roleId) {
    eventParams.push(filter.roleId);
    eventConditions.push(`e.role_id = $${eventParams.length}`);
  }
  if (filter.startDate) {
    eventParams.push(filter.startDate);
    eventConditions.push(`e.created_at >= $${eventParams.length}::timestamptz`);
  }
  if (filter.endDate) {
    eventParams.push(filter.endDate);
    eventConditions.push(`e.created_at <= $${eventParams.length}::timestamptz`);
  }

  const eventWhere = eventConditions.join(" and ");

  // 2. Fetch all stage events in scope ordered chronologically
  const stageEvents = await sql.query<{
    id: string;
    application_id: string;
    role_id: string;
    candidate_id: string;
    from_stage: string;
    to_stage: string;
    created_at: string;
  }>(
    `select id, application_id, role_id, candidate_id, from_stage, to_stage, created_at
     from pipeline_stage_events e
     where ${eventWhere}
     order by e.application_id, e.created_at asc`,
    eventParams,
  );

  // Group events by application
  const appEventsMap = new Map<string, Array<{ to_stage: string; created_at: string }>>();
  for (const ev of stageEvents) {
    const list = appEventsMap.get(ev.application_id) ?? [];
    list.push({ to_stage: ev.to_stage, created_at: ev.created_at });
    appEventsMap.set(ev.application_id, list);
  }

  // 3. Compute Cycle Times per Application (Durations in Days)
  const durationsTimeToShortlist: number[] = [];
  const durationsShortlistToInterview: number[] = [];
  const durationsInterviewToOffer: number[] = [];
  const durationsOfferToAcceptance: number[] = [];
  const durationsAcceptanceToJoining: number[] = [];
  const durationsTotalTimeToHire: number[] = [];

  // Stage unique counts tracker
  const seenApplied = new Set<string>();
  const seenShortlisted = new Set<string>();
  const seenInterviewed = new Set<string>();
  const seenOffered = new Set<string>();
  const seenAccepted = new Set<string>();
  const seenJoined = new Set<string>();
  const seenRetained30d = new Set<string>();
  const seenRetained60d = new Set<string>();
  const seenRetained90d = new Set<string>();
  const seenReneged = new Set<string>();
  const seenEarlyAttrition = new Set<string>();
  const seenRejected = new Set<string>();

  for (const [appId, events] of appEventsMap.entries()) {
    let tApplied: number | null = null;
    let tShortlisted: number | null = null;
    let tInterview: number | null = null;
    let tOffered: number | null = null;
    let tAccepted: number | null = null;
    let tJoined: number | null = null;

    for (const ev of events) {
      const ts = new Date(ev.created_at).getTime();
      const stage = ev.to_stage;

      if (stage === "sourced" || stage === "ingested" || stage === "applied") {
        seenApplied.add(appId);
        if (tApplied === null) tApplied = ts;
      } else if (stage === "shortlisted" || stage === "ready" || stage === "approved") {
        seenShortlisted.add(appId);
        if (tShortlisted === null) tShortlisted = ts;
      } else if (stage === "interview" || stage === "screening") {
        seenInterviewed.add(appId);
        if (tInterview === null) tInterview = ts;
      } else if (stage === "offered") {
        seenOffered.add(appId);
        if (tOffered === null) tOffered = ts;
      } else if (stage === "offer_accepted") {
        seenAccepted.add(appId);
        if (tAccepted === null) tAccepted = ts;
      } else if (stage === "joined") {
        seenJoined.add(appId);
        if (tJoined === null) tJoined = ts;
      } else if (stage === "retained_30d") {
        seenRetained30d.add(appId);
      } else if (stage === "retained_60d") {
        seenRetained60d.add(appId);
      } else if (stage === "retained_90d" || stage === "retained") {
        seenRetained90d.add(appId);
      } else if (stage === "reneged" || stage === "no_show") {
        seenReneged.add(appId);
      } else if (stage === "attrited_early") {
        seenEarlyAttrition.add(appId);
      } else if (stage === "rejected" || stage === "offer_declined") {
        seenRejected.add(appId);
      }
    }

    // Fallback: If candidate entered pipeline without an explicit "sourced" event, use the earliest event timestamp
    if (tApplied === null && events.length > 0) {
      tApplied = new Date(events[0]!.created_at).getTime();
      seenApplied.add(appId);
    }

    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // Time to shortlist
    if (tApplied !== null && tShortlisted !== null && tShortlisted >= tApplied) {
      durationsTimeToShortlist.push((tShortlisted - tApplied) / MS_PER_DAY);
    }

    // Shortlist to interview
    if (tShortlisted !== null && tInterview !== null && tInterview >= tShortlisted) {
      durationsShortlistToInterview.push((tInterview - tShortlisted) / MS_PER_DAY);
    }

    // Interview to offer
    if (tInterview !== null && tOffered !== null && tOffered >= tInterview) {
      durationsInterviewToOffer.push((tOffered - tInterview) / MS_PER_DAY);
    }

    // Offer to acceptance
    if (tOffered !== null && tAccepted !== null && tAccepted >= tOffered) {
      durationsOfferToAcceptance.push((tAccepted - tOffered) / MS_PER_DAY);
    }

    // Acceptance to joining
    if (tAccepted !== null && tJoined !== null && tJoined >= tAccepted) {
      durationsAcceptanceToJoining.push((tJoined - tAccepted) / MS_PER_DAY);
    }

    // Total time to hire (apply to acceptance or joining)
    const tHired = tJoined ?? tAccepted;
    if (tApplied !== null && tHired !== null && tHired >= tApplied) {
      durationsTotalTimeToHire.push((tHired - tApplied) / MS_PER_DAY);
    }
  }

  // Also count applications in DB that might not have stage events yet
  const totalAppsCountRows = await sql<{ count: number }>`
    select count(*)::int as count from applications a
    join roles r on r.id = a.role_id
    where r.org_id = ${filter.orgId}`;
  const dbAppsCount = totalAppsCountRows[0]?.count ?? 0;
  const totalApplied = Math.max(seenApplied.size, dbAppsCount);

  // 4. Calculate Stage Counts & Conversion Rates
  const stageCounts: FunnelStageCounts = {
    totalApplied,
    totalShortlisted: seenShortlisted.size,
    totalInterviewed: seenInterviewed.size,
    totalOffered: seenOffered.size,
    totalAccepted: seenAccepted.size,
    totalJoined: seenJoined.size,
    totalRetained30d: seenRetained30d.size,
    totalRetained60d: seenRetained60d.size,
    totalRetained90d: seenRetained90d.size,
    totalReneged: seenReneged.size,
    totalEarlyAttrition: seenEarlyAttrition.size,
    totalRejected: seenRejected.size,
  };

  const pct = (num: number, denom: number): number =>
    denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

  const conversionRates: StageConversionMetrics = {
    applicationToShortlistRate: pct(stageCounts.totalShortlisted, stageCounts.totalApplied),
    shortlistToInterviewRate: pct(stageCounts.totalInterviewed, stageCounts.totalShortlisted),
    interviewToOfferRate: pct(stageCounts.totalOffered, stageCounts.totalInterviewed),
    offerAcceptanceRate: pct(stageCounts.totalAccepted, stageCounts.totalOffered),
    joiningRatio: pct(stageCounts.totalJoined, stageCounts.totalAccepted),
    postOfferRenegeRate: pct(stageCounts.totalReneged, stageCounts.totalAccepted),
    retention90dRate: pct(stageCounts.totalRetained90d, stageCounts.totalJoined),
    overallPipelineYield: pct(stageCounts.totalJoined, stageCounts.totalApplied),
  };

  const cycleTimes: CycleTimesSummary = {
    timeToShortlist: calculateCycleTime(durationsTimeToShortlist),
    shortlistToInterview: calculateCycleTime(durationsShortlistToInterview),
    interviewToOffer: calculateCycleTime(durationsInterviewToOffer),
    offerToAcceptance: calculateCycleTime(durationsOfferToAcceptance),
    acceptanceToJoining: calculateCycleTime(durationsAcceptanceToJoining),
    totalTimeToHire: calculateCycleTime(durationsTotalTimeToHire),
  };

  // 5. Repeat Mandates Analytics
  const roleConditions = ["r.org_id = $1"];
  const roleParams: unknown[] = [filter.orgId];
  if (filter.roleId) {
    roleParams.push(filter.roleId);
    roleConditions.push(`r.id = $${roleParams.length}`);
  }
  const roleWhere = roleConditions.join(" and ");

  const roleRows = await sql.query<{
    id: string;
    title: string;
    company_name: string;
    client_id: string;
    mandate_number: number;
    is_repeat_mandate: boolean;
  }>(
    `select id, title, company_name, client_id, mandate_number, is_repeat_mandate
     from roles r
     where ${roleWhere}`,
    roleParams,
  );

  // Group roles by client
  const clientMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      mandateCount: number;
      isRepeat: boolean;
    }
  >();

  let repeatMandatesCount = 0;
  for (const r of roleRows) {
    const cId = r.client_id || r.company_name || "default";
    const cName = r.company_name || r.client_id || "Unspecified Client";
    const existing = clientMap.get(cId) ?? {
      clientId: cId,
      clientName: cName,
      mandateCount: 0,
      isRepeat: false,
    };
    existing.mandateCount += 1;
    if (r.is_repeat_mandate || r.mandate_number > 1 || existing.mandateCount > 1) {
      existing.isRepeat = true;
    }
    clientMap.set(cId, existing);

    if (r.is_repeat_mandate || r.mandate_number > 1) {
      repeatMandatesCount += 1;
    }
  }

  const totalMandates = roleRows.length;
  // If mandate_number wasn't explicitly flagged on individual roles, deduce from client count > 1
  let calculatedRepeatMandates = repeatMandatesCount;
  if (calculatedRepeatMandates === 0 && totalMandates > 0) {
    for (const c of clientMap.values()) {
      if (c.mandateCount > 1) {
        calculatedRepeatMandates += c.mandateCount - 1;
      }
    }
  }

  const repeatMandateRate =
    totalMandates > 0 ? Math.round((calculatedRepeatMandates / totalMandates) * 1000) / 10 : 0;

  const repeatClientsCount = [...clientMap.values()].filter((c) => c.isRepeat).length;

  const repeatMandates: RepeatMandatesSummary = {
    totalMandates,
    repeatMandates: calculatedRepeatMandates,
    newClientMandates: Math.max(0, totalMandates - calculatedRepeatMandates),
    repeatMandateRate,
    activeClientsCount: clientMap.size,
    repeatClientsCount,
    clientBreakdown: [...clientMap.values()].map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName,
      totalMandates: c.mandateCount,
      repeatMandates: c.isRepeat ? Math.max(0, c.mandateCount - 1) : 0,
      isRepeatClient: c.isRepeat,
      totalPlacements: 0, // Enriched in gross margin pass below
      totalBilledInr: 0,
      totalBilledUsd: 0,
      averageTimeToHireDays: cycleTimes.totalTimeToHire.meanDays,
    })),
  };

  // 6. Gross Margin & Commercial Accounting
  const placementConditions = ["p.org_id = $1"];
  const placementParams: unknown[] = [filter.orgId];
  if (filter.roleId) {
    placementParams.push(filter.roleId);
    placementConditions.push(`p.role_id = $${placementParams.length}`);
  }
  const placementWhere = placementConditions.join(" and ");

  const placementRows = await sql.query<{
    id: string;
    role_id: string;
    candidate_id: string;
    offered_ctc: number;
    fee_percentage: number;
    gross_placement_fee: number;
    direct_sourcing_cost: number;
    recruiter_commission: number;
    gross_margin_amount: number;
    gross_margin_percentage: number;
    currency: string;
    joining_status: string;
    retention_status: string;
    clawback_amount: number;
    role_title: string;
    company_name: string;
    client_id: string;
  }>(
    `select p.*, r.title as role_title, r.company_name, r.client_id
     from placement_financials p
     join roles r on r.id = p.role_id
     where ${placementWhere}`,
    placementParams,
  );

  let totalGrossInr = 0;
  let totalGrossUsd = 0;
  let totalDirectInr = 0;
  let totalDirectUsd = 0;
  let totalCommInr = 0;
  let totalCommUsd = 0;
  let totalMarginInr = 0;
  let totalMarginUsd = 0;
  let totalClawbackInr = 0;
  let totalClawbackUsd = 0;

  const roleMarginMap = new Map<string, RoleMarginMetric>();

  for (const pl of placementRows) {
    const isUsd = pl.currency.toUpperCase() === "USD";
    const gross = Number(pl.gross_placement_fee);
    const direct = Number(pl.direct_sourcing_cost);
    const comm = Number(pl.recruiter_commission);
    const margin = Number(pl.gross_margin_amount);
    const clawback = Number(pl.clawback_amount);

    if (isUsd) {
      totalGrossUsd += gross;
      totalDirectUsd += direct;
      totalCommUsd += comm;
      totalMarginUsd += margin;
      totalClawbackUsd += clawback;
    } else {
      totalGrossInr += gross;
      totalDirectInr += direct;
      totalCommInr += comm;
      totalMarginInr += margin;
      totalClawbackInr += clawback;
    }

    // Role breakdown
    const existing = roleMarginMap.get(pl.role_id) ?? {
      roleId: pl.role_id,
      roleTitle: pl.role_title || "Requisition",
      companyName: pl.company_name || "",
      currency: pl.currency,
      placementsCount: 0,
      grossFee: 0,
      directCost: 0,
      recruiterCommission: 0,
      netMarginAmount: 0,
      marginPercentage: 0,
    };
    existing.placementsCount += 1;
    existing.grossFee += gross;
    existing.directCost += direct;
    existing.recruiterCommission += comm;
    existing.netMarginAmount += margin;
    existing.marginPercentage =
      existing.grossFee > 0
        ? Math.round((existing.netMarginAmount / existing.grossFee) * 1000) / 10
        : 0;
    roleMarginMap.set(pl.role_id, existing);

    // Also enrich client repeat breakdown billing
    const cId = pl.client_id || pl.company_name || "default";
    const clientEntry = repeatMandates.clientBreakdown.find((c) => c.clientId === cId);
    if (clientEntry) {
      clientEntry.totalPlacements += 1;
      if (isUsd) {
        clientEntry.totalBilledUsd += gross;
      } else {
        clientEntry.totalBilledInr += gross;
      }
    }
  }

  const totalPlacementsCount = placementRows.length;
  const overallGross = totalGrossInr + totalGrossUsd * 86; // approximate combined for overall pct
  const overallMargin = totalMarginInr + totalMarginUsd * 86;
  const overallGrossMarginPercentage =
    overallGross > 0 ? Math.round((overallMargin / overallGross) * 1000) / 10 : 0;

  const grossMargin: GrossMarginSummary = {
    totalPlacements: totalPlacementsCount,
    totalGrossPlacementFeeInr: Math.round(totalGrossInr),
    totalGrossPlacementFeeUsd: Math.round(totalGrossUsd),
    totalDirectCostInr: Math.round(totalDirectInr),
    totalDirectCostUsd: Math.round(totalDirectUsd),
    totalRecruiterCommissionInr: Math.round(totalCommInr),
    totalRecruiterCommissionUsd: Math.round(totalCommUsd),
    netGrossMarginAmountInr: Math.round(totalMarginInr),
    netGrossMarginAmountUsd: Math.round(totalMarginUsd),
    overallGrossMarginPercentage,
    averageMarginPerPlacementInr:
      totalPlacementsCount > 0 ? Math.round(totalMarginInr / totalPlacementsCount) : 0,
    averageMarginPerPlacementUsd:
      totalPlacementsCount > 0 ? Math.round(totalMarginUsd / totalPlacementsCount) : 0,
    totalClawbackLossInr: Math.round(totalClawbackInr),
    totalClawbackLossUsd: Math.round(totalClawbackUsd),
    roleBreakdown: [...roleMarginMap.values()],
  };

  return {
    orgId: filter.orgId,
    timeRange: filter.startDate ? `${filter.startDate} to ${filter.endDate ?? "now"}` : "all_time",
    generatedAt: new Date().toISOString(),
    stageCounts,
    conversionRates,
    cycleTimes,
    repeatMandates,
    grossMargin,
  };
}
