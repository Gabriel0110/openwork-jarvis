import { useEffect, useMemo, useState } from "react"
import { Bot, Check, ChevronDown, Cpu, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAppStore } from "@/lib/store"
import { useCurrentThread } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import type { ZeroClawDeploymentState } from "@/types"

interface SpeakerPickerProps {
  threadId: string
}

export function SpeakerPicker({ threadId }: SpeakerPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [zeroClawDeployments, setZeroClawDeployments] = useState<ZeroClawDeploymentState[]>([])
  const { agents, loadAgents } = useAppStore()
  const { speakerType, speakerAgentId, setSpeaker } = useCurrentThread(threadId)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadAgents(), window.api.zeroclaw.deployment.list()])
      .then(([, deployments]) => {
        if (!cancelled) {
          setZeroClawDeployments(deployments)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setZeroClawDeployments([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [loadAgents])

  const speakerLabel = useMemo(() => {
    if (speakerType === "orchestrator") {
      return "Orchestrator"
    }
    if (speakerType === "zeroclaw") {
      const deployment = zeroClawDeployments.find((entry) => entry.id === speakerAgentId)
      return deployment?.name || "ZeroClaw"
    }
    const agent = agents.find((entry) => entry.id === speakerAgentId)
    return agent?.name || "Agent"
  }, [agents, speakerAgentId, speakerType, zeroClawDeployments])

  const agentOptions = agents.filter((agent) => !agent.isOrchestrator)
  const zeroClawOptions = zeroClawDeployments

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 px-2 text-xs",
            speakerType !== "orchestrator" ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {speakerType === "agent" ? (
            <UserRound className="size-3.5" />
          ) : speakerType === "zeroclaw" ? (
            <Cpu className="size-3.5" />
          ) : (
            <Bot className="size-3.5" />
          )}
          <span className="max-w-[120px] truncate">{speakerLabel}</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-1">
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted/50"
            onClick={() => {
              setSpeaker("orchestrator")
              setOpen(false)
            }}
          >
            <Bot className="size-3.5 text-muted-foreground" />
            <span className="flex-1 text-left">Orchestrator</span>
            {speakerType === "orchestrator" && <Check className="size-3.5 text-status-nominal" />}
          </button>

          {agentOptions.length > 0 && (
            <div className="px-2 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Direct Agents
            </div>
          )}

          {agentOptions.map((agent) => (
            <button
              key={agent.id}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted/50"
              onClick={() => {
                setSpeaker("agent", agent.id)
                setOpen(false)
              }}
            >
              <UserRound className="size-3.5 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{agent.name}</span>
              {speakerType === "agent" && speakerAgentId === agent.id && (
                <Check className="size-3.5 text-status-nominal" />
              )}
            </button>
          ))}

          {zeroClawOptions.length > 0 && (
            <div className="px-2 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              ZeroClaw Deployments
            </div>
          )}

          {zeroClawOptions.map((deployment) => (
            <button
              key={deployment.id}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted/50"
              onClick={() => {
                setSpeaker("zeroclaw", deployment.id)
                setOpen(false)
              }}
            >
              <Cpu className="size-3.5 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{deployment.name}</span>
              {speakerType === "zeroclaw" && speakerAgentId === deployment.id && (
                <Check className="size-3.5 text-status-nominal" />
              )}
            </button>
          ))}

          {agentOptions.length === 0 && zeroClawOptions.length === 0 && (
            <div className="rounded-sm px-2 py-2 text-xs text-muted-foreground">
              Create agents or ZeroClaw deployments to enable direct chat speakers.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
