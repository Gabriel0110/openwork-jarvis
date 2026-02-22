import { IpcMain, IpcMainEvent, IpcMainInvokeEvent, BrowserWindow } from "electron"
import { HumanMessage } from "@langchain/core/messages"
import { Command, type StreamMode } from "@langchain/langgraph"
import { createAgentRuntime } from "../agent/runtime"
import { getThread, updateThread } from "../db"
import { getAgent, listAgents } from "../db/agents"
import { getToolByName } from "../db/tools"
import { createTimelineEvent } from "../db/timeline-events"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import { getZeroClawManager } from "../zeroclaw/manager"
import { streamZeroClawWebhook } from "../zeroclaw/webhook-stream"
import {
  extractUrlsFromArgs,
  inferConnectorInvocation,
  isFilesystemToolName,
  mapToolNameToAction,
  resolvePolicyDecision
} from "../services/policy-engine"
import { grantPolicySessionAccess } from "../services/policy-session"
import { normalizeAgentSkillMode } from "../services/skills-registry"
import type {
  AgentInvokeParams,
  AgentResumeParams,
  AgentSkillMode,
  AgentInterruptParams,
  AgentCancelParams,
  TimelineEventType
} from "../types"

interface ResolvedSpeaker {
  id?: string
  type: "orchestrator" | "agent"
  name: string
  role: string
  systemPrompt: string
  modelName?: string
  connectorAllowlist?: string[]
  skillMode?: AgentSkillMode
  skillsAllowlist?: string[]
}

interface SerializedMessageChunk {
  id?: string[]
  kwargs?: {
    id?: string
    content?: string | Array<{ type: string; text?: string }>
    name?: string
    tool_call_id?: string
    tool_calls?: Array<{
      id?: string
      name?: string
      args?: Record<string, unknown>
    }>
  }
}

type SerializedMessageContent = string | Array<{ type: string; text?: string }>

interface SerializedValuesState {
  __interrupt__?: Array<{
    value?: {
      actionRequests?: Array<{
        id?: string
        name?: string
        args?: Record<string, unknown>
      }>
    }
  }>
}

interface PersistedThreadMessage {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  created_at: string
  tool_call_id?: string
  name?: string
}

const subagentTargetByThread = new Map<string, Map<string, string | undefined>>()
const MAX_PERSISTED_THREAD_MESSAGES = 1000

function trimSummary(summary: string, maxLength: number = 180): string {
  if (summary.length <= maxLength) {
    return summary
  }
  return `${summary.slice(0, maxLength - 3)}...`
}

function extractTextContent(content: SerializedMessageContent | undefined): string {
  if (typeof content === "string") {
    return content
  }
  if (!Array.isArray(content)) {
    return ""
  }
  return content
    .filter((part): part is { type: "text"; text: string } => {
      return part.type === "text" && typeof part.text === "string"
    })
    .map((part) => part.text)
    .join(" ")
}

function summarizeToolArgs(args: Record<string, unknown> | undefined): string {
  const safeArgs = args || {}
  const command = safeArgs.command
  if (typeof command === "string" && command.trim().length > 0) {
    return command
  }

  const filePath = safeArgs.file_path
  if (typeof filePath === "string" && filePath.trim().length > 0) {
    return filePath
  }

  const description = safeArgs.description
  if (typeof description === "string" && description.trim().length > 0) {
    return description
  }

  try {
    return trimSummary(JSON.stringify(safeArgs))
  } catch {
    return ""
  }
}

