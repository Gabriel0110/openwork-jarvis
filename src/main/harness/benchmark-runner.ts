import { randomUUID } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { HumanMessage } from "@langchain/core/messages"
import { closeCheckpointer, createAgentRuntime } from "../agent/runtime"
import { getLatestApprovedHarnessPromotion } from "../db/harness-experiments"
import {
  createHarnessArtifact,
  createHarnessRun,
  createHarnessTaskResult,
  getHarnessRun,
  listHarnessArtifacts,
  listHarnessRuns,
  listHarnessTaskResults,
  updateHarnessRun
} from "../db/harness-runs"
import { createTimelineEvent, listTimelineEventsByThread } from "../db/timeline-events"
import { DEFAULT_WORKSPACE_ID, getWorkspace } from "../db/workspaces"
import { deleteThreadCheckpoint, getOpenworkDir } from "../storage"
import type {
  HarnessStopReason,
  HarnessProfileSpec,
  HarnessRun,
  HarnessRunVariantConfig,
  HarnessRunStartParams,
  HarnessScoreBreakdown,
  HarnessTaskResult,
  HarnessTaskSpec
} from "../types"
import { getHarnessSuite, listHarnessSuites, resolveHarnessProfile } from "./benchmark-loader"
import { scoreHarnessTask, summarizeRunScores } from "./scoring"

interface ActiveHarnessRun {
  cancelled: boolean
  startedAt: number
  workspacePath: string
  workspaceId: string
}

const activeHarnessRuns = new Map<string, ActiveHarnessRun>()

type HarnessScoreKey =
  | "correctness"
  | "completeness"
  | "safetyCompliance"
  | "efficiency"
  | "toolHygiene"
type HarnessScoreDelta = Partial<Record<HarnessScoreKey, number>>

interface VariantExecutionConfig {
  effectiveBudgets: HarnessProfileSpec["budgets"]
  toolCallScale: number
  durationScale: number
  scoreDelta: HarnessScoreDelta
  notes: string[]
}

interface TaskRuntimeExecution {
  durationMs: number
  toolCalls: number
  tokenUsage: number
  costUsd: number
  notes: string[]
  stopReason: HarnessStopReason
  threadId?: string
}

const WORKSPACE_COPY_IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "out",
  "coverage",
  ".playwright"
])
const MAX_ASSISTANT_OUTPUT_CHARS = 12_000

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, value))
}

function clampScale(value: number, min = 0.5, max = 1.8): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.max(min, Math.min(max, value))
}

function asFinitePositive(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value
  }
  return undefined
}

function reweightScore(
  profile: HarnessProfileSpec,
  dimensions: Omit<HarnessScoreBreakdown, "weightedTotal">
): HarnessScoreBreakdown {
  const weightedTotal = clampScore(
    dimensions.correctness * profile.weights.correctness +
      dimensions.completeness * profile.weights.completeness +
      dimensions.safetyCompliance * profile.weights.safetyCompliance +
      dimensions.efficiency * profile.weights.efficiency +
      dimensions.toolHygiene * profile.weights.toolHygiene
  )
  return { ...dimensions, weightedTotal }
}

function applyScoreDelta(
  profile: HarnessProfileSpec,
  breakdown: HarnessScoreBreakdown,
  deltas: HarnessScoreDelta
): HarnessScoreBreakdown {
  const adjusted = {
    correctness: clampScore(breakdown.correctness + (deltas.correctness || 0)),
    completeness: clampScore(breakdown.completeness + (deltas.completeness || 0)),
    safetyCompliance: clampScore(breakdown.safetyCompliance + (deltas.safetyCompliance || 0)),
    efficiency: clampScore(breakdown.efficiency + (deltas.efficiency || 0)),
    toolHygiene: clampScore(breakdown.toolHygiene + (deltas.toolHygiene || 0))
  }
  return reweightScore(profile, adjusted)
}

