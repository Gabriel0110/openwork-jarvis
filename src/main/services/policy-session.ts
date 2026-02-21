import type { PolicyAction, PolicyResourceType } from "../types"

interface PolicySessionKey {
  threadId: string
  agentId?: string
  resourceType: PolicyResourceType
  resourceKey: string
  action: PolicyAction
}

interface RateLimitConsumeParams extends PolicySessionKey {
  maxCalls: number
  windowMs: number
}

export interface RateLimitConsumeResult {
  allowed: boolean
  remaining: number
  retryAfterMs?: number
}

const sessionGrantsByThread = new Map<string, Set<string>>()
const rateLimitEventsByKey = new Map<string, number[]>()

function normalizeAgentId(agentId?: string): string {
  return agentId || "__default__"
}

function buildPolicySessionKey(params: PolicySessionKey): string {
  return [
    normalizeAgentId(params.agentId),
    params.resourceType,
    params.resourceKey,
    params.action
  ].join(":")
}

function buildRateLimitKey(params: RateLimitConsumeParams): string {
  return [
    params.threadId,
    normalizeAgentId(params.agentId),
    params.resourceType,
    params.resourceKey,
    params.action,
    String(params.maxCalls),
    String(params.windowMs)
  ].join(":")
}

export function grantPolicySessionAccess(params: PolicySessionKey): void {
  const key = buildPolicySessionKey(params)
  const existing = sessionGrantsByThread.get(params.threadId)
  if (existing) {
    existing.add(key)
    return
  }

  sessionGrantsByThread.set(params.threadId, new Set([key]))
}

export function hasPolicySessionAccess(params: PolicySessionKey): boolean {
  const key = buildPolicySessionKey(params)
  return sessionGrantsByThread.get(params.threadId)?.has(key) ?? false
}

export function consumePolicyRateLimit(params: RateLimitConsumeParams): RateLimitConsumeResult {
  const now = Date.now()
  const windowStart = now - params.windowMs
  const key = buildRateLimitKey(params)

  const existing = rateLimitEventsByKey.get(key) || []
  const inWindow = existing.filter((timestamp) => timestamp >= windowStart)

  if (inWindow.length >= params.maxCalls) {
    const oldest = inWindow[0]
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + params.windowMs - now)
    }
  }

  inWindow.push(now)
  rateLimitEventsByKey.set(key, inWindow)

  return {
    allowed: true,
    remaining: Math.max(0, params.maxCalls - inWindow.length)
  }
}

export function clearPolicyThreadSession(threadId: string): void {
  sessionGrantsByThread.delete(threadId)

  const prefix = `${threadId}:`
  for (const key of rateLimitEventsByKey.keys()) {
    if (key.startsWith(prefix)) {
      rateLimitEventsByKey.delete(key)
    }
  }
}

export function clearAllPolicySessions(): void {
  sessionGrantsByThread.clear()
  rateLimitEventsByKey.clear()
}
