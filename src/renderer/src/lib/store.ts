import { create } from "zustand"
import type { AgentDefinition, ModelConfig, Provider, Thread } from "@/types"

interface AppState {
  // Threads
  threads: Thread[]
  currentThreadId: string | null

  // Models and Providers (global, not per-thread)
  models: ModelConfig[]
  providers: Provider[]
  agents: AgentDefinition[]

  // Right panel state (UI state, not thread data)
  rightPanelTab: "todos" | "files" | "subagents"

  // Settings dialog state
  settingsOpen: boolean

  // Sidebar state
  sidebarCollapsed: boolean

  // Kanban view state
  showKanbanView: boolean
  showSubagentsInKanban: boolean
  showAgentsView: boolean
  showGraphView: boolean
  showMemoryView: boolean
  showConnectorsView: boolean
  showToolsView: boolean
  showZeroClawView: boolean
  zeroClawDeploymentFocusId: string | null
  showSettingsView: boolean
  showTemplatesView: boolean
  selectedTemplateId: string | null

  // Thread actions
  loadThreads: () => Promise<void>
  createThread: (metadata?: Record<string, unknown>) => Promise<Thread>
  selectThread: (threadId: string) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  updateThread: (threadId: string, updates: Partial<Thread>) => Promise<void>
  generateTitleForFirstMessage: (threadId: string, content: string) => Promise<void>

  // Agent registry actions
  loadAgents: () => Promise<void>
  createAgent: (agent: {
    workspaceId?: string
    name: string
    role: string
    systemPrompt: string
    modelProvider: "anthropic" | "openai" | "google" | "ollama"
    modelName: string
    toolAllowlist?: string[]
    connectorAllowlist?: string[]
    memoryScope?: "private" | "shared"
    skillMode?: "global_only" | "global_plus_selected" | "selected_only"
    skillsAllowlist?: string[]
    tags?: string[]
    isOrchestrator?: boolean
  }) => Promise<AgentDefinition>
  updateAgent: (
    agentId: string,
    updates: Partial<Omit<AgentDefinition, "id" | "workspaceId" | "createdAt" | "updatedAt">>
  ) => Promise<void>
  deleteAgent: (agentId: string) => Promise<void>

  // Model actions
  loadModels: () => Promise<void>
  loadProviders: () => Promise<void>
  setApiKey: (providerId: string, apiKey: string) => Promise<void>
  deleteApiKey: (providerId: string) => Promise<void>

  // Panel actions
  setRightPanelTab: (tab: "todos" | "files" | "subagents") => void

  // Settings actions
  setSettingsOpen: (open: boolean) => void

  // Sidebar actions
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void

  // Kanban actions
  setShowKanbanView: (show: boolean) => void
  setShowSubagentsInKanban: (show: boolean) => void
  setShowAgentsView: (show: boolean) => void
  setShowGraphView: (show: boolean) => void
  setShowMemoryView: (show: boolean) => void
  setShowConnectorsView: (show: boolean) => void
  setShowToolsView: (show: boolean) => void
  setShowZeroClawView: (show: boolean, deploymentId?: string | null) => void
  setZeroClawDeploymentFocusId: (deploymentId: string | null) => void
  setShowSettingsView: (show: boolean) => void
  setShowTemplatesView: (show: boolean, templateId?: string | null) => void
  setSelectedTemplateId: (templateId: string | null) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  threads: [],
  currentThreadId: null,
  models: [],
  providers: [],
  agents: [],
  rightPanelTab: "todos",
  settingsOpen: false,
  sidebarCollapsed: false,
  showKanbanView: true,
  showSubagentsInKanban: true,
  showAgentsView: false,
  showGraphView: false,
  showMemoryView: false,
  showConnectorsView: false,
  showToolsView: false,
  showZeroClawView: false,
  zeroClawDeploymentFocusId: null,
  showSettingsView: false,
  showTemplatesView: false,
  selectedTemplateId: null,

  // Thread actions
  loadThreads: async () => {
    const threads = await window.api.threads.list()
    set({ threads })

    // Select a default thread only when the user is not on the Home view.
    if (!get().showKanbanView && !get().currentThreadId && threads.length > 0) {
      await get().selectThread(threads[0].thread_id)
    }
  },

