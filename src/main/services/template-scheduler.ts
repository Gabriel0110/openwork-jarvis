import { createThread, getThread, updateThread } from "../db"
import {
  createTemplateScheduleRunAttempt,
  updateTemplateScheduleRun
} from "../db/template-schedule-runs"
import { listAllWorkflowTemplates } from "../db/templates"
import { createTimelineEvent } from "../db/timeline-events"
import { executeWorkflowTemplate } from "./template-runner"
import { getNextTemplateScheduleRunTimestamp } from "../../shared/template-schedule-preview"
import type { WorkflowTemplate } from "../types"

const DEFAULT_TEMPLATE_SCHEDULER_INTERVAL_MS = 30_000
const DEFAULT_LOOKBACK_WINDOW_MS = 35 * 24 * 60 * 60 * 1000
const MAX_OCCURRENCE_ITERATIONS = 2_500
const STALE_PENDING_RETRY_MS = 5 * 60 * 1000
const SCHEDULE_AUDIT_THREAD_PREFIX = "system-template-schedule-audit:"
const SCHEDULE_AUDIT_THREAD_TITLE = "System: Scheduled Template Runs"

let schedulerTimer: ReturnType<typeof setInterval> | null = null
let schedulerTickInFlight = false

export interface TemplateSchedulerTickResult {
  evaluatedTemplates: number
  dueTemplates: number
  skippedExistingRuns: number
  startedRuns: number
  blockedRuns: number
  failedRuns: number
}

function normalizeTimezone(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : "UTC"
}

function resolveLatestDueOccurrenceTimestamp(
  template: WorkflowTemplate,
  nowMs: number
): number | null {
  const schedule = template.schedule
  if (!schedule?.enabled || !schedule.rrule?.trim()) {
    return null
  }

  const timezone = normalizeTimezone(schedule.timezone)
  const rrule = schedule.rrule.trim()
  const effectiveNowMs = nowMs + 1_000
  const searchStart = effectiveNowMs - DEFAULT_LOOKBACK_WINDOW_MS
  let cursor = searchStart - 1
  let latestDue: number | null = null

  for (let iteration = 0; iteration < MAX_OCCURRENCE_ITERATIONS; iteration += 1) {
    let next: number | null = null
    try {
      next = getNextTemplateScheduleRunTimestamp(rrule, timezone, cursor)
    } catch (error) {
      console.warn(
        `[TemplateScheduler] Failed schedule computation for template ${template.id}.`,
        error
      )
      return null
    }

    if (!next || next > effectiveNowMs) {
      return latestDue
    }

    latestDue = next
    cursor = next + 1
  }

  return latestDue
}

function ensureScheduleAuditThread(workspaceId: string): string {
  const threadId = `${SCHEDULE_AUDIT_THREAD_PREFIX}${workspaceId}`
  const existing = getThread(threadId)
  if (existing) {
    return threadId
  }

  createThread(threadId, {
    title: SCHEDULE_AUDIT_THREAD_TITLE,
    workspaceId,
    systemThreadType: "template_schedule_audit"
  })
  updateThread(threadId, { title: SCHEDULE_AUDIT_THREAD_TITLE })
  return threadId
}

function buildScheduleOccurrenceDedupeBase(templateId: string, scheduledForMs: number): string {
  return `template:schedule:${templateId}:${scheduledForMs}`
}

