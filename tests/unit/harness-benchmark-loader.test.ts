import { describe, expect, it } from "vitest"
import {
  getHarnessSuite,
  loadHarnessBenchmarks,
  resolveHarnessProfile
} from "../../src/main/harness/benchmark-loader"

describe("harness benchmark loader", () => {
  it("loads benchmark suites from harness/benchmarks", () => {
    const loaded = loadHarnessBenchmarks()
    expect(loaded.suites.length).toBeGreaterThanOrEqual(3)
    expect(loaded.suites.some((suite) => suite.key === "core-coding")).toBe(true)
  })

  it("resolves a known suite and default profile", () => {
    const suite = getHarnessSuite("core-coding")
    expect(suite.tasks.length).toBeGreaterThanOrEqual(10)

    const profile = resolveHarnessProfile()
    expect(profile.key).toBeTruthy()
    expect(profile.weights.correctness).toBeGreaterThan(0)
  })
})