  createThread: async (metadata?: Record<string, unknown>) => {
    const thread = await window.api.threads.create(metadata)
    set((state) => ({
      threads: [thread, ...state.threads],
      currentThreadId: thread.thread_id,
      showKanbanView: false,
      showAgentsView: false,
      showGraphView: false,
      showMemoryView: false,
      showConnectorsView: false,
      showToolsView: false,
      showZeroClawView: false,
      showSettingsView: false,
      showTemplatesView: false,
      selectedTemplateId: null
    }))
    return thread
  },

  selectThread: async (threadId: string) => {
    // Just update currentThreadId - ThreadContext handles per-thread state
    // Also close kanban view when selecting a thread
    set({
      currentThreadId: threadId,
      showKanbanView: false,
      showAgentsView: false,
      showGraphView: false,
      showMemoryView: false,
      showConnectorsView: false,
      showToolsView: false,
      showZeroClawView: false,
      showSettingsView: false,
      showTemplatesView: false,
      selectedTemplateId: null
    })
  },

  deleteThread: async (threadId: string) => {
    console.log("[Store] Deleting thread:", threadId)
    try {
      await window.api.threads.delete(threadId)
      console.log("[Store] Thread deleted from backend")

      set((state) => {
        const threads = state.threads.filter((t) => t.thread_id !== threadId)
        const wasCurrentThread = state.currentThreadId === threadId
        const newCurrentId = wasCurrentThread
          ? threads[0]?.thread_id || null
          : state.currentThreadId

        return {
          threads,
          currentThreadId: newCurrentId
        }
      })
    } catch (error) {
      console.error("[Store] Failed to delete thread:", error)
    }
  },

  updateThread: async (threadId: string, updates: Partial<Thread>) => {
    const updated = await window.api.threads.update(threadId, updates)
    set((state) => ({
      threads: state.threads.map((t) => (t.thread_id === threadId ? updated : t))
    }))
  },

  generateTitleForFirstMessage: async (threadId: string, content: string) => {
    try {
      const generatedTitle = await window.api.threads.generateTitle(content)
      await get().updateThread(threadId, { title: generatedTitle })
    } catch (error) {
      console.error("[Store] Failed to generate title:", error)
    }
  },

  loadAgents: async () => {
    const agents = await window.api.agents.list()
    set({ agents })
  },

  createAgent: async (agent) => {
    const created = await window.api.agents.create(agent)
    set((state) => ({ agents: [created, ...state.agents] }))
    return created
  },

  updateAgent: async (agentId, updates) => {
    const updated = await window.api.agents.update(agentId, updates)
    set((state) => ({
      agents: state.agents.map((agent) => (agent.id === agentId ? updated : agent))
    }))
  },

  deleteAgent: async (agentId) => {
    await window.api.agents.delete(agentId)
    set((state) => ({ agents: state.agents.filter((agent) => agent.id !== agentId) }))
  },

  // Model actions
  loadModels: async () => {
    const models = await window.api.models.list()
    set({ models })
  },

  loadProviders: async () => {
    const providers = await window.api.models.listProviders()
    set({ providers })
  },

  setApiKey: async (providerId: string, apiKey: string) => {
    console.log("[Store] setApiKey called:", { providerId, keyLength: apiKey.length })
    try {
      await window.api.models.setApiKey(providerId, apiKey)
      console.log("[Store] API key saved via IPC")
      // Reload providers and models to update availability
      await get().loadProviders()
      await get().loadModels()
      console.log("[Store] Providers and models reloaded")
    } catch (e) {
      console.error("[Store] Failed to set API key:", e)
      throw e
    }
  },

  deleteApiKey: async (providerId: string) => {
    await window.api.models.deleteApiKey(providerId)
    // Reload providers and models to update availability
    await get().loadProviders()
    await get().loadModels()
  },

  // Panel actions
  setRightPanelTab: (tab: "todos" | "files" | "subagents") => {
    set({ rightPanelTab: tab })
  },

  // Settings actions
  setSettingsOpen: (open: boolean) => {
    set({ settingsOpen: open })
  },

