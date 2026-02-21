import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolDefinition } from "../../src/main/types"

const {
  createToolMock,
  deleteToolMock,
  ensureDefaultToolsMock,
  getToolMock,
  listToolsMock,
  updateToolMock
} = vi.hoisted(() => ({
  createToolMock: vi.fn(),
  deleteToolMock: vi.fn(),
  ensureDefaultToolsMock: vi.fn(),
  getToolMock: vi.fn(),
  listToolsMock: vi.fn(),
  updateToolMock: vi.fn()
}))

vi.mock("../../src/main/db/tools", () => ({
  createTool: createToolMock,
  deleteTool: deleteToolMock,
  ensureDefaultTools: ensureDefaultToolsMock,
  getTool: getToolMock,
  listTools: listToolsMock,
  updateTool: updateToolMock
}))

import { registerToolHandlers } from "../../src/main/ipc/tools"

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

function buildTool(overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    id: "tool-1",
    workspaceId: "default-workspace",
    name: "custom_test_tool",
    displayName: "Custom Test Tool",
    description: "Tool description.",
    category: "custom",
    action: "exec",
    riskTier: 2,
    source: "custom",
    implementationType: "script",
    config: {
      commandTemplate: "echo {{value}}"
    },
    enabled: true,
    createdAt: new Date("2026-02-16T00:00:00.000Z"),
    updatedAt: new Date("2026-02-16T00:00:00.000Z"),
    ...overrides
  }
}

describe("registerToolHandlers", () => {
  beforeEach(() => {
    createToolMock.mockReset()
    deleteToolMock.mockReset()
    ensureDefaultToolsMock.mockReset()
    getToolMock.mockReset()
    listToolsMock.mockReset()
    updateToolMock.mockReset()
  })

  it("lists tools and ensures defaults for the requested workspace", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const payload = [
      buildTool({ source: "system", implementationType: "builtin", name: "read_file" })
    ]
    listToolsMock.mockReturnValue(payload)

    registerToolHandlers(ipcMain as never)
    const listHandler = getRequiredHandler(handlers, "tools:list")

    const result = await listHandler({}, { workspaceId: "workspace-1", includeDisabled: false })

    expect(ensureDefaultToolsMock).toHaveBeenCalledWith("workspace-1")
    expect(listToolsMock).toHaveBeenCalledWith("workspace-1", false)
    expect(result).toEqual(payload)
  })

  it("creates a tool after ensuring workspace defaults", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const created = buildTool()
    createToolMock.mockReturnValue(created)

    registerToolHandlers(ipcMain as never)
    const createHandler = getRequiredHandler(handlers, "tools:create")

    const params = {
      workspaceId: "workspace-1",
      name: "custom_test_tool",
      displayName: "Custom Test Tool",
      description: "Tool description.",
      category: "custom" as const,
      action: "exec" as const,
      riskTier: 2 as const,
      implementationType: "script" as const,
      config: { commandTemplate: "echo {{value}}" },
      enabled: true
    }
    const result = await createHandler({}, params)

    expect(ensureDefaultToolsMock).toHaveBeenCalledWith("workspace-1")
    expect(createToolMock).toHaveBeenCalledWith(params)
    expect(result).toEqual(created)
  })

  it("gets a tool by id and throws when missing", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    registerToolHandlers(ipcMain as never)
    const getHandler = getRequiredHandler(handlers, "tools:get")

    getToolMock.mockReturnValue(buildTool())
    await expect(getHandler({}, { toolId: "tool-1" })).resolves.toEqual(buildTool())

    getToolMock.mockReturnValue(null)
    await expect(getHandler({}, { toolId: "missing" })).rejects.toThrow("Tool not found.")
  })

  it("updates and deletes tools through the DB layer", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    registerToolHandlers(ipcMain as never)
    const updateHandler = getRequiredHandler(handlers, "tools:update")
    const deleteHandler = getRequiredHandler(handlers, "tools:delete")

    const updated = buildTool({ displayName: "Updated Tool" })
    updateToolMock.mockReturnValue(updated)
    await expect(
      updateHandler({}, { toolId: "tool-1", updates: { displayName: "Updated Tool" } })
    ).resolves.toEqual(updated)
    expect(updateToolMock).toHaveBeenCalledWith("tool-1", { displayName: "Updated Tool" })

    updateToolMock.mockReturnValue(null)
    await expect(updateHandler({}, { toolId: "missing", updates: {} })).rejects.toThrow(
      "Tool not found."
    )

    await expect(deleteHandler({}, { toolId: "tool-1" })).resolves.toBeUndefined()
    expect(deleteToolMock).toHaveBeenCalledWith("tool-1")
  })
})
