import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, extname, join, relative } from "node:path"
import {
  createPromptAsset,
  deletePromptAsset,
  deletePromptAssetsBySourceExcept,
  getPromptAsset,
  listPromptAssets,
  upsertPromptAsset,
  updatePromptAsset
} from "../db/prompts"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import { getPromptGlobalDir, getPromptWorkspaceDir } from "../storage"
import type {
  PromptAsset,
  PromptAssetScope,
  PromptAssetSource,
  PromptCreateParams,
  PromptDeleteParams,
  PromptListParams,
  PromptListResult,
  PromptUpdateParams
} from "../types"

interface ParsedFrontmatter {
  title?: string
  description?: string
  tags: string[]
  variables: string[]
  body: string
}

interface DiscoveredPromptFile {
  slug: string
  title: string
  description?: string
  fileName: string
  contentPath: string
  tags: string[]
  variables: string[]
}

interface PromptDiscoveryLocation {
  source: PromptAssetSource
  root: string
}

const PROMPT_DISCOVERY_LOCATIONS: PromptDiscoveryLocation[] = [
  {
    source: "discovered_agents",
    root: join(homedir(), ".agents", "prompts")
  },
  {
    source: "discovered_openwork",
    root: getPromptGlobalDir()
  }
]

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function normalizeSlug(value: string): string {
  return value
    .replace(/\\/g, "/")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\/+|\/+$/g, "")
}

function normalizeFileName(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/")
  const base = trimmed.length > 0 ? trimmed : "prompt.md"
  const fileName = basename(base)
  const withExtension = fileName.toLowerCase().endsWith(".md") ? fileName : `${fileName}.md`
  return withExtension.replace(/[^a-zA-Z0-9._-]+/g, "-")
}

function parseSimpleListValue(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter((item) => item.length > 0)
  }
  return trimmed
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter((item) => item.length > 0)
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(content)
  if (!match) {
    return {
      body: content,
      tags: [],
      variables: []
    }
  }

  const yaml = match[1]
  const metadata: Record<string, string | string[]> = {}
  const lines = yaml.split(/\r?\n/)
  let currentListKey: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    if (trimmed.startsWith("- ") && currentListKey) {
      const existing = metadata[currentListKey]
      const list = Array.isArray(existing) ? [...existing] : []
      list.push(
        trimmed
          .slice(2)
          .trim()
          .replace(/^['"]|['"]$/g, "")
      )
      metadata[currentListKey] = list
      continue
    }

    const separatorIndex = trimmed.indexOf(":")
    if (separatorIndex <= 0) {
      currentListKey = null
      continue
    }

    const rawKey = trimmed.slice(0, separatorIndex).trim().toLowerCase()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (!rawValue) {
      currentListKey = rawKey
      metadata[rawKey] = []
      continue
    }

    currentListKey = null
    if (rawKey === "tags" || rawKey === "variables") {
      metadata[rawKey] = parseSimpleListValue(rawValue)
      continue
    }

    metadata[rawKey] = rawValue.replace(/^['"]|['"]$/g, "")
  }

  const body = content.slice(match[0].length)
  const tags = Array.isArray(metadata["tags"]) ? metadata["tags"] : []
  const variables = Array.isArray(metadata["variables"]) ? metadata["variables"] : []

  return {
    title: typeof metadata["title"] === "string" ? metadata["title"] : undefined,
    description: typeof metadata["description"] === "string" ? metadata["description"] : undefined,
    tags,
    variables,
    body
  }
}

function extractVariables(content: string): string[] {
  const matches = new Set<string>()
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    if (match[1]) {
      matches.add(match[1])
    }
  }
  return Array.from(matches.values()).sort()
}

function normalizeTagArray(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .map((tag) => tag.toLowerCase())
    )
  )
}

function scanMarkdownFiles(root: string): string[] {
  if (!existsSync(root)) {
    return []
  }

  const files: string[] = []

  function walk(currentPath: string): void {
    let entries: string[] = []
    try {
      entries = readdirSync(currentPath)
    } catch {
      return
    }

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry)
      let stats: ReturnType<typeof statSync>
      try {
        stats = statSync(absolutePath)
      } catch {
        continue
      }

      if (stats.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (!stats.isFile()) {
        continue
      }

      if (extname(entry).toLowerCase() !== ".md") {
        continue
      }

      files.push(absolutePath)
    }
  }

  walk(root)
  return files
}

