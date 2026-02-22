import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function readJson(pathFromRoot: string): unknown {
  const absolutePath = resolve(process.cwd(), pathFromRoot)
  return JSON.parse(readFileSync(absolutePath, "utf8")) as unknown
}

describe("sample packs", () => {
  it("agent starter pack matches expected bundle shape", () => {
    const raw = readJson("agent-packs/starter-atlas-pack.json") as Record<string, unknown>
    expect(raw.version).toBe("1")
    expect(typeof raw.exportedAt).toBe("string")
    expect(typeof raw.workspaceId).toBe("string")

    const items = Array.isArray(raw.items) ? raw.items : []
    expect(items.length).toBeGreaterThan(0)

    for (const item of items) {
      const entry = item as Record<string, unknown>
      const agent = entry.agent as Record<string, unknown>
      expect(typeof agent.name).toBe("string")
      expect(typeof agent.role).toBe("string")
      expect(typeof agent.systemPrompt).toBe("string")
      expect(typeof agent.modelProvider).toBe("string")
      expect(typeof agent.modelName).toBe("string")
      expect(Array.isArray(entry.policies)).toBe(true)
    }
  })

  it("template starter pack matches expected bundle shape", () => {
    const raw = readJson("template-packs/starter-workflow-pack.json") as Record<string, unknown>
    expect(raw.version).toBe("1")
    expect(typeof raw.exportedAt).toBe("string")
    expect(typeof raw.workspaceId).toBe("string")

    const templates = Array.isArray(raw.templates) ? raw.templates : []
    expect(templates.length).toBeGreaterThan(0)

    for (const template of templates) {
      const entry = template as Record<string, unknown>
      expect(typeof entry.name).toBe("string")
      expect(Array.isArray(entry.starterPrompts)).toBe(true)
      expect(Array.isArray(entry.agentIds)).toBe(true)
      expect(Array.isArray(entry.triggers)).toBe(true)
      expect(typeof entry.defaultSpeakerType).toBe("string")
    }
  })
})
