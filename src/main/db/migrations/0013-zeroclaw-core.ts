import type { Migration } from "./types"

export const migration0013ZeroClawCore: Migration = {
  id: "0013-zeroclaw-core",
  name: "Create ZeroClaw runtime, deployment, and policy tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS zeroclaw_installations (
        version TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'managed',
        install_path TEXT NOT NULL,
        binary_path TEXT NOT NULL,
        checksum_sha256 TEXT,
        status TEXT NOT NULL DEFAULT 'installed',
        last_error TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS zeroclaw_deployments (
        deployment_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        runtime_version TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        gateway_host TEXT NOT NULL DEFAULT '127.0.0.1',
        gateway_port INTEGER NOT NULL,
        api_base_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        desired_state TEXT NOT NULL DEFAULT 'stopped',
        env_json TEXT NOT NULL DEFAULT '{}',
        config_json TEXT NOT NULL DEFAULT '{}',
        policy_json TEXT NOT NULL DEFAULT '{}',
        effective_capabilities_json TEXT NOT NULL DEFAULT '{}',
        process_pid INTEGER,
        process_started_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS zeroclaw_runtime_events (
        event_id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL REFERENCES zeroclaw_deployments(deployment_id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        correlation_id TEXT,
        occurred_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS zeroclaw_policy_bindings (
        binding_id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL REFERENCES zeroclaw_deployments(deployment_id) ON DELETE CASCADE UNIQUE,
        mode TEXT NOT NULL,
        include_global_skills INTEGER NOT NULL DEFAULT 1,
        assigned_skill_ids TEXT NOT NULL DEFAULT '[]',
        assigned_tool_names TEXT NOT NULL DEFAULT '[]',
        assigned_connector_keys TEXT NOT NULL DEFAULT '[]',
        denied_tool_names TEXT NOT NULL DEFAULT '[]',
        denied_connector_keys TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(
      `CREATE INDEX IF NOT EXISTS idx_zeroclaw_deployments_workspace ON zeroclaw_deployments(workspace_id)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_zeroclaw_deployments_status ON zeroclaw_deployments(status)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_zeroclaw_installations_active ON zeroclaw_installations(is_active)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_zeroclaw_runtime_events_deployment_time ON zeroclaw_runtime_events(deployment_id, occurred_at DESC)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_zeroclaw_runtime_events_correlation ON zeroclaw_runtime_events(correlation_id)`
    )
  }
}
