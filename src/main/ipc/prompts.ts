import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { IpcMain } from "electron"
import Store from "electron-store"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { getAgent } from "../db/agents"
import {
  createPromptBinding,
  deletePromptBinding,
  getPromptAsset,
  getPromptBinding,
  listPromptAssets,
  listPromptBindings,
  listPromptMaterializations,
  updatePromptBinding
} from "../db/prompts"
import { DEFAULT_WORKSPACE_ID, getWorkspace } from "../db/workspaces"
import { getOpenworkDir } from "../storage"
import {
  materializeAllPromptBindings,
  materializePromptBinding
} from "../services/prompt-materializer"
import { listPromptLibrary, refreshPromptDiscovery } from "../services/prompt-registry"
import {
  createManagedPromptAsset,
  deleteManagedPromptAsset,
  getPromptAssetWithContent,
  updateManagedPromptAsset
} from "../services/prompt-registry"
import { renderPromptContent } from "../services/prompt-renderer"
import type {
  PromptAsset,
  PromptBootstrapCheckParams,
  PromptBootstrapCheckResult,
  PromptBindingCreateParams,
  PromptBindingDeleteParams,
  PromptBindingListParams,
  PromptBindingUpdateParams,
  PromptBinding,
  PromptCreateParams,
  PromptDeleteParams,
  PromptExportPackParams,
  PromptGetParams,
  PromptHistoryListParams,
  PromptImportPackParams,
  PromptListParams,
  PromptMaterializeAllParams,
  PromptMaterializeParams,
  PromptPack,
  PromptRenderPreviewParams,
  PromptUpdateParams
} from "../types"

