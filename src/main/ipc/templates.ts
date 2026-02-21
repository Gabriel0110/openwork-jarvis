import type { IpcMain } from "electron"
import { getThread } from "../db"
import { listTemplateScheduleRuns } from "../db/template-schedule-runs"
import {
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplates,
  updateWorkflowTemplate
} from "../db/templates"
import { createTimelineEvent } from "../db/timeline-events"
import { DEFAULT_WORKSPACE_ID, getWorkspace } from "../db/workspaces"
import { buildAutomationDirective, resolveAutomationCwd } from "../services/automation-directives"
import { executeWorkflowTemplate } from "../services/template-runner"
import { normalizeTemplateSchedule } from "../services/template-schedule"
import { normalizeTemplateTriggers } from "../services/template-triggers"
import type {
  WorkflowTemplateAutomationDirective,
  WorkflowTemplateAutomationDirectiveParams,
  WorkflowTemplateAutomationDraft,
  WorkflowTemplateAutomationDraftParams,
  WorkflowTemplate,
  WorkflowTemplateCreateParams,
  WorkflowTemplateDeleteParams,
  WorkflowTemplateExportBundle,
  WorkflowTemplateImportParams,
  WorkflowTemplateListParams,
  WorkflowTemplateScheduleRunListParams,
  WorkflowTemplateScheduleRun,
  WorkflowTemplateRunParams,
  WorkflowTemplateRunResult,
  WorkflowTemplateUpdateParams
} from "../types"

function parseJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined
  }
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function buildUniqueImportedName(candidateName: string, existingNames: Set<string>): string {
  const baseName = candidateName.trim() || "Imported Template"
  if (!existingNames.has(baseName)) {
    existingNames.add(baseName)
    return baseName
  }

  let index = 2
  let nextName = `${baseName} (${index})`
  while (existingNames.has(nextName)) {
    index += 1
    nextName = `${baseName} (${index})`
  }
  existingNames.add(nextName)
  return nextName
}

function buildAutomationDraftFromTemplate(
  template: WorkflowTemplate
): WorkflowTemplateAutomationDraft {
  const schedule = normalizeTemplateSchedule(template.schedule)
  if (!schedule?.rrule) {
    throw new Error(`Template "${template.name}" has no RRULE schedule to export.`)
  }

  return {
    name: `${template.name} Schedule`,
    prompt: `Run workflow template "${template.name}" and deliver its expected artifacts.`,
    rrule: schedule.rrule,
    timezone: schedule.timezone || "UTC",
    status: schedule.enabled ? "ACTIVE" : "PAUSED",
    template: {
      id: template.id,
      name: template.name,
      workspaceId: template.workspaceId
    }
  }
}

function resolveThreadWorkspacePath(threadId: string | undefined): string | undefined {
  if (!threadId) {
    return undefined
  }

  const thread = getThread(threadId)
  if (!thread?.metadata) {
    return undefined
  }

  const metadata = parseJsonObject(thread.metadata)
  const workspacePath = metadata?.workspacePath
  return typeof workspacePath === "string" && workspacePath.trim().length > 0
    ? workspacePath.trim()
    : undefined
}

