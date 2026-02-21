import { beforeEach, describe, expect, it, vi } from "vitest"

const { managerMock, getZeroClawManagerMock } = vi.hoisted(() => {
  const manager = {
    getInstallStatus: vi.fn(),
    getInstallActivity: vi.fn(),
    installVersion: vi.fn(),
    verifyInstallation: vi.fn(),
    upgrade: vi.fn(),
    listDeployments: vi.fn(),
    getDeployment: vi.fn(),
    createDeployment: vi.fn(),
    updateDeployment: vi.fn(),
    deleteDeployment: vi.fn(),
    startRuntime: vi.fn(),
    stopRuntime: vi.fn(),
    restartRuntime: vi.fn(),
    getHealth: vi.fn(),
    getLogs: vi.fn(),
    getPolicy: vi.fn(),
    setPolicy: vi.fn(),
    runDoctor: vi.fn()
  }
  return {
    managerMock: manager,
    getZeroClawManagerMock: vi.fn(() => manager)
  }
})

vi.mock("../../src/main/zeroclaw/manager", () => ({
  getZeroClawManager: getZeroClawManagerMock
}))

import { registerZeroClawHandlers } from "../../src/main/ipc/zeroclaw"

type IpcHandler = (event: unknown, params?: unknown) => Promise<unknown>

function createIpcHarness(): {
  ipcMain: { handle: (channel: string, handler: IpcHandler) => void }
  handlers: Map<string, IpcHandler>
} {
  const handlers = new Map<string, IpcHandler>()
  return {
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler)
      }
    },
    handlers
  }
}

function requiredHandler(handlers: Map<string, IpcHandler>, channel: string): IpcHandler {
  const handler = handlers.get(channel)
  expect(handler).toBeTruthy()
  if (!handler) {
    throw new Error(`Missing IPC handler ${channel}`)
  }
  return handler
}

describe("registerZeroClawHandlers", () => {
  beforeEach(() => {
    for (const fn of Object.values(managerMock)) {
      if (typeof fn === "function" && "mockReset" in fn) {
        const mockFn = fn as ReturnType<typeof vi.fn>
        mockFn.mockReset()
      }
    }
    getZeroClawManagerMock.mockClear()
  })

  it("registers install handlers", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    managerMock.getInstallStatus.mockReturnValue({ state: "installed", installations: [] })
    managerMock.getInstallActivity.mockReturnValue({ state: "idle", phase: "idle", lines: [] })
    managerMock.installVersion.mockResolvedValue({ state: "installed", installations: [] })
    managerMock.verifyInstallation.mockResolvedValue({ ok: true })
    managerMock.upgrade.mockResolvedValue({ state: "installed", installations: [] })

    registerZeroClawHandlers(ipcMain as never)

    await expect(requiredHandler(handlers, "zeroclaw:install:getStatus")({}, {})).resolves.toEqual({
      state: "installed",
      installations: []
    })
    await expect(
      requiredHandler(handlers, "zeroclaw:install:getActivity")({}, {})
    ).resolves.toEqual({
      state: "idle",
      phase: "idle",
      lines: []
    })
    await expect(
      requiredHandler(handlers, "zeroclaw:install:installVersion")({}, { version: "main" })
    ).resolves.toEqual({
      state: "installed",
      installations: []
    })
    await expect(requiredHandler(handlers, "zeroclaw:install:verify")({}, {})).resolves.toEqual({
      ok: true
    })
    await expect(
      requiredHandler(handlers, "zeroclaw:install:upgrade")({}, { version: "main" })
    ).resolves.toEqual({
      state: "installed",
      installations: []
    })
  })

  it("handles deployment and runtime lifecycle methods", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    managerMock.listDeployments.mockReturnValue([{ id: "dep-1" }])
    managerMock.getDeployment.mockReturnValue({ id: "dep-1" })
    managerMock.createDeployment.mockResolvedValue({ id: "dep-1" })
    managerMock.updateDeployment.mockResolvedValue({ id: "dep-1", name: "Updated" })
    managerMock.deleteDeployment.mockResolvedValue(undefined)
    managerMock.startRuntime.mockResolvedValue({ id: "dep-1", status: "running" })
    managerMock.stopRuntime.mockResolvedValue({ id: "dep-1", status: "stopped" })
    managerMock.restartRuntime.mockResolvedValue({ id: "dep-1", status: "starting" })
    managerMock.getHealth.mockReturnValue({ deploymentId: "dep-1", status: "healthy" })
    managerMock.getLogs.mockReturnValue({ events: [] })
    managerMock.getPolicy.mockReturnValue({ mode: "global_only" })
    managerMock.setPolicy.mockResolvedValue({ id: "dep-1" })
    managerMock.runDoctor.mockResolvedValue({ healthy: true, checks: [] })

    registerZeroClawHandlers(ipcMain as never)

    await expect(requiredHandler(handlers, "zeroclaw:deployment:list")({}, {})).resolves.toEqual([
      { id: "dep-1" }
    ])
    await expect(
      requiredHandler(handlers, "zeroclaw:deployment:get")({}, { deploymentId: "dep-1" })
    ).resolves.toEqual({ id: "dep-1" })
    await expect(
      requiredHandler(handlers, "zeroclaw:deployment:create")(
        {},
        {
          spec: {
            name: "Bot",
            workspacePath: "/tmp",
            modelProvider: "openai",
            modelName: "gpt-4o"
          }
        }
      )
    ).resolves.toEqual({ id: "dep-1" })

    await expect(
      requiredHandler(handlers, "zeroclaw:runtime:start")({}, { deploymentId: "dep-1" })
    ).resolves.toEqual({ id: "dep-1", status: "running" })
    await expect(
      requiredHandler(handlers, "zeroclaw:runtime:stop")({}, { deploymentId: "dep-1" })
    ).resolves.toEqual({ id: "dep-1", status: "stopped" })
    await expect(
      requiredHandler(handlers, "zeroclaw:runtime:restart")({}, { deploymentId: "dep-1" })
    ).resolves.toEqual({ id: "dep-1", status: "starting" })
    await expect(
      requiredHandler(handlers, "zeroclaw:runtime:getHealth")({}, { deploymentId: "dep-1" })
    ).resolves.toEqual({ deploymentId: "dep-1", status: "healthy" })

    await expect(
      requiredHandler(handlers, "zeroclaw:logs:get")({}, { deploymentId: "dep-1", limit: 20 })
    ).resolves.toEqual({ events: [] })
    await expect(
      requiredHandler(handlers, "zeroclaw:policy:get")({}, { deploymentId: "dep-1" })
    ).resolves.toEqual({ mode: "global_only" })
    await expect(
      requiredHandler(handlers, "zeroclaw:policy:set")(
        {},
        {
          deploymentId: "dep-1",
          policy: { mode: "global_only" }
        }
      )
    ).resolves.toEqual({ id: "dep-1" })
    await expect(requiredHandler(handlers, "zeroclaw:doctor:run")({}, {})).resolves.toEqual({
      healthy: true,
      checks: []
    })

    await expect(
      requiredHandler(handlers, "zeroclaw:deployment:delete")({}, { deploymentId: "dep-1" })
    ).resolves.toBeUndefined()
  })
})
