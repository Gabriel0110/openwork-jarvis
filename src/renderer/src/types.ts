// Re-export types from electron for use in renderer
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_values?: Record<string, unknown>
  title?: string
}

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

export type AgentSkillMode = "global_only" | "global_plus_selected" | "selected_only"
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

export interface SkillDetail {
  skill: SkillDefinition
  content: string
}

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

export interface SecurityDefaults {
  requireExecApproval: boolean
  requireNetworkApproval: boolean
  denySocialPosting: boolean
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

export interface GraphLayoutEntry {
  workspaceId: string
  agentId: string
  x: number
  y: number
  updatedAt: Date
}

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

export interface ConnectorImportResult {
  connectors: ConnectorDefinition[]
  mcpServers: McpServerDefinition[]
}

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

export interface WorkflowTemplateExportBundle {
  version: "1"
  exportedAt: string
  workspaceId: string
  templates: WorkflowTemplate[]
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

// Provider configuration
export type ProviderId = "anthropic" | "openai" | "google" | "ollama"

export interface Provider {
  id: ProviderId
  name: string
  hasApiKey: boolean
}

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
  // Used to correlate task tool calls with their responses
  toolCallId?: string
  // Type of subagent (e.g., 'general-purpose', 'correctness-checker', 'final-reviewer')
  subagentType?: string
}

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
  // For tool messages - links result to its tool call
  tool_call_id?: string
  // For tool messages - the name of the tool
  name?: string
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

export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

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
