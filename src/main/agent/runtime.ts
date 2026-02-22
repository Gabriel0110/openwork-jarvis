/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDeepAgent, type SubAgent } from "deepagents"
import { getDefaultModel } from "../ipc/models"
import { getApiKey, getSecurityDefaults, getThreadCheckpointPath } from "../storage"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { SqlJsSaver } from "../checkpointer/sqljs-saver"
import { LocalSandbox } from "./local-sandbox"
import { createMiddleware, ToolMessage, type AgentMiddleware } from "langchain"
import { tool } from "@langchain/core/tools"
import {
  evaluatePolicyConstraints,
  extractUrlsFromArgs,
  inferConnectorInvocation,
  isFilesystemToolName,
  mapToolNameToAction,
  parseRateLimitConstraint,
  resolvePolicyDecision
} from "../services/policy-engine"
import { consumePolicyRateLimit, hasPolicySessionAccess } from "../services/policy-session"
import { listAgents, type AgentRow } from "../db/agents"
import { listTools } from "../db/tools"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import { searchMemoryAndRag } from "../db/memory"
import {
  getGlobalSkillDetailByName,
  normalizeAgentSkillMode,
  resolveSkillsForAgent
} from "../services/skills-registry"
import type {
  AgentSkillMode,
  PolicyAction,
  SecurityDefaults,
  SkillDefinition,
  ToolDefinition
} from "../types"

import type * as _lcTypes from "langchain"
import type * as _lcMessages from "@langchain/core/messages"
import type * as _lcLanggraph from "@langchain/langgraph"
import type * as _lcZodTypes from "@langchain/core/utils/types"

import { BASE_SYSTEM_PROMPT } from "./system-prompt"

/**
 * Generate the full system prompt for the agent.
 *
 * @param workspacePath - The workspace path the agent is operating in
 * @returns The complete system prompt
 */
function getSystemPrompt(workspacePath: string): string {
  const workingDirSection = `
### File System and Paths

**IMPORTANT - Path Handling:**
- All file paths use fully qualified absolute system paths
- The workspace root is: \`${workspacePath}\`
- Example: \`${workspacePath}/src/index.ts\`, \`${workspacePath}/README.md\`
- To list the workspace root, use \`ls("${workspacePath}")\`
- Always use full absolute paths for all file operations
`

  return workingDirSection + BASE_SYSTEM_PROMPT
}

function applySkillRegistryPrompt(
  basePrompt: string,
  skillMode: AgentSkillMode,
  assignedSkills: SkillDefinition[]
): string {
  if (assignedSkills.length === 0) {
    return `${basePrompt}

### Skill Registry

No skills are currently assigned in this runtime context.
`
  }

  const modeLabel =
    skillMode === "selected_only"
      ? "selected_only (ignore non-selected globals)"
      : skillMode === "global_plus_selected"
        ? "global_plus_selected"
        : "global_only"

  const skillList = assignedSkills
    .map((skill) => {
      return `- ${skill.name}: ${skill.description} (source: ${skill.source})`
    })
    .join("\n")

  return `${basePrompt}

### Skill Registry

Assigned skill mode: ${modeLabel}

You have access to these skills:
${skillList}

To use a skill, call the \`read_skill\` tool with the exact skill name and follow the returned SKILL.md instructions.
`
}

function getSpeakerSystemPrompt(
  workspacePath: string,
  assignedSkills: SkillDefinition[],
  skillMode: AgentSkillMode,
  speaker?: CreateAgentRuntimeOptions["speaker"]
): string {
  const basePrompt = getSystemPrompt(workspacePath)

  if (!speaker || speaker.type === "orchestrator") {
    return applySkillRegistryPrompt(basePrompt, skillMode, assignedSkills)
  }

  const speakerSection = `
### Active Speaker

You are currently acting as the specialist agent "${speaker.name}".
Role: ${speaker.role}

Specialized instructions:
${speaker.systemPrompt}
`

  return applySkillRegistryPrompt(`${speakerSection}\n${basePrompt}`, skillMode, assignedSkills)
}

function parseArrayField(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : []
  } catch {
    return []
  }
}

