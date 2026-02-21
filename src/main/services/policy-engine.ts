import { isAbsolute, resolve as resolvePath } from "node:path"
import { listPoliciesByAgent } from "../db/policies"
import type {
  PolicyAction,
  PolicyDecision,
  PolicyResolveParams,
  PolicyResourceType,
  PolicyRule,
  PolicyScope,
  SecurityDefaults
} from "../types"

const DEFAULT_DECISIONS: Record<string, PolicyDecision> = {
  "tool:execute:exec": "ask",
  "tool:write_file:write": "ask",
  "tool:edit_file:write": "ask",
  "tool:task:exec": "ask",
  "filesystem:*:read": "allow",
  "filesystem:*:write": "ask",
  "network:*:exec": "ask",
  "network:*:post": "deny",
  "connector:*:post": "deny",
  "tool:*:read": "allow",
  "tool:*:write": "allow",
  "tool:*:exec": "allow"
}

export interface ResolvedPolicyDecision {
  decision: PolicyDecision
  source: "rule" | "default" | "security_default"
  matchedPolicyId?: string
  constraints: Record<string, unknown>
}

function scorePolicy(
  policy: PolicyRule,
  resourceKey: string,
  action: PolicyAction,
  scope: PolicyScope
): number {
  let score = 0

  if (policy.resourceKey === resourceKey) score += 100
  else if (policy.resourceKey === "*") score += 10
  else return -1

  if (policy.action !== action) return -1
  score += 50

  if (policy.scope === scope) score += 20
  else if (policy.scope === "global") score += 5
  else if (policy.scope !== scope) return -1

  return score
}

function getDefaultDecision(
  resourceType: PolicyResourceType,
  resourceKey: string,
  action: PolicyAction
): PolicyDecision {
  const exact = DEFAULT_DECISIONS[`${resourceType}:${resourceKey}:${action}`]
  if (exact) return exact

  const wildcard = DEFAULT_DECISIONS[`${resourceType}:*:${action}`]
  if (wildcard) return wildcard

  return "ask"
}

function applySecurityDefaultOverrides(
  params: {
    resourceType: PolicyResourceType
    resourceKey: string
    action: PolicyAction
    securityDefaults?: SecurityDefaults
  },
  decision: PolicyDecision
): PolicyDecision {
  const defaults = params.securityDefaults
  if (!defaults) {
    return decision
  }

  const isNetworkOrConnectorPost =
    params.action === "post" &&
    (params.resourceType === "network" || params.resourceType === "connector")
  if (defaults.denySocialPosting && isNetworkOrConnectorPost) {
    return "deny"
  }

  const isExecTool =
    params.resourceType === "tool" &&
    params.action === "exec" &&
    (params.resourceKey === "execute" || params.resourceKey === "task")
  const isNetworkExec = params.resourceType === "network" && params.action === "exec"
  if (defaults.requireExecApproval && (isExecTool || isNetworkExec) && decision === "allow") {
    return "ask"
  }

  const isNetworkApprovalTarget =
    params.resourceType === "network" ||
    (params.resourceType === "connector" && params.action === "post")
  if (defaults.requireNetworkApproval && isNetworkApprovalTarget && decision === "allow") {
    return "ask"
  }

  return decision
}

export function resolvePolicyDecision(params: PolicyResolveParams): ResolvedPolicyDecision {
  const scope = params.scope ?? "workspace"

  if (!params.agentId) {
    const defaultDecision = getDefaultDecision(
      params.resourceType,
      params.resourceKey,
      params.action
    )
    const decision = applySecurityDefaultOverrides(params, defaultDecision)
    return {
      decision,
      source: decision === defaultDecision ? "default" : "security_default",
      constraints: {}
    }
  }

  const policies = listPoliciesByAgent(params.agentId).filter(
    (policy) => policy.resourceType === params.resourceType
  )

  let best: PolicyRule | null = null
  let bestScore = -1

  for (const policy of policies) {
    const score = scorePolicy(policy, params.resourceKey, params.action, scope)
    if (score > bestScore) {
      best = policy
      bestScore = score
    }
  }

  if (best) {
    const decision = applySecurityDefaultOverrides(params, best.decision)
    return {
      decision,
      source: decision === best.decision ? "rule" : "security_default",
      matchedPolicyId: best.id,
      constraints: best.constraints || {}
    }
  }

  const defaultDecision = getDefaultDecision(params.resourceType, params.resourceKey, params.action)
  const decision = applySecurityDefaultOverrides(params, defaultDecision)
  return {
    decision,
    source: decision === defaultDecision ? "default" : "security_default",
    constraints: {}
  }
}

