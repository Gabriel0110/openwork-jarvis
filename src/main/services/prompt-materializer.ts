import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { getAgent } from "../db/agents"
import {
  createPromptMaterializationRecord,
  getPromptAsset,
  getPromptBinding,
  listPromptBindings,
  setPromptBindingSyncState
} from "../db/prompts"
import { renderPromptFile } from "./prompt-renderer"
import type { PromptConflict, PromptMaterializationRecord, PromptMaterializeParams } from "../types"

interface MaterializePromptResult {
  status: "applied" | "conflict" | "failed" | "skipped"
  bindingId: string
  record: PromptMaterializationRecord
  conflict?: PromptConflict
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeRelativeOutputPath(fileName: string, relativeOutputPath?: string): string {
  const value = (relativeOutputPath || fileName).trim().replace(/\\/g, "/")
  const safe = value.replace(/^\/+/, "")
  const finalPath = safe.toLowerCase().endsWith(".md") ? safe : `${safe}.md`
  return finalPath
}

function ensureWithinWorkspaceRoot(workspaceRoot: string, targetPath: string): string {
  const absoluteRoot = resolve(workspaceRoot)
  const absoluteTarget = resolve(targetPath)
  const rootWithSep = absoluteRoot.endsWith("/") ? absoluteRoot : `${absoluteRoot}/`

  if (absoluteTarget !== absoluteRoot && !absoluteTarget.startsWith(rootWithSep)) {
    throw new Error("Materialization path escapes workspace root.")
  }

  return absoluteTarget
}

function resolveOutputPath(
  workspaceRoot: string,
  mode: "workspace_root" | "agent_docs",
  outputPath: string,
  targetAgentId?: string
): string {
  if (mode === "workspace_root") {
    return ensureWithinWorkspaceRoot(workspaceRoot, join(workspaceRoot, outputPath))
  }

  if (!targetAgentId) {
    throw new Error("Agent target is required for agent_docs materialization.")
  }

  const agent = getAgent(targetAgentId)
  if (!agent) {
    throw new Error("Target agent not found.")
  }

  const agentSlug = agent.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  const normalizedAgentSlug = agentSlug || agent.agent_id
  const resolved = join(workspaceRoot, ".agents", normalizedAgentSlug, outputPath)
  return ensureWithinWorkspaceRoot(workspaceRoot, resolved)
}

function readFileIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null
  }
  return readFileSync(path, "utf-8")
}

function ensureParentDirectory(targetPath: string): void {
  const parent = dirname(targetPath)
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true })
  }
}

export function materializePromptBinding(
  params: PromptMaterializeParams & { workspaceRoot: string; workspaceName?: string }
): MaterializePromptResult {
  const binding = getPromptBinding(params.bindingId)
  if (!binding) {
    throw new Error("Prompt binding not found.")
  }

  const asset = getPromptAsset(binding.assetId)
  if (!asset) {
    throw new Error("Prompt asset not found.")
  }

  const outputPath = normalizeRelativeOutputPath(asset.fileName, binding.relativeOutputPath)
  if (outputPath.includes("..")) {
    throw new Error("Invalid output path.")
  }

  const resolvedPath = resolveOutputPath(
    params.workspaceRoot,
    binding.materializeMode,
    outputPath,
    binding.targetAgentId
  )

  if (!binding.enabled) {
    const record = createPromptMaterializationRecord({
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      status: "skipped",
      resolvedPath,
      message: "Binding is disabled."
    })
    return {
      status: "skipped",
      bindingId: binding.id,
      record
    }
  }

  let renderedContent = ""
  try {
    const preview = renderPromptFile(asset.contentPath, {
      workspaceId: binding.workspaceId,
      workspaceName: params.workspaceName,
      workspaceRoot: params.workspaceRoot,
      agentId: binding.targetAgentId,
      agentName: binding.targetAgentId ? getAgent(binding.targetAgentId)?.name : undefined,
      agentRole: binding.targetAgentId ? getAgent(binding.targetAgentId)?.role : undefined,
      variables: params.variables
    })
    renderedContent = preview.content
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to render prompt content."
    setPromptBindingSyncState(binding.id, {
      lastError: message
    })
    const record = createPromptMaterializationRecord({
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      status: "failed",
      resolvedPath,
      message
    })
    return {
      status: "failed",
      bindingId: binding.id,
      record
    }
  }

  const assetHash = sha256(renderedContent)
  const beforeContent = readFileIfExists(resolvedPath)
  const beforeHash = beforeContent ? sha256(beforeContent) : undefined

  if (
    beforeHash &&
    (!binding.lastMaterializedHash || beforeHash !== binding.lastMaterializedHash) &&
    !params.overwriteConflict
  ) {
    const message = "Conflict detected: destination file changed since last managed apply."
    setPromptBindingSyncState(binding.id, {
      lastAssetHash: assetHash,
      lastError: message
    })
    const record = createPromptMaterializationRecord({
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      status: "conflict",
      resolvedPath,
      beforeHash,
      assetHash,
      message
    })
    return {
      status: "conflict",
      bindingId: binding.id,
      record,
      conflict: {
        bindingId: binding.id,
        assetId: asset.id,
        resolvedPath,
        currentHash: beforeHash,
        expectedHash: binding.lastMaterializedHash,
        assetHash,
        message,
        currentContent: beforeContent || undefined,
        assetContent: renderedContent
      }
    }
  }

  try {
    ensureParentDirectory(resolvedPath)
    writeFileSync(resolvedPath, renderedContent, "utf-8")
    const afterHash = sha256(renderedContent)
    setPromptBindingSyncState(binding.id, {
      lastMaterializedHash: afterHash,
      lastAssetHash: assetHash,
      lastMaterializedAt: Date.now(),
      lastError: null
    })
    const record = createPromptMaterializationRecord({
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      status: "applied",
      resolvedPath,
      beforeHash,
      afterHash,
      assetHash,
      message: "Applied prompt binding."
    })
    return {
      status: "applied",
      bindingId: binding.id,
      record
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write prompt file."
    setPromptBindingSyncState(binding.id, {
      lastAssetHash: assetHash,
      lastError: message
    })
    const record = createPromptMaterializationRecord({
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      status: "failed",
      resolvedPath,
      beforeHash,
      assetHash,
      message
    })
    return {
      status: "failed",
      bindingId: binding.id,
      record
    }
  }
}

export function materializeAllPromptBindings(params: {
  workspaceId: string
  workspaceRoot: string
  overwriteConflict?: boolean
  variables?: Record<string, string>
  workspaceName?: string
}): MaterializePromptResult[] {
  const bindings = listPromptBindings(params.workspaceId).filter((binding) => binding.enabled)
  const results: MaterializePromptResult[] = []

  for (const binding of bindings) {
    results.push(
      materializePromptBinding({
        bindingId: binding.id,
        workspaceRoot: params.workspaceRoot,
        overwriteConflict: params.overwriteConflict,
        variables: params.variables,
        workspaceName: params.workspaceName
      })
    )
  }

  return results
}