function toSubagentType(agentName: string, used: Set<string>): string {
  const base = agentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  const normalizedBase = base || "specialist-agent"
  let candidate = normalizedBase
  let index = 2
  while (used.has(candidate)) {
    candidate = `${normalizedBase}-${index}`
    index += 1
  }
  used.add(candidate)
  return candidate
}

type RuntimeModel = ReturnType<typeof getModelInstance>

function resolveSubagentModel(modelName: string, fallbackModel: RuntimeModel): RuntimeModel {
  try {
    return getModelInstance(modelName)
  } catch (error) {
    console.warn(
      `[Runtime] Failed to resolve subagent model "${modelName}", falling back to main model.`,
      error
    )
    return fallbackModel
  }
}

function getSubagentSystemPrompt(
  workspacePath: string,
  agent: AgentRow,
  assignedSkills: SkillDefinition[],
  skillMode: AgentSkillMode
): string {
  const basePrompt = getSystemPrompt(workspacePath)
  const profileSection = `
### Agent Profile

You are the specialist agent "${agent.name}".
Role: ${agent.role}

Specialized instructions:
${agent.system_prompt}
`

  return applySkillRegistryPrompt(`${profileSection}\n${basePrompt}`, skillMode, assignedSkills)
}

function applyDelegationRosterPrompt(basePrompt: string, subagents: SubAgent[]): string {
  if (subagents.length === 0) {
    return basePrompt
  }

  const roster = subagents
    .map((subagent) => `- ${subagent.name}: ${subagent.description}`)
    .join("\n")

  return `${basePrompt}

### Delegation Roster

When using the task tool, use one of these exact subagent_type values:
${roster}
`
}

// Per-thread checkpointer cache
const checkpointers = new Map<string, SqlJsSaver>()

export async function getCheckpointer(threadId: string): Promise<SqlJsSaver> {
  let checkpointer = checkpointers.get(threadId)
  if (!checkpointer) {
    const dbPath = getThreadCheckpointPath(threadId)
    checkpointer = new SqlJsSaver(dbPath)
    await checkpointer.initialize()
    checkpointers.set(threadId, checkpointer)
  }
  return checkpointer
}

export async function closeCheckpointer(threadId: string): Promise<void> {
  const checkpointer = checkpointers.get(threadId)
  if (checkpointer) {
    await checkpointer.close()
    checkpointers.delete(threadId)
  }
}

// Get the appropriate model instance based on configuration
function getModelInstance(
  modelId?: string
): ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string {
  const model = modelId || getDefaultModel()
  console.log("[Runtime] Using model:", model)

  // Determine provider from model ID
  if (model.startsWith("claude")) {
    const apiKey = getApiKey("anthropic")
    console.log("[Runtime] Anthropic API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("Anthropic API key not configured")
    }
    return new ChatAnthropic({
      model,
      anthropicApiKey: apiKey
    })
  } else if (
    model.startsWith("gpt") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    const apiKey = getApiKey("openai")
    console.log("[Runtime] OpenAI API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("OpenAI API key not configured")
    }
    return new ChatOpenAI({
      model,
      openAIApiKey: apiKey
    })
  } else if (model.startsWith("gemini")) {
    const apiKey = getApiKey("google")
    console.log("[Runtime] Google API key present:", !!apiKey)
    if (!apiKey) {
      throw new Error("Google API key not configured")
    }
    return new ChatGoogleGenerativeAI({
      model,
      apiKey: apiKey
    })
  }

  // Default to model string (let deepagents handle it)
  return model
}

export interface CreateAgentRuntimeOptions {
  /** Thread ID - REQUIRED for per-thread checkpointing */
  threadId: string
  /** Model ID to use (defaults to configured default model) */
  modelId?: string
  /** Workspace path - REQUIRED for agent to operate on files */
  workspacePath: string
  /** Workspace scope for loading agent roster */
  workspaceId?: string
  /** Active speaker profile for this invocation */
  speaker?: {
    id?: string
    type: "orchestrator" | "agent"
    name: string
    role: string
    systemPrompt: string
    connectorAllowlist?: string[]
    skillMode?: AgentSkillMode
    skillsAllowlist?: string[]
  }
}