function resolveTaskBudgets(
  task: HarnessTaskSpec,
  profile: HarnessProfileSpec,
  variantConfig?: HarnessRunVariantConfig
): HarnessProfileSpec["budgets"] {
  const budgetOverrides = variantConfig?.budget
  return {
    maxDurationMs:
      asFinitePositive(budgetOverrides?.maxDurationMs) ??
      asFinitePositive(task.maxDurationMs) ??
      profile.budgets.maxDurationMs,
    maxToolCalls:
      asFinitePositive(budgetOverrides?.maxToolCalls) ??
      asFinitePositive(task.maxToolCalls) ??
      profile.budgets.maxToolCalls,
    maxTokens:
      asFinitePositive(budgetOverrides?.maxTokens) ??
      asFinitePositive(task.maxTokens) ??
      profile.budgets.maxTokens
  }
}

function resolvePromotedVariantConfig(
  suiteKey: string,
  explicit?: HarnessRunVariantConfig
): HarnessRunVariantConfig | undefined {
  if (explicit) {
    return explicit
  }
  const promoted = getLatestApprovedHarnessPromotion(suiteKey)
  if (!promoted) {
    return undefined
  }
  const config = promoted.config
  const budgetConfig =
    config.budget && typeof config.budget === "object" && !Array.isArray(config.budget)
      ? (config.budget as Record<string, unknown>)
      : {}

  return {
    variantKey: promoted.variantKey,
    variantLabel: `${promoted.variantLabel} (promoted)`,
    promptPatch: asString(config.promptPatch),
    middleware:
      config.middleware &&
      typeof config.middleware === "object" &&
      !Array.isArray(config.middleware)
        ? (config.middleware as Record<string, unknown>)
        : undefined,
    budget: {
      maxDurationMs: asFinitePositive(budgetConfig.maxDurationMs),
      maxToolCalls: asFinitePositive(budgetConfig.maxToolCalls),
      maxTokens: asFinitePositive(budgetConfig.maxTokens)
    }
  }
}

