import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import { listWorkflowTemplates } from "./templates"
import { collectTriggerMatchCandidates } from "../services/template-trigger-runtime"
import { executeWorkflowTemplate } from "../services/template-runner"
import type { TimelineEvent, TimelineEventType } from "../types"

interface TimelineEventRow {
  event_id: string
  thread_id: string
  workspace_id: string
  event_type: TimelineEventType
  source_agent_id: string | null
  target_agent_id: string | null
  tool_name: string | null
  summary: string | null
  payload: string | null
  dedupe_key: string | null
  occurred_at: number
  created_at: number
}

export interface CreateTimelineEventInput {
  threadId: string
  workspaceId: string
  eventType: TimelineEventType
  sourceAgentId?: string
  targetAgentId?: string
  toolName?: string
  summary?: string
  payload?: Record<string, unknown>
  dedupeKey?: string
  occurredAt?: number
}

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function mapRow(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.event_id,
    threadId: row.thread_id,
    workspaceId: row.workspace_id,
    eventType: row.event_type,
    sourceAgentId: row.source_agent_id || undefined,
    targetAgentId: row.target_agent_id || undefined,
    toolName: row.tool_name || undefined,
    summary: row.summary || undefined,
    payload: parsePayload(row.payload),
    occurredAt: new Date(row.occurred_at),
    createdAt: new Date(row.created_at)
  }
}

export function listTimelineEventsByThread(threadId: string, limit: number = 300): TimelineEvent[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM timeline_events WHERE thread_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT ?"
  )
  stmt.bind([threadId, limit])

  const rows: TimelineEvent[] = []
  while (stmt.step()) {
    rows.push(mapRow(stmt.getAsObject() as unknown as TimelineEventRow))
  }
  stmt.free()

  return rows
}

export function listTimelineEventsByWorkspace(
  workspaceId: string,
  limit: number = 300
): TimelineEvent[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM timeline_events WHERE workspace_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT ?"
  )
  stmt.bind([workspaceId, limit])

  const rows: TimelineEvent[] = []
  while (stmt.step()) {
    rows.push(mapRow(stmt.getAsObject() as unknown as TimelineEventRow))
  }
  stmt.free()

  return rows
}

