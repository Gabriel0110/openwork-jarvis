import { createTimelineEvent } from "../../db/timeline-events"
import type { HarnessStopReason } from "../../types"

export interface StopReasonContext {
  threadId: string
  workspaceId: string
  sourceAgentId?: string
}

export interface StopReasonState {
  reason: HarnessStopReason
  details?: Record<string, unknown>
  updatedAt: number
}

export class StopReasonRecorder {
  private state: StopReasonState | null = null

  constructor(private readonly context: StopReasonContext) {}

  record(reason: HarnessStopReason, details?: Record<string, unknown>): void {
    this.state = {
      reason,
      details,
      updatedAt: Date.now()
    }

    createTimelineEvent({
      threadId: this.context.threadId,
      workspaceId: this.context.workspaceId,
      sourceAgentId: this.context.sourceAgentId,
      eventType: reason === "completed" ? "tool_result" : "error",
      toolName: "runtime:stop_reason",
      summary: `Stop reason: ${reason}`,
      dedupeKey: `stop_reason:${this.context.threadId}:${reason}:${Math.floor(Date.now() / 2000)}`,
      payload: {
        stopReason: reason,
        ...details
      }
    })
  }

  getState(): StopReasonState | null {
    return this.state
  }
}
