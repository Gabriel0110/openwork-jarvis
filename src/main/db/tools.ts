import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import { DEFAULT_WORKSPACE_ID } from "./workspaces"
import { DEFAULT_TOOL_REGISTRY, SYSTEM_TOOL_NAMES } from "../services/default-tool-registry"
import type {
  PolicyAction,
  ToolCategory,
  ToolDefinition,
  ToolImplementationType,
  ToolRiskTier,
  ToolSource
} from "../types"

interface ToolRow {
  tool_id: string
  workspace_id: string
  name: string
  display_name: string
  description: string
  category: ToolCategory
  action: PolicyAction
  risk_tier: number
  source: ToolSource
  implementation_type: ToolImplementationType
  config: string
  enabled: number
  created_at: number
  updated_at: number
}

export interface CreateToolInput {
  workspaceId?: string
  name: string
  displayName: string
  description: string
  category?: ToolCategory
  action: PolicyAction
  riskTier: ToolRiskTier
  implementationType?: ToolImplementationType
  config?: Record<string, unknown>
  enabled?: boolean
}

export interface UpdateToolInput {
  name?: string
  displayName?: string
  description?: string
  category?: ToolCategory
  action?: PolicyAction
  riskTier?: ToolRiskTier
  implementationType?: ToolImplementationType
  config?: Record<string, unknown>
  enabled?: boolean
}

const TOOL_CATEGORY_SET = new Set([
  "filesystem",
  "execution",
  "network",
  "connector",
  "memory",
  "skills",
  "custom"
])
const TOOL_ACTION_SET = new Set(["read", "write", "exec", "post"])
const TOOL_SOURCE_SET = new Set(["system", "custom"])
const TOOL_IMPLEMENTATION_SET = new Set(["builtin", "script"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {}
  }
  return value
}

function parseConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // no-op
  }
  return {}
}

function mapRowToToolDefinition(row: ToolRow): ToolDefinition {
  return {
    id: row.tool_id,
    workspaceId: row.workspace_id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    action: row.action,
    riskTier: Math.max(0, Math.min(3, Number(row.risk_tier))) as ToolRiskTier,
    source: row.source,
    implementationType: row.implementation_type,
    config: parseConfig(row.config),
    enabled: row.enabled === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_")
}

function validateRiskTier(value: number): ToolRiskTier {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error("Tool risk tier must be an integer from 0 to 3.")
  }
  return parsed as ToolRiskTier
}

function validateToolInput(
  input: {
    name: string
    displayName: string
    description: string
    category: ToolCategory
    action: PolicyAction
    riskTier: ToolRiskTier
    source: ToolSource
    implementationType: ToolImplementationType
    config: Record<string, unknown>
  },
  existingSource?: ToolSource
): void {
  if (!input.name) {
    throw new Error("Tool name is required.")
  }
  if (!input.displayName) {
    throw new Error("Tool display name is required.")
  }
  if (!input.description) {
    throw new Error("Tool description is required.")
  }
  if (!TOOL_CATEGORY_SET.has(input.category)) {
    throw new Error("Tool category is invalid.")
  }
  if (!TOOL_ACTION_SET.has(input.action)) {
    throw new Error("Tool action is invalid.")
  }
  validateRiskTier(input.riskTier)
  if (!TOOL_SOURCE_SET.has(input.source)) {
    throw new Error("Tool source is invalid.")
  }
  if (!TOOL_IMPLEMENTATION_SET.has(input.implementationType)) {
    throw new Error("Tool implementation type is invalid.")
  }

  if (input.source === "custom" && SYSTEM_TOOL_NAMES.has(input.name)) {
    throw new Error(`Custom tool name "${input.name}" conflicts with a system tool.`)
  }

  if (input.source === "custom" && input.implementationType !== "script") {
    throw new Error("Custom tools currently support only script implementation.")
  }

  if (input.source === "custom" && input.implementationType === "script") {
    const template = input.config.commandTemplate
    if (typeof template !== "string" || template.trim().length === 0) {
      throw new Error("Script tools require config.commandTemplate (non-empty string).")
    }
  }

  if (existingSource === "system" && input.source !== "system") {
    throw new Error("System tools cannot be reclassified.")
  }
}

export function listTools(workspaceId: string, includeDisabled = true): ToolDefinition[] {
  const database = getDb()
  const query = includeDisabled
    ? "SELECT * FROM tools WHERE workspace_id = ? ORDER BY source ASC, risk_tier DESC, name ASC"
    : "SELECT * FROM tools WHERE workspace_id = ? AND enabled = 1 ORDER BY source ASC, risk_tier DESC, name ASC"
  const stmt = database.prepare(query)
  stmt.bind([workspaceId])

  const tools: ToolDefinition[] = []
  while (stmt.step()) {
    tools.push(mapRowToToolDefinition(stmt.getAsObject() as unknown as ToolRow))
  }
  stmt.free()

  return tools
}

export function getTool(toolId: string): ToolDefinition | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM tools WHERE tool_id = ?")
  stmt.bind([toolId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const tool = mapRowToToolDefinition(stmt.getAsObject() as unknown as ToolRow)
  stmt.free()
  return tool
}

export function getToolByName(workspaceId: string, name: string): ToolDefinition | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM tools WHERE workspace_id = ? AND name = ?")
  stmt.bind([workspaceId, normalizeName(name)])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const tool = mapRowToToolDefinition(stmt.getAsObject() as unknown as ToolRow)
  stmt.free()
  return tool
}

