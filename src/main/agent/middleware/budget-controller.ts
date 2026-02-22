import { ToolMessage, createMiddleware, type AgentMiddleware } from "langchain"
import type { HarnessStopReason } from "../../types"

interface BudgetControllerOptions {
  maxDurationMs: number
  maxToolCalls: number
  onWarning?: (details: { level: 70 | 85 | 95; usagePercent: number }) => void
  onExhausted?: (
    reason: Extract<HarnessStopReason, "budget_exhausted">,
    details: Record<string, unknown>
  ) => void
}

export function createBudgetControllerMiddleware(
  options: BudgetControllerOptions
): AgentMiddleware {
  const startedAt = Date.now()
  let toolCalls = 0
  const warnedLevels = new Set<70 | 85 | 95>()

  function maybeWarn(): void {
    const elapsedMs = Date.now() - startedAt
    const durationPercent = (elapsedMs / Math.max(options.maxDurationMs, 1)) * 100
    const toolPercent = (toolCalls / Math.max(options.maxToolCalls, 1)) * 100
    const usagePercent = Math.max(durationPercent, toolPercent)

    for (const level of [70, 85, 95] as const) {
      if (usagePercent >= level && !warnedLevels.has(level)) {
        warnedLevels.add(level)
        options.onWarning?.({ level, usagePercent })
      }
    }
  }

  return createMiddleware({
    name: "harness-budget-controller",
    wrapToolCall: async (request, handler) => {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > options.maxDurationMs || toolCalls >= options.maxToolCalls) {
        options.onExhausted?.("budget_exhausted", {
          elapsedMs,
          maxDurationMs: options.maxDurationMs,
          toolCalls,
          maxToolCalls: options.maxToolCalls
        })
        return new ToolMessage({
          content:
            "Harness budget exhausted before this tool call. Stop and summarize progress with remaining risks.",
          tool_call_id: request.toolCall.id || "budget-exhausted"
        })
      }

      toolCalls += 1
      maybeWarn()
      return handler(request)
    }
  })
}
