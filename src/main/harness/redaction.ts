const API_KEY_PATTERNS = [
  /\bsk-[a-z0-9]{20,}\b/gi,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\bghp_[0-9A-Za-z]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g
]

const SECRET_FIELD_PATTERNS = [
  /(api[_-]?key"\s*:\s*")[^"]+(")/gi,
  /(token"\s*:\s*")[^"]+(")/gi,
  /(secret"\s*:\s*")[^"]+(")/gi,
  /(password"\s*:\s*")[^"]+(")/gi
]

const HOME_PATH_PATTERNS = [/\/Users\/[^/\s"']+/g, /\/home\/[^/\s"']+/g]

function redactString(raw: string): string {
  let value = raw
  for (const pattern of API_KEY_PATTERNS) {
    value = value.replace(pattern, "[REDACTED_KEY]")
  }
  for (const pattern of SECRET_FIELD_PATTERNS) {
    value = value.replace(pattern, `$1[REDACTED]$2`)
  }
  for (const pattern of HOME_PATH_PATTERNS) {
    value = value.replace(pattern, "/$HOME")
  }
  return value
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item))
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(record)) {
      if (/(secret|token|password|api[_-]?key)/i.test(key)) {
        next[key] = "[REDACTED]"
      } else {
        next[key] = redactUnknown(nested)
      }
    }
    return next
  }
  return value
}

export function redactHarnessPayload<T>(payload: T): T {
  return redactUnknown(payload) as T
}
