import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"

export const DEFAULT_WORKSPACE_ID = "default-workspace"

export interface WorkspaceRow {
  workspace_id: string
  name: string
  root_path: string | null
  created_at: number
  updated_at: number
}

export function getAllWorkspaces(): WorkspaceRow[] {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC")
  const workspaces: WorkspaceRow[] = []

  while (stmt.step()) {
    workspaces.push(stmt.getAsObject() as unknown as WorkspaceRow)
  }
  stmt.free()

  return workspaces
}

export function getWorkspace(workspaceId: string): WorkspaceRow | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM workspaces WHERE workspace_id = ?")
  stmt.bind([workspaceId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const workspace = stmt.getAsObject() as unknown as WorkspaceRow
  stmt.free()
  return workspace
}

export function createWorkspace(name: string, rootPath?: string | null): WorkspaceRow {
  const database = getDb()
  const now = Date.now()
  const workspaceId = uuid()

  database.run(
    `INSERT INTO workspaces (workspace_id, name, root_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [workspaceId, name, rootPath ?? null, now, now]
  )

  scheduleDatabaseSave()

  return {
    workspace_id: workspaceId,
    name,
    root_path: rootPath ?? null,
    created_at: now,
    updated_at: now
  }
}

export function ensureDefaultWorkspace(): WorkspaceRow {
  const existing = getWorkspace(DEFAULT_WORKSPACE_ID)
  if (existing) {
    return existing
  }

  const database = getDb()
  const now = Date.now()
  database.run(
    `INSERT INTO workspaces (workspace_id, name, root_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [DEFAULT_WORKSPACE_ID, "Default Workspace", null, now, now]
  )

  scheduleDatabaseSave()

  return {
    workspace_id: DEFAULT_WORKSPACE_ID,
    name: "Default Workspace",
    root_path: null,
    created_at: now,
    updated_at: now
  }
}
