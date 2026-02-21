import type { IpcMain } from "electron"
import { getThread } from "../db/index"
import {
  createTimelineEvent,
  listTimelineEventsByThread,
  listTimelineEventsByWorkspace
} from "../db/timeline-events"
import type {
  TimelineIngestTriggerParams,
  TimelineListParams,
  TimelineWorkspaceListParams
} from "../types"

const DEFAULT_WORKSPACE_ID = "default-workspace"

function normalizeNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`)
  }
  return value.trim()
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {}
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("payload must be an object when provided.")
  }
  return value as Record<string, unknown>
}

export function registerTimelineHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("timeline:list", async (_event, params: TimelineListParams) => {
    return listTimelineEventsByThread(params.threadId, params.limit)
  })

  ipcMain.handle("timeline:listWorkspace", async (_event, params?: TimelineWorkspaceListParams) => {
    const workspaceId = normalizeOptionalString(params?.workspaceId) || DEFAULT_WORKSPACE_ID
    const limit = typeof params?.limit === "number" && params.limit > 0 ? params.limit : undefined
    return listTimelineEventsByWorkspace(workspaceId, limit)
  })

  ipcMain.handle(
    "timeline:ingestTriggerEvent",
    async (_event, params: TimelineIngestTriggerParams) => {
      const threadId = normalizeNonEmptyString(params.threadId, "threadId")
      const thread = getThread(threadId)
      if (!thread) {
        throw new Error(`Thread not found for trigger event: ${threadId}`)
      }

      const triggerType = normalizeNonEmptyString(params.triggerType, "triggerType")
      if (triggerType !== "connector_event" && triggerType !== "webhook") {
        throw new Error(`Unsupported triggerType: ${triggerType}`)
      }

      const eventType = params.eventType === "tool_call" ? "tool_call" : "tool_result"
      const eventKey = normalizeNonEmptyString(params.eventKey, "eventKey")
      const sourceKey = normalizeOptionalString(params.sourceKey)
      const workspaceId = normalizeOptionalString(params.workspaceId) || DEFAULT_WORKSPACE_ID
      const summary =
        normalizeOptionalString(params.summary) ||
        `External ${triggerType} event: ${eventKey}${sourceKey ? ` (${sourceKey})` : ""}`
      const toolName =
        normalizeOptionalString(params.toolName) ||
        (triggerType === "connector_event"
          ? `connector:${sourceKey || "event"}`
          : "connector:webhook")

      const payload = normalizePayload(params.payload)
      if (triggerType === "connector_event") {
        payload.connectorEventKey = eventKey
        if (sourceKey) {
          payload.connectorKey = sourceKey
          payload.sourceConnectorKey = sourceKey
        }
      } else {
        payload.webhookEventKey = eventKey
        if (sourceKey) {
          payload.webhookSource = sourceKey
        }
      }

      return createTimelineEvent({
        threadId,
        workspaceId,
        eventType,
        sourceAgentId: normalizeOptionalString(params.sourceAgentId),
        toolName,
        summary,
        dedupeKey: normalizeOptionalString(params.dedupeKey),
        payload
      })
    }
  )
}
