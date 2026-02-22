export type HarnessNovelFeature =
  | "N1_failure_fingerprint_clustering"
  | "N2_counterfactual_replay"
  | "N3_dynamic_subagent_portfolio_router"
  | "N4_policy_simulation_sandbox"
  | "N5_confidence_calibrated_verifier"
  | "N6_cost_quality_frontier_optimizer"
  | "N7_harness_memory"

export interface HarnessNovelStubResult {
  feature: HarnessNovelFeature
  enabled: boolean
  status: "stubbed"
  message: string
}

const FEATURE_FLAGS: Array<{
  feature: HarnessNovelFeature
  envVar: string
}> = [
  { feature: "N1_failure_fingerprint_clustering", envVar: "HARNESS_N1_ENABLED" },
  { feature: "N2_counterfactual_replay", envVar: "HARNESS_N2_ENABLED" },
  { feature: "N3_dynamic_subagent_portfolio_router", envVar: "HARNESS_N3_ENABLED" },
  { feature: "N4_policy_simulation_sandbox", envVar: "HARNESS_N4_ENABLED" },
  { feature: "N5_confidence_calibrated_verifier", envVar: "HARNESS_N5_ENABLED" },
  { feature: "N6_cost_quality_frontier_optimizer", envVar: "HARNESS_N6_ENABLED" },
  { feature: "N7_harness_memory", envVar: "HARNESS_N7_ENABLED" }
]

function envEnabled(envVar: string): boolean {
  return String(process.env[envVar] || "").toLowerCase() === "true"
}

export function getHarnessNovelStubs(): HarnessNovelStubResult[] {
  return FEATURE_FLAGS.map((flag) => ({
    feature: flag.feature,
    enabled: envEnabled(flag.envVar),
    status: "stubbed",
    message: "Feature contract is registered but execution path is intentionally disabled in v1."
  }))
}
