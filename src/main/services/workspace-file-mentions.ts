import { promises as fs } from "node:fs"
import path from "node:path"

const FILE_MENTION_REGEX = /(?:^|\s)@([^\s@]+)/g
const MAX_MENTIONED_FILES = 8
const MAX_FILE_BYTES = 256 * 1024
const MAX_FILE_CHARS = 14_000
const MAX_TOTAL_CONTEXT_CHARS = 60_000

export interface MentionedWorkspaceFile {
  mention: string
  relativePath: string
  absolutePath: string
  bytes: number
  truncated: boolean
  content: string
}

export interface SkippedMention {
  mention: string
  reason: string
}

export interface WorkspaceMentionContext {
  mentions: string[]
  files: MentionedWorkspaceFile[]
  skipped: SkippedMention[]
  contextBlock?: string
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?:'"`]+$/g, "")
}

function normalizeMentionToken(token: string): string | null {
  const trimmed = trimTrailingPunctuation(token.trim())
  if (!trimmed) {
    return null
  }

  const slashNormalized = trimmed.replace(/\\/g, "/")
  const withoutPrefix = slashNormalized.replace(/^\.?\//, "")
  const posixNormalized = path.posix.normalize(withoutPrefix)
  if (!posixNormalized || posixNormalized === ".") {
    return null
  }
  if (posixNormalized === ".." || posixNormalized.startsWith("../")) {
    return null
  }

  return `/${posixNormalized}`
}

function isWithinWorkspaceRoot(workspaceRoot: string, candidatePath: string): boolean {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot)
  const resolvedCandidate = path.resolve(candidatePath)
  return (
    resolvedCandidate === resolvedWorkspaceRoot ||
    resolvedCandidate.startsWith(`${resolvedWorkspaceRoot}${path.sep}`)
  )
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false
  }

  const sampleSize = Math.min(buffer.length, 4096)
  let nullBytes = 0
  for (let index = 0; index < sampleSize; index += 1) {
    if (buffer[index] === 0) {
      nullBytes += 1
    }
  }
  return nullBytes > 0
}

function collectMentionTokens(message: string): string[] {
  const matches = message.matchAll(FILE_MENTION_REGEX)
  const seen = new Set<string>()
  const mentions: string[] = []

  for (const match of matches) {
    const token = match[1]
    if (!token) {
      continue
    }
    const normalized = normalizeMentionToken(token)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    mentions.push(normalized)
  }

  return mentions
}

function inferLanguageFromPath(relativePath: string): string {
  const extension = path.extname(relativePath).replace(".", "").toLowerCase()
  if (!extension) {
    return "text"
  }
  if (!/^[a-z0-9]{1,12}$/i.test(extension)) {
    return "text"
  }
  return extension
}

function renderContextBlock(files: MentionedWorkspaceFile[]): string {
  const sections = files.map((file) => {
    const language = inferLanguageFromPath(file.relativePath)
    const truncationSuffix = file.truncated ? " (truncated)" : ""
    return [
      `File: ${file.relativePath} • ${file.bytes} bytes${truncationSuffix}`,
      `\`\`\`${language}`,
      file.content,
      "```"
    ].join("\n")
  })

  return [
    "### Referenced Workspace Files",
    "The user tagged these files with @ mentions. Use them as authoritative context snapshots.",
    ...sections
  ].join("\n\n")
}

export function buildMessageWithMentionContext(message: string, contextBlock?: string): string {
  const trimmedContext = contextBlock?.trim()
  if (!trimmedContext) {
    return message
  }

  return `${trimmedContext}\n\n### User Request\n${message}`
}

export async function buildWorkspaceMentionContext(params: {
  message: string
  workspacePath: string
  explicitMentions?: string[]
}): Promise<WorkspaceMentionContext> {
  const mentions = collectMentionTokens(params.message)
  const explicitMentions = Array.isArray(params.explicitMentions) ? params.explicitMentions : []
  for (const explicitMention of explicitMentions) {
    const normalized = normalizeMentionToken(explicitMention)
    if (!normalized) {
      continue
    }
    if (!mentions.includes(normalized)) {
      mentions.push(normalized)
    }
  }
  if (mentions.length === 0) {
    return {
      mentions: [],
      files: [],
      skipped: []
    }
  }

  const limitedMentions = mentions.slice(0, MAX_MENTIONED_FILES)
  const skipped: SkippedMention[] = []
  if (mentions.length > MAX_MENTIONED_FILES) {
    for (const mention of mentions.slice(MAX_MENTIONED_FILES)) {
      skipped.push({
        mention,
        reason: `Only ${MAX_MENTIONED_FILES} @file references can be loaded per message.`
      })
    }
  }

  const resolvedWorkspaceRoot = path.resolve(params.workspacePath)
  const files: MentionedWorkspaceFile[] = []
  let totalChars = 0

  for (const mention of limitedMentions) {
    const relativeWithoutLeadingSlash = mention.startsWith("/") ? mention.slice(1) : mention
    const absolutePath = path.resolve(resolvedWorkspaceRoot, relativeWithoutLeadingSlash)

    if (!isWithinWorkspaceRoot(resolvedWorkspaceRoot, absolutePath)) {
      skipped.push({
        mention,
        reason: "Mention path resolves outside the workspace root."
      })
      continue
    }

    try {
      const stat = await fs.stat(absolutePath)
      if (stat.isDirectory()) {
        skipped.push({
          mention,
          reason: "Mention points to a directory. Only files are supported."
        })
        continue
      }

      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({
          mention,
          reason: `File exceeds size limit (${MAX_FILE_BYTES} bytes).`
        })
        continue
      }

      const buffer = await fs.readFile(absolutePath)
      if (isLikelyBinary(buffer)) {
        skipped.push({
          mention,
          reason: "File appears to be binary and cannot be injected as text context."
        })
        continue
      }

      let content = buffer.toString("utf-8")
      let truncated = false

      if (content.length > MAX_FILE_CHARS) {
        content = `${content.slice(0, MAX_FILE_CHARS)}\n\n[Truncated]`
        truncated = true
      }

      const remainingChars = MAX_TOTAL_CONTEXT_CHARS - totalChars
      if (remainingChars <= 0) {
        skipped.push({
          mention,
          reason: "Message already reached max injected context size."
        })
        continue
      }

      if (content.length > remainingChars) {
        content = `${content.slice(0, Math.max(0, remainingChars - 16))}\n\n[Truncated]`
        truncated = true
      }

      totalChars += content.length
      files.push({
        mention,
        relativePath: mention,
        absolutePath,
        bytes: buffer.length,
        truncated,
        content
      })
    } catch (error) {
      skipped.push({
        mention,
        reason: error instanceof Error ? error.message : "Failed to read mentioned file."
      })
    }
  }

  return {
    mentions,
    files,
    skipped,
    contextBlock: files.length > 0 ? renderContextBlock(files) : undefined
  }
}
