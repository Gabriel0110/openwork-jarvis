import { MessageSquare, Loader2, Clock, Bot } from "lucide-react"
import { cn, formatRelativeTime, truncate } from "@/lib/utils"
import { useThreadStream } from "@/lib/thread-context"
import type { Thread, Subagent } from "@/types"

type KanbanStatus = "pending" | "in_progress" | "interrupted" | "done"

interface ThreadCardProps {
  thread: Thread
  status: KanbanStatus
  onClick: () => void
}

interface SubagentCardProps {
  subagent: Subagent
  parentThread: Thread
  onClick: () => void
}

function ThreadStatusIcon({ threadId }: { threadId: string }): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId)

  if (isLoading) {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-status-info" />
  }
  return <MessageSquare className="size-3.5 shrink-0 text-muted-foreground/60" />
}

export function ThreadKanbanCard({ thread, status, onClick }: ThreadCardProps): React.JSX.Element {
  return (
    <button
      className={cn(
        "w-full rounded-md border border-border/40 bg-card/60 p-3 text-left transition-all",
        "hover:border-border hover:bg-card hover:shadow-sm",
        status === "in_progress" && "border-status-info/30 bg-status-info/5",
        status === "interrupted" && "border-status-warning/30 bg-status-warning/5"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        {status === "interrupted" ? (
          <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-status-warning" />
        ) : (
          <div className="mt-0.5">
            <ThreadStatusIcon threadId={thread.thread_id} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {thread.title || truncate(thread.thread_id, 20)}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <Clock className="size-2.5" />
            <span>{formatRelativeTime(thread.updated_at)}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

export function SubagentKanbanCard({
  subagent,
  parentThread,
  onClick
}: SubagentCardProps): React.JSX.Element {
  const isRunning = subagent.status === "running"
  const isDone = subagent.status === "completed" || subagent.status === "failed"

  return (
    <button
      className={cn(
        "w-full rounded-md border border-dashed border-border/40 bg-card/40 p-3 text-left transition-all",
        "hover:border-border hover:bg-card/60",
        isRunning && "border-status-info/30"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        <Bot
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            isRunning ? "text-status-info" : "text-muted-foreground/60"
          )}
        />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{subagent.name}</p>
            {isDone && (
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase",
                  subagent.status === "failed"
                    ? "bg-status-critical/10 text-status-critical"
                    : "bg-status-nominal/10 text-status-nominal"
                )}
              >
                {subagent.status === "failed" ? "Failed" : "Done"}
              </span>
            )}
          </div>
          {subagent.description && (
            <p className="mt-0.5 line-clamp-2 break-words text-[10px] text-muted-foreground/70">
              {subagent.description}
            </p>
          )}
          <p className="mt-1 truncate text-[10px] text-muted-foreground/50">
            {parentThread.title || truncate(parentThread.thread_id, 15)}
          </p>
        </div>
      </div>
    </button>
  )
}
