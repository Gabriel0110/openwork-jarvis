import { readFileSync } from "node:fs"
import type { PromptRenderPreview } from "../types"

export interface PromptRenderContext {
  workspaceId?: string
  workspaceName?: string
  workspaceRoot?: string
  agentId?: string
  agentName?: string
  agentRole?: string
  variables?: Record<string, string>
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function formatLocalDate(now: Date): string {
  return now.toLocaleString()
}

function buildBuiltInVariables(context: PromptRenderContext): Record<string, string> {
  const now = new Date()
  return {
    workspace_id: context.workspaceId || "",
    workspace_name: context.workspaceName || "",
    workspace_root: context.workspaceRoot || "",
    agent_id: context.agentId || "",
    agent_name: context.agentName || "",
    agent_role: context.agentRole || "",
    date_iso: now.toISOString(),
    date_local: formatLocalDate(now)
  }
}

function renderTemplate(
  content: string,
  variables: Record<string, string>
): Pick<PromptRenderPreview, "content" | "unknownVariables"> {
  const unknownVariables = new Set<string>()
  const rendered = content.replace(VARIABLE_PATTERN, (_match, variableName: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, variableName)) {
      return variables[variableName] || ""
    }
    unknownVariables.add(variableName)
    return ""
  })

  return {
    content: rendered,
    unknownVariables: Array.from(unknownVariables.values())
  }
}

export function renderPromptContent(
  content: string,
  context: PromptRenderContext = {}
): PromptRenderPreview {
  const builtInVariables = buildBuiltInVariables(context)
  const userVariables = context.variables || {}
  const variables = {
    ...builtInVariables,
    ...userVariables
  }

  const rendered = renderTemplate(content, variables)
  const warnings =
    rendered.unknownVariables.length > 0
      ? [`Unknown variables were blanked: ${rendered.unknownVariables.join(", ")}`]
      : []

  return {
    content: rendered.content,
    warnings,
    variables,
    unknownVariables: rendered.unknownVariables
  }
}

export function renderPromptFile(
  contentPath: string,
  context: PromptRenderContext = {}
): PromptRenderPreview {
  const content = readFileSync(contentPath, "utf-8")
  return renderPromptContent(content, context)
}