const BASE_RUNTIME_TOOL_POLICY_TARGETS = [
  "ls",
  "read_file",
  "glob",
  "grep",
  "write_file",
  "edit_file",
  "write_todos",
  "execute",
  "task",
  "search_memory",
  "read_skill"
] as const

interface RuntimeToolPolicyContext {
  toolNames: string[]
  actionByName: ReadonlyMap<string, PolicyAction>
  filesystemToolNames: ReadonlySet<string>
  disabledToolNames: ReadonlySet<string>
}

function createSearchMemoryTool(workspaceId: string) {
  return tool(
    async (input: { query: string; limit?: number }) => {
      const query = input.query?.trim() || ""
      if (!query) {
        return "No query provided. Supply a non-empty search query."
      }

      const limit = Math.max(1, Math.min(input.limit || 6, 12))
      const results = searchMemoryAndRag(workspaceId, query, limit)
      if (results.length === 0) {
        return "No memory or indexed local knowledge matched this query."
      }

      return JSON.stringify(
        results.map((item) => ({
          source: item.source,
          score: item.score,
          title: item.title,
          path: item.path,
          scope: item.scope,
          agentId: item.agentId,
          threadId: item.threadId,
          createdAt: item.createdAt.toISOString(),
          snippet: item.contentSnippet
        })),
        null,
        2
      )
    },
    {
      name: "search_memory",
      description:
        "Search workspace memory entries and indexed local knowledge. Use this before answering questions that depend on stored context.",
      schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language query for memory and local indexed knowledge."
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (1-12)."
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  )
}

function createReadSkillTool(assignedSkills: SkillDefinition[]) {
  const allowedSkillsByName = new Map(
    assignedSkills.map((skill) => [skill.name.trim().toLowerCase(), skill])
  )

  return tool(
    async (input: { skillName: string }) => {
      const skillName = input.skillName?.trim() || ""
      if (!skillName) {
        return "No skill name provided. Supply a non-empty skillName."
      }

      const allowed = allowedSkillsByName.get(skillName.toLowerCase())
      if (!allowed) {
        const knownSkills = assignedSkills.map((skill) => skill.name).join(", ")
        return `Skill "${skillName}" is not assigned in this agent context. Assigned skills: ${knownSkills || "(none)"}`
      }

      const detail = getGlobalSkillDetailByName(allowed.name)
      if (!detail) {
        return `Skill "${allowed.name}" could not be resolved from the registry.`
      }

      const maxChars = 40_000
      const content =
        detail.content.length > maxChars
          ? `${detail.content.slice(0, maxChars)}\n\n[Truncated]`
          : detail.content
      return `# ${detail.skill.name}\nPath: ${detail.skill.path}\n\n${content}`
    },
    {
      name: "read_skill",
      description:
        "Load SKILL.md instructions for an assigned skill by name. Use this before applying that skill's workflow.",
      schema: {
        type: "object",
        properties: {
          skillName: {
            type: "string",
            description: "Exact skill name from the assigned skill registry."
          }
        },
        required: ["skillName"],
        additionalProperties: false
      }
    }
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getPathValue(args: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".").filter(Boolean)
  let current: unknown = args

  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined
    }
    current = current[segment]
  }

  return current
}

function toRawTemplateValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (value == null) {
    return ""
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toShellSafeTemplateValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (value == null) {
    return "null"
  }
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify(String(value))
  }
}

function renderCommandTemplate(template: string, args: Record<string, unknown>): string {
  const renderedRaw = template.replace(
    /\{\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\}/g,
    (_match, token: string) => {
      const value = getPathValue(args, token)
      if (value === undefined) {
        throw new Error(`Missing required raw token "${token}" in tool args.`)
      }
      return toRawTemplateValue(value)
    }
  )

  return renderedRaw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, token: string) => {
    const value = getPathValue(args, token)
    if (value === undefined) {
      throw new Error(`Missing required token "${token}" in tool args.`)
    }
    return toShellSafeTemplateValue(value)
  })
}

