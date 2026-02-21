import type { PolicyDecision, PolicyRule } from "@/types"

export type ToolPolicyAction = "read" | "write" | "exec"

export interface ToolPolicyRow {
  tool: string
  action: ToolPolicyAction
  label: string
  riskTier: "tier0" | "tier1" | "tier2"
}

export const TOOL_POLICY_ROWS: ToolPolicyRow[] = [
  { tool: "ls", action: "read", label: "List Directory", riskTier: "tier0" },
  { tool: "read_file", action: "read", label: "Read File", riskTier: "tier0" },
  { tool: "glob", action: "read", label: "Find Files", riskTier: "tier0" },
  { tool: "grep", action: "read", label: "Search Content", riskTier: "tier0" },
  { tool: "write_file", action: "write", label: "Write File", riskTier: "tier1" },
  { tool: "edit_file", action: "write", label: "Edit File", riskTier: "tier1" },
  { tool: "write_todos", action: "write", label: "Update Todos", riskTier: "tier1" },
  { tool: "execute", action: "exec", label: "Execute Command", riskTier: "tier2" },
  { tool: "task", action: "exec", label: "Spawn Subagent Task", riskTier: "tier2" }
]

export function getDefaultToolDecision(tool: string): PolicyDecision {
  if (tool === "execute" || tool === "write_file" || tool === "edit_file" || tool === "task") {
    return "ask"
  }
  return "allow"
}

export interface PolicyConstraintDraft {
  pathRegex: string
  domainAllowlist: string
  rateLimitMaxCalls: string
  rateLimitWindowSeconds: string
}

export interface PolicyConstraintValidation {
  pathRegexError?: string
  domainAllowlistError?: string
  rateLimitMaxCallsError?: string
  rateLimitWindowSecondsError?: string
  hasError: boolean
}

export type PolicyPresetId = "read_only_strict" | "safe_write" | "dev_exec"

interface PolicyPresetRule {
  decision: PolicyDecision
  constraints: PolicyConstraintDraft
}

export interface PolicyPreset {
  id: PolicyPresetId
  label: string
  description: string
  byAction: Record<ToolPolicyAction, PolicyPresetRule>
}

export function createEmptyConstraintDraft(): PolicyConstraintDraft {
  return {
    pathRegex: "",
    domainAllowlist: "",
    rateLimitMaxCalls: "",
    rateLimitWindowSeconds: ""
  }
}

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: "read_only_strict",
    label: "Read-Only Strict",
    description: "Read allowed. Write and execute denied.",
    byAction: {
      read: {
        decision: "allow",
        constraints: createEmptyConstraintDraft()
      },
      write: {
        decision: "deny",
        constraints: createEmptyConstraintDraft()
      },
      exec: {
        decision: "deny",
        constraints: createEmptyConstraintDraft()
      }
    }
  },
  {
    id: "safe_write",
    label: "Safe Write",
    description: "Read allowed. Write and execute require approvals.",
    byAction: {
      read: {
        decision: "allow",
        constraints: createEmptyConstraintDraft()
      },
      write: {
        decision: "ask",
        constraints: createEmptyConstraintDraft()
      },
      exec: {
        decision: "ask",
        constraints: {
          ...createEmptyConstraintDraft(),
          rateLimitMaxCalls: "3",
          rateLimitWindowSeconds: "60"
        }
      }
    }
  },
  {
    id: "dev_exec",
    label: "Dev Exec",
    description: "Read allowed. Write/execute allowed within session with guardrails.",
    byAction: {
      read: {
        decision: "allow",
        constraints: createEmptyConstraintDraft()
      },
      write: {
        decision: "allow_in_session",
        constraints: createEmptyConstraintDraft()
      },
      exec: {
        decision: "allow_in_session",
        constraints: {
          ...createEmptyConstraintDraft(),
          rateLimitMaxCalls: "10",
          rateLimitWindowSeconds: "60"
        }
      }
    }
  }
]

function toCsv(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (!Array.isArray(value)) {
    return ""
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(", ")
}

function toRateLimitConstraints(value: unknown): { maxCalls: string; windowSeconds: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { maxCalls: "", windowSeconds: "" }
  }

  const rateLimit = value as Record<string, unknown>
  const maxCalls =
    typeof rateLimit.maxCalls === "number" && rateLimit.maxCalls > 0
      ? String(rateLimit.maxCalls)
      : ""
  const windowSecondsFromMs =
    typeof rateLimit.windowMs === "number" && rateLimit.windowMs > 0
      ? Math.ceil(rateLimit.windowMs / 1000)
      : null
  const windowSecondsRaw =
    typeof rateLimit.windowSeconds === "number" && rateLimit.windowSeconds > 0
      ? rateLimit.windowSeconds
      : null
  const windowSeconds = windowSecondsRaw || windowSecondsFromMs

  return {
    maxCalls,
    windowSeconds: windowSeconds ? String(windowSeconds) : ""
  }
}