type ToolActionLookup = ReadonlyMap<string, PolicyAction> | Record<string, PolicyAction>

function getToolActionFromLookup(
  toolName: string,
  actionLookup?: ToolActionLookup
): PolicyAction | null {
  if (!actionLookup) {
    return null
  }

  if (actionLookup instanceof Map) {
    return actionLookup.get(toolName) || null
  }

  const action = actionLookup[toolName]
  return action || null
}

export function mapToolNameToAction(
  toolName: string,
  actionLookup?: ToolActionLookup
): PolicyAction {
  const explicitAction = getToolActionFromLookup(toolName, actionLookup)
  if (explicitAction) {
    return explicitAction
  }

  if (toolName === "execute" || toolName === "task") return "exec"
  if (toolName === "write_file" || toolName === "edit_file" || toolName === "write_todos") {
    return "write"
  }
  return "read"
}

export interface PolicyConstraintViolation {
  constraint: "pathRegex" | "domainAllowlist" | "rateLimit"
  message: string
}

export interface PolicyConstraintCheckResult {
  allowed: boolean
  violation?: PolicyConstraintViolation
}

export interface ConnectorInvocation {
  connectorKey: string
  action: PolicyAction
}

export interface PolicyConstraintCheckParams {
  resourceType: PolicyResourceType
  resourceKey: string
  constraints?: Record<string, unknown>
  toolArgs?: Record<string, unknown>
  workspacePath?: string
}

export interface ParsedRateLimitConstraint {
  maxCalls: number
  windowMs: number
}

const FILESYSTEM_TOOLS = new Set(["ls", "read_file", "write_file", "edit_file", "glob", "grep"])
const PATH_LIKE_KEY = /(path|file|dir|cwd|root)/i
const URL_PATTERN = /https?:\/\/[^\s"'`]+/g

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
}

function normalizePathCandidate(pathCandidate: string, workspacePath?: string): string {
  const raw = pathCandidate.trim()
  if (!raw) {
    return raw
  }

  const resolved = workspacePath && !isAbsolute(raw) ? resolvePath(workspacePath, raw) : raw
  return resolved.replace(/\\/g, "/")
}

function collectPathCandidates(value: unknown, out: string[], parentKey?: string, depth = 0): void {
  if (depth > 8 || value == null) {
    return
  }

  if (typeof value === "string") {
    if (parentKey && PATH_LIKE_KEY.test(parentKey)) {
      out.push(value)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathCandidates(item, out, parentKey, depth + 1)
    }
    return
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectPathCandidates(child, out, key, depth + 1)
    }
  }
}

function extractUrls(value: unknown, out: string[], depth = 0): void {
  if (depth > 8 || value == null) {
    return
  }

  if (typeof value === "string") {
    const matches = value.match(URL_PATTERN)
    if (matches?.length) {
      out.push(...matches)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractUrls(item, out, depth + 1)
    }
    return
  }

  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      extractUrls(child, out, depth + 1)
    }
  }
}

export function extractUrlsFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) {
    return []
  }

  const urls: string[] = []
  extractUrls(args, urls)
  return urls
}

export function isFilesystemToolName(
  toolName: string,
  additionalFilesystemTools?: ReadonlySet<string>
): boolean {
  return FILESYSTEM_TOOLS.has(toolName) || (additionalFilesystemTools?.has(toolName) ?? false)
}

function normalizeConnectorKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function asConnectorKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = normalizeConnectorKey(value)
  return normalized.length > 0 ? normalized : null
}