function createCustomScriptTool(toolDefinition: ToolDefinition, sandbox: LocalSandbox) {
  const commandTemplateRaw = toolDefinition.config.commandTemplate
  if (typeof commandTemplateRaw !== "string" || commandTemplateRaw.trim().length === 0) {
    return null
  }

  const commandTemplate = commandTemplateRaw
  const descriptionSuffix =
    typeof toolDefinition.config.usageHint === "string" &&
    toolDefinition.config.usageHint.trim().length > 0
      ? ` ${toolDefinition.config.usageHint.trim()}`
      : ""
  const schemaCandidate = toolDefinition.config.argsSchema
  const schema =
    isRecord(schemaCandidate) && typeof schemaCandidate.type === "string"
      ? schemaCandidate
      : {
          type: "object",
          additionalProperties: true
        }

  return tool(
    async (input: Record<string, unknown>) => {
      const args = isRecord(input) ? input : {}
      const command = renderCommandTemplate(commandTemplate, args)
      const result = await sandbox.execute(command)

      return [
        `Tool: ${toolDefinition.name}`,
        `Command: ${command}`,
        `Exit code: ${result.exitCode === null ? "null" : String(result.exitCode)}`,
        `Truncated: ${result.truncated ? "yes" : "no"}`,
        "",
        result.output
      ].join("\n")
    },
    {
      name: toolDefinition.name,
      description: `${toolDefinition.description}${descriptionSuffix}`.trim(),
      schema
    }
  )
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase()
}

function isPolicyAddressableToolName(name: string): boolean {
  return normalizeToolName(name).length > 0 && !name.includes("*")
}

function buildRuntimeToolPolicyContext(toolRegistry: ToolDefinition[]): RuntimeToolPolicyContext {
  const enabledToolNames = new Set<string>()
  const disabledToolNames = new Set<string>()
  const actionByName = new Map<string, PolicyAction>()
  const filesystemToolNames = new Set<string>()

  for (const toolDefinition of toolRegistry) {
    const normalizedName = normalizeToolName(toolDefinition.name)
    if (!isPolicyAddressableToolName(normalizedName)) {
      continue
    }

    actionByName.set(normalizedName, toolDefinition.action)
    if (toolDefinition.category === "filesystem") {
      filesystemToolNames.add(normalizedName)
    }
    if (toolDefinition.enabled) {
      enabledToolNames.add(normalizedName)
    } else {
      disabledToolNames.add(normalizedName)
    }
  }

  const toolNames = Array.from(
    new Set([...BASE_RUNTIME_TOOL_POLICY_TARGETS, ...Array.from(actionByName.keys())])
  )

  for (const toolName of enabledToolNames) {
    disabledToolNames.delete(toolName)
  }

  return {
    toolNames,
    actionByName,
    filesystemToolNames,
    disabledToolNames
  }
}

function buildConnectorToolNameCandidates(connectorKey: string): string[] {
  const normalized = connectorKey.trim().toLowerCase().replace(/\s+/g, "_")
  if (!normalized) {
    return []
  }

  return [`connector:${normalized}`, `connector_${normalized}`, `connector-${normalized}`]
}