function normalizeSubagentType(value: string | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function resolveSubagentTargetAgentId(
  workspaceId: string,
  subagentType: string
): string | undefined {
  const normalizedType = normalizeSubagentType(subagentType)
  if (!normalizedType) {
    return undefined
  }

  const match = listAgents(workspaceId).find((agent) => {
    const agentType = normalizeSubagentType(agent.name)
    return agentType === normalizedType
  })
  return match?.agent_id
}

function writeTimelineEventSafe(params: {
  threadId: string
  workspaceId: string
  eventType: TimelineEventType
  summary?: string
  dedupeKey?: string
  sourceAgentId?: string
  targetAgentId?: string
  toolName?: string
  payload?: Record<string, unknown>
}): void {
  try {
    createTimelineEvent({
      threadId: params.threadId,
      workspaceId: params.workspaceId,
      eventType: params.eventType,
      summary: params.summary,
      dedupeKey: params.dedupeKey,
      sourceAgentId: params.sourceAgentId,
      targetAgentId: params.targetAgentId,
      toolName: params.toolName,
      payload: params.payload
    })
  } catch (error) {
    console.warn("[Agent] Failed to persist timeline event.", error)
  }
}

function persistStreamTimelineEvents(params: {
  threadId: string
  workspaceId: string
  mode: string
  data: unknown
  speaker?: ResolvedSpeaker
}): void {
  if (params.mode === "messages") {
    const tuple = params.data as [SerializedMessageChunk, unknown]
    const chunk = tuple?.[0]
    const classId = Array.isArray(chunk?.id) ? chunk.id : []
    const className = classId[classId.length - 1] || ""
    const kwargs = chunk?.kwargs || {}

    if (className.includes("AI")) {
      const toolCalls = Array.isArray(kwargs.tool_calls) ? kwargs.tool_calls : []
      for (const toolCall of toolCalls) {
        if (!toolCall.id || !toolCall.name) {
          continue
        }

        if (toolCall.name === "task") {
          const subagentType = String(toolCall.args?.subagent_type || "")
          const targetAgentId = resolveSubagentTargetAgentId(params.workspaceId, subagentType)
          const threadTargets = subagentTargetByThread.get(params.threadId) || new Map()
          threadTargets.set(toolCall.id, targetAgentId)
          subagentTargetByThread.set(params.threadId, threadTargets)

          writeTimelineEventSafe({
            threadId: params.threadId,
            workspaceId: params.workspaceId,
            eventType: "subagent_started",
            sourceAgentId: params.speaker?.id,
            targetAgentId,
            toolName: "task",
            summary: trimSummary(String(toolCall.args?.description || "Delegated task")),
            dedupeKey: `${params.threadId}:subagent_started:${toolCall.id}`,
            payload: {
              toolCallId: toolCall.id,
              subagentType
            }
          })
        } else {
          writeTimelineEventSafe({
            threadId: params.threadId,
            workspaceId: params.workspaceId,
            eventType: "tool_call",
            sourceAgentId: params.speaker?.id,
            toolName: toolCall.name,
            summary: trimSummary(`${toolCall.name}: ${summarizeToolArgs(toolCall.args)}`),
            dedupeKey: `${params.threadId}:tool_call:${toolCall.id}`,
            payload: {
              toolCallId: toolCall.id,
              args: toolCall.args || {}
            }
          })
        }
      }
    }

    if (className.includes("ToolMessage") && typeof kwargs.tool_call_id === "string") {
      const toolName = typeof kwargs.name === "string" ? kwargs.name : "tool"
      const text = trimSummary(extractTextContent(kwargs.content))

      writeTimelineEventSafe({
        threadId: params.threadId,
        workspaceId: params.workspaceId,
        eventType: "tool_result",
        sourceAgentId: params.speaker?.id,
        toolName,
        summary: trimSummary(`${toolName}: ${text || "Tool result received"}`),
        dedupeKey: `${params.threadId}:tool_result:${kwargs.tool_call_id}`,
        payload: {
          toolCallId: kwargs.tool_call_id
        }
      })

      if (toolName === "task") {
        const targets = subagentTargetByThread.get(params.threadId)
        const targetAgentId = targets?.get(kwargs.tool_call_id)
        writeTimelineEventSafe({
          threadId: params.threadId,
          workspaceId: params.workspaceId,
          eventType: "subagent_completed",
          sourceAgentId: params.speaker?.id,
          targetAgentId,
          toolName: "task",
          summary: text || "Delegated task completed",
          dedupeKey: `${params.threadId}:subagent_completed:${kwargs.tool_call_id}`,
          payload: {
            toolCallId: kwargs.tool_call_id
          }
        })
        targets?.delete(kwargs.tool_call_id)
      }
    }

    return
  }

  if (params.mode === "values") {
    const state = params.data as SerializedValuesState
    const interrupt = Array.isArray(state.__interrupt__) ? state.__interrupt__ : []
    for (const interruptItem of interrupt) {
      const actionRequests = interruptItem?.value?.actionRequests
      if (!Array.isArray(actionRequests)) {
        continue
      }

      for (const request of actionRequests) {
        const actionName = request.name || "tool"
        const requestId = request.id || actionName
        writeTimelineEventSafe({
          threadId: params.threadId,
          workspaceId: params.workspaceId,
          eventType: "approval_required",
          sourceAgentId: params.speaker?.id,
          toolName: actionName,
          summary: `Approval required: ${actionName}`,
          dedupeKey: `${params.threadId}:approval:${requestId}`,
          payload: {
            requestId,
            args: request.args || {}
          }
        })
      }
    }
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

function parseThreadValues(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed thread_values payloads.
  }
  return {}
}

function appendPersistedThreadMessages(
  threadId: string,
  newMessages: PersistedThreadMessage[]
): void {
  if (newMessages.length === 0) {
    return
  }

  try {
    const thread = getThread(threadId)
    if (!thread) {
      return
    }

    const threadValues = parseThreadValues(thread.thread_values)
    const existingMessages = Array.isArray(threadValues.messages)
      ? (threadValues.messages as unknown[])
      : []
    const mergedMessages = [...existingMessages, ...newMessages].slice(
      -MAX_PERSISTED_THREAD_MESSAGES
    )

    updateThread(threadId, {
      thread_values: JSON.stringify({
        ...threadValues,
        messages: mergedMessages
      })
    })
  } catch (error) {
    console.warn("[Agent] Failed to persist thread message history.", error)
  }
}

function resolveSpeaker(
  workspaceId: string,
  speakerType?: "orchestrator" | "agent" | "zeroclaw",
  speakerAgentId?: string
): ResolvedSpeaker | undefined {
  if (speakerType === "agent" && speakerAgentId) {
    const agent = getAgent(speakerAgentId)
    if (!agent) {
      return undefined
    }

    return {
      id: agent.agent_id,
      type: "agent",
      name: agent.name,
      role: agent.role,
      systemPrompt: agent.system_prompt,
      modelName: agent.model_name,
      connectorAllowlist: parseStringArray(agent.connector_allowlist),
      skillMode: normalizeAgentSkillMode(agent.skill_mode),
      skillsAllowlist: parseStringArray(agent.skills_allowlist)
    }
  }

  const orchestrator = listAgents(workspaceId).find((agent) => agent.is_orchestrator === 1) || null
  if (!orchestrator) {
    return undefined
  }

  return {
    id: orchestrator.agent_id,
    type: "orchestrator",
    name: orchestrator.name,
    role: orchestrator.role,
    systemPrompt: orchestrator.system_prompt,
    modelName: orchestrator.model_name,
    connectorAllowlist: parseStringArray(orchestrator.connector_allowlist),
    skillMode: normalizeAgentSkillMode(orchestrator.skill_mode),
    skillsAllowlist: parseStringArray(orchestrator.skills_allowlist)
  }
}

const zeroClawPairTokensByDeployment = new Map<string, string>()

async function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new Error("Request aborted")
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      reject(new Error("Request aborted"))
    }
    signal.addEventListener("abort", onAbort)
  })
}