export function inferConnectorInvocation(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  knownConnectorKeys: string[] = []
): ConnectorInvocation | null {
  const argsConnectorKey =
    asConnectorKey(toolArgs?.connector) ||
    asConnectorKey(toolArgs?.connectorKey) ||
    asConnectorKey(toolArgs?.connector_id) ||
    asConnectorKey(toolArgs?.connectorId)

  if (argsConnectorKey) {
    return {
      connectorKey: argsConnectorKey,
      action: "post"
    }
  }

  const loweredToolName = toolName.toLowerCase()
  const prefixes = ["connector:", "connector_", "connector-"]
  for (const prefix of prefixes) {
    if (loweredToolName.startsWith(prefix)) {
      const raw = loweredToolName.slice(prefix.length)
      const connectorKey = asConnectorKey(raw)
      if (connectorKey) {
        return {
          connectorKey,
          action: "post"
        }
      }
    }
  }

  if (knownConnectorKeys.length > 0) {
    const normalizedKnown = knownConnectorKeys.map((key) => normalizeConnectorKey(key))
    const match = normalizedKnown.find((key) => loweredToolName.includes(key))
    if (match) {
      return {
        connectorKey: match,
        action: "post"
      }
    }
  }

  return null
}

function compileRegexList(rawRegex: unknown): RegExp[] {
  const regexes = asStringArray(rawRegex)
  const compiled: RegExp[] = []

  for (const pattern of regexes) {
    try {
      compiled.push(new RegExp(pattern))
    } catch {
      // Ignore invalid regex entries and continue validating the rest.
    }
  }

  return compiled
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "")
}

function isDomainAllowed(hostname: string, allowedDomain: string): boolean {
  const normalizedAllowed = normalizeDomain(allowedDomain)
  if (!normalizedAllowed) {
    return false
  }

  return hostname === normalizedAllowed || hostname.endsWith(`.${normalizedAllowed}`)
}

export function parseRateLimitConstraint(
  constraints: Record<string, unknown> | undefined
): ParsedRateLimitConstraint | null {
  if (!constraints) {
    return null
  }

  const rateLimit = constraints.rateLimit
  if (!rateLimit || typeof rateLimit !== "object" || Array.isArray(rateLimit)) {
    return null
  }

  const config = rateLimit as Record<string, unknown>
  const maxCallsRaw = config.maxCalls
  const windowMsRaw = config.windowMs
  const windowSecondsRaw = config.windowSeconds

  const maxCalls = Number(maxCallsRaw)
  const windowMs =
    Number(windowMsRaw) > 0
      ? Number(windowMsRaw)
      : Number(windowSecondsRaw) > 0
        ? Number(windowSecondsRaw) * 1000
        : 0

  if (!Number.isFinite(maxCalls) || !Number.isInteger(maxCalls) || maxCalls <= 0) {
    return null
  }

  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return null
  }

  return {
    maxCalls,
    windowMs
  }
}

export function evaluatePolicyConstraints(
  params: PolicyConstraintCheckParams
): PolicyConstraintCheckResult {
  const constraints = params.constraints || {}
  const toolArgs = params.toolArgs || {}

  if (
    (params.resourceType === "tool" && FILESYSTEM_TOOLS.has(params.resourceKey)) ||
    params.resourceType === "filesystem"
  ) {
    const regexes = compileRegexList(constraints.pathRegex)
    if (regexes.length > 0) {
      const pathCandidates: string[] = []
      collectPathCandidates(toolArgs, pathCandidates)

      for (const rawPath of pathCandidates) {
        const normalizedPath = normalizePathCandidate(rawPath, params.workspacePath)
        if (!normalizedPath) {
          continue
        }

        const matched = regexes.some((regex) => regex.test(normalizedPath))
        if (!matched) {
          return {
            allowed: false,
            violation: {
              constraint: "pathRegex",
              message: `Path "${rawPath}" is outside the policy path constraints.`
            }
          }
        }
      }
    }
  }

  const domainAllowlist = asStringArray(constraints.domainAllowlist)
  if (domainAllowlist.length > 0) {
    const urls = extractUrlsFromArgs(toolArgs)

    for (const urlValue of urls) {
      try {
        const hostname = new URL(urlValue).hostname.toLowerCase()
        const allowed = domainAllowlist.some((domain) => isDomainAllowed(hostname, domain))
        if (!allowed) {
          return {
            allowed: false,
            violation: {
              constraint: "domainAllowlist",
              message: `Domain "${hostname}" is not allowed by policy.`
            }
          }
        }
      } catch {
        // Ignore malformed URL fragments and keep checking.
      }
    }
  }

  return { allowed: true }
}