function processDueTemplateSchedule(
  template: WorkflowTemplate,
  scheduledForMs: number,
  nowMs: number
): "started" | "blocked" | "failed" | "skipped" {
  const schedule = template.schedule
  if (!schedule?.rrule) {
    return "skipped"
  }

  const timezone = normalizeTimezone(schedule.timezone)
  const dedupeBase = buildScheduleOccurrenceDedupeBase(template.id, scheduledForMs)
  const runAttempt = createTemplateScheduleRunAttempt({
    templateId: template.id,
    workspaceId: template.workspaceId,
    scheduledFor: scheduledForMs,
    metadata: {
      scheduleRrule: schedule.rrule,
      scheduleTimezone: timezone
    }
  })
  const isRetryablePending =
    !runAttempt.inserted &&
    runAttempt.run.status === "pending" &&
    nowMs - runAttempt.run.updatedAt.getTime() >= STALE_PENDING_RETRY_MS

  if (!runAttempt.inserted && !isRetryablePending) {
    return "skipped"
  }

  const scheduleRun = runAttempt.run
  const scheduledAtIso = new Date(scheduledForMs).toISOString()
  const auditThreadId = ensureScheduleAuditThread(template.workspaceId)

  createTimelineEvent({
    threadId: auditThreadId,
    workspaceId: template.workspaceId,
    eventType: "tool_call",
    toolName: "template:schedule",
    dedupeKey: `${dedupeBase}:call`,
    summary: `Scheduled run claimed for "${template.name}" (${scheduledAtIso}).`,
    payload: {
      templateId: template.id,
      templateName: template.name,
      scheduleRunId: scheduleRun.id,
      scheduledFor: scheduledForMs,
      scheduleTimezone: timezone,
      scheduleRrule: schedule.rrule,
      status: "claimed"
    }
  })

  try {
    const runResult = executeWorkflowTemplate(template, {
      title: `${template.name} - Scheduled ${scheduledAtIso}`,
      metadata: {
        scheduleRunId: scheduleRun.id,
        scheduledFor: scheduledForMs,
        scheduleTimezone: timezone,
        scheduleRrule: schedule.rrule
      }
    })

    if (runResult.status === "blocked") {
      updateTemplateScheduleRun(scheduleRun.id, {
        status: "blocked",
        missingConnectors: runResult.missingConnectors || [],
        metadata: {
          status: "blocked",
          blockedAt: new Date(nowMs).toISOString()
        }
      })

      createTimelineEvent({
        threadId: auditThreadId,
        workspaceId: template.workspaceId,
        eventType: "tool_result",
        toolName: "template:schedule",
        dedupeKey: `${dedupeBase}:blocked`,
        summary: `Scheduled run blocked for "${template.name}" due to missing connectors.`,
        payload: {
          templateId: template.id,
          templateName: template.name,
          scheduleRunId: scheduleRun.id,
          scheduledFor: scheduledForMs,
          missingConnectors: runResult.missingConnectors || [],
          status: "blocked"
        }
      })
      return "blocked"
    }

    if (!runResult.thread) {
      updateTemplateScheduleRun(scheduleRun.id, {
        status: "error",
        errorMessage: "Scheduled run did not return a run thread.",
        metadata: {
          status: "error",
          failedAt: new Date(nowMs).toISOString()
        }
      })

      createTimelineEvent({
        threadId: auditThreadId,
        workspaceId: template.workspaceId,
        eventType: "error",
        toolName: "template:schedule",
        dedupeKey: `${dedupeBase}:missing-thread`,
        summary: `Scheduled run failed for "${template.name}" (missing run thread).`,
        payload: {
          templateId: template.id,
          templateName: template.name,
          scheduleRunId: scheduleRun.id,
          scheduledFor: scheduledForMs,
          status: "error"
        }
      })
      return "failed"
    }

    updateTemplateScheduleRun(scheduleRun.id, {
      status: "started",
      runThreadId: runResult.thread.thread_id,
      metadata: {
        status: "started",
        startedAt: new Date(nowMs).toISOString()
      }
    })

    createTimelineEvent({
      threadId: runResult.thread.thread_id,
      workspaceId: template.workspaceId,
      eventType: "tool_call",
      toolName: "template:run",
      summary: `Scheduled template run started: ${template.name}`,
      payload: {
        templateId: template.id,
        templateName: template.name,
        scheduleRunId: scheduleRun.id,
        scheduledFor: scheduledForMs
      }
    })

    createTimelineEvent({
      threadId: runResult.thread.thread_id,
      workspaceId: template.workspaceId,
      eventType: "tool_result",
      toolName: "template:run",
      summary: `Scheduled run initialized with ${runResult.appliedPolicies} policy defaults and ${runResult.seededMemoryEntries} memory entries.`,
      payload: {
        templateId: template.id,
        scheduleRunId: scheduleRun.id,
        scheduledFor: scheduledForMs,
        appliedPolicies: runResult.appliedPolicies,
        seededMemoryEntries: runResult.seededMemoryEntries
      }
    })

    createTimelineEvent({
      threadId: auditThreadId,
      workspaceId: template.workspaceId,
      eventType: "tool_result",
      toolName: "template:schedule",
      dedupeKey: `${dedupeBase}:started`,
      summary: `Scheduled run started "${template.name}" in thread ${runResult.thread.thread_id.slice(0, 8)}.`,
      payload: {
        templateId: template.id,
        templateName: template.name,
        scheduleRunId: scheduleRun.id,
        threadId: runResult.thread.thread_id,
        scheduledFor: scheduledForMs,
        appliedPolicies: runResult.appliedPolicies,
        seededMemoryEntries: runResult.seededMemoryEntries,
        status: "started"
      }
    })

    return "started"
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduler error."

    updateTemplateScheduleRun(scheduleRun.id, {
      status: "error",
      errorMessage: message,
      metadata: {
        status: "error",
        failedAt: new Date(nowMs).toISOString()
      }
    })

    createTimelineEvent({
      threadId: auditThreadId,
      workspaceId: template.workspaceId,
      eventType: "error",
      toolName: "template:schedule",
      dedupeKey: `${dedupeBase}:error`,
      summary: `Scheduled run failed for "${template.name}": ${message}`,
      payload: {
        templateId: template.id,
        templateName: template.name,
        scheduleRunId: scheduleRun.id,
        scheduledFor: scheduledForMs,
        error: message,
        status: "error"
      }
    })

    return "failed"
  }
}

