import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  PromptAsset,
  PromptAssetScope,
  PromptAssetSource,
  PromptBinding,
  PromptBindingTargetType,
  PromptMaterializationRecord,
  PromptMaterializationStatus,
  PromptMaterializeMode,
  PromptSyncMode
} from "../types"

interface PromptAssetRow {
  asset_id: string
  workspace_id: string | null
  slug: string
  title: string
  description: string | null
  file_name: string
  scope: PromptAssetScope
  source: PromptAssetSource
  content_path: string
  tags_json: string
  variables_json: string
  is_system: number
  created_at: number
  updated_at: number
}

interface PromptBindingRow {
  binding_id: string
  asset_id: string
  workspace_id: string
  target_type: PromptBindingTargetType
  target_agent_id: string | null
  materialize_mode: PromptMaterializeMode
  relative_output_path: string | null
  sync_mode: PromptSyncMode
  enabled: number
  last_materialized_hash: string | null
  last_asset_hash: string | null
  last_materialized_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

interface PromptMaterializationRow {
  materialization_id: string
  binding_id: string
  workspace_id: string
  status: PromptMaterializationStatus
  resolved_path: string
  before_hash: string | null
  after_hash: string | null
  asset_hash: string | null
  message: string | null
  created_at: number
}

export interface CreatePromptAssetInput {
  workspaceId?: string
  slug: string
  title: string
  description?: string
  fileName: string
  scope: PromptAssetScope
  source: PromptAssetSource
  contentPath: string
  tags?: string[]
  variables?: string[]
  isSystem?: boolean
}

export interface UpdatePromptAssetInput {
  slug?: string
  title?: string
  description?: string
  fileName?: string
  contentPath?: string
  tags?: string[]
  variables?: string[]
}

export interface UpsertPromptAssetInput extends CreatePromptAssetInput {}

export interface CreatePromptBindingInput {
  assetId: string
  workspaceId: string
  targetType: PromptBindingTargetType
  targetAgentId?: string
  materializeMode: PromptMaterializeMode
  relativeOutputPath?: string
  syncMode?: PromptSyncMode
  enabled?: boolean
}

export interface UpdatePromptBindingInput {
  targetType?: PromptBindingTargetType
  targetAgentId?: string
  materializeMode?: PromptMaterializeMode
  relativeOutputPath?: string
  enabled?: boolean
}

export interface SetPromptBindingSyncStateInput {
  lastMaterializedHash?: string
  lastAssetHash?: string
  lastMaterializedAt?: number
  lastError?: string | null
}

export interface CreatePromptMaterializationInput {
  bindingId: string
  workspaceId: string
  status: PromptMaterializationStatus
  resolvedPath: string
  beforeHash?: string
  afterHash?: string
  assetHash?: string
  message?: string
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

function normalizeStringArray(values?: string[]): string[] {
  if (!values) {
    return []
  }

  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0)
  return Array.from(new Set(normalized))
}

function mapPromptAssetRow(row: PromptAssetRow): PromptAsset {
  return {
    id: row.asset_id,
    workspaceId: row.workspace_id || undefined,
    slug: row.slug,
    title: row.title,
    description: row.description || undefined,
    fileName: row.file_name,
    scope: row.scope,
    source: row.source,
    contentPath: row.content_path,
    tags: parseStringArray(row.tags_json),
    variables: parseStringArray(row.variables_json),
    isSystem: row.is_system === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapPromptBindingRow(row: PromptBindingRow): PromptBinding {
  const hasNeverMaterialized = !row.last_materialized_at
  const hasHashMismatch =
    !!row.last_materialized_hash &&
    !!row.last_asset_hash &&
    row.last_materialized_hash !== row.last_asset_hash

  let status: PromptBinding["status"] = "in_sync"
  if (row.last_error) {
    status = "failed"
  } else if (hasNeverMaterialized) {
    status = "never_applied"
  } else if (hasHashMismatch) {
    status = "conflict"
  }

  return {
    id: row.binding_id,
    assetId: row.asset_id,
    workspaceId: row.workspace_id,
    targetType: row.target_type,
    targetAgentId: row.target_agent_id || undefined,
    materializeMode: row.materialize_mode,
    relativeOutputPath: row.relative_output_path || undefined,
    syncMode: row.sync_mode,
    enabled: row.enabled === 1,
    lastMaterializedHash: row.last_materialized_hash || undefined,
    lastAssetHash: row.last_asset_hash || undefined,
    lastMaterializedAt: row.last_materialized_at ? new Date(row.last_materialized_at) : undefined,
    lastError: row.last_error || undefined,
    status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapPromptMaterializationRow(row: PromptMaterializationRow): PromptMaterializationRecord {
  return {
    id: row.materialization_id,
    bindingId: row.binding_id,
    workspaceId: row.workspace_id,
    status: row.status,
    resolvedPath: row.resolved_path,
    beforeHash: row.before_hash || undefined,
    afterHash: row.after_hash || undefined,
    assetHash: row.asset_hash || undefined,
    message: row.message || undefined,
    createdAt: new Date(row.created_at)
  }
}

function getPromptAssetByUniqueKey(
  scope: PromptAssetScope,
  workspaceId: string | undefined,
  slug: string,
  source: PromptAssetSource
): PromptAssetRow | null {
  const database = getDb()
  const stmt = database.prepare(
    `SELECT *
     FROM prompt_assets
     WHERE scope = ? AND IFNULL(workspace_id, '') = ? AND slug = ? AND source = ?
     LIMIT 1`
  )
  stmt.bind([scope, workspaceId || "", slug, source])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as PromptAssetRow
  stmt.free()
  return row
}

function getPromptBindingRow(bindingId: string): PromptBindingRow | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM prompt_bindings WHERE binding_id = ? LIMIT 1")
  stmt.bind([bindingId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as PromptBindingRow
  stmt.free()
  return row
}

export function listPromptAssets(workspaceId?: string): PromptAsset[] {
  const database = getDb()
  const params: (string | number)[] = []

  let sql = "SELECT * FROM prompt_assets"
  if (workspaceId) {
    sql += " WHERE scope = 'global' OR workspace_id = ?"
    params.push(workspaceId)
  }
  sql += " ORDER BY updated_at DESC"

  const stmt = database.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }

  const rows: PromptAsset[] = []
  while (stmt.step()) {
    rows.push(mapPromptAssetRow(stmt.getAsObject() as unknown as PromptAssetRow))
  }
  stmt.free()
  return rows
}

export function listPromptAssetsBySource(source: PromptAssetSource): PromptAsset[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM prompt_assets WHERE source = ? ORDER BY updated_at DESC, slug ASC"
  )
  stmt.bind([source])

  const rows: PromptAsset[] = []
  while (stmt.step()) {
    rows.push(mapPromptAssetRow(stmt.getAsObject() as unknown as PromptAssetRow))
  }
  stmt.free()
  return rows
}

export function getPromptAsset(assetId: string): PromptAsset | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM prompt_assets WHERE asset_id = ?")
  stmt.bind([assetId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = mapPromptAssetRow(stmt.getAsObject() as unknown as PromptAssetRow)
  stmt.free()
  return row
}

export function createPromptAsset(input: CreatePromptAssetInput): PromptAsset {
  const database = getDb()
  const now = Date.now()
  const assetId = uuid()

  database.run(
    `INSERT INTO prompt_assets (
      asset_id, workspace_id, slug, title, description, file_name, scope, source, content_path,
      tags_json, variables_json, is_system, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assetId,
      input.workspaceId || null,
      input.slug,
      input.title,
      input.description || null,
      input.fileName,
      input.scope,
      input.source,
      input.contentPath,
      JSON.stringify(normalizeStringArray(input.tags)),
      JSON.stringify(normalizeStringArray(input.variables)),
      input.isSystem ? 1 : 0,
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getPromptAsset(assetId) as PromptAsset
}

export function upsertPromptAsset(input: UpsertPromptAssetInput): PromptAsset {
  const database = getDb()
  const now = Date.now()
  const existing = getPromptAssetByUniqueKey(
    input.scope,
    input.workspaceId,
    input.slug,
    input.source
  )

  if (!existing) {
    return createPromptAsset(input)
  }

  database.run(
    `UPDATE prompt_assets
     SET title = ?, description = ?, file_name = ?, content_path = ?, tags_json = ?, variables_json = ?,
         is_system = ?, updated_at = ?
     WHERE asset_id = ?`,
    [
      input.title,
      input.description || null,
      input.fileName,
      input.contentPath,
      JSON.stringify(normalizeStringArray(input.tags)),
      JSON.stringify(normalizeStringArray(input.variables)),
      input.isSystem ? 1 : 0,
      now,
      existing.asset_id
    ]
  )

  scheduleDatabaseSave()
  return getPromptAsset(existing.asset_id) as PromptAsset
}

export function updatePromptAsset(
  assetId: string,
  updates: UpdatePromptAssetInput
): PromptAsset | null {
  const existing = getPromptAsset(assetId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()

  database.run(
    `UPDATE prompt_assets
     SET slug = ?, title = ?, description = ?, file_name = ?, content_path = ?, tags_json = ?,
         variables_json = ?, updated_at = ?
     WHERE asset_id = ?`,
    [
      updates.slug ?? existing.slug,
      updates.title ?? existing.title,
      updates.description === undefined
        ? existing.description || null
        : updates.description || null,
      updates.fileName ?? existing.fileName,
      updates.contentPath ?? existing.contentPath,
      JSON.stringify(updates.tags ? normalizeStringArray(updates.tags) : existing.tags),
      JSON.stringify(
        updates.variables ? normalizeStringArray(updates.variables) : existing.variables
      ),
      now,
      assetId
    ]
  )

  scheduleDatabaseSave()
  return getPromptAsset(assetId)
}

export function deletePromptAsset(assetId: string): void {
  const database = getDb()
  database.run("DELETE FROM prompt_assets WHERE asset_id = ?", [assetId])
  scheduleDatabaseSave()
}

export function deletePromptAssetsBySourceExcept(
  source: PromptAssetSource,
  keepKeys: Set<string>
): void {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT asset_id, scope, IFNULL(workspace_id, '') as workspace_id, slug FROM prompt_assets WHERE source = ?"
  )
  stmt.bind([source])

  const deleteIds: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      asset_id: string
      scope: PromptAssetScope
      workspace_id: string
      slug: string
    }
    const key = `${row.scope}:${row.workspace_id}:${row.slug}`
    if (!keepKeys.has(key)) {
      deleteIds.push(row.asset_id)
    }
  }
  stmt.free()

  for (const assetId of deleteIds) {
    database.run("DELETE FROM prompt_assets WHERE asset_id = ?", [assetId])
  }
  if (deleteIds.length > 0) {
    scheduleDatabaseSave()
  }
}

export function listPromptBindings(workspaceId?: string): PromptBinding[] {
  const database = getDb()
  const params: string[] = []
  let sql = "SELECT * FROM prompt_bindings"
  if (workspaceId) {
    sql += " WHERE workspace_id = ?"
    params.push(workspaceId)
  }
  sql += " ORDER BY updated_at DESC"

  const stmt = database.prepare(sql)
  if (params.length > 0) {
    stmt.bind(params)
  }

  const rows: PromptBinding[] = []
  while (stmt.step()) {
    rows.push(mapPromptBindingRow(stmt.getAsObject() as unknown as PromptBindingRow))
  }
  stmt.free()
  return rows
}

export function getPromptBinding(bindingId: string): PromptBinding | null {
  const row = getPromptBindingRow(bindingId)
  return row ? mapPromptBindingRow(row) : null
}

export function createPromptBinding(input: CreatePromptBindingInput): PromptBinding {
  const database = getDb()
  const now = Date.now()
  const bindingId = uuid()

  database.run(
    `INSERT INTO prompt_bindings (
      binding_id, asset_id, workspace_id, target_type, target_agent_id, materialize_mode,
      relative_output_path, sync_mode, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bindingId,
      input.assetId,
      input.workspaceId,
      input.targetType,
      input.targetAgentId || null,
      input.materializeMode,
      input.relativeOutputPath || null,
      input.syncMode || "managed",
      input.enabled === false ? 0 : 1,
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getPromptBinding(bindingId) as PromptBinding
}

export function updatePromptBinding(
  bindingId: string,
  updates: UpdatePromptBindingInput
): PromptBinding | null {
  const existing = getPromptBinding(bindingId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()
  database.run(
    `UPDATE prompt_bindings
     SET target_type = ?, target_agent_id = ?, materialize_mode = ?, relative_output_path = ?,
         enabled = ?, updated_at = ?
     WHERE binding_id = ?`,
    [
      updates.targetType ?? existing.targetType,
      updates.targetAgentId === undefined
        ? existing.targetAgentId || null
        : updates.targetAgentId || null,
      updates.materializeMode ?? existing.materializeMode,
      updates.relativeOutputPath === undefined
        ? existing.relativeOutputPath || null
        : updates.relativeOutputPath || null,
      updates.enabled === undefined ? (existing.enabled ? 1 : 0) : updates.enabled ? 1 : 0,
      now,
      bindingId
    ]
  )

  scheduleDatabaseSave()
  return getPromptBinding(bindingId)
}

export function deletePromptBinding(bindingId: string): void {
  const database = getDb()
  database.run("DELETE FROM prompt_bindings WHERE binding_id = ?", [bindingId])
  scheduleDatabaseSave()
}

export function setPromptBindingSyncState(
  bindingId: string,
  input: SetPromptBindingSyncStateInput
): PromptBinding | null {
  const existing = getPromptBinding(bindingId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()
  database.run(
    `UPDATE prompt_bindings
     SET last_materialized_hash = ?, last_asset_hash = ?, last_materialized_at = ?, last_error = ?, updated_at = ?
     WHERE binding_id = ?`,
    [
      input.lastMaterializedHash === undefined
        ? existing.lastMaterializedHash || null
        : input.lastMaterializedHash || null,
      input.lastAssetHash === undefined
        ? existing.lastAssetHash || null
        : input.lastAssetHash || null,
      input.lastMaterializedAt === undefined
        ? existing.lastMaterializedAt?.getTime() || null
        : input.lastMaterializedAt || null,
      input.lastError === undefined ? existing.lastError || null : input.lastError,
      now,
      bindingId
    ]
  )

  scheduleDatabaseSave()
  return getPromptBinding(bindingId)
}

export function createPromptMaterializationRecord(
  input: CreatePromptMaterializationInput
): PromptMaterializationRecord {
  const database = getDb()
  const materializationId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO prompt_materializations (
      materialization_id, binding_id, workspace_id, status, resolved_path, before_hash, after_hash, asset_hash,
      message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      materializationId,
      input.bindingId,
      input.workspaceId,
      input.status,
      input.resolvedPath,
      input.beforeHash || null,
      input.afterHash || null,
      input.assetHash || null,
      input.message || null,
      now
    ]
  )

  scheduleDatabaseSave()
  return getPromptMaterializationRecord(materializationId) as PromptMaterializationRecord
}

export function getPromptMaterializationRecord(
  materializationId: string
): PromptMaterializationRecord | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM prompt_materializations WHERE materialization_id = ? LIMIT 1"
  )
  stmt.bind([materializationId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = mapPromptMaterializationRow(stmt.getAsObject() as unknown as PromptMaterializationRow)
  stmt.free()
  return row
}

export function listPromptMaterializations(params?: {
  workspaceId?: string
  bindingId?: string
  limit?: number
}): PromptMaterializationRecord[] {
  const database = getDb()
  const values: (string | number)[] = []
  const where: string[] = []

  if (params?.workspaceId) {
    where.push("workspace_id = ?")
    values.push(params.workspaceId)
  }
  if (params?.bindingId) {
    where.push("binding_id = ?")
    values.push(params.bindingId)
  }

  const limit = Math.max(1, Math.min(500, params?.limit || 100))
  values.push(limit)

  const sql = `SELECT * FROM prompt_materializations ${
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY created_at DESC LIMIT ?`
  const stmt = database.prepare(sql)
  stmt.bind(values)

  const rows: PromptMaterializationRecord[] = []
  while (stmt.step()) {
    rows.push(
      mapPromptMaterializationRow(stmt.getAsObject() as unknown as PromptMaterializationRow)
    )
  }
  stmt.free()
  return rows
}
