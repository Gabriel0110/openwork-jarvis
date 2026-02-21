import type { Migration } from "./types"

export const migration0008TemplateTriggers: Migration = {
  id: "0008-template-triggers",
  name: "Add workflow template trigger metadata",
  up: (db) => {
    db.run("ALTER TABLE workflow_templates ADD COLUMN trigger_config TEXT NOT NULL DEFAULT '[]'")
  }
}