function buildPolicyConfig(
  threadId: string,
  agentId?: string,
  connectorAllowlist: string[] = [],
  securityDefaults?: SecurityDefaults,
  toolPolicyContext?: RuntimeToolPolicyContext
): {
  interruptOn?: Record<string, { allowedDecisions: Array<"approve" | "reject" | "edit"> }>
  deniedTools: Set<string>
} {
  const deniedTools = new Set<string>()
  const interruptOn: Record<string, { allowedDecisions: Array<"approve" | "reject" | "edit"> }> = {}
  const policyToolNames = toolPolicyContext?.toolNames || [...BASE_RUNTIME_TOOL_POLICY_TARGETS]

  for (const toolName of policyToolNames) {
    const action = mapToolNameToAction(toolName, toolPolicyContext?.actionByName)

    if (toolPolicyContext?.disabledToolNames.has(toolName)) {
      deniedTools.add(toolName)
      continue
    }

    const toolPolicy = resolvePolicyDecision({
      agentId,
      resourceType: "tool",
      resourceKey: toolName,
      action,
      scope: "workspace",
      securityDefaults
    })

    if (toolPolicy.decision === "deny") {
      deniedTools.add(toolName)
      continue
    }

    if (toolPolicy.decision === "ask") {
      interruptOn[toolName] = {
        allowedDecisions: ["approve", "reject", "edit"]
      }
    }

    if (toolPolicy.decision === "allow_in_session") {
      const granted = hasPolicySessionAccess({
        threadId,
        agentId,
        resourceType: "tool",
        resourceKey: toolName,
        action
      })

      if (!granted) {
        interruptOn[toolName] = {
          allowedDecisions: ["approve", "reject", "edit"]
        }
      }
    }

    if (isFilesystemToolName(toolName, toolPolicyContext?.filesystemToolNames)) {
      const filesystemPolicy = resolvePolicyDecision({
        agentId,
        resourceType: "filesystem",
        resourceKey: "*",
        action,
        scope: "workspace",
        securityDefaults
      })

      if (filesystemPolicy.decision === "deny") {
        deniedTools.add(toolName)
      } else if (filesystemPolicy.decision === "ask") {
        interruptOn[toolName] = {
          allowedDecisions: ["approve", "reject", "edit"]
        }
      } else if (filesystemPolicy.decision === "allow_in_session") {
        const granted = hasPolicySessionAccess({
          threadId,
          agentId,
          resourceType: "filesystem",
          resourceKey: "*",
          action
        })
        if (!granted) {
          interruptOn[toolName] = {
            allowedDecisions: ["approve", "reject", "edit"]
          }
        }
      }
    }

    if (toolName === "execute" || toolName === "task") {
      const networkPolicy = resolvePolicyDecision({
        agentId,
        resourceType: "network",
        resourceKey: "*",
        action: "exec",
        scope: "workspace",
        securityDefaults
      })

      if (networkPolicy.decision === "ask") {
        interruptOn[toolName] = {
          allowedDecisions: ["approve", "reject", "edit"]
        }
      } else if (networkPolicy.decision === "allow_in_session") {
        const granted = hasPolicySessionAccess({
          threadId,
          agentId,
          resourceType: "network",
          resourceKey: "*",
          action: "exec"
        })
        if (!granted) {
          interruptOn[toolName] = {
            allowedDecisions: ["approve", "reject", "edit"]
          }
        }
      }
    }
  }

  for (const connectorKeyRaw of connectorAllowlist) {
    const connectorKey = connectorKeyRaw.trim().toLowerCase().replace(/\s+/g, "_")
    if (!connectorKey) {
      continue
    }

    const connectorPolicy = resolvePolicyDecision({
      agentId,
      resourceType: "connector",
      resourceKey: connectorKey,
      action: "post",
      scope: "workspace",
      securityDefaults
    })

    const toolNameCandidates = buildConnectorToolNameCandidates(connectorKey)
    if (connectorPolicy.decision === "deny") {
      for (const candidate of toolNameCandidates) {
        deniedTools.add(candidate)
      }
      continue
    }

    const needsInterrupt =
      connectorPolicy.decision === "ask" ||
      (connectorPolicy.decision === "allow_in_session" &&
        !hasPolicySessionAccess({
          threadId,
          agentId,
          resourceType: "connector",
          resourceKey: connectorKey,
          action: "post"
        }))

    if (needsInterrupt) {
      for (const candidate of toolNameCandidates) {
        interruptOn[candidate] = {
          allowedDecisions: ["approve", "reject", "edit"]
        }
      }
    }
  }

  return {
    interruptOn: Object.keys(interruptOn).length > 0 ? interruptOn : undefined,
    deniedTools
  }
}

