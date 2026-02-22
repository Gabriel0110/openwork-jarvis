// Thread types matching langgraph-api
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

// =============================================================================
// IPC Handler Parameter Types
// =============================================================================

// Agent IPC
export interface AgentInvokeParams {
  threadId: string
  message: string
  modelId?: string
  speakerType?: "orchestrator" | "agent" | "zeroclaw"
  speakerAgentId?: string
}

export interface AgentResumeParams {
  threadId: string
  command: {
    resume?: {
      decision?: string
      toolName?: string
      toolCallId?: string
      toolArgs?: Record<string, unknown>
    }
  }
  modelId?: string
  speakerType?: "orchestrator" | "agent" | "zeroclaw"
  speakerAgentId?: string
}

export interface AgentInterruptParams {
  threadId: string
  decision: HITLDecision
}

export interface AgentCancelParams {
  threadId: string
}

// Agent registry IPC
export interface AgentListParams {
  workspaceId?: string
}

export type AgentSkillMode = "global_only" | "global_plus_selected" | "selected_only"

export interface AgentCreateParams {
  workspaceId?: string
  name: string
  role: string
  systemPrompt: string
  modelProvider: ProviderId
  modelName: string
  toolAllowlist?: string[]
  connectorAllowlist?: string[]
  memoryScope?: "private" | "shared"
  skillMode?: AgentSkillMode
  skillsAllowlist?: string[]
  tags?: string[]
  isOrchestrator?: boolean
}

export interface AgentUpdateParams {
  agentId: string
  updates: Partial<Omit<AgentDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
}

export interface AgentExportItem {
  agent: AgentDefinition
  policies: PolicyRule[]
}

export interface AgentExportBundle {
  version: "1"
  exportedAt: string
  workspaceId: string
  items: AgentExportItem[]
}

export interface AgentImportParams {
  bundle: AgentExportBundle
}

// Skills IPC
export type SkillSource = "global_agents" | "global_codex"

export interface SkillDefinition {
  id: string
  name: string
  description: string
  path: string
  source: SkillSource
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools: string[]
}

export interface SkillRegistryLocation {
  source: SkillSource
  path: string
  exists: boolean
}

export interface SkillListResult {
  skills: SkillDefinition[]
  locations: SkillRegistryLocation[]
  loadedAt: string
}

export interface SkillGetParams {
  skillId: string
}

export interface SkillDetail {
  skill: SkillDefinition
  content: string
}

// Prompt repository IPC
export type PromptAssetScope = "global" | "workspace"
export type PromptAssetSource = "managed" | "discovered_agents" | "discovered_openwork"
export type PromptBindingTargetType = "workspace" | "agent"
export type PromptMaterializeMode = "workspace_root" | "agent_docs"
export type PromptSyncMode = "managed"
export type PromptMaterializationStatus = "applied" | "conflict" | "failed" | "skipped"
export type PromptBindingStatus = "in_sync" | "conflict" | "failed" | "never_applied"

export interface PromptAsset {
  id: string
  workspaceId?: string
  slug: string
  title: string
  description?: string
  fileName: string
  scope: PromptAssetScope
  source: PromptAssetSource
  contentPath: string
  tags: string[]
  variables: string[]
  isSystem: boolean
  createdAt: Date
  updatedAt: Date
}

export interface PromptBinding {
  id: string
  assetId: string
  workspaceId: string
  targetType: PromptBindingTargetType
  targetAgentId?: string
  materializeMode: PromptMaterializeMode
  relativeOutputPath?: string
  syncMode: PromptSyncMode
  enabled: boolean
  lastMaterializedHash?: string
  lastAssetHash?: string
  lastMaterializedAt?: Date
  lastError?: string
  status: PromptBindingStatus
  createdAt: Date
  updatedAt: Date
}

export interface PromptMaterializationRecord {
  id: string
  bindingId: string
  workspaceId: string
  status: PromptMaterializationStatus
  resolvedPath: string
  beforeHash?: string
  afterHash?: string
  assetHash?: string
  message?: string
  createdAt: Date
}

export interface PromptConflict {
  bindingId: string
  assetId: string
  resolvedPath: string
  currentHash?: string
  expectedHash?: string
  assetHash: string
  message: string
  currentContent?: string
  assetContent?: string
}

export interface PromptRenderPreview {
  content: string
  warnings: string[]
  variables: Record<string, string>
  unknownVariables: string[]
}

export interface PromptListResult {
  assets: PromptAsset[]
  effectiveAssets: PromptAsset[]
  loadedAt: string
}

export interface PromptPack {
  version: "1"
  exportedAt: string
  workspaceId?: string
  assets: Array<{
    assetId?: string
    slug: string
    title: string
    description?: string
    fileName: string
    scope: PromptAssetScope
    workspaceId?: string
    tags: string[]
    variables: string[]
    content: string
  }>
  bindings?: PromptBinding[]
  meta?: {
    appVersion?: string
  }
}

