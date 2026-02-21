import { describe, expect, it } from "vitest"
import type { PolicyRule } from "../../src/renderer/src/types"
import {
  POLICY_PRESETS,
  constraintDraftToPolicy,
  policyToConstraintDraft,
  validateConstraintDraft
} from "../../src/renderer/src/components/agents/policy-utils"

describe("policy utils", () => {
  it("validates malformed regex entries", () => {
    const validation = validateConstraintDraft({
      pathRegex: "[unterminated",
      domainAllowlist: "",
      rateLimitMaxCalls: "",
      rateLimitWindowSeconds: ""
    })

    expect(validation.hasError).toBe(true)
    expect(validation.pathRegexError).toContain("Invalid regex")
  })

  it("validates malformed domain entries", () => {
    const validation = validateConstraintDraft({
      pathRegex: "",
      domainAllowlist: "https://example.com",
      rateLimitMaxCalls: "",
      rateLimitWindowSeconds: ""
    })

    expect(validation.hasError).toBe(true)
    expect(validation.domainAllowlistError).toContain("Invalid domain")
  })

  it("requires complete rate limit pairs", () => {
    const validation = validateConstraintDraft({
      pathRegex: "",
      domainAllowlist: "",
      rateLimitMaxCalls: "3",
      rateLimitWindowSeconds: ""
    })

    expect(validation.hasError).toBe(true)
    expect(validation.rateLimitMaxCallsError).toContain("Set both")
  })

  it("converts draft constraints to persisted policy structure", () => {
    const constraints = constraintDraftToPolicy({
      pathRegex: "^/workspace/src/.*, ^/workspace/docs/.*",
      domainAllowlist: "api.example.com, *.example.org",
      rateLimitMaxCalls: "5",
      rateLimitWindowSeconds: "120"
    })

    expect(constraints).toEqual({
      pathRegex: ["^/workspace/src/.*", "^/workspace/docs/.*"],
      domainAllowlist: ["api.example.com", "*.example.org"],
      rateLimit: {
        maxCalls: 5,
        windowSeconds: 120
      }
    })
  })

  it("hydrates draft constraints from persisted policy", () => {
    const policy = {
      id: "policy-1",
      agentId: "agent-1",
      resourceType: "tool",
      resourceKey: "execute",
      action: "exec",
      scope: "workspace",
      decision: "ask",
      constraints: {
        pathRegex: ["^/tmp/.*"],
        domainAllowlist: ["api.example.com"],
        rateLimit: {
          maxCalls: 2,
          windowMs: 30000
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    } as PolicyRule

    expect(policyToConstraintDraft(policy)).toEqual({
      pathRegex: "^/tmp/.*",
      domainAllowlist: "api.example.com",
      rateLimitMaxCalls: "2",
      rateLimitWindowSeconds: "30"
    })
  })

  it("defines expected preset guardrails", () => {
    const safeWrite = POLICY_PRESETS.find((preset) => preset.id === "safe_write")
    const devExec = POLICY_PRESETS.find((preset) => preset.id === "dev_exec")

    expect(safeWrite?.byAction.exec.decision).toBe("ask")
    expect(safeWrite?.byAction.exec.constraints.rateLimitMaxCalls).toBe("3")

    expect(devExec?.byAction.exec.decision).toBe("allow_in_session")
    expect(devExec?.byAction.exec.constraints.rateLimitWindowSeconds).toBe("60")
  })
})