function createPolicyMiddleware(
  threadId: string,
  workspacePath: string,
  agentId?: string,
  connectorAllowlist: string[] = [],
  skillAllowlist: string[] = [],
  securityDefaults?: SecurityDefaults,
  toolPolicyContext?: RuntimeToolPolicyContext
): AgentMiddleware {
  const normalizedSkillAllowlist = new Set(
    skillAllowlist.map((item) => item.trim().toLowerCase()).filter(Boolean)
  )

  function denyTool(toolCallId: string | undefined, reason: string, denyCode: string): ToolMessage {
    return new ToolMessage({
      content: reason,
      tool_call_id: toolCallId || denyCode
    })
  }

  function enforceResolvedPolicy(params: {
    policyResourceType: "tool" | "filesystem" | "network" | "connector"
    policyResourceKey: string
    action: "read" | "write" | "exec" | "post"
    toolName: string
    toolArgs: Record<string, unknown>
    toolCallId?: string
  }): ToolMessage | null {
    const resolvedPolicy = resolvePolicyDecision({
      agentId,
      resourceType: params.policyResourceType,
      resourceKey: params.policyResourceKey,
      action: params.action,
      scope: "workspace",
      securityDefaults
    })

    if (resolvedPolicy.decision === "deny") {
      return denyTool(
        params.toolCallId,
        `Policy denied "${params.policyResourceType}:${params.policyResourceKey}" for "${params.toolName}".`,
        "policy-denied"
      )
    }

    if (resolvedPolicy.decision === "allow_in_session") {
      const hasGrant = hasPolicySessionAccess({
        threadId,
        agentId,
        resourceType: params.policyResourceType,
        resourceKey: params.policyResourceKey,
        action: params.action
      })
      if (!hasGrant) {
        return denyTool(
          params.toolCallId,
          `Policy requires in-session approval for "${params.policyResourceType}:${params.policyResourceKey}".`,
          "policy-session-required"
        )
      }
    }

    const constraintResult = evaluatePolicyConstraints({
      resourceType: params.policyResourceType,
      resourceKey: params.policyResourceKey,
      constraints: resolvedPolicy.constraints,
      toolArgs: params.toolArgs,
      workspacePath
    })
    if (!constraintResult.allowed) {
      return denyTool(
        params.toolCallId,
        `Policy constraint blocked "${params.toolName}": ${constraintResult.violation?.message || "unknown policy violation."}`,
        "policy-constraint-denied"
      )
    }

    const rateLimit = parseRateLimitConstraint(resolvedPolicy.constraints)
    if (rateLimit) {
      const rateLimitResult = consumePolicyRateLimit({
        threadId,
        agentId,
        resourceType: params.policyResourceType,
        resourceKey: params.policyResourceKey,
        action: params.action,
        maxCalls: rateLimit.maxCalls,
        windowMs: rateLimit.windowMs
      })
      if (!rateLimitResult.allowed) {
        const seconds = Math.ceil((rateLimitResult.retryAfterMs || 0) / 1000)
        return denyTool(
          params.toolCallId,
          `Policy rate limit blocked "${params.toolName}". Try again in ${seconds} seconds.`,
          "policy-rate-limit-denied"
        )
      }
    }

    return null
  }

  return createMiddleware({
    name: "policy-enforcement-middleware",
    wrapToolCall: async (request, handler) => {
      const rawToolName = String(request.tool?.name ?? request.toolCall?.name ?? "")
      const toolName = normalizeToolName(rawToolName)
      const action = mapToolNameToAction(toolName, toolPolicyContext?.actionByName)
      const toolArgs = request.toolCall.args as Record<string, unknown>
      const toolCallId = request.toolCall.id

      if (toolPolicyContext?.disabledToolNames.has(toolName)) {
        return denyTool(
          toolCallId,
          `Tool "${toolName}" is disabled in the workspace tool registry.`,
          "tool-disabled"
        )
      }

      if (toolName === "read_skill") {
        const skillName =
          typeof toolArgs.skillName === "string" ? toolArgs.skillName.trim().toLowerCase() : ""
        if (!skillName) {
          return denyTool(toolCallId, 'Missing required "skillName" for read_skill.', "skill-name")
        }
        if (normalizedSkillAllowlist.size === 0 || !normalizedSkillAllowlist.has(skillName)) {
          return denyTool(
            toolCallId,
            `Skill "${skillName}" is not assigned in this agent context.`,
            "skill-not-assigned"
          )
        }
      }

      const toolPolicyResult = enforceResolvedPolicy({
        policyResourceType: "tool",
        policyResourceKey: toolName,
        action,
        toolName: rawToolName || toolName,
        toolArgs,
        toolCallId
      })
      if (toolPolicyResult) {
        return toolPolicyResult
      }

      if (isFilesystemToolName(toolName, toolPolicyContext?.filesystemToolNames)) {
        const filesystemPolicyResult = enforceResolvedPolicy({
          policyResourceType: "filesystem",
          policyResourceKey: "*",
          action,
          toolName: rawToolName || toolName,
          toolArgs,
          toolCallId
        })
        if (filesystemPolicyResult) {
          return filesystemPolicyResult
        }
      }

      if (toolName === "execute" || toolName === "task") {
        const urls = extractUrlsFromArgs(toolArgs)
        if (urls.length > 0) {
          const networkPolicyResult = enforceResolvedPolicy({
            policyResourceType: "network",
            policyResourceKey: "*",
            action: "exec",
            toolName: rawToolName || toolName,
            toolArgs,
            toolCallId
          })
          if (networkPolicyResult) {
            return networkPolicyResult
          }
        }
      }

      const connectorInvocation = inferConnectorInvocation(toolName, toolArgs, connectorAllowlist)
      if (connectorInvocation) {
        const connectorPolicyResult = enforceResolvedPolicy({
          policyResourceType: "connector",
          policyResourceKey: connectorInvocation.connectorKey,
          action: connectorInvocation.action,
          toolName: rawToolName || toolName,
          toolArgs,
          toolCallId
        })
        if (connectorPolicyResult) {
          return connectorPolicyResult
        }
      }

      return handler(request)
    }
  })
}