export function runTemplateSchedulerTick(nowMs: number = Date.now()): TemplateSchedulerTickResult {
  const templates = listAllWorkflowTemplates()
  const result: TemplateSchedulerTickResult = {
    evaluatedTemplates: templates.length,
    dueTemplates: 0,
    skippedExistingRuns: 0,
    startedRuns: 0,
    blockedRuns: 0,
    failedRuns: 0
  }

  for (const template of templates) {
    const dueTimestamp = resolveLatestDueOccurrenceTimestamp(template, nowMs)
    if (!dueTimestamp) {
      continue
    }

    result.dueTemplates += 1
    const outcome = processDueTemplateSchedule(template, dueTimestamp, nowMs)
    if (outcome === "skipped") {
      result.skippedExistingRuns += 1
    } else if (outcome === "started") {
      result.startedRuns += 1
    } else if (outcome === "blocked") {
      result.blockedRuns += 1
    } else {
      result.failedRuns += 1
    }
  }

  return result
}

export function startTemplateScheduler(
  intervalMs: number = DEFAULT_TEMPLATE_SCHEDULER_INTERVAL_MS
): void {
  if (schedulerTimer) {
    return
  }

  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 30_000

  const tick = () => {
    if (schedulerTickInFlight) {
      return
    }
    schedulerTickInFlight = true
    try {
      const result = runTemplateSchedulerTick(Date.now())
      if (result.dueTemplates > 0) {
        console.info(
          `[TemplateScheduler] Tick complete: started=${result.startedRuns}, blocked=${result.blockedRuns}, failed=${result.failedRuns}, skipped=${result.skippedExistingRuns}.`
        )
      }
    } catch (error) {
      console.error("[TemplateScheduler] Tick failed.", error)
    } finally {
      schedulerTickInFlight = false
    }
  }

  tick()
  schedulerTimer = setInterval(tick, safeIntervalMs)
}

export function stopTemplateScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}