const settingsStore = new Store({
  name: "settings",
  cwd: getOpenworkDir()
})

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message)
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`)
  }
  return value.trim()
}

function normalizeSlug(value: string): string {
  return value
    .replace(/\\/g, "/")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\/+|\/+$/g, "")
}

function buildUniqueSlug(baseSlug: string, taken: Set<string>): string {
  if (!taken.has(baseSlug)) {
    taken.add(baseSlug)
    return baseSlug
  }
  let index = 2
  while (taken.has(`${baseSlug}-${index}`)) {
    index += 1
  }
  const next = `${baseSlug}-${index}`
  taken.add(next)
  return next
}

function resolveWorkspaceId(value?: string): string {
  return value || DEFAULT_WORKSPACE_ID
}

function resolveWorkspaceRoot(workspaceId: string, explicitWorkspaceRoot?: string): string | null {
  if (explicitWorkspaceRoot && explicitWorkspaceRoot.trim().length > 0) {
    return explicitWorkspaceRoot.trim()
  }

  const workspace = getWorkspace(workspaceId)
  if (workspace?.root_path && workspace.root_path.trim().length > 0) {
    return workspace.root_path.trim()
  }

  const fallback = settingsStore.get("workspacePath", null)
  return typeof fallback === "string" && fallback.trim().length > 0 ? fallback.trim() : null
}

function serializePromptPack(pack: PromptPack, format: "json" | "yaml"): string {
  if (format === "yaml") {
    return stringifyYaml(pack)
  }
  return JSON.stringify(pack, null, 2)
}

function parsePromptPack(content: string, format?: "json" | "yaml"): PromptPack {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error("Prompt pack content is empty.")
  }

  let parsed: unknown
  if (format === "yaml") {
    parsed = parseYaml(trimmed)
  } else if (format === "json") {
    parsed = JSON.parse(trimmed)
  } else {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      parsed = parseYaml(trimmed)
    }
  }

  assertObject(parsed, "Invalid prompt pack payload.")
  if (parsed.version !== "1" || !Array.isArray(parsed.assets)) {
    throw new Error("Unsupported prompt pack format.")
  }

  return parsed as unknown as PromptPack
}

function collectManagedAssetsForExport(workspaceId: string): PromptAsset[] {
  return listPromptAssets(workspaceId).filter((asset) => {
    if (asset.source !== "managed") {
      return false
    }
    if (asset.scope === "global") {
      return true
    }
    return asset.workspaceId === workspaceId
  })
}

function checkBootstrap(params?: PromptBootstrapCheckParams): PromptBootstrapCheckResult {
  const workspaceId = resolveWorkspaceId(params?.workspaceId)
  const workspaceRoot = resolveWorkspaceRoot(workspaceId, params?.workspaceRoot)

  if (!workspaceRoot) {
    return {
      shouldSuggest: false,
      workspaceId,
      reason: "No workspace root configured."
    }
  }

  const agentsPath = join(workspaceRoot, "AGENTS.md")
  if (existsSync(agentsPath)) {
    return {
      shouldSuggest: false,
      workspaceId,
      workspaceRoot,
      reason: "Workspace already has AGENTS.md."
    }
  }

  return {
    shouldSuggest: true,
    workspaceId,
    workspaceRoot,
    reason: "Workspace root has no AGENTS.md file."
  }
}

export function registerPromptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("prompts:list", async (_event, params?: PromptListParams) => {
    refreshPromptDiscovery()
    return listPromptLibrary({
      ...params,
      workspaceId: resolveWorkspaceId(params?.workspaceId)
    })
  })

  ipcMain.handle("prompts:get", async (_event, params: PromptGetParams) => {
    const assetId = requireString(params?.assetId, "assetId")
    const detail = getPromptAssetWithContent(assetId)
    if (!detail) {
      throw new Error("Prompt asset not found.")
    }
    return detail
  })

  ipcMain.handle("prompts:create", async (_event, params: PromptCreateParams) => {
    assertObject(params, "Invalid create prompt payload.")
    requireString(params.title, "title")
    requireString(params.fileName, "fileName")
    requireString(params.content, "content")

    return createManagedPromptAsset({
      ...params,
      workspaceId: resolveWorkspaceId(params.workspaceId)
    })
  })

  ipcMain.handle("prompts:update", async (_event, params: PromptUpdateParams) => {
    assertObject(params, "Invalid update prompt payload.")
    requireString(params.assetId, "assetId")
    assertObject(params.updates || {}, "updates are required")
    return updateManagedPromptAsset(params)
  })

  ipcMain.handle("prompts:delete", async (_event, params: PromptDeleteParams) => {
    assertObject(params, "Invalid delete prompt payload.")
    requireString(params.assetId, "assetId")
    deleteManagedPromptAsset(params)
  })

  ipcMain.handle("prompts:refreshDiscovery", async () => {
    return refreshPromptDiscovery()
  })

  ipcMain.handle("prompts:renderPreview", async (_event, params: PromptRenderPreviewParams) => {
    const workspaceId = resolveWorkspaceId(params.workspaceId)
    const workspace = getWorkspace(workspaceId)
    const agent = params.agentId ? getAgent(params.agentId) : null

    if (params.assetId) {
      const detail = getPromptAssetWithContent(params.assetId)
      if (!detail) {
        throw new Error("Prompt asset not found.")
      }
      return renderPromptContent(detail.content, {
        workspaceId,
        workspaceName: workspace?.name,
        workspaceRoot: params.workspaceRoot || workspace?.root_path || undefined,
        agentId: agent?.agent_id,
        agentName: agent?.name,
        agentRole: agent?.role,
        variables: params.variables
      })
    }

    if (!params.content) {
      throw new Error("content or assetId is required for preview.")
    }

    return renderPromptContent(params.content, {
      workspaceId,
      workspaceName: workspace?.name,
      workspaceRoot: params.workspaceRoot || workspace?.root_path || undefined,
      agentId: agent?.agent_id,
      agentName: agent?.name,
      agentRole: agent?.role,
      variables: params.variables
    })
  })

  ipcMain.handle("prompts:bindings:list", async (_event, params?: PromptBindingListParams) => {
    const workspaceId = resolveWorkspaceId(params?.workspaceId)
    return listPromptBindings(workspaceId)
  })

  ipcMain.handle("prompts:bindings:create", async (_event, params: PromptBindingCreateParams) => {
    assertObject(params, "Invalid binding payload.")
    const assetId = requireString(params.assetId, "assetId")
    const workspaceId = resolveWorkspaceId(params.workspaceId)
    const asset = getPromptAsset(assetId)
    if (!asset) {
      throw new Error("Prompt asset not found.")
    }

    if (params.targetType === "agent") {
      const agentId = requireString(params.targetAgentId, "targetAgentId")
      if (!getAgent(agentId)) {
        throw new Error("Target agent not found.")
      }
    }

    return createPromptBinding({
      assetId,
      workspaceId,
      targetType: params.targetType,
      targetAgentId: params.targetAgentId,
      materializeMode: params.materializeMode,
      relativeOutputPath: params.relativeOutputPath,
      enabled: params.enabled
    })
  })

  ipcMain.handle("prompts:bindings:update", async (_event, params: PromptBindingUpdateParams) => {
    assertObject(params, "Invalid binding update payload.")
    const bindingId = requireString(params.bindingId, "bindingId")
    if (params.updates.targetType === "agent") {
      const agentId = requireString(params.updates.targetAgentId, "targetAgentId")
      if (!getAgent(agentId)) {
        throw new Error("Target agent not found.")
      }
    }

    const updated = updatePromptBinding(bindingId, params.updates)
    if (!updated) {
      throw new Error("Prompt binding not found.")
    }
    return updated
  })

  ipcMain.handle("prompts:bindings:delete", async (_event, params: PromptBindingDeleteParams) => {
    assertObject(params, "Invalid binding delete payload.")
    requireString(params.bindingId, "bindingId")
    deletePromptBinding(params.bindingId)
  })

  ipcMain.handle("prompts:materialize", async (_event, params: PromptMaterializeParams) => {
    assertObject(params, "Invalid materialize payload.")
    const bindingId = requireString(params.bindingId, "bindingId")
    const binding = getPromptBinding(bindingId)
    if (!binding) {
      throw new Error("Prompt binding not found.")
    }

    const workspace = getWorkspace(binding.workspaceId)
    const workspaceRoot = resolveWorkspaceRoot(binding.workspaceId, params.workspaceRoot)
    if (!workspaceRoot) {
      throw new Error("Workspace root is required to materialize prompts.")
    }

    return materializePromptBinding({
      ...params,
      bindingId,
      workspaceRoot,
      workspaceName: workspace?.name
    })
  })

  ipcMain.handle("prompts:materializeAll", async (_event, params?: PromptMaterializeAllParams) => {
    const workspaceId = resolveWorkspaceId(params?.workspaceId)
    const workspace = getWorkspace(workspaceId)
    const workspaceRoot = resolveWorkspaceRoot(workspaceId, params?.workspaceRoot)
    if (!workspaceRoot) {
      throw new Error("Workspace root is required to materialize prompts.")
    }
    return materializeAllPromptBindings({
      workspaceId,
      workspaceRoot,
      overwriteConflict: params?.overwriteConflict,
      variables: params?.variables,
      workspaceName: workspace?.name
    })
  })

  ipcMain.handle("prompts:history:list", async (_event, params?: PromptHistoryListParams) => {
    return listPromptMaterializations({
      workspaceId: params?.workspaceId ? resolveWorkspaceId(params.workspaceId) : undefined,
      bindingId: params?.bindingId,
      limit: params?.limit
    })
  })

  ipcMain.handle("prompts:exportPack", async (_event, params?: PromptExportPackParams) => {
    const workspaceId = resolveWorkspaceId(params?.workspaceId)
    const managedAssets = collectManagedAssetsForExport(workspaceId)
    const pack: PromptPack = {
      version: "1",
      exportedAt: new Date().toISOString(),
      workspaceId,
      assets: managedAssets.map((asset) => ({
        assetId: asset.id,
        slug: asset.slug,
        title: asset.title,
        description: asset.description,
        fileName: asset.fileName,
        scope: asset.scope,
        workspaceId: asset.workspaceId,
        tags: asset.tags,
        variables: asset.variables,
        content: readFileSync(asset.contentPath, "utf-8")
      })),
      bindings: params?.includeBindings ? listPromptBindings(workspaceId) : undefined,
      meta: {}
    }

    const format = params?.format || "json"
    return {
      pack,
      format,
      content: serializePromptPack(pack, format)
    }
  })

  ipcMain.handle("prompts:importPack", async (_event, params: PromptImportPackParams) => {
    assertObject(params, "Invalid import payload.")
    const pack = parsePromptPack(params.content, params.format)
    const workspaceId = resolveWorkspaceId(params.workspaceId || pack.workspaceId)

    const existingAssets = listPromptAssets(workspaceId)
    const taken = new Set(
      existingAssets
        .filter((asset) => asset.scope === "global" || asset.workspaceId === workspaceId)
        .map((asset) => asset.slug)
    )

    const createdAssets: PromptAsset[] = []
    const assetMap = new Map<string, string>()

    for (const importedAsset of pack.assets) {
      const baseSlug = normalizeSlug(
        importedAsset.slug || importedAsset.fileName || importedAsset.title
      )
      const slug = params.replaceExisting ? baseSlug : buildUniqueSlug(baseSlug, taken)
      const scope = importedAsset.scope === "workspace" ? "workspace" : "global"

      const existingManaged = existingAssets.find((asset) => {
        return (
          asset.source === "managed" &&
          asset.scope === scope &&
          asset.slug === slug &&
          (scope === "global" || asset.workspaceId === workspaceId)
        )
      })

      if (existingManaged && params.replaceExisting) {
        const updated = updateManagedPromptAsset({
          assetId: existingManaged.id,
          updates: {
            title: importedAsset.title,
            description: importedAsset.description,
            fileName: importedAsset.fileName,
            tags: importedAsset.tags,
            variables: importedAsset.variables,
            content: importedAsset.content
          }
        })
        createdAssets.push(updated)
        if (importedAsset.assetId) {
          assetMap.set(importedAsset.assetId, updated.id)
        }
        assetMap.set(importedAsset.slug, updated.id)
        continue
      }

      const created = createManagedPromptAsset({
        workspaceId,
        title: importedAsset.title,
        description: importedAsset.description,
        slug,
        fileName: importedAsset.fileName,
        scope,
        tags: importedAsset.tags,
        variables: importedAsset.variables,
        content: importedAsset.content
      })
      createdAssets.push(created)
      if (importedAsset.assetId) {
        assetMap.set(importedAsset.assetId, created.id)
      }
      assetMap.set(importedAsset.slug, created.id)
    }

    const createdBindings: PromptBinding[] = []
    for (const binding of pack.bindings || []) {
      let replacementAssetId = assetMap.get(binding.assetId)
      if (!replacementAssetId) {
        const fallbackAsset = pack.assets.find(
          (asset) => asset.assetId === binding.assetId || asset.slug === binding.assetId
        )
        if (fallbackAsset) {
          replacementAssetId = assetMap.get(fallbackAsset.assetId || fallbackAsset.slug)
        }
      }
      if (!replacementAssetId) {
        continue
      }
      if (
        binding.targetType === "agent" &&
        (!binding.targetAgentId || !getAgent(binding.targetAgentId))
      ) {
        continue
      }
      createdBindings.push(
        createPromptBinding({
          assetId: replacementAssetId,
          workspaceId,
          targetType: binding.targetType,
          targetAgentId: binding.targetAgentId,
          materializeMode: binding.materializeMode,
          relativeOutputPath: binding.relativeOutputPath,
          enabled: binding.enabled
        })
      )
    }

    return {
      importedAssets: createdAssets,
      importedBindings: createdBindings
    }
  })

  ipcMain.handle("prompts:checkBootstrap", async (_event, params?: PromptBootstrapCheckParams) => {
    return checkBootstrap(params)
  })
}
