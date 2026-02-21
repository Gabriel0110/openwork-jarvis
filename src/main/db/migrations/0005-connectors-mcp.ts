import type { Migration } from "./types"

export const migration0005ConnectorsMcp: Migration = {
  id: "0005-connectors-mcp",
  name: "Create connector and MCP server registry tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS connectors (
        connector_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'disconnected',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_connectors_workspace ON connectors(workspace_id)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_connectors_workspace_key ON connectors(workspace_id, key)`
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        server_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'stopped',
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace ON mcp_servers(workspace_id)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_workspace_name ON mcp_servers(workspace_id, name)`
    )
  }
}
