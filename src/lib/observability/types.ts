export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "firing" | "acknowledged" | "resolved";

export type AccessLog = {
  id: string;
  user_id: string | null;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  ip: string;
  user_agent: string;
  error_message: string;
  meta_json: string;
  created_at: string;
};

export type ModelTaskType =
  | "rank"
  | "screen_generate"
  | "follow_up"
  | "evaluate"
  | "client_card"
  | "rubric_draft"
  | "domain_embed"
  | "test";

export type ModelCostLog = {
  id: string;
  user_id: string | null;
  task_type: ModelTaskType | string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_cents: number;
  duration_ms: number;
  success: boolean;
  error: string;
  application_id: string | null;
  role_id: string | null;
  meta_json: string;
  created_at: string;
};

export type QueueMetric = {
  id: string;
  job_id: string;
  batch_id: string;
  user_id: string;
  queue_age_ms: number;
  duration_ms: number;
  status: "completed" | "failed" | "requeued";
  attempts: number;
  error: string;
  created_at: string;
};

export type SystemAlert = {
  id: string;
  rule_id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  current_value: number;
  threshold_value: number;
  status: AlertStatus;
  details_json: string;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertRule = {
  id: string;
  rule_name: string;
  description: string;
  enabled: boolean;
  threshold: number;
  window_minutes: number;
  severity: AlertSeverity;
  created_at?: string;
  updated_at?: string;
};

export type ObservabilitySummary = {
  errors: {
    total: number;
    ratePercent: number;
    windowMinutes: number;
    recent: Array<{
      id: string;
      source: string;
      message: string;
      timestamp: string;
      status?: number;
    }>;
  };
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    avgMs: number;
    sampleCount: number;
  };
  modelCosts: {
    totalCostCents: number;
    totalCostUsd: number;
    totalCostInr: number;
    totalTokens: number;
    totalCalls: number;
    byTask: Record<
      string,
      { costCents: number; costUsd: number; costInr: number; tokens: number; count: number }
    >;
    byProvider: Record<
      string,
      { costCents: number; costUsd: number; costInr: number; tokens: number; count: number }
    >;
    savingsUsd: number; // calculated from local/free model usage vs gpt-4o rates
    savingsInr: number;
  };
  queueHealth: {
    pendingCount: number;
    processingCount: number;
    completedCount: number;
    failedCount: number;
    oldestAgeMs: number;
    avgAgeMs: number;
    failureRatePercent: number;
  };
  failedJobs: Array<{
    id: string;
    batch_id: string;
    filename: string;
    error: string;
    attempts: number;
    created_at: string;
    updated_at: string;
  }>;
  accessLogs: AccessLog[];
  alerts: SystemAlert[];
  alertRules: AlertRule[];
};
