import type {
  AgentCreateParams,
  AgentDefinition,
  AgentExportBundle,
  AgentUpdateParams,
  ConnectorExportBundle,
  ConnectorDefinition,
  ConnectorImportResult,
  GraphLayoutEntry,
  HITLDecision,
  McpServerDefinition,
  MemoryEntry,
  MemorySearchResult,
  ModelConfig,
  PolicyResolveParams,
  PolicyRule,
  PolicyUpsertParams,
  Provider,
  PromptAsset,
  PromptBinding,
  PromptBootstrapCheckResult,
  PromptConflict,
  PromptListResult,
  PromptMaterializationRecord,
  PromptPack,
  PromptRenderPreview,
  RagIndexResult,
  RagSource,
  SecurityDefaults,
  SkillDetail,
  SkillListResult,
  SettingsStorageLocations,
  StreamEvent,
  TerminalSessionState,
  TerminalStreamEvent,
  TimelineEvent,
  TimelineIngestTriggerParams,
  ToolDefinition,
  Thread,
  ZeroClawActionResult,
  ZeroClawCapabilityPolicy,
  ZeroClawDeploymentSpec,
  ZeroClawDeploymentState,
  ZeroClawDoctorReport,
  ZeroClawInstallActivity,
  ZeroClawInstallStatus,
  ZeroClawRuntimeHealth,
  ZeroClawRuntimeEvent,
  WorkflowTemplateAutomationDirective,
  WorkflowTemplateAutomationDraft,
  WorkflowTemplateScheduleRun,
  WorkflowTemplate,
  WorkflowTemplateExportBundle,
  WorkflowTemplateRunResult
} from "../main/types"

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    once: (channel: string, listener: (...args: unknown[]) => void) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
  process: {
    platform: NodeJS.Platform
    versions: NodeJS.ProcessVersions
  }
}

