import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  HarnessExperimentRun,
  HarnessExperimentStatus,
  HarnessGateReport,
  HarnessGateStatus,
  HarnessPromotionDecision,
  HarnessVariantResult
} from "../types"

interface HarnessExperimentRunRow {
  experiment_run_id: string
  spec_key: string
  baseline_suite_key: string
  status: HarnessExperimentStatus
  started_at: number | null
  completed_at: number | null
  report_json: string
  promotion_decision_json: string
  approved_by: string | null
  approved_at: number | null
  notes: string | null
  created_at: number
  updated_at: number
}

interface HarnessExperimentVariantRow {
  variant_id: string
  experiment_run_id: string
  variant_key: string
  variant_label: string
  is_baseline: number
  config_json: string
  result_json: string
  created_at: number
  updated_at: number
}

interface HarnessPromotedVariant {
  experimentRunId: string
  variantKey: string
  variantLabel: string
  config: Record<string, unknown>
}

interface HarnessGateReportRow {
  gate_report_id: string
  target_ref: string
  stage: HarnessGateReport["stage"]
  status: HarnessGateStatus
  summary_json: string
  created_at: number
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // no-op
  }
  return {}
}

function defaultPromotionDecision(): HarnessPromotionDecision {
  return {
    recommendPromotion: false,
    primaryMetric: "average_score",
    primaryDelta: 0,
    threshold: 0,
    safetyRegression: false,
    catastrophicRegression: false,
    reasons: []
  }
}

function mapVariantRow(row: HarnessExperimentVariantRow): HarnessVariantResult {
  const parsed = parseJsonObject(row.result_json)
  return {
    variantKey: row.variant_key,
    variantLabel: row.variant_label,
    isBaseline: row.is_baseline === 1,
    runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
    runIds: Array.isArray(parsed.runIds)
      ? parsed.runIds.filter((value): value is string => typeof value === "string")
      : undefined,
    sampleCount:
      typeof parsed.sampleCount === "number" && Number.isFinite(parsed.sampleCount)
        ? Number(parsed.sampleCount)
        : undefined,
    retriesUsed:
      typeof parsed.retriesUsed === "number" && Number.isFinite(parsed.retriesUsed)
        ? Number(parsed.retriesUsed)
        : undefined,
    failedRunCount:
      typeof parsed.failedRunCount === "number" && Number.isFinite(parsed.failedRunCount)
        ? Number(parsed.failedRunCount)
        : undefined,
    averageScore: Number(parsed.averageScore || 0),
    scoreDelta: Number(parsed.scoreDelta || 0),
    latencyDeltaMs: Number(parsed.latencyDeltaMs || 0),
    costDeltaUsd: Number(parsed.costDeltaUsd || 0),
    toolCallDelta: Number(parsed.toolCallDelta || 0),
    safetyDelta: Number(parsed.safetyDelta || 0),
    summary:
      typeof parsed.summary === "object" && parsed.summary
        ? (parsed.summary as Record<string, unknown>)
        : {}
  }
}

