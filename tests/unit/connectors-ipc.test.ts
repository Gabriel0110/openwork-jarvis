import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  ConnectorDefinition,
  ConnectorExportBundle,
  McpServerDefinition
} from "../../src/main/types"

const {
  createConnectorMock,
  createMcpServerMock,
  deleteConnectorMock,
  deleteMcpServerMock,
  listConnectorsMock,
  listMcpServersMock,
  updateConnectorMock,
  updateMcpServerMock
} = vi.hoisted(() => ({
  createConnectorMock: vi.fn(),
  createMcpServerMock: vi.fn(),
  deleteConnectorMock: vi.fn(),
  deleteMcpServerMock: vi.fn(),
  listConnectorsMock: vi.fn(),
  listMcpServersMock: vi.fn(),
  updateConnectorMock: vi.fn(),
  updateMcpServerMock: vi.fn()
}))

vi.mock("../../src/main/db/connectors", () => ({
  createConnector: createConnectorMock,
  createMcpServer: createMcpServerMock,
  deleteConnector: deleteConnectorMock,
  deleteMcpServer: deleteMcpServerMock,
  listConnectors: listConnectorsMock,
  listMcpServers: listMcpServersMock,
  updateConnector: updateConnectorMock,
  updateMcpServer: updateMcpServerMock
}))

import { registerConnectorHandlers } from "../../src/main/ipc/connectors"

type IpcHandler = (event: unknown, params: unknown) => Promise<unknown>

interface IpcHandlerMap {
  get: (channel: string) => IpcHandler | undefined
}

function createIpcHarness(): {
  ipcMain: { handle: (channel: string, handler: IpcHandler) => void }
  handlers: IpcHandlerMap
} {
  const handlerMap = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: (channel: string, handler: IpcHandler) => {
      handlerMap.set(channel, handler)
    }
  }
  return {
    ipcMain,
    handlers: {
      get: (channel: string) => handlerMap.get(channel)
    }
  }
}

function getRequiredHandler(handlers: IpcHandlerMap, channel: string): IpcHandler {
  const handler = handlers.get(channel)
  expect(handler).toBeTruthy()
  if (!handler) {
    throw new Error(`Missing IPC handler: ${channel}`)
  }
  return handler
}

function buildConnector(overrides?: Partial<ConnectorDefinition>): ConnectorDefinition {
  return {
    id: "connector-1",
    workspaceId: "default-workspace",
    key: "github",
    name: "GitHub",
    category: "dev",
    config: {},
    enabled: true,
    status: "connected",
    createdAt: new Date("2026-02-16T00:00:00.000Z"),
    updatedAt: new Date("2026-02-16T00:00:00.000Z"),
    ...overrides
  }
}

function buildMcpServer(overrides?: Partial<McpServerDefinition>): McpServerDefinition {
  return {
    id: "mcp-1",
    workspaceId: "default-workspace",
    name: "Local MCP",
    command: "npx",
    args: ["-y", "demo-mcp"],
    env: {},
    enabled: true,
    status: "running",
    createdAt: new Date("2026-02-16T00:00:00.000Z"),
    updatedAt: new Date("2026-02-16T00:00:00.000Z"),
    ...overrides
  }
}