function buildDelegationSubagents(params: {
  threadId: string
  workspacePath: string
  workspaceId: string
  fallbackModel: RuntimeModel
  securityDefaults: SecurityDefaults
  toolPolicyContext: RuntimeToolPolicyContext
}): SubAgent[] {
  const agents = listAgents(params.workspaceId).filter((agent) => agent.is_orchestrator !== 1)
  if (agents.length === 0) {
    return []
  }

  const usedSubagentTypes = new Set<string>()

  return agents.map((agent) => {
    const connectorAllowlist = parseArrayField(agent.connector_allowlist)
    const skillMode = normalizeAgentSkillMode(agent.skill_mode)
    const skillsAllowlist = parseArrayField(agent.skills_allowlist)
    const assignedSkills = resolveSkillsForAgent(skillMode, skillsAllowlist)
    const policyConfig = buildPolicyConfig(
      params.threadId,
      agent.agent_id,
      connectorAllowlist,
      params.securityDefaults,
      params.toolPolicyContext
    )
    const policyMiddleware = createPolicyMiddleware(
      params.threadId,
      params.workspacePath,
      agent.agent_id,
      connectorAllowlist,
      assignedSkills.map((skill) => skill.name),
      params.securityDefaults,
      params.toolPolicyContext
    )

    return {
      name: toSubagentType(agent.name, usedSubagentTypes),
      description: `${agent.name}: ${agent.role}`,
      systemPrompt: getSubagentSystemPrompt(params.workspacePath, agent, assignedSkills, skillMode),
      model: resolveSubagentModel(agent.model_name, params.fallbackModel),
      interruptOn: policyConfig.interruptOn,
      middleware: [policyMiddleware]
    }
  })
}

// Create agent runtime with configured model and checkpointer
export type AgentRuntime = ReturnType<typeof createDeepAgent>

