import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MemoryEntry, MemorySetEntryLockedParams } from "../../src/main/types"

const {
  createThreadMock,
  getThreadMock,
  updateThreadMock,
  createTimelineEventMock,
  listMemoryEntriesMock,
  createMemoryEntryMock,
  getMemoryEntryMock,
  deleteMemoryEntryMock,
  setMemoryEntryLockedMock,
  listRagSourcesMock,
  searchMemoryAndRagMock,
  upsertRagSourceMock,
  deleteRagSourceMock,
  indexRagSourcesForThreadMock
} = vi.hoisted(() => ({
  createThreadMock: vi.fn(),
  getThreadMock: vi.fn(),
  updateThreadMock: vi.fn(),
  createTimelineEventMock: vi.fn(),
  listMemoryEntriesMock: vi.fn(),
  createMemoryEntryMock: vi.fn(),
  getMemoryEntryMock: vi.fn(),
  deleteMemoryEntryMock: vi.fn(),
  setMemoryEntryLockedMock: vi.fn(),
  listRagSourcesMock: vi.fn(),
  searchMemoryAndRagMock: vi.fn(),
  upsertRagSourceMock: vi.fn(),
  deleteRagSourceMock: vi.fn(),
  indexRagSourcesForThreadMock: vi.fn()
}))

vi.mock("../../src/main/db", () => ({
  createThread: createThreadMock,
  getThread: getThreadMock,
  updateThread: updateThreadMock
}))

vi.mock("../../src/main/db/memory", () => ({
  listMemoryEntries: listMemoryEntriesMock,
  createMemoryEntry: createMemoryEntryMock,
  getMemoryEntry: getMemoryEntryMock,
  deleteMemoryEntry: deleteMemoryEntryMock,
  setMemoryEntryLocked: setMemoryEntryLockedMock,
  listRagSources: listRagSourcesMock,
  searchMemoryAndRag: searchMemoryAndRagMock,
  upsertRagSource: upsertRagSourceMock,
  deleteRagSource: deleteRagSourceMock
}))

vi.mock("../../src/main/db/timeline-events", () => ({
  createTimelineEvent: createTimelineEventMock
}))

vi.mock("../../src/main/services/rag-indexer", () => ({
  indexRagSourcesForThread: indexRagSourcesForThreadMock
}))

import { registerMemoryHandlers } from "../../src/main/ipc/memory"

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

function buildMemoryEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem-1",
    workspaceId: "default-workspace",
    scope: "workspace",
    title: "Example",
    content: "Saved memory",
    tags: [],
    source: "manual",
    locked: false,
    createdAt: new Date("2026-02-16T00:00:00.000Z"),
    updatedAt: new Date("2026-02-16T00:00:00.000Z"),
    ...overrides
  }
}

describe("registerMemoryHandlers", () => {
  beforeEach(() => {
    createThreadMock.mockReset()
    getThreadMock.mockReset()
    updateThreadMock.mockReset()
    createTimelineEventMock.mockReset()
    listMemoryEntriesMock.mockReset()
    createMemoryEntryMock.mockReset()
    getMemoryEntryMock.mockReset()
    deleteMemoryEntryMock.mockReset()
    setMemoryEntryLockedMock.mockReset()
    listRagSourcesMock.mockReset()
    searchMemoryAndRagMock.mockReset()
    upsertRagSourceMock.mockReset()
    deleteRagSourceMock.mockReset()
    indexRagSourcesForThreadMock.mockReset()
    getThreadMock.mockReturnValue({
      thread_id: "system-memory-audit:default-workspace"
    })
    getMemoryEntryMock.mockReturnValue(null)
  })

  it("registers list handler with default workspace fallback", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    listMemoryEntriesMock.mockReturnValue([buildMemoryEntry()])

    registerMemoryHandlers(ipcMain as never)
    const listHandler = getRequiredHandler(handlers, "memory:listEntries")

    const result = await listHandler({}, { scope: "workspace", limit: 10 })

    expect(listMemoryEntriesMock).toHaveBeenCalledWith({
      workspaceId: "default-workspace",
      scope: "workspace",
      agentId: undefined,
      threadId: undefined,
      limit: 10
    })
    expect(result).toEqual([buildMemoryEntry()])
  })

  it("registers setEntryLocked handler and returns the updated entry", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const updated = buildMemoryEntry({ id: "mem-lock-1", locked: true })
    setMemoryEntryLockedMock.mockReturnValue(updated)

    registerMemoryHandlers(ipcMain as never)
    const lockHandler = getRequiredHandler(handlers, "memory:setEntryLocked")

    const params: MemorySetEntryLockedParams = { entryId: "mem-lock-1", locked: true }
    const result = await lockHandler({}, params)

    expect(setMemoryEntryLockedMock).toHaveBeenCalledWith("mem-lock-1", true)
    expect(createTimelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "memory:lock",
        eventType: "tool_result"
      })
    )
    expect(result).toEqual(updated)
  })

  it("throws when setEntryLocked cannot find an entry", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    setMemoryEntryLockedMock.mockReturnValue(null)

    registerMemoryHandlers(ipcMain as never)
    const lockHandler = getRequiredHandler(handlers, "memory:setEntryLocked")

    await expect(lockHandler({}, { entryId: "missing", locked: true })).rejects.toThrow(
      "Memory entry not found."
    )
  })
})
