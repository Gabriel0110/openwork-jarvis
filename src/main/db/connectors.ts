import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  ConnectorCategory,
  ConnectorDefinition,
  ConnectorStatus,
  McpServerDefinition,
  McpServerStatus
} from "../types"

interface ConnectorRow {
  connector_id: string
  workspace_id: string
  key: string
  name: string
  category: ConnectorCategory
  config: string
  enabled: number
  status: ConnectorStatus
  created_at: number
  updated_at: number
}

interface McpServerRow {
  server_id: string
  workspace_id: string
  name: string
  command: string
  args: string
  env: string
  enabled: number
  status: McpServerStatus
  last_error: string | null
  created_at: number
  updated_at: number
}

export interface CreateConnectorInput {
  workspaceId: string
  key: string
  name: string
  category: ConnectorCategory
  config?: Record<string, unknown>
  enabled?: boolean
  status?: ConnectorStatus
}

export interface UpdateConnectorInput {
  key?: string
  name?: string
  category?: ConnectorCategory
  config?: Record<string, unknown>
  enabled?: boolean
  status?: ConnectorStatus
}

export interface CreateMcpServerInput {
  workspaceId: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  status?: McpServerStatus
  lastError?: string | null
}

export interface UpdateMcpServerInput {
  name?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  status?: McpServerStatus
  lastError?: string | null
}

function parseConfig(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed ? parsed : {}
  } catch {
    return {}
  }
}

function parseArgs(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

function parseEnv(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== "object" || !parsed) {
      return {}
    }
    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (env, [key, item]) => {
        if (typeof item === "string") {
          env[key] = item
        }
        return env
      },
      {}
    )
  } catch {
    return {}
  }
}

function mapConnectorRow(row: ConnectorRow): ConnectorDefinition {
  return {
    id: row.connector_id,
    workspaceId: row.workspace_id,
    key: row.key,
    name: row.name,
    category: row.category,
    config: parseConfig(row.config),
    enabled: row.enabled === 1,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapMcpServerRow(row: McpServerRow): McpServerDefinition {
  return {
    id: row.server_id,
    workspaceId: row.workspace_id,
    name: row.name,
    command: row.command,
    args: parseArgs(row.args),
    env: parseEnv(row.env),
    enabled: row.enabled === 1,
    status: row.status,
    lastError: row.last_error || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

export function listConnectors(workspaceId: string): ConnectorDefinition[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM connectors WHERE workspace_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([workspaceId])

  const connectors: ConnectorDefinition[] = []
  while (stmt.step()) {
    connectors.push(mapConnectorRow(stmt.getAsObject() as unknown as ConnectorRow))
  }
  stmt.free()

  return connectors
}

export function getConnector(connectorId: string): ConnectorDefinition | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM connectors WHERE connector_id = ?")
  stmt.bind([connectorId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const connector = mapConnectorRow(stmt.getAsObject() as unknown as ConnectorRow)
  stmt.free()
  return connector
}

export function createConnector(input: CreateConnectorInput): ConnectorDefinition {
  const database = getDb()
  const now = Date.now()
  const connectorId = uuid()

  database.run(
    `INSERT INTO connectors (
      connector_id, workspace_id, key, name, category, config, enabled, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      connectorId,
      input.workspaceId,
      input.key,
      input.name,
      input.category,
      JSON.stringify(input.config || {}),
      input.enabled === false ? 0 : 1,
      input.status || "disconnected",
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getConnector(connectorId) as ConnectorDefinition
}

export function updateConnector(
  connectorId: string,
  updates: UpdateConnectorInput
): ConnectorDefinition | null {
  const existing = getConnector(connectorId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()

  database.run(
    `UPDATE connectors
     SET key = ?, name = ?, category = ?, config = ?, enabled = ?, status = ?, updated_at = ?
     WHERE connector_id = ?`,
    [
      updates.key ?? existing.key,
      updates.name ?? existing.name,
      updates.category ?? existing.category,
      JSON.stringify(updates.config ?? existing.config),
      updates.enabled === undefined ? (existing.enabled ? 1 : 0) : updates.enabled ? 1 : 0,
      updates.status ?? existing.status,
      now,
      connectorId
    ]
  )

  scheduleDatabaseSave()
  return getConnector(connectorId)
}

export function deleteConnector(connectorId: string): void {
  const database = getDb()
  database.run("DELETE FROM connectors WHERE connector_id = ?", [connectorId])
  scheduleDatabaseSave()
}

export function listMcpServers(workspaceId: string): McpServerDefinition[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM mcp_servers WHERE workspace_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([workspaceId])

  const servers: McpServerDefinition[] = []
  while (stmt.step()) {
    servers.push(mapMcpServerRow(stmt.getAsObject() as unknown as McpServerRow))
  }
  stmt.free()

  return servers
}

export function getMcpServer(serverId: string): McpServerDefinition | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM mcp_servers WHERE server_id = ?")
  stmt.bind([serverId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const server = mapMcpServerRow(stmt.getAsObject() as unknown as McpServerRow)
  stmt.free()
  return server
}

export function createMcpServer(input: CreateMcpServerInput): McpServerDefinition {
  const database = getDb()
  const now = Date.now()
  const serverId = uuid()

  database.run(
    `INSERT INTO mcp_servers (
      server_id, workspace_id, name, command, args, env, enabled, status, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      serverId,
      input.workspaceId,
      input.name,
      input.command,
      JSON.stringify(input.args || []),
      JSON.stringify(input.env || {}),
      input.enabled === false ? 0 : 1,
      input.status || "stopped",
      input.lastError || null,
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getMcpServer(serverId) as McpServerDefinition
}

export function updateMcpServer(
  serverId: string,
  updates: UpdateMcpServerInput
): McpServerDefinition | null {
  const existing = getMcpServer(serverId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()

  database.run(
    `UPDATE mcp_servers
     SET name = ?, command = ?, args = ?, env = ?, enabled = ?, status = ?, last_error = ?, updated_at = ?
     WHERE server_id = ?`,
    [
      updates.name ?? existing.name,
      updates.command ?? existing.command,
      JSON.stringify(updates.args ?? existing.args),
      JSON.stringify(updates.env ?? existing.env),
      updates.enabled === undefined ? (existing.enabled ? 1 : 0) : updates.enabled ? 1 : 0,
      updates.status ?? existing.status,
      updates.lastError === undefined ? existing.lastError || null : updates.lastError,
      now,
      serverId
    ]
  )

  scheduleDatabaseSave()
  return getMcpServer(serverId)
}

export function deleteMcpServer(serverId: string): void {
  const database = getDb()
  database.run("DELETE FROM mcp_servers WHERE server_id = ?", [serverId])
  scheduleDatabaseSave()
}