export function policyToConstraintDraft(policy?: PolicyRule): PolicyConstraintDraft {
  const constraints = policy?.constraints || {}
  const rateLimit = toRateLimitConstraints(constraints.rateLimit)

  return {
    pathRegex: toCsv(constraints.pathRegex),
    domainAllowlist: toCsv(constraints.domainAllowlist),
    rateLimitMaxCalls: rateLimit.maxCalls,
    rateLimitWindowSeconds: rateLimit.windowSeconds
  }
}

export function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function isIntegerString(value: string): boolean {
  return /^\d+$/.test(value.trim())
}

function isValidDomainEntry(value: string): boolean {
  const normalized = value.trim().replace(/^\*\./, "")
  if (!normalized || normalized.includes("://") || normalized.includes("/")) {
    return false
  }
  return /^[a-zA-Z0-9.-]+$/.test(normalized) && normalized.includes(".")
}

export function validateConstraintDraft(draft: PolicyConstraintDraft): PolicyConstraintValidation {
  const validation: PolicyConstraintValidation = {
    hasError: false
  }

  const regexEntries = parseCsv(draft.pathRegex)
  for (const pattern of regexEntries) {
    try {
      new RegExp(pattern)
    } catch {
      validation.pathRegexError = `Invalid regex: ${pattern}`
      validation.hasError = true
      break
    }
  }

  const domainEntries = parseCsv(draft.domainAllowlist)
  const invalidDomain = domainEntries.find((domain) => !isValidDomainEntry(domain))
  if (invalidDomain) {
    validation.domainAllowlistError = `Invalid domain entry: ${invalidDomain}`
    validation.hasError = true
  }

  const hasMaxCalls = draft.rateLimitMaxCalls.trim().length > 0
  const hasWindowSeconds = draft.rateLimitWindowSeconds.trim().length > 0

  if (hasMaxCalls !== hasWindowSeconds) {
    const message = "Set both max calls and window seconds, or leave both empty."
    validation.rateLimitMaxCallsError = message
    validation.rateLimitWindowSecondsError = message
    validation.hasError = true
  } else if (hasMaxCalls && hasWindowSeconds) {
    if (!isIntegerString(draft.rateLimitMaxCalls) || Number(draft.rateLimitMaxCalls) <= 0) {
      validation.rateLimitMaxCallsError = "Max calls must be a positive integer."
      validation.hasError = true
    }
    if (
      !isIntegerString(draft.rateLimitWindowSeconds) ||
      Number(draft.rateLimitWindowSeconds) <= 0
    ) {
      validation.rateLimitWindowSecondsError = "Window must be a positive integer in seconds."
      validation.hasError = true
    }
  }

  return validation
}

export function areConstraintDraftsEqual(
  a: PolicyConstraintDraft,
  b: PolicyConstraintDraft
): boolean {
  return (
    a.pathRegex === b.pathRegex &&
    a.domainAllowlist === b.domainAllowlist &&
    a.rateLimitMaxCalls === b.rateLimitMaxCalls &&
    a.rateLimitWindowSeconds === b.rateLimitWindowSeconds
  )
}

export function constraintDraftToPolicy(draft: PolicyConstraintDraft): Record<string, unknown> {
  const constraints: Record<string, unknown> = {}

  const pathRegex = parseCsv(draft.pathRegex)
  if (pathRegex.length > 0) {
    constraints.pathRegex = pathRegex
  }

  const domainAllowlist = parseCsv(draft.domainAllowlist)
  if (domainAllowlist.length > 0) {
    constraints.domainAllowlist = domainAllowlist
  }

  const maxCalls = Number(draft.rateLimitMaxCalls)
  const windowSeconds = Number(draft.rateLimitWindowSeconds)
  if (
    Number.isInteger(maxCalls) &&
    maxCalls > 0 &&
    Number.isInteger(windowSeconds) &&
    windowSeconds > 0
  ) {
    constraints.rateLimit = {
      maxCalls,
      windowSeconds
    }
  }

  return constraints
}

export function getPolicyKey(tool: string, action: ToolPolicyAction): string {
  return `${tool}:${action}`
}
