import { useRef, useEffect, useMemo, useCallback, useState } from "react"
import { Send, Square, Loader2, AlertCircle, X, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/lib/store"
import { useCurrentThread, useThreadStream } from "@/lib/thread-context"
import { MessageBubble } from "./MessageBubble"
import { ModelSwitcher } from "./ModelSwitcher"
import { Folder } from "lucide-react"
import { WorkspacePicker } from "./WorkspacePicker"
import { SpeakerPicker } from "./SpeakerPicker"
import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { ChatTodos } from "./ChatTodos"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import type { Message } from "@/types"

interface AgentStreamValues {
  todos?: Array<{ id?: string; content?: string; status?: string }>
}

interface StreamMessage {
  id?: string
  type?: string
  content?: string | unknown[]
  tool_calls?: Message["tool_calls"]
  tool_call_id?: string
  name?: string
}

interface ChatContainerProps {
  threadId: string
}

interface MentionQueryState {
  query: string
  start: number
  end: number
}

interface MentionSuggestion {
  path: string
  name: string
  directory: string
  score: number
}

const MAX_MENTION_SUGGESTIONS = 40

function parseMentionQuery(input: string, caretPosition: number): MentionQueryState | null {
  const beforeCaret = input.slice(0, caretPosition)
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) {
    return null
  }

  const query = match[1] || ""
  const start = caretPosition - query.length - 1
  if (start < 0) {
    return null
  }

  return {
    query,
    start,
    end: caretPosition
  }
}