function discoverPromptFiles(root: string): DiscoveredPromptFile[] {
  const markdownFiles = scanMarkdownFiles(root)
  const discovered: DiscoveredPromptFile[] = []

  for (const absolutePath of markdownFiles) {
    let rawContent = ""
    try {
      rawContent = readFileSync(absolutePath, "utf-8")
    } catch {
      continue
    }

    const parsed = parseFrontmatter(rawContent)
    const relativePath = relative(root, absolutePath).replace(/\\/g, "/")
    const fileName = basename(absolutePath)
    const slugFromPath = normalizeSlug(relativePath.replace(/\.md$/i, ""))
    const titleFromFile = fileName.replace(/\.md$/i, "")
    const title = parsed.title?.trim() || titleFromFile
    const tags = normalizeTagArray(parsed.tags)
    const inferredVariables = extractVariables(parsed.body)
    const variables = Array.from(new Set([...parsed.variables, ...inferredVariables]))

    discovered.push({
      slug: slugFromPath,
      title,
      description: parsed.description?.trim() || undefined,
      fileName,
      contentPath: absolutePath,
      tags,
      variables
    })
  }

  return discovered
}

function getPrecedenceScore(asset: PromptAsset, workspaceId?: string): number {
  if (asset.source === "discovered_agents") {
    return 400
  }
  if (workspaceId && asset.scope === "workspace" && asset.workspaceId === workspaceId) {
    return 300
  }
  if (asset.scope === "global" && asset.source === "managed") {
    return 200
  }
  if (asset.scope === "global" && asset.source === "discovered_openwork") {
    return 190
  }
  return 100
}

function matchesFilters(asset: PromptAsset, params: PromptListParams | undefined): boolean {
  if (!params) {
    return true
  }

  if (params.scope && params.scope !== "all" && asset.scope !== params.scope) {
    return false
  }

  if (params.source && params.source !== "all" && asset.source !== params.source) {
    return false
  }

  if (params.agentsOnly && asset.fileName.toUpperCase() !== "AGENTS.MD") {
    return false
  }

  if (!params.query?.trim()) {
    return true
  }

  const needle = params.query.trim().toLowerCase()
  return (
    asset.title.toLowerCase().includes(needle) ||
    asset.slug.toLowerCase().includes(needle) ||
    asset.fileName.toLowerCase().includes(needle) ||
    (asset.description || "").toLowerCase().includes(needle) ||
    asset.tags.some((tag) => tag.toLowerCase().includes(needle))
  )
}

function ensurePathExists(targetPath: string): void {
  const directory = dirname(targetPath)
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }
}

function resolveManagedAssetPath(
  scope: PromptAssetScope,
  workspaceId: string | undefined,
  slug: string,
  fileName: string
): string {
  const safeSlug = normalizeSlug(slug) || normalizeSlug(fileName.replace(/\.md$/i, "")) || "prompt"
  const root =
    scope === "workspace"
      ? getPromptWorkspaceDir(workspaceId || DEFAULT_WORKSPACE_ID)
      : getPromptGlobalDir()
  const extension = fileName.toLowerCase().endsWith(".md") ? "" : ".md"
  return join(root, `${safeSlug}${extension || ".md"}`)
}

function readAssetContent(asset: PromptAsset): string {
  try {
    return readFileSync(asset.contentPath, "utf-8")
  } catch {
    return ""
  }
}

export function refreshPromptDiscovery(): PromptListResult {
  for (const location of PROMPT_DISCOVERY_LOCATIONS) {
    const discovered = discoverPromptFiles(location.root)
    const keepKeys = new Set<string>()
    for (const entry of discovered) {
      const key = `global::${entry.slug}`
      keepKeys.add(key)

      upsertPromptAsset({
        workspaceId: undefined,
        slug: entry.slug,
        title: entry.title,
        description: entry.description,
        fileName: entry.fileName,
        scope: "global",
        source: location.source,
        contentPath: entry.contentPath,
        tags: entry.tags,
        variables: entry.variables,
        isSystem: true
      })
    }
    deletePromptAssetsBySourceExcept(location.source, keepKeys)
  }

  return listPromptLibrary()
}

export function listPromptLibrary(params?: PromptListParams): PromptListResult {
  const workspaceId = params?.workspaceId
  const assets = listPromptAssets(workspaceId).filter((asset) => matchesFilters(asset, params))

  const effectiveBySlug = new Map<string, PromptAsset>()
  for (const asset of assets) {
    const existing = effectiveBySlug.get(asset.slug)
    if (!existing) {
      effectiveBySlug.set(asset.slug, asset)
      continue
    }

    if (getPrecedenceScore(asset, workspaceId) >= getPrecedenceScore(existing, workspaceId)) {
      effectiveBySlug.set(asset.slug, asset)
    }
  }

  const effectiveAssets = Array.from(effectiveBySlug.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  )
  const sortedAssets = [...assets].sort((a, b) => a.title.localeCompare(b.title))

  return {
    assets: sortedAssets,
    effectiveAssets,
    loadedAt: new Date().toISOString()
  }
}

