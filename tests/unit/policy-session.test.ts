import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearAllPolicySessions,
  consumePolicyRateLimit,
  grantPolicySessionAccess,
  hasPolicySessionAccess
} from "../../src/main/services/policy-session"

describe("policy session state", () => {
  afterEach(() => {
    clearAllPolicySessions()
    vi.restoreAllMocks()
  })

  it("grants allow_in_session access per thread", () => {
    grantPolicySessionAccess({
      threadId: "thread-a",
      agentId: "agent-1",
      resourceType: "tool",
      resourceKey: "execute",
      action: "exec"
    })

    expect(
      hasPolicySessionAccess({
        threadId: "thread-a",
        agentId: "agent-1",
        resourceType: "tool",
        resourceKey: "execute",
        action: "exec"
      })
    ).toBe(true)

    expect(
      hasPolicySessionAccess({
        threadId: "thread-b",
        agentId: "agent-1",
        resourceType: "tool",
        resourceKey: "execute",
        action: "exec"
      })
    ).toBe(false)
  })

  it("enforces rate limits inside configured time window", () => {
    const nowSpy = vi.spyOn(Date, "now")

    nowSpy.mockReturnValue(1_000)
    expect(
      consumePolicyRateLimit({
        threadId: "thread-a",
        agentId: "agent-1",
        resourceType: "tool",
        resourceKey: "execute",
        action: "exec",
        maxCalls: 2,
        windowMs: 10_000
      }).allowed
    ).toBe(true)

    nowSpy.mockReturnValue(2_000)
    expect(
      consumePolicyRateLimit({
        threadId: "thread-a",
        agentId: "agent-1",
        resourceType: "tool",
        resourceKey: "execute",
        action: "exec",
        maxCalls: 2,
        windowMs: 10_000
      }).allowed
    ).toBe(true)

    nowSpy.mockReturnValue(3_000)
    const blocked = consumePolicyRateLimit({
      threadId: "thread-a",
      agentId: "agent-1",
      resourceType: "tool",
      resourceKey: "execute",
      action: "exec",
      maxCalls: 2,
      windowMs: 10_000
    })

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)

    nowSpy.mockReturnValue(12_000)
    expect(
      consumePolicyRateLimit({
        threadId: "thread-a",
        agentId: "agent-1",
        resourceType: "tool",
        resourceKey: "execute",
        action: "exec",
        maxCalls: 2,
        windowMs: 10_000
      }).allowed
    ).toBe(true)
  })
})