interface CustomAPI {
  agent: {
    invoke: (
      threadId: string,
      message: string,
      onEvent: (event: StreamEvent) => void,
      modelId?: string,
      speakerType?: "orchestrator" | "agent" | "zeroclaw",
      speakerAgentId?: string
    ) => () => void
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: (event: StreamEvent) => void,
      modelId?: string,
      speakerType?: "orchestrator" | "agent" | "zeroclaw",
      speakerAgentId?: string
    ) => () => void
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: StreamEvent) => void
    ) => () => void
    cancel: (threadId: string) => Promise<void>
  }
  threads: {
    list: () => Promise<Thread[]>
    get: (threadId: string) => Promise<Thread | null>
    create: (metadata?: Record<string, unknown>) => Promise<Thread>
    update: (threadId: string, updates: Partial<Thread>) => Promise<Thread>
    delete: (threadId: string) => Promise<void>
    getHistory: (threadId: string) => Promise<unknown[]>
    generateTitle: (message: string) => Promise<string>
  }
  agents: {
    list: (workspaceId?: string) => Promise<AgentDefinition[]>
    get: (agentId: string) => Promise<AgentDefinition | null>
    create: (params: AgentCreateParams) => Promise<AgentDefinition>
    update: (agentId: string, updates: AgentUpdateParams["updates"]) => Promise<AgentDefinition>
    delete: (agentId: string) => Promise<void>
    exportBundle: (workspaceId?: string) => Promise<AgentExportBundle>
    importBundle: (bundle: AgentExportBundle) => Promise<AgentDefinition[]>
  }
  policies: {
    list: (agentId: string) => Promise<PolicyRule[]>
    upsert: (params: PolicyUpsertParams) => Promise<PolicyRule>
    delete: (policyId: string) => Promise<void>
    resolveDecision: (params: PolicyResolveParams) => Promise<{
      decision: string
      source: string
      matchedPolicyId?: string
    }>
  }
  graph: {
    getLayout: (workspaceId: string) => Promise<GraphLayoutEntry[]>
    upsertLayout: (
      workspaceId: string,
      agentId: string,
      x: number,
      y: number
    ) => Promise<GraphLayoutEntry>
    clearLayout: (workspaceId: string) => Promise<void>
  }
  timeline: {
    list: (threadId: string, limit?: number) => Promise<TimelineEvent[]>
    listWorkspace: (workspaceId?: string, limit?: number) => Promise<TimelineEvent[]>
    ingestTriggerEvent: (params: TimelineIngestTriggerParams) => Promise<TimelineEvent>
  }
  memory: {
    listEntries: (params?: {
      workspaceId?: string
      scope?: "session" | "agent" | "workspace"
      agentId?: string
      threadId?: string
      limit?: number
    }) => Promise<MemoryEntry[]>
    createEntry: (params: {
      workspaceId?: string
      scope: "session" | "agent" | "workspace"
      agentId?: string
      threadId?: string
      title?: string
      content: string
      tags?: string[]
      source?: string
    }) => Promise<MemoryEntry>
    deleteEntry: (entryId: string) => Promise<void>
    setEntryLocked: (entryId: string, locked: boolean) => Promise<MemoryEntry>
    listSources: (workspaceId?: string) => Promise<RagSource[]>
    upsertSource: (params: {
      sourceId?: string
      workspaceId?: string
      path: string
      enabled?: boolean
      includeGlobs?: string[]
      excludeGlobs?: string[]
    }) => Promise<RagSource>
    deleteSource: (sourceId: string) => Promise<void>
    indexSources: (params: {
      threadId: string
      workspaceId?: string
      sourceIds?: string[]
      maxFiles?: number
      maxFileSizeBytes?: number
    }) => Promise<RagIndexResult>
    search: (query: string, workspaceId?: string, limit?: number) => Promise<MemorySearchResult[]>
  }
  skills: {
    list: () => Promise<SkillListResult>
    getDetail: (skillId: string) => Promise<SkillDetail>
  }
  tools: {
    list: (params?: {
      workspaceId?: string
      includeDisabled?: boolean
    }) => Promise<ToolDefinition[]>
    get: (toolId: string) => Promise<ToolDefinition>
    create: (params: {
      workspaceId?: string
      name: string
      displayName: string
      description: string
      category?:
        | "filesystem"
        | "execution"
        | "network"
        | "connector"
        | "memory"
        | "skills"
        | "custom"
      action: "read" | "write" | "exec" | "post"
      riskTier: 0 | 1 | 2 | 3
      implementationType?: "builtin" | "script"
      config?: Record<string, unknown>
      enabled?: boolean
    }) => Promise<ToolDefinition>
    update: (
      toolId: string,
      updates: Partial<
        Omit<ToolDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt" | "source">
      >
    ) => Promise<ToolDefinition>
    delete: (toolId: string) => Promise<void>
  }
  prompts: {
    list: (params?: {
      workspaceId?: string
      query?: string
      scope?: "global" | "workspace" | "all"
      source?: "managed" | "discovered_agents" | "discovered_openwork" | "all"
      agentsOnly?: boolean
    }) => Promise<PromptListResult>
    get: (assetId: string) => Promise<{ asset: PromptAsset; content: string }>
    create: (params: {
      workspaceId?: string
      title: string
      description?: string
      slug?: string
      fileName: string
      scope?: "global" | "workspace"
      tags?: string[]
      variables?: string[]
      content: string
    }) => Promise<PromptAsset>
    update: (
      assetId: string,
      updates: {
        title?: string
        description?: string
        slug?: string
        fileName?: string
        tags?: string[]
        variables?: string[]
        content?: string
      }
    ) => Promise<PromptAsset>
    delete: (assetId: string) => Promise<void>
    refreshDiscovery: () => Promise<PromptListResult>
    renderPreview: (params: {
      assetId?: string
      content?: string
      workspaceId?: string
      workspaceRoot?: string
      agentId?: string
      agentName?: string
      agentRole?: string
      variables?: Record<string, string>
    }) => Promise<PromptRenderPreview>
    bindings: {
      list: (workspaceId?: string) => Promise<PromptBinding[]>
      create: (params: {
        assetId: string
        workspaceId?: string
        targetType: "workspace" | "agent"
        targetAgentId?: string
        materializeMode: "workspace_root" | "agent_docs"
        relativeOutputPath?: string
        enabled?: boolean
      }) => Promise<PromptBinding>
      update: (
        bindingId: string,
        updates: {
          targetType?: "workspace" | "agent"
          targetAgentId?: string
          materializeMode?: "workspace_root" | "agent_docs"
          relativeOutputPath?: string
          enabled?: boolean
        }
      ) => Promise<PromptBinding>
      delete: (bindingId: string) => Promise<void>
    }
    materialize: (params: {
      bindingId: string
      workspaceRoot?: string
      overwriteConflict?: boolean
      variables?: Record<string, string>
    }) => Promise<{
      status: "applied" | "conflict" | "failed" | "skipped"
      bindingId: string
      record: PromptMaterializationRecord
      conflict?: PromptConflict
    }>
    materializeAll: (params?: {
      workspaceId?: string
      workspaceRoot?: string
      overwriteConflict?: boolean
      variables?: Record<string, string>
    }) => Promise<
      Array<{
        status: "applied" | "conflict" | "failed" | "skipped"
        bindingId: string
        record: PromptMaterializationRecord
        conflict?: PromptConflict
      }>
    >
    history: {
      list: (params?: {
        workspaceId?: string
        bindingId?: string
        limit?: number
      }) => Promise<PromptMaterializationRecord[]>
    }
    exportPack: (params?: {
      workspaceId?: string
      includeBindings?: boolean
      format?: "json" | "yaml"
    }) => Promise<{ pack: PromptPack; format: "json" | "yaml"; content: string }>
    importPack: (params: {
      content: string
      format?: "json" | "yaml"
      workspaceId?: string
      replaceExisting?: boolean
    }) => Promise<{ importedAssets: PromptAsset[]; importedBindings: PromptBinding[] }>
    checkBootstrap: (params?: {
      workspaceId?: string
      workspaceRoot?: string
    }) => Promise<PromptBootstrapCheckResult>
  }
  connectors: {
    list: (workspaceId?: string) => Promise<ConnectorDefinition[]>
    create: (params: {
      workspaceId?: string
      key: string
      name: string
      category: "messaging" | "dev" | "social" | "email" | "webhook" | "custom"
      config?: Record<string, unknown>
      enabled?: boolean
      status?: "disconnected" | "connected" | "error"
    }) => Promise<ConnectorDefinition>
    update: (
      connectorId: string,
      updates: Partial<Omit<ConnectorDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
    ) => Promise<ConnectorDefinition>
    delete: (connectorId: string) => Promise<void>
    exportBundle: (workspaceId?: string, includeSecrets?: boolean) => Promise<ConnectorExportBundle>
    importBundle: (
      bundle: ConnectorExportBundle,
      workspaceId?: string
    ) => Promise<ConnectorImportResult>
  }
  mcp: {
    list: (workspaceId?: string) => Promise<McpServerDefinition[]>
    create: (params: {
      workspaceId?: string
      name: string
      command: string
      args?: string[]
      env?: Record<string, string>
      enabled?: boolean
      status?: "stopped" | "running" | "error"
      lastError?: string
    }) => Promise<McpServerDefinition>
    update: (
      serverId: string,
      updates: Partial<Omit<McpServerDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
    ) => Promise<McpServerDefinition>
    delete: (serverId: string) => Promise<void>
  }
  templates: {
    list: (workspaceId?: string) => Promise<WorkflowTemplate[]>
    listScheduleRuns: (params?: {
      workspaceId?: string
      templateId?: string
      limit?: number
    }) => Promise<WorkflowTemplateScheduleRun[]>
    get: (templateId: string) => Promise<WorkflowTemplate | null>
    create: (params: {
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
      policyDefaults?: Array<{
        agentId?: string
        resourceType: "tool" | "connector" | "network" | "filesystem"
        resourceKey: string
        action: "read" | "write" | "exec" | "post"
        scope: "global" | "workspace" | "session"
        decision: "allow" | "ask" | "deny" | "allow_in_session"
        constraints?: Record<string, unknown>
      }>
      memoryDefaults?: {
        seedEntries?: Array<{
          scope: "session" | "agent" | "workspace"
          agentId?: string
          title?: string
          content: string
          tags?: string[]
        }>
      }
      schedule?: {
        enabled: boolean
        rrule?: string
        timezone?: string
      }
      triggers?: Array<{
        id?: string
        type: "timeline_event" | "connector_event" | "webhook"
        enabled: boolean
        executionMode?: "notify" | "auto_run"
        eventKey: string
        sourceKey?: string
        matchText?: string
      }>
      tags?: string[]
    }) => Promise<WorkflowTemplate>
    update: (
      templateId: string,
      updates: Partial<Omit<WorkflowTemplate, "id" | "workspaceId" | "createdAt" | "updatedAt">>
    ) => Promise<WorkflowTemplate>
    delete: (templateId: string) => Promise<void>
    exportBundle: (workspaceId?: string) => Promise<WorkflowTemplateExportBundle>
    importBundle: (bundle: WorkflowTemplateExportBundle) => Promise<WorkflowTemplate[]>
    run: (templateId: string, title?: string) => Promise<WorkflowTemplateRunResult>
    buildAutomationDraft: (templateId: string) => Promise<WorkflowTemplateAutomationDraft>
    buildAutomationDirective: (
      templateId: string,
      options?: { threadId?: string; cwd?: string }
    ) => Promise<WorkflowTemplateAutomationDirective>
  }
  models: {
    list: () => Promise<ModelConfig[]>
    listProviders: () => Promise<Provider[]>
    getDefault: () => Promise<string>
    deleteApiKey: (provider: string) => Promise<void>
    setDefault: (modelId: string) => Promise<void>
    setApiKey: (provider: string, apiKey: string) => Promise<void>
    getApiKey: (provider: string) => Promise<string | null>
  }
  settings: {
    getSecurityDefaults: () => Promise<SecurityDefaults>
    updateSecurityDefaults: (updates: Partial<SecurityDefaults>) => Promise<SecurityDefaults>
    getStorageLocations: () => Promise<SettingsStorageLocations>
  }
  zeroclaw: {
    install: {
      getStatus: () => Promise<ZeroClawInstallStatus>
      getActivity: () => Promise<ZeroClawInstallActivity>
      installVersion: (version?: string) => Promise<ZeroClawInstallStatus>
      verify: () => Promise<ZeroClawActionResult>
      upgrade: (version: string) => Promise<ZeroClawInstallStatus>
    }
    deployment: {
      list: (workspaceId?: string) => Promise<ZeroClawDeploymentState[]>
      get: (deploymentId: string) => Promise<ZeroClawDeploymentState>
      create: (spec: ZeroClawDeploymentSpec) => Promise<ZeroClawDeploymentState>
      update: (
        deploymentId: string,
        updates: Partial<
          Omit<ZeroClawDeploymentSpec, "workspaceId" | "policy"> & {
            desiredState: ZeroClawDeploymentState["desiredState"]
            policy: Partial<ZeroClawCapabilityPolicy>
          }
        >
      ) => Promise<ZeroClawDeploymentState>
      delete: (deploymentId: string) => Promise<void>
    }
    runtime: {
      start: (deploymentId: string) => Promise<ZeroClawDeploymentState>
      stop: (deploymentId: string) => Promise<ZeroClawDeploymentState>
      restart: (deploymentId: string) => Promise<ZeroClawDeploymentState>
      getHealth: (deploymentId: string) => Promise<ZeroClawRuntimeHealth>
    }
    logs: {
      get: (
        deploymentId: string,
        cursor?: string,
        limit?: number
      ) => Promise<{ events: ZeroClawRuntimeEvent[]; nextCursor?: string }>
    }
    policy: {
      get: (deploymentId: string) => Promise<ZeroClawCapabilityPolicy>
      set: (
        deploymentId: string,
        policy: ZeroClawCapabilityPolicy
      ) => Promise<ZeroClawDeploymentState>
    }
    doctor: {
      run: (deploymentId?: string) => Promise<ZeroClawDoctorReport>
    }
  }
  terminal: {
    connect: (
      threadId: string,
      workspacePath?: string,
      cols?: number,
      rows?: number
    ) => Promise<TerminalSessionState>
    getState: (threadId: string) => Promise<TerminalSessionState | null>
    input: (threadId: string, data: string) => Promise<void>
    resize: (threadId: string, cols: number, rows: number) => Promise<TerminalSessionState>
    kill: (threadId: string) => Promise<TerminalSessionState | null>
    restart: (
      threadId: string,
      workspacePath?: string,
      cols?: number,
      rows?: number
    ) => Promise<TerminalSessionState>
    dispose: (threadId: string) => Promise<void>
    onEvent: (threadId: string, callback: (event: TerminalStreamEvent) => void) => () => void
  }
  workspace: {
    get: (threadId?: string) => Promise<string | null>
    set: (threadId: string | undefined, path: string | null) => Promise<string | null>
    select: (threadId?: string) => Promise<string | null>
    loadFromDisk: (threadId: string) => Promise<{
      success: boolean
      files: Array<{
        path: string
        is_dir: boolean
        size?: number
        modified_at?: string
      }>
      workspacePath?: string
      error?: string
    }>
    readFile: (
      threadId: string,
      filePath: string
    ) => Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }>
    readBinaryFile: (
      threadId: string,
      filePath: string
    ) => Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }>
    onFilesChanged: (
      callback: (data: { threadId: string; workspacePath: string }) => void
    ) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
