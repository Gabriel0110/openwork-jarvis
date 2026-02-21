import { describe, expect, it } from "vitest"
import { DEFAULT_AGENT_PACK } from "../../src/main/services/default-agent-pack"

describe("DEFAULT_AGENT_PACK", () => {
  it("includes one orchestrator and a specialist roster", () => {
    const orchestrators = DEFAULT_AGENT_PACK.filter((agent) => agent.isOrchestrator)
    expect(orchestrators).toHaveLength(1)
    expect(orchestrators[0].name).toBe("Orchestrator")

    const names = new Set(DEFAULT_AGENT_PACK.map((agent) => agent.name))
    expect(names.has("Coder")).toBe(true)
    expect(names.has("Reviewer")).toBe(true)
    expect(names.has("Researcher")).toBe(true)
    expect(names.has("Writer")).toBe(true)
    expect(names.has("Editor")).toBe(true)
    expect(names.has("Social Manager")).toBe(true)
    expect(names.has("Operator")).toBe(true)
  })

  it("uses unique names and valid model defaults", () => {
    const names = DEFAULT_AGENT_PACK.map((agent) => agent.name)
    expect(new Set(names).size).toBe(names.length)
    for (const agent of DEFAULT_AGENT_PACK) {
      expect(agent.modelProvider).toBeTruthy()
      expect(agent.modelName).toBeTruthy()
      expect(agent.systemPrompt.length).toBeGreaterThan(20)
    }
  })
})
