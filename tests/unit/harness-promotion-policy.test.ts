import { describe, expect, it } from "vitest"
import { evaluatePromotionPolicy } from "../../src/main/harness/promotion-policy"
import type { HarnessVariantResult } from "../../src/main/types"

function makeVariant(overrides?: Partial<HarnessVariantResult>): HarnessVariantResult {
  return {
    variantKey: "v1",
    variantLabel: "Variant 1",
    isBaseline: false,
    averageScore: 70,
    scoreDelta: 3,
    latencyDeltaMs: 0,
    costDeltaUsd: 0,
    toolCallDelta: 0,
    safetyDelta: 0,
    summary: {},
    ...overrides
  }
}

describe("promotion policy", () => {
  it("recommends promotion when primary threshold is met and no safety regression", () => {
    const baseline = makeVariant({
      variantKey: "baseline",
      variantLabel: "Baseline",
      isBaseline: true,
      scoreDelta: 0
    })
    const candidate = makeVariant({ variantKey: "candidate", scoreDelta: 4, safetyDelta: 0.2 })

    const result = evaluatePromotionPolicy({
      baseline,
      candidates: [candidate],
      minPrimaryDelta: 1.5,
      maxSafetyRegression: 1,
      maxCatastrophicDrop: 8
    })

    expect(result.bestVariant?.variantKey).toBe("candidate")
    expect(result.decision.recommendPromotion).toBe(true)
  })

  it("blocks promotion when safety regresses too far", () => {
    const baseline = makeVariant({
      variantKey: "baseline",
      variantLabel: "Baseline",
      isBaseline: true,
      scoreDelta: 0
    })
    const unsafeCandidate = makeVariant({
      variantKey: "unsafe",
      scoreDelta: 5,
      safetyDelta: -4
    })

    const result = evaluatePromotionPolicy({
      baseline,
      candidates: [unsafeCandidate],
      minPrimaryDelta: 1,
      maxSafetyRegression: 1,
      maxCatastrophicDrop: 8
    })

    expect(result.decision.recommendPromotion).toBe(false)
    expect(result.decision.safetyRegression).toBe(true)
  })
})
