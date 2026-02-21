import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  WorkflowTemplate,
  WorkflowTemplateCreateParams,
  WorkflowTemplateMemoryDefaults,
  WorkflowTemplatePolicyDefault,
  WorkflowTemplateSchedule,
  WorkflowTemplateTrigger
} from "../types"

interface WorkflowTemplateRow {
  template_id: string
  workspace_id: string
  name: string
  description: string | null
  starter_prompts: string
  agent_ids: string
  required_connector_keys: string
  expected_artifacts: string
  default_speaker_type: "orchestrator" | "agent"
  default_speaker_agent_id: string | null
  default_model_id: string | null
  policy_defaults: string
  memory_defaults: string
  schedule_config: string
  trigger_config: string
  tags: string
  created_at: number
  updated_at: number
}

interface WorkflowTemplateUpdateInput {
  name?: string
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

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

function parsePolicyDefaults(value: string | null): WorkflowTemplatePolicyDefault[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (item) => typeof item === "object" && !!item
    ) as WorkflowTemplatePolicyDefault[]
  } catch {
    return []
  }
}

function parseMemoryDefaults(value: string | null): WorkflowTemplateMemoryDefaults {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed ? (parsed as WorkflowTemplateMemoryDefaults) : {}
  } catch {
    return {}
  }
}

function parseScheduleConfig(value: string | null): WorkflowTemplateSchedule | undefined {
  if (!value) {
    return undefined
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== "object" || !parsed) {
      return undefined
    }

    const enabled = (parsed as { enabled?: unknown }).enabled
    if (typeof enabled !== "boolean") {
      return undefined
    }

    const schedule: WorkflowTemplateSchedule = { enabled }
    const rrule = (parsed as { rrule?: unknown }).rrule
    if (typeof rrule === "string" && rrule.trim().length > 0) {
      schedule.rrule = rrule.trim()
    }
    const timezone = (parsed as { timezone?: unknown }).timezone
    if (typeof timezone === "string" && timezone.trim().length > 0) {
      schedule.timezone = timezone.trim()
    }

    return schedule
  } catch {
    return undefined
  }
}

function parseTriggerConfig(value: string | null): WorkflowTemplateTrigger[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    const normalized: WorkflowTemplateTrigger[] = []
    for (const item of parsed) {
      if (typeof item !== "object" || !item) {
        continue
      }

      const row = item as Record<string, unknown>
      const type = row.type
      if (type !== "timeline_event" && type !== "connector_event" && type !== "webhook") {
        continue
      }

      const eventKey = typeof row.eventKey === "string" ? row.eventKey.trim() : ""
      if (!eventKey) {
        continue
      }

      normalized.push({
        id: typeof row.id === "string" && row.id.trim().length > 0 ? row.id.trim() : uuid(),
        type,
        enabled: row.enabled !== false,
        executionMode: row.executionMode === "auto_run" ? "auto_run" : "notify",
        eventKey,
        sourceKey:
          typeof row.sourceKey === "string" && row.sourceKey.trim()
            ? row.sourceKey.trim()
            : undefined,
        matchText:
          typeof row.matchText === "string" && row.matchText.trim()
            ? row.matchText.trim()
            : undefined
      })
    }
    return normalized
  } catch {
    return []
  }
}

function normalizeArray(values: string[] | undefined): string[] {
  if (!values) {
    return []
  }
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0)
  return Array.from(new Set(normalized))
}