export async function createAgentRuntime(options: CreateAgentRuntimeOptions) {
  const { threadId, modelId, workspacePath, workspaceId, speaker } = options
  const effectiveWorkspaceId = workspaceId || DEFAULT_WORKSPACE_ID

  if (!threadId) {
    throw new Error("Thread ID is required for checkpointing.")
  }

  if (!workspacePath) {
    throw new Error(
      "Workspace path is required. Please select a workspace folder before running the agent."
    )
  }

  console.log("[Runtime] Creating agent runtime...")
  console.log("[Runtime] Thread ID:", threadId)
  console.log("[Runtime] Workspace path:", workspacePath)

  const model = getModelInstance(modelId)
  console.log("[Runtime] Model instance created:", typeof model)

  const checkpointer = await getCheckpointer(threadId)
  console.log("[Runtime] Checkpointer ready for thread:", threadId)

  const backend = new LocalSandbox({
    rootDir: workspacePath,
    virtualMode: false, // Use absolute system paths for consistency with shell commands
    timeout: 120_000, // 2 minutes
    maxOutputBytes: 100_000 // ~100KB
  })
  const toolRegistry = listTools(effectiveWorkspaceId, true)
  const toolPolicyContext = buildRuntimeToolPolicyContext(toolRegistry)
  const customScriptTools = toolRegistry
    .filter(
      (toolDefinition) =>
        toolDefinition.source === "custom" &&
        toolDefinition.implementationType === "script" &&
        toolDefinition.enabled &&
        isPolicyAddressableToolName(toolDefinition.name)
    )
    .map((toolDefinition) => createCustomScriptTool(toolDefinition, backend))
    .filter((toolDefinition): toolDefinition is NonNullable<typeof toolDefinition> => {
      return toolDefinition !== null
    })

  const runtimeSkillMode = normalizeAgentSkillMode(speaker?.skillMode)
  const runtimeSkills = resolveSkillsForAgent(runtimeSkillMode, speaker?.skillsAllowlist || [])
  const baseSystemPrompt = getSpeakerSystemPrompt(
    workspacePath,
    runtimeSkills,
    runtimeSkillMode,
    speaker
  )
  const securityDefaults = getSecurityDefaults()
  const policyConfig = buildPolicyConfig(
    threadId,
    speaker?.id,
    speaker?.connectorAllowlist ?? [],
    securityDefaults,
    toolPolicyContext
  )
  const policyMiddleware = createPolicyMiddleware(
    threadId,
    workspacePath,
    speaker?.id,
    speaker?.connectorAllowlist ?? [],
    runtimeSkills.map((skill) => skill.name),
    securityDefaults,
    toolPolicyContext
  )
  const delegationSubagents =
    speaker?.type === "agent"
      ? []
      : buildDelegationSubagents({
          threadId,
          workspacePath,
          workspaceId: effectiveWorkspaceId,
          fallbackModel: model,
          securityDefaults,
          toolPolicyContext
        })
  const systemPrompt =
    speaker?.type === "agent"
      ? baseSystemPrompt
      : applyDelegationRosterPrompt(baseSystemPrompt, delegationSubagents)

  // Custom filesystem prompt for absolute paths (matches virtualMode: false)
  const filesystemSystemPrompt = `You have access to a filesystem. All file paths use fully qualified absolute system paths.

- ls: list files in a directory (e.g., ls("${workspacePath}"))
- read_file: read a file from the filesystem
- write_file: write to a file in the filesystem
- edit_file: edit a file in the filesystem
- glob: find files matching a pattern (e.g., "**/*.py")
- grep: search for text within files

The workspace root is: ${workspacePath}`

  const agent = createDeepAgent({
    model,
    checkpointer,
    backend,
    systemPrompt,
    tools: [
      createSearchMemoryTool(effectiveWorkspaceId),
      createReadSkillTool(runtimeSkills),
      ...customScriptTools
    ],
    subagents: delegationSubagents,
    // Custom filesystem prompt for absolute paths (requires deepagents update)
    filesystemSystemPrompt,
    interruptOn: policyConfig.interruptOn,
    middleware: [policyMiddleware]
  } as Parameters<typeof createDeepAgent>[0])

  console.log("[Runtime] Delegation subagents loaded:", delegationSubagents.length)
  console.log("[Runtime] Assigned skills loaded:", runtimeSkills.length)
  console.log("[Runtime] Custom script tools loaded:", customScriptTools.length)
  console.log("[Runtime] Deep agent created with LocalSandbox at:", workspacePath)
  return agent
}

export type DeepAgent = ReturnType<typeof createDeepAgent>

// Clean up all checkpointer resources
export async function closeRuntime(): Promise<void> {
  const closePromises = Array.from(checkpointers.values()).map((cp) => cp.close())
  await Promise.all(closePromises)
  checkpointers.clear()
}
