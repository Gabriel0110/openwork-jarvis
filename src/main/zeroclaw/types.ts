import type {
  ZeroClawCapabilityPolicy,
  ZeroClawDeploymentState,
  ZeroClawDeploymentStatus,
  ZeroClawDesiredState,
  ZeroClawEffectiveCapabilitySet,
  ZeroClawEventSeverity,
  ZeroClawRuntimeHealth
} from "../types"

export interface ZeroClawReleaseAsset {
  platform: "darwin-arm64" | "darwin-x64"
  version: string
  sourceUrl?: string
  sourceSha256?: string
  binaryRelativePath?: string
  cargoPackage?: string
  gitRef?: string
}

export interface ZeroClawReleaseManifest {
  latestVersion: string
  releases: ZeroClawReleaseAsset[]
}

export interface ZeroClawRuntimePaths {
  runtimeRoot: string
  deploymentRoot: string
  installRoot: string
}

export interface ZeroClawResolvedPolicy {
  policy: ZeroClawCapabilityPolicy
  effective: ZeroClawEffectiveCapabilitySet
}

export interface ZeroClawProcessEvent {
  deploymentId: string
  eventType: string
  severity: ZeroClawEventSeverity
  message: string
  payload?: Record<string, unknown>
  correlationId?: string
}

export interface ZeroClawSupervisorHandle {
  deploymentId: string
  status: ZeroClawDeploymentStatus
  desiredState: ZeroClawDesiredState
  pid?: number
  health?: ZeroClawRuntimeHealth
  startedAt?: number
}

export interface ZeroClawSupervisorLaunchOptions {
  deployment: ZeroClawDeploymentState
  binaryPath: string
  configPath: string
  logPath: string
  envPath?: string
  env: Record<string, string>
  onEvent: (event: ZeroClawProcessEvent) => void
}
