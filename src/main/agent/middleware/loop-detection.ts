import { ToolMessage, createMiddleware, type AgentMiddleware } from "langchain"
import type { HarnessStopReason } from "../../types"

interface LoopDetectionOptions {
  advisoryThreshold: number
  stopThreshold: number
  onAdvisory?: (details: { signature: string; repeats: number }) => void
  onLoopStop?: (
    reason: Extract<HarnessStopReason, "loop_detected">,
    details: Record<string, unknown>
  ) => void
}

function signatureFromToolCall(toolName: string, args: unknown): string {
  const serializedArgs =
    typeof args === "string"
      ? args
      : (() => {
          try {
            return JSON.stringify(args)
          } catch {
            return String(args)
          }
        })()
  return `${toolName}:${serializedArgs}`
}

export function createLoopDetectionMiddleware(options: LoopDetectionOptions): AgentMiddleware {
  const signatureCounts = new Map<string, number>()

  return createMiddleware({
    name: "harness-loop-detection",
    wrapToolCall: async (request, handler) => {
      const toolName = String(request.toolCall.name || request.tool?.name || "unknown_tool")
      const signature = signatureFromToolCall(toolName, request.toolCall.args)
      const repeats = (signatureCounts.get(signature) || 0) + 1
      signatureCounts.set(signature, repeats)

      if (repeats === options.advisoryThreshold) {
        options.onAdvisory?.({ signature, repeats })
      }

      if (repeats >= options.stopThreshold) {
        options.onLoopStop?.("loop_detected", {
          signature,
          repeats,
          toolName
        })
        return new ToolMessage({
          content:
            "Detected a repeated tool loop. Stop this pattern and provide a diagnosis with a new plan.",
          tool_call_id: request.toolCall.id || "loop-detected"
        })
      }

      return handler(request)
    }
  })
}
