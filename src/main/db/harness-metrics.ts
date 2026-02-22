import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import { listHarnessFindings } from "./harness-findings"
import { listHarnessRuns } from "./harness-runs"
import type { HarnessMetricSummary } from "../types"

interface HarnessMetricSnapshotRow {
  snapshot_id: string
  metric_key: string
  window_key: string
  snapshot_json: string
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

function quantile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((percentile / 100) * (sorted.length - 1)))
  )
  return sorted[index] || 0
}

export function createHarnessMetricSnapshot(
  metricKey: string,
  windowKey: string,
  snapshot: Record<string, unknown>
): {
  id: string
  metricKey: string
  windowKey: string
  snapshot: Record<string, unknown>
  createdAt: Date
} {
  const database = getDb()
  const snapshotId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_metric_snapshots (
      snapshot_id, metric_key, window_key, snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?)`,
    [snapshotId, metricKey, windowKey, JSON.stringify(snapshot), now]
  )

  scheduleDatabaseSave()
  return {
    id: snapshotId,
    metricKey,
    windowKey,
    snapshot,
    createdAt: new Date(now)
  }
}

export function listHarnessMetricSnapshots(
  metricKey?: string,
  limit: number = 200
): Array<{
  id: string
  metricKey: string
  windowKey: string
  snapshot: Record<string, unknown>
  createdAt: Date
}> {
  const database = getDb()
  const safeLimit = Math.max(1, Math.min(limit, 2000))
  const stmt = database.prepare(
    `SELECT * FROM harness_metric_snapshots
     ${metricKey ? "WHERE metric_key = ?" : ""}
     ORDER BY created_at DESC LIMIT ?`
  )
  stmt.bind(metricKey ? [metricKey, safeLimit] : [safeLimit])

  const rows: Array<{
    id: string
    metricKey: string
    windowKey: string
    snapshot: Record<string, unknown>
    createdAt: Date
  }> = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as HarnessMetricSnapshotRow
    rows.push({
      id: row.snapshot_id,
      metricKey: row.metric_key,
      windowKey: row.window_key,
      snapshot: parseJsonObject(row.snapshot_json),
      createdAt: new Date(row.created_at)
    })
  }
  stmt.free()
  return rows
}

export function computeHarnessMetricsSummary(windowMs?: number): HarnessMetricSummary {
  const windowStartMs = typeof windowMs === "number" && windowMs > 0 ? Date.now() - windowMs : 0
  const runs = listHarnessRuns({ limit: 1000 }).filter((run) =>
    windowStartMs > 0 ? run.createdAt.getTime() >= windowStartMs : true
  )
  const activeRuns = runs.filter((run) => run.status === "running").length
  const queuedRuns = runs.filter((run) => run.status === "queued").length
  const completedRuns = runs.filter((run) => run.status === "completed")
  const failedRuns = runs.filter((run) => run.status === "failed")
  const pendingApprovals = listHarnessFindings({ status: "pending_review", limit: 1000 }).length

  const completionScores = completedRuns.map((run) => run.summary.averageScore)
  const averageScore =
    completionScores.length > 0
      ? completionScores.reduce((sum, score) => sum + score, 0) / completionScores.length
      : 0

  const findings = listHarnessFindings({ limit: 1000 }).filter((finding) =>
    windowStartMs > 0 ? finding.createdAt.getTime() >= windowStartMs : true
  )
  const totalFindings = findings.length
  const approvedFindings = findings.filter((finding) => finding.status === "approved").length
  const rejectedFindings = findings.filter((finding) => finding.status === "rejected").length
  const queuedForExperimentFindings = findings.filter(
    (finding) => finding.status === "queued_for_experiment"
  ).length
  const reviewedFindings = findings.filter((finding) => finding.reviewedAt)
  const approvalLatencies = reviewedFindings
    .map((finding) => {
      if (!finding.reviewedAt) {
        return 0
      }
      return finding.reviewedAt.getTime() - finding.createdAt.getTime()
    })
    .filter((latency) => latency >= 0)

  const approved = approvedFindings
  const rejected = rejectedFindings
  const edited = findings.filter((finding) => {
    const notes = finding.reviewerNotes || ""
    return finding.status === "approved" && notes.toLowerCase().includes("edit")
  }).length
  const totalReviewedActions = Math.max(1, approved + rejected + edited)

  const policyDeniedCount = findings.filter(
    (finding) => finding.category === "policy_friction"
  ).length
  const blockedRunCount = runs.filter((run) => {
    const stopReasons = run.summary.stopReasons
    const blocked = (stopReasons["blocked_on_approval"] || 0) + (stopReasons["policy_denied"] || 0)
    return blocked > 0
  }).length

  const completionRate = runs.length > 0 ? completedRuns.length / runs.length : 0
  const averageFailedTasksPerRun =
    runs.length > 0
      ? runs.reduce((sum, run) => sum + Number(run.summary.failedCount || 0), 0) / runs.length
      : 0

  return {
    totalRuns: runs.length,
    activeRuns,
    queuedRuns,
    completedRuns: completedRuns.length,
    failedRuns: failedRuns.length,
    completionRate,
    averageScore,
    averageFailedTasksPerRun,
    pendingApprovals,
    totalFindings,
    approvedFindings,
    rejectedFindings,
    queuedForExperimentFindings,
    approvalLatencyP50Ms: quantile(approvalLatencies, 50),
    approvalLatencyP95Ms: quantile(approvalLatencies, 95),
    approveRatio: approved / totalReviewedActions,
    rejectRatio: rejected / totalReviewedActions,
    editRatio: edited / totalReviewedActions,
    policyDeniedCount,
    blockedRunCount,
    updatedAt: new Date().toISOString()
  }
}
