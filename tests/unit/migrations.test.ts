import initSqlJs from "sql.js"
import { describe, expect, it } from "vitest"
import { runMigrations } from "../../src/main/db/migrations"

function getSingleNumber(
  db: { prepare: (sql: string) => { step: () => boolean; get: () => unknown[]; free: () => void } },
  sql: string
): number {
  const stmt = db.prepare(sql)
  let value = 0

  if (stmt.step()) {
    const row = stmt.get()
    value = Number(row[0] ?? 0)
  }

  stmt.free()
  return value
}

function hasColumn(
  db: {
    prepare: (sql: string) => {
      bind: (values: unknown[]) => void
      step: () => boolean
      get: () => unknown[]
      free: () => void
    }
  },
  tableName: string,
  columnName: string
): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`)
  let found = false

  while (stmt.step()) {
    const row = stmt.get()
    const name = String(row[1] ?? "")
    if (name === columnName) {
      found = true
      break
    }
  }

  stmt.free()
  return found
}

describe("database migrations", () => {
  it("applies initial schema idempotently", async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()

    runMigrations(db)
    runMigrations(db)

    const threadTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'threads'"
    )
    const runTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'runs'"
    )
    const assistantTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'assistants'"
    )
    const workspaceTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'"
    )
    const agentsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'agents'"
    )
    const timelineEventsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'timeline_events'"
    )
    const graphLayoutsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'graph_layouts'"
    )
    const memoryEntriesTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'memory_entries'"
    )
    const ragSourcesTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'rag_sources'"
    )
    const ragChunksTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'rag_chunks'"
    )
    const connectorsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'connectors'"
    )
    const mcpServersTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'mcp_servers'"
    )
    const workflowTemplatesTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workflow_templates'"
    )
    const templateScheduleRunsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'template_schedule_runs'"
    )
    const toolsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tools'"
    )
    const zeroClawInstallationsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'zeroclaw_installations'"
    )
    const zeroClawDeploymentsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'zeroclaw_deployments'"
    )
    const zeroClawRuntimeEventsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'zeroclaw_runtime_events'"
    )
    const zeroClawPolicyBindingsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'zeroclaw_policy_bindings'"
    )
    const promptAssetsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'prompt_assets'"
    )
    const promptBindingsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'prompt_bindings'"
    )
    const promptMaterializationsTableCount = getSingleNumber(
      db,
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'prompt_materializations'"
    )
    const migrationCount = getSingleNumber(db, "SELECT COUNT(*) FROM schema_migrations")
    const hasTemplateScheduleColumn = hasColumn(db, "workflow_templates", "schedule_config")
    const hasTemplateTriggerColumn = hasColumn(db, "workflow_templates", "trigger_config")
    const hasMemoryLockedColumn = hasColumn(db, "memory_entries", "locked")
    const hasAgentSkillModeColumn = hasColumn(db, "agents", "skill_mode")
    const hasAgentSkillsAllowlistColumn = hasColumn(db, "agents", "skills_allowlist")
    const hasToolSourceColumn = hasColumn(db, "tools", "source")
    const hasToolImplementationColumn = hasColumn(db, "tools", "implementation_type")

    expect(threadTableCount).toBe(1)
    expect(runTableCount).toBe(1)
    expect(assistantTableCount).toBe(1)
    expect(workspaceTableCount).toBe(1)
    expect(agentsTableCount).toBe(1)
    expect(timelineEventsTableCount).toBe(1)
    expect(graphLayoutsTableCount).toBe(1)
    expect(memoryEntriesTableCount).toBe(1)
    expect(ragSourcesTableCount).toBe(1)
    expect(ragChunksTableCount).toBe(1)
    expect(connectorsTableCount).toBe(1)
    expect(mcpServersTableCount).toBe(1)
    expect(workflowTemplatesTableCount).toBe(1)
    expect(templateScheduleRunsTableCount).toBe(1)
    expect(toolsTableCount).toBe(1)
    expect(zeroClawInstallationsTableCount).toBe(1)
    expect(zeroClawDeploymentsTableCount).toBe(1)
    expect(zeroClawRuntimeEventsTableCount).toBe(1)
    expect(zeroClawPolicyBindingsTableCount).toBe(1)
    expect(promptAssetsTableCount).toBe(1)
    expect(promptBindingsTableCount).toBe(1)
    expect(promptMaterializationsTableCount).toBe(1)
    expect(hasTemplateScheduleColumn).toBe(true)
    expect(hasTemplateTriggerColumn).toBe(true)
    expect(hasMemoryLockedColumn).toBe(true)
    expect(hasAgentSkillModeColumn).toBe(true)
    expect(hasAgentSkillsAllowlistColumn).toBe(true)
    expect(hasToolSourceColumn).toBe(true)
    expect(hasToolImplementationColumn).toBe(true)
    expect(migrationCount).toBe(14)
  })
})
