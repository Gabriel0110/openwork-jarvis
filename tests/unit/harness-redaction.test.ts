import { describe, expect, it } from "vitest"
import { redactHarnessPayload } from "../../src/main/harness/redaction"

describe("harness redaction", () => {
  it("redacts common secret patterns and home paths", () => {
    const payload = {
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      nested: {
        token: "ghp_abcdefghijklmnopqrstuvwxyz123456",
        path: "/Users/tester/Documents/private"
      },
      text: "call with key sk-abcdefghijklmnopqrstuvwxyz123456"
    }

    const redacted = redactHarnessPayload(payload)
    expect(redacted.apiKey).toBe("[REDACTED]")
    expect((redacted.nested as Record<string, unknown>).token).toBe("[REDACTED]")
    expect((redacted.nested as Record<string, unknown>).path).toBe("/$HOME/Documents/private")
    expect(redacted.text).not.toContain("sk-")
  })
})