export interface PromptListParams {
  workspaceId?: string
  query?: string
  scope?: PromptAssetScope | "all"
  source?: PromptAssetSource | "all"
  agentsOnly?: boolean
}

export interface PromptGetParams {
  assetId: string
}

export interface PromptCreateParams {
  workspaceId?: string
  title: string
  description?: string
  slug?: string
  fileName: string
  scope?: PromptAssetScope
  tags?: string[]
  variables?: string[]
  content: string
}

export interface PromptUpdateParams {
  assetId: string
  updates: Partial<
    Pick<PromptAsset, "title" | "description" | "slug" | "fileName" | "tags" | "variables">
  > & {
    content?: string
  }
}

export interface PromptDeleteParams {
  assetId: string
}

export interface PromptRenderPreviewParams {
  assetId?: string
  content?: string
  workspaceId?: string
  workspaceRoot?: string
  agentId?: string
  agentName?: string
  agentRole?: string
  variables?: Record<string, string>
}

export interface PromptBindingListParams {
  workspaceId?: string
}

export interface PromptBindingCreateParams {
  assetId: string
  workspaceId?: string
  targetType: PromptBindingTargetType
  targetAgentId?: string
  materializeMode: PromptMaterializeMode
  relativeOutputPath?: string
  enabled?: boolean
}

export interface PromptBindingUpdateParams {
  bindingId: string
  updates: Partial<
    Pick<
      PromptBinding,
      "targetType" | "targetAgentId" | "materializeMode" | "relativeOutputPath" | "enabled"
    >
  >
}

export interface PromptBindingDeleteParams {
  bindingId: string
}

export interface PromptMaterializeParams {
  bindingId: string
  workspaceRoot?: string
  overwriteConflict?: boolean
  variables?: Record<string, string>
}

export interface PromptMaterializeAllParams {
  workspaceId?: string
  workspaceRoot?: string
  overwriteConflict?: boolean
  variables?: Record<string, string>
}

export interface PromptHistoryListParams {
  workspaceId?: string
  bindingId?: string
  limit?: number
}

export interface PromptExportPackParams {
  workspaceId?: string
  includeBindings?: boolean
  format?: "json" | "yaml"
}

export interface PromptImportPackParams {
  content: string
  format?: "json" | "yaml"
  workspaceId?: string
  replaceExisting?: boolean
}

export interface PromptBootstrapCheckParams {
  workspaceId?: string
  workspaceRoot?: string
}

export interface PromptBootstrapCheckResult {
  shouldSuggest: boolean
  workspaceId?: string
  workspaceRoot?: string
  reason: string
}

// Harness engineering IPC
export type HarnessRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
export type HarnessTaskStatus = "queued" | "running" | "passed" | "failed" | "cancelled"
export type HarnessTaskTier = "easy" | "medium" | "hard"
export type HarnessFindingSeverity = "low" | "medium" | "high" | "critical"
export type HarnessFindingStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "queued_for_experiment"
export type HarnessExperimentStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
export type HarnessGateStatus = "pass" | "warn" | "fail"
export type HarnessTraceExportFormat = "json" | "jsonl" | "summary"
export type HarnessTaskExecutionMode = "live" | "synthetic"
export type HarnessStopReason =
  | "completed"
  | "budget_exhausted"
  | "blocked_on_approval"
  | "policy_denied"
  | "tool_failure"
  | "loop_detected"
  | "timeout"
  | "internal_error"

export interface HarnessScoreBreakdown {
  correctness: number
  completeness: number
  safetyCompliance: number
  efficiency: number
  toolHygiene: number
  weightedTotal: number
}

export interface HarnessArtifactExpectation {
  path: string
  required?: boolean
  mustContain?: string[]
}

export interface HarnessTaskSpec {
  key: string
  name: string
  description?: string
  tier: HarnessTaskTier
  prompt: string
  fixturePath?: string
  expectedArtifacts?: HarnessArtifactExpectation[]
  tags?: string[]
  maxDurationMs?: number
  maxToolCalls?: number
  maxTokens?: number
}

export interface HarnessSuiteSpec {
  key: string
  name: string
  description?: string
  tags?: string[]
  tasks: HarnessTaskSpec[]
}

export interface HarnessProfileSpec {
  key: string
  name: string
  description?: string
  modelId?: string
  weights: {
    correctness: number
    completeness: number
    safetyCompliance: number
    efficiency: number
    toolHygiene: number
  }
  budgets: {
    maxDurationMs: number
    maxToolCalls: number
    maxTokens: number
  }
}

export interface HarnessArtifactRecord {
  id: string
  runId: string
  taskKey: string
  artifactType: string
  artifactPath?: string
  artifactHash?: string
  payload: Record<string, unknown>
  retentionTtlDays: number
  createdAt: Date
}

