import { Badge } from "@/shared/components/ui/badge";
import { PIPELINE_LABEL, STAGE_LABEL } from "@/lib/recruiting/constants";
import type { CompanyStage, PipelineStatus } from "@/lib/recruiting/types";

const pipelineVariant: Record<
  PipelineStatus,
  "default" | "solid" | "success" | "warn" | "danger" | "outline"
> = {
  ingested: "outline",
  ranked: "default",
  shortlisted: "solid",
  screening: "warn",
  ready: "warn",
  approved: "success",
  sent: "success",
  hold: "outline",
  rejected: "danger",
};

export function PipelineChip({ status }: { status: PipelineStatus }) {
  return <Badge variant={pipelineVariant[status]}>{PIPELINE_LABEL[status]}</Badge>;
}

export function StageChip({ stage }: { stage: CompanyStage }) {
  return <Badge variant="outline">{STAGE_LABEL[stage]}</Badge>;
}

export function ScoreChip({ score }: { score: number | null }) {
  if (score == null) return <Badge variant="outline">Unranked</Badge>;
  const variant = score >= 80 ? "success" : score >= 65 ? "solid" : score >= 50 ? "warn" : "danger";
  return (
    <Badge variant={variant}>
      <span className="font-mono tabular-nums">{score}</span>
    </Badge>
  );
}
