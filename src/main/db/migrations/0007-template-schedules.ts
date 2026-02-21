import type { Migration } from "./types"

export const migration0007TemplateSchedules: Migration = {
  id: "0007-template-schedules",
  name: "Add workflow template schedule metadata",
  up: (db) => {
    db.run("ALTER TABLE workflow_templates ADD COLUMN schedule_config TEXT NOT NULL DEFAULT '{}'")
  }
}
