import { getDb, scheduleDatabaseSave } from "./index"

export interface GraphLayoutRow {
  workspace_id: string
  agent_id: string
  x: number
  y: number
  updated_at: number
}

export interface UpsertGraphLayoutInput {
  workspaceId: string
  agentId: string
  x: number
  y: number
}

function mapRow(row: GraphLayoutRow) {
  return {
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    x: row.x,
    y: row.y,
    updatedAt: new Date(row.updated_at)
  }
}

export function listGraphLayoutByWorkspace(workspaceId: string) {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM graph_layouts WHERE workspace_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([workspaceId])

  const rows: ReturnType<typeof mapRow>[] = []
  while (stmt.step()) {
    rows.push(mapRow(stmt.getAsObject() as unknown as GraphLayoutRow))
  }
  stmt.free()

  return rows
}

export function upsertGraphLayout(input: UpsertGraphLayoutInput) {
  const database = getDb()
  const now = Date.now()

  database.run(
    `INSERT INTO graph_layouts (workspace_id, agent_id, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, agent_id)
     DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`,
    [input.workspaceId, input.agentId, input.x, input.y, now]
  )

  scheduleDatabaseSave()

  return {
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    x: input.x,
    y: input.y,
    updatedAt: new Date(now)
  }
}

export function clearGraphLayoutByWorkspace(workspaceId: string): void {
  const database = getDb()
  database.run("DELETE FROM graph_layouts WHERE workspace_id = ?", [workspaceId])
  scheduleDatabaseSave()
}
