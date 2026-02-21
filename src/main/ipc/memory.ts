import type { IpcMain } from "electron"
import { createThread, getThread, updateThread } from "../db"
import {
  createMemoryEntry,
  getMemoryEntry,
  deleteMemoryEntry,
  listMemoryEntries,
  setMemoryEntryLocked,
  listRagSources,
  searchMemoryAndRag,
  upsertRagSource,
  deleteRagSource
} from "../db/memory"
import { createTimelineEvent } from "../db/timeline-events"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import { indexRagSourcesForThread } from "../services/rag-indexer"
import type {
  MemoryEntry,
  MemoryCreateEntryParams,
  MemoryDeleteEntryParams,
  MemoryListEntriesParams,
  MemorySetEntryLockedParams,
  MemorySearchParams,
  RagDeleteSourceParams,
  RagIndexParams,
  RagListSourcesParams,
  RagUpsertSourceParams
} from "../types"

const MEMORY_AUDIT_THREAD_PREFIX = "system-memory-audit:"
const MEMORY_AUDIT_THREAD_TITLE = "System: Memory Audit"

function ensureMemoryAuditThread(workspaceId: string): string {
  const threadId = `${MEMORY_AUDIT_THREAD_PREFIX}${workspaceId}`
  const existing = getThread(threadId)
  if (existing) {
    return threadId
  }

  createThread(threadId, {
    title: MEMORY_AUDIT_THREAD_TITLE,
    workspaceId,
    systemThreadType: "memory_audit"
  })
  updateThread(threadId, { title: MEMORY_AUDIT_THREAD_TITLE })
  return threadId
}

function emitMemoryAuditEvent(params: {
  entry: MemoryEntry
  eventType: "tool_call" | "tool_result"
  toolName: string
  summary: string
  payload?: Record<string, unknown>
}): void {
  try {
    createTimelineEvent({
      threadId: params.entry.threadId || ensureMemoryAuditThread(params.entry.workspaceId),
      workspaceId: params.entry.workspaceId,
      eventType: params.eventType,
      toolName: params.toolName,
      summary: params.summary,
      payload: {
        memoryEntryId: params.entry.id,
        memoryScope: params.entry.scope,
        memorySource: params.entry.source,
        locked: params.entry.locked,
        title: params.entry.title || null,
        ...(params.payload || {})
      }
    })
  } catch (error) {
    console.warn("[Memory] Failed to emit memory audit event.", error)
  }
}

export function registerMemoryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("memory:listEntries", async (_event, params?: MemoryListEntriesParams) => {
    return listMemoryEntries({
      workspaceId: params?.workspaceId || DEFAULT_WORKSPACE_ID,
      scope: params?.scope,
      agentId: params?.agentId,
      threadId: params?.threadId,
      limit: params?.limit
    })
  })

  ipcMain.handle("memory:createEntry", async (_event, params: MemoryCreateEntryParams) => {
    const created = createMemoryEntry({
      workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
      scope: params.scope,
      agentId: params.agentId,
      threadId: params.threadId,
      title: params.title,
      content: params.content,
      tags: params.tags,
      source: params.source
    })

    emitMemoryAuditEvent({
      entry: created,
      eventType: "tool_result",
      toolName: "memory:write",
      summary: `Memory entry created (${created.scope}).`,
      payload: {
        action: "create"
      }
    })
    return created
  })

  ipcMain.handle("memory:deleteEntry", async (_event, { entryId }: MemoryDeleteEntryParams) => {
    const existing = getMemoryEntry(entryId)
    deleteMemoryEntry(entryId)
    if (existing) {
      emitMemoryAuditEvent({
        entry: existing,
        eventType: "tool_result",
        toolName: "memory:delete",
        summary: `Memory entry deleted (${existing.scope}).`,
        payload: {
          action: "delete"
        }
      })
    }
  })

  ipcMain.handle(
    "memory:setEntryLocked",
    async (_event, { entryId, locked }: MemorySetEntryLockedParams) => {
      const updated = setMemoryEntryLocked(entryId, locked)
      if (!updated) {
        throw new Error("Memory entry not found.")
      }
      emitMemoryAuditEvent({
        entry: updated,
        eventType: "tool_result",
        toolName: "memory:lock",
        summary: locked ? "Memory entry locked." : "Memory entry unlocked.",
        payload: {
          action: locked ? "lock" : "unlock"
        }
      })
      return updated
    }
  )

  ipcMain.handle("memory:listSources", async (_event, params?: RagListSourcesParams) => {
    return listRagSources(params?.workspaceId || DEFAULT_WORKSPACE_ID)
  })

  ipcMain.handle("memory:upsertSource", async (_event, params: RagUpsertSourceParams) => {
    return upsertRagSource({
      sourceId: params.sourceId,
      workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
      path: params.path,
      enabled: params.enabled,
      includeGlobs: params.includeGlobs,
      excludeGlobs: params.excludeGlobs
    })
  })

  ipcMain.handle("memory:deleteSource", async (_event, { sourceId }: RagDeleteSourceParams) => {
    deleteRagSource(sourceId)
  })

  ipcMain.handle("memory:indexSources", async (_event, params: RagIndexParams) => {
    return indexRagSourcesForThread({
      threadId: params.threadId,
      workspaceId: params.workspaceId || DEFAULT_WORKSPACE_ID,
      sourceIds: params.sourceIds,
      maxFiles: params.maxFiles,
      maxFileSizeBytes: params.maxFileSizeBytes
    })
  })

  ipcMain.handle("memory:search", async (_event, params: MemorySearchParams) => {
    return searchMemoryAndRag(
      params.workspaceId || DEFAULT_WORKSPACE_ID,
      params.query,
      params.limit || 8
    )
  })
}