export function getPromptAssetWithContent(
  assetId: string
): { asset: PromptAsset; content: string } | null {
  const asset = getPromptAsset(assetId)
  if (!asset) {
    return null
  }

  return {
    asset,
    content: readAssetContent(asset)
  }
}

function ensureManagedEditable(asset: PromptAsset): void {
  if (asset.source !== "managed") {
    throw new Error("Only managed prompt assets can be edited.")
  }
}

export function createManagedPromptAsset(params: PromptCreateParams): PromptAsset {
  const scope = params.scope || (params.workspaceId ? "workspace" : "global")
  const workspaceId = scope === "workspace" ? params.workspaceId || DEFAULT_WORKSPACE_ID : undefined
  const fileName = normalizeFileName(params.fileName)
  const slug = normalizeSlug(params.slug || fileName.replace(/\.md$/i, "") || params.title)
  if (!slug) {
    throw new Error("Unable to derive a valid prompt slug.")
  }

  const contentPath = resolveManagedAssetPath(scope, workspaceId, slug, fileName)
  ensurePathExists(contentPath)
  writeFileSync(contentPath, params.content, "utf-8")

  const parsed = parseFrontmatter(params.content)
  const inferredVariables = extractVariables(parsed.body)
  const variables = Array.from(
    new Set([...(params.variables || []), ...parsed.variables, ...inferredVariables])
  )
  const tags = normalizeTagArray([...(params.tags || []), ...parsed.tags])

  return createPromptAsset({
    workspaceId,
    slug,
    title: params.title.trim(),
    description: params.description?.trim(),
    fileName,
    scope,
    source: "managed",
    contentPath,
    tags,
    variables,
    isSystem: false
  })
}

export function updateManagedPromptAsset(params: PromptUpdateParams): PromptAsset {
  const existing = getPromptAsset(params.assetId)
  if (!existing) {
    throw new Error("Prompt asset not found.")
  }
  ensureManagedEditable(existing)

  const nextSlug = normalizeSlug(params.updates.slug || existing.slug)
  const nextFileName = normalizeFileName(params.updates.fileName || existing.fileName)
  const shouldRelocate = nextSlug !== existing.slug || nextFileName !== existing.fileName
  const nextContentPath =
    params.updates.content !== undefined || shouldRelocate
      ? resolveManagedAssetPath(existing.scope, existing.workspaceId, nextSlug, nextFileName)
      : existing.contentPath

  const sourceContent =
    params.updates.content !== undefined ? params.updates.content : readAssetContent(existing)

  if (params.updates.content !== undefined || shouldRelocate) {
    ensurePathExists(nextContentPath)
    writeFileSync(nextContentPath, sourceContent, "utf-8")
  }

  const parsed = parseFrontmatter(sourceContent)
  const inferredVariables = extractVariables(parsed.body)
  const mergedVariables = params.updates.variables
    ? params.updates.variables
    : Array.from(new Set([...existing.variables, ...parsed.variables, ...inferredVariables]))
  const mergedTags = params.updates.tags
    ? params.updates.tags
    : Array.from(new Set([...existing.tags, ...parsed.tags]))

  const updated = updatePromptAsset(params.assetId, {
    slug: nextSlug,
    title: params.updates.title,
    description: params.updates.description,
    fileName: nextFileName,
    contentPath: nextContentPath,
    tags: mergedTags,
    variables: mergedVariables
  })

  if (!updated) {
    throw new Error("Failed to update prompt asset.")
  }

  if (nextContentPath !== existing.contentPath && existsSync(existing.contentPath)) {
    try {
      unlinkSync(existing.contentPath)
    } catch {
      // Ignore best-effort cleanup.
    }
  }

  return updated
}

export function deleteManagedPromptAsset(params: PromptDeleteParams): void {
  const existing = getPromptAsset(params.assetId)
  if (!existing) {
    return
  }
  ensureManagedEditable(existing)
  deletePromptAsset(params.assetId)
  if (existsSync(existing.contentPath)) {
    try {
      unlinkSync(existing.contentPath)
    } catch {
      // Ignore best-effort cleanup.
    }
  }
}
