import type { Migration } from "./types"

function hasColumn(
  db: { prepare: (sql: string) => { step: () => boolean; get: () => unknown[]; free: () => void } },
  tableName: string,
  columnName: string
): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${tableName})`)
  let found = false
  while (stmt.step()) {
    const row = stmt.get()
    if (String(row[1] ?? "") === columnName) {
      found = true
      break
    }
  }
  stmt.free()
  return found
}

export const migration0011AgentSkills: Migration = {
  id: "0011-agent-skills",
  name: "Add per-agent skill mode and allowlist",
  up: (db) => {
    if (!hasColumn(db, "agents", "skill_mode")) {
      db.run(`ALTER TABLE agents ADD COLUMN skill_mode TEXT NOT NULL DEFAULT 'global_only'`)
    }
    if (!hasColumn(db, "agents", "skills_allowlist")) {
      db.run(`ALTER TABLE agents ADD COLUMN skills_allowlist TEXT NOT NULL DEFAULT '[]'`)
    }
  }
}
