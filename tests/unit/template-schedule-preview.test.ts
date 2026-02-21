import { describe, expect, it } from "vitest"
import { getNextTemplateScheduleRunTimestamp } from "../../src/shared/template-schedule-preview"

describe("getNextTemplateScheduleRunTimestamp", () => {
  it("calculates the next weekly run on the same day when still in the future", () => {
    const now = Date.UTC(2026, 1, 15, 8, 0, 0)
    const next = getNextTemplateScheduleRunTimestamp(
      "FREQ=WEEKLY;BYDAY=SU;BYHOUR=9;BYMINUTE=30",
      "UTC",
      now
    )

    expect(next).toBe(Date.UTC(2026, 1, 15, 9, 30, 0))
  })

  it("rolls weekly schedules to the next matching week when today has passed", () => {
    const now = Date.UTC(2026, 1, 15, 10, 0, 0)
    const next = getNextTemplateScheduleRunTimestamp(
      "FREQ=WEEKLY;BYDAY=SU;BYHOUR=9;BYMINUTE=30",
      "UTC",
      now
    )

    expect(next).toBe(Date.UTC(2026, 1, 22, 9, 30, 0))
  })

  it("estimates next hourly run using top-of-hour anchors", () => {
    const now = Date.UTC(2026, 1, 15, 5, 12, 0)
    const next = getNextTemplateScheduleRunTimestamp("FREQ=HOURLY;INTERVAL=4", "UTC", now)

    expect(next).toBe(Date.UTC(2026, 1, 15, 8, 0, 0))
  })

  it("respects BYDAY constraints for hourly schedules", () => {
    const now = Date.UTC(2026, 1, 15, 10, 0, 0) // Sunday
    const next = getNextTemplateScheduleRunTimestamp("FREQ=HOURLY;INTERVAL=2;BYDAY=MO", "UTC", now)

    expect(next).toBe(Date.UTC(2026, 1, 16, 0, 0, 0))
  })

  it("returns null for invalid schedules", () => {
    const now = Date.UTC(2026, 1, 15, 10, 0, 0)
    const next = getNextTemplateScheduleRunTimestamp("FREQ=DAILY;BYHOUR=9", "UTC", now)

    expect(next).toBeNull()
  })
})
