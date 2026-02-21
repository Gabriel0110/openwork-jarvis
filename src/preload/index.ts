import { contextBridge, ipcRenderer } from "electron"
import type {
  AgentCreateParams,
  AgentExportBundle,
  AgentDefinition,
  AgentImportParams,
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
  RagIndexResult,
  RagSource,
  SecurityDefaults,
  SkillDetail,
  SkillListResult,
  SettingsStorageLocations,
  StreamEvent,
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
  WorkflowTemplate,
  WorkflowTemplateScheduleRun,
  WorkflowTemplateExportBundle,
  WorkflowTemplateRunResult
} from "../main/types"

// Simple electron API - replaces @electron-toolkit/preload
const electronAPI = {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => listener(...args))
      return () => ipcRenderer.removeListener(channel, listener)
    },
    once: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.once(channel, (_event, ...args) => listener(...args))
    },
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  },
  process: {
    platform: process.platform,
    versions: process.versions
  }
}

// Custom APIs for renderer
const api = {
  agent: {
    // Send message and receive events via callback
    invoke: (
      threadId: string,
      message: string,
      onEvent: (event: StreamEvent) => void,
      modelId?: string,
      speakerType?: "orchestrator" | "agent" | "zeroclaw",
      speakerAgentId?: string
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: StreamEvent): void => {
        onEvent(data)
        if (data.type === "done" || data.type === "error") {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)
      ipcRenderer.send("agent:invoke", {
        threadId,
        message,
        modelId,
        speakerType,
        speakerAgentId
      })

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    // Stream agent events for useStream transport
    streamAgent: (
      threadId: string,
      message: string,
      command: unknown,
      onEvent: (event: StreamEvent) => void,
      modelId?: string,
      speakerType?: "orchestrator" | "agent" | "zeroclaw",
      speakerAgentId?: string
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: StreamEvent): void => {
        onEvent(data)
        if (data.type === "done" || data.type === "error") {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)

      // If we have a command, it might be a resume/retry
      if (command) {
        ipcRenderer.send("agent:resume", {
          threadId,
          command,
          modelId,
          speakerType,
          speakerAgentId
        })
      } else {
        ipcRenderer.send("agent:invoke", {
          threadId,
          message,
          modelId,
          speakerType,
          speakerAgentId
        })
      }

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: StreamEvent) => void
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: StreamEvent): void => {
        onEvent?.(data)
        if (data.type === "done" || data.type === "error") {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)
      ipcRenderer.send("agent:interrupt", { threadId, decision })

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    cancel: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke("agent:cancel", { threadId })
    }
  },
  threads: {
    list: (): Promise<Thread[]> => {
      return ipcRenderer.invoke("threads:list")
    },
    get: (threadId: string): Promise<Thread | null> => {
      return ipcRenderer.invoke("threads:get", threadId)
    },
    create: (metadata?: Record<string, unknown>): Promise<Thread> => {
      return ipcRenderer.invoke("threads:create", metadata)
    },
    update: (threadId: string, updates: Partial<Thread>): Promise<Thread> => {
      return ipcRenderer.invoke("threads:update", { threadId, updates })
    },
    delete: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke("threads:delete", threadId)
    },
    getHistory: (threadId: string): Promise<unknown[]> => {
      return ipcRenderer.invoke("threads:history", threadId)
    },
    generateTitle: (message: string): Promise<string> => {
      return ipcRenderer.invoke("threads:generateTitle", message)
    }
  },
  agents: {
    list: (workspaceId?: string): Promise<AgentDefinition[]> => {
      return ipcRenderer.invoke("agents:list", workspaceId ? { workspaceId } : undefined)
    },
    get: (agentId: string): Promise<AgentDefinition | null> => {
      return ipcRenderer.invoke("agents:get", agentId)
    },
    create: (params: AgentCreateParams): Promise<AgentDefinition> => {
      return ipcRenderer.invoke("agents:create", params)
    },
    update: (agentId: string, updates: AgentUpdateParams["updates"]): Promise<AgentDefinition> => {
      return ipcRenderer.invoke("agents:update", { agentId, updates })
    },
    delete: (agentId: string): Promise<void> => {
      return ipcRenderer.invoke("agents:delete", agentId)
    },
    exportBundle: (workspaceId?: string): Promise<AgentExportBundle> => {
      return ipcRenderer.invoke("agents:exportBundle", workspaceId ? { workspaceId } : undefined)
    },
    importBundle: (bundle: AgentImportParams["bundle"]): Promise<AgentDefinition[]> => {
      return ipcRenderer.invoke("agents:importBundle", { bundle })
    }
  },
  policies: {
    list: (agentId: string): Promise<PolicyRule[]> => {
      return ipcRenderer.invoke("policies:list", agentId)
    },
    upsert: (params: PolicyUpsertParams): Promise<PolicyRule> => {
      return ipcRenderer.invoke("policies:upsert", params)
    },
    delete: (policyId: string): Promise<void> => {
      return ipcRenderer.invoke("policies:delete", { policyId })
    },
    resolveDecision: (
      params: PolicyResolveParams
    ): Promise<{ decision: string; source: string; matchedPolicyId?: string }> => {
      return ipcRenderer.invoke("policies:resolveDecision", params)
    }
  },
  graph: {
    getLayout: (workspaceId: string): Promise<GraphLayoutEntry[]> => {
      return ipcRenderer.invoke("graph:getLayout", { workspaceId })
    },
    upsertLayout: (
      workspaceId: string,
      agentId: string,
      x: number,
      y: number
    ): Promise<GraphLayoutEntry> => {
      return ipcRenderer.invoke("graph:upsertLayout", { workspaceId, agentId, x, y })
    },
    clearLayout: (workspaceId: string): Promise<void> => {
      return ipcRenderer.invoke("graph:clearLayout", { workspaceId })
    }
  },
  timeline: {
    list: (threadId: string, limit?: number): Promise<TimelineEvent[]> => {
      return ipcRenderer.invoke("timeline:list", { threadId, limit })
    },
    listWorkspace: (workspaceId?: string, limit?: number): Promise<TimelineEvent[]> => {
      return ipcRenderer.invoke("timeline:listWorkspace", { workspaceId, limit })
    },
    ingestTriggerEvent: (params: TimelineIngestTriggerParams): Promise<TimelineEvent> => {
      return ipcRenderer.invoke("timeline:ingestTriggerEvent", params)
    }
  },
  memory: {
    listEntries: (params?: {
      workspaceId?: string
      scope?: "session" | "agent" | "workspace"
      agentId?: string
      threadId?: string
      limit?: number
    }): Promise<MemoryEntry[]> => {
      return ipcRenderer.invoke("memory:listEntries", params)
    },
    createEntry: (params: {
      workspaceId?: string
      scope: "session" | "agent" | "workspace"
      agentId?: string
      threadId?: string
      title?: string
      content: string
      tags?: string[]
      source?: string
    }): Promise<MemoryEntry> => {
      return ipcRenderer.invoke("memory:createEntry", params)
    },
    deleteEntry: (entryId: string): Promise<void> => {
      return ipcRenderer.invoke("memory:deleteEntry", { entryId })
    },
    setEntryLocked: (entryId: string, locked: boolean): Promise<MemoryEntry> => {
      return ipcRenderer.invoke("memory:setEntryLocked", { entryId, locked })
    },
    listSources: (workspaceId?: string): Promise<RagSource[]> => {
      return ipcRenderer.invoke("memory:listSources", workspaceId ? { workspaceId } : undefined)
    },
    upsertSource: (params: {
      sourceId?: string
      workspaceId?: string
      path: string
      enabled?: boolean
      includeGlobs?: string[]
      excludeGlobs?: string[]
    }): Promise<RagSource> => {
      return ipcRenderer.invoke("memory:upsertSource", params)
    },
    deleteSource: (sourceId: string): Promise<void> => {
      return ipcRenderer.invoke("memory:deleteSource", { sourceId })
    },
    indexSources: (params: {
      threadId: string
      workspaceId?: string
      sourceIds?: string[]
      maxFiles?: number
      maxFileSizeBytes?: number
    }): Promise<RagIndexResult> => {
      return ipcRenderer.invoke("memory:indexSources", params)
    },
    search: (
      query: string,
      workspaceId?: string,
      limit?: number
    ): Promise<MemorySearchResult[]> => {
      return ipcRenderer.invoke("memory:search", { query, workspaceId, limit })
    }
  },
  skills: {
    list: (): Promise<SkillListResult> => {
      return ipcRenderer.invoke("skills:list")
    },
    getDetail: (skillId: string): Promise<SkillDetail> => {
      return ipcRenderer.invoke("skills:getDetail", { skillId })
    }
  },
  tools: {
    list: (params?: {
      workspaceId?: string
      includeDisabled?: boolean
    }): Promise<ToolDefinition[]> => {
      return ipcRenderer.invoke("tools:list", params)
    },
    get: (toolId: string): Promise<ToolDefinition> => {
      return ipcRenderer.invoke("tools:get", { toolId })
    },
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
    }): Promise<ToolDefinition> => {
      return ipcRenderer.invoke("tools:create", params)
    },
    update: (
      toolId: string,
      updates: Partial<
        Omit<ToolDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt" | "source">
      >
    ): Promise<ToolDefinition> => {
      return ipcRenderer.invoke("tools:update", { toolId, updates })
    },
    delete: (toolId: string): Promise<void> => {
      return ipcRenderer.invoke("tools:delete", { toolId })
    }
  },
  connectors: {
    list: (workspaceId?: string): Promise<ConnectorDefinition[]> => {
      return ipcRenderer.invoke("connectors:list", workspaceId ? { workspaceId } : undefined)
    },
    create: (params: {
      workspaceId?: string
      key: string
      name: string
      category: "messaging" | "dev" | "social" | "email" | "webhook" | "custom"
      config?: Record<string, unknown>
      enabled?: boolean
      status?: "disconnected" | "connected" | "error"
    }): Promise<ConnectorDefinition> => {
      return ipcRenderer.invoke("connectors:create", params)
    },
    update: (
      connectorId: string,
      updates: Partial<Omit<ConnectorDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
    ): Promise<ConnectorDefinition> => {
      return ipcRenderer.invoke("connectors:update", { connectorId, updates })
    },
    delete: (connectorId: string): Promise<void> => {
      return ipcRenderer.invoke("connectors:delete", { connectorId })
    },
    exportBundle: (
      workspaceId?: string,
      includeSecrets = false
    ): Promise<ConnectorExportBundle> => {
      return ipcRenderer.invoke("connectors:exportBundle", { workspaceId, includeSecrets })
    },
    importBundle: (
      bundle: ConnectorExportBundle,
      workspaceId?: string
    ): Promise<ConnectorImportResult> => {
      return ipcRenderer.invoke("connectors:importBundle", { bundle, workspaceId })
    }
  },
  mcp: {
    list: (workspaceId?: string): Promise<McpServerDefinition[]> => {
      return ipcRenderer.invoke("mcp:list", workspaceId ? { workspaceId } : undefined)
    },
    create: (params: {
      workspaceId?: string
      name: string
      command: string
      args?: string[]
      env?: Record<string, string>
      enabled?: boolean
      status?: "stopped" | "running" | "error"
      lastError?: string
    }): Promise<McpServerDefinition> => {
      return ipcRenderer.invoke("mcp:create", params)
    },
    update: (
      serverId: string,
      updates: Partial<Omit<McpServerDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
    ): Promise<McpServerDefinition> => {
      return ipcRenderer.invoke("mcp:update", { serverId, updates })
    },
    delete: (serverId: string): Promise<void> => {
      return ipcRenderer.invoke("mcp:delete", { serverId })
    }
  },
  templates: {
    list: (workspaceId?: string): Promise<WorkflowTemplate[]> => {
      return ipcRenderer.invoke("templates:list", workspaceId ? { workspaceId } : undefined)
    },
    listScheduleRuns: (params?: {
      workspaceId?: string
      templateId?: string
      limit?: number
    }): Promise<WorkflowTemplateScheduleRun[]> => {
      return ipcRenderer.invoke("templates:listScheduleRuns", params)
    },
    get: (templateId: string): Promise<WorkflowTemplate | null> => {
      return ipcRenderer.invoke("templates:get", templateId)
    },
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
    }): Promise<WorkflowTemplate> => {
      return ipcRenderer.invoke("templates:create", params)
    },
    update: (
      templateId: string,
      updates: Partial<Omit<WorkflowTemplate, "id" | "workspaceId" | "createdAt" | "updatedAt">>
    ): Promise<WorkflowTemplate> => {
      return ipcRenderer.invoke("templates:update", { templateId, updates })
    },
    delete: (templateId: string): Promise<void> => {
      return ipcRenderer.invoke("templates:delete", { templateId })
    },
    exportBundle: (workspaceId?: string): Promise<WorkflowTemplateExportBundle> => {
      return ipcRenderer.invoke("templates:exportBundle", workspaceId ? { workspaceId } : undefined)
    },
    importBundle: (bundle: WorkflowTemplateExportBundle): Promise<WorkflowTemplate[]> => {
      return ipcRenderer.invoke("templates:importBundle", { bundle })
    },
    run: (templateId: string, title?: string): Promise<WorkflowTemplateRunResult> => {
      return ipcRenderer.invoke("templates:run", { templateId, title })
    },
    buildAutomationDraft: (templateId: string): Promise<WorkflowTemplateAutomationDraft> => {
      return ipcRenderer.invoke("templates:buildAutomationDraft", { templateId })
    },
    buildAutomationDirective: (
      templateId: string,
      options?: { threadId?: string; cwd?: string }
    ): Promise<WorkflowTemplateAutomationDirective> => {
      return ipcRenderer.invoke("templates:buildAutomationDirective", {
        templateId,
        threadId: options?.threadId,
        cwd: options?.cwd
      })
    }
  },
  models: {
    list: (): Promise<ModelConfig[]> => {
      return ipcRenderer.invoke("models:list")
    },
    listProviders: (): Promise<Provider[]> => {
      return ipcRenderer.invoke("models:listProviders")
    },
    getDefault: (): Promise<string> => {
      return ipcRenderer.invoke("models:getDefault")
    },
    setDefault: (modelId: string): Promise<void> => {
      return ipcRenderer.invoke("models:setDefault", modelId)
    },
    setApiKey: (provider: string, apiKey: string): Promise<void> => {
      return ipcRenderer.invoke("models:setApiKey", { provider, apiKey })
    },
    getApiKey: (provider: string): Promise<string | null> => {
      return ipcRenderer.invoke("models:getApiKey", provider)
    },
    deleteApiKey: (provider: string): Promise<void> => {
      return ipcRenderer.invoke("models:deleteApiKey", provider)
    }
  },
  settings: {
    getSecurityDefaults: (): Promise<SecurityDefaults> => {
      return ipcRenderer.invoke("settings:getSecurityDefaults")
    },
    updateSecurityDefaults: (updates: Partial<SecurityDefaults>): Promise<SecurityDefaults> => {
      return ipcRenderer.invoke("settings:updateSecurityDefaults", { updates })
    },
    getStorageLocations: (): Promise<SettingsStorageLocations> => {
      return ipcRenderer.invoke("settings:getStorageLocations")
    }
  },
  zeroclaw: {
    install: {
      getStatus: (): Promise<ZeroClawInstallStatus> => {
        return ipcRenderer.invoke("zeroclaw:install:getStatus")
      },
      getActivity: (): Promise<ZeroClawInstallActivity> => {
        return ipcRenderer.invoke("zeroclaw:install:getActivity")
      },
      installVersion: (version?: string): Promise<ZeroClawInstallStatus> => {
        return ipcRenderer.invoke("zeroclaw:install:installVersion", { version })
      },
      verify: (): Promise<ZeroClawActionResult> => {
        return ipcRenderer.invoke("zeroclaw:install:verify")
      },
      upgrade: (version: string): Promise<ZeroClawInstallStatus> => {
        return ipcRenderer.invoke("zeroclaw:install:upgrade", { version })
      }
    },
    deployment: {
      list: (workspaceId?: string): Promise<ZeroClawDeploymentState[]> => {
        return ipcRenderer.invoke(
          "zeroclaw:deployment:list",
          workspaceId ? { workspaceId } : undefined
        )
      },
      get: (deploymentId: string): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:deployment:get", { deploymentId })
      },
      create: (spec: ZeroClawDeploymentSpec): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:deployment:create", { spec })
      },
      update: (
        deploymentId: string,
        updates: Partial<
          Omit<ZeroClawDeploymentSpec, "workspaceId" | "policy"> & {
            desiredState: ZeroClawDeploymentState["desiredState"]
            policy: Partial<ZeroClawCapabilityPolicy>
          }
        >
      ): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:deployment:update", {
          deploymentId,
          updates
        })
      },
      delete: (deploymentId: string): Promise<void> => {
        return ipcRenderer.invoke("zeroclaw:deployment:delete", { deploymentId })
      }
    },
    runtime: {
      start: (deploymentId: string): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:runtime:start", { deploymentId })
      },
      stop: (deploymentId: string): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:runtime:stop", { deploymentId })
      },
      restart: (deploymentId: string): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:runtime:restart", { deploymentId })
      },
      getHealth: (deploymentId: string): Promise<ZeroClawRuntimeHealth> => {
        return ipcRenderer.invoke("zeroclaw:runtime:getHealth", { deploymentId })
      }
    },
    logs: {
      get: (
        deploymentId: string,
        cursor?: string,
        limit?: number
      ): Promise<{ events: ZeroClawRuntimeEvent[]; nextCursor?: string }> => {
        return ipcRenderer.invoke("zeroclaw:logs:get", { deploymentId, cursor, limit })
      }
    },
    policy: {
      get: (deploymentId: string): Promise<ZeroClawCapabilityPolicy> => {
        return ipcRenderer.invoke("zeroclaw:policy:get", { deploymentId })
      },
      set: (
        deploymentId: string,
        policy: ZeroClawCapabilityPolicy
      ): Promise<ZeroClawDeploymentState> => {
        return ipcRenderer.invoke("zeroclaw:policy:set", { deploymentId, policy })
      }
    },
    doctor: {
      run: (deploymentId?: string): Promise<ZeroClawDoctorReport> => {
        return ipcRenderer.invoke("zeroclaw:doctor:run", { deploymentId })
      }
    }
  },
  workspace: {
    get: (threadId?: string): Promise<string | null> => {
      return ipcRenderer.invoke("workspace:get", threadId)
    },
    set: (threadId: string | undefined, path: string | null): Promise<string | null> => {
      return ipcRenderer.invoke("workspace:set", { threadId, path })
    },
    select: (threadId?: string): Promise<string | null> => {
      return ipcRenderer.invoke("workspace:select", threadId)
    },
    loadFromDisk: (
      threadId: string
    ): Promise<{
      success: boolean
      files: Array<{
        path: string
        is_dir: boolean
        size?: number
        modified_at?: string
      }>
      workspacePath?: string
      error?: string
    }> => {
      return ipcRenderer.invoke("workspace:loadFromDisk", { threadId })
    },
    readFile: (
      threadId: string,
      filePath: string
    ): Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }> => {
      return ipcRenderer.invoke("workspace:readFile", { threadId, filePath })
    },
    readBinaryFile: (
      threadId: string,
      filePath: string
    ): Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }> => {
      return ipcRenderer.invoke("workspace:readBinaryFile", { threadId, filePath })
    },
    // Listen for file changes in the workspace
    onFilesChanged: (
      callback: (data: { threadId: string; workspacePath: string }) => void
    ): (() => void) => {
      const handler = (_: unknown, data: { threadId: string; workspacePath: string }): void => {
        callback(data)
      }
      ipcRenderer.on("workspace:files-changed", handler)
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener("workspace:files-changed", handler)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld("api", api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
