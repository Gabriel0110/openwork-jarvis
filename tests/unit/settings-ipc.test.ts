import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SecurityDefaults,
  SettingsStorageLocations,
  SettingsUpdateSecurityDefaultsParams
} from "../../src/main/types"

const { getSecurityDefaultsMock, setSecurityDefaultsMock, getStorageLocationsMock } = vi.hoisted(
  () => ({
    getSecurityDefaultsMock: vi.fn(),
    setSecurityDefaultsMock: vi.fn(),
    getStorageLocationsMock: vi.fn()
  })
)

vi.mock("../../src/main/storage", () => ({
  getSecurityDefaults: getSecurityDefaultsMock,
  setSecurityDefaults: setSecurityDefaultsMock,
  getStorageLocations: getStorageLocationsMock
}))

import { registerSettingsHandlers } from "../../src/main/ipc/settings"

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

function buildSecurityDefaults(overrides?: Partial<SecurityDefaults>): SecurityDefaults {
  return {
    requireExecApproval: true,
    requireNetworkApproval: true,
    denySocialPosting: true,
    ...overrides
  }
}

function buildStorageLocations(): SettingsStorageLocations {
  return {
    openworkDir: "/tmp/.openwork",
    dbPath: "/tmp/.openwork/openwork.sqlite",
    checkpointDbPath: "/tmp/.openwork/langgraph.sqlite",
    threadCheckpointDir: "/tmp/.openwork/threads",
    envFilePath: "/tmp/.openwork/.env",
    zeroClawDir: "/tmp/.openwork/zeroclaw",
    zeroClawRuntimeDir: "/tmp/.openwork/zeroclaw/runtime",
    zeroClawDeploymentsDir: "/tmp/.openwork/zeroclaw/deployments",
    zeroClawLogsDir: "/tmp/.openwork/zeroclaw/logs"
  }
}

describe("registerSettingsHandlers", () => {
  beforeEach(() => {
    getSecurityDefaultsMock.mockReset()
    setSecurityDefaultsMock.mockReset()
    getStorageLocationsMock.mockReset()
  })

  it("registers and resolves security defaults getter", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const defaults = buildSecurityDefaults()
    getSecurityDefaultsMock.mockReturnValue(defaults)

    registerSettingsHandlers(ipcMain as never)
    const getHandler = getRequiredHandler(handlers, "settings:getSecurityDefaults")

    const result = await getHandler({}, {})
    expect(getSecurityDefaultsMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(defaults)
  })

  it("registers and applies security default updates", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const updates: SettingsUpdateSecurityDefaultsParams = {
      updates: { requireExecApproval: false }
    }
    const saved = buildSecurityDefaults({ requireExecApproval: false })
    setSecurityDefaultsMock.mockReturnValue(saved)

    registerSettingsHandlers(ipcMain as never)
    const updateHandler = getRequiredHandler(handlers, "settings:updateSecurityDefaults")

    const result = await updateHandler({}, updates)
    expect(setSecurityDefaultsMock).toHaveBeenCalledWith({ requireExecApproval: false })
    expect(result).toEqual(saved)
  })

  it("registers and resolves storage location metadata", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const locations = buildStorageLocations()
    getStorageLocationsMock.mockReturnValue(locations)

    registerSettingsHandlers(ipcMain as never)
    const locationsHandler = getRequiredHandler(handlers, "settings:getStorageLocations")

    const result = await locationsHandler({}, {})
    expect(getStorageLocationsMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(locations)
  })
})
