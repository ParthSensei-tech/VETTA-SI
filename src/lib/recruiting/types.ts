export const COMPANY_STAGES = ["seed", "series_a", "series_b"] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export const WORK_MODES = ["onsite", "hybrid", "remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = ["full_time", "contract"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const ROLE_STATUSES = ["open", "paused", "closed"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const PIPELINE_STATUSES = [
  "ingested",
  "ranked",
  "shortlisted",
  "screening",
  "ready",
  "approved",
  "sent",
  "hold",
  "rejected",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const SCREEN_STATUSES = ["draft", "awaiting", "evaluated"] as const;
export type ScreenStatus = (typeof SCREEN_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "sent"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ARTIFACT_TYPES = ["client_card", "screen_pack", "outreach"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const FIT_LEVELS = ["strong_yes", "yes", "maybe", "no"] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

export const KNOWLEDGE_KINDS = ["practical", "basic", "common"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export type Role = {
  id: string;
  orgId?: string | null;
  userId?: string;
  companyName: string;
  companyStage: CompanyStage;
  title: string;
  location: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
  candidateCount: number;
  shortlistCount: number;
  pendingApprovals: number;
};

export type RoleInput = {
  companyName: string;
  companyStage: CompanyStage;
  title: string;
  location: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
};

export type ParsedProfile = {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin_url: string;
  current_title: string;
  current_company: string;
  years_experience: number | null;
  skills: string[];
  summary: string;
};

export type RankEvidence = {
  claim: string;
  quote: string;
};

export type RequirementStatus = "satisfied" | "failed" | "missing_info";

export type RequirementEvaluation = {
  requirement: string;
  category: "must_have" | "nice_to_have" | "hard_constraint" | "skill";
  status: RequirementStatus;
  evidenceQuote?: string | null;
  explanation: string;
};

export type StackMatch = {
  skill: string;
  level: "strong" | "partial" | "missing";
  status?: RequirementStatus;
  note?: string;
};

export type IndiaContext = {
  location_fit: "local" | "relocation" | "remote_india" | "unknown";
  notice_period_days: number | null;
  current_ctc_lakh: number | null;
  expected_ctc_lakh: number | null;
  early_stage_fit: "high" | "medium" | "low" | "unknown";
  notes: string;
};

/** Weighted dimension used by the enterprise match engine. */
export type MatchDimension = {
  id: string;
  label: string;
  /** 0–100 contribution before weighting */
  score: number;
  /** Relative weight in the composite */
  weight: number;
  note: string;
};

export type MatchBreakdown = {
  dimensions: MatchDimension[];
  /** Structural reasons the candidate is capped or rejected */
  hardGates: string[];
  /** Role family inferred from JD vs resume family */
  roleFamily: string;
  resumeFamily: string;
  familyAligned: boolean;
};

export type RankResult = {
  score: number;
  level: FitLevel;
  summary: string;
  evidence: RankEvidence[];
  gaps: string[];
  risks: string[];
  india: IndiaContext;
  stack_match: StackMatch[];
  screen_focus: string[];
  /** Structured requirement evaluations separating satisfied, failed, and missing information */
  requirements?: RequirementEvaluation[];
  /** Present when ranked by the enterprise match engine */
  match?: MatchBreakdown;
  /** Learned shortlist probability + EN/HI HR explanation. */
  explain?: {
    pShortlist: number | null;
    samples: number;
    brier: number | null;
    en: string;
    hi: string;
    hrTerms: string[];
  };
  /** Learned hire-quality odds. Null fields mean that stage does not have enough outcomes yet. */
  outcome?: {
    interview: number | null;
    offer: number | null;
    join: number | null;
    retain90: number | null;
    samples: { interview: number; offer: number; join: number; retain90: number };
    ready: boolean;
  };
  /** Provenance tracking: engine (local vs llm), model, provider, version, and staleness */
  provenance?: RankProvenance;
};

export type RankProvenance = {
  engine: "local" | "llm" | string;
  isLocal: boolean;
  provider: string;
  model: string;
  rubricVersion: number | null;
  rubricVersionId: string | null;
  rubricHash: string | null;
  evaluatedAt: string;
  isStale: boolean;
  staleReason: string | null;
  fallback?: boolean;
  fallbackReason?: string | null;
  originalProvider?: string | null;
  groundingRatio?: number | null;
  unverifiedClaimsCount?: number;
  injectionDetected?: boolean;
};

export type Candidate = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: number | null;
  resumeText: string;
  parsed: ParsedProfile;
  createdAt: string;
};

export type ScreenFollowUp = {
  id: string;
  prompt: string;
  intent: string;
};

export type ScreenQuestion = {
  id: string;
  prompt: string;
  intent: string;
  time_minutes: number;
  kind: KnowledgeKind;
  follow_ups: ScreenFollowUp[];
};

export type ScreenAnswer = {
  question_id: string;
  answer: string;
};

export type ScreenTurn = {
  id: string;
  question_id: string;
  role: "agent" | "candidate";
  text: string;
  is_followup: boolean;
  kind: KnowledgeKind | "system";
  created_at: string;
  /** How the candidate answered. Absent on older turns. */
  channel?: "text" | "voice" | "whatsapp";
  lang?: string | null;
};

export type ScreenEvaluation = {
  score: number | null;
  verdict: string;
  strengths: string[];
  concerns: string[];
  notes: string;
};

export type Screen = {
  id: string;
  applicationId: string;
  questions: ScreenQuestion[];
  answers: ScreenAnswer[];
  transcript: ScreenTurn[];
  evaluation: ScreenEvaluation;
  status: ScreenStatus;
  inviteToken: string | null;
  openedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastRemindedAt: string | null;
  reminderCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ClientCard = {
  candidate_name: string;
  headline: string;
  fit_label: string;
  summary: string;
  highlights: string[];
  watchouts: string[];
  interview_probes: string[];
  location: string;
  availability: string;
  screen?: {
    verdict: string;
    notes: string;
  };
};

export type Application = {
  id: string;
  roleId: string;
  candidate: Candidate;
  pipelineStatus: PipelineStatus;
  rankScore: number | null;
  rank: RankResult | null;
  recruiterNotes: string;
  screen: Screen | null;
  pendingApprovalId: string | null;
  latestApprovalStatus: ApprovalStatus | null;
  source: "ingest" | "portal";
  provenance: RankProvenance | null;
  isStale: boolean;
  staleReason: string | null;
  rankEngine: string;
  rubricVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Approval = {
  id: string;
  applicationId: string;
  roleId: string;
  roleTitle: string;
  companyName: string;
  candidateName: string;
  artifactType: ArtifactType;
  title: string;
  payload: ClientCard;
  status: ApprovalStatus;
  reviewerNote: string;
  decidedAt: string | null;
  createdAt: string;
  shareUrl: string | null;
};

export type AuditEvent = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  meta: Record<string, string>;
  createdAt: string;
};

export type ScreenCompletionStats = {
  sent: number;
  opened: number;
  started: number;
  completed: number;
  rate: number;
};

export type WorkspaceSnapshot = {
  roles: Role[];
  pendingApprovals: Approval[];
  recentActivity: AuditEvent[];
  stats: {
    openRoles: number;
    rankedCandidates: number;
    awaitingApproval: number;
    sentThisWeek: number;
    screenCompletion: ScreenCompletionStats;
  };
  aiAvailable: boolean;
  aiEngine: string;
  aiModel: string;
  domainModel: {
    steps: number;
    docs: number;
    rankSteps: number;
    metrics: number;
    asOf: string | null;
    ready: boolean;
  };
};

export type TalentRow = {
  candidate: Candidate;
  applications: Array<{
    id: string;
    roleId: string;
    roleTitle: string;
    companyName: string;
    pipelineStatus: PipelineStatus;
    rankScore: number | null;
  }>;
};

export type PublicJob = {
  id: string;
  companyName: string;
  companyStage: CompanyStage;
  title: string;
  location: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  compensationBand: string;
  stack: string[];
  mustHaves: string[];
  niceToHaves: string[];
  jdText: string;
  postedAt: string;
};

export type PortalStage = "received" | "screening" | "complete";

export type PortalApplication = {
  id: string;
  role: PublicJob;
  candidateName: string;
  email: string;
  phone: string;
  stage: PortalStage;
  questions: ScreenQuestion[] | null;
  answersSubmitted: boolean;
  transcript: ScreenTurn[];
  currentQuestionId: string | null;
  awaitingFollowUp: boolean;
  progress: { asked: number; total: number; minutes: number };
  inviteToken: string | null;
  submittedAt: string;
};

export type PortalApplyInput = {
  roleId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedinUrl: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: string;
  noticePeriod: string;
  expectedCtc: string;
  coverNote: string;
  resumeText: string;
};

export type IngestBatchStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type IngestJobStatus = "queued" | "ranking" | "completed" | "failed";

export type IngestJob = {
  id: string;
  filename: string;
  status: IngestJobStatus;
  error: string;
  applicationId: string | null;
  rankScore: number | null;
  updatedAt: string;
};

export type IngestBatch = {
  id: string;
  roleId: string;
  roleTitle: string;
  companyName: string;
  sourceName: string;
  status: IngestBatchStatus;
  totalCount: number;
  parsedCount: number;
  rankedCount: number;
  failedCount: number;
  errorSummary: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  jobs?: IngestJob[];
};

export type ShareKind = "slate" | "pack";

export type ShareCandidate = {
  applicationId: string;
  candidateName: string;
  headline: string;
  currentTitle: string;
  currentCompany: string;
  location: string;
  rankScore: number | null;
  fitLabel: string;
  rankSummary: string;
  pipelineStatus: string;
  card: ClientCard | null;
  screenVerdict: string;
};

export type ShareView = {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  roleTitle: string;
  companyName: string;
  companyStage: string;
  location: string;
  workMode: string;
  message: string;
  recipientName: string;
  recipientEmail: string;
  exportedAt: string;
  candidates: ShareCandidate[];
};

export type ClientShareRecord = {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  roleId: string;
  shareUrl: string;
  recipientEmail: string;
  recipientName: string;
  message: string;
  emailStatus: string;
  createdAt: string;
};

export type SendClientResult = {
  approval: Approval;
  share: ClientShareRecord;
  mailto: string;
  whatsappUrl: string | null;
  emailed: boolean;
  emailError: string | null;
  loginUrl: string | null;
};

export type ExportSlateResult = {
  share: ClientShareRecord;
  xlsxBase64: string;
  xlsxFilename: string;
  pdfBase64: string;
  pdfFilename: string;
  notionMarkdown: string;
  mailto: string;
  emailed: boolean;
  emailError: string | null;
  loginUrl: string | null;
};

export type ScreenInvite = {
  applicationId: string;
  candidateName: string;
  email: string;
  phone: string;
  screenUrl: string;
  mailto: string;
  whatsappUrl: string | null;
};

export type HarnessVerdict = "agree" | "too_generous" | "too_harsh" | "wrong_function";

export type HarnessSettings = {
  shadowEnabled: boolean;
  minAgreementPct: number;
  maxFalseShortlistPct: number;
  productionPromptId: string | null;
  candidatePromptId: string | null;
};

export type PromptVersion = {
  id: string;
  name: string;
  body: string;
  hash: string;
  status: "production" | "candidate" | "archived" | string;
  createdAt: string;
};

export type EvalCase = {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  roleTitle: string;
  humanLabel: FitLevel;
  expectShortlist: boolean;
  notes: string;
  source: "gold" | "label";
  frozen: boolean;
  createdAt: string;
  lastPredicted: FitLevel | null;
  lastAgree: boolean | null;
};

export type EvalRunCase = {
  caseId: string;
  title: string;
  humanLabel: FitLevel;
  predictedLevel: FitLevel;
  predictedScore: number;
  agree: boolean;
  falseShortlist: boolean;
  falseReject: boolean;
  latencyMs: number | null;
  engine: string;
};

export type EvalRun = {
  id: string;
  engine: string;
  kind: "production" | "candidate";
  promptHash: string;
  labeledCount: number;
  agreeCount: number;
  falseShortlist: number;
  falseReject: number;
  agreementPct: number;
  adjacentPct: number;
  falseShortlistRate: number;
  falseRejectRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  gatePassed: boolean | null;
  gateReason: string;
  notes: string;
  createdAt: string;
  cases?: EvalRunCase[];
};

export type RankTrace = {
  id: string;
  applicationId: string | null;
  mode: "production" | "shadow" | "eval";
  engine: string;
  model: string;
  promptHash: string;
  jdHash: string;
  resumeHash: string;
  score: number | null;
  level: string;
  fallback: boolean;
  latencyMs: number | null;
  createdAt: string;
};

export type ShadowComparison = {
  id: string;
  applicationId: string | null;
  productionLevel: string;
  shadowLevel: string;
  productionScore: number | null;
  shadowScore: number | null;
  disagreed: boolean;
  createdAt: string;
};

export type RankLabelRow = {
  id: string;
  applicationId: string;
  humanLabel: FitLevel;
  predictedLevel: string;
  verdict: HarnessVerdict;
  notes: string;
  addedToEval: boolean;
  createdAt: string;
};

export type HarnessSnapshot = {
  settings: HarnessSettings;
  prompts: PromptVersion[];
  cases: EvalCase[];
  runs: EvalRun[];
  traces: RankTrace[];
  shadows: ShadowComparison[];
  labels: RankLabelRow[];
  stats: {
    labeled: number;
    traces: number;
    shadowDisagreements: number;
    lastAgreementPct: number | null;
    lastGatePassed: boolean | null;
    productionHash: string;
    candidateHash: string | null;
  };
};

export type HitlCheckpointType =
  "rubric_approval" | "missing_info_probe" | "shortlist_interview" | "candidate_rejection";

export type HitlDecisionStatus = "pending" | "approved" | "rejected" | "clarification_requested";

export type HitlPolicy = "strict" | "balanced" | "autonomous";

export type AutonomousPortal = {
  id: string;
  orgId: string;
  slug: string;
  portalName: string;
  headline: string;
  description: string;
  tier: "freemium" | "premium";
  hitlPolicy: HitlPolicy;
  autoShortlistThreshold: number;
  requireHumanRejection: boolean;
  requireRubricApproval: boolean;
  interactiveIntakeEnabled: boolean;
  webhookSecret: string;
  connectedAts: "none" | "workday" | "taleo" | "greenhouse" | "lever";
  channels: {
    careerPortal: boolean;
    embedWidget: boolean;
    atsWebhook: boolean;
    directDrop: boolean;
  };
  branding: {
    primaryColor: string;
    accentColor: string;
    theme: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HitlDecision = {
  id: string;
  orgId: string;
  roleId: string;
  applicationId?: string | null;
  portalId?: string | null;
  checkpointType: HitlCheckpointType;
  status: HitlDecisionStatus;
  candidateName: string;
  roleTitle: string;
  aiRecommendation: "advance" | "probe" | "reject" | "calibrate";
  aiScore?: number | null;
  aiFitLevel?: string | null;
  aiConfidence: number;
  evidenceSummary: string;
  missingRequirements: string[];
  probeQuestions: string[];
  candidateResponses: Array<{ question: string; answer: string; submittedAt?: string }>;
  reviewerId?: string | null;
  reviewerDecision?: string | null;
  reviewerNotes: string;
  calibrationDelta?: Record<string, string | number | boolean | null>;
  decidedAt?: string | null;
  createdAt: string;
};

export type PortalIntakeSession = {
  id: string;
  portalId: string;
  roleId: string;
  applicationId: string;
  candidateEmail: string;
  candidateName: string;
  intakeToken: string;
  probes: Array<{ id: string; prompt: string; field: string; required: boolean }>;
  responses: Array<{ id: string; prompt: string; answer: string }>;
  status: "pending" | "submitted" | "reviewed";
  createdAt: string;
  updatedAt: string;
};

export type AtsWebhookPayload = {
  ats: "workday" | "taleo" | "greenhouse" | "lever";
  event: string;
  candidate: {
    name: string;
    email: string;
    phone?: string;
    resumeText: string;
    location?: string;
    linkedinUrl?: string;
  };
  job: {
    externalJobId: string;
    roleId?: string;
    title?: string;
  };
};
