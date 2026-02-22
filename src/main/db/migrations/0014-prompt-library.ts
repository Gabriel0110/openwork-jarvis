import type { Migration } from "./types"

export const migration0014PromptLibrary: Migration = {
  id: "0014-prompt-library",
  name: "Create prompt asset, binding, and materialization tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS prompt_assets (
        asset_id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        file_name TEXT NOT NULL,
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        content_path TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        variables_json TEXT NOT NULL DEFAULT '[]',
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS prompt_bindings (
        binding_id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES prompt_assets(asset_id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_agent_id TEXT REFERENCES agents(agent_id) ON DELETE CASCADE,
        materialize_mode TEXT NOT NULL,
        relative_output_path TEXT,
        sync_mode TEXT NOT NULL DEFAULT 'managed',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_materialized_hash TEXT,
        last_asset_hash TEXT,
        last_materialized_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS prompt_materializations (
        materialization_id TEXT PRIMARY KEY,
        binding_id TEXT NOT NULL REFERENCES prompt_bindings(binding_id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        resolved_path TEXT NOT NULL,
        before_hash TEXT,
        after_hash TEXT,
        asset_hash TEXT,
        message TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_assets_scope_slug_source ON prompt_assets(scope, IFNULL(workspace_id, ''), slug, source)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_prompt_assets_source_scope ON prompt_assets(source, scope)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_prompt_bindings_workspace_target ON prompt_bindings(workspace_id, target_type, target_agent_id)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_prompt_bindings_asset ON prompt_bindings(asset_id, enabled)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_prompt_materializations_binding_created ON prompt_materializations(binding_id, created_at DESC)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_prompt_materializations_workspace_created ON prompt_materializations(workspace_id, created_at DESC)"
    )
  }
}
