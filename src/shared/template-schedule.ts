export function parseRruleTokens(rrule: string): Record<string, string> {
  return rrule
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.includes("="))
    .reduce<Record<string, string>>((result, segment) => {
      const [rawKey, ...rawValueParts] = segment.split("=")
      const key = rawKey?.trim().toUpperCase()
      const value = rawValueParts.join("=").trim()
      if (!key || !value) {
        return result
      }
      result[key] = value
      return result
    }, {})
}

export function validateTemplateScheduleRrule(rrule: string): string | null {
  const trimmed = rrule.trim()
  if (!trimmed) {
    return null
  }

  const tokens = parseRruleTokens(trimmed)
  const freq = tokens.FREQ
  if (!freq) {
    return "RRULE must include FREQ."
  }

  if (freq === "HOURLY") {
    if (tokens.INTERVAL) {
      const interval = Number(tokens.INTERVAL)
      if (!Number.isFinite(interval) || interval <= 0) {
        return "HOURLY RRULE INTERVAL must be a positive number."
      }
    }

    const allowed = new Set(["FREQ", "INTERVAL", "BYDAY"])
    const invalidKey = Object.keys(tokens).find((key) => !allowed.has(key))
    if (invalidKey) {
      return `HOURLY RRULE contains unsupported field: ${invalidKey}.`
    }
    return null
  }

  if (freq === "WEEKLY") {
    if (!tokens.BYDAY) {
      return "WEEKLY RRULE must include BYDAY."
    }
    if (!tokens.BYHOUR || !tokens.BYMINUTE) {
      return "WEEKLY RRULE must include BYHOUR and BYMINUTE."
    }

    const hour = Number(tokens.BYHOUR)
    const minute = Number(tokens.BYMINUTE)
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      return "WEEKLY RRULE BYHOUR must be between 0 and 23."
    }
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
      return "WEEKLY RRULE BYMINUTE must be between 0 and 59."
    }

    const allowed = new Set(["FREQ", "BYDAY", "BYHOUR", "BYMINUTE"])
    const invalidKey = Object.keys(tokens).find((key) => !allowed.has(key))
    if (invalidKey) {
      return `WEEKLY RRULE contains unsupported field: ${invalidKey}.`
    }
    return null
  }

  return `Unsupported FREQ "${freq}". Use HOURLY or WEEKLY.`
}
