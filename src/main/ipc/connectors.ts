import type { IpcMain } from "electron"
import {
  createConnector,
  createMcpServer,
  deleteConnector,
  deleteMcpServer,
  listConnectors,
  listMcpServers,
  updateConnector,
  updateMcpServer
} from "../db/connectors"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import type {
  ConnectorBundleItem,
  ConnectorCreateParams,
  ConnectorDeleteParams,
  ConnectorDefinition,
  ConnectorExportBundle,
  ConnectorExportParams,
  ConnectorImportParams,
  ConnectorImportResult,
  ConnectorListParams,
  ConnectorUpdateParams,
  McpServerBundleItem,
  McpServerDefinition,
  McpServerCreateParams,
  McpServerDeleteParams,
  McpServerUpdateParams
} from "../types"

const REDACTED_SECRET_VALUE = "__REDACTED__"

const CONNECTOR_CATEGORY_SET = new Set(["messaging", "dev", "social", "email", "webhook", "custom"])

const CONNECTOR_STATUS_SET = new Set(["disconnected", "connected", "error"])
const MCP_STATUS_SET = new Set(["stopped", "running", "error"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function normalizeMcpIdentity(name: string, command: string): string {
  return `${normalizeToken(name)}::${command.trim().toLowerCase()}`
}

function isSensitiveKey(value: string): boolean {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("apikey")
  )
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item))
  }

  if (!isPlainObject(value)) {
    return value
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = REDACTED_SECRET_VALUE
      continue
    }
    redacted[key] = redactSecrets(item)
  }
  return redacted
}

function stripRedactedSecrets(value: unknown): unknown {
  if (typeof value === "string" && value === REDACTED_SECRET_VALUE) {
    return undefined
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripRedactedSecrets(item))
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
  }

  if (!isPlainObject(value)) {
    return value
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = stripRedactedSecrets(item)
    if (normalized !== undefined) {
      sanitized[key] = normalized
    }
  }
  return sanitized
}

function sanitizeConnectorConfig(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {}
  }
  const stripped = stripRedactedSecrets(value)
  return isPlainObject(stripped) ? stripped : {}
}

function sanitizeMcpEnv(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {}
  }

  const env: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || item === REDACTED_SECRET_VALUE) {
      continue
    }
    env[key] = item
  }
  return env
}

function mergeObjects(
  base: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(updates)) {
    const existing = merged[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeObjects(existing, value)
      continue
    }
    merged[key] = value
  }
  return merged
}

function validateConnectorBundle(bundle: unknown): asserts bundle is ConnectorExportBundle {
  if (!isPlainObject(bundle)) {
    throw new Error("Invalid connector bundle format.")
  }

  if (bundle.version !== "1") {
    throw new Error("Unsupported connector bundle version.")
  }

  if (!Array.isArray(bundle.connectors) || !Array.isArray(bundle.mcpServers)) {
    throw new Error("Invalid connector bundle payload.")
  }
}

function sanitizeConnectorBundleItem(value: unknown): ConnectorBundleItem {
  if (!isPlainObject(value)) {
    throw new Error("Invalid connector item in bundle.")
  }

  const key = typeof value.key === "string" ? normalizeToken(value.key) : ""
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const category = typeof value.category === "string" ? value.category : "custom"
  const status = typeof value.status === "string" ? value.status : "disconnected"

  if (!key) {
    throw new Error("Connector bundle item requires a key.")
  }
  if (!name) {
    throw new Error(`Connector bundle item "${key}" requires a name.`)
  }
  if (!CONNECTOR_CATEGORY_SET.has(category)) {
    throw new Error(`Connector bundle item "${key}" has an invalid category.`)
  }
  if (!CONNECTOR_STATUS_SET.has(status)) {
    throw new Error(`Connector bundle item "${key}" has an invalid status.`)
  }

  return {
    key,
    name,
    category: category as ConnectorBundleItem["category"],
    config: sanitizeConnectorConfig(value.config),
    enabled: value.enabled !== false,
    status: status as ConnectorBundleItem["status"]
  }
}

