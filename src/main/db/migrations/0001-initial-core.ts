import type { Migration } from "./types"

export const migration0001InitialCore: Migration = {
  id: "0001-initial-core",
  name: "Create core thread, run, and assistant tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT,
        status TEXT DEFAULT 'idle',
        thread_values TEXT,
        title TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        thread_id TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
        assistant_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT,
        metadata TEXT,
        kwargs TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS assistants (
        assistant_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        name TEXT,
        model TEXT DEFAULT 'claude-sonnet-4-5-20250929',
        config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`)
  }
}
