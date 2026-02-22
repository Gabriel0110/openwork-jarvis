import type { IpcMain } from "electron"
import {
  getHarnessExperimentRun,
  listHarnessGateReports,
  listHarnessExperimentRuns,
  updateHarnessExperimentRun
} from "../db/harness-experiments"
import { listHarnessFindings, reviewHarnessFinding } from "../db/harness-findings"
import { listHarnessArtifacts } from "../db/harness-runs"
import { getHarnessNovelStubs } from "../harness/novel"
import {
  cancelHarnessRun,
  getHarnessRunDetail,
  listAvailableHarnessSuites,
  listHarnessRunRecords,
  startHarnessRun
} from "../harness/benchmark-runner"
import { listHarnessExperimentSpecs, runHarnessExperiment } from "../harness/experiment-runner"
import { runHarnessRetention } from "../harness/retention"
import { exportHarnessTrace } from "../harness/trace-export"
import { analyzeHarnessRun } from "../harness/trace-analyzer"
import { createHarnessMetricSnapshot, computeHarnessMetricsSummary } from "../db/harness-metrics"
import type {
  HarnessArtifactsParams,
  HarnessExperimentGetParams,
  HarnessExperimentPromoteParams,
  HarnessExperimentsListParams,
  HarnessExperimentsRunParams,
  HarnessFindingReviewParams,
  HarnessFindingsListParams,
  HarnessMetricsSummaryParams,
  HarnessRunCancelParams,
  HarnessRunGetParams,
  HarnessRunListFilters,
  HarnessRunStartParams,
  HarnessTraceExportParams
} from "../types"

