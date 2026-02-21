import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PolicyRule, SecurityDefaults } from "../../src/main/types"

const { listPoliciesByAgentMock } = vi.hoisted(() => ({
  listPoliciesByAgentMock: vi.fn()
}))

vi.mock("../../src/main/db/policies", () => ({
  listPoliciesByAgent: listPoliciesByAgentMock
}))
import {
  evaluatePolicyConstraints,
  extractUrlsFromArgs,
  inferConnectorInvocation,
  isFilesystemToolName,
  mapToolNameToAction,
  parseRateLimitConstraint,
  resolvePolicyDecision
} from "../../src/main/services/policy-engine"

describe("policy engine defaults", () => {
  beforeEach(() => {
    listPoliciesByAgentMock.mockReset()
    listPoliciesByAgentMock.mockReturnValue([])
  })

  function buildSecurityDefaults(overrides?: Partial<SecurityDefaults>): SecurityDefaults {
    return {
      requireExecApproval: true,
      requireNetworkApproval: true,
      denySocialPosting: true,
      ...overrides
    }
  }

  function buildPolicy(overrides?: Partial<PolicyRule>): PolicyRule {
    return {
      id: "policy-1",
      agentId: "agent-1",
      resourceType: "tool",
      resourceKey: "*",
      action: "read",
      scope: "workspace",
      decision: "allow",
      constraints: {},
      createdAt: new Date("2026-02-16T00:00:00.000Z"),
      updatedAt: new Date("2026-02-16T00:00:00.000Z"),
      ...overrides
    }
  }

  it("maps tool names to expected actions", () => {
    expect(mapToolNameToAction("read_file")).toBe("read")
    expect(mapToolNameToAction("write_file")).toBe("write")
    expect(mapToolNameToAction("execute")).toBe("exec")
    expect(mapToolNameToAction("task")).toBe("exec")
    expect(mapToolNameToAction("custom_exec", new Map([["custom_exec", "exec"]]))).toBe("exec")
  })

  it("defaults to ask for destructive tools when no agent policy exists", () => {
    const executeDecision = resolvePolicyDecision({
      resourceType: "tool",
      resourceKey: "execute",
      action: "exec",
      scope: "workspace"
    })

    const readDecision = resolvePolicyDecision({
      resourceType: "tool",
      resourceKey: "read_file",
      action: "read",
      scope: "workspace"
    })

    expect(executeDecision.decision).toBe("ask")
    expect(executeDecision.constraints).toEqual({})
    expect(readDecision.decision).toBe("allow")
    expect(readDecision.constraints).toEqual({})
  })

  it("defaults to deny external posts and ask network execution", () => {
    const networkExec = resolvePolicyDecision({
      resourceType: "network",
      resourceKey: "*",
      action: "exec",
      scope: "workspace"
    })
    const networkPost = resolvePolicyDecision({
      resourceType: "network",
      resourceKey: "*",
      action: "post",
      scope: "workspace"
    })

    expect(networkExec.decision).toBe("ask")
    expect(networkPost.decision).toBe("deny")
  })

  it("enforces pathRegex constraint for filesystem tools", () => {
    const result = evaluatePolicyConstraints({
      resourceType: "tool",
      resourceKey: "write_file",
      constraints: {
        pathRegex: ["^/workspace/src/.*"]
      },
      toolArgs: {
        path: "/workspace/README.md"
      }
    })

    expect(result.allowed).toBe(false)
    expect(result.violation?.constraint).toBe("pathRegex")
  })

  it("enforces pathRegex constraint for filesystem resource policies", () => {
    const result = evaluatePolicyConstraints({
      resourceType: "filesystem",
      resourceKey: "*",
      constraints: {
        pathRegex: ["^/workspace/src/.*"]
      },
      toolArgs: {
        path: "/workspace/README.md"
      }
    })

    expect(result.allowed).toBe(false)
    expect(result.violation?.constraint).toBe("pathRegex")
  })

  it("enforces domain allowlist for URL-bearing tool args", () => {
    const result = evaluatePolicyConstraints({
      resourceType: "tool",
      resourceKey: "execute",
      constraints: {
        domainAllowlist: ["example.com"]
      },
      toolArgs: {
        command: "curl https://api.not-example.com/v1/test"
      }
    })

    expect(result.allowed).toBe(false)
    expect(result.violation?.constraint).toBe("domainAllowlist")
  })

  it("parses rateLimit constraint", () => {
    expect(
      parseRateLimitConstraint({
        rateLimit: {
          maxCalls: 3,
          windowSeconds: 60
        }
      })
    ).toEqual({
      maxCalls: 3,
      windowMs: 60000
    })
  })

  it("extracts URLs from nested args and detects filesystem tools", () => {
    const urls = extractUrlsFromArgs({
      command: "curl https://example.com && wget https://api.example.com/v1",
      nested: {
        url: "https://docs.example.com"
      }
    })

    expect(urls.length).toBe(3)
    expect(isFilesystemToolName("read_file")).toBe(true)
    expect(isFilesystemToolName("execute")).toBe(false)
    expect(isFilesystemToolName("custom_fs", new Set(["custom_fs"]))).toBe(true)
  })

  it("infers connector invocations from tool names and args", () => {
    expect(
      inferConnectorInvocation("connector:slack", { channel: "general" }, ["slack", "discord"])
    ).toEqual({
      connectorKey: "slack",
      action: "post"
    })

    expect(
      inferConnectorInvocation("random_tool", { connector: "Discord" }, ["slack", "discord"])
    ).toEqual({
      connectorKey: "discord",
      action: "post"
    })

    expect(
      inferConnectorInvocation("send_discord_message", { text: "hi" }, ["slack", "discord"])
    ).toEqual({
      connectorKey: "discord",
      action: "post"
    })
  })

  it("enforces global social-post deny even when policy allows connector posting", () => {
    listPoliciesByAgentMock.mockReturnValue([
      buildPolicy({
        resourceType: "connector",
        resourceKey: "slack",
        action: "post",
        decision: "allow"
      })
    ])

    const result = resolvePolicyDecision({
      agentId: "agent-1",
      resourceType: "connector",
      resourceKey: "slack",
      action: "post",
      scope: "workspace",
      securityDefaults: buildSecurityDefaults({
        denySocialPosting: true
      })
    })

    expect(result.decision).toBe("deny")
    expect(result.source).toBe("security_default")
  })

  it("converts allow network execution policy to ask when network approvals are required", () => {
    listPoliciesByAgentMock.mockReturnValue([
      buildPolicy({
        resourceType: "network",
        resourceKey: "*",
        action: "exec",
        decision: "allow"
      })
    ])

    const result = resolvePolicyDecision({
      agentId: "agent-1",
      resourceType: "network",
      resourceKey: "*",
      action: "exec",
      scope: "workspace",
      securityDefaults: buildSecurityDefaults({
        denySocialPosting: false
      })
    })

    expect(result.decision).toBe("ask")
    expect(result.source).toBe("security_default")
  })

  it("converts allow execute policy to ask when exec approvals are required", () => {
    listPoliciesByAgentMock.mockReturnValue([
      buildPolicy({
        resourceType: "tool",
        resourceKey: "execute",
        action: "exec",
        decision: "allow"
      })
    ])

    const result = resolvePolicyDecision({
      agentId: "agent-1",
      resourceType: "tool",
      resourceKey: "execute",
      action: "exec",
      scope: "workspace",
      securityDefaults: buildSecurityDefaults({
        denySocialPosting: false
      })
    })

    expect(result.decision).toBe("ask")
    expect(result.source).toBe("security_default")
  })
})