export function createTimelineEvent(input: CreateTimelineEventInput): TimelineEvent {
  const database = getDb()
  const now = Date.now()
  const eventId = uuid()
  const occurredAt = input.occurredAt || now
  const payloadJson =
    input.payload && Object.keys(input.payload).length > 0 ? JSON.stringify(input.payload) : null

  database.run(
    `INSERT OR IGNORE INTO timeline_events (
      event_id, thread_id, workspace_id, event_type, source_agent_id, target_agent_id,
      tool_name, summary, payload, dedupe_key, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      input.threadId,
      input.workspaceId,
      input.eventType,
      input.sourceAgentId || null,
      input.targetAgentId || null,
      input.toolName || null,
      input.summary || null,
      payloadJson,
      input.dedupeKey || null,
      occurredAt,
      now
    ]
  )

  if (input.dedupeKey) {
    const existingStmt = database.prepare("SELECT * FROM timeline_events WHERE dedupe_key = ?")
    existingStmt.bind([input.dedupeKey])
    if (existingStmt.step()) {
      const row = existingStmt.getAsObject() as unknown as TimelineEventRow
      existingStmt.free()
      return mapRow(row)
    }
    existingStmt.free()
  }

  const stmt = database.prepare("SELECT * FROM timeline_events WHERE event_id = ?")
  stmt.bind([eventId])
  if (!stmt.step()) {
    stmt.free()
    throw new Error("Failed to insert timeline event.")
  }
  const inserted = mapRow(stmt.getAsObject() as unknown as TimelineEventRow)
  stmt.free()

  try {
    const templates = listWorkflowTemplates(inserted.workspaceId)
    const templateById = new Map(templates.map((template) => [template.id, template]))
    const candidates = collectTriggerMatchCandidates(inserted, templates)
    for (const candidate of candidates) {
      const triggerEvent = createTimelineEvent({
        threadId: candidate.threadId,
        workspaceId: candidate.workspaceId,
        eventType: "template_trigger_match",
        sourceAgentId: candidate.sourceAgentId,
        toolName: candidate.toolName,
        summary: candidate.summary,
        payload: candidate.payload,
        dedupeKey: candidate.dedupeKey
      })

      if (!candidate.autoRunEligible) {
        continue
      }

      const template = templateById.get(candidate.templateId)
      if (!template) {
        continue
      }

      createTimelineEvent({
        threadId: candidate.threadId,
        workspaceId: candidate.workspaceId,
        eventType: "tool_call",
        toolName: "template:auto_run",
        summary: `Auto-run requested: ${candidate.templateName}`,
        dedupeKey: `${candidate.dedupeKey}:auto_run:call`,
        payload: {
          templateId: candidate.templateId,
          templateName: candidate.templateName,
          triggerId: candidate.triggerId,
          sourceEventId: inserted.id,
          triggerEventId: triggerEvent.id
        }
      })

      const runResult = executeWorkflowTemplate(template, {
        title: `${candidate.templateName} - Auto Trigger`,
        metadata: {
          triggerSourceEventId: inserted.id,
          triggerEventId: triggerEvent.id,
          triggerId: candidate.triggerId,
          triggerExecutionMode: candidate.executionMode,
          triggerTemplateId: candidate.templateId
        }
      })

      if (runResult.status === "blocked") {
        createTimelineEvent({
          threadId: candidate.threadId,
          workspaceId: candidate.workspaceId,
          eventType: "tool_result",
          toolName: "template:auto_run",
          summary: `Auto-run blocked (${candidate.templateName}): missing connectors`,
          dedupeKey: `${candidate.dedupeKey}:auto_run:blocked`,
          payload: {
            templateId: candidate.templateId,
            templateName: candidate.templateName,
            missingConnectors: runResult.missingConnectors || []
          }
        })
        continue
      }

      if (!runResult.thread) {
        continue
      }

      createTimelineEvent({
        threadId: runResult.thread.thread_id,
        workspaceId: candidate.workspaceId,
        eventType: "tool_call",
        toolName: "template:run",
        summary: `Template auto-run started: ${candidate.templateName}`,
        payload: {
          templateId: candidate.templateId,
          templateName: candidate.templateName,
          triggerId: candidate.triggerId
        }
      })

      createTimelineEvent({
        threadId: runResult.thread.thread_id,
        workspaceId: candidate.workspaceId,
        eventType: "tool_result",
        toolName: "template:run",
        summary: `Applied ${runResult.appliedPolicies} policy defaults and seeded ${runResult.seededMemoryEntries} memory entries.`,
        payload: {
          templateId: candidate.templateId,
          appliedPolicies: runResult.appliedPolicies,
          seededMemoryEntries: runResult.seededMemoryEntries
        }
      })

      createTimelineEvent({
        threadId: candidate.threadId,
        workspaceId: candidate.workspaceId,
        eventType: "tool_result",
        toolName: "template:auto_run",
        summary: `Auto-run started "${candidate.templateName}" in thread ${runResult.thread.thread_id.slice(0, 8)}.`,
        dedupeKey: `${candidate.dedupeKey}:auto_run:started`,
        payload: {
          templateId: candidate.templateId,
          templateName: candidate.templateName,
          threadId: runResult.thread.thread_id,
          appliedPolicies: runResult.appliedPolicies,
          seededMemoryEntries: runResult.seededMemoryEntries
        }
      })
    }
  } catch (error) {
    console.warn("[Timeline] Failed to evaluate template triggers.", error)
  }

  scheduleDatabaseSave()

  return inserted
}

export function deleteTimelineEventsByThread(threadId: string): void {
  const database = getDb()
  database.run("DELETE FROM timeline_events WHERE thread_id = ?", [threadId])
  scheduleDatabaseSave()
}
