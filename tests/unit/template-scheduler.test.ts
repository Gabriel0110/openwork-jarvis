import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Thread, WorkflowTemplate } from "../../src/main/types"

const {
  listAllWorkflowTemplatesMock,
  createTemplateScheduleRunAttemptMock,
  updateTemplateScheduleRunMock,
  createTimelineEventMock,
  createThreadMock,
  getThreadMock,
  updateThreadMock,
  executeWorkflowTemplateMock,
  getNextTemplateScheduleRunTimestampMock
} = vi.hoisted(() => ({
  listAllWorkflowTemplatesMock: vi.fn(),
  createTemplateScheduleRunAttemptMock: vi.fn(),
  updateTemplateScheduleRunMock: vi.fn(),
  createTimelineEventMock: vi.fn(),
  createThreadMock: vi.fn(),
  getThreadMock: vi.fn(),
  updateThreadMock: vi.fn(),
  executeWorkflowTemplateMock: vi.fn(),
  getNextTemplateScheduleRunTimestampMock: vi.fn()
}))

vi.mock("../../src/main/db/templates", () => ({
  listAllWorkflowTemplates: listAllWorkflowTemplatesMock
}))

vi.mock("../../src/main/db/template-schedule-runs", () => ({
  createTemplateScheduleRunAttempt: createTemplateScheduleRunAttemptMock,
  updateTemplateScheduleRun: updateTemplateScheduleRunMock
}))

vi.mock("../../src/main/db/timeline-events", () => ({
  createTimelineEvent: createTimelineEventMock
}))

vi.mock("../../src/main/db/index", () => ({
  createThread: createThreadMock,
  getThread: getThreadMock,
  updateThread: updateThreadMock
}))

vi.mock("../../src/main/services/template-runner", () => ({
  executeWorkflowTemplate: executeWorkflowTemplateMock
}))

vi.mock("../../src/shared/template-schedule-preview", () => ({
  getNextTemplateScheduleRunTimestamp: getNextTemplateScheduleRunTimestampMock
}))

import { runTemplateSchedulerTick } from "../../src/main/services/template-scheduler"

function buildTemplate(overrides?: Partial<WorkflowTemplate>): WorkflowTemplate {
  return {
    id: "tpl-1",
    workspaceId: "default-workspace",
    name: "Morning Sync",
    description: "sync",
    starterPrompts: [],
    agentIds: [],
    requiredConnectorKeys: [],
    expectedArtifacts: [],
    defaultSpeakerType: "orchestrator",
    policyDefaults: [],
    memoryDefaults: {},
    schedule: {
      enabled: true,
      rrule: "FREQ=HOURLY;INTERVAL=1",
      timezone: "UTC"
    },
    triggers: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }
}

function buildThread(overrides?: Partial<Thread>): Thread {
  return {
    thread_id: "run-thread-1",
    created_at: new Date(),
    updated_at: new Date(),
    status: "idle",
    ...overrides
  }
}

describe("runTemplateSchedulerTick", () => {
  const nowMs = Date.UTC(2026, 1, 16, 15, 30, 0)
  const dueAt = Date.UTC(2026, 1, 16, 15, 0, 0)

  beforeEach(() => {
    listAllWorkflowTemplatesMock.mockReset()
    createTemplateScheduleRunAttemptMock.mockReset()
    updateTemplateScheduleRunMock.mockReset()
    createTimelineEventMock.mockReset()
    createThreadMock.mockReset()
    getThreadMock.mockReset()
    updateThreadMock.mockReset()
    executeWorkflowTemplateMock.mockReset()
    getNextTemplateScheduleRunTimestampMock.mockReset()

    listAllWorkflowTemplatesMock.mockReturnValue([buildTemplate()])
    getThreadMock.mockReturnValue(null)
    createTimelineEventMock.mockImplementation(
      (input: { dedupeKey?: string; threadId: string }) => ({
        id: input.dedupeKey || `evt-${input.threadId}`
      })
    )
    getNextTemplateScheduleRunTimestampMock.mockImplementation(
      (_rrule: string, _timezone: string, cursor: number) => (cursor < dueAt ? dueAt : null)
    )
  })

  it("starts due scheduled template runs and emits audit + run timeline events", () => {
    createTemplateScheduleRunAttemptMock.mockReturnValue({
      inserted: true,
      run: {
        id: "sched-run-1",
        status: "pending",
        updatedAt: new Date(nowMs - 30_000)
      }
    })
    executeWorkflowTemplateMock.mockReturnValue({
      status: "started",
      thread: buildThread(),
      appliedPolicies: 2,
      seededMemoryEntries: 1
    })

    const result = runTemplateSchedulerTick(nowMs)

    expect(result.startedRuns).toBe(1)
    expect(result.blockedRuns).toBe(0)
    expect(result.failedRuns).toBe(0)
    expect(updateTemplateScheduleRunMock).toHaveBeenCalledWith(
      "sched-run-1",
      expect.objectContaining({
        status: "started",
        runThreadId: "run-thread-1"
      })
    )
    expect(createTimelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "template:schedule",
        eventType: "tool_call"
      })
    )
    expect(createTimelineEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "template:run",
        eventType: "tool_call",
        threadId: "run-thread-1"
      })
    )
  })

  it("records blocked runs when required connectors are missing", () => {
    createTemplateScheduleRunAttemptMock.mockReturnValue({
      inserted: true,
      run: {
        id: "sched-run-2",
        status: "pending",
        updatedAt: new Date(nowMs - 30_000)
      }
    })
    executeWorkflowTemplateMock.mockReturnValue({
      status: "blocked",
      missingConnectors: ["github"],
      appliedPolicies: 0,
      seededMemoryEntries: 0
    })

    const result = runTemplateSchedulerTick(nowMs)

    expect(result.startedRuns).toBe(0)
    expect(result.blockedRuns).toBe(1)
    expect(updateTemplateScheduleRunMock).toHaveBeenCalledWith(
      "sched-run-2",
      expect.objectContaining({
        status: "blocked",
        missingConnectors: ["github"]
      })
    )
    expect(createTimelineEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "template:run",
        threadId: "run-thread-1"
      })
    )
  })

  it("skips existing non-pending schedule runs", () => {
    createTemplateScheduleRunAttemptMock.mockReturnValue({
      inserted: false,
      run: {
        id: "sched-run-3",
        status: "started",
        updatedAt: new Date(nowMs - 30_000)
      }
    })

    const result = runTemplateSchedulerTick(nowMs)

    expect(result.dueTemplates).toBe(1)
    expect(result.skippedExistingRuns).toBe(1)
    expect(result.startedRuns).toBe(0)
    expect(executeWorkflowTemplateMock).not.toHaveBeenCalled()
  })
})
