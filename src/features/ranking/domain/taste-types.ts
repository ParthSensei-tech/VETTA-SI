export type TasteCategory =
  | "culture_pace"
  | "tech_depth"
  | "ctc_gap"
  | "notice_too_long"
  | "service_firm_bias"
  | "communication"
  | "autonomy"
  | "other";

export type ClientFeedbackAction = "interview" | "reject" | "hire" | "more_info";

export type CulturePaceBias = "high_velocity" | "structured_enterprise" | "balanced";

export interface ClientFeedbackEvent {
  id: string;
  orgId: string;
  companyName: string;
  roleId: string;
  candidateId: string;
  applicationId?: string;
  action: ClientFeedbackAction;
  category: TasteCategory;
  notes: string;
  reviewerName: string;
  reviewerEmail: string;
  calibrated: boolean;
  createdAt: string;
}

export interface ClientTasteProfile {
  id: string;
  orgId: string;
  companyName: string;
  tasteVector: number[];
  positiveSignals: string[];
  negativeSignals: string[];
  samplesCount: number;
  positiveCount: number;
  negativeCount: number;
  culturePaceBias: CulturePaceBias;
  lastCalibratedAt: string;
  createdAt: string;
}

export interface TasteCalibrationResult {
  profile: ClientTasteProfile;
  driftScore: number;
  requiresHitlReview: boolean;
  adjustedRubricWeights?: Record<string, number>;
}
