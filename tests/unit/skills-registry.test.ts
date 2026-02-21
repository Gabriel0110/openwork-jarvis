import { beforeEach, describe, expect, it, vi } from "vitest"

const { existsSyncMock, readFileSyncMock, listSkillsMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  listSkillsMock: vi.fn()
}))

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock
}))

vi.mock("deepagents", () => ({
  listSkills: listSkillsMock
}))

import {
  getGlobalSkillDetail,
  listGlobalSkills,
  resolveSkillsForAgent
} from "../../src/main/services/skills-registry"

describe("skills-registry service", () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
    listSkillsMock.mockReset()
  })

  it("merges global skill sources with ~/.agents precedence", () => {
    existsSyncMock.mockReturnValue(true)
    listSkillsMock.mockImplementation(({ userSkillsDir }: { userSkillsDir: string }) => {
      if (userSkillsDir.includes(".agents/skills")) {
        return [
          {
            name: "frontend-design",
            description: "Agents version",
            path: "/Users/dev/.agents/skills/frontend-design/SKILL.md",
            allowedTools: "read_file edit_file"
          }
        ]
      }
      if (userSkillsDir.includes(".codex/skills")) {
        return [
          {
            name: "frontend-design",
            description: "Codex version",
            path: "/Users/dev/.codex/skills/frontend-design/SKILL.md",
            allowedTools: "read_file"
          },
          {
            name: "seo-optimizer",
            description: "SEO optimizer",
            path: "/Users/dev/.codex/skills/seo-optimizer/SKILL.md",
            allowedTools: "read_file write_file"
          }
        ]
      }
      return []
    })

    const result = listGlobalSkills()
    expect(result.skills.map((skill) => skill.name)).toEqual(["frontend-design", "seo-optimizer"])

    const frontend = result.skills.find((skill) => skill.name === "frontend-design")
    expect(frontend?.source).toBe("global_agents")
    expect(frontend?.description).toBe("Agents version")
    expect(frontend?.allowedTools).toEqual(["read_file", "edit_file"])
  })

  it("resolves assigned skill sets by mode", () => {
    existsSyncMock.mockReturnValue(true)
    listSkillsMock.mockImplementation(() => [
      {
        name: "frontend-design",
        description: "UI skill",
        path: "/Users/dev/.agents/skills/frontend-design/SKILL.md"
      },
      {
        name: "seo-audit",
        description: "SEO skill",
        path: "/Users/dev/.agents/skills/seo-audit/SKILL.md"
      }
    ])

    const globalOnly = resolveSkillsForAgent("global_only", [])
    expect(globalOnly).toHaveLength(2)

    const selectedOnly = resolveSkillsForAgent("selected_only", ["seo-audit"])
    expect(selectedOnly).toHaveLength(1)
    expect(selectedOnly[0]?.name).toBe("seo-audit")

    const globalPlusSelected = resolveSkillsForAgent("global_plus_selected", ["seo-audit"])
    expect(globalPlusSelected).toHaveLength(2)
  })

  it("loads detail content for a known skill id", () => {
    existsSyncMock.mockReturnValue(true)
    listSkillsMock.mockImplementation(() => [
      {
        name: "frontend-design",
        description: "UI skill",
        path: "/Users/dev/.agents/skills/frontend-design/SKILL.md"
      }
    ])
    readFileSyncMock.mockReturnValue("# frontend-design\n\nDetails")

    const list = listGlobalSkills()
    const skillId = list.skills[0]?.id
    expect(skillId).toBeTruthy()

    const detail = getGlobalSkillDetail(skillId as string)
    expect(detail?.skill.name).toBe("frontend-design")
    expect(detail?.content).toContain("Details")
  })
})
