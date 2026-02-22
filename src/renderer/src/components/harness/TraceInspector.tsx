import type { HarnessTraceExport } from "@/types"

interface TraceInspectorProps {
  trace: HarnessTraceExport | null
}

export function TraceInspector({ trace }: TraceInspectorProps): React.JSX.Element {
  if (!trace) {
    return (
      <div className="rounded-sm border border-border bg-background/60 p-3 text-xs text-muted-foreground">
        Export a run trace to inspect normalized graph output.
      </div>
    )
  }

  return (
    <div className="rounded-sm border border-border bg-background/60 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Trace Inspector</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-sm border border-border/50 p-2">
          <div className="text-muted-foreground">Nodes</div>
          <div>{trace.summary.nodeCount}</div>
        </div>
        <div className="rounded-sm border border-border/50 p-2">
          <div className="text-muted-foreground">Edges</div>
          <div>{trace.summary.edgeCount}</div>
        </div>
        <div className="rounded-sm border border-border/50 p-2">
          <div className="text-muted-foreground">Format</div>
          <div>{trace.format}</div>
        </div>
      </div>
      <div className="mt-2 rounded-sm border border-border/40 bg-background/80 p-2 text-[11px] text-muted-foreground">
        {trace.format === "summary"
          ? "Summary export omits full graph nodes and events by design."
          : trace.format === "jsonl"
            ? "JSONL export contains one object per line for stream-friendly tooling."
            : "JSON export includes full normalized graph payload."}
      </div>
      <pre className="mt-2 max-h-[220px] overflow-auto rounded-sm border border-border/40 bg-background/80 p-2 text-[11px]">
        {trace.serialized && trace.serialized.trim().length > 0
          ? trace.serialized.slice(0, 12000)
          : JSON.stringify(
              {
                summary: trace.summary,
                nodes: trace.nodes.slice(0, 10),
                edges: trace.edges.slice(0, 10),
                events: trace.events.slice(0, 10)
              },
              null,
              2
            )}
      </pre>
    </div>
  )
}
