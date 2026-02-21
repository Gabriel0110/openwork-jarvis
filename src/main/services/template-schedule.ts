import type { WorkflowTemplateSchedule } from "../types"
import { validateTemplateScheduleRrule } from "../../shared/template-schedule"

export { validateTemplateScheduleRrule }

export function normalizeTemplateSchedule(
  schedule: WorkflowTemplateSchedule | undefined
): WorkflowTemplateSchedule | undefined {
  if (!schedule) {
    return undefined
  }

  const enabled = schedule.enabled === true
  const rrule = schedule.rrule?.trim() || ""
  const timezone = schedule.timezone?.trim() || ""

  if (enabled && !rrule) {
    throw new Error("Template schedule is enabled but RRULE is missing.")
  }
  if (rrule) {
    const validationError = validateTemplateScheduleRrule(rrule)
    if (validationError) {
      throw new Error(`Invalid template schedule RRULE: ${validationError}`)
    }
  }

  if (!enabled && !rrule && !timezone) {
    return undefined
  }

  return {
    enabled,
    rrule: rrule || undefined,
    timezone: timezone || undefined
  }
}
