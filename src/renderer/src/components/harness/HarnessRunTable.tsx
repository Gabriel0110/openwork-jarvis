import { cn, formatRelativeTime } from "@/lib/utils"
import type { HarnessRun } from "@/types"

interface HarnessRunTableProps {
  runs: HarnessRun[]
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
}

function statusClass(status: HarnessRun["status"]): string {
  if (status === "completed") {
    return "text-status-success"
  }
  if (status === "failed") {
    return "text-status-error"
  }
  if (status === "running" || status === "queued") {
    return "text-status-info"
  }
  return "text-muted-foreground"
}

export function HarnessRunTable({
  runs,
  selectedRunId,
  onSelectRun
}: HarnessRunTableProps): React.JSX.Element {
  if (runs.length === 0) {
    return (
      <div className="rounded-sm border border-border bg-background/60 p-4 text-sm text-muted-foreground">
        No harness runs yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-sm border border-border bg-background/60">
      <div className="grid grid-cols-[1.8fr_1fr_0.9fr_0.8fr] border-b border-border/70 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Suite</span>
        <span>Status</span>
        <span>Avg Score</span>
        <span>Updated</span>
      </div>
      <div className="max-h-[320px] overflow-auto">
        {runs.map((run) => (
          <button
            type="button"
            key={run.id}
            onClick={() => onSelectRun(run.id)}
            className={cn(
              "grid w-full grid-cols-[1.8fr_1fr_0.9fr_0.8fr] items-center gap-2 border-b border-border/30 px-3 py-2 text-left text-xs hover:bg-muted/20",
              selectedRunId === run.id ? "bg-accent/20" : ""
            )}
          >
            <span className="truncate">
              {run.suiteName} <span className="text-muted-foreground">({run.profileKey})</span>
            </span>
            <span className={cn("uppercase tracking-wide", statusClass(run.status))}>
              {run.status}
            </span>
            <span>{run.summary.averageScore.toFixed(1)}</span>
            <span className="text-muted-foreground">{formatRelativeTime(run.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