export interface HarnessTaskResult {
  id: string
  runId: string
  taskKey: string
  taskName: string
  taskTier: HarnessTaskTier
  status: HarnessTaskStatus
  threadId?: string
  scoreTotal: number
  scoreBreakdown: HarnessScoreBreakdown
  durationMs: number
  tokenUsage: number
  toolCalls: number
  costUsd: number
  stopReason?: HarnessStopReason
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface HarnessRunSummary {
  taskCount: number
  passedCount: number
  failedCount: number
  averageScore: number
  scoreByTier: Record<HarnessTaskTier, number>
  stopReasons: Record<string, number>
}

export interface HarnessRun {
  id: string
  workspaceId: string
  suiteKey: string
  suiteName: string
  profileKey: string
  status: HarnessRunStatus
  modelProfile?: string
  executionMode: "local" | "matrix" | "live" | "synthetic"
  seed?: number
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  summary: HarnessRunSummary
  errorText?: string
  createdAt: Date
  updatedAt: Date
}

export interface HarnessTraceNode {
  id: string
  type:
    | "run"
    | "task"
    | "timeline_event"
    | "tool_call"
    | "approval"
    | "subagent"
    | "artifact"
    | "stop_reason"
  label: string
  timestamp: string
  data: Record<string, unknown>
}

export interface HarnessTraceEdge {
  id: string
  from: string
  to: string
  type: "contains" | "calls" | "emits" | "depends_on" | "blocked_by" | "produced"
}

export interface HarnessTraceExport {
  id: string
  runId: string
  taskKey?: string
  format: HarnessTraceExportFormat
  serialized?: string
  summary: {
    nodeCount: number
    edgeCount: number
    generatedAt: string
    redactionVersion: string
  }
  nodes: HarnessTraceNode[]
  edges: HarnessTraceEdge[]
  events: Array<Record<string, unknown>>
  createdAt: Date
}

export interface HarnessHypothesis {
  id: string
  findingId: string
  runId: string
  title: string
  summary: string
  interventionType: string
  interventionPayload: Record<string, unknown>
  confidence: number
  rank: number
  createdAt: Date
}

export interface HarnessFinding {
  id: string
  runId: string
  taskKey?: string
  fingerprint: string
  category:
    | "spec_non_compliance"
    | "missing_verification"
    | "tool_misuse"
    | "loop_or_stall"
    | "policy_friction"
    | "budget_misallocation"
    | "output_contract_failure"
  severity: HarnessFindingSeverity
  status: HarnessFindingStatus
  title: string
  summary: string
  evidence: Array<{ nodeId?: string; description: string }>
  confidence: number
  intervention: Record<string, unknown>
  reviewerNotes?: string
  reviewedBy?: string
  reviewedAt?: Date
  createdAt: Date
  updatedAt: Date
  hypotheses?: HarnessHypothesis[]
}

export interface HarnessVariantResult {
  variantKey: string
  variantLabel: string
  isBaseline: boolean
  runId?: string
  runIds?: string[]
  sampleCount?: number
  retriesUsed?: number
  failedRunCount?: number
  averageScore: number
  scoreDelta: number
  latencyDeltaMs: number
  costDeltaUsd: number
  toolCallDelta: number
  safetyDelta: number
  summary: Record<string, unknown>
}

export interface HarnessGateReport {
  id: string
  targetRef: string
  stage: "observe" | "soft_gate" | "hard_gate"
  status: HarnessGateStatus
  summary: Record<string, unknown>
  createdAt: Date
}

export interface HarnessPromotionDecision {
  recommendPromotion: boolean
  primaryMetric: "average_score"
  primaryDelta: number
  threshold: number
  safetyRegression: boolean
  catastrophicRegression: boolean
  reasons: string[]
}

export interface HarnessExperimentSpec {
  key: string
  name: string
  description?: string
  suiteKey: string
  profileKey?: string
  sampleSize: number
  retryCount: number
  gating: {
    minPrimaryDelta: number
    maxSafetyRegression: number
    maxCatastrophicDrop: number
  }
  variants: Array<{
    key: string
    label: string
    promptPatch?: string
    middleware?: Record<string, unknown>
    budget?: Partial<HarnessProfileSpec["budgets"]>
    modelId?: string
  }>
}

export interface HarnessExperimentRun {
  id: string
  specKey: string
  baselineSuiteKey: string
  status: HarnessExperimentStatus
  startedAt?: Date
  completedAt?: Date
  variants: HarnessVariantResult[]
  report?: Record<string, unknown>
  promotionDecision: HarnessPromotionDecision
  approvedBy?: string
  approvedAt?: Date
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface HarnessRetentionPolicy {
  rawArtifactsTtlDays: number
  traceExportsTtlDays: number
  findingsTtlDays: number
  workspaceCopiesTtlDays?: number
}

export interface HarnessMetricSummary {
  totalRuns: number
  activeRuns: number
  queuedRuns: number
  completedRuns: number
  failedRuns: number
  completionRate: number
  averageScore: number
  averageFailedTasksPerRun: number
  pendingApprovals: number
  totalFindings: number
  approvedFindings: number
  rejectedFindings: number
  queuedForExperimentFindings: number
  approvalLatencyP50Ms: number
  approvalLatencyP95Ms: number
  approveRatio: number
  rejectRatio: number
  editRatio: number
  policyDeniedCount: number
  blockedRunCount: number
  updatedAt: string
}

export interface HarnessRunVariantConfig {
  variantKey?: string
  variantLabel?: string
  promptPatch?: string
  middleware?: Record<string, unknown>
  budget?: Partial<HarnessProfileSpec["budgets"]>
}

export interface HarnessRunStartParams {
  suiteKey: string
  workspaceId?: string
  workspacePath?: string
  profileKey?: string
  modelId?: string
  executionMode?: "local" | "matrix"
  taskExecutionMode?: HarnessTaskExecutionMode
  seed?: number
  variantConfig?: HarnessRunVariantConfig
}

export interface HarnessRunListFilters {
  status?: HarnessRunStatus
  suiteKey?: string
  workspaceId?: string
  limit?: number
}

export interface HarnessRunGetParams {
  runId: string
}

export interface HarnessRunCancelParams {
  runId: string
}

export interface HarnessArtifactsParams {
  runId: string
  taskKey?: string
}

export interface HarnessTraceExportParams {
  runId: string
  taskKey?: string
  format?: HarnessTraceExportFormat
}

export interface HarnessFindingsListParams {
  runId?: string
  status?: HarnessFindingStatus
  severity?: HarnessFindingSeverity
  limit?: number
}

export interface HarnessFindingReviewParams {
  findingId: string
  decision: "approved" | "rejected" | "queued_for_experiment"
  notes?: string
  reviewer?: string
}

export interface HarnessExperimentsRunParams {
  specIdOrInlineSpec: string | HarnessExperimentSpec
}

export interface HarnessExperimentsListParams {
  status?: HarnessExperimentStatus
  limit?: number
}

export interface HarnessExperimentGetParams {
  experimentRunId: string
}

export interface HarnessExperimentPromoteParams {
  experimentRunId: string
  approvedBy: string
  notes?: string
}

export interface HarnessMetricsSummaryParams {
  windowMs?: number
}

export interface HarnessRetentionRunResult {
  removedArtifacts: number
  removedTraceExports: number
  removedFindings: number
  removedWorkspaceCopies: number
  runAt: string
}

// Timeline and graph IPC
export type TimelineEventType =
  | "user_message"
  | "tool_call"
  | "tool_result"
  | "approval_required"
  | "subagent_started"
  | "subagent_completed"
  | "template_trigger_match"
  | "error"

export interface TimelineEvent {
  id: string
  threadId: string
  workspaceId: string
  eventType: TimelineEventType
  sourceAgentId?: string
  targetAgentId?: string
  toolName?: string
  summary?: string
  payload: Record<string, unknown>
  occurredAt: Date
  createdAt: Date
}

export interface TimelineListParams {
  threadId: string
  limit?: number
}

export interface TimelineWorkspaceListParams {
  workspaceId?: string
  limit?: number
}

export type TimelineIngestTriggerType = "connector_event" | "webhook"

export interface TimelineIngestTriggerParams {
  threadId: string
  workspaceId?: string
  triggerType: TimelineIngestTriggerType
  eventType?: "tool_call" | "tool_result"
  eventKey: string
  sourceKey?: string
  toolName?: string
  summary?: string
  sourceAgentId?: string
  dedupeKey?: string
  payload?: Record<string, unknown>
}

export interface GraphLayoutEntry {
  workspaceId: string
  agentId: string
  x: number
  y: number
  updatedAt: Date
}

export interface GraphLayoutListParams {
  workspaceId: string
}

export interface GraphLayoutUpsertParams {
  workspaceId: string
  agentId: string
  x: number
  y: number
}

export interface GraphLayoutClearParams {
  workspaceId: string
}

// Memory and RAG IPC
export type MemoryEntryScope = "session" | "agent" | "workspace"
export type RagSourceStatus = "idle" | "indexing" | "ready" | "error"

export interface MemoryEntry {
  id: string
  workspaceId: string
  scope: MemoryEntryScope
  agentId?: string
  threadId?: string
  title?: string
  content: string
  tags: string[]
  source: string
  locked: boolean
  createdAt: Date
  updatedAt: Date
}

export interface RagSource {
  id: string
  workspaceId: string
  path: string
  enabled: boolean
  includeGlobs: string[]
  excludeGlobs: string[]
  status: RagSourceStatus
  lastIndexedAt?: Date
  lastError?: string
  chunkCount: number
  createdAt: Date
  updatedAt: Date
}

export interface MemorySearchResult {
  source: "memory" | "rag"
  id: string
  score: number
  title?: string
  contentSnippet: string
  path?: string
  scope?: MemoryEntryScope
  agentId?: string
  threadId?: string
  createdAt: Date
}

export interface MemoryListEntriesParams {
  workspaceId?: string
  scope?: MemoryEntryScope
  agentId?: string
  threadId?: string
  limit?: number
}

export interface MemoryCreateEntryParams {
  workspaceId?: string
  scope: MemoryEntryScope
  agentId?: string
  threadId?: string
  title?: string
  content: string
  tags?: string[]
  source?: string
}

export interface MemoryDeleteEntryParams {
  entryId: string
}

export interface MemorySetEntryLockedParams {
  entryId: string
  locked: boolean
}

export interface RagListSourcesParams {
  workspaceId?: string
}

export interface RagUpsertSourceParams {
  sourceId?: string
  workspaceId?: string
  path: string
  enabled?: boolean
  includeGlobs?: string[]
  excludeGlobs?: string[]
}

export interface RagDeleteSourceParams {
  sourceId: string
}

export interface RagIndexParams {
  threadId: string
  workspaceId?: string
  sourceIds?: string[]
  maxFiles?: number
  maxFileSizeBytes?: number
}

export interface RagIndexResult {
  indexedSources: number
  indexedFiles: number
  indexedChunks: number
  skippedFiles: number
  errors: string[]
}

export interface MemorySearchParams {
  workspaceId?: string
  query: string
  limit?: number
}

// Connectors and MCP IPC
export type ConnectorCategory = "messaging" | "dev" | "social" | "email" | "webhook" | "custom"
export type ConnectorStatus = "disconnected" | "connected" | "error"
export type McpServerStatus = "stopped" | "running" | "error"

export interface ConnectorDefinition {
  id: string
  workspaceId: string
  key: string
  name: string
  category: ConnectorCategory
  config: Record<string, unknown>
  enabled: boolean
  status: ConnectorStatus
  createdAt: Date
  updatedAt: Date
}

export interface McpServerDefinition {
  id: string
  workspaceId: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  status: McpServerStatus
  lastError?: string
  createdAt: Date
  updatedAt: Date
}

export interface ConnectorListParams {
  workspaceId?: string
}

export interface ConnectorCreateParams {
  workspaceId?: string
  key: string
  name: string
  category: ConnectorCategory
  config?: Record<string, unknown>
  enabled?: boolean
  status?: ConnectorStatus
}

export interface ConnectorUpdateParams {
  connectorId: string
  updates: Partial<Omit<ConnectorDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
}

export interface ConnectorDeleteParams {
  connectorId: string
}

export interface ConnectorBundleItem {
  key: string
  name: string
  category: ConnectorCategory
  config: Record<string, unknown>
  enabled: boolean
  status: ConnectorStatus
}

export interface McpServerBundleItem {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  status: McpServerStatus
  lastError?: string
}

export interface ConnectorExportBundle {
  version: "1"
  exportedAt: string
  workspaceId: string
  redacted: boolean
  connectors: ConnectorBundleItem[]
  mcpServers: McpServerBundleItem[]
}

export interface ConnectorExportParams {
  workspaceId?: string
  includeSecrets?: boolean
}

export interface ConnectorImportParams {
  bundle: ConnectorExportBundle
  workspaceId?: string
}

export interface ConnectorImportResult {
  connectors: ConnectorDefinition[]
  mcpServers: McpServerDefinition[]
}

// ZeroClaw deployment IPC
export type ZeroClawInstallState = "not_installed" | "installing" | "installed" | "error"
export type ZeroClawInstallActivityState = "idle" | "running" | "success" | "error"
export type ZeroClawInstallActivityStream = "system" | "stdout" | "stderr"
export type ZeroClawDeploymentStatus =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
export type ZeroClawDesiredState = "running" | "stopped"
export type ZeroClawEventSeverity = "debug" | "info" | "warning" | "error"
export type ZeroClawCapabilityMode =
  | "global_only"
  | "global_plus_assigned"
  | "assigned_only"
  | "deny_all_except_assigned"

export interface ZeroClawVersionRecord {
  version: string
  source: "managed" | "external"
  installPath: string
  binaryPath: string
  checksumSha256?: string
  installedAt: Date
  isActive: boolean
}

export interface ZeroClawInstallStatus {
  state: ZeroClawInstallState
  activeVersion?: string
  availableVersions: string[]
  installations: ZeroClawVersionRecord[]
  lastError?: string
  runtimeRoot: string
}

export interface ZeroClawInstallActivityLine {
  id: number
  stream: ZeroClawInstallActivityStream
  message: string
  occurredAt: Date
}

export interface ZeroClawInstallActivity {
  state: ZeroClawInstallActivityState
  phase: string
  targetVersion?: string
  startedAt?: Date
  updatedAt: Date
  completedAt?: Date
  lastError?: string
  lines: ZeroClawInstallActivityLine[]
}

export interface ZeroClawCapabilityPolicy {
  mode: ZeroClawCapabilityMode
  includeGlobalSkills: boolean
  assignedSkillIds: string[]
  assignedToolNames: string[]
  assignedConnectorKeys: string[]
  deniedToolNames: string[]
  deniedConnectorKeys: string[]
}

export interface ZeroClawEffectiveCapabilitySet {
  mode: ZeroClawCapabilityMode
  skills: SkillDefinition[]
  tools: ToolDefinition[]
  connectors: ConnectorDefinition[]
  gates: {
    read: boolean
    write: boolean
    exec: boolean
    network: boolean
    channel: boolean
  }
}

export interface ZeroClawDeploymentSpec {
  workspaceId?: string
  name: string
  description?: string
  runtimeVersion?: string
  workspacePath: string
  modelProvider: ProviderId
  modelName: string
  env?: Record<string, string>
  gatewayHost?: string
  gatewayPort?: number
  apiBaseUrl?: string
  policy?: Partial<ZeroClawCapabilityPolicy>
  autoStart?: boolean
}

export interface ZeroClawDeploymentState {
  id: string
  workspaceId: string
  name: string
  description?: string
  runtimeVersion: string
  workspacePath: string
  modelProvider: ProviderId
  modelName: string
  status: ZeroClawDeploymentStatus
  desiredState: ZeroClawDesiredState
  processId?: number
  gatewayHost: string
  gatewayPort: number
  apiBaseUrl: string
  lastError?: string
  policy: ZeroClawCapabilityPolicy
  effectiveCapabilities: ZeroClawEffectiveCapabilitySet
  createdAt: Date
  updatedAt: Date
}

export interface ZeroClawRuntimeHealth {
  deploymentId: string
  status: "unknown" | "healthy" | "degraded" | "unhealthy"
  checkedAt: Date
  latencyMs?: number
  detail?: Record<string, unknown>
  error?: string
}

export interface ZeroClawRuntimeEvent {
  id: string
  deploymentId: string
  eventType: string
  severity: ZeroClawEventSeverity
  message: string
  payload: Record<string, unknown>
  correlationId?: string
  occurredAt: Date
  createdAt: Date
}

export interface ZeroClawDoctorCheck {
  id: string
  label: string
  ok: boolean
  details?: string
  repairHint?: string
}

export interface ZeroClawDoctorReport {
  deploymentId?: string
  generatedAt: Date
  healthy: boolean
  checks: ZeroClawDoctorCheck[]
}

export interface ZeroClawActionResult {
  ok: boolean
  message: string
}

export interface ZeroClawInstallVersionParams {
  version?: string
}

export interface ZeroClawUpgradeParams {
  version: string
}

export interface ZeroClawDeploymentCreateParams {
  spec: ZeroClawDeploymentSpec
}

export interface ZeroClawDeploymentUpdateParams {
  deploymentId: string
  updates: Partial<
    Omit<ZeroClawDeploymentSpec, "workspaceId" | "policy"> & {
      desiredState: ZeroClawDesiredState
      policy: Partial<ZeroClawCapabilityPolicy>
    }
  >
}

export interface ZeroClawDeploymentDeleteParams {
  deploymentId: string
}

export interface ZeroClawDeploymentGetParams {
  deploymentId: string
}

export interface ZeroClawDeploymentListParams {
  workspaceId?: string
}

export interface ZeroClawRuntimeActionParams {
  deploymentId: string
}

export interface ZeroClawLogsParams {
  deploymentId: string
  cursor?: string
  limit?: number
}

export interface ZeroClawPolicySetParams {
  deploymentId: string
  policy: ZeroClawCapabilityPolicy
}

export interface ZeroClawDoctorRunParams {
  deploymentId?: string
}

// Tool registry IPC
export type ToolCategory =
  | "filesystem"
  | "execution"
  | "network"
  | "connector"
  | "memory"
  | "skills"
  | "custom"

export type ToolRiskTier = 0 | 1 | 2 | 3
export type ToolSource = "system" | "custom"
export type ToolImplementationType = "builtin" | "script"

export interface ToolDefinition {
  id: string
  workspaceId: string
  name: string
  displayName: string
  description: string
  category: ToolCategory
  action: PolicyAction
  riskTier: ToolRiskTier
  source: ToolSource
  implementationType: ToolImplementationType
  config: Record<string, unknown>
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ToolListParams {
  workspaceId?: string
  includeDisabled?: boolean
}

export interface ToolGetParams {
  toolId: string
}

export interface ToolCreateParams {
  workspaceId?: string
  name: string
  displayName: string
  description: string
  category?: ToolCategory
  action: PolicyAction
  riskTier: ToolRiskTier
  implementationType?: ToolImplementationType
  config?: Record<string, unknown>
  enabled?: boolean
}

export interface ToolUpdateParams {
  toolId: string
  updates: Partial<
    Omit<ToolDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt" | "source">
  >
}

export interface ToolDeleteParams {
  toolId: string
}

export interface McpServerCreateParams {
  workspaceId?: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  status?: McpServerStatus
  lastError?: string
}

export interface McpServerUpdateParams {
  serverId: string
  updates: Partial<Omit<McpServerDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
}

export interface McpServerDeleteParams {
  serverId: string
}

// Workflow templates IPC
export interface WorkflowTemplatePolicyDefault {
  agentId?: string
  resourceType: PolicyResourceType
  resourceKey: string
  action: PolicyAction
  scope: PolicyScope
  decision: PolicyDecision
  constraints?: Record<string, unknown>
}

export interface WorkflowTemplateMemorySeed {
  scope: MemoryEntryScope
  agentId?: string
  title?: string
  content: string
  tags?: string[]
}

export interface WorkflowTemplateMemoryDefaults {
  seedEntries?: WorkflowTemplateMemorySeed[]
}

export interface WorkflowTemplateSchedule {
  enabled: boolean
  rrule?: string
  timezone?: string
}

export type WorkflowTemplateTriggerType = "timeline_event" | "connector_event" | "webhook"
export type WorkflowTemplateTriggerExecutionMode = "notify" | "auto_run"

export interface WorkflowTemplateTrigger {
  id: string
  type: WorkflowTemplateTriggerType
  enabled: boolean
  executionMode: WorkflowTemplateTriggerExecutionMode
  eventKey: string
  sourceKey?: string
  matchText?: string
}

export interface WorkflowTemplate {
  id: string
  workspaceId: string
  name: string
  description?: string
  starterPrompts: string[]
  agentIds: string[]
  requiredConnectorKeys: string[]
  expectedArtifacts: string[]
  defaultSpeakerType: "orchestrator" | "agent"
  defaultSpeakerAgentId?: string
  defaultModelId?: string
  policyDefaults: WorkflowTemplatePolicyDefault[]
  memoryDefaults: WorkflowTemplateMemoryDefaults
  schedule?: WorkflowTemplateSchedule
  triggers: WorkflowTemplateTrigger[]
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowTemplateListParams {
  workspaceId?: string
}

export interface WorkflowTemplateCreateParams {
  workspaceId?: string
  name: string
  description?: string
  starterPrompts?: string[]
  agentIds?: string[]
  requiredConnectorKeys?: string[]
  expectedArtifacts?: string[]
  defaultSpeakerType?: "orchestrator" | "agent"
  defaultSpeakerAgentId?: string
  defaultModelId?: string
  policyDefaults?: WorkflowTemplatePolicyDefault[]
  memoryDefaults?: WorkflowTemplateMemoryDefaults
  schedule?: WorkflowTemplateSchedule
  triggers?: WorkflowTemplateTrigger[]
  tags?: string[]
}

export interface WorkflowTemplateUpdateParams {
  templateId: string
  updates: Partial<Omit<WorkflowTemplate, "id" | "workspaceId" | "createdAt" | "updatedAt">>
}

export interface WorkflowTemplateDeleteParams {
  templateId: string
}

export interface WorkflowTemplateExportBundle {
  version: "1"
  exportedAt: string
  workspaceId: string
  templates: WorkflowTemplate[]
}

export interface WorkflowTemplateImportParams {
  bundle: WorkflowTemplateExportBundle
}

export interface WorkflowTemplateRunParams {
  templateId: string
  title?: string
}

export interface WorkflowTemplateRunResult {
  status: "started" | "blocked"
  templateId: string
  templateName: string
  thread?: Thread
  missingConnectors?: string[]
  appliedPolicies: number
  seededMemoryEntries: number
}

export interface WorkflowTemplateAutomationDraftParams {
  templateId: string
}

export interface WorkflowTemplateAutomationDraft {
  name: string
  prompt: string
  rrule: string
  timezone: string
  status: "ACTIVE" | "PAUSED"
  template: {
    id: string
    name: string
    workspaceId: string
  }
}

export interface WorkflowTemplateAutomationDirectiveParams {
  templateId: string
  threadId?: string
  cwd?: string
}

export interface WorkflowTemplateAutomationDirective {
  draft: WorkflowTemplateAutomationDraft
  directive: string
  cwd: string
  usedFallbackCwd: boolean
}

export type WorkflowTemplateScheduleRunStatus = "pending" | "started" | "blocked" | "error"

export interface WorkflowTemplateScheduleRun {
  id: string
  templateId: string
  workspaceId: string
  scheduledFor: Date
  status: WorkflowTemplateScheduleRunStatus
  runThreadId?: string
  missingConnectors: string[]
  errorMessage?: string
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowTemplateScheduleRunListParams {
  workspaceId?: string
  templateId?: string
  limit?: number
}

// Policy IPC
export type PolicyResourceType = "tool" | "connector" | "network" | "filesystem"
export type PolicyAction = "read" | "write" | "exec" | "post"
export type PolicyScope = "global" | "workspace" | "session"
export type PolicyDecision = "allow" | "ask" | "deny" | "allow_in_session"

export interface PolicyRule {
  id: string
  agentId: string
  resourceType: PolicyResourceType
  resourceKey: string
  action: PolicyAction
  scope: PolicyScope
  decision: PolicyDecision
  constraints: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface PolicyUpsertParams {
  policyId?: string
  agentId: string
  resourceType: PolicyResourceType
  resourceKey: string
  action: PolicyAction
  scope: PolicyScope
  decision: PolicyDecision
  constraints?: Record<string, unknown>
}

export interface PolicyDeleteParams {
  policyId: string
}

export interface PolicyResolveParams {
  agentId?: string
  resourceType: PolicyResourceType
  resourceKey: string
  action: PolicyAction
  scope?: PolicyScope
  securityDefaults?: SecurityDefaults
}

// Thread IPC
export interface ThreadUpdateParams {
  threadId: string
  updates: Partial<Thread>
}

// Workspace IPC
export interface WorkspaceSetParams {
  threadId?: string
  path: string | null
}

export interface WorkspaceLoadParams {
  threadId: string
}

export interface WorkspaceFileParams {
  threadId: string
  filePath: string
}

// Terminal IPC
export interface TerminalConnectParams {
  threadId: string
  workspacePath?: string
  cols?: number
  rows?: number
}

export interface TerminalInputParams {
  threadId: string
  data: string
}

export interface TerminalResizeParams {
  threadId: string
  cols: number
  rows: number
}

export interface TerminalKillParams {
  threadId: string
}

export interface TerminalRestartParams {
  threadId: string
  workspacePath?: string
  cols?: number
  rows?: number
}

export interface TerminalSessionState {
  threadId: string
  cwd: string
  shell: string
  pid: number
  alive: boolean
  cols: number
  rows: number
  startedAt: Date
  lastExitCode?: number
}

export interface TerminalStreamEvent {
  type: "state" | "data" | "exit" | "error"
  threadId: string
  state?: TerminalSessionState
  data?: string
  exitCode?: number
  signal?: number
  error?: string
}

// Model IPC
export interface SetApiKeyParams {
  provider: string
  apiKey: string
}

// Settings IPC
export interface SecurityDefaults {
  requireExecApproval: boolean
  requireNetworkApproval: boolean
  denySocialPosting: boolean
}

export interface SettingsUpdateSecurityDefaultsParams {
  updates: Partial<SecurityDefaults>
}

export interface SettingsStorageLocations {
  openworkDir: string
  dbPath: string
  checkpointDbPath: string
  threadCheckpointDir: string
  envFilePath: string
  zeroClawDir: string
  zeroClawRuntimeDir: string
  zeroClawDeploymentsDir: string
  zeroClawLogsDir: string
  promptsRootDir: string
  promptsGlobalDir: string
}

// =============================================================================

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_values?: Record<string, unknown>
  title?: string
}

// Run types
export type RunStatus = "pending" | "running" | "error" | "success" | "interrupted"

export interface Run {
  run_id: string
  thread_id: string
  assistant_id?: string
  created_at: Date
  updated_at: Date
  status: RunStatus
  metadata?: Record<string, unknown>
}

// Agent registry
export interface AgentDefinition {
  id: string
  workspaceId: string
  name: string
  role: string
  systemPrompt: string
  modelProvider: ProviderId
  modelName: string
  toolAllowlist: string[]
  connectorAllowlist: string[]
  memoryScope: "private" | "shared"
  skillMode: AgentSkillMode
  skillsAllowlist: string[]
  tags: string[]
  isOrchestrator: boolean
  createdAt: Date
  updatedAt: Date
}

// Provider configuration
export type ProviderId = "anthropic" | "openai" | "google" | "ollama"

export interface Provider {
  id: ProviderId
  name: string
  hasApiKey: boolean
}

// Model configuration
export interface ModelConfig {
  id: string
  name: string
  provider: ProviderId
  model: string
  description?: string
  available: boolean
}

// Subagent types (from deepagentsjs)
export interface Subagent {
  id: string
  name: string
  description: string
  status: "pending" | "running" | "completed" | "failed"
  startedAt?: Date
  completedAt?: Date
}

// Stream events from agent
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "interrupt"; request: HITLRequest }
  | { type: "token"; token: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "workspace"; files: FileInfo[]; path: string }
  | { type: "subagents"; subagents: Subagent[] }
  | { type: "done"; result: unknown }
  | { type: "error"; error: string }

export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | ContentBlock[]
  tool_calls?: ToolCall[]
  created_at: Date
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result"
  text?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  content?: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  tool_call_id: string
  content: string | unknown
  is_error?: boolean
}

// Human-in-the-loop
export interface HITLRequest {
  id: string
  tool_call: ToolCall
  allowed_decisions: HITLDecision["type"][]
}

export interface HITLDecision {
  type: "approve" | "reject" | "edit"
  tool_call_id: string
  edited_args?: Record<string, unknown>
  feedback?: string
}

// Todo types (from deepagentsjs)
export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

// File types (from deepagentsjs backends)
export interface FileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}