function mapWorkflowTemplateRow(row: WorkflowTemplateRow): WorkflowTemplate {
  return {
    id: row.template_id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description || undefined,
    starterPrompts: parseStringArray(row.starter_prompts),
    agentIds: parseStringArray(row.agent_ids),
    requiredConnectorKeys: parseStringArray(row.required_connector_keys),
    expectedArtifacts: parseStringArray(row.expected_artifacts),
    defaultSpeakerType: row.default_speaker_type,
    defaultSpeakerAgentId: row.default_speaker_agent_id || undefined,
    defaultModelId: row.default_model_id || undefined,
    policyDefaults: parsePolicyDefaults(row.policy_defaults),
    memoryDefaults: parseMemoryDefaults(row.memory_defaults),
    schedule: parseScheduleConfig(row.schedule_config),
    triggers: parseTriggerConfig(row.trigger_config),
    tags: parseStringArray(row.tags),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

export function listWorkflowTemplates(workspaceId: string): WorkflowTemplate[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM workflow_templates WHERE workspace_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([workspaceId])

  const templates: WorkflowTemplate[] = []
  while (stmt.step()) {
    templates.push(mapWorkflowTemplateRow(stmt.getAsObject() as unknown as WorkflowTemplateRow))
  }
  stmt.free()

  return templates
}

export function listAllWorkflowTemplates(): WorkflowTemplate[] {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM workflow_templates ORDER BY updated_at DESC")

  const templates: WorkflowTemplate[] = []
  while (stmt.step()) {
    templates.push(mapWorkflowTemplateRow(stmt.getAsObject() as unknown as WorkflowTemplateRow))
  }
  stmt.free()

  return templates
}

export function getWorkflowTemplate(templateId: string): WorkflowTemplate | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM workflow_templates WHERE template_id = ?")
  stmt.bind([templateId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const template = mapWorkflowTemplateRow(stmt.getAsObject() as unknown as WorkflowTemplateRow)
  stmt.free()
  return template
}

export function createWorkflowTemplate(params: WorkflowTemplateCreateParams): WorkflowTemplate {
  const database = getDb()
  const templateId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO workflow_templates (
      template_id, workspace_id, name, description, starter_prompts, agent_ids, required_connector_keys,
      expected_artifacts, default_speaker_type, default_speaker_agent_id, default_model_id,
      policy_defaults, memory_defaults, schedule_config, trigger_config, tags, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      templateId,
      params.workspaceId,
      params.name,
      params.description || null,
      JSON.stringify(normalizeArray(params.starterPrompts)),
      JSON.stringify(normalizeArray(params.agentIds)),
      JSON.stringify(normalizeArray(params.requiredConnectorKeys)),
      JSON.stringify(normalizeArray(params.expectedArtifacts)),
      params.defaultSpeakerType || "orchestrator",
      params.defaultSpeakerAgentId || null,
      params.defaultModelId || null,
      JSON.stringify(params.policyDefaults || []),
      JSON.stringify(params.memoryDefaults || {}),
      JSON.stringify(params.schedule || {}),
      JSON.stringify(params.triggers || []),
      JSON.stringify(normalizeArray(params.tags)),
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getWorkflowTemplate(templateId) as WorkflowTemplate
}

export function updateWorkflowTemplate(
  templateId: string,
  updates: WorkflowTemplateUpdateInput
): WorkflowTemplate | null {
  const existing = getWorkflowTemplate(templateId)
  if (!existing) {
    return null
  }

  const database = getDb()
  const now = Date.now()

  database.run(
    `UPDATE workflow_templates
     SET name = ?, description = ?, starter_prompts = ?, agent_ids = ?, required_connector_keys = ?,
         expected_artifacts = ?, default_speaker_type = ?, default_speaker_agent_id = ?, default_model_id = ?,
         policy_defaults = ?, memory_defaults = ?, schedule_config = ?, trigger_config = ?, tags = ?, updated_at = ?
     WHERE template_id = ?`,
    [
      updates.name ?? existing.name,
      updates.description === undefined
        ? existing.description || null
        : updates.description || null,
      JSON.stringify(updates.starterPrompts ?? existing.starterPrompts),
      JSON.stringify(updates.agentIds ?? existing.agentIds),
      JSON.stringify(updates.requiredConnectorKeys ?? existing.requiredConnectorKeys),
      JSON.stringify(updates.expectedArtifacts ?? existing.expectedArtifacts),
      updates.defaultSpeakerType ?? existing.defaultSpeakerType,
      updates.defaultSpeakerAgentId === undefined
        ? existing.defaultSpeakerAgentId || null
        : updates.defaultSpeakerAgentId || null,
      updates.defaultModelId === undefined
        ? existing.defaultModelId || null
        : updates.defaultModelId || null,
      JSON.stringify(updates.policyDefaults ?? existing.policyDefaults),
      JSON.stringify(updates.memoryDefaults ?? existing.memoryDefaults),
      JSON.stringify(updates.schedule ?? existing.schedule ?? {}),
      JSON.stringify(updates.triggers ?? existing.triggers),
      JSON.stringify(updates.tags ?? existing.tags),
      now,
      templateId
    ]
  )

  scheduleDatabaseSave()
  return getWorkflowTemplate(templateId)
}

export function deleteWorkflowTemplate(templateId: string): void {
  const database = getDb()
  database.run("DELETE FROM workflow_templates WHERE template_id = ?", [templateId])
  scheduleDatabaseSave()
}
