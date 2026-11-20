import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ClipboardCheck,
  Command,
  LayoutGrid,
  Plus,
  Rocket,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

interface CommandItem {
  id: string;
  label: string;
  category: "Navigation" | "Actions";
  icon: typeof LayoutGrid;
  to?: string;
  onSelect?: () => void;
  shortcut?: string;
}

const COMMANDS: CommandItem[] = [
  { id: "desk", label: "Go to Desk", category: "Navigation", icon: LayoutGrid, to: "/app" },
  { id: "new-role", label: "Create New Role", category: "Actions", icon: Plus, to: "/app/roles/new", shortcut: "N" },
  { id: "approvals", label: "Pending Approvals", category: "Navigation", icon: ClipboardCheck, to: "/app/approvals" },
  { id: "talent", label: "Talent Search", category: "Navigation", icon: Users, to: "/app/talent" },
  { id: "offer-guard", label: "Offer Guard Preboarding", category: "Navigation", icon: ShieldAlert, to: "/app/offer-guard" },
  { id: "portal", label: "Autonomous Career Portal", category: "Navigation", icon: Rocket, to: "/app/portal" },
  { id: "harness", label: "Harness & Audit", category: "Navigation", icon: ShieldCheck, to: "/app/harness" },
  { id: "observability", label: "System Observability & Costs", category: "Navigation", icon: Activity, to: "/app/observability" },
  { id: "agency-metrics", label: "Agency Metrics & KPIs", category: "Navigation", icon: TrendingUp, to: "/app/agency-metrics" },
];

/**
 * Jakob's Law Global Command Palette
 *
 * Implements the universal Cmd+K / Ctrl+K keyboard shortcut pattern familiar
 * to power users across modern SaaS applications.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase().trim()),
  );

  function execute(item: CommandItem) {
    setOpen(false);
    setQuery("");
    if (item.to) {
      void navigate({ to: item.to });
    } else if (item.onSelect) {
      item.onSelect();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden border-border bg-surface shadow-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Quick Command Palette</DialogTitle>
        </DialogHeader>

        {/* Input Bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, navigate screens, or create roles... (Esc to close)"
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-field px-1.5 py-0.5 text-[10px] text-muted">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">No matching commands found.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => execute(item)}
                  className="flex h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm text-fg transition-colors hover:bg-elevated hover:text-accent focus:bg-elevated focus:outline-none"
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="size-4 text-muted group-hover:text-accent" />
                    <span>{item.label}</span>
                  </div>
                  <span className="text-[10px] tracking-wider uppercase text-subtle">
                    {item.category}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer tip */}
        <div className="flex items-center justify-between border-t border-border bg-elevated/40 px-4 py-2 text-[11px] text-muted">
          <span>Navigate with arrows, Enter to select</span>
          <span className="inline-flex items-center gap-1">
            <Command className="size-3" />
            <span>K opens anywhere</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
