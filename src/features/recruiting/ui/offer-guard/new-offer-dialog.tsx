import { useState } from "react";
import { Plus, Shield, Calendar, DollarSign, Building2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import type { BaselineHazardParams } from "../../domain/types";

interface NewOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleId: string;
  candidateId: string;
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  onCreateOffer: (params: {
    roleId: string;
    candidateId: string;
    applicationId: string;
    targetJoiningDate: string;
    offeredCtc: number;
    currentCtc: number;
    placementFee?: number;
    currency?: string;
    currentEmployerType?: BaselineHazardParams["currentEmployerType"];
    requiresRelocation?: boolean;
    notes?: string;
  }) => Promise<void>;
}

export function NewOfferDialog({
  open,
  onOpenChange,
  roleId,
  candidateId,
  applicationId,
  candidateName,
  roleTitle,
  onCreateOffer,
}: NewOfferDialogProps) {
  // Default to 60 days from today
  const defaultDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [targetJoiningDate, setTargetJoiningDate] = useState(defaultDate);
  const [offeredCtc, setOfferedCtc] = useState("3500000"); // ₹35 Lakh
  const [currentCtc, setCurrentCtc] = useState("2500000"); // ₹25 Lakh
  const [employerType, setEmployerType] =
    useState<BaselineHazardParams["currentEmployerType"]>("tier1_it_services");
  const [requiresRelocation, setRequiresRelocation] = useState(false);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const numOffered = parseFloat(offeredCtc) || 0;
  const numCurrent = parseFloat(currentCtc) || 0;
  const hikePct = numCurrent > 0 ? Math.round(((numOffered - numCurrent) / numCurrent) * 100) : 0;
  const placementFee = Math.round(numOffered * 0.15); // standard 15% placement fee

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onCreateOffer({
        roleId,
        candidateId,
        applicationId,
        targetJoiningDate: new Date(targetJoiningDate).toISOString(),
        offeredCtc: numOffered,
        currentCtc: numCurrent,
        placementFee,
        currency: "INR",
        currentEmployerType: employerType,
        requiresRelocation,
        notes: notes.trim() || undefined,
      });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-surface border-border">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
              <Shield className="size-4" />
            </span>
            <DialogTitle className="font-display text-xl">
              Track Offer & Calibrate Hazard Model
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted">
            Start active notice period monitoring for <strong>{candidateName}</strong> ({roleTitle}).
            Calibrate baseline hazard using structural features.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
          {/* Target Joining Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
              <Calendar className="size-3.5 text-primary" />
              <span>Target Date of Joining (DOJ)</span>
            </label>
            <Input
              type="date"
              value={targetJoiningDate}
              onChange={(e) => setTargetJoiningDate(e.target.value)}
              required
              className="bg-bg text-fg"
            />
          </div>

          {/* Compensation Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-fg flex items-center gap-1">
                <DollarSign className="size-3.5 text-primary" />
                <span>Offered CTC (₹ INR)</span>
              </label>
              <Input
                type="number"
                value={offeredCtc}
                onChange={(e) => setOfferedCtc(e.target.value)}
                required
                className="bg-bg text-fg"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-fg">Current CTC (₹ INR)</label>
              <Input
                type="number"
                value={currentCtc}
                onChange={(e) => setCurrentCtc(e.target.value)}
                required
                className="bg-bg text-fg"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-elevated/70 p-3 text-xs border border-border">
            <span className="text-muted">Calculated Hike:</span>
            <span className="font-mono font-bold text-primary">{hikePct}%</span>
            <span className="text-muted ml-3">Placement Fee Protected:</span>
            <span className="font-mono font-bold text-fg">₹{(placementFee / 100000).toFixed(2)}L</span>
          </div>

          {/* Employer Archetype */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-fg flex items-center gap-1.5">
              <Building2 className="size-3.5 text-primary" />
              <span>Current Employer Archetype</span>
            </label>
            <select
              value={employerType}
              onChange={(e) =>
                setEmployerType(e.target.value as BaselineHazardParams["currentEmployerType"])
              }
              className="w-full rounded-xl border border-border bg-bg p-2.5 text-xs text-fg focus:border-primary focus:outline-none"
            >
              <option value="gcc_product">
                Global Capability Center (GCC) / Funded Product (48% counteroffer retention)
              </option>
              <option value="tier1_it_services">
                Tier-1 Indian IT Services: TCS, Infosys, Wipro (18% retention)
              </option>
              <option value="midmarket_services">
                Midmarket Services / IT Consulting (28% retention)
              </option>
              <option value="startup">Early-stage Startup (35% retention)</option>
              <option value="unknown">Other / Unknown</option>
            </select>
          </div>

          {/* Relocation Checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="reloc"
              checked={requiresRelocation}
              onChange={(e) => setRequiresRelocation(e.target.checked)}
              className="size-4 rounded accent-primary cursor-pointer"
            />
            <label htmlFor="reloc" className="text-xs text-muted cursor-pointer">
              Candidate needs to relocate to another metro (adds structural relocation friction)
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={loading} className="h-9 text-xs">
              {loading ? "Activating..." : "Start Pre-Boarding Tracking"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
