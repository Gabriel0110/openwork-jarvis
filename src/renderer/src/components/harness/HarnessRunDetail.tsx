import { useMemo, useState } from "react"
import type { HarnessArtifactRecord, HarnessRun, HarnessTaskResult } from "@/types"

interface HarnessRunDetailProps {
  run: HarnessRun
  tasks: HarnessTaskResult[]
  artifacts: HarnessArtifactRecord[]
  onAnalyzeRun: (runId: string) => Promise<void>
  onExportTrace: (runId: string, format: "json" | "jsonl" | "summary") => Promise<void>
}

export function HarnessRunDetail({
  run,
  tasks,
  artifacts,
  onAnalyzeRun,
  onExportTrace
}: HarnessRunDetailProps): React.JSX.Element {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const failedTasks = useMemo(
    () => tasks.filter((task) => task.status === "failed" || task.scoreTotal < 70),
    [tasks]
  )

  const effectiveSelectedTaskId = useMemo(() => {
    if (tasks.length === 0) {
      return null
    }
    const hasCurrent = selectedTaskId && tasks.some((task) => task.id === selectedTaskId)
    if (hasCurrent) {
      return selectedTaskId
    }
    return failedTasks[0]?.id || tasks[0]?.id || null
  }, [failedTasks, selectedTaskId, tasks])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === effectiveSelectedTaskId) || null,
    [effectiveSelectedTaskId, tasks]
  )

  const selectedTaskArtifacts = useMemo(() => {
    if (!selectedTask) {
      return []
    }
    return artifacts.filter((artifact) => artifact.taskKey === selectedTask.taskKey)
  }, [artifacts, selectedTask])

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-border bg-background/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold tracking-wide">{run.suiteName}</div>
          <div className="text-xs text-muted-foreground">
            {run.profileKey} . {run.status} . {run.summary.averageScore.toFixed(1)} avg
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30"
            onClick={() => onAnalyzeRun(run.id)}
          >
            Analyze Failures
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30"
              onClick={() => onExportTrace(run.id, "json")}
            >
              Trace JSON
            </button>
            <button
              type="button"
              className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30"
              onClick={() => onExportTrace(run.id, "jsonl")}
            >
              Trace JSONL
            </button>
            <button
              type="button"
              className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30"
              onClick={() => onExportTrace(run.id, "summary")}
            >
              Trace Summary
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <div className="rounded-sm border border-border/60 p-2">
          <div className="text-muted-foreground">Tasks</div>
          <div>{run.summary.taskCount}</div>
        </div>
        <div className="rounded-sm border border-border/60 p-2">
          <div className="text-muted-foreground">Passed</div>
          <div>{run.summary.passedCount}</div>
        </div>
        <div className="rounded-sm border border-border/60 p-2">
          <div className="text-muted-foreground">Failed</div>
          <div>{run.summary.failedCount}</div>
        </div>
        <div className="rounded-sm border border-border/60 p-2">
          <div className="text-muted-foreground">Artifacts</div>
          <div>{artifacts.length}</div>
        </div>
      </div>

      <div className="max-h-[220px] overflow-auto rounded-sm border border-border/50">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/70 text-muted-foreground">
              <th className="px-2 py-1 text-left">Task</th>
              <th className="px-2 py-1 text-left">Tier</th>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-left">Score</th>
              <th className="px-2 py-1 text-left">Stop Reason</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className={`cursor-pointer border-b border-border/30 ${
                  task.id === effectiveSelectedTaskId ? "bg-muted/20" : ""
                }`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <td className="px-2 py-1">{task.taskName}</td>
                <td className="px-2 py-1">{task.taskTier}</td>
                <td className="px-2 py-1">{task.status}</td>
                <td className="px-2 py-1">{task.scoreTotal.toFixed(1)}</td>
                <td className="px-2 py-1">{task.stopReason || "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedTask && (
        <div className="rounded-sm border border-border/60 p-3 text-xs">
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Task Diagnostics
          </div>
          <div className="mb-2 text-sm font-medium">
            {selectedTask.taskName} ({selectedTask.taskTier})
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Status</div>
              <div>{selectedTask.status}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Score</div>
              <div>{selectedTask.scoreTotal.toFixed(1)}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Stop Reason</div>
              <div>{selectedTask.stopReason || "n/a"}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Tool Calls</div>
              <div>{selectedTask.toolCalls}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Correctness</div>
              <div>{selectedTask.scoreBreakdown.correctness.toFixed(1)}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Completeness</div>
              <div>{selectedTask.scoreBreakdown.completeness.toFixed(1)}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Safety</div>
              <div>{selectedTask.scoreBreakdown.safetyCompliance.toFixed(1)}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Efficiency</div>
              <div>{selectedTask.scoreBreakdown.efficiency.toFixed(1)}</div>
            </div>
            <div className="rounded-sm border border-border/50 p-2">
              <div className="text-muted-foreground">Tool Hygiene</div>
              <div>{selectedTask.scoreBreakdown.toolHygiene.toFixed(1)}</div>
            </div>
          </div>

          <div className="mb-3 rounded-sm border border-border/50 bg-background/80 p-2">
            <div className="mb-1 text-muted-foreground">Notes</div>
            <div className="whitespace-pre-wrap">
              {selectedTask.notes && selectedTask.notes.trim().length > 0
                ? selectedTask.notes
                : "No additional diagnostics captured for this task."}
            </div>
          </div>

          <div className="rounded-sm border border-border/50 p-2">
            <div className="mb-1 text-muted-foreground">
              Output Contract Checks ({selectedTaskArtifacts.length})
            </div>
            {selectedTaskArtifacts.length === 0 && (
              <div className="text-muted-foreground">
                No artifact checks captured for this task.
              </div>
            )}
            {selectedTaskArtifacts.length > 0 && (
              <div className="space-y-1">
                {selectedTaskArtifacts.map((artifact) => {
                  const relativePath =
                    typeof artifact.payload.relativePath === "string"
                      ? artifact.payload.relativePath
                      : artifact.artifactPath || "unknown"
                  const exists =
                    typeof artifact.payload.exists === "boolean"
                      ? artifact.payload.exists
                      : Boolean(artifact.artifactPath)
                  const required =
                    typeof artifact.payload.required === "boolean"
                      ? artifact.payload.required
                      : true
                  const mustContain = Array.isArray(artifact.payload.mustContain)
                    ? artifact.payload.mustContain.filter(
                        (item): item is string => typeof item === "string"
                      )
                    : []

                  return (
                    <div key={artifact.id} className="rounded-sm border border-border/40 p-2">
                      <div>{relativePath}</div>
                      <div className="text-muted-foreground">
                        required: {required ? "yes" : "no"} . exists: {exists ? "yes" : "no"}
                        {mustContain.length > 0 ? ` . mustContain: ${mustContain.join(", ")}` : ""}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
