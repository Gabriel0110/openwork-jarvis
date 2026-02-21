import { v4 as uuid } from "uuid"
import { createThread, type ThreadRow, updateThread } from "../db"
import { listConnectors } from "../db/connectors"
import { createMemoryEntry } from "../db/memory"
import { upsertPolicy } from "../db/policies"
import type { Thread, WorkflowTemplate } from "../types"

export interface ExecuteWorkflowTemplateOptions {
  title?: string
  metadata?: Record<string, unknown>
}

export interface ExecuteWorkflowTemplateResult {
  status: "started" | "blocked"
  thread?: Thread
  missingConnectors?: string[]
  appliedPolicies: number
  seededMemoryEntries: number
}

function parseJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function mapThreadRow(row: ThreadRow): Thread {
  return {
    thread_id: row.thread_id,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    metadata: parseJsonObject(row.metadata),
    status: row.status as Thread["status"],
    thread_values: parseJsonObject(row.thread_values),
    title: row.title || undefined
  }
}

export function executeWorkflowTemplate(
  template: WorkflowTemplate,
  options: ExecuteWorkflowTemplateOptions = {}
): ExecuteWorkflowTemplateResult {
  const enabledConnectorKeys = new Set(
    listConnectors(template.workspaceId)
      .filter((connector) => connector.enabled)
      .map((connector) => connector.key)
  )
  const missingConnectors = template.requiredConnectorKeys.filter(
    (key) => !enabledConnectorKeys.has(key)
  )

  if (missingConnectors.length > 0) {
    return {
      status: "blocked",
      missingConnectors,
      appliedPolicies: 0,
      seededMemoryEntries: 0
    }
  }

  let appliedPolicies = 0
  for (const policyDefault of template.policyDefaults) {
    if (!policyDefault.agentId) {
      continue
    }

    upsertPolicy({
      agentId: policyDefault.agentId,
      resourceType: policyDefault.resourceType,
      resourceKey: policyDefault.resourceKey,
      action: policyDefault.action,
      scope: policyDefault.scope,
      decision: policyDefault.decision,
      constraints: policyDefault.constraints || {}
    })
    appliedPolicies += 1
  }

  const title = options.title?.trim() || `${template.name} - ${new Date().toLocaleDateString()}`
  const threadId = uuid()
  const metadata: Record<string, unknown> = {
    title,
    templateId: template.id,
    templateName: template.name,
    templateStarterPrompts: template.starterPrompts,
    templateStarterPrompt: template.starterPrompts[0] || "",
    templateExpectedArtifacts: template.expectedArtifacts,
    templateRequiredConnectorKeys: template.requiredConnectorKeys,
    templateAgentIds: template.agentIds,
    templatePolicyDefaults: template.policyDefaults,
    templateSchedule: template.schedule,
    templateTriggers: template.triggers,
    speakerType: template.defaultSpeakerType || "orchestrator",
    speakerAgentId:
      template.defaultSpeakerType === "agent" ? template.defaultSpeakerAgentId || null : null,
    model: template.defaultModelId || undefined,
    ...(options.metadata || {})
  }

  const createdThread = createThread(threadId, metadata)
  const savedThread = updateThread(threadId, { title }) || createdThread
  const thread = mapThreadRow(savedThread)

  let seededMemoryEntries = 0
  for (const seed of template.memoryDefaults.seedEntries || []) {
    createMemoryEntry({
      workspaceId: template.workspaceId,
      scope: seed.scope,
      agentId: seed.agentId,
      threadId: seed.scope === "session" ? thread.thread_id : undefined,
      title: seed.title,
      content: seed.content,
      tags: seed.tags || [],
      source: `template:${template.id}`
    })
    seededMemoryEntries += 1
  }

  return {
    status: "started",
    thread,
    appliedPolicies,
    seededMemoryEntries
  }
}
