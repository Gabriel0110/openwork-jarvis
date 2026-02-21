import { parseRruleTokens, validateTemplateScheduleRrule } from "./template-schedule"

const DAY_CODE_TO_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function toPartsMap(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })

  return formatter.formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") {
      result[part.type] = part.value
    }
    return result
  }, {})
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = toPartsMap(date, timeZone)
  const normalizedHour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: normalizedHour,
    minute: Number(parts.minute),
    second: Number(parts.second)
  }
}

function getTimeZoneOffsetMs(utcTimestamp: number, timeZone: string): number {
  const zonedParts = getZonedDateParts(new Date(utcTimestamp), timeZone)
  const asUtcTimestamp = Date.UTC(
    zonedParts.year,
    zonedParts.month - 1,
    zonedParts.day,
    zonedParts.hour,
    zonedParts.minute,
    zonedParts.second
  )
  return asUtcTimestamp - utcTimestamp
}

function zonedDateTimeToUtcMs(parts: ZonedDateParts, timeZone: string): number {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )

  let resolved = localAsUtc
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMs(resolved, timeZone)
    const next = localAsUtc - offset
    if (next === resolved) {
      break
    }
    resolved = next
  }

  return resolved
}

function getWeekdayIndex(parts: Pick<ZonedDateParts, "year" | "month" | "day">): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

function parseByDaySet(byDay: string | undefined): Set<number> | null {
  if (!byDay) {
    return null
  }

  const values = byDay
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0)
    .map((value) => DAY_CODE_TO_INDEX[value])
    .filter((value): value is number => Number.isFinite(value))

  return values.length > 0 ? new Set(values) : null
}

function getNextWeeklyRun(
  tokens: Record<string, string>,
  timezone: string,
  nowMs: number
): number | null {
  const byDaySet = parseByDaySet(tokens.BYDAY)
  if (!byDaySet || byDaySet.size === 0) {
    return null
  }

  const hour = Number(tokens.BYHOUR)
  const minute = Number(tokens.BYMINUTE)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null
  }

  for (let dayOffset = 0; dayOffset <= 21; dayOffset += 1) {
    const probe = new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000)
    const probeParts = getZonedDateParts(probe, timezone)
    const weekday = getWeekdayIndex(probeParts)
    if (!byDaySet.has(weekday)) {
      continue
    }

    const candidateTs = zonedDateTimeToUtcMs(
      {
        ...probeParts,
        hour,
        minute,
        second: 0
      },
      timezone
    )

    if (candidateTs > nowMs) {
      return candidateTs
    }
  }

  return null
}

function getNextHourlyRun(
  tokens: Record<string, string>,
  timezone: string,
  nowMs: number
): number | null {
  const interval = Number(tokens.INTERVAL || "1")
  if (!Number.isFinite(interval) || interval <= 0) {
    return null
  }

  const byDaySet = parseByDaySet(tokens.BYDAY)
  const nowParts = getZonedDateParts(new Date(nowMs), timezone)

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const probe = new Date(nowMs + dayOffset * 24 * 60 * 60 * 1000)
    const probeParts = getZonedDateParts(probe, timezone)
    const weekday = getWeekdayIndex(probeParts)

    if (byDaySet && !byDaySet.has(weekday)) {
      continue
    }

    const startHour = dayOffset === 0 ? nowParts.hour : 0
    for (let hour = startHour; hour < 24; hour += 1) {
      if (hour % interval !== 0) {
        continue
      }

      const candidateTs = zonedDateTimeToUtcMs(
        {
          ...probeParts,
          hour,
          minute: 0,
          second: 0
        },
        timezone
      )
      if (candidateTs > nowMs) {
        return candidateTs
      }
    }
  }

  return null
}

export function getNextTemplateScheduleRunTimestamp(
  rrule: string,
  timezone: string,
  nowMs: number = Date.now()
): number | null {
  const validationError = validateTemplateScheduleRrule(rrule)
  if (validationError) {
    return null
  }

  const tokens = parseRruleTokens(rrule.trim())
  const freq = tokens.FREQ
  if (freq === "WEEKLY") {
    return getNextWeeklyRun(tokens, timezone, nowMs)
  }
  if (freq === "HOURLY") {
    return getNextHourlyRun(tokens, timezone, nowMs)
  }

  return null
}
