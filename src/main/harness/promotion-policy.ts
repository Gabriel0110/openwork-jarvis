import type { HarnessPromotionDecision, HarnessVariantResult } from "../types"

export interface PromotionPolicyInput {
  baseline: HarnessVariantResult
  candidates: HarnessVariantResult[]
  minPrimaryDelta: number
  maxSafetyRegression: number
  maxCatastrophicDrop: number
}

export function evaluatePromotionPolicy(input: PromotionPolicyInput): {
  bestVariant: HarnessVariantResult | null
  decision: HarnessPromotionDecision
} {
  if (input.candidates.length === 0) {
    return {
      bestVariant: null,
      decision: {
        recommendPromotion: false,
        primaryMetric: "average_score",
        primaryDelta: 0,
        threshold: input.minPrimaryDelta,
        safetyRegression: false,
        catastrophicRegression: false,
        reasons: ["No candidate variants were executed."]
      }
    }
  }

  const sorted = [...input.candidates].sort((left, right) => right.scoreDelta - left.scoreDelta)
  const best = sorted[0]
  const safetyRegression = best.safetyDelta < -Math.abs(input.maxSafetyRegression)
  const catastrophicRegression = best.scoreDelta < -Math.abs(input.maxCatastrophicDrop)
  const meetsPrimary = best.scoreDelta >= input.minPrimaryDelta
  const recommendPromotion = meetsPrimary && !safetyRegression && !catastrophicRegression

  const reasons: string[] = []
  if (!meetsPrimary) {
    reasons.push(
      `Primary metric delta ${best.scoreDelta.toFixed(2)} is below threshold ${input.minPrimaryDelta.toFixed(2)}.`
    )
  }
  if (safetyRegression) {
    reasons.push(
      `Safety delta ${best.safetyDelta.toFixed(2)} exceeded allowed regression ${input.maxSafetyRegression.toFixed(2)}.`
    )
  }
  if (catastrophicRegression) {
    reasons.push(
      `Catastrophic drop detected: ${best.scoreDelta.toFixed(2)} < ${-Math.abs(
        input.maxCatastrophicDrop
      ).toFixed(2)}.`
    )
  }
  if (recommendPromotion) {
    reasons.push(`Variant "${best.variantLabel}" satisfies promotion policy.`)
  }

  return {
    bestVariant: best,
    decision: {
      recommendPromotion,
      primaryMetric: "average_score",
      primaryDelta: best.scoreDelta,
      threshold: input.minPrimaryDelta,
      safetyRegression,
      catastrophicRegression,
      reasons
    }
  }
}