export function createTool(input: CreateToolInput): ToolDefinition {
  const workspaceId = input.workspaceId || DEFAULT_WORKSPACE_ID
  const name = normalizeName(input.name)
  const displayName = input.displayName.trim()
  const description = input.description.trim()
  const category = (input.category || "custom") as ToolCategory
  const action = input.action
  const riskTier = validateRiskTier(input.riskTier)
  const implementationType = (input.implementationType || "script") as ToolImplementationType
  const config = normalizeConfig(input.config)

  validateToolInput({
    name,
    displayName,
    description,
    category,
    action,
    riskTier,
    source: "custom",
    implementationType,
    config
  })

  if (getToolByName(workspaceId, name)) {
    throw new Error(`Tool "${name}" already exists.`)
  }

  const database = getDb()
  const now = Date.now()
  const toolId = uuid()
  database.run(
    `INSERT INTO tools (
      tool_id, workspace_id, name, display_name, description, category, action, risk_tier,
      source, implementation_type, config, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      toolId,
      workspaceId,
      name,
      displayName,
      description,
      category,
      action,
      riskTier,
      "custom",
      implementationType,
      JSON.stringify(config),
      input.enabled === false ? 0 : 1,
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getTool(toolId) as ToolDefinition
}

export function updateTool(toolId: string, updates: UpdateToolInput): ToolDefinition | null {
  const existing = getTool(toolId)
  if (!existing) {
    return null
  }

  const systemUpdates = {
    name: updates.name,
    displayName: updates.displayName,
    description: updates.description,
    category: updates.category,
    action: updates.action,
    riskTier: updates.riskTier,
    implementationType: updates.implementationType,
    config: updates.config
  }
  const hasSystemShapeUpdates = Object.values(systemUpdates).some((value) => value !== undefined)
  if (existing.source === "system" && hasSystemShapeUpdates) {
    throw new Error(
      "System tools are managed by the built-in registry and only support enable/disable."
    )
  }

  const nextName = updates.name !== undefined ? normalizeName(updates.name) : existing.name
  const nextDisplayName =
    updates.displayName !== undefined ? updates.displayName.trim() : existing.displayName
  const nextDescription =
    updates.description !== undefined ? updates.description.trim() : existing.description
  const nextCategory = (updates.category || existing.category) as ToolCategory
  const nextAction = (updates.action || existing.action) as PolicyAction
  const nextRiskTier = validateRiskTier(
    updates.riskTier !== undefined ? updates.riskTier : existing.riskTier
  )
  const nextImplementationType = (updates.implementationType ||
    existing.implementationType) as ToolImplementationType
  const nextConfig =
    updates.config !== undefined ? normalizeConfig(updates.config) : existing.config
  const nextEnabled = updates.enabled === undefined ? existing.enabled : updates.enabled

  validateToolInput(
    {
      name: nextName,
      displayName: nextDisplayName,
      description: nextDescription,
      category: nextCategory,
      action: nextAction,
      riskTier: nextRiskTier,
      source: existing.source,
      implementationType: nextImplementationType,
      config: nextConfig
    },
    existing.source
  )

  const duplicate = getToolByName(existing.workspaceId, nextName)
  if (duplicate && duplicate.id !== existing.id) {
    throw new Error(`Tool "${nextName}" already exists.`)
  }

  const database = getDb()
  const now = Date.now()
  database.run(
    `UPDATE tools
     SET name = ?, display_name = ?, description = ?, category = ?, action = ?, risk_tier = ?,
         implementation_type = ?, config = ?, enabled = ?, updated_at = ?
     WHERE tool_id = ?`,
    [
      nextName,
      nextDisplayName,
      nextDescription,
      nextCategory,
      nextAction,
      nextRiskTier,
      nextImplementationType,
      JSON.stringify(nextConfig),
      nextEnabled ? 1 : 0,
      now,
      toolId
    ]
  )

  scheduleDatabaseSave()
  return getTool(toolId)
}

export function deleteTool(toolId: string): void {
  const existing = getTool(toolId)
  if (!existing) {
    return
  }
  if (existing.source !== "custom") {
    throw new Error("System tools cannot be deleted.")
  }

  const database = getDb()
  database.run("DELETE FROM tools WHERE tool_id = ?", [toolId])
  scheduleDatabaseSave()
}

function upsertSystemTool(workspaceId: string, seed: (typeof DEFAULT_TOOL_REGISTRY)[number]): void {
  const database = getDb()
  const now = Date.now()
  const existing = getToolByName(workspaceId, seed.name)
  if (!existing) {
    database.run(
      `INSERT INTO tools (
        tool_id, workspace_id, name, display_name, description, category, action, risk_tier,
        source, implementation_type, config, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        workspaceId,
        seed.name,
        seed.displayName,
        seed.description,
        seed.category,
        seed.action,
        seed.riskTier,
        "system",
        seed.implementationType,
        JSON.stringify(seed.config || {}),
        1,
        now,
        now
      ]
    )
    return
  }

  if (existing.source !== "system") {
    return
  }

  database.run(
    `UPDATE tools
     SET display_name = ?, description = ?, category = ?, action = ?, risk_tier = ?,
         implementation_type = ?, config = ?, updated_at = ?
     WHERE tool_id = ?`,
    [
      seed.displayName,
      seed.description,
      seed.category,
      seed.action,
      seed.riskTier,
      seed.implementationType,
      JSON.stringify(seed.config || {}),
      now,
      existing.id
    ]
  )
}

export function ensureDefaultTools(workspaceId: string = DEFAULT_WORKSPACE_ID): ToolDefinition[] {
  for (const seed of DEFAULT_TOOL_REGISTRY) {
    upsertSystemTool(workspaceId, seed)
  }
  scheduleDatabaseSave()
  return listTools(workspaceId)
}