export function registerTemplateHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("templates:list", async (_event, params?: WorkflowTemplateListParams) => {
    const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
    return listWorkflowTemplates(workspaceId)
  })

  ipcMain.handle(
    "templates:listScheduleRuns",
    async (
      _event,
      params?: WorkflowTemplateScheduleRunListParams
    ): Promise<WorkflowTemplateScheduleRun[]> => {
      const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
      return listTemplateScheduleRuns(workspaceId, {
        templateId: params?.templateId,
        limit: params?.limit
      })
    }
  )

  ipcMain.handle("templates:get", async (_event, templateId: string) => {
    return getWorkflowTemplate(templateId)
  })

  ipcMain.handle("templates:create", async (_event, params: WorkflowTemplateCreateParams) => {
    const schedule = normalizeTemplateSchedule(params.schedule)
    const triggers = normalizeTemplateTriggers(params.triggers)
    return createWorkflowTemplate({
      ...params,
      workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
      schedule,
      triggers
    })
  })

  ipcMain.handle(
    "templates:update",
    async (_event, { templateId, updates }: WorkflowTemplateUpdateParams) => {
      const normalizedUpdates = { ...updates }
      if (Object.prototype.hasOwnProperty.call(updates, "schedule")) {
        normalizedUpdates.schedule = normalizeTemplateSchedule(updates.schedule)
      }
      if (Object.prototype.hasOwnProperty.call(updates, "triggers")) {
        normalizedUpdates.triggers = normalizeTemplateTriggers(updates.triggers)
      }

      const updated = updateWorkflowTemplate(templateId, normalizedUpdates)
      if (!updated) {
        throw new Error("Template not found")
      }
      return updated
    }
  )

  ipcMain.handle(
    "templates:delete",
    async (_event, { templateId }: WorkflowTemplateDeleteParams) => {
      deleteWorkflowTemplate(templateId)
    }
  )

  ipcMain.handle("templates:exportBundle", async (_event, params?: WorkflowTemplateListParams) => {
    const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
    const templates = listWorkflowTemplates(workspaceId)
    const bundle: WorkflowTemplateExportBundle = {
      version: "1",
      exportedAt: new Date().toISOString(),
      workspaceId,
      templates
    }
    return bundle
  })

  ipcMain.handle("templates:importBundle", async (_event, params: WorkflowTemplateImportParams) => {
    const bundle = params?.bundle
    if (!bundle || !Array.isArray(bundle.templates)) {
      throw new Error("Invalid template bundle.")
    }

    const workspaceId = bundle.workspaceId || DEFAULT_WORKSPACE_ID
    const existingNames = new Set(
      listWorkflowTemplates(workspaceId)
        .map((template) => template.name.trim())
        .filter((value) => value.length > 0)
    )

    const imported: WorkflowTemplate[] = []
    for (const template of bundle.templates) {
      if (!template?.name) {
        continue
      }

      imported.push(
        createWorkflowTemplate({
          workspaceId,
          name: buildUniqueImportedName(template.name, existingNames),
          description: template.description,
          starterPrompts: template.starterPrompts,
          agentIds: template.agentIds,
          requiredConnectorKeys: template.requiredConnectorKeys,
          expectedArtifacts: template.expectedArtifacts,
          defaultSpeakerType: template.defaultSpeakerType,
          defaultSpeakerAgentId: template.defaultSpeakerAgentId,
          defaultModelId: template.defaultModelId,
          policyDefaults: template.policyDefaults,
          memoryDefaults: template.memoryDefaults,
          schedule: normalizeTemplateSchedule(template.schedule),
          triggers: normalizeTemplateTriggers(template.triggers),
          tags: template.tags
        })
      )
    }

    return imported
  })

  ipcMain.handle(
    "templates:buildAutomationDraft",
    async (_event, params: WorkflowTemplateAutomationDraftParams) => {
      const template = getWorkflowTemplate(params.templateId)
      if (!template) {
        throw new Error("Template not found")
      }

      return buildAutomationDraftFromTemplate(template)
    }
  )

  ipcMain.handle(
    "templates:buildAutomationDirective",
    async (
      _event,
      params: WorkflowTemplateAutomationDirectiveParams
    ): Promise<WorkflowTemplateAutomationDirective> => {
      const template = getWorkflowTemplate(params.templateId)
      if (!template) {
        throw new Error("Template not found")
      }

      const draft = buildAutomationDraftFromTemplate(template)
      const threadWorkspacePath = resolveThreadWorkspacePath(params.threadId)
      const workspaceRootPath = getWorkspace(template.workspaceId)?.root_path || undefined
      const cwdResolution = resolveAutomationCwd({
        explicitCwd: params.cwd,
        threadWorkspacePath,
        workspaceRootPath,
        workspaceId: template.workspaceId
      })

      return {
        draft,
        directive: buildAutomationDirective(draft, cwdResolution.cwd),
        cwd: cwdResolution.cwd,
        usedFallbackCwd: cwdResolution.usedFallbackCwd
      }
    }
  )

  ipcMain.handle(
    "templates:run",
    async (_event, params: WorkflowTemplateRunParams): Promise<WorkflowTemplateRunResult> => {
      const template = getWorkflowTemplate(params.templateId)
      if (!template) {
        throw new Error("Template not found")
      }

      const runResult = executeWorkflowTemplate(template, { title: params.title })
      if (runResult.status === "blocked") {
        return {
          status: "blocked",
          templateId: template.id,
          templateName: template.name,
          missingConnectors: runResult.missingConnectors,
          appliedPolicies: runResult.appliedPolicies,
          seededMemoryEntries: runResult.seededMemoryEntries
        }
      }

      createTimelineEvent({
        threadId: runResult.thread!.thread_id,
        workspaceId: template.workspaceId,
        eventType: "tool_call",
        toolName: "template:run",
        summary: `Template run started: ${template.name}`,
        payload: {
          templateId: template.id,
          templateName: template.name
        }
      })

      createTimelineEvent({
        threadId: runResult.thread!.thread_id,
        workspaceId: template.workspaceId,
        eventType: "tool_result",
        toolName: "template:run",
        summary: `Applied ${runResult.appliedPolicies} policy defaults and seeded ${runResult.seededMemoryEntries} memory entries.`,
        payload: {
          templateId: template.id,
          appliedPolicies: runResult.appliedPolicies,
          seededMemoryEntries: runResult.seededMemoryEntries
        }
      })

      return {
        status: "started",
        templateId: template.id,
        templateName: template.name,
        thread: runResult.thread,
        appliedPolicies: runResult.appliedPolicies,
        seededMemoryEntries: runResult.seededMemoryEntries
      }
    }
  )
}
