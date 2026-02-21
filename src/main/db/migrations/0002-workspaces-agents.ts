import type { Migration } from "./types"

export const migration0002WorkspacesAgents: Migration = {
  id: "0002-workspaces-agents",
  name: "Create workspace and agent registry tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        tool_allowlist TEXT NOT NULL DEFAULT '[]',
        connector_allowlist TEXT NOT NULL DEFAULT '[]',
        memory_scope TEXT NOT NULL DEFAULT 'private',
        tags TEXT NOT NULL DEFAULT '[]',
        is_orchestrator INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON agents(workspace_id)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_workspace_name ON agents(workspace_id, name)`
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS agent_policies (
        policy_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
        resource_type TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        action TEXT NOT NULL,
        scope TEXT NOT NULL,
        decision TEXT NOT NULL,
        constraints TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_agent_policies_agent_id ON agent_policies(agent_id)`)

    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)`)

    db.run(`
      CREATE TABLE IF NOT EXISTS session_participants (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'participant',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, agent_id)
      )
    `)
  }
}