function deriveVariantExecutionConfig(
  task: HarnessTaskSpec,
  profile: HarnessProfileSpec,
  variantConfig?: HarnessRunVariantConfig
): VariantExecutionConfig {
  const scoreDelta: HarnessScoreDelta = {}
  const notes: string[] = []
  const effectiveBudgets = resolveTaskBudgets(task, profile, variantConfig)
  let toolCallScale = 1
  let durationScale = 1

  const promptPatch = variantConfig?.promptPatch?.trim()
  if (promptPatch) {
    notes.push(`Variant prompt patch applied (${promptPatch.slice(0, 120)}).`)
    const loweredPatch = promptPatch.toLowerCase()
    if (loweredPatch.includes("output contract")) {
      scoreDelta.correctness = (scoreDelta.correctness || 0) + 2
      scoreDelta.completeness = (scoreDelta.completeness || 0) + 5
    }
    if (loweredPatch.includes("verification") || loweredPatch.includes("checklist")) {
      scoreDelta.completeness = (scoreDelta.completeness || 0) + 2
      scoreDelta.safetyCompliance = (scoreDelta.safetyCompliance || 0) + 3
    }
    durationScale *= 1.03
  }

  const middleware = variantConfig?.middleware || {}
  const middlewareEntries = Object.entries(middleware)
  if (middlewareEntries.length > 0) {
    const middlewareNames = middlewareEntries.map(([key]) => key).join(", ")
    notes.push(`Variant middleware overrides: ${middlewareNames}.`)

    for (const [key, rawValue] of middlewareEntries) {
      const normalizedKey = key.toLowerCase()
      const boolValue = asBoolean(rawValue)
      if (normalizedKey.includes("loop")) {
        if (boolValue === false) {
          toolCallScale *= 1.2
          scoreDelta.toolHygiene = (scoreDelta.toolHygiene || 0) - 4
        } else {
          toolCallScale *= 0.88
          scoreDelta.toolHygiene = (scoreDelta.toolHygiene || 0) + 3
        }
      }
      if (normalizedKey.includes("precompletion") || normalizedKey.includes("checklist")) {
        if (boolValue === false) {
          scoreDelta.completeness = (scoreDelta.completeness || 0) - 5
          scoreDelta.safetyCompliance = (scoreDelta.safetyCompliance || 0) - 4
        } else {
          scoreDelta.completeness = (scoreDelta.completeness || 0) + 2
          scoreDelta.safetyCompliance = (scoreDelta.safetyCompliance || 0) + 2
        }
      }
      if (normalizedKey.includes("budget")) {
        scoreDelta.efficiency = (scoreDelta.efficiency || 0) + (boolValue === false ? -3 : 2)
      }
    }
  }

  const durationRatio = effectiveBudgets.maxDurationMs / Math.max(1, profile.budgets.maxDurationMs)
  if (durationRatio < 0.85) {
    durationScale *= 0.92
    scoreDelta.efficiency = (scoreDelta.efficiency || 0) - 3
    notes.push("Variant budget tightened max duration.")
  } else if (durationRatio > 1.2) {
    durationScale *= 1.08
    scoreDelta.efficiency = (scoreDelta.efficiency || 0) + 2
    notes.push("Variant budget relaxed max duration.")
  }

  const toolRatio = effectiveBudgets.maxToolCalls / Math.max(1, profile.budgets.maxToolCalls)
  if (toolRatio < 0.9) {
    toolCallScale *= 0.9
    scoreDelta.toolHygiene = (scoreDelta.toolHygiene || 0) + 2
  } else if (toolRatio > 1.15) {
    toolCallScale *= 1.1
    scoreDelta.toolHygiene = (scoreDelta.toolHygiene || 0) - 1
  }

  const tokenRatio = effectiveBudgets.maxTokens / Math.max(1, profile.budgets.maxTokens)
  if (tokenRatio < 0.85) {
    scoreDelta.completeness = (scoreDelta.completeness || 0) - 2
  } else if (tokenRatio > 1.2) {
    scoreDelta.completeness = (scoreDelta.completeness || 0) + 1
  }

  return {
    effectiveBudgets,
    toolCallScale: clampScale(toolCallScale),
    durationScale: clampScale(durationScale),
    scoreDelta,
    notes
  }
}

function resolveWorkspacePath(workspaceId: string, explicitPath?: string): string {
  if (explicitPath && explicitPath.trim().length > 0) {
    return explicitPath
  }
  const workspace = getWorkspace(workspaceId)
  if (workspace?.root_path && workspace.root_path.trim().length > 0) {
    return workspace.root_path.trim()
  }
  return process.cwd()
}

function shouldUseLiveHarnessExecution(): boolean {
  return String(process.env.HARNESS_SYNTHETIC_ONLY || "").toLowerCase() !== "true"
}

function shouldUseIsolatedWorkspace(): boolean {
  return String(process.env.HARNESS_ISOLATED_WORKSPACE || "true").toLowerCase() !== "false"
}

function resolveTaskExecutionMode(
  requestedMode?: HarnessRunStartParams["taskExecutionMode"]
): "live" | "synthetic" {
  if (requestedMode === "synthetic") {
    return "synthetic"
  }
  return shouldUseLiveHarnessExecution() ? "live" : "synthetic"
}

function buildHarnessWorkspaceCopyPath(runId: string): string {
  return join(getOpenworkDir(), "harness", "workspaces", runId)
}

function copyWorkspaceForHarness(sourceRoot: string, runId: string): string {
  const targetRoot = buildHarnessWorkspaceCopyPath(runId)
  mkdirSync(targetRoot, { recursive: true })
  cpSync(sourceRoot, targetRoot, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (source) => {
      if (source === sourceRoot) {
        return true
      }
      const rel = relative(sourceRoot, source)
      if (!rel || rel === "." || rel.startsWith(`..${sep}`)) {
        return true
      }
      const segments = rel.split(sep)
      return !segments.some((segment) => WORKSPACE_COPY_IGNORE_DIRS.has(segment))
    }
  })
  return targetRoot
}