async function waitForZeroClawGatewayReady(
  apiBaseUrl: string,
  signal: AbortSignal,
  timeoutMs: number = 20_000
): Promise<void> {
  const normalizedBase = apiBaseUrl.replace(/\/+$/, "")
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new Error("Request aborted")
    }

    try {
      const response = await fetch(`${normalizedBase}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal
      })
      if (response.ok) {
        return
      }
    } catch {
      // Retry until timeout
    }

    await delayWithAbort(500, signal)
  }

  throw new Error("ZeroClaw gateway did not become ready in time.")
}

function parsePairingCodeFromLogs(deploymentId: string): string | null {
  const manager = getZeroClawManager()
  const events = manager.getLogs(deploymentId, undefined, 500).events

  for (const event of events) {
    const message = (event.message || "").trim()
    if (!message) {
      continue
    }

    const explicit = message.match(/X-Pairing-Code:\s*(\d{6})/i)
    if (explicit?.[1]) {
      return explicit[1]
    }

    const boxed = message.match(/│\s*(\d{6})\s*│/)
    if (boxed?.[1]) {
      return boxed[1]
    }

    if (message.toLowerCase().includes("pair")) {
      const fallback = message.match(/\b(\d{6})\b/)
      if (fallback?.[1]) {
        return fallback[1]
      }
    }
  }

  return null
}

async function pairZeroClawDeployment(
  deploymentId: string,
  apiBaseUrl: string,
  signal: AbortSignal
): Promise<string> {
  const code = parsePairingCodeFromLogs(deploymentId)
  if (!code) {
    throw new Error(
      "ZeroClaw pairing code not found in runtime logs. Restart the deployment and try again."
    )
  }

  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/pair`, {
    method: "POST",
    headers: {
      "X-Pairing-Code": code,
      Accept: "application/json"
    },
    signal
  })

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const token = typeof payload.token === "string" ? payload.token.trim() : ""

  if (!response.ok || token.length === 0) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : `Pairing failed with HTTP ${response.status}.`
    throw new Error(message)
  }

  zeroClawPairTokensByDeployment.set(deploymentId, token)
  return token
}

