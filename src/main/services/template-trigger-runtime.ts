import { inferConnectorInvocation } from "./policy-engine"
import type { TimelineEvent, WorkflowTemplate, WorkflowTemplateTrigger } from "../types"

export interface TriggerMatchCandidate {
  templateId: string
  templateName: string
  triggerId: string
  executionMode: WorkflowTemplateTrigger["executionMode"]
  autoRunEligible: boolean
  threadId: string
  workspaceId: string
  sourceAgentId?: string
  toolName: string
  summary: string
  dedupeKey: string
  payload: Record<string, unknown>
}

interface TriggerSignal {
  eventKeys: string[]
  sourceKeys: string[]
}

function normalizeText(value: string | undefined): string {
  return (value || "").trim().toLowerCase()
}

function normalizeConnectorKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_")
  return normalized.length > 0 ? normalized : undefined
}

function pushUnique(target: string[], value: string | undefined): void {
  const normalized = normalizeText(value)
  if (!normalized || target.includes(normalized)) {
    return
  }
  target.push(normalized)
}

function readPayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readPayloadArgs(event: TimelineEvent): Record<string, unknown> | undefined {
  const args = readPayloadObject(event.payload?.args)
  return args || undefined
}

function readPayloadString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function isSystemTemplateToolEvent(event: TimelineEvent): boolean {
  return normalizeText(event.toolName).startsWith("template:")
}

function matchesMatchText(trigger: WorkflowTemplateTrigger, event: TimelineEvent): boolean {
  const expected = normalizeText(trigger.matchText)
  if (!expected) {
    return true
  }

  const payloadText = (() => {
    try {
      return JSON.stringify(event.payload || {})
    } catch {
      return ""
    }
  })()

  const haystack = `${event.summary || ""} ${payloadText}`.toLowerCase()
  return haystack.includes(expected)
}

function matchesSignal(
  trigger: WorkflowTemplateTrigger,
  event: TimelineEvent,
  signal: TriggerSignal | null
): boolean {
  if (!trigger.enabled || !signal) {
    return false
  }

  const eventKey = normalizeText(trigger.eventKey)
  if (!eventKey || !signal.eventKeys.includes(eventKey)) {
    return false
  }

  const sourceKey = normalizeText(trigger.sourceKey)
  if (sourceKey && !signal.sourceKeys.includes(sourceKey)) {
    return false
  }

  return matchesMatchText(trigger, event)
}

function buildTimelineSignal(event: TimelineEvent): TriggerSignal {
  const eventKeys: string[] = []
  const sourceKeys: string[] = []

  pushUnique(eventKeys, event.eventType)
  pushUnique(sourceKeys, event.toolName)

  return { eventKeys, sourceKeys }
}

function buildConnectorSignal(event: TimelineEvent): TriggerSignal | null {
  const payload = readPayloadObject(event.payload)
  const payloadConnectorKey = normalizeConnectorKey(
    payload
      ? readPayloadString(payload, [
          "connectorKey",
          "connector",
          "connector_id",
          "connectorId",
          "sourceConnectorKey"
        ])
      : undefined
  )
  const connectorInvocation = inferConnectorInvocation(
    event.toolName || "",
    readPayloadArgs(event),
    []
  )
  const connectorKey = payloadConnectorKey || connectorInvocation?.connectorKey
  if (!connectorKey) {
    return null
  }

  const eventKeys: string[] = []
  const sourceKeys: string[] = []

  const connectorEventKey = payload
    ? readPayloadString(payload, ["connectorEventKey", "eventKey", "event"])
    : undefined
  const action = connectorInvocation?.action

  pushUnique(eventKeys, event.eventType)
  pushUnique(eventKeys, connectorEventKey)
  pushUnique(eventKeys, action)
  if (action) {
    pushUnique(eventKeys, `${event.eventType}:${action}`)
  }

  pushUnique(sourceKeys, connectorKey)
  pushUnique(sourceKeys, event.toolName)

  return { eventKeys, sourceKeys }
}