function extractTextFromSerializedContent(content: unknown): string {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return ""
  }
  return content
    .filter(
      (item): item is { type: string; text?: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        typeof (item as { type: unknown }).type === "string"
    )
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join(" ")
}

function getStopReasonFromTimeline(taskThreadId: string): HarnessStopReason | undefined {
  const events = listTimelineEventsByThread(taskThreadId, 120)
  for (const event of events) {
    if (event.toolName !== "runtime:stop_reason") {
      continue
    }
    const stopReason = event.payload?.stopReason
    if (typeof stopReason === "string") {
      return stopReason as HarnessStopReason
    }
  }
  return undefined
}

function createTaskThreadId(runId: string, taskKey: string): string {
  return `harness-${runId.slice(0, 8)}-${taskKey}-${randomUUID().slice(0, 8)}`
}

async function executeTaskLive(params: {
  runId: string
  workspaceId: string
  workspacePath: string
  task: HarnessTaskSpec
  taskPrompt: string
  modelId?: string
  maxDurationMs: number
}): Promise<TaskRuntimeExecution> {
  const taskThreadId = createTaskThreadId(params.runId, params.task.key)
  const startedAt = Date.now()
  const timeoutMs = Math.max(15_000, params.maxDurationMs)
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  let toolCalls = 0
  let tokenUsage = 0
  let blockedOnApproval = false
  const liveNotes: string[] = []
  let assistantOutput = ""

  try {
    const agent = await createAgentRuntime({
      threadId: taskThreadId,
      workspacePath: params.workspacePath,
      workspaceId: params.workspaceId,
      modelId: params.modelId
    })

    const stream = await agent.stream(
      {
        messages: [new HumanMessage(params.taskPrompt)]
      },
      {
        configurable: { thread_id: taskThreadId },
        signal: abortController.signal,
        streamMode: ["messages", "values"],
        recursionLimit: 1000
      }
    )

    for await (const chunk of stream) {
      const [mode, data] = chunk as [string, unknown]

      if (mode === "messages") {
        const tuple = data as [Record<string, unknown>, unknown]
        const chunkPayload = tuple?.[0] || {}
        const chunkId = Array.isArray(chunkPayload.id) ? chunkPayload.id : []
        const className = String(chunkId[chunkId.length - 1] || "")
        const kwargs =
          chunkPayload && typeof chunkPayload.kwargs === "object" && chunkPayload.kwargs
            ? (chunkPayload.kwargs as Record<string, unknown>)
            : {}

        if (className.includes("AI")) {
          const toolCallEntries = Array.isArray(kwargs.tool_calls)
            ? (kwargs.tool_calls as Array<Record<string, unknown>>)
            : []
          for (const toolCall of toolCallEntries) {
            const toolName = typeof toolCall.name === "string" ? toolCall.name : "tool"
            toolCalls += 1
            createTimelineEvent({
              threadId: params.runId,
              workspaceId: params.workspaceId,
              eventType: "tool_call",
              toolName,
              summary: `[Harness] ${params.task.name} called ${toolName}.`,
              payload: {
                harnessRunId: params.runId,
                taskKey: params.task.key,
                taskThreadId,
                toolCallId: toolCall.id
              }
            })
          }
          const text = extractTextFromSerializedContent(kwargs.content)
          if (text.length > 0) {
            assistantOutput = `${assistantOutput}${text}`.slice(-MAX_ASSISTANT_OUTPUT_CHARS)
            tokenUsage += Math.max(1, Math.round(text.length / 4))
          }
        }

        if (className.includes("ToolMessage")) {
          const toolName = typeof kwargs.name === "string" ? kwargs.name : "tool"
          const text = extractTextFromSerializedContent(kwargs.content)
          if (text.length > 0) {
            tokenUsage += Math.max(1, Math.round(text.length / 8))
          }
          createTimelineEvent({
            threadId: params.runId,
            workspaceId: params.workspaceId,
            eventType: "tool_result",
            toolName,
            summary: `[Harness] ${params.task.name} tool result from ${toolName}.`,
            payload: {
              harnessRunId: params.runId,
              taskKey: params.task.key,
              taskThreadId,
              toolCallId: kwargs.tool_call_id
            }
          })
        }
      } else if (mode === "values") {
        const state =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : {}
        const interrupts = Array.isArray(state.__interrupt__)
          ? (state.__interrupt__ as Array<Record<string, unknown>>)
          : []
        for (const interrupt of interrupts) {
          const value =
            interrupt && typeof interrupt.value === "object" && interrupt.value
              ? (interrupt.value as Record<string, unknown>)
              : {}
          const actionRequests = Array.isArray(value.actionRequests)
            ? (value.actionRequests as Array<Record<string, unknown>>)
            : []
          if (actionRequests.length > 0) {
            blockedOnApproval = true
            liveNotes.push("Agent requested approval during harness execution.")
          }
        }
      }
    }

    const stopReason = getStopReasonFromTimeline(taskThreadId)
    createHarnessArtifact({
      runId: params.runId,
      taskKey: params.task.key,
      artifactType: "assistant_output",
      payload: {
        threadId: taskThreadId,
        output: assistantOutput,
        truncated: assistantOutput.length >= MAX_ASSISTANT_OUTPUT_CHARS
      }
    })

    const durationMs = Date.now() - startedAt
    return {
      durationMs,
      toolCalls: Math.max(toolCalls, 1),
      tokenUsage: Math.max(tokenUsage, 1),
      costUsd: Number(
        (Math.max(tokenUsage, 1) * 0.000002 + Math.max(toolCalls, 1) * 0.0004).toFixed(6)
      ),
      notes: liveNotes,
      stopReason: stopReason || (blockedOnApproval ? "blocked_on_approval" : "completed"),
      threadId: taskThreadId
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const durationMs = Date.now() - startedAt
    let stopReason: HarnessStopReason = "internal_error"
    if (abortController.signal.aborted) {
      stopReason = "timeout"
      liveNotes.push(`Live execution timeout after ${timeoutMs}ms.`)
    } else if (message.toLowerCase().includes("approval")) {
      stopReason = "blocked_on_approval"
    } else if (message.toLowerCase().includes("policy")) {
      stopReason = "policy_denied"
    } else if (message.toLowerCase().includes("tool")) {
      stopReason = "tool_failure"
    }
    liveNotes.push(`Live execution error: ${message}`)
    return {
      durationMs,
      toolCalls: Math.max(toolCalls, 1),
      tokenUsage: Math.max(tokenUsage, 1),
      costUsd: Number(
        (Math.max(tokenUsage, 1) * 0.000002 + Math.max(toolCalls, 1) * 0.0004).toFixed(6)
      ),
      notes: liveNotes,
      stopReason,
      threadId: taskThreadId
    }
  } finally {
    clearTimeout(timeout)
    await closeCheckpointer(taskThreadId)
    deleteThreadCheckpoint(taskThreadId)
  }
}

function computeTaskNotes(task: HarnessTaskSpec, workspacePath: string): string {
  const missingRequired: string[] = []
  for (const artifact of task.expectedArtifacts || []) {
    if (artifact.required === false) {
      continue
    }
    const artifactPath = resolve(workspacePath, artifact.path)
    if (!existsSync(artifactPath)) {
      missingRequired.push(artifact.path)
      continue
    }
    if ((artifact.mustContain || []).length > 0) {
      try {
        const content = readFileSync(artifactPath, "utf-8")
        const missingToken = artifact.mustContain?.find((token) => !content.includes(token))
        if (missingToken) {
          missingRequired.push(`${artifact.path} (missing token: ${missingToken})`)
        }
      } catch {
        missingRequired.push(`${artifact.path} (failed to read)`)
      }
    }
  }
  if (missingRequired.length === 0) {
    return "Output contract satisfied."
  }
  return `Missing expected outputs: ${missingRequired.join(", ")}.`
}

async function executeHarnessRun(
  runId: string,
  workspaceId: string,
  workspacePath: string,
  params: HarnessRunStartParams
): Promise<void> {
  const active = activeHarnessRuns.get(runId)
  if (!active) {
    return
  }

  const runStart = Date.now()
  const suite = getHarnessSuite(params.suiteKey)
  const profile = resolveHarnessProfile(params.profileKey)
  const taskExecutionMode = resolveTaskExecutionMode(params.taskExecutionMode)
  const liveExecutionEnabled = taskExecutionMode === "live"
  const isolatedWorkspaceEnabled = shouldUseIsolatedWorkspace()
  let executionWorkspacePath = workspacePath
  if (liveExecutionEnabled && isolatedWorkspaceEnabled) {
    executionWorkspacePath = copyWorkspaceForHarness(workspacePath, runId)
  }
  updateHarnessRun(runId, {
    status: "running",
    startedAt: runStart
  })

  createTimelineEvent({
    threadId: runId,
    workspaceId,
    eventType: "tool_call",
    toolName: "harness:run",
    summary: `Started harness suite ${suite.key}.`,
    payload: {
      harnessRunId: runId,
      suiteKey: suite.key,
      profileKey: profile.key,
      variantConfig: params.variantConfig || null,
      taskExecutionMode,
      liveExecutionEnabled,
      isolatedWorkspaceEnabled,
      executionWorkspacePath
    }
  })

  const taskResults: HarnessTaskResult[] = []

  for (const task of suite.tasks) {
    if (active.cancelled) {
      break
    }

    const variantExecutionConfig = deriveVariantExecutionConfig(task, profile, params.variantConfig)
    const taskPrompt = params.variantConfig?.promptPatch
      ? `${task.prompt}\n\n[Variant instructions]\n${params.variantConfig.promptPatch}`
      : task.prompt
    let runtimeExecution: TaskRuntimeExecution

    if (liveExecutionEnabled) {
      runtimeExecution = await executeTaskLive({
        runId,
        workspaceId,
        workspacePath: executionWorkspacePath,
        task,
        taskPrompt,
        modelId: params.modelId || profile.modelId,
        maxDurationMs: variantExecutionConfig.effectiveBudgets.maxDurationMs
      })
    } else {
      const baseToolCalls =
        Math.max(1, (task.expectedArtifacts || []).length * 2) +
        (task.tier === "hard" ? 3 : task.tier === "medium" ? 2 : 1)
      const toolCalls = Math.max(
        1,
        Math.round(baseToolCalls * variantExecutionConfig.toolCallScale)
      )
      const syntheticDurationBase =
        250 +
        task.prompt.length * 10 +
        ((task.expectedArtifacts || []).length + 1) * 180 +
        (task.tier === "hard" ? 1100 : task.tier === "medium" ? 600 : 250)
      const durationMs = Math.max(
        120,
        Math.round(syntheticDurationBase * variantExecutionConfig.durationScale)
      )
      runtimeExecution = {
        durationMs,
        toolCalls,
        tokenUsage: Math.round(toolCalls * 180),
        costUsd: Number((toolCalls * 0.0006).toFixed(6)),
        notes: [`Synthetic task execution mode (${taskExecutionMode}).`],
        stopReason: "completed"
      }
    }

    const notesParts = [
      computeTaskNotes(task, executionWorkspacePath),
      ...variantExecutionConfig.notes,
      ...runtimeExecution.notes,
      params.variantConfig?.variantLabel
        ? `Experiment variant: ${params.variantConfig.variantLabel}.`
        : undefined
    ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    const notes = notesParts.join(" ")

    const scoringTask: HarnessTaskSpec = {
      ...task,
      maxDurationMs: variantExecutionConfig.effectiveBudgets.maxDurationMs,
      maxToolCalls: variantExecutionConfig.effectiveBudgets.maxToolCalls,
      maxTokens: variantExecutionConfig.effectiveBudgets.maxTokens
    }

    const rawScoreBreakdown = scoreHarnessTask({
      task: scoringTask,
      profile,
      workspacePath: executionWorkspacePath,
      durationMs: runtimeExecution.durationMs,
      toolCalls: runtimeExecution.toolCalls,
      notes
    })
    const scoreBreakdown = applyScoreDelta(
      profile,
      rawScoreBreakdown,
      variantExecutionConfig.scoreDelta
    )

    const status =
      runtimeExecution.stopReason === "blocked_on_approval"
        ? "failed"
        : scoreBreakdown.weightedTotal >= 70
          ? "passed"
          : "failed"
    const stopReason: HarnessStopReason =
      runtimeExecution.stopReason && runtimeExecution.stopReason !== "completed"
        ? runtimeExecution.stopReason
        : status === "failed"
          ? notes.includes("Missing expected outputs")
            ? "tool_failure"
            : "internal_error"
          : "completed"

    const result = createHarnessTaskResult({
      runId,
      taskKey: task.key,
      taskName: task.name,
      taskTier: task.tier,
      status,
      threadId: runtimeExecution.threadId,
      scoreTotal: scoreBreakdown.weightedTotal,
      scoreBreakdown,
      durationMs: runtimeExecution.durationMs,
      tokenUsage: runtimeExecution.tokenUsage,
      toolCalls: runtimeExecution.toolCalls,
      costUsd: runtimeExecution.costUsd,
      stopReason,
      notes
    })
    taskResults.push(result)

    for (const artifact of task.expectedArtifacts || []) {
      const artifactPath = resolve(executionWorkspacePath, artifact.path)
      const exists = existsSync(artifactPath)
      createHarnessArtifact({
        runId,
        taskKey: task.key,
        artifactType: "expected_output",
        artifactPath,
        payload: {
          relativePath: artifact.path,
          required: artifact.required !== false,
          mustContain: artifact.mustContain || [],
          exists,
          executionWorkspacePath,
          variantKey: params.variantConfig?.variantKey,
          variantLabel: params.variantConfig?.variantLabel
        }
      })
    }

    createTimelineEvent({
      threadId: runId,
      workspaceId,
      eventType: "tool_result",
      toolName: "harness:task",
      summary: `${task.name}: ${status} (${scoreBreakdown.weightedTotal.toFixed(1)})`,
      payload: {
        harnessRunId: runId,
        taskKey: task.key,
        taskThreadId: runtimeExecution.threadId,
        status,
        score: scoreBreakdown.weightedTotal,
        stopReason
      }
    })
  }

  const now = Date.now()
  const summaryScores = summarizeRunScores(taskResults)
  const stopReasons = taskResults.reduce<Record<string, number>>((acc, taskResult) => {
    const key = taskResult.stopReason || "unknown"
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const passedCount = taskResults.filter((result) => result.status === "passed").length
  const failedCount = taskResults.filter((result) => result.status === "failed").length
  const status = active.cancelled ? "cancelled" : failedCount > 0 ? "failed" : "completed"

  updateHarnessRun(runId, {
    status,
    completedAt: now,
    durationMs: now - runStart,
    summary: {
      taskCount: taskResults.length,
      passedCount,
      failedCount,
      averageScore: summaryScores.averageScore,
      scoreByTier: summaryScores.scoreByTier,
      stopReasons
    },
    errorText: status === "cancelled" ? "Cancelled by operator." : null
  })

  createTimelineEvent({
    threadId: runId,
    workspaceId,
    eventType: status === "completed" ? "tool_result" : "error",
    toolName: "harness:run",
    summary: `Harness run ${status} (${summaryScores.averageScore.toFixed(1)} avg).`,
    payload: {
      harnessRunId: runId,
      status,
      averageScore: summaryScores.averageScore,
      taskCount: taskResults.length
    }
  })
}

export async function startHarnessRun(params: HarnessRunStartParams): Promise<HarnessRun> {
  if (!params.suiteKey || params.suiteKey.trim().length === 0) {
    throw new Error("suiteKey is required.")
  }

  const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
  const workspacePath = resolveWorkspacePath(workspaceId, params.workspacePath)
  const suite = getHarnessSuite(params.suiteKey)
  const profile = resolveHarnessProfile(params.profileKey)
  const effectiveVariantConfig = resolvePromotedVariantConfig(suite.key, params.variantConfig)
  const effectiveTaskExecutionMode = resolveTaskExecutionMode(params.taskExecutionMode)
  const effectiveParams: HarnessRunStartParams = {
    ...params,
    variantConfig: effectiveVariantConfig,
    taskExecutionMode: effectiveTaskExecutionMode
  }

  const run = createHarnessRun({
    workspaceId,
    suiteKey: suite.key,
    suiteName: suite.name,
    profileKey: profile.key,
    modelProfile: params.modelId || profile.modelId,
    executionMode: params.executionMode || effectiveTaskExecutionMode,
    seed: params.seed,
    status: "queued"
  })

  activeHarnessRuns.set(run.id, {
    cancelled: false,
    startedAt: Date.now(),
    workspaceId,
    workspacePath
  })

  if (effectiveVariantConfig && !params.variantConfig) {
    createTimelineEvent({
      threadId: run.id,
      workspaceId,
      eventType: "tool_call",
      toolName: "harness:promotion",
      summary: `Applied promoted variant ${effectiveVariantConfig.variantLabel || effectiveVariantConfig.variantKey || "variant"}.`,
      payload: {
        harnessRunId: run.id,
        suiteKey: suite.key,
        variantKey: effectiveVariantConfig.variantKey,
        variantLabel: effectiveVariantConfig.variantLabel
      }
    })
  }

  void executeHarnessRun(run.id, workspaceId, workspacePath, effectiveParams)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      updateHarnessRun(run.id, {
        status: "failed",
        completedAt: Date.now(),
        errorText: message
      })
    })
    .finally(() => {
      activeHarnessRuns.delete(run.id)
    })

  return getHarnessRun(run.id) as HarnessRun
}

export function listAvailableHarnessSuites() {
  return listHarnessSuites()
}

export function listHarnessRunRecords(filters?: {
  status?: HarnessRun["status"]
  suiteKey?: string
  workspaceId?: string
  limit?: number
}): HarnessRun[] {
  return listHarnessRuns(filters)
}

export function getHarnessRunDetail(runId: string): {
  run: HarnessRun
  tasks: HarnessTaskResult[]
  artifacts: ReturnType<typeof listHarnessArtifacts>
} | null {
  const run = getHarnessRun(runId)
  if (!run) {
    return null
  }
  return {
    run,
    tasks: listHarnessTaskResults(runId),
    artifacts: listHarnessArtifacts(runId)
  }
}

export function cancelHarnessRun(runId: string): HarnessRun | null {
  const active = activeHarnessRuns.get(runId)
  if (!active) {
    const existing = getHarnessRun(runId)
    if (!existing) {
      return null
    }
    if (existing.status === "queued" || existing.status === "running") {
      return updateHarnessRun(runId, {
        status: "cancelled",
        completedAt: Date.now(),
        errorText: "Cancelled by operator."
      })
    }
    return existing
  }

  active.cancelled = true
  updateHarnessRun(runId, {
    status: "cancelled",
    completedAt: Date.now(),
    durationMs: Date.now() - active.startedAt,
    errorText: "Cancellation requested by operator."
  })
  return getHarnessRun(runId)
}
