import type {
  HarnessExperimentSpec,
  HarnessProfileSpec,
  HarnessRun,
  HarnessRunStartParams,
  HarnessSuiteSpec,
  HarnessTaskResult
} from "../types"

export interface LoadedHarnessBenchmarks {
  suites: HarnessSuiteSpec[]
  profiles: HarnessProfileSpec[]
  loadedAt: string
}

export interface HarnessRunnerContext {
  workspaceId: string
  workspacePath: string
  runParams: HarnessRunStartParams
  suite: HarnessSuiteSpec
  profile: HarnessProfileSpec
  run: HarnessRun
}

export interface HarnessRunExecutionResult {
  run: HarnessRun
  tasks: HarnessTaskResult[]
}

export interface HarnessExperimentRunContext {
  spec: HarnessExperimentSpec
  startedAt: number
}
