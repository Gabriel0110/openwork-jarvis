import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type ColumnStatus = "pending" | "in_progress" | "interrupted" | "done"

interface KanbanColumnProps {
  title: string
  status: ColumnStatus
  count: number
  children: React.ReactNode
}

const columnConfig: Record<ColumnStatus, { accentColor: string }> = {
  pending: { accentColor: "text-muted-foreground" },
  in_progress: { accentColor: "text-status-info" },
  interrupted: { accentColor: "text-status-warning" },
  done: { accentColor: "text-status-nominal" }
}

export function KanbanColumn({
  title,
  status,
  count,
  children
}: KanbanColumnProps): React.JSX.Element {
  const config = columnConfig[status]

  return (
    <div className="flex min-w-[240px] w-[240px] flex-1 flex-col rounded-lg bg-sidebar/40">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-medium", config.accentColor)}>{title}</span>
        </div>
        {count > 0 && (
          <span className="rounded-full bg-background px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 px-2 pb-3">{children}</div>
      </ScrollArea>
    </div>
  )
}
