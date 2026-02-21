import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TimelineIngestTriggerParams, TimelineListParams } from "../../src/main/types"

const {
  getThreadMock,
  createTimelineEventMock,
  listTimelineEventsByThreadMock,
  listTimelineEventsByWorkspaceMock
} = vi.hoisted(() => ({
  getThreadMock: vi.fn(),
  createTimelineEventMock: vi.fn(),
  listTimelineEventsByThreadMock: vi.fn(),
  listTimelineEventsByWorkspaceMock: vi.fn()
}))

vi.mock("../../src/main/db/index", () => ({
  getThread: getThreadMock
}))

vi.mock("../../src/main/db/timeline-events", () => ({
  createTimelineEvent: createTimelineEventMock,
  listTimelineEventsByThread: listTimelineEventsByThreadMock,
  listTimelineEventsByWorkspace: listTimelineEventsByWorkspaceMock
}))

import { registerTimelineHandlers } from "../../src/main/ipc/timeline"

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

describe("registerTimelineHandlers", () => {
  beforeEach(() => {
    getThreadMock.mockReset()
    createTimelineEventMock.mockReset()
    listTimelineEventsByThreadMock.mockReset()
    listTimelineEventsByWorkspaceMock.mockReset()
  })

  it("registers list handler and proxies timeline query", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    listTimelineEventsByThreadMock.mockReturnValue([{ id: "evt-1" }])

    registerTimelineHandlers(ipcMain as never)
    const listHandler = getRequiredHandler(handlers, "timeline:list")

    const params: TimelineListParams = { threadId: "thread-1", limit: 22 }
    const result = await listHandler({}, params)

    expect(listTimelineEventsByThreadMock).toHaveBeenCalledWith("thread-1", 22)
    expect(result).toEqual([{ id: "evt-1" }])
  })

  it("registers workspace list handler and proxies workspace query", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    listTimelineEventsByWorkspaceMock.mockReturnValue([{ id: "evt-ws-1" }])

    registerTimelineHandlers(ipcMain as never)
    const workspaceHandler = getRequiredHandler(handlers, "timeline:listWorkspace")

    const result = await workspaceHandler({}, { workspaceId: "workspace-a", limit: 50 })

    expect(listTimelineEventsByWorkspaceMock).toHaveBeenCalledWith("workspace-a", 50)
    expect(result).toEqual([{ id: "evt-ws-1" }])
  })

  it("ingests connector trigger events with normalized payload/tool defaults", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    getThreadMock.mockReturnValue({ thread_id: "thread-1" })
    createTimelineEventMock.mockReturnValue({ id: "evt-ingested" })

    registerTimelineHandlers(ipcMain as never)
    const ingestHandler = getRequiredHandler(handlers, "timeline:ingestTriggerEvent")

    const params: TimelineIngestTriggerParams = {
      threadId: "thread-1",
      triggerType: "connector_event",
      eventKey: "issue.created",
      sourceKey: "github"
    }
    const result = await ingestHandler({}, params)

    expect(createTimelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        workspaceId: "default-workspace",
        eventType: "tool_result",
        toolName: "connector:github",
        summary: "External connector_event event: issue.created (github)",
        payload: expect.objectContaining({
          connectorEventKey: "issue.created",
          connectorKey: "github",
          sourceConnectorKey: "github"
        })
      })
    )
    expect(result).toEqual({ id: "evt-ingested" })
  })

  it("ingests webhook trigger events with custom fields and payload merge", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    getThreadMock.mockReturnValue({ thread_id: "thread-2" })
    createTimelineEventMock.mockReturnValue({ id: "evt-webhook" })

    registerTimelineHandlers(ipcMain as never)
    const ingestHandler = getRequiredHandler(handlers, "timeline:ingestTriggerEvent")

    const params: TimelineIngestTriggerParams = {
      threadId: "thread-2",
      workspaceId: "workspace-a",
      triggerType: "webhook",
      eventType: "tool_call",
      eventKey: "order.created",
      sourceKey: "stripe",
      toolName: "webhook:orders",
      summary: "Webhook received",
      payload: {
        requestId: "req_123"
      }
    }
    await ingestHandler({}, params)

    expect(createTimelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-2",
        workspaceId: "workspace-a",
        eventType: "tool_call",
        toolName: "webhook:orders",
        summary: "Webhook received",
        payload: expect.objectContaining({
          requestId: "req_123",
          webhookEventKey: "order.created",
          webhookSource: "stripe"
        })
      })
    )
  })

  it("rejects ingest requests for unknown threads", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    getThreadMock.mockReturnValue(null)

    registerTimelineHandlers(ipcMain as never)
    const ingestHandler = getRequiredHandler(handlers, "timeline:ingestTriggerEvent")

    const params: TimelineIngestTriggerParams = {
      threadId: "missing-thread",
      triggerType: "connector_event",
      eventKey: "issue.created"
    }

    await expect(ingestHandler({}, params)).rejects.toThrow(
      "Thread not found for trigger event: missing-thread"
    )
  })
})
