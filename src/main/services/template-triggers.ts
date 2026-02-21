import { randomUUID } from "node:crypto"
import type {
  WorkflowTemplateTrigger,
  WorkflowTemplateTriggerExecutionMode,
  WorkflowTemplateTriggerType
} from "../types"

const ALLOWED_TRIGGER_TYPES: Set<WorkflowTemplateTriggerType> = new Set([
  "timeline_event",
  "connector_event",
  "webhook"
])

const ALLOWED_EXECUTION_MODES: Set<WorkflowTemplateTriggerExecutionMode> = new Set([
  "notify",
  "auto_run"
])

function normalizeTriggerType(value: unknown): WorkflowTemplateTriggerType {
  if (typeof value !== "string") {
    throw new Error("Template trigger type must be a string.")
  }

  const normalized = value.trim() as WorkflowTemplateTriggerType
  if (!ALLOWED_TRIGGER_TYPES.has(normalized)) {
    throw new Error(`Unsupported template trigger type: ${value}`)
  }
  return normalized
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Template trigger ${fieldName} is required.`)
  }
  return value.trim()
}

function normalizeExecutionMode(value: unknown): WorkflowTemplateTriggerExecutionMode {
  if (value === undefined || value === null || value === "") {
    return "notify"
  }

  if (typeof value !== "string") {
    throw new Error("Template trigger execution mode must be a string.")
  }

  const normalized = value.trim() as WorkflowTemplateTriggerExecutionMode
  if (!ALLOWED_EXECUTION_MODES.has(normalized)) {
    throw new Error(`Unsupported template trigger execution mode: ${value}`)
  }
  return normalized
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeTemplateTriggers(
  triggers: WorkflowTemplateTrigger[] | undefined
): WorkflowTemplateTrigger[] {
  if (!triggers) {
    return []
  }

  if (!Array.isArray(triggers)) {
    throw new Error("Template triggers must be an array.")
  }

  const seenIds = new Set<string>()
  const normalized: WorkflowTemplateTrigger[] = []

  for (const candidate of triggers) {
    if (!candidate || typeof candidate !== "object") {
      continue
    }

    const idCandidate =
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : randomUUID()
    let id = idCandidate
    while (seenIds.has(id)) {
      id = randomUUID()
    }
    seenIds.add(id)

    normalized.push({
      id,
      type: normalizeTriggerType(candidate.type),
      enabled: candidate.enabled !== false,
      executionMode: normalizeExecutionMode(candidate.executionMode),
      eventKey: normalizeRequiredString(candidate.eventKey, "eventKey"),
      sourceKey: normalizeOptionalString(candidate.sourceKey),
      matchText: normalizeOptionalString(candidate.matchText)
    })
  }

  return normalized
}