function sanitizeMcpBundleItem(value: unknown): McpServerBundleItem {
  if (!isPlainObject(value)) {
    throw new Error("Invalid MCP server item in bundle.")
  }

  const name = typeof value.name === "string" ? value.name.trim() : ""
  const command = typeof value.command === "string" ? value.command.trim() : ""
  const status = typeof value.status === "string" ? value.status : "stopped"

  if (!name) {
    throw new Error("MCP bundle item requires a name.")
  }
  if (!command) {
    throw new Error(`MCP bundle item "${name}" requires a command.`)
  }
  if (!MCP_STATUS_SET.has(status)) {
    throw new Error(`MCP bundle item "${name}" has an invalid status.`)
  }

  return {
    name,
    command,
    args: Array.isArray(value.args)
      ? value.args.filter((item): item is string => typeof item === "string")
      : [],
    env: sanitizeMcpEnv(value.env),
    enabled: value.enabled !== false,
    status: status as McpServerBundleItem["status"],
    lastError: typeof value.lastError === "string" ? value.lastError : undefined
  }
}

function toConnectorBundleItem(
  connector: ConnectorDefinition,
  includeSecrets: boolean
): ConnectorBundleItem {
  return {
    key: connector.key,
    name: connector.name,
    category: connector.category,
    config: includeSecrets
      ? { ...(connector.config || {}) }
      : (redactSecrets(connector.config || {}) as Record<string, unknown>),
    enabled: connector.enabled,
    status: connector.status
  }
}

function toMcpServerBundleItem(
  server: McpServerDefinition,
  includeSecrets: boolean
): McpServerBundleItem {
  const env = includeSecrets
    ? { ...(server.env || {}) }
    : (redactSecrets(server.env || {}) as Record<string, string>)

  return {
    name: server.name,
    command: server.command,
    args: [...server.args],
    env,
    enabled: server.enabled,
    status: server.status,
    lastError: server.lastError
  }
}