function scoreMentionSuggestion(filePath: string, query: string): MentionSuggestion | null {
  const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`
  const segments = normalizedPath.split("/").filter(Boolean)
  const fileName = segments[segments.length - 1] || normalizedPath
  const directory = segments.length > 1 ? `/${segments.slice(0, -1).join("/")}` : "/"

  if (!query) {
    return {
      path: normalizedPath,
      name: fileName,
      directory,
      score: 300
    }
  }

  const lowerQuery = query.toLowerCase()
  const lowerName = fileName.toLowerCase()
  const lowerPath = normalizedPath.toLowerCase()

  if (lowerName === lowerQuery) {
    return {
      path: normalizedPath,
      name: fileName,
      directory,
      score: 0
    }
  }

  if (lowerName.startsWith(lowerQuery)) {
    return {
      path: normalizedPath,
      name: fileName,
      directory,
      score: 10
    }
  }

  if (lowerName.includes(lowerQuery)) {
    return {
      path: normalizedPath,
      name: fileName,
      directory,
      score: 100
    }
  }

  if (lowerPath.includes(lowerQuery)) {
    return {
      path: normalizedPath,
      name: fileName,
      directory,
      score: 200
    }
  }

  return null
}

export function ChatContainer({ threadId }: ChatContainerProps): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [mentionQuery, setMentionQuery] = useState<MentionQueryState | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [attachedMentions, setAttachedMentions] = useState<MentionSuggestion[]>([])

  const { threads, loadThreads, generateTitleForFirstMessage } = useAppStore()

  // Get persisted thread state and actions from context
  const {
    messages: threadMessages,
    pendingApproval,
    todos,
    error: threadError,
    workspacePath,
    workspaceFiles,
    tokenUsage,
    currentModel,
    speakerType,
    speakerAgentId,
    draftInput: input,
    setTodos,
    setWorkspaceFiles,
    setWorkspacePath,
    setPendingApproval,
    appendMessage,
    setError,
    clearError,
    setDraftInput: setInput,
    openFile
  } = useCurrentThread(threadId)

  // Get the stream data via subscription - reactive updates without re-rendering provider
  const streamData = useThreadStream(threadId)
  const stream = streamData.stream
  const isLoading = streamData.isLoading

  const handleApprovalDecision = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      if (!pendingApproval) return
      if (!stream) {
        setError("Approval action is unavailable because the run stream is not connected.")
        return
      }

      try {
        const toolName = pendingApproval.tool_call.name
        const toolCallId = pendingApproval.tool_call.id
        const toolArgs = pendingApproval.tool_call.args
        await stream.submit(null, {
          command: {
            resume: {
              decision,
              toolName,
              toolCallId,
              toolArgs
            }
          },
          config: {
            configurable: {
              thread_id: threadId,
              model_id: currentModel,
              speaker_type: speakerType,
              speaker_agent_id: speakerAgentId || undefined
            }
          }
        })
        setPendingApproval(null)
      } catch (err) {
        console.error("[ChatContainer] Resume command failed:", err)
        setError("Failed to submit approval decision. Please try again.")
      }
    },
    [
      pendingApproval,
      setPendingApproval,
      stream,
      threadId,
      currentModel,
      speakerType,
      speakerAgentId,
      setError
    ]
  )

  const pendingApprovalArgsPreview = useMemo(() => {
    if (!pendingApproval?.tool_call?.args) {
      return "{}"
    }
    try {
      const raw = JSON.stringify(pendingApproval.tool_call.args, null, 2)
      return raw.length > 1200 ? `${raw.slice(0, 1200)}...` : raw
    } catch {
      return "{}"
    }
  }, [pendingApproval])

  const agentValues = stream?.values as AgentStreamValues | undefined
  const streamTodos = agentValues?.todos
  useEffect(() => {
    if (Array.isArray(streamTodos)) {
      setTodos(
        streamTodos.map((t) => ({
          id: t.id || crypto.randomUUID(),
          content: t.content || "",
          status: (t.status || "pending") as "pending" | "in_progress" | "completed" | "cancelled"
        }))
      )
    }
  }, [streamTodos, setTodos])

  const prevLoadingRef = useRef(false)
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      for (const rawMsg of streamData.messages) {
        const msg = rawMsg as StreamMessage
        if (msg.id) {
          const streamMsg = msg as StreamMessage & { id: string }

          let role: Message["role"] = "assistant"
          if (streamMsg.type === "human") role = "user"
          else if (streamMsg.type === "tool") role = "tool"
          else if (streamMsg.type === "ai") role = "assistant"

          const storeMsg: Message = {
            id: streamMsg.id,
            role,
            content: typeof streamMsg.content === "string" ? streamMsg.content : "",
            tool_calls: streamMsg.tool_calls,
            ...(role === "tool" &&
              streamMsg.tool_call_id && { tool_call_id: streamMsg.tool_call_id }),
            ...(role === "tool" && streamMsg.name && { name: streamMsg.name }),
            created_at: new Date()
          }
          appendMessage(storeMsg)
        }
      }
      loadThreads()
    }
    prevLoadingRef.current = isLoading
  }, [isLoading, streamData.messages, loadThreads, appendMessage])

  const displayMessages = useMemo(() => {
    const threadMessageIds = new Set(threadMessages.map((m) => m.id))

    const streamingMsgs: Message[] = ((streamData.messages || []) as StreamMessage[])
      .filter((m): m is StreamMessage & { id: string } => !!m.id && !threadMessageIds.has(m.id))
      .map((streamMsg) => {
        let role: Message["role"] = "assistant"
        if (streamMsg.type === "human") role = "user"
        else if (streamMsg.type === "tool") role = "tool"
        else if (streamMsg.type === "ai") role = "assistant"

        return {
          id: streamMsg.id,
          role,
          content: typeof streamMsg.content === "string" ? streamMsg.content : "",
          tool_calls: streamMsg.tool_calls,
          ...(role === "tool" &&
            streamMsg.tool_call_id && { tool_call_id: streamMsg.tool_call_id }),
          ...(role === "tool" && streamMsg.name && { name: streamMsg.name }),
          created_at: new Date()
        }
      })

    return [...threadMessages, ...streamingMsgs]
  }, [threadMessages, streamData.messages])

  // Build tool results map from tool messages
  const toolResults = useMemo(() => {
    const results = new Map<string, { content: string | unknown; is_error?: boolean }>()
    for (const msg of displayMessages) {
      if (msg.role === "tool" && msg.tool_call_id) {
        results.set(msg.tool_call_id, {
          content: msg.content,
          is_error: false // Could be enhanced to track errors
        })
      }
    }
    return results
  }, [displayMessages])

  // Get the actual scrollable viewport element from Radix ScrollArea
  const getViewport = useCallback((): HTMLDivElement | null => {
    return scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null
  }, [])

  // Track scroll position to determine if user is at bottom
  const handleScroll = useCallback((): void => {
    const viewport = getViewport()
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    // Consider "at bottom" if within 50px of the bottom
    const threshold = 50
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < threshold
  }, [getViewport])

  // Attach scroll listener to viewport
  useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return

    viewport.addEventListener("scroll", handleScroll)
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [getViewport, handleScroll])

  // Auto-scroll on new messages only if already at bottom
  useEffect(() => {
    const viewport = getViewport()
    if (viewport && isAtBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [displayMessages, isLoading, getViewport])

  // Always scroll to bottom when switching threads
  useEffect(() => {
    const viewport = getViewport()
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
    }
  }, [threadId, getViewport])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [threadId])

  const handleDismissError = (): void => {
    clearError()
  }

  const mentionSuggestions = useMemo(() => {
    if (!workspacePath || !mentionQuery) {
      return [] as MentionSuggestion[]
    }

    const dedupe = new Set<string>()
    const candidates: MentionSuggestion[] = []

    for (const entry of workspaceFiles) {
      if (entry.is_dir) {
        continue
      }
      const normalizedPath = entry.path.startsWith("/") ? entry.path : `/${entry.path}`
      if (dedupe.has(normalizedPath)) {
        continue
      }
      if (attachedMentions.some((item) => item.path === normalizedPath)) {
        continue
      }
      dedupe.add(normalizedPath)

      const scored = scoreMentionSuggestion(normalizedPath, mentionQuery.query)
      if (scored) {
        candidates.push(scored)
      }
    }

    candidates.sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score
      }
      if (a.name.length !== b.name.length) {
        return a.name.length - b.name.length
      }
      return a.path.localeCompare(b.path)
    })

    return candidates.slice(0, MAX_MENTION_SUGGESTIONS)
  }, [workspaceFiles, workspacePath, mentionQuery, attachedMentions])

  const effectiveActiveMentionIndex =
    mentionSuggestions.length === 0
      ? 0
      : Math.min(activeMentionIndex, mentionSuggestions.length - 1)

  const closeMentionSuggestions = useCallback(() => {
    setMentionQuery(null)
    setActiveMentionIndex(0)
  }, [])

  const updateMentionQuery = useCallback(
    (nextInput: string, caretPosition?: number) => {
      if (!workspacePath) {
        closeMentionSuggestions()
        return
      }

      const cursor = caretPosition ?? nextInput.length
      const nextMentionQuery = parseMentionQuery(nextInput, cursor)
      if (!nextMentionQuery) {
        closeMentionSuggestions()
        return
      }

      setMentionQuery(nextMentionQuery)
      setActiveMentionIndex(0)
    },
    [closeMentionSuggestions, workspacePath]
  )

  const applyMentionSuggestion = useCallback(
    (suggestion: MentionSuggestion) => {
      if (!mentionQuery) {
        return
      }

      const before = input.slice(0, mentionQuery.start)
      const after = input.slice(mentionQuery.end)
      const nextInput = `${before}${after}`.replace(/\s{2,}/g, " ")
      const caret = Math.min(before.length, nextInput.length)

      setInput(nextInput)
      setAttachedMentions((previous) => {
        if (previous.some((item) => item.path === suggestion.path)) {
          return previous
        }
        return [...previous, suggestion]
      })
      closeMentionSuggestions()

      queueMicrotask(() => {
        if (!inputRef.current) {
          return
        }
        inputRef.current.focus()
        inputRef.current.setSelectionRange(caret, caret)
      })
    },
    [closeMentionSuggestions, input, mentionQuery, setInput]
  )

  const removeAttachedMention = useCallback((pathToRemove: string): void => {
    setAttachedMentions((previous) => previous.filter((mention) => mention.path !== pathToRemove))
  }, [])

  const handleInputChange = (value: string): void => {
    setInput(value)
    updateMentionQuery(value, inputRef.current?.selectionStart ?? value.length)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!input.trim() || isLoading || !stream) return

    if (!workspacePath) {
      setError("Please select a workspace folder before sending messages.")
      return
    }

    if (threadError) {
      clearError()
    }

    if (pendingApproval) {
      setPendingApproval(null)
    }

    const message = input.trim()
    const referencedFiles = attachedMentions.map((mention) => mention.path)
    setInput("")
    setAttachedMentions([])
    closeMentionSuggestions()

    const isFirstMessage = threadMessages.length === 0

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      created_at: new Date()
    }
    appendMessage(userMessage)

    if (isFirstMessage) {
      const currentThread = threads.find((t) => t.thread_id === threadId)
      const hasDefaultTitle = currentThread?.title?.startsWith("Thread ")
      if (hasDefaultTitle) {
        generateTitleForFirstMessage(threadId, message)
      }
    }

    await stream.submit(
      {
        messages: [{ type: "human", content: message }],
        referencedFiles
      },
      {
        config: {
          configurable: {
            thread_id: threadId,
            model_id: currentModel,
            speaker_type: speakerType,
            speaker_agent_id: speakerAgentId || undefined
          }
        }
      }
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      e.key === "Backspace" &&
      !mentionQuery &&
      e.currentTarget.value.length === 0 &&
      attachedMentions.length > 0
    ) {
      e.preventDefault()
      const lastMention = attachedMentions[attachedMentions.length - 1]
      if (lastMention) {
        removeAttachedMention(lastMention.path)
      }
      return
    }

    if (mentionQuery && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveMentionIndex((prev) =>
          prev <= 0 ? mentionSuggestions.length - 1 : Math.max(0, prev - 1)
        )
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const candidate = mentionSuggestions[effectiveActiveMentionIndex]
        if (candidate) {
          applyMentionSuggestion(candidate)
        }
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        closeMentionSuggestions()
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Auto-resize textarea based on content
  const adjustTextareaHeight = (): void => {
    const textarea = inputRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  const handleCancel = async (): Promise<void> => {
    await stream?.stop()
  }

  const handleSelectWorkspaceFromEmptyState = async (): Promise<void> => {
    await selectWorkspaceFolder(threadId, setWorkspacePath, setWorkspaceFiles, () => {}, undefined)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="p-4">
          <div className="max-w-3xl mx-auto space-y-4">
            {displayMessages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <div className="text-section-header mb-2">NEW THREAD</div>
                {workspacePath ? (
                  <div className="text-sm">Start a conversation with the agent</div>
                ) : (
                  <div className="text-sm text-center space-y-3">
                    <div>
                      <span className="text-amber-500">Select a workspace folder</span>
                      <span className="block text-xs mt-1 opacity-75">
                        The agent needs a workspace to create and modify files
                      </span>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2 h-7 text-xs gap-1.5 text-amber-500 hover:bg-accent/50 transition-color duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={handleSelectWorkspaceFromEmptyState}
                    >
                      <Folder className="size-3.5" />
                      <span className="max-w-[120px] truncate">Select workspace</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {displayMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolResults={toolResults}
                pendingApproval={pendingApproval}
                onApprovalDecision={handleApprovalDecision}
              />
            ))}

            {/* Streaming indicator and inline TODOs */}
            {isLoading && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Agent is thinking...
                </div>
                {todos.length > 0 && <ChatTodos todos={todos} />}
              </div>
            )}

            {/* Explicit pending approval actions */}
            {pendingApproval && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-amber-300">
                  Pending Approval
                </div>
                <div className="mt-1 text-sm text-foreground">
                  Tool: <span className="font-mono">{pendingApproval.tool_call.name}</span>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">Arguments</div>
                <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-amber-500/20 bg-background/70 p-2 text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                  {pendingApprovalArgsPreview}
                </pre>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => void handleApprovalDecision("reject")}
                  >
                    Reject
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void handleApprovalDecision("approve")}
                  >
                    Approve & Run
                  </Button>
                </div>
              </div>
            )}

            {/* Error state */}
            {threadError && !isLoading && (
              <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
                <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-destructive text-sm">Agent Error</div>
                  <div className="text-sm text-muted-foreground mt-1 break-words">
                    {threadError}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    You can try sending a new message to continue the conversation.
                  </div>
                </div>
                <button
                  onClick={handleDismissError}
                  className="shrink-0 rounded p-1 hover:bg-destructive/20 transition-colors"
                  aria-label="Dismiss error"
                >
                  <X className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="flex flex-col gap-2">
            <div className="relative flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onClick={(e) =>
                  updateMentionQuery(e.currentTarget.value, e.currentTarget.selectionStart)
                }
                onKeyUp={(e) =>
                  updateMentionQuery(e.currentTarget.value, e.currentTarget.selectionStart)
                }
                onBlur={() => {
                  setTimeout(() => {
                    closeMentionSuggestions()
                  }, 120)
                }}
                placeholder="Message..."
                disabled={isLoading}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="flex-1 min-w-0 resize-none rounded-sm border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                rows={1}
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
              {mentionQuery && mentionSuggestions.length > 0 && (
                <div className="absolute left-0 right-[56px] bottom-[calc(100%+8px)] z-30 max-h-72 overflow-auto rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-2xl">
                  <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/60">
                    Type to search for files
                  </div>
                  <div className="py-1">
                    {mentionSuggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.path}
                        type="button"
                        className={`w-full px-3 py-2 text-left flex items-center gap-3 ${
                          index === effectiveActiveMentionIndex
                            ? "bg-accent/70"
                            : "hover:bg-accent/40"
                        }`}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          applyMentionSuggestion(suggestion)
                        }}
                      >
                        <span className="inline-flex size-5 items-center justify-center rounded-sm border border-border/80 text-[10px] font-semibold text-muted-foreground">
                          {suggestion.name.split(".").pop()?.slice(0, 2).toUpperCase() || "FI"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">
                            {suggestion.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {suggestion.directory}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-center shrink-0 h-12">
                {isLoading ? (
                  <Button type="button" variant="ghost" size="icon" onClick={handleCancel}>
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="default"
                    size="icon"
                    disabled={!input.trim()}
                    className="rounded-md"
                  >
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            {attachedMentions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {attachedMentions.map((mention) => (
                  <button
                    key={mention.path}
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-accent/50 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                    onClick={() => openFile(mention.path, mention.name)}
                    title={`Open ${mention.path}`}
                  >
                    <span className="inline-flex size-4 items-center justify-center rounded-sm bg-primary/15 text-primary">
                      <FileText className="size-3" />
                    </span>
                    <span className="max-w-[220px] truncate font-medium">{mention.name}</span>
                    <span className="max-w-[180px] truncate text-muted-foreground">
                      {mention.directory}
                    </span>
                    <span
                      className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        removeAttachedMention(mention.path)
                      }}
                      aria-label={`Remove ${mention.name}`}
                    >
                      <X className="size-3" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SpeakerPicker threadId={threadId} />
                <div className="w-px h-4 bg-border" />
                <ModelSwitcher threadId={threadId} />
                <div className="w-px h-4 bg-border" />
                <WorkspacePicker threadId={threadId} />
              </div>
              {tokenUsage && (
                <ContextUsageIndicator tokenUsage={tokenUsage} modelId={currentModel} />
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
