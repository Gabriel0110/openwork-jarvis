import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SkillDetail, SkillListResult } from "../../src/main/types"

const { listGlobalSkillsMock, getGlobalSkillDetailMock } = vi.hoisted(() => ({
  listGlobalSkillsMock: vi.fn(),
  getGlobalSkillDetailMock: vi.fn()
}))

vi.mock("../../src/main/services/skills-registry", () => ({
  listGlobalSkills: listGlobalSkillsMock,
  getGlobalSkillDetail: getGlobalSkillDetailMock
}))

import { registerSkillHandlers } from "../../src/main/ipc/skills"

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

function buildSkillListResult(): SkillListResult {
  return {
    skills: [
      {
        id: "global_agents:frontend-design",
        name: "frontend-design",
        description: "Create production UI with strong visual quality.",
        path: "/Users/dev/.agents/skills/frontend-design/SKILL.md",
        source: "global_agents",
        allowedTools: []
      }
    ],
    locations: [
      {
        source: "global_agents",
        path: "/Users/dev/.agents/skills",
        exists: true
      }
    ],
    loadedAt: "2026-02-16T00:00:00.000Z"
  }
}

function buildSkillDetail(): SkillDetail {
  return {
    skill: buildSkillListResult().skills[0],
    content: "# frontend-design\n\nSkill body"
  }
}

describe("registerSkillHandlers", () => {
  beforeEach(() => {
    listGlobalSkillsMock.mockReset()
    getGlobalSkillDetailMock.mockReset()
  })

  it("lists global skills through IPC", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const payload = buildSkillListResult()
    listGlobalSkillsMock.mockReturnValue(payload)

    registerSkillHandlers(ipcMain as never)
    const listHandler = getRequiredHandler(handlers, "skills:list")

    const result = await listHandler({}, {})
    expect(listGlobalSkillsMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(payload)
  })

  it("returns skill detail for a known skill id", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    const detail = buildSkillDetail()
    getGlobalSkillDetailMock.mockReturnValue(detail)

    registerSkillHandlers(ipcMain as never)
    const detailHandler = getRequiredHandler(handlers, "skills:getDetail")
    const result = await detailHandler({}, { skillId: "global_agents:frontend-design" })

    expect(getGlobalSkillDetailMock).toHaveBeenCalledWith("global_agents:frontend-design")
    expect(result).toEqual(detail)
  })

  it("throws when requesting unknown skill detail", async () => {
    const { ipcMain, handlers } = createIpcHarness()
    getGlobalSkillDetailMock.mockReturnValue(null)

    registerSkillHandlers(ipcMain as never)
    const detailHandler = getRequiredHandler(handlers, "skills:getDetail")

    await expect(detailHandler({}, { skillId: "missing-skill" })).rejects.toThrow(
      "Skill not found."
    )
  })
})
