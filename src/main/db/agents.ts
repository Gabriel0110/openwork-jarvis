import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import { DEFAULT_WORKSPACE_ID } from "./workspaces"
import { DEFAULT_AGENT_PACK } from "../services/default-agent-pack"
import { normalizeAgentSkillMode } from "../services/skills-registry"

export interface AgentRow {
  agent_id: string
  workspace_id: string
  name: string
  role: string
  system_prompt: string
  model_provider: string
  model_name: string
  tool_allowlist: string
  connector_allowlist: string
  memory_scope: "private" | "shared"
  skill_mode: "global_only" | "global_plus_selected" | "selected_only"
  skills_allowlist: string
  tags: string
  is_orchestrator: number
  created_at: number
  updated_at: number
}

export interface CreateAgentInput {
  workspaceId?: string
  name: string
  role: string
  systemPrompt: string
  modelProvider: string
  modelName: string
  toolAllowlist?: string[]
  connectorAllowlist?: string[]
  memoryScope?: "private" | "shared"
  skillMode?: "global_only" | "global_plus_selected" | "selected_only"
  skillsAllowlist?: string[]
  tags?: string[]
  isOrchestrator?: boolean
}

export interface UpdateAgentInput {
  name?: string
  role?: string
  systemPrompt?: string
  modelProvider?: string
  modelName?: string
  toolAllowlist?: string[]
  connectorAllowlist?: string[]
  memoryScope?: "private" | "shared"
  skillMode?: "global_only" | "global_plus_selected" | "selected_only"
  skillsAllowlist?: string[]
  tags?: string[]
  isOrchestrator?: boolean
}

export function listAgents(workspaceId: string = DEFAULT_WORKSPACE_ID): AgentRow[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM agents WHERE workspace_id = ? ORDER BY is_orchestrator DESC, updated_at DESC"
  )
  stmt.bind([workspaceId])
  const agents: AgentRow[] = []

  while (stmt.step()) {
    agents.push(stmt.getAsObject() as unknown as AgentRow)
  }

  stmt.free()
  return agents
}

export function getAgent(agentId: string): AgentRow | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM agents WHERE agent_id = ?")
  stmt.bind([agentId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as unknown as AgentRow
  stmt.free()
  return row
}

export function createAgent(input: CreateAgentInput): AgentRow {
  const database = getDb()
  const now = Date.now()
  const agentId = uuid()

  database.run(
    `INSERT INTO agents (
      agent_id, workspace_id, name, role, system_prompt, model_provider, model_name,
      tool_allowlist, connector_allowlist, memory_scope, skill_mode, skills_allowlist,
      tags, is_orchestrator,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      input.workspaceId ?? DEFAULT_WORKSPACE_ID,
      input.name,
      input.role,
      input.systemPrompt,
      input.modelProvider,
      input.modelName,
      JSON.stringify(input.toolAllowlist ?? []),
      JSON.stringify(input.connectorAllowlist ?? []),
      input.memoryScope ?? "private",
      normalizeAgentSkillMode(input.skillMode),
      JSON.stringify(input.skillsAllowlist ?? []),
      JSON.stringify(input.tags ?? []),
      input.isOrchestrator ? 1 : 0,
      now,
      now
    ]
  )

  scheduleDatabaseSave()

  return getAgent(agentId) as AgentRow
}

export function updateAgent(agentId: string, input: UpdateAgentInput): AgentRow | null {
  const existing = getAgent(agentId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()

  const values = {
    name: input.name ?? existing.name,
    role: input.role ?? existing.role,
    system_prompt: input.systemPrompt ?? existing.system_prompt,
    model_provider: input.modelProvider ?? existing.model_provider,
    model_name: input.modelName ?? existing.model_name,
    tool_allowlist:
      input.toolAllowlist !== undefined
        ? JSON.stringify(input.toolAllowlist)
        : existing.tool_allowlist,
    connector_allowlist:
      input.connectorAllowlist !== undefined
        ? JSON.stringify(input.connectorAllowlist)
        : existing.connector_allowlist,
    memory_scope: input.memoryScope ?? existing.memory_scope,
    skill_mode: normalizeAgentSkillMode(input.skillMode ?? existing.skill_mode),
    skills_allowlist:
      input.skillsAllowlist !== undefined
        ? JSON.stringify(input.skillsAllowlist)
        : existing.skills_allowlist,
    tags: input.tags !== undefined ? JSON.stringify(input.tags) : existing.tags,
    is_orchestrator:
      input.isOrchestrator !== undefined ? (input.isOrchestrator ? 1 : 0) : existing.is_orchestrator
  }

  database.run(
    `UPDATE agents
     SET name = ?, role = ?, system_prompt = ?, model_provider = ?, model_name = ?,
         tool_allowlist = ?, connector_allowlist = ?, memory_scope = ?, skill_mode = ?,
         skills_allowlist = ?, tags = ?,
         is_orchestrator = ?, updated_at = ?
     WHERE agent_id = ?`,
    [
      values.name,
      values.role,
      values.system_prompt,
      values.model_provider,
      values.model_name,
      values.tool_allowlist,
      values.connector_allowlist,
      values.memory_scope,
      values.skill_mode,
      values.skills_allowlist,
      values.tags,
      values.is_orchestrator,
      now,
      agentId
    ]
  )

  scheduleDatabaseSave()

  return getAgent(agentId)
}

export function deleteAgent(agentId: string): void {
  const database = getDb()
  database.run("DELETE FROM agents WHERE agent_id = ?", [agentId])
  scheduleDatabaseSave()
}

export function ensureDefaultAgents(workspaceId: string = DEFAULT_WORKSPACE_ID): AgentRow[] {
  const existing = listAgents(workspaceId)
  if (existing.length > 0) {
    return existing
  }

  const created: AgentRow[] = []
  for (const seed of DEFAULT_AGENT_PACK) {
    created.push(
      createAgent({
        workspaceId,
        ...seed
      })
    )
  }
  return created
}
