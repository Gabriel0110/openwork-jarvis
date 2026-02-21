import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  MemoryEntry,
  MemoryEntryScope,
  MemorySearchResult,
  RagSource,
  RagSourceStatus
} from "../types"

interface MemoryEntryRow {
  entry_id: string
  workspace_id: string
  scope: MemoryEntryScope
  agent_id: string | null
  thread_id: string | null
  title: string | null
  content: string
  tags: string
  source: string
  locked: number
  created_at: number
  updated_at: number
}

interface RagSourceRow {
  source_id: string
  workspace_id: string
  path: string
  enabled: number
  include_globs: string
  exclude_globs: string
  status: RagSourceStatus
  last_indexed_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

interface RagChunkRow {
  chunk_id: string
  source_id: string
  workspace_id: string
  path: string
  chunk_index: number
  content: string
  token_estimate: number
  created_at: number
}

export interface ListMemoryEntriesInput {
  workspaceId: string
  scope?: MemoryEntryScope
  agentId?: string
  threadId?: string
  limit?: number
}

export interface CreateMemoryEntryInput {
  workspaceId: string
  scope: MemoryEntryScope
  agentId?: string
  threadId?: string
  title?: string
  content: string
  tags?: string[]
  source?: string
  locked?: boolean
}

export interface UpsertRagSourceInput {
  sourceId?: string
  workspaceId: string
  path: string
  enabled?: boolean
  includeGlobs?: string[]
  excludeGlobs?: string[]
}

export interface SetRagSourceStatusInput {
  sourceId: string
  status: RagSourceStatus
  lastError?: string | null
  lastIndexedAt?: number | null
}

interface SearchCandidate {
  result: MemorySearchResult
  text: string
}

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

function mapMemoryRow(row: MemoryEntryRow): MemoryEntry {
  return {
    id: row.entry_id,
    workspaceId: row.workspace_id,
    scope: row.scope,
    agentId: row.agent_id || undefined,
    threadId: row.thread_id || undefined,
    title: row.title || undefined,
    content: row.content,
    tags: parseStringArray(row.tags),
    source: row.source,
    locked: row.locked === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapRagSourceRow(row: RagSourceRow): RagSource {
  return {
    id: row.source_id,
    workspaceId: row.workspace_id,
    path: row.path,
    enabled: row.enabled === 1,
    includeGlobs: parseStringArray(row.include_globs),
    excludeGlobs: parseStringArray(row.exclude_globs),
    status: row.status,
    lastIndexedAt: row.last_indexed_at ? new Date(row.last_indexed_at) : undefined,
    lastError: row.last_error || undefined,
    chunkCount: countRagChunksBySource(row.source_id),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function normalizeTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .slice(0, 8)
}

function countTokenOccurrences(text: string, token: string): number {
  if (!text || !token) {
    return 0
  }
  let count = 0
  let offset = 0
  while (offset < text.length) {
    const index = text.indexOf(token, offset)
    if (index < 0) {
      break
    }
    count += 1
    offset = index + token.length
  }
  return count
}

function scoreText(text: string, tokens: string[]): number {
  const normalized = text.toLowerCase()
  return tokens.reduce((score, token) => score + countTokenOccurrences(normalized, token), 0)
}

function snippetForText(text: string, tokens: string[]): string {
  if (!text) {
    return ""
  }
  const normalized = text.toLowerCase()
  const token = tokens.find((item) => normalized.includes(item))
  if (!token) {
    return text.slice(0, 220)
  }

  const index = normalized.indexOf(token)
  const start = Math.max(0, index - 80)
  const end = Math.min(text.length, index + 180)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < text.length ? "..." : ""
  return `${prefix}${text.slice(start, end)}${suffix}`
}

export function listMemoryEntries(input: ListMemoryEntriesInput): MemoryEntry[] {
  const database = getDb()
  const limit = Math.max(1, Math.min(input.limit || 300, 1000))

  const whereClauses = ["workspace_id = ?"]
  const values: Array<string | number> = [input.workspaceId]

  if (input.scope) {
    whereClauses.push("scope = ?")
    values.push(input.scope)
  }
  if (input.agentId) {
    whereClauses.push("agent_id = ?")
    values.push(input.agentId)
  }
  if (input.threadId) {
    whereClauses.push("thread_id = ?")
    values.push(input.threadId)
  }

  const stmt = database.prepare(
    `SELECT * FROM memory_entries
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT ?`
  )
  stmt.bind([...values, limit])

  const rows: MemoryEntry[] = []
  while (stmt.step()) {
    rows.push(mapMemoryRow(stmt.getAsObject() as unknown as MemoryEntryRow))
  }
  stmt.free()

  return rows
}

export function getMemoryEntry(entryId: string): MemoryEntry | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM memory_entries WHERE entry_id = ?")
  stmt.bind([entryId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = mapMemoryRow(stmt.getAsObject() as unknown as MemoryEntryRow)
  stmt.free()
  return row
}

export function createMemoryEntry(input: CreateMemoryEntryInput): MemoryEntry {
  const database = getDb()
  const now = Date.now()
  const entryId = uuid()
  const title = input.title?.trim() || null

  database.run(
    `INSERT INTO memory_entries (
      entry_id, workspace_id, scope, agent_id, thread_id, title, content, tags, source, locked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entryId,
      input.workspaceId,
      input.scope,
      input.agentId || null,
      input.threadId || null,
      title,
      input.content,
      JSON.stringify(input.tags || []),
      input.source || "manual",
      input.locked ? 1 : 0,
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getMemoryEntry(entryId) as MemoryEntry
}

export function deleteMemoryEntry(entryId: string): void {
  const existing = getMemoryEntry(entryId)
  if (existing?.locked) {
    throw new Error("Cannot delete a locked memory entry.")
  }

  const database = getDb()
  database.run("DELETE FROM memory_entries WHERE entry_id = ?", [entryId])
  scheduleDatabaseSave()
}

export function setMemoryEntryLocked(entryId: string, locked: boolean): MemoryEntry | null {
  const existing = getMemoryEntry(entryId)
  if (!existing) {
    return null
  }

  const database = getDb()
  database.run("UPDATE memory_entries SET locked = ?, updated_at = ? WHERE entry_id = ?", [
    locked ? 1 : 0,
    Date.now(),
    entryId
  ])
  scheduleDatabaseSave()
  return getMemoryEntry(entryId)
}

export function listRagSources(workspaceId: string): RagSource[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM rag_sources WHERE workspace_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([workspaceId])

  const sources: RagSource[] = []
  while (stmt.step()) {
    sources.push(mapRagSourceRow(stmt.getAsObject() as unknown as RagSourceRow))
  }
  stmt.free()

  return sources
}

export function listRagSourcesByIds(workspaceId: string, sourceIds: string[]): RagSource[] {
  if (sourceIds.length === 0) {
    return []
  }

  const database = getDb()
  const placeholders = sourceIds.map(() => "?").join(", ")
  const stmt = database.prepare(
    `SELECT * FROM rag_sources WHERE workspace_id = ? AND source_id IN (${placeholders}) ORDER BY updated_at DESC`
  )
  stmt.bind([workspaceId, ...sourceIds])

  const sources: RagSource[] = []
  while (stmt.step()) {
    sources.push(mapRagSourceRow(stmt.getAsObject() as unknown as RagSourceRow))
  }
  stmt.free()

  return sources
}

export function getRagSource(sourceId: string): RagSource | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM rag_sources WHERE source_id = ?")
  stmt.bind([sourceId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const source = mapRagSourceRow(stmt.getAsObject() as unknown as RagSourceRow)
  stmt.free()
  return source
}

export function upsertRagSource(input: UpsertRagSourceInput): RagSource {
  const database = getDb()
  const now = Date.now()
  const existing = input.sourceId ? getRagSource(input.sourceId) : null
  const sourceId = input.sourceId || uuid()
  const normalizedPath = input.path.trim()
  if (!normalizedPath) {
    throw new Error("RAG source path is required.")
  }

  if (existing) {
    database.run(
      `UPDATE rag_sources
       SET path = ?, enabled = ?, include_globs = ?, exclude_globs = ?, updated_at = ?
       WHERE source_id = ?`,
      [
        normalizedPath,
        input.enabled === undefined ? (existing.enabled ? 1 : 0) : input.enabled ? 1 : 0,
        JSON.stringify(input.includeGlobs || existing.includeGlobs),
        JSON.stringify(input.excludeGlobs || existing.excludeGlobs),
        now,
        sourceId
      ]
    )
  } else {
    database.run(
      `INSERT INTO rag_sources (
        source_id, workspace_id, path, enabled, include_globs, exclude_globs, status,
        last_indexed_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceId,
        input.workspaceId,
        normalizedPath,
        input.enabled === false ? 0 : 1,
        JSON.stringify(input.includeGlobs || []),
        JSON.stringify(input.excludeGlobs || []),
        "idle",
        null,
        null,
        now,
        now
      ]
    )
  }

  scheduleDatabaseSave()
  return getRagSource(sourceId) as RagSource
}

export function deleteRagSource(sourceId: string): void {
  const database = getDb()
  database.run("DELETE FROM rag_sources WHERE source_id = ?", [sourceId])
  scheduleDatabaseSave()
}

export function setRagSourceStatus(input: SetRagSourceStatusInput): void {
  const database = getDb()
  const now = Date.now()
  database.run(
    `UPDATE rag_sources
     SET status = ?, last_error = ?, last_indexed_at = ?, updated_at = ?
     WHERE source_id = ?`,
    [input.status, input.lastError ?? null, input.lastIndexedAt ?? null, now, input.sourceId]
  )
  scheduleDatabaseSave()
}

export interface RagChunkInput {
  path: string
  content: string
}

export function replaceRagChunks(
  sourceId: string,
  workspaceId: string,
  chunks: RagChunkInput[]
): number {
  const database = getDb()
  const now = Date.now()

  database.run("DELETE FROM rag_chunks WHERE source_id = ?", [sourceId])

  let inserted = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const content = chunks[index].content.trim()
    if (!content) {
      continue
    }

    const path = chunks[index].path

    const tokenEstimate = content.split(/\s+/).filter(Boolean).length
    database.run(
      `INSERT INTO rag_chunks (
        chunk_id, source_id, workspace_id, path, chunk_index, content, token_estimate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), sourceId, workspaceId, path, index, content, tokenEstimate, now]
    )
    inserted += 1
  }

  scheduleDatabaseSave()
  return inserted
}

export function countRagChunksBySource(sourceId: string): number {
  const database = getDb()
  const stmt = database.prepare("SELECT COUNT(*) AS count FROM rag_chunks WHERE source_id = ?")
  stmt.bind([sourceId])
  if (!stmt.step()) {
    stmt.free()
    return 0
  }
  const row = stmt.getAsObject() as { count?: number }
  stmt.free()
  return Number(row.count || 0)
}

export function searchMemoryAndRag(
  workspaceId: string,
  query: string,
  limit: number = 8
): MemorySearchResult[] {
  const tokens = normalizeTokens(query)
  if (tokens.length === 0) {
    return []
  }

  const database = getDb()
  const likeValues = tokens.flatMap((token) => [`%${token}%`, `%${token}%`])
  const limitPerSource = Math.max(12, limit * 5)

  const memoryStmt = database.prepare(
    `SELECT * FROM memory_entries
     WHERE workspace_id = ?
       AND (${tokens.map(() => "(LOWER(content) LIKE ? OR LOWER(COALESCE(title, '')) LIKE ?)").join(" OR ")})
     ORDER BY updated_at DESC
     LIMIT ?`
  )
  memoryStmt.bind([workspaceId, ...likeValues, limitPerSource])

  const memoryCandidates: SearchCandidate[] = []
  while (memoryStmt.step()) {
    const row = memoryStmt.getAsObject() as unknown as MemoryEntryRow
    const entry = mapMemoryRow(row)
    memoryCandidates.push({
      result: {
        source: "memory",
        id: entry.id,
        score: 0,
        title: entry.title,
        contentSnippet: "",
        scope: entry.scope,
        agentId: entry.agentId,
        threadId: entry.threadId,
        createdAt: entry.updatedAt
      },
      text: `${entry.title || ""}\n${entry.content}`
    })
  }
  memoryStmt.free()

  const ragStmt = database.prepare(
    `SELECT * FROM rag_chunks
     WHERE workspace_id = ?
       AND (${tokens.map(() => "(LOWER(content) LIKE ? OR LOWER(path) LIKE ?)").join(" OR ")})
     ORDER BY created_at DESC
     LIMIT ?`
  )
  ragStmt.bind([workspaceId, ...likeValues, limitPerSource])

  const ragCandidates: SearchCandidate[] = []
  while (ragStmt.step()) {
    const row = ragStmt.getAsObject() as unknown as RagChunkRow
    ragCandidates.push({
      result: {
        source: "rag",
        id: row.chunk_id,
        score: 0,
        contentSnippet: "",
        path: row.path,
        createdAt: new Date(row.created_at)
      },
      text: row.content
    })
  }
  ragStmt.free()

  const scored = [...memoryCandidates, ...ragCandidates]
    .map((candidate) => {
      const score = scoreText(candidate.text, tokens)
      if (score <= 0) {
        return null
      }
      return {
        ...candidate.result,
        score,
        contentSnippet: snippetForText(candidate.text, tokens)
      }
    })
    .filter((candidate): candidate is MemorySearchResult => candidate !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.createdAt.getTime() - left.createdAt.getTime()
    })

  return scored.slice(0, Math.max(1, Math.min(limit, 20)))
}
