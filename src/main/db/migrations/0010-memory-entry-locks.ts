import type { Migration } from "./types"

export const migration0010MemoryEntryLocks: Migration = {
  id: "0010-memory-entry-locks",
  name: "Add memory entry lock flag",
  up: (db) => {
    db.run("ALTER TABLE memory_entries ADD COLUMN locked INTEGER NOT NULL DEFAULT 0")
  }
}
