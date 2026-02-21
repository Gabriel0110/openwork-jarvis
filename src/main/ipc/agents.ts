import type { IpcMain } from "electron"
import { createAgent, deleteAgent, getAgent, listAgents, updateAgent } from "../db/agents"
import type { AgentRow } from "../db/agents"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import { getDefaultModel } from "./models"
import { listPoliciesByAgent, upsertPolicy } from "../db/policies"
import { normalizeAgentSkillMode } from "../services/skills-registry"
import type {
  AgentCreateParams,
  AgentExportBundle,
  AgentDefinition,
  AgentImportParams,
  AgentListParams,
  AgentUpdateParams,
  ProviderId
} from "../types"

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string")
    }
  } catch {
    // Ignore malformed data and return a safe default.
  }
  return []
}

function inferProvider(modelName: string): ProviderId {
  if (modelName.startsWith("claude")) return "anthropic"
  if (
    modelName.startsWith("gpt") ||
    modelName.startsWith("o1") ||
    modelName.startsWith("o3") ||
    modelName.startsWith("o4")
  ) {
    return "openai"
  }
  if (modelName.startsWith("gemini")) return "google"
  return "anthropic"
}

function mapRowToAgentDefinition(row: AgentRow): AgentDefinition {
  return {
    id: row.agent_id,
    workspaceId: row.workspace_id,
    name: row.name,
    role: row.role,
    systemPrompt: row.system_prompt,
    modelProvider: row.model_provider as ProviderId,
    modelName: row.model_name,
    toolAllowlist: parseStringArray(row.tool_allowlist),
    connectorAllowlist: parseStringArray(row.connector_allowlist),
    memoryScope: row.memory_scope,
    skillMode: normalizeAgentSkillMode(row.skill_mode),
    skillsAllowlist: parseStringArray(row.skills_allowlist),
    tags: parseStringArray(row.tags),
    isOrchestrator: row.is_orchestrator === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function buildUniqueImportedName(candidateName: string, existingNames: Set<string>): string {
  const baseName = candidateName.trim() || "Imported Agent"
  if (!existingNames.has(baseName)) {
    existingNames.add(baseName)
    return baseName
  }

  let index = 2
  let nextName = `${baseName} (${index})`
  while (existingNames.has(nextName)) {
    index += 1
    nextName = `${baseName} (${index})`
  }
  existingNames.add(nextName)
  return nextName
}

export function registerAgentRegistryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("agents:list", async (_event, params?: AgentListParams) => {
    const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
    return listAgents(workspaceId).map((row) => mapRowToAgentDefinition(row))
  })

  ipcMain.handle("agents:get", async (_event, agentId: string) => {
    const row = getAgent(agentId)
    return row ? mapRowToAgentDefinition(row) : null
  })

  ipcMain.handle("agents:create", async (_event, params: AgentCreateParams) => {
    const modelName = params.modelName || getDefaultModel()
    const row = createAgent({
      workspaceId: params.workspaceId,
      name: params.name,
      role: params.role,
      systemPrompt: params.systemPrompt,
      modelProvider: params.modelProvider || inferProvider(modelName),
      modelName,
      toolAllowlist: params.toolAllowlist,
      connectorAllowlist: params.connectorAllowlist,
      memoryScope: params.memoryScope,
      skillMode: params.skillMode,
      skillsAllowlist: params.skillsAllowlist,
      tags: params.tags,
      isOrchestrator: params.isOrchestrator
    })
    return mapRowToAgentDefinition(row)
  })

  ipcMain.handle("agents:update", async (_event, { agentId, updates }: AgentUpdateParams) => {
    const updated = updateAgent(agentId, updates)
    if (!updated) {
      throw new Error("Agent not found")
    }
    return mapRowToAgentDefinition(updated)
  })

  ipcMain.handle("agents:delete", async (_event, agentId: string) => {
    deleteAgent(agentId)
  })

  ipcMain.handle("agents:exportBundle", async (_event, params?: AgentListParams) => {
    const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
    const rows = listAgents(workspaceId)
    const items = rows.map((row) => ({
      agent: mapRowToAgentDefinition(row),
      policies: listPoliciesByAgent(row.agent_id)
    }))

    const bundle: AgentExportBundle = {
      version: "1",
      exportedAt: new Date().toISOString(),
      workspaceId,
      items
    }
    return bundle
  })

  ipcMain.handle("agents:importBundle", async (_event, params: AgentImportParams) => {
    const bundle = params?.bundle
    if (!bundle || !Array.isArray(bundle.items)) {
      throw new Error("Invalid agent bundle.")
    }

    const workspaceId = bundle.workspaceId || DEFAULT_WORKSPACE_ID
    const existingNames = new Set(
      listAgents(workspaceId)
        .map((row) => row.name.trim())
        .filter((value) => value.length > 0)
    )

    const importedAgents: AgentDefinition[] = []

    for (const item of bundle.items) {
      const sourceAgent = item.agent
      if (!sourceAgent?.name || !sourceAgent?.role || !sourceAgent?.systemPrompt) {
        continue
      }

      const createdRow = createAgent({
        workspaceId,
        name: buildUniqueImportedName(sourceAgent.name, existingNames),
        role: sourceAgent.role,
        systemPrompt: sourceAgent.systemPrompt,
        modelProvider: sourceAgent.modelProvider || inferProvider(sourceAgent.modelName || ""),
        modelName: sourceAgent.modelName || getDefaultModel(),
        toolAllowlist: sourceAgent.toolAllowlist || [],
        connectorAllowlist: sourceAgent.connectorAllowlist || [],
        memoryScope: sourceAgent.memoryScope || "private",
        skillMode: sourceAgent.skillMode || "global_only",
        skillsAllowlist: sourceAgent.skillsAllowlist || [],
        tags: sourceAgent.tags || [],
        isOrchestrator: sourceAgent.isOrchestrator
      })

      const imported = mapRowToAgentDefinition(createdRow)
      importedAgents.push(imported)

      const sourcePolicies = Array.isArray(item.policies) ? item.policies : []
      for (const policy of sourcePolicies) {
        upsertPolicy({
          agentId: imported.id,
          resourceType: policy.resourceType,
          resourceKey: policy.resourceKey,
          action: policy.action,
          scope: policy.scope,
          decision: policy.decision,
          constraints: policy.constraints
        })
      }
    }

    return importedAgents
  })
}
