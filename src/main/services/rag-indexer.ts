import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { getThread } from "../db"
import {
  listRagSources,
  listRagSourcesByIds,
  replaceRagChunks,
  setRagSourceStatus,
  type RagChunkInput
} from "../db/memory"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import type { RagIndexResult } from "../types"

const DEFAULT_MAX_FILES = 300
const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024
const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 200

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".yml",
  ".yaml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".sh",
  ".zsh",
  ".html",
  ".css",
  ".scss",
  ".sql",
  ".xml",
  ".csv"
])

interface IndexRagSourcesInput {
  threadId: string
  workspaceId?: string
  sourceIds?: string[]
  maxFiles?: number
  maxFileSizeBytes?: number
}

interface IndexedFile {
  absolutePath: string
  virtualPath: string
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/")
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedTarget = path.resolve(targetPath)
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`) ||
    resolvedTarget.startsWith(`${resolvedRoot}/`)
  )
}

function normalizeSourcePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    return "/"
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function resolveSourceDirectory(workspacePath: string, sourcePath: string): string {
  const normalized = normalizeSourcePath(sourcePath)
  const relative = normalized.replace(/^\/+/, "")
  const absolutePath = path.resolve(workspacePath, relative)
  if (!isWithinRoot(workspacePath, absolutePath)) {
    throw new Error(`Source path "${sourcePath}" resolves outside workspace root.`)
  }
  return absolutePath
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/__DOUBLE_STAR__/g, ".*")
  return new RegExp(`^${escaped}$`, "i")
}

function matchesGlob(pathValue: string, pattern: string): boolean {
  try {
    return globToRegExp(pattern).test(pathValue)
  } catch {
    return false
  }
}

function shouldIndexFile(
  virtualPath: string,
  includeGlobs: string[],
  excludeGlobs: string[],
  extension: string
): boolean {
  if (!TEXT_EXTENSIONS.has(extension.toLowerCase())) {
    return false
  }

  if (excludeGlobs.some((pattern) => matchesGlob(virtualPath, pattern))) {
    return false
  }

  if (includeGlobs.length === 0) {
    return true
  }

  return includeGlobs.some((pattern) => matchesGlob(virtualPath, pattern))
}

function chunkText(content: string): string[] {
  const normalized = content.trim()
  if (!normalized) {
    return []
  }

  const chunks: string[] = []
  let start = 0
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + CHUNK_SIZE)
    chunks.push(normalized.slice(start, end))
    if (end >= normalized.length) {
      break
    }
    start = Math.max(0, end - CHUNK_OVERLAP)
  }
  return chunks
}

async function collectFilesForIndexing(
  workspacePath: string,
  sourceDirectory: string,
  sourcePath: string,
  includeGlobs: string[],
  excludeGlobs: string[],
  maxFiles: number,
  maxFileSizeBytes: number
): Promise<{ files: IndexedFile[]; skipped: number }> {
  const files: IndexedFile[] = []
  let skipped = 0

  const walk = async (directoryPath: string): Promise<void> => {
    if (files.length >= maxFiles) {
      return
    }

    let entries: Dirent[] = []
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true })
    } catch {
      skipped += 1
      return
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return
      }

      if (entry.name.startsWith(".")) {
        continue
      }
      if (entry.isDirectory() && ["node_modules", "dist", "out", "build"].includes(entry.name)) {
        continue
      }

      const absoluteEntryPath = path.join(directoryPath, entry.name)
      const relativeFromWorkspace = toPosixPath(path.relative(workspacePath, absoluteEntryPath))
      const virtualPath = `/${relativeFromWorkspace}`

      if (entry.isDirectory()) {
        await walk(absoluteEntryPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const extension = path.extname(entry.name)
      if (!shouldIndexFile(virtualPath, includeGlobs, excludeGlobs, extension)) {
        continue
      }

      try {
        const stat = await fs.stat(absoluteEntryPath)
        if (stat.size > maxFileSizeBytes) {
          skipped += 1
          continue
        }
      } catch {
        skipped += 1
        continue
      }

      files.push({
        absolutePath: absoluteEntryPath,
        virtualPath
      })
    }
  }

  const sourcePrefix = normalizeSourcePath(sourcePath)
  await walk(sourceDirectory)

  const normalizedFiles = files
    .filter((file) => file.virtualPath.startsWith(sourcePrefix) || sourcePrefix === "/")
    .map((file) => ({
      absolutePath: file.absolutePath,
      virtualPath: file.virtualPath
    }))

  return { files: normalizedFiles, skipped }
}

export async function indexRagSourcesForThread(
  input: IndexRagSourcesInput
): Promise<RagIndexResult> {
  const thread = getThread(input.threadId)
  const metadata = thread?.metadata ? JSON.parse(thread.metadata) : {}
  const workspacePath = metadata.workspacePath as string | undefined
  const workspaceId = (input.workspaceId || metadata.workspaceId || DEFAULT_WORKSPACE_ID) as string

  if (!workspacePath) {
    throw new Error("Workspace path is required before indexing sources.")
  }

  const sources =
    input.sourceIds && input.sourceIds.length > 0
      ? listRagSourcesByIds(workspaceId, input.sourceIds)
      : listRagSources(workspaceId)

  const enabledSources = sources.filter((source) => source.enabled)
  const result: RagIndexResult = {
    indexedSources: 0,
    indexedFiles: 0,
    indexedChunks: 0,
    skippedFiles: 0,
    errors: []
  }

  const maxFiles = Math.max(10, Math.min(input.maxFiles || DEFAULT_MAX_FILES, 2000))
  const maxFileSizeBytes = Math.max(
    8 * 1024,
    Math.min(input.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES, 4 * 1024 * 1024)
  )

  for (const source of enabledSources) {
    setRagSourceStatus({
      sourceId: source.id,
      status: "indexing",
      lastError: null
    })

    try {
      const sourceDirectory = resolveSourceDirectory(workspacePath, source.path)
      const sourceStat = await fs.stat(sourceDirectory)
      if (!sourceStat.isDirectory()) {
        throw new Error(`Source path "${source.path}" is not a directory.`)
      }

      const { files, skipped } = await collectFilesForIndexing(
        workspacePath,
        sourceDirectory,
        source.path,
        source.includeGlobs,
        source.excludeGlobs,
        maxFiles,
        maxFileSizeBytes
      )

      const chunks: RagChunkInput[] = []
      for (const file of files) {
        try {
          const content = await fs.readFile(file.absolutePath, "utf-8")
          for (const chunk of chunkText(content)) {
            chunks.push({
              path: file.virtualPath,
              content: chunk
            })
          }
        } catch (error) {
          result.errors.push(
            `Failed reading ${file.virtualPath}: ${error instanceof Error ? error.message : "Unknown error"}`
          )
          result.skippedFiles += 1
        }
      }

      const indexedChunks = replaceRagChunks(source.id, workspaceId, chunks)
      setRagSourceStatus({
        sourceId: source.id,
        status: "ready",
        lastError: null,
        lastIndexedAt: Date.now()
      })

      result.indexedSources += 1
      result.indexedFiles += files.length
      result.indexedChunks += indexedChunks
      result.skippedFiles += skipped
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown indexing error"
      setRagSourceStatus({
        sourceId: source.id,
        status: "error",
        lastError: message
      })
      result.errors.push(`Source "${source.path}" failed: ${message}`)
    }
  }

  return result
}
