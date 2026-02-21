import { describe, expect, it } from "vitest"
import { normalizeTemplateTriggers } from "../../src/main/services/template-triggers"

describe("normalizeTemplateTriggers", () => {
  it("returns an empty array when triggers are undefined", () => {
    expect(normalizeTemplateTriggers(undefined)).toEqual([])
  })

  it("normalizes valid trigger definitions and generates missing ids", () => {
    const normalized = normalizeTemplateTriggers([
      {
        id: "",
        type: "timeline_event",
        eventKey: "tool_result",
        enabled: true
      },
      {
        id: "",
        type: "webhook",
        eventKey: "incoming",
        executionMode: "auto_run",
        sourceKey: "ingress",
        matchText: "release",
        enabled: false
      }
    ])

    expect(normalized).toHaveLength(2)
    expect(normalized[0].id.length).toBeGreaterThan(0)
    expect(normalized[1].id.length).toBeGreaterThan(0)
    expect(normalized[0].id).not.toBe(normalized[1].id)
    expect(normalized[0].executionMode).toBe("notify")
    expect(normalized[1].executionMode).toBe("auto_run")
    expect(normalized[1].enabled).toBe(false)
    expect(normalized[1].sourceKey).toBe("ingress")
  })

  it("throws for unsupported trigger types", () => {
    expect(() =>
      normalizeTemplateTriggers([
        {
          id: "bad-1",
          type: "unknown",
          eventKey: "tool_result",
          enabled: true
        }
      ] as never)
    ).toThrow("Unsupported template trigger type")
  })

  it("throws for unsupported trigger execution modes", () => {
    expect(() =>
      normalizeTemplateTriggers([
        {
          id: "bad-2",
          type: "timeline_event",
          eventKey: "tool_result",
          enabled: true,
          executionMode: "run_now"
        }
      ] as never)
    ).toThrow("Unsupported template trigger execution mode")
  })
})
