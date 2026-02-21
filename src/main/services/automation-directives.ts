import type { WorkflowTemplateAutomationDraft } from "../types"

export interface ResolveAutomationCwdParams {
  explicitCwd?: string
  threadWorkspacePath?: string
  workspaceRootPath?: string
  workspaceId: string
}

export interface ResolveAutomationCwdResult {
  cwd: string
  usedFallbackCwd: boolean
}

export function normalizeAutomationPrompt(prompt: string): string {
  return prompt
    .replace(/\s+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim()
}

export function escapeDirectiveValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
}

export function buildAutomationDirective(
  draft: WorkflowTemplateAutomationDraft,
  cwd: string
): string {
  const name = escapeDirectiveValue(draft.name)
  const prompt = escapeDirectiveValue(normalizeAutomationPrompt(draft.prompt))
  const rrule = escapeDirectiveValue(draft.rrule)
  const escapedCwd = escapeDirectiveValue(cwd)
  const escapedTimezone = escapeDirectiveValue(draft.timezone || "UTC")

  return [
    `::automation-update{mode="suggested create" name="${name}" prompt="${prompt}" rrule="${rrule}" cwds="${escapedCwd}" status="${draft.status}"}`,
    `# timezone: ${escapedTimezone}`
  ].join("\n")
}

export function resolveAutomationCwd(
  params: ResolveAutomationCwdParams
): ResolveAutomationCwdResult {
  const candidates = [params.explicitCwd, params.threadWorkspacePath, params.workspaceRootPath]
  for (const candidate of candidates) {
    const normalized = candidate?.trim()
    if (normalized) {
      return { cwd: normalized, usedFallbackCwd: false }
    }
  }

  return {
    cwd: params.workspaceId,
    usedFallbackCwd: true
  }
}
