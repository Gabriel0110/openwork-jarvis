import type { Migration } from "./types"

export const migration0003TimelineGraph: Migration = {
  id: "0003-timeline-graph",
  name: "Create timeline events and graph layout tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS timeline_events (
        event_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source_agent_id TEXT,
        target_agent_id TEXT,
        tool_name TEXT,
        summary TEXT,
        payload TEXT,
        dedupe_key TEXT UNIQUE,
        occurred_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_timeline_events_thread ON timeline_events(thread_id)`)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_timeline_events_occurred ON timeline_events(thread_id, occurred_at DESC)`
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS graph_layouts (
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, agent_id)
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_graph_layouts_workspace ON graph_layouts(workspace_id)`)
  }
}
