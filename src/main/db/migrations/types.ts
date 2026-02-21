import type { Database as SqlJsDatabase } from "sql.js"

export interface Migration {
  id: string
  name: string
  up: (db: SqlJsDatabase) => void
}