async function invokeZeroClawSpeaker(
  deploymentId: string,
  message: string,
  signal: AbortSignal,
  onToken: (chunk: string) => void
): Promise<{
  response: string
  model?: string
  deploymentName: string
  streamed: boolean
  transport: "sse" | "ndjson" | "json" | "unknown"
  tokenChunks: number
  syntheticFallbackUsed: boolean
  durationMs: number
  attemptCount: number
  pairingRecovered: boolean
}> {
  const manager = getZeroClawManager()
  const deployment = manager.getDeployment(deploymentId)
  if (!deployment) {
    throw new Error(`ZeroClaw deployment not found: ${deploymentId}`)
  }

  if (deployment.desiredState !== "running" || deployment.status !== "running") {
    await manager.startRuntime(deploymentId)
  }

  await waitForZeroClawGatewayReady(deployment.apiBaseUrl, signal)

  let attemptCount = 1
  let pairingRecovered = false
  let token = zeroClawPairTokensByDeployment.get(deploymentId)
  let attempt = await streamZeroClawWebhook({
    apiBaseUrl: deployment.apiBaseUrl,
    message,
    signal,
    token,
    onToken
  })
  if (attempt.unauthorized) {
    attemptCount += 1
    pairingRecovered = true
    token = await pairZeroClawDeployment(deploymentId, deployment.apiBaseUrl, signal)
    attempt = await streamZeroClawWebhook({
      apiBaseUrl: deployment.apiBaseUrl,
      message,
      signal,
      token,
      onToken
    })
  }

  if (!attempt.ok || !attempt.response) {
    throw new Error(attempt.error || "ZeroClaw webhook request failed.")
  }

  return {
    response: attempt.response,
    model: attempt.model,
    deploymentName: deployment.name,
    streamed: attempt.streamed,
    transport: attempt.transport,
    tokenChunks: attempt.tokenChunks,
    syntheticFallbackUsed: attempt.syntheticFallbackUsed,
    durationMs: attempt.durationMs,
    attemptCount,
    pairingRecovered
  }
}

// Track active runs for cancellation
const activeRuns = new Map<string, AbortController>()