describe("registerConnectorHandlers bundle support", () => {
  beforeEach(() => {
    createConnectorMock.mockReset()
    createMcpServerMock.mockReset()
    deleteConnectorMock.mockReset()
    deleteMcpServerMock.mockReset()
    listConnectorsMock.mockReset()
    listMcpServersMock.mockReset()
    updateConnectorMock.mockReset()
    updateMcpServerMock.mockReset()
  })

  it("exports connector bundle with redacted secret-like keys", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    listConnectorsMock.mockReturnValue([
      buildConnector({
        config: {
          apiKey: "abc123",
          rateLimitPerHour: 120,
          nested: {
            token: "tok-value",
            mode: "sync"
          }
        }
      })
    ])
    listMcpServersMock.mockReturnValue([
      buildMcpServer({
        env: {
          API_TOKEN: "tok_123",
          LOG_LEVEL: "debug"
        }
      })
    ])

    registerConnectorHandlers(ipcMain as never)
    const handler = getRequiredHandler(handlers, "connectors:exportBundle")
    const result = (await handler({}, { workspaceId: "workspace-a" })) as ConnectorExportBundle

    expect(result.workspaceId).toBe("workspace-a")
    expect(result.redacted).toBe(true)
    expect(result.connectors).toHaveLength(1)
    expect(result.connectors[0]?.config).toEqual({
      apiKey: "__REDACTED__",
      rateLimitPerHour: 120,
      nested: {
        token: "__REDACTED__",
        mode: "sync"
      }
    })
    expect(result.mcpServers[0]?.env).toEqual({
      API_TOKEN: "__REDACTED__",
      LOG_LEVEL: "debug"
    })
  })

  it("imports bundle updates while preserving existing redacted secret values", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    listConnectorsMock.mockReturnValue([
      buildConnector({
        id: "connector-existing",
        key: "github",
        config: {
          apiKey: "keep-me",
          timeoutMs: 1000,
          nested: {
            token: "keep-token",
            mode: "legacy"
          }
        }
      })
    ])
    listMcpServersMock.mockReturnValue([
      buildMcpServer({
        id: "mcp-existing",
        name: "Local MCP",
        command: "npx",
        env: {
          API_KEY: "keep-env",
          LOG_LEVEL: "warn"
        }
      })
    ])

    const updatedConnector = buildConnector({
      id: "connector-existing",
      config: {
        apiKey: "keep-me",
        timeoutMs: 2000,
        nested: {
          token: "keep-token",
          mode: "modern"
        }
      }
    })
    const updatedMcp = buildMcpServer({
      id: "mcp-existing",
      env: {
        API_KEY: "keep-env",
        LOG_LEVEL: "info"
      }
    })
    updateConnectorMock.mockReturnValue(updatedConnector)
    updateMcpServerMock.mockReturnValue(updatedMcp)

    registerConnectorHandlers(ipcMain as never)
    const handler = getRequiredHandler(handlers, "connectors:importBundle")

    const bundle: ConnectorExportBundle = {
      version: "1",
      exportedAt: "2026-02-16T00:00:00.000Z",
      workspaceId: "workspace-a",
      redacted: true,
      connectors: [
        {
          key: "github",
          name: "GitHub",
          category: "dev",
          enabled: true,
          status: "connected",
          config: {
            apiKey: "__REDACTED__",
            timeoutMs: 2000,
            nested: {
              token: "__REDACTED__",
              mode: "modern"
            }
          }
        }
      ],
      mcpServers: [
        {
          name: "Local MCP",
          command: "npx",
          args: ["-y", "demo-mcp"],
          env: {
            API_KEY: "__REDACTED__",
            LOG_LEVEL: "info"
          },
          enabled: true,
          status: "running"
        }
      ]
    }

    const result = (await handler({}, { bundle, workspaceId: "workspace-a" })) as {
      connectors: ConnectorDefinition[]
      mcpServers: McpServerDefinition[]
    }

    expect(updateConnectorMock).toHaveBeenCalledWith(
      "connector-existing",
      expect.objectContaining({
        config: {
          apiKey: "keep-me",
          timeoutMs: 2000,
          nested: {
            token: "keep-token",
            mode: "modern"
          }
        }
      })
    )
    expect(updateMcpServerMock).toHaveBeenCalledWith(
      "mcp-existing",
      expect.objectContaining({
        env: {
          API_KEY: "keep-env",
          LOG_LEVEL: "info"
        }
      })
    )
    expect(result.connectors).toEqual([updatedConnector])
    expect(result.mcpServers).toEqual([updatedMcp])
  })

  it("imports bundle by creating records when no existing identities are found", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    listConnectorsMock.mockReturnValue([])
    listMcpServersMock.mockReturnValue([])

    const createdConnector = buildConnector({ id: "connector-new", workspaceId: "workspace-b" })
    const createdMcp = buildMcpServer({ id: "mcp-new", workspaceId: "workspace-b" })
    createConnectorMock.mockReturnValue(createdConnector)
    createMcpServerMock.mockReturnValue(createdMcp)

    registerConnectorHandlers(ipcMain as never)
    const handler = getRequiredHandler(handlers, "connectors:importBundle")

    const bundle: ConnectorExportBundle = {
      version: "1",
      exportedAt: "2026-02-16T00:00:00.000Z",
      workspaceId: "workspace-a",
      redacted: true,
      connectors: [
        {
          key: "slack",
          name: "Slack",
          category: "messaging",
          enabled: true,
          status: "disconnected",
          config: {}
        }
      ],
      mcpServers: [
        {
          name: "Demo MCP",
          command: "node",
          args: ["server.js"],
          env: {},
          enabled: false,
          status: "stopped"
        }
      ]
    }

    const result = (await handler({}, { bundle, workspaceId: "workspace-b" })) as {
      connectors: ConnectorDefinition[]
      mcpServers: McpServerDefinition[]
    }

    expect(createConnectorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-b",
        key: "slack"
      })
    )
    expect(createMcpServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-b",
        name: "Demo MCP"
      })
    )
    expect(result.connectors).toEqual([createdConnector])
    expect(result.mcpServers).toEqual([createdMcp])
  })
})
