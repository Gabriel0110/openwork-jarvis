import type { HarnessFinding } from "@/types"

interface FindingReviewPanelProps {
  findings: HarnessFinding[]
  isWorking?: boolean
  onReview: (
    findingId: string,
    decision: "approved" | "rejected" | "queued_for_experiment"
  ) => Promise<void>
}

export function FindingReviewPanel({
  findings,
  isWorking = false,
  onReview
}: FindingReviewPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border bg-background/60 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Findings Review ({findings.length})
      </div>
      <div className="max-h-[260px] space-y-2 overflow-auto">
        {findings.length === 0 && (
          <div className="rounded-sm border border-border/50 p-2 text-xs text-muted-foreground">
            No findings queued.
          </div>
        )}
        {findings.map((finding) => (
          <div key={finding.id} className="rounded-sm border border-border/50 p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{finding.title}</div>
                <div className="text-muted-foreground">
                  {finding.category} . {finding.severity} . {finding.status}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded-sm border border-border px-2 py-1 text-[10px] hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={isWorking}
                  onClick={() => onReview(finding.id, "approved")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-border px-2 py-1 text-[10px] hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={isWorking}
                  onClick={() => onReview(finding.id, "queued_for_experiment")}
                >
                  Queue
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-border px-2 py-1 text-[10px] hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={isWorking}
                  onClick={() => onReview(finding.id, "rejected")}
                >
                  Reject
                </button>
              </div>
            </div>
            <p className="mt-1 text-muted-foreground">{finding.summary}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
