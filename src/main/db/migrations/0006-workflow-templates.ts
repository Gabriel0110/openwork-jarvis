import type { Migration } from "./types"

export const migration0006WorkflowTemplates: Migration = {
  id: "0006-workflow-templates",
  name: "Create workflow template registry tables",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_templates (
        template_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        starter_prompts TEXT NOT NULL DEFAULT '[]',
        agent_ids TEXT NOT NULL DEFAULT '[]',
        required_connector_keys TEXT NOT NULL DEFAULT '[]',
        expected_artifacts TEXT NOT NULL DEFAULT '[]',
        default_speaker_type TEXT NOT NULL DEFAULT 'orchestrator',
        default_speaker_agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
        default_model_id TEXT,
        policy_defaults TEXT NOT NULL DEFAULT '[]',
        memory_defaults TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(
      `CREATE INDEX IF NOT EXISTS idx_workflow_templates_workspace ON workflow_templates(workspace_id)`
    )
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_workspace_name ON workflow_templates(workspace_id, name)`
    )
  }
}
