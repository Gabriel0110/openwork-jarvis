import type { Migration } from "./types"

export const migration0009TemplateScheduleRuns: Migration = {
  id: "0009-template-schedule-runs",
  name: "Create workflow template schedule run audit table",
  up: (db) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS template_schedule_runs (
        schedule_run_id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES workflow_templates(template_id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        scheduled_for INTEGER NOT NULL,
        status TEXT NOT NULL,
        run_thread_id TEXT REFERENCES threads(thread_id) ON DELETE SET NULL,
        missing_connectors TEXT NOT NULL DEFAULT '[]',
        error_message TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_template_schedule_runs_unique ON template_schedule_runs(template_id, scheduled_for)"
    )
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_template_schedule_runs_workspace_created ON template_schedule_runs(workspace_id, created_at DESC)"
    )
  }
}
