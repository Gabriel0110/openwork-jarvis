import { describe, expect, it } from "vitest"
import {
  normalizeTemplateSchedule,
  validateTemplateScheduleRrule
} from "../../src/main/services/template-schedule"

describe("template schedule validation", () => {
  it("accepts supported hourly and weekly rrules", () => {
    expect(validateTemplateScheduleRrule("FREQ=HOURLY;INTERVAL=2")).toBeNull()
    expect(
      validateTemplateScheduleRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=30")
    ).toBeNull()
  })

  it("rejects unsupported or malformed rrules", () => {
    expect(validateTemplateScheduleRrule("INTERVAL=2")).toMatch("FREQ")
    expect(validateTemplateScheduleRrule("FREQ=DAILY;BYHOUR=9")).toMatch("Unsupported FREQ")
    expect(validateTemplateScheduleRrule("FREQ=WEEKLY;BYDAY=MO")).toMatch("BYHOUR and BYMINUTE")
    expect(validateTemplateScheduleRrule("FREQ=HOURLY;COUNT=3")).toMatch("unsupported field")
  })
})

describe("template schedule normalization", () => {
  it("normalizes valid schedule values", () => {
    const normalized = normalizeTemplateSchedule({
      enabled: true,
      rrule: " FREQ=HOURLY;INTERVAL=1 ",
      timezone: " America/New_York "
    })

    expect(normalized).toEqual({
      enabled: true,
      rrule: "FREQ=HOURLY;INTERVAL=1",
      timezone: "America/New_York"
    })
  })

  it("returns undefined for empty disabled schedules", () => {
    const normalized = normalizeTemplateSchedule({
      enabled: false,
      rrule: "  ",
      timezone: " "
    })
    expect(normalized).toBeUndefined()
  })

  it("throws when an enabled schedule has no rrule", () => {
    expect(() =>
      normalizeTemplateSchedule({
        enabled: true
      })
    ).toThrow("RRULE")
  })
})
