import { describe, expect, it } from "vitest"
import { generateTitle } from "../../src/main/services/title-generator"

describe("generateTitle", () => {
  it("returns short messages unchanged", () => {
    const message = "Refactor the sidebar loading state"
    expect(generateTitle(message)).toBe(message)
  })

  it("truncates long messages to a readable title", () => {
    const message =
      "Please implement a migration framework that handles schema versions and supports rollback-safe execution for future database changes."

    expect(generateTitle(message).length).toBeLessThanOrEqual(50)
    expect(generateTitle(message).endsWith("...")).toBe(true)
  })
})