  // Sidebar actions
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
  },

  // Kanban actions
  setShowKanbanView: (show: boolean) => {
    if (show) {
      set({
        showKanbanView: true,
        showAgentsView: false,
        showGraphView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showToolsView: false,
        showZeroClawView: false,
        showSettingsView: false,
        showTemplatesView: false,
        selectedTemplateId: null,
        currentThreadId: null
      })
    } else {
      set({ showKanbanView: false })
    }
  },

  setShowSubagentsInKanban: (show: boolean) => {
    set({ showSubagentsInKanban: show })
  },

  setShowAgentsView: (show: boolean) => {
    if (show) {
      set({
        showAgentsView: true,
        showKanbanView: false,
        showGraphView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showToolsView: false,
        showZeroClawView: false,
        showSettingsView: false,
        showTemplatesView: false,
        selectedTemplateId: null,
        currentThreadId: null
      })
    } else {
      set({ showAgentsView: false })
    }
  },

  setShowGraphView: (show: boolean) => {
    if (show) {
      set({
        showGraphView: true,
        showKanbanView: false,
        showAgentsView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showToolsView: false,
        showZeroClawView: false,
        showSettingsView: false,
        showTemplatesView: false,
        selectedTemplateId: null
      })
    } else {
      set({ showGraphView: false })
    }
  },

  setShowMemoryView: (show: boolean) => {
    if (show) {
      set({
        showMemoryView: true,
        showKanbanView: false,
        showAgentsView: false,
        showGraphView: false,
        showConnectorsView: false,
        showToolsView: false,
        showZeroClawView: false,
        showSettingsView: false,
        showTemplatesView: false,
        selectedTemplateId: null
      })
    } else {
      set({ showMemoryView: false })
    }
  },

  setShowConnectorsView: (show: boolean) => {
    if (show) {
      set({
        showConnectorsView: true,
        showKanbanView: false,
        showAgentsView: false,
        showGraphView: false,
        showMemoryView: false,
        showToolsView: false,
        showZeroClawView: false,
        showSettingsView: false,
        showTemplatesView: false,
        selectedTemplateId: null
      })
    } else {
      set({ showConnectorsView: false })
    }
  },

  setShowTemplatesView: (show: boolean, templateId?: string | null) => {
    if (show) {
      set({
        showTemplatesView: true,
        showKanbanView: false,
        showAgentsView: false,
        showGraphView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showToolsView: false,
        showZeroClawView: false,
        showSettingsView: false,
        selectedTemplateId:
          typeof templateId === "string" && templateId.trim().length > 0 ? templateId : null
      })
    } else {
      set({ showTemplatesView: false, selectedTemplateId: null })
    }
  },

  setShowToolsView: (show: boolean) => {
    if (show) {
      set({
        showToolsView: true,
        showKanbanView: false,
        showAgentsView: false,
        showGraphView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showTemplatesView: false,
        showZeroClawView: false,
        showSettingsView: false,
        selectedTemplateId: null
      })
    } else {
      set({ showToolsView: false })
    }
  },

  setShowZeroClawView: (show: boolean, deploymentId?: string | null) => {
    if (show) {
      set({
        showZeroClawView: true,
        showKanbanView: false,
        showAgentsView: false,
        showGraphView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showTemplatesView: false,
        showToolsView: false,
        showSettingsView: false,
        selectedTemplateId: null,
        zeroClawDeploymentFocusId:
          typeof deploymentId === "string" && deploymentId.trim().length > 0 ? deploymentId : null
      })
    } else {
      set({ showZeroClawView: false, zeroClawDeploymentFocusId: null })
    }
  },

  setZeroClawDeploymentFocusId: (deploymentId: string | null) => {
    set({
      zeroClawDeploymentFocusId:
        typeof deploymentId === "string" && deploymentId.trim().length > 0 ? deploymentId : null
    })
  },

  setShowSettingsView: (show: boolean) => {
    if (show) {
      set({
        showSettingsView: true,
        showKanbanView: false,
        showAgentsView: false,
        showGraphView: false,
        showMemoryView: false,
        showConnectorsView: false,
        showToolsView: false,
        showZeroClawView: false,
        showTemplatesView: false,
        selectedTemplateId: null
      })
    } else {
      set({ showSettingsView: false })
    }
  },

  setSelectedTemplateId: (templateId: string | null) => {
    set({
      selectedTemplateId: templateId && templateId.trim().length > 0 ? templateId : null
    })
  }
}))
