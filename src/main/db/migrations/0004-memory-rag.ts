import type { Migration } from "./types"

export const migration0004MemoryRag: Migration = {
  id: "0004-memory-rag",
  name: "Create memory and local RAG tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        entry_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
        thread_id TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
        title TEXT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(
      `CREATE INDEX IF NOT EXISTS idx_memory_entries_workspace_scope ON memory_entries(workspace_id, scope, updated_at DESC)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_entries_agent ON memory_entries(agent_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_entries_thread ON memory_entries(thread_id)`)

    db.run(`
      CREATE TABLE IF NOT EXISTS rag_sources (
        source_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        include_globs TEXT NOT NULL DEFAULT '[]',
        exclude_globs TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'idle',
        last_indexed_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_rag_sources_workspace ON rag_sources(workspace_id)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_sources_workspace_path ON rag_sources(workspace_id, path)`
    )

    db.run(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        chunk_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES rag_sources(source_id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_rag_chunks_workspace ON rag_chunks(workspace_id)`)
  }
}