function buildWebhookSignal(event: TimelineEvent): TriggerSignal | null {
  const payload = readPayloadObject(event.payload)
  const toolName = normalizeText(event.toolName)
  const payloadEventKey = payload
    ? readPayloadString(payload, [
        "webhookEventKey",
        "eventKey",
        "event",
        "webhook_event",
        "webhookEvent"
      ])
    : undefined
  const payloadSourceKey = payload
    ? readPayloadString(payload, [
        "webhookSource",
        "sourceKey",
        "source",
        "webhook",
        "webhookId",
        "webhook_id"
      ])
    : undefined
  const connectorInvocation = inferConnectorInvocation(
    event.toolName || "",
    readPayloadArgs(event),
    []
  )
  const hasWebhookHint =
    toolName.includes("webhook") ||
    !!payloadEventKey ||
    !!payloadSourceKey ||
    connectorInvocation?.connectorKey === "webhook"

  if (!hasWebhookHint) {
    return null
  }

  const eventKeys: string[] = []
  const sourceKeys: string[] = []

  pushUnique(eventKeys, event.eventType)
  pushUnique(eventKeys, payloadEventKey)

  if (connectorInvocation?.connectorKey) {
    pushUnique(sourceKeys, connectorInvocation.connectorKey)
  }
  pushUnique(sourceKeys, payloadSourceKey)
  if (toolName.includes("webhook")) {
    pushUnique(sourceKeys, "webhook")
  }
  pushUnique(sourceKeys, event.toolName)

  return { eventKeys, sourceKeys }
}

function matchesTimelineTrigger(trigger: WorkflowTemplateTrigger, event: TimelineEvent): boolean {
  if (trigger.type !== "timeline_event") {
    return false
  }
  return matchesSignal(trigger, event, buildTimelineSignal(event))
}

function matchesConnectorTrigger(trigger: WorkflowTemplateTrigger, event: TimelineEvent): boolean {
  if (trigger.type !== "connector_event") {
    return false
  }
  return matchesSignal(trigger, event, buildConnectorSignal(event))
}

function matchesWebhookTrigger(trigger: WorkflowTemplateTrigger, event: TimelineEvent): boolean {
  if (trigger.type !== "webhook") {
    return false
  }
  return matchesSignal(trigger, event, buildWebhookSignal(event))
}

export function collectTriggerMatchCandidates(
  event: TimelineEvent,
  templates: WorkflowTemplate[]
): TriggerMatchCandidate[] {
  if (event.eventType === "template_trigger_match" || isSystemTemplateToolEvent(event)) {
    return []
  }

  const candidates: TriggerMatchCandidate[] = []
  for (const template of templates) {
    for (const trigger of template.triggers) {
      const isMatch =
        matchesTimelineTrigger(trigger, event) ||
        matchesConnectorTrigger(trigger, event) ||
        matchesWebhookTrigger(trigger, event)
      if (!isMatch) {
        continue
      }

      // Keep auto-run guardrail restricted to timeline events for now.
      const autoRunEligible =
        trigger.executionMode === "auto_run" && trigger.type === "timeline_event"

      candidates.push({
        templateId: template.id,
        templateName: template.name,
        triggerId: trigger.id,
        executionMode: trigger.executionMode,
        autoRunEligible,
        threadId: event.threadId,
        workspaceId: event.workspaceId,
        sourceAgentId: event.sourceAgentId,
        toolName: "template:trigger",
        summary: `Trigger matched: ${template.name} (${trigger.type}:${trigger.eventKey})`,
        dedupeKey: `${event.id}:trigger:${template.id}:${trigger.id}`,
        payload: {
          templateId: template.id,
          templateName: template.name,
          triggerId: trigger.id,
          triggerType: trigger.type,
          triggerExecutionMode: trigger.executionMode,
          triggerAutoRunEligible: autoRunEligible,
          triggerEventKey: trigger.eventKey,
          triggerSourceKey: trigger.sourceKey,
          sourceEventId: event.id,
          sourceEventType: event.eventType,
          sourceToolName: event.toolName,
          status: autoRunEligible ? "auto_run_pending" : "notify_pending"
        }
      })
    }
  }

  return candidates
}