function requireObject(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorMessage)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`)
  }
  return value.trim()
}

function isHarnessUiDisabled(): boolean {
  return String(process.env.HARNESS_UI_DISABLED || "").toLowerCase() === "true"
}

function assertHarnessMutationsEnabled(): void {
  if (isHarnessUiDisabled()) {
    throw new Error("Harness mutations are disabled by HARNESS_UI_DISABLED=true")
  }
}

export function registerHarnessHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("harness:isEnabled", async () => {
    return { enabled: !isHarnessUiDisabled() }
  })

  ipcMain.handle("harness:suites:list", async () => {
    return {
      suites: listAvailableHarnessSuites(),
      experimentSpecs: listHarnessExperimentSpecs()
    }
  })

  ipcMain.handle("harness:runs:start", async (_event, params: HarnessRunStartParams) => {
    assertHarnessMutationsEnabled()
    requireObject(params, "Invalid harness run request.")
    requireString(params.suiteKey, "suiteKey")
    return startHarnessRun(params)
  })

  ipcMain.handle("harness:runs:list", async (_event, filters?: HarnessRunListFilters) => {
    return listHarnessRunRecords(filters)
  })

  ipcMain.handle("harness:runs:get", async (_event, params: HarnessRunGetParams) => {
    requireObject(params, "Invalid harness get-run payload.")
    const runId = requireString(params.runId, "runId")
    const detail = getHarnessRunDetail(runId)
    if (!detail) {
      throw new Error("Harness run not found.")
    }
    return detail
  })

  ipcMain.handle("harness:runs:cancel", async (_event, params: HarnessRunCancelParams) => {
    assertHarnessMutationsEnabled()
    requireObject(params, "Invalid harness cancel payload.")
    const runId = requireString(params.runId, "runId")
    const cancelled = cancelHarnessRun(runId)
    if (!cancelled) {
      throw new Error("Harness run not found.")
    }
    return cancelled
  })

  ipcMain.handle("harness:runs:getArtifacts", async (_event, params: HarnessArtifactsParams) => {
    requireObject(params, "Invalid harness artifacts payload.")
    const runId = requireString(params.runId, "runId")
    return listHarnessArtifacts(runId, params.taskKey)
  })

  ipcMain.handle("harness:traces:export", async (_event, params: HarnessTraceExportParams) => {
    requireObject(params, "Invalid harness trace export payload.")
    const runId = requireString(params.runId, "runId")
    return exportHarnessTrace({
      runId,
      taskKey: params.taskKey,
      format: params.format
    })
  })

  ipcMain.handle("harness:findings:list", async (_event, filters?: HarnessFindingsListParams) => {
    return listHarnessFindings(filters)
  })

  ipcMain.handle("harness:findings:review", async (_event, params: HarnessFindingReviewParams) => {
    assertHarnessMutationsEnabled()
    requireObject(params, "Invalid finding review payload.")
    const findingId = requireString(params.findingId, "findingId")
    const decision = requireString(params.decision, "decision")
    const allowedDecisions = new Set(["approved", "rejected", "queued_for_experiment"])
    if (!allowedDecisions.has(decision)) {
      throw new Error("decision must be approved, rejected, or queued_for_experiment.")
    }
    const reviewed = reviewHarnessFinding(
      findingId,
      decision as "approved" | "rejected" | "queued_for_experiment",
      params.notes,
      params.reviewer
    )
    if (!reviewed) {
      throw new Error("Harness finding not found.")
    }
    return reviewed
  })

  ipcMain.handle("harness:findings:analyzeRun", async (_event, params: { runId: string }) => {
    assertHarnessMutationsEnabled()
    requireObject(params, "Invalid run analysis payload.")
    const runId = requireString(params.runId, "runId")
    return analyzeHarnessRun(runId)
  })

  ipcMain.handle("harness:experiments:run", async (_event, params: HarnessExperimentsRunParams) => {
    assertHarnessMutationsEnabled()
    requireObject(params, "Invalid experiment run payload.")
    if (params.specIdOrInlineSpec === undefined || params.specIdOrInlineSpec === null) {
      throw new Error("specIdOrInlineSpec is required.")
    }
    return runHarnessExperiment(params.specIdOrInlineSpec)
  })

  ipcMain.handle(
    "harness:experiments:list",
    async (_event, filters?: HarnessExperimentsListParams) => {
      return listHarnessExperimentRuns(filters)
    }
  )

  ipcMain.handle("harness:experiments:get", async (_event, params: HarnessExperimentGetParams) => {
    requireObject(params, "Invalid experiment get payload.")
    const experimentRunId = requireString(params.experimentRunId, "experimentRunId")
    const experiment = getHarnessExperimentRun(experimentRunId)
    if (!experiment) {
      throw new Error("Harness experiment run not found.")
    }
    return experiment
  })

  ipcMain.handle(
    "harness:experiments:promote",
    async (_event, params: HarnessExperimentPromoteParams) => {
      assertHarnessMutationsEnabled()
      requireObject(params, "Invalid experiment promote payload.")
      const experimentRunId = requireString(params.experimentRunId, "experimentRunId")
      const approvedBy = requireString(params.approvedBy, "approvedBy")
      const experiment = getHarnessExperimentRun(experimentRunId)
      if (!experiment) {
        throw new Error("Harness experiment run not found.")
      }
      if (!experiment.promotionDecision.recommendPromotion) {
        throw new Error("Promotion policy did not recommend this variant.")
      }
      const winningVariant = experiment.variants
        .filter((variant) => !variant.isBaseline)
        .sort((left, right) => right.scoreDelta - left.scoreDelta)[0]
      if (!winningVariant) {
        throw new Error("No promotable variant found for this experiment.")
      }

      const updated = updateHarnessExperimentRun(experimentRunId, {
        approvedBy,
        approvedAt: Date.now(),
        notes: params.notes || "Promoted via Harness UI.",
        report: {
          ...(experiment.report || {}),
          promotedVariantKey: winningVariant.variantKey,
          promotedVariantLabel: winningVariant.variantLabel,
          promotedAt: new Date().toISOString()
        }
      })
      if (!updated) {
        throw new Error("Failed to persist promotion decision.")
      }
      return updated
    }
  )

  ipcMain.handle(
    "harness:metrics:summary",
    async (_event, params?: HarnessMetricsSummaryParams) => {
      const summary = computeHarnessMetricsSummary(params?.windowMs)
      createHarnessMetricSnapshot(
        "harness_summary",
        params?.windowMs ? `${params.windowMs}` : "all",
        summary as unknown as Record<string, unknown>
      )
      return {
        summary,
        gateReports: listHarnessGateReports(undefined, 20),
        novel: getHarnessNovelStubs()
      }
    }
  )

  ipcMain.handle("harness:retention:runNow", async () => {
    assertHarnessMutationsEnabled()
    return runHarnessRetention()
  })
}
