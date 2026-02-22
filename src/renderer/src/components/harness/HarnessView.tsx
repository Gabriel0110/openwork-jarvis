import { useCallback, useEffect, useMemo, useState } from "react"
import {
  HarnessExperimentRun,
  HarnessExperimentSpec,
  HarnessFinding,
  HarnessGateSummary,
  HarnessMetricSummary,
  HarnessRun,
  HarnessSuiteSpec,
  HarnessTaskExecutionMode,
  HarnessTraceExport
} from "@/types"
import { HarnessRunTable } from "./HarnessRunTable"
import { HarnessRunDetail } from "./HarnessRunDetail"
import { FindingReviewPanel } from "./FindingReviewPanel"
import { ExperimentCompare } from "./ExperimentCompare"
import { TraceInspector } from "./TraceInspector"

function scoreLabel(summary: HarnessMetricSummary | null): string {
  if (!summary) {
    return "n/a"
  }
  return `${summary.averageScore.toFixed(1)} avg`
}

export function HarnessView(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isWorking, setIsWorking] = useState<boolean>(false)
  const [suites, setSuites] = useState<HarnessSuiteSpec[]>([])
  const [experimentSpecs, setExperimentSpecs] = useState<HarnessExperimentSpec[]>([])
  const [runs, setRuns] = useState<HarnessRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRunDetail, setSelectedRunDetail] = useState<{
    run: HarnessRun
    tasks: import("@/types").HarnessTaskResult[]
    artifacts: import("@/types").HarnessArtifactRecord[]
  } | null>(null)
  const [findings, setFindings] = useState<HarnessFinding[]>([])
  const [experiments, setExperiments] = useState<HarnessExperimentRun[]>([])
  const [metrics, setMetrics] = useState<HarnessMetricSummary | null>(null)
  const [gateReports, setGateReports] = useState<HarnessGateSummary[]>([])
  const [trace, setTrace] = useState<HarnessTraceExport | null>(null)
  const [taskExecutionMode, setTaskExecutionMode] = useState<HarnessTaskExecutionMode>("live")
  const [error, setError] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const enabledResult = await window.api.harness.isEnabled()
      setEnabled(enabledResult.enabled)
      if (!enabledResult.enabled) {
        setIsLoading(false)
        return
      }

      const [suitePayload, runList, findingList, experimentList, metricPayload] = await Promise.all(
        [
          window.api.harness.suites.list(),
          window.api.harness.runs.list({ limit: 100 }),
          window.api.harness.findings.list({ status: "pending_review", limit: 200 }),
          window.api.harness.experiments.list({ limit: 50 }),
          window.api.harness.metrics.summary()
        ]
      )

      setSuites(suitePayload.suites)
      setExperimentSpecs(suitePayload.experimentSpecs)
      setRuns(runList)
      setFindings(findingList)
      setExperiments(experimentList)
      setMetrics(metricPayload.summary)
      setGateReports(metricPayload.gateReports)

      if (!selectedRunId && runList.length > 0) {
        setSelectedRunId(runList[0].id)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [selectedRunId])

  const loadRunDetail = useCallback(async () => {
    if (!selectedRunId || !enabled) {
      setSelectedRunDetail(null)
      return
    }
    try {
      const detail = await window.api.harness.runs.get(selectedRunId)
      setSelectedRunDetail(detail)
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : String(detailError))
      setSelectedRunDetail(null)
    }
  }, [enabled, selectedRunId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void loadRunDetail()
  }, [loadRunDetail])

  const runStatusSummary = useMemo(() => {
    const counts = {
      running: runs.filter((run) => run.status === "running" || run.status === "queued").length,
      failed: runs.filter((run) => run.status === "failed").length,
      completed: runs.filter((run) => run.status === "completed").length
    }
    return `${counts.running} active . ${counts.failed} failed . ${counts.completed} complete`
  }, [runs])

  const runSuite = async (suiteKey: string): Promise<void> => {
    setIsWorking(true)
    setError(null)
    try {
      const run = await window.api.harness.runs.start({ suiteKey, taskExecutionMode })
      setSelectedRunId(run.id)
      await refresh()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setIsWorking(false)
    }
  }

  const analyzeRun = async (runId: string): Promise<void> => {
    setIsWorking(true)
    try {
      await window.api.harness.findings.analyzeRun(runId)
      await refresh()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setIsWorking(false)
    }
  }

  const exportTrace = async (
    runId: string,
    format: "json" | "jsonl" | "summary" = "json"
  ): Promise<void> => {
    setIsWorking(true)
    try {
      const exported = await window.api.harness.traces.export({ runId, format })
      setTrace(exported)
    } catch (traceError) {
      setError(traceError instanceof Error ? traceError.message : String(traceError))
    } finally {
      setIsWorking(false)
    }
  }

  const reviewFinding = async (
    findingId: string,
    decision: "approved" | "rejected" | "queued_for_experiment"
  ): Promise<void> => {
    setIsWorking(true)
    setError(null)
    setReviewMessage(null)
    try {
      const reviewed = await window.api.harness.findings.review(
        findingId,
        decision,
        undefined,
        "human"
      )
      setReviewMessage(
        `${reviewed.title || "Finding"} marked ${reviewed.status.replaceAll("_", " ")}.`
      )
      await refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError))
      await refresh()
    } finally {
      setIsWorking(false)
    }
  }

  const runExperiment = async (specKey: string): Promise<void> => {
    setIsWorking(true)
    try {
      await window.api.harness.experiments.run(specKey)
      await refresh()
    } catch (experimentError) {
      setError(experimentError instanceof Error ? experimentError.message : String(experimentError))
    } finally {
      setIsWorking(false)
    }
  }

  const runRetention = async (): Promise<void> => {
    setIsWorking(true)
    try {
      const result = await window.api.harness.retention.runNow()
      setReviewMessage(
        `Retention complete. Removed ${result.removedArtifacts} artifacts, ${result.removedTraceExports} traces, ${result.removedFindings} findings, and ${result.removedWorkspaceCopies} workspace copies.`
      )
      await refresh()
    } catch (retentionError) {
      setError(retentionError instanceof Error ? retentionError.message : String(retentionError))
    } finally {
      setIsWorking(false)
    }
  }

  const promoteExperiment = async (experimentRunId: string): Promise<void> => {
    setIsWorking(true)
    try {
      await window.api.harness.experiments.promote(experimentRunId, "human", "Manual promotion")
      await refresh()
    } catch (promotionError) {
      setError(promotionError instanceof Error ? promotionError.message : String(promotionError))
    } finally {
      setIsWorking(false)
    }
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading harness...</div>
  }

  if (!enabled) {
    return (
      <div className="p-4">
        <div className="rounded-sm border border-border bg-background/60 p-4 text-sm text-muted-foreground">
          Harness UI is disabled by `HARNESS_UI_DISABLED=true`.
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background/60 p-3">
        <div>
          <div className="text-sm font-semibold tracking-wide">HARNESS ENGINEERING</div>
          <div className="text-xs text-muted-foreground">
            {runStatusSummary} . {scoreLabel(metrics)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 rounded-sm border border-border px-1 py-1 text-[11px]">
            <span className="px-1 text-muted-foreground">Mode</span>
            <button
              type="button"
              className={`rounded-sm px-2 py-1 ${
                taskExecutionMode === "live" ? "bg-accent/20" : "hover:bg-muted/30"
              }`}
              disabled={isWorking}
              onClick={() => setTaskExecutionMode("live")}
            >
              Live
            </button>
            <button
              type="button"
              className={`rounded-sm px-2 py-1 ${
                taskExecutionMode === "synthetic" ? "bg-accent/20" : "hover:bg-muted/30"
              }`}
              disabled={isWorking}
              onClick={() => setTaskExecutionMode("synthetic")}
            >
              Synthetic
            </button>
          </div>
          {suites.slice(0, 3).map((suite) => (
            <button
              type="button"
              key={suite.key}
              className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30 disabled:opacity-40"
              disabled={isWorking}
              onClick={() => runSuite(suite.key)}
            >
              Run {suite.name}
            </button>
          ))}
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30 disabled:opacity-40"
            disabled={isWorking}
            onClick={() => runRetention()}
          >
            Run Retention
          </button>
          <button
            type="button"
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30 disabled:opacity-40"
            disabled={isWorking}
            onClick={() => refresh()}
          >
            Refresh
          </button>
        </div>
      </div>

      {metrics && (
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 xl:grid-cols-8">
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Total Runs</div>
            <div>{metrics.totalRuns}</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Active</div>
            <div>{metrics.activeRuns + metrics.queuedRuns}</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Completion</div>
            <div>{(metrics.completionRate * 100).toFixed(1)}%</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Avg Failed Tasks/Run</div>
            <div>{metrics.averageFailedTasksPerRun.toFixed(2)}</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Pending Approvals</div>
            <div>{metrics.pendingApprovals}</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Findings</div>
            <div>{metrics.totalFindings}</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Policy Denied</div>
            <div>{metrics.policyDeniedCount}</div>
          </div>
          <div className="rounded-sm border border-border bg-background/60 p-2">
            <div className="text-muted-foreground">Blocked Runs</div>
            <div>{metrics.blockedRunCount}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-sm border border-status-error/50 bg-status-error/10 p-2 text-xs text-status-error">
          {error}
        </div>
      )}
      {reviewMessage && (
        <div className="mb-3 rounded-sm border border-status-success/50 bg-status-success/10 p-2 text-xs text-status-success">
          {reviewMessage}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <HarnessRunTable
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRun={(runId) => setSelectedRunId(runId)}
          />
          {selectedRunDetail && (
            <HarnessRunDetail
              run={selectedRunDetail.run}
              tasks={selectedRunDetail.tasks}
              artifacts={selectedRunDetail.artifacts}
              onAnalyzeRun={analyzeRun}
              onExportTrace={exportTrace}
            />
          )}
          <TraceInspector trace={trace} />
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          {gateReports.length > 0 && (
            <div className="rounded-sm border border-border bg-background/60 p-3 text-xs">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Gate Reports
              </div>
              <div className="max-h-[140px] space-y-1 overflow-auto">
                {gateReports.slice(0, 10).map((report) => (
                  <div key={report.id} className="rounded-sm border border-border/40 p-2">
                    <div className="font-medium">
                      {report.stage} . {report.status}
                    </div>
                    <div className="text-muted-foreground">{report.targetRef}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <FindingReviewPanel findings={findings} onReview={reviewFinding} isWorking={isWorking} />
          <ExperimentCompare
            specs={experimentSpecs}
            experiments={experiments}
            onRunExperiment={runExperiment}
            onPromote={promoteExperiment}
            isWorking={isWorking}
          />
        </div>
      </div>
    </div>
  )
}
