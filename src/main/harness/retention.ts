import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { getDb, scheduleDatabaseSave } from "../db"
import { deleteExpiredHarnessFindings } from "../db/harness-findings"
import { deleteExpiredHarnessTraceExports } from "../db/harness-traces"
import { getOpenworkDir } from "../storage"
import type { HarnessRetentionPolicy, HarnessRetentionRunResult } from "../types"

const DEFAULT_RETENTION_POLICY: HarnessRetentionPolicy = {
  rawArtifactsTtlDays: 30,
  traceExportsTtlDays: 30,
  findingsTtlDays: 180,
  workspaceCopiesTtlDays: 30
}

function deleteExpiredArtifacts(nowMs: number, retentionDays: number): number {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT artifact_id, created_at, retention_ttl_days FROM harness_artifacts"
  )
  const expiredIds: string[] = []

  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      artifact_id: string
      created_at: number
      retention_ttl_days: number
    }
    const ttlDays = Math.max(1, Number(row.retention_ttl_days || retentionDays))
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000
    const ageMs = nowMs - Number(row.created_at || nowMs)
    if (ageMs > ttlMs) {
      expiredIds.push(row.artifact_id)
    }
  }
  stmt.free()

  for (const artifactId of expiredIds) {
    database.run("DELETE FROM harness_artifacts WHERE artifact_id = ?", [artifactId])
  }

  if (expiredIds.length > 0) {
    scheduleDatabaseSave()
  }
  return expiredIds.length
}

function deleteExpiredWorkspaceCopies(nowMs: number, retentionDays: number): number {
  const workspaceCopiesRoot = join(getOpenworkDir(), "harness", "workspaces")
  if (!existsSync(workspaceCopiesRoot)) {
    return 0
  }

  const ttlMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
  const entries = readdirSync(workspaceCopiesRoot, { withFileTypes: true })
  let removed = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const copyPath = join(workspaceCopiesRoot, entry.name)
    try {
      const stats = statSync(copyPath)
      const ageMs = nowMs - Math.max(stats.mtimeMs || 0, stats.ctimeMs || 0)
      if (ageMs > ttlMs) {
        rmSync(copyPath, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      // Ignore transient fs errors and continue retention pass.
    }
  }

  return removed
}

export function runHarnessRetention(
  policy?: Partial<HarnessRetentionPolicy>
): HarnessRetentionRunResult {
  const resolvedPolicy: HarnessRetentionPolicy = {
    rawArtifactsTtlDays:
      policy?.rawArtifactsTtlDays || DEFAULT_RETENTION_POLICY.rawArtifactsTtlDays,
    traceExportsTtlDays:
      policy?.traceExportsTtlDays || DEFAULT_RETENTION_POLICY.traceExportsTtlDays,
    findingsTtlDays: policy?.findingsTtlDays || DEFAULT_RETENTION_POLICY.findingsTtlDays,
    workspaceCopiesTtlDays:
      policy?.workspaceCopiesTtlDays || DEFAULT_RETENTION_POLICY.workspaceCopiesTtlDays
  }
  const nowMs = Date.now()

  const removedArtifacts = deleteExpiredArtifacts(nowMs, resolvedPolicy.rawArtifactsTtlDays)
  const removedTraceExports = deleteExpiredHarnessTraceExports(nowMs)
  const removedFindings = deleteExpiredHarnessFindings(nowMs)
  const removedWorkspaceCopies = deleteExpiredWorkspaceCopies(
    nowMs,
    resolvedPolicy.workspaceCopiesTtlDays || DEFAULT_RETENTION_POLICY.workspaceCopiesTtlDays || 30
  )

  return {
    removedArtifacts,
    removedTraceExports,
    removedFindings,
    removedWorkspaceCopies,
    runAt: new Date(nowMs).toISOString()
  }
}