function requireObject(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(errorMessage)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string.`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function optionalSpeakerType(value: unknown): "orchestrator" | "agent" | "zeroclaw" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined
  }
  if (value === "orchestrator" || value === "agent" || value === "zeroclaw") {
    return value
  }
  throw new Error("Invalid speakerType: expected orchestrator, agent, or zeroclaw.")
}

function parseAgentInvokeParams(payload: unknown): AgentInvokeParams {
  const record = requireObject(payload, "Invalid agent invoke payload.")
  return {
    threadId: requireString(record.threadId, "threadId"),
    message: requireString(record.message, "message"),
    modelId: optionalString(record.modelId),
    speakerType: optionalSpeakerType(record.speakerType),
    speakerAgentId: optionalString(record.speakerAgentId)
  }
}

function parseAgentResumeParams(payload: unknown): AgentResumeParams {
  const record = requireObject(payload, "Invalid agent resume payload.")
  const commandValue = record.command
  if (
    commandValue !== undefined &&
    commandValue !== null &&
    (typeof commandValue !== "object" || Array.isArray(commandValue))
  ) {
    throw new Error("Invalid command: expected object payload.")
  }

  return {
    threadId: requireString(record.threadId, "threadId"),
    command:
      commandValue && typeof commandValue === "object" && !Array.isArray(commandValue)
        ? (commandValue as AgentResumeParams["command"])
        : {},
    modelId: optionalString(record.modelId),
    speakerType: optionalSpeakerType(record.speakerType),
    speakerAgentId: optionalString(record.speakerAgentId)
  }
}

function parseAgentInterruptParams(payload: unknown): AgentInterruptParams {
  const record = requireObject(payload, "Invalid agent interrupt payload.")
  const decision = requireObject(record.decision, "Invalid decision: expected object payload.")
  const decisionType = requireString(decision.type, "decision.type")
  if (decisionType !== "approve" && decisionType !== "reject" && decisionType !== "edit") {
    throw new Error("Invalid decision.type: expected approve, reject, or edit.")
  }

  return {
    threadId: requireString(record.threadId, "threadId"),
    decision: {
      type: decisionType,
      tool_call_id: requireString(decision.tool_call_id, "decision.tool_call_id"),
      edited_args:
        decision.edited_args && typeof decision.edited_args === "object"
          ? (decision.edited_args as Record<string, unknown>)
          : undefined,
      feedback: optionalString(decision.feedback)
    }
  }
}

function parseAgentCancelParams(payload: unknown): AgentCancelParams {
  const record = requireObject(payload, "Invalid agent cancel payload.")
  return {
    threadId: requireString(record.threadId, "threadId")
  }
}

function extractThreadId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined
  }
  const raw = (payload as Record<string, unknown>).threadId
  if (typeof raw !== "string") {
    return undefined
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function sendValidationError(
  event: IpcMainEvent | IpcMainInvokeEvent,
  payload: unknown,
  errorMessage: string
): void {
  const window = BrowserWindow.fromWebContents(event.sender)
  const threadId = extractThreadId(payload)
  if (window && threadId) {
    window.webContents.send(`agent:stream:${threadId}`, {
      type: "error",
      error: errorMessage
    })
  }
}

export function registerAgentHandlers(ipcMain: IpcMain): void {
  console.log("[Agent] Registering agent handlers...")

  // Handle agent invocation with streaming
  ipcMain.on("agent:invoke", async (event, payload: unknown) => {
    let threadId = ""
    let message = ""
    let modelId: string | undefined
    let speakerType: "orchestrator" | "agent" | "zeroclaw" | undefined
    let speakerAgentId: string | undefined
    try {
      const parsed = parseAgentInvokeParams(payload)
      threadId = parsed.threadId
      message = parsed.message
      modelId = parsed.modelId
      speakerType = parsed.speakerType
      speakerAgentId = parsed.speakerAgentId
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Invalid agent invoke payload."
      console.error("[Agent] Payload validation failed:", messageText)
      sendValidationError(event, payload, messageText)
      return
    }

    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)

    console.log("[Agent] Received invoke request:", {
      threadId,
      message: message.substring(0, 50),
      modelId,
      speakerType,
      speakerAgentId
    })

    if (!window) {
      console.error("[Agent] No window found")
      return
    }

    // Abort any existing stream for this thread before starting a new one
    // This prevents concurrent streams which can cause checkpoint corruption
    const existingController = activeRuns.get(threadId)
    if (existingController) {
      console.log("[Agent] Aborting existing stream for thread:", threadId)
      existingController.abort()
      activeRuns.delete(threadId)
    }

    const abortController = new AbortController()
    activeRuns.set(threadId, abortController)

    // Abort the stream if the window is closed/destroyed
    const onWindowClosed = (): void => {
      console.log("[Agent] Window closed, aborting stream for thread:", threadId)
      abortController.abort()
    }
    window.once("closed", onWindowClosed)
    let workspaceIdForTimeline = DEFAULT_WORKSPACE_ID

    try {
      // Get workspace path from thread metadata - REQUIRED
      const thread = getThread(threadId)
      const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
      console.log("[Agent] Thread metadata:", metadata)

      const workspacePath = metadata.workspacePath as string | undefined
      const workspaceId = (metadata.workspaceId as string | undefined) || DEFAULT_WORKSPACE_ID
      workspaceIdForTimeline = workspaceId

      if (!workspacePath) {
        window.webContents.send(channel, {
          type: "error",
          error: "WORKSPACE_REQUIRED",
          message: "Please select a workspace folder before sending messages."
        })
        return
      }

      if (speakerType === "zeroclaw") {
        const deploymentId = speakerAgentId?.trim()
        if (!deploymentId) {
          window.webContents.send(channel, {
            type: "error",
            error: "ZEROCLAW_DEPLOYMENT_REQUIRED",
            message: "Select a ZeroClaw deployment before sending messages."
          })
          return
        }

        appendPersistedThreadMessages(threadId, [
          {
            id: crypto.randomUUID(),
            role: "user",
            content: message,
            created_at: new Date().toISOString()
          }
        ])

        writeTimelineEventSafe({
          threadId,
          workspaceId,
          eventType: "user_message",
          summary: trimSummary(message),
          payload: {
            speakerType: "zeroclaw",
            deploymentId
          }
        })

        const messageId = crypto.randomUUID()
        const result = await invokeZeroClawSpeaker(
          deploymentId,
          message,
          abortController.signal,
          (token) => {
            if (abortController.signal.aborted || !token) {
              return
            }
            window.webContents.send(channel, {
              type: "token",
              messageId,
              token
            })
          }
        )
        if (!abortController.signal.aborted) {
          window.webContents.send(channel, { type: "done" })
        }

        appendPersistedThreadMessages(threadId, [
          {
            id: messageId,
            role: "assistant",
            content: result.response,
            created_at: new Date().toISOString()
          }
        ])

        writeTimelineEventSafe({
          threadId,
          workspaceId,
          eventType: "tool_result",
          summary: trimSummary(`ZeroClaw (${result.deploymentName}): ${result.response}`),
          toolName: "zeroclaw:webhook",
          payload: {
            speakerType: "zeroclaw",
            deploymentId,
            model: result.model,
            streamed: result.streamed,
            transport: result.transport,
            tokenChunks: result.tokenChunks,
            syntheticFallbackUsed: result.syntheticFallbackUsed,
            durationMs: result.durationMs,
            attemptCount: result.attemptCount,
            pairingRecovered: result.pairingRecovered
          }
        })
        return
      }

      const speaker = resolveSpeaker(workspaceId, speakerType, speakerAgentId)
      writeTimelineEventSafe({
        threadId,
        workspaceId,
        eventType: "user_message",
        sourceAgentId: speaker?.id,
        summary: trimSummary(message),
        payload: {
          speakerType: speaker?.type || "orchestrator"
        }
      })
      const resolvedModelId = modelId || speaker?.modelName
      const agent = await createAgentRuntime({
        threadId,
        workspacePath,
        workspaceId,
        modelId: resolvedModelId,
        speaker
      })
      const humanMessage = new HumanMessage(message)

      // Stream with both modes:
      // - 'messages' for real-time token streaming
      // - 'values' for full state (todos, files, etc.)
      const stream = await agent.stream(
        { messages: [humanMessage] },
        {
          configurable: { thread_id: threadId },
          signal: abortController.signal,
          streamMode: ["messages", "values"],
          recursionLimit: 1000
        }
      )

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        // With multiple stream modes, chunks are tuples: [mode, data]
        const [mode, data] = chunk as [string, unknown]
        const serialized = JSON.parse(JSON.stringify(data))

        persistStreamTimelineEvents({
          threadId,
          workspaceId,
          mode,
          data: serialized,
          speaker
        })

        // Forward raw stream events - transport layer handles parsing
        // Serialize to plain objects for IPC (class instances don't transfer)
        window.webContents.send(channel, {
          type: "stream",
          mode,
          data: serialized
        })
      }

      // Send done event (only if not aborted)
      if (!abortController.signal.aborted) {
        window.webContents.send(channel, { type: "done" })
      }
    } catch (error) {
      // Ignore abort-related errors (expected when stream is cancelled)
      const isAbortError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Controller is already closed"))

      if (!isAbortError) {
        console.error("[Agent] Error:", error)
        const errorMessage =
          error instanceof Error ? trimSummary(error.message) : "Unknown stream error"
        const zeroClawDeploymentId =
          speakerType === "zeroclaw" && typeof speakerAgentId === "string"
            ? speakerAgentId.trim()
            : ""
        const zeroClawPayload =
          zeroClawDeploymentId.length > 0
            ? {
                speakerType: "zeroclaw",
                deploymentId: zeroClawDeploymentId,
                streamed: false,
                hasError: true,
                errorMessage
              }
            : undefined
        writeTimelineEventSafe({
          threadId,
          workspaceId: workspaceIdForTimeline,
          eventType: "error",
          summary: errorMessage,
          toolName: zeroClawPayload ? "zeroclaw:webhook" : undefined,
          payload: zeroClawPayload
        })
        window.webContents.send(channel, {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      window.removeListener("closed", onWindowClosed)
      activeRuns.delete(threadId)
    }
  })

  // Handle agent resume (after interrupt approval/rejection via useStream)
  ipcMain.on("agent:resume", async (event, payload: unknown) => {
    let threadId = ""
    let command: AgentResumeParams["command"] = {}
    let modelId: string | undefined
    let speakerType: "orchestrator" | "agent" | "zeroclaw" | undefined
    let speakerAgentId: string | undefined
    try {
      const parsed = parseAgentResumeParams(payload)
      threadId = parsed.threadId
      command = parsed.command
      modelId = parsed.modelId
      speakerType = parsed.speakerType
      speakerAgentId = parsed.speakerAgentId
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Invalid agent resume payload."
      console.error("[Agent] Resume payload validation failed:", messageText)
      sendValidationError(event, payload, messageText)
      return
    }

    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)

    console.log("[Agent] Received resume request:", {
      threadId,
      command,
      modelId,
      speakerType,
      speakerAgentId
    })

    if (!window) {
      console.error("[Agent] No window found for resume")
      return
    }

    // Get workspace path from thread metadata
    const thread = getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined
    const workspaceId = (metadata.workspaceId as string | undefined) || DEFAULT_WORKSPACE_ID
    const workspaceIdForTimeline = workspaceId

    if (!workspacePath) {
      window.webContents.send(channel, {
        type: "error",
        error: "Workspace path is required"
      })
      return
    }

    if (speakerType === "zeroclaw") {
      window.webContents.send(channel, {
        type: "error",
        error: "ZeroClaw speaker does not support resume commands."
      })
      return
    }

    // Abort any existing stream before resuming
    const existingController = activeRuns.get(threadId)
    if (existingController) {
      existingController.abort()
      activeRuns.delete(threadId)
    }

    const abortController = new AbortController()
    activeRuns.set(threadId, abortController)

    try {
      const speaker = resolveSpeaker(workspaceId, speakerType, speakerAgentId)
      const decisionType = command?.resume?.decision || "approve"
      const resumeToolName = command?.resume?.toolName
      const resumeToolCallId = command?.resume?.toolCallId
      const resumeToolArgs = command?.resume?.toolArgs as Record<string, unknown> | undefined
      const normalizedDecisionType =
        decisionType === "reject" || decisionType === "edit" ? decisionType : "approve"

      writeTimelineEventSafe({
        threadId,
        workspaceId,
        eventType: "tool_result",
        sourceAgentId: speaker?.id,
        toolName: resumeToolName || "approval:decision",
        summary: `Approval ${normalizedDecisionType}: ${resumeToolName || "tool"}`,
        dedupeKey: `${threadId}:approval_decision:${String(resumeToolCallId || "unknown")}:${normalizedDecisionType}`,
        payload: {
          approvalDecision: normalizedDecisionType,
          toolName: resumeToolName,
          toolCallId: resumeToolCallId,
          hasEditedArgs: normalizedDecisionType === "edit"
        }
      })

      if (
        normalizedDecisionType === "approve" &&
        speaker?.id &&
        typeof resumeToolName === "string" &&
        resumeToolName.length > 0
      ) {
        const normalizedResumeToolName = resumeToolName.trim().toLowerCase()
        const runtimeToolDefinition = getToolByName(workspaceId, normalizedResumeToolName)
        const action =
          runtimeToolDefinition?.action || mapToolNameToAction(normalizedResumeToolName)
        const runtimeFilesystemTools =
          runtimeToolDefinition?.category === "filesystem"
            ? new Set([normalizedResumeToolName])
            : undefined
        const resolvedPolicy = resolvePolicyDecision({
          agentId: speaker.id,
          resourceType: "tool",
          resourceKey: normalizedResumeToolName,
          action,
          scope: "workspace"
        })

        if (resolvedPolicy.decision === "allow_in_session") {
          grantPolicySessionAccess({
            threadId,
            agentId: speaker.id,
            resourceType: "tool",
            resourceKey: normalizedResumeToolName,
            action
          })
        }

        if (isFilesystemToolName(normalizedResumeToolName, runtimeFilesystemTools)) {
          const filesystemPolicy = resolvePolicyDecision({
            agentId: speaker.id,
            resourceType: "filesystem",
            resourceKey: "*",
            action,
            scope: "workspace"
          })
          if (filesystemPolicy.decision === "allow_in_session") {
            grantPolicySessionAccess({
              threadId,
              agentId: speaker.id,
              resourceType: "filesystem",
              resourceKey: "*",
              action
            })
          }
        }

        const detectedUrls = extractUrlsFromArgs(resumeToolArgs)
        if (
          (normalizedResumeToolName === "execute" || normalizedResumeToolName === "task") &&
          detectedUrls.length > 0
        ) {
          const networkPolicy = resolvePolicyDecision({
            agentId: speaker.id,
            resourceType: "network",
            resourceKey: "*",
            action: "exec",
            scope: "workspace"
          })
          if (networkPolicy.decision === "allow_in_session") {
            grantPolicySessionAccess({
              threadId,
              agentId: speaker.id,
              resourceType: "network",
              resourceKey: "*",
              action: "exec"
            })
          }
        }

        const connectorInvocation = inferConnectorInvocation(
          normalizedResumeToolName,
          resumeToolArgs,
          speaker.connectorAllowlist || []
        )
        if (connectorInvocation) {
          const connectorPolicy = resolvePolicyDecision({
            agentId: speaker.id,
            resourceType: "connector",
            resourceKey: connectorInvocation.connectorKey,
            action: connectorInvocation.action,
            scope: "workspace"
          })
          if (connectorPolicy.decision === "allow_in_session") {
            grantPolicySessionAccess({
              threadId,
              agentId: speaker.id,
              resourceType: "connector",
              resourceKey: connectorInvocation.connectorKey,
              action: connectorInvocation.action
            })
          }
        }
      }

      const resolvedModelId = modelId || speaker?.modelName
      const agent = await createAgentRuntime({
        threadId,
        workspacePath,
        workspaceId,
        modelId: resolvedModelId,
        speaker
      })
      const config = {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: ["messages", "values"] as StreamMode[],
        recursionLimit: 1000
      }

      // Resume from checkpoint by streaming with Command containing the decision
      // The HITL middleware expects { decisions: [{ type: 'approve' | 'reject' | 'edit' }] }
      const resumeValue = { decisions: [{ type: normalizedDecisionType }] }
      const stream = await agent.stream(new Command({ resume: resumeValue }), config)

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break

        const [mode, data] = chunk as unknown as [string, unknown]
        const serialized = JSON.parse(JSON.stringify(data))
        persistStreamTimelineEvents({
          threadId,
          workspaceId,
          mode,
          data: serialized,
          speaker
        })
        window.webContents.send(channel, {
          type: "stream",
          mode,
          data: serialized
        })
      }

      if (!abortController.signal.aborted) {
        window.webContents.send(channel, { type: "done" })
      }
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Controller is already closed"))

      if (!isAbortError) {
        console.error("[Agent] Resume error:", error)
        writeTimelineEventSafe({
          threadId,
          workspaceId: workspaceIdForTimeline,
          eventType: "error",
          summary: error instanceof Error ? trimSummary(error.message) : "Unknown resume error"
        })
        window.webContents.send(channel, {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      activeRuns.delete(threadId)
    }
  })

  // Handle HITL interrupt response
  ipcMain.on("agent:interrupt", async (event, payload: unknown) => {
    let threadId = ""
    let decision: AgentInterruptParams["decision"]
    try {
      const parsed = parseAgentInterruptParams(payload)
      threadId = parsed.threadId
      decision = parsed.decision
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Invalid agent interrupt payload."
      console.error("[Agent] Interrupt payload validation failed:", messageText)
      sendValidationError(event, payload, messageText)
      return
    }

    const channel = `agent:stream:${threadId}`
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) {
      console.error("[Agent] No window found for interrupt response")
      return
    }

    // Get workspace path from thread metadata - REQUIRED
    const thread = getThread(threadId)
    const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
    const workspacePath = metadata.workspacePath as string | undefined
    const workspaceId = (metadata.workspaceId as string | undefined) || DEFAULT_WORKSPACE_ID
    const workspaceIdForTimeline = workspaceId
    const modelId = metadata.model as string | undefined
    const speakerType = metadata.speakerType as "orchestrator" | "agent" | "zeroclaw" | undefined
    const speakerAgentId = metadata.speakerAgentId as string | undefined

    if (!workspacePath) {
      window.webContents.send(channel, {
        type: "error",
        error: "Workspace path is required"
      })
      return
    }

    if (speakerType === "zeroclaw") {
      window.webContents.send(channel, {
        type: "error",
        error: "ZeroClaw speaker does not support interrupt approvals."
      })
      return
    }

    // Abort any existing stream before continuing
    const existingController = activeRuns.get(threadId)
    if (existingController) {
      existingController.abort()
      activeRuns.delete(threadId)
    }

    const abortController = new AbortController()
    activeRuns.set(threadId, abortController)

    try {
      const speaker = resolveSpeaker(workspaceId, speakerType, speakerAgentId)
      writeTimelineEventSafe({
        threadId,
        workspaceId,
        eventType: "tool_result",
        sourceAgentId: speaker?.id,
        toolName: "approval:decision",
        summary: `Approval ${decision.type}`,
        dedupeKey: `${threadId}:approval_decision_interrupt:${decision.tool_call_id}:${decision.type}`,
        payload: {
          approvalDecision: decision.type,
          toolCallId: decision.tool_call_id,
          hasEditedArgs: decision.type === "edit"
        }
      })
      const resolvedModelId = modelId || speaker?.modelName
      const agent = await createAgentRuntime({
        threadId,
        workspacePath,
        workspaceId,
        modelId: resolvedModelId,
        speaker
      })
      const config = {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: ["messages", "values"] as StreamMode[],
        recursionLimit: 1000
      }

      if (decision.type === "approve") {
        // Resume execution by invoking with null (continues from checkpoint)
        const stream = await agent.stream(null, config)

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break

          const [mode, data] = chunk as unknown as [string, unknown]
          const serialized = JSON.parse(JSON.stringify(data))
          persistStreamTimelineEvents({
            threadId,
            workspaceId,
            mode,
            data: serialized,
            speaker
          })
          window.webContents.send(channel, {
            type: "stream",
            mode,
            data: serialized
          })
        }

        if (!abortController.signal.aborted) {
          window.webContents.send(channel, { type: "done" })
        }
      } else if (decision.type === "reject") {
        // For reject, we need to send a Command with reject decision
        // For now, just send done - the agent will see no resumption happened
        window.webContents.send(channel, { type: "done" })
      }
      // edit case handled similarly to approve with modified args
    } catch (error) {
      const isAbortError =
        error instanceof Error &&
        (error.name === "AbortError" ||
          error.message.includes("aborted") ||
          error.message.includes("Controller is already closed"))

      if (!isAbortError) {
        console.error("[Agent] Interrupt error:", error)
        writeTimelineEventSafe({
          threadId,
          workspaceId: workspaceIdForTimeline,
          eventType: "error",
          summary: error instanceof Error ? trimSummary(error.message) : "Unknown interrupt error"
        })
        window.webContents.send(channel, {
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    } finally {
      activeRuns.delete(threadId)
    }
  })

  // Handle cancellation
  ipcMain.handle("agent:cancel", async (_event, payload: unknown) => {
    const { threadId } = parseAgentCancelParams(payload)
    const controller = activeRuns.get(threadId)
    if (controller) {
      controller.abort()
      activeRuns.delete(threadId)
    }
  })
}
