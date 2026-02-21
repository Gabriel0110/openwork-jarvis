import type { Database as SqlJsDatabase } from "sql.js"
import { migration0001InitialCore } from "./0001-initial-core"
import { migration0002WorkspacesAgents } from "./0002-workspaces-agents"
import { migration0003TimelineGraph } from "./0003-timeline-graph"
import { migration0004MemoryRag } from "./0004-memory-rag"
import { migration0005ConnectorsMcp } from "./0005-connectors-mcp"
import { migration0006WorkflowTemplates } from "./0006-workflow-templates"
import { migration0007TemplateSchedules } from "./0007-template-schedules"
import { migration0008TemplateTriggers } from "./0008-template-triggers"
import { migration0009TemplateScheduleRuns } from "./0009-template-schedule-runs"
import { migration0010MemoryEntryLocks } from "./0010-memory-entry-locks"
import { migration0011AgentSkills } from "./0011-agent-skills"
import { migration0012ToolRegistry } from "./0012-tool-registry"
import { migration0013ZeroClawCore } from "./0013-zeroclaw-core"
import type { Migration } from "./types"

const MIGRATIONS: Migration[] = [
  migration0001InitialCore,
  migration0002WorkspacesAgents,
  migration0003TimelineGraph,
  migration0004MemoryRag,
  migration0005ConnectorsMcp,
  migration0006WorkflowTemplates,
  migration0007TemplateSchedules,
  migration0008TemplateTriggers,
  migration0009TemplateScheduleRuns,
  migration0010MemoryEntryLocks,
  migration0011AgentSkills,
  migration0012ToolRegistry,
  migration0013ZeroClawCore
]

function ensureMigrationsTable(db: SqlJsDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)
}

function getAppliedMigrationIds(db: SqlJsDatabase): Set<string> {
  const stmt = db.prepare("SELECT id FROM schema_migrations")
  const applied = new Set<string>()

  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: string }
    applied.add(row.id)
  }
  stmt.free()

  return applied
}

export function runMigrations(db: SqlJsDatabase): void {
  ensureMigrationsTable(db)
  const applied = getAppliedMigrationIds(db)

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue
    }

    db.run("BEGIN TRANSACTION")
    try {
      migration.up(db)
      db.run("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)", [
        migration.id,
        migration.name,
        Date.now()
      ])
      db.run("COMMIT")
    } catch (error) {
      try {
        db.run("ROLLBACK")
      } catch {
        // Ignore rollback errors and surface the root migration error.
      }
      throw error
    }
  }
}