export function registerConnectorHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("connectors:list", async (_event, params?: ConnectorListParams) => {
    return listConnectors(params?.workspaceId || DEFAULT_WORKSPACE_ID)
  })

  ipcMain.handle("connectors:create", async (_event, params: ConnectorCreateParams) => {
    return createConnector({
      workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
      key: params.key,
      name: params.name,
      category: params.category,
      config: params.config,
      enabled: params.enabled,
      status: params.status
    })
  })

  ipcMain.handle(
    "connectors:update",
    async (_event, { connectorId, updates }: ConnectorUpdateParams) => {
      const updated = updateConnector(connectorId, updates)
      if (!updated) {
        throw new Error("Connector not found.")
      }
      return updated
    }
  )

  ipcMain.handle("connectors:delete", async (_event, { connectorId }: ConnectorDeleteParams) => {
    deleteConnector(connectorId)
  })

  ipcMain.handle("connectors:exportBundle", async (_event, params?: ConnectorExportParams) => {
    const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
    const includeSecrets = params?.includeSecrets === true
    return {
      version: "1",
      exportedAt: new Date().toISOString(),
      workspaceId,
      redacted: !includeSecrets,
      connectors: listConnectors(workspaceId).map((connector) =>
        toConnectorBundleItem(connector, includeSecrets)
      ),
      mcpServers: listMcpServers(workspaceId).map((server) =>
        toMcpServerBundleItem(server, includeSecrets)
      )
    } satisfies ConnectorExportBundle
  })

  ipcMain.handle(
    "connectors:importBundle",
    async (_event, params: ConnectorImportParams): Promise<ConnectorImportResult> => {
      validateConnectorBundle(params?.bundle)

      const workspaceId = params.workspaceId || params.bundle.workspaceId || DEFAULT_WORKSPACE_ID
      const existingConnectors = listConnectors(workspaceId)
      const existingConnectorsByKey = new Map(
        existingConnectors.map((connector) => [normalizeToken(connector.key), connector])
      )
      const importedConnectors: ConnectorDefinition[] = []

      for (const item of params.bundle.connectors) {
        const sanitizedItem = sanitizeConnectorBundleItem(item)
        const existing = existingConnectorsByKey.get(normalizeToken(sanitizedItem.key))
        if (existing) {
          const updated = updateConnector(existing.id, {
            key: sanitizedItem.key,
            name: sanitizedItem.name,
            category: sanitizedItem.category,
            config: mergeObjects(existing.config || {}, sanitizedItem.config || {}),
            enabled: sanitizedItem.enabled,
            status: sanitizedItem.status
          })
          if (!updated) {
            throw new Error(`Connector import failed while updating "${sanitizedItem.key}".`)
          }
          importedConnectors.push(updated)
          existingConnectorsByKey.set(normalizeToken(updated.key), updated)
          continue
        }

        const created = createConnector({
          workspaceId,
          key: sanitizedItem.key,
          name: sanitizedItem.name,
          category: sanitizedItem.category,
          config: sanitizedItem.config,
          enabled: sanitizedItem.enabled,
          status: sanitizedItem.status
        })
        importedConnectors.push(created)
        existingConnectorsByKey.set(normalizeToken(created.key), created)
      }

      const existingMcpServers = listMcpServers(workspaceId)
      const existingMcpByIdentity = new Map(
        existingMcpServers.map((server) => [
          normalizeMcpIdentity(server.name, server.command),
          server
        ])
      )
      const importedMcpServers: McpServerDefinition[] = []

      for (const item of params.bundle.mcpServers) {
        const sanitizedItem = sanitizeMcpBundleItem(item)
        const identity = normalizeMcpIdentity(sanitizedItem.name, sanitizedItem.command)
        const existing = existingMcpByIdentity.get(identity)
        if (existing) {
          const updated = updateMcpServer(existing.id, {
            name: sanitizedItem.name,
            command: sanitizedItem.command,
            args: sanitizedItem.args,
            env: {
              ...(existing.env || {}),
              ...(sanitizedItem.env || {})
            },
            enabled: sanitizedItem.enabled,
            status: sanitizedItem.status,
            lastError: sanitizedItem.lastError
          })
          if (!updated) {
            throw new Error(`MCP import failed while updating "${sanitizedItem.name}".`)
          }
          importedMcpServers.push(updated)
          existingMcpByIdentity.set(normalizeMcpIdentity(updated.name, updated.command), updated)
          continue
        }

        const created = createMcpServer({
          workspaceId,
          name: sanitizedItem.name,
          command: sanitizedItem.command,
          args: sanitizedItem.args,
          env: sanitizedItem.env,
          enabled: sanitizedItem.enabled,
          status: sanitizedItem.status,
          lastError: sanitizedItem.lastError
        })
        importedMcpServers.push(created)
        existingMcpByIdentity.set(normalizeMcpIdentity(created.name, created.command), created)
      }

      return {
        connectors: importedConnectors,
        mcpServers: importedMcpServers
      }
    }
  )

  ipcMain.handle("mcp:list", async (_event, params?: ConnectorListParams) => {
    return listMcpServers(params?.workspaceId || DEFAULT_WORKSPACE_ID)
  })

  ipcMain.handle("mcp:create", async (_event, params: McpServerCreateParams) => {
    return createMcpServer({
      workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
      name: params.name,
      command: params.command,
      args: params.args,
      env: params.env,
      enabled: params.enabled,
      status: params.status,
      lastError: params.lastError || null
    })
  })

  ipcMain.handle("mcp:update", async (_event, { serverId, updates }: McpServerUpdateParams) => {
    const updated = updateMcpServer(serverId, updates)
    if (!updated) {
      throw new Error("MCP server not found.")
    }
    return updated
  })

  ipcMain.handle("mcp:delete", async (_event, { serverId }: McpServerDeleteParams) => {
    deleteMcpServer(serverId)
  })
}
