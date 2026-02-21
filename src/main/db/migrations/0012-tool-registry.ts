import type { Migration } from "./types"

export const migration0012ToolRegistry: Migration = {
  id: "0012-tool-registry",
  name: "Create tool registry table",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS tools (
        tool_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        risk_tier INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'custom',
        implementation_type TEXT NOT NULL DEFAULT 'script',
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_tools_workspace ON tools(workspace_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_tools_workspace_enabled ON tools(workspace_id, enabled)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_workspace_name ON tools(workspace_id, name)`
    )
  }
}