function mapExperimentRunRow(
  row: HarnessExperimentRunRow,
  variants: HarnessVariantResult[]
): HarnessExperimentRun {
  const parsedReport = parseJsonObject(row.report_json)
  const parsedPromotion = parseJsonObject(row.promotion_decision_json)
  const promotionDecision: HarnessPromotionDecision =
    typeof parsedPromotion.recommendPromotion === "boolean"
      ? {
          recommendPromotion: parsedPromotion.recommendPromotion,
          primaryMetric: "average_score",
          primaryDelta: Number(parsedPromotion.primaryDelta || 0),
          threshold: Number(parsedPromotion.threshold || 0),
          safetyRegression: Boolean(parsedPromotion.safetyRegression),
          catastrophicRegression: Boolean(parsedPromotion.catastrophicRegression),
          reasons: Array.isArray(parsedPromotion.reasons)
            ? parsedPromotion.reasons.filter((value): value is string => typeof value === "string")
            : []
        }
      : defaultPromotionDecision()

  return {
    id: row.experiment_run_id,
    specKey: row.spec_key,
    baselineSuiteKey: row.baseline_suite_key,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    variants,
    report: parsedReport,
    promotionDecision,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
    notes: row.notes || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

export interface CreateHarnessExperimentRunInput {
  specKey: string
  baselineSuiteKey: string
  status?: HarnessExperimentStatus
}

export interface UpdateHarnessExperimentRunInput {
  status?: HarnessExperimentStatus
  startedAt?: number | null
  completedAt?: number | null
  report?: Record<string, unknown>
  promotionDecision?: HarnessPromotionDecision
  approvedBy?: string | null
  approvedAt?: number | null
  notes?: string | null
}

export interface AddHarnessExperimentVariantInput {
  experimentRunId: string
  variantKey: string
  variantLabel: string
  isBaseline: boolean
  config?: Record<string, unknown>
  result: HarnessVariantResult
}

export interface ListHarnessExperimentRunsFilters {
  status?: HarnessExperimentStatus
  limit?: number
}

export function createHarnessExperimentRun(
  input: CreateHarnessExperimentRunInput
): HarnessExperimentRun {
  const database = getDb()
  const experimentRunId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_experiment_runs (
      experiment_run_id, spec_key, baseline_suite_key, status, report_json,
      promotion_decision_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      experimentRunId,
      input.specKey,
      input.baselineSuiteKey,
      input.status || "queued",
      JSON.stringify({}),
      JSON.stringify(defaultPromotionDecision()),
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getHarnessExperimentRun(experimentRunId) as HarnessExperimentRun
}

export function updateHarnessExperimentRun(
  experimentRunId: string,
  updates: UpdateHarnessExperimentRunInput
): HarnessExperimentRun | null {
  const database = getDb()
  const existing = getHarnessExperimentRun(experimentRunId)
  if (!existing) {
    return null
  }

  const now = Date.now()
  const setClauses: string[] = ["updated_at = ?"]
  const values: Array<string | number | null> = [now]

  if (updates.status !== undefined) {
    setClauses.push("status = ?")
    values.push(updates.status)
  }
  if (updates.startedAt !== undefined) {
    setClauses.push("started_at = ?")
    values.push(updates.startedAt)
  }
  if (updates.completedAt !== undefined) {
    setClauses.push("completed_at = ?")
    values.push(updates.completedAt)
  }
  if (updates.report !== undefined) {
    setClauses.push("report_json = ?")
    values.push(JSON.stringify(updates.report))
  }
  if (updates.promotionDecision !== undefined) {
    setClauses.push("promotion_decision_json = ?")
    values.push(JSON.stringify(updates.promotionDecision))
  }
  if (updates.approvedBy !== undefined) {
    setClauses.push("approved_by = ?")
    values.push(updates.approvedBy)
  }
  if (updates.approvedAt !== undefined) {
    setClauses.push("approved_at = ?")
    values.push(updates.approvedAt)
  }
  if (updates.notes !== undefined) {
    setClauses.push("notes = ?")
    values.push(updates.notes)
  }

  values.push(experimentRunId)
  database.run(
    `UPDATE harness_experiment_runs SET ${setClauses.join(", ")} WHERE experiment_run_id = ?`,
    values
  )
  scheduleDatabaseSave()
  return getHarnessExperimentRun(experimentRunId)
}

export function addHarnessExperimentVariant(
  input: AddHarnessExperimentVariantInput
): HarnessVariantResult {
  const database = getDb()
  const now = Date.now()
  const variantId = uuid()

  database.run(
    `INSERT INTO harness_experiment_variants (
      variant_id, experiment_run_id, variant_key, variant_label, is_baseline,
      config_json, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      variantId,
      input.experimentRunId,
      input.variantKey,
      input.variantLabel,
      input.isBaseline ? 1 : 0,
      JSON.stringify(input.config || {}),
      JSON.stringify(input.result),
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return input.result
}

export function listHarnessExperimentVariants(experimentRunId: string): HarnessVariantResult[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_experiment_variants WHERE experiment_run_id = ? ORDER BY created_at ASC"
  )
  stmt.bind([experimentRunId])
  const rows: HarnessVariantResult[] = []
  while (stmt.step()) {
    rows.push(mapVariantRow(stmt.getAsObject() as unknown as HarnessExperimentVariantRow))
  }
  stmt.free()
  return rows
}

function listHarnessExperimentVariantRows(experimentRunId: string): HarnessExperimentVariantRow[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_experiment_variants WHERE experiment_run_id = ? ORDER BY created_at ASC"
  )
  stmt.bind([experimentRunId])
  const rows: HarnessExperimentVariantRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as HarnessExperimentVariantRow)
  }
  stmt.free()
  return rows
}

export function getHarnessExperimentRun(experimentRunId: string): HarnessExperimentRun | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_experiment_runs WHERE experiment_run_id = ? LIMIT 1"
  )
  stmt.bind([experimentRunId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessExperimentRunRow
  stmt.free()
  const variants = listHarnessExperimentVariants(experimentRunId)
  return mapExperimentRunRow(row, variants)
}

export function listHarnessExperimentRuns(
  filters?: ListHarnessExperimentRunsFilters
): HarnessExperimentRun[] {
  const database = getDb()
  const conditions: string[] = []
  const values: Array<string | number> = []
  if (filters?.status) {
    conditions.push("status = ?")
    values.push(filters.status)
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(filters?.limit || 100, 500))
  const stmt = database.prepare(
    `SELECT * FROM harness_experiment_runs ${whereSql} ORDER BY created_at DESC LIMIT ?`
  )
  stmt.bind([...values, limit])

  const rows: HarnessExperimentRun[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as HarnessExperimentRunRow
    rows.push(mapExperimentRunRow(row, listHarnessExperimentVariants(row.experiment_run_id)))
  }
  stmt.free()
  return rows
}

export function createHarnessGateReport(input: {
  targetRef: string
  stage: HarnessGateReport["stage"]
  status: HarnessGateStatus
  summary?: Record<string, unknown>
}): HarnessGateReport {
  const database = getDb()
  const gateReportId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_gate_reports (
      gate_report_id, target_ref, stage, status, summary_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      gateReportId,
      input.targetRef,
      input.stage,
      input.status,
      JSON.stringify(input.summary || {}),
      now
    ]
  )

  scheduleDatabaseSave()
  return getHarnessGateReport(gateReportId) as HarnessGateReport
}

export function getHarnessGateReport(gateReportId: string): HarnessGateReport | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_gate_reports WHERE gate_report_id = ? LIMIT 1"
  )
  stmt.bind([gateReportId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessGateReportRow
  stmt.free()
  return {
    id: row.gate_report_id,
    targetRef: row.target_ref,
    stage: row.stage,
    status: row.status,
    summary: parseJsonObject(row.summary_json),
    createdAt: new Date(row.created_at)
  }
}

export function listHarnessGateReports(
  targetRef?: string,
  limit: number = 50
): HarnessGateReport[] {
  const database = getDb()
  const safeLimit = Math.max(1, Math.min(limit, 200))
  const stmt = database.prepare(
    `SELECT * FROM harness_gate_reports
     ${targetRef ? "WHERE target_ref = ?" : ""}
     ORDER BY created_at DESC LIMIT ?`
  )
  stmt.bind(targetRef ? [targetRef, safeLimit] : [safeLimit])

  const rows: HarnessGateReport[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as HarnessGateReportRow
    rows.push({
      id: row.gate_report_id,
      targetRef: row.target_ref,
      stage: row.stage,
      status: row.status,
      summary: parseJsonObject(row.summary_json),
      createdAt: new Date(row.created_at)
    })
  }
  stmt.free()
  return rows
}

export function getLatestApprovedHarnessPromotion(suiteKey: string): HarnessPromotedVariant | null {
  const database = getDb()
  const stmt = database.prepare(
    `SELECT * FROM harness_experiment_runs
     WHERE baseline_suite_key = ? AND status = 'completed' AND approved_at IS NOT NULL
     ORDER BY approved_at DESC LIMIT 1`
  )
  stmt.bind([suiteKey])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const runRow = stmt.getAsObject() as unknown as HarnessExperimentRunRow
  stmt.free()

  const report = parseJsonObject(runRow.report_json)
  const configuredVariantKey =
    typeof report.promotedVariantKey === "string" ? report.promotedVariantKey : null
  const variants = listHarnessExperimentVariantRows(runRow.experiment_run_id)
  const candidateRows = variants.filter((variant) => variant.is_baseline === 0)
  if (candidateRows.length === 0) {
    return null
  }

  let selected = configuredVariantKey
    ? candidateRows.find((variant) => variant.variant_key === configuredVariantKey)
    : undefined
  if (!selected) {
    selected = [...candidateRows].sort((left, right) => {
      const leftResult = parseJsonObject(left.result_json)
      const rightResult = parseJsonObject(right.result_json)
      return Number(rightResult.scoreDelta || 0) - Number(leftResult.scoreDelta || 0)
    })[0]
  }
  if (!selected) {
    return null
  }

  return {
    experimentRunId: runRow.experiment_run_id,
    variantKey: selected.variant_key,
    variantLabel: selected.variant_label,
    config: parseJsonObject(selected.config_json)
  }
}
