import { createMiddleware, type AgentMiddleware } from "langchain"

interface PreCompletionChecklistOptions {
  onChecklistMiss?: (details: { check: string; message: string }) => void
}

export function createPreCompletionChecklistMiddleware(
  options?: PreCompletionChecklistOptions
): AgentMiddleware {
  return createMiddleware({
    name: "harness-pre-completion-checklist",
    wrapModelCall: async (request, handler) => {
      const response = await handler(request)
      const messages = Array.isArray((response as { messages?: unknown[] })?.messages)
        ? ((response as { messages?: unknown[] }).messages as unknown[])
        : []
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined
      const content = String((lastMessage as { content?: unknown })?.content || "").toLowerCase()

      const missedChecks: Array<{ check: string; message: string }> = []
      if (content.includes("done") && !content.includes("verify") && !content.includes("test")) {
        missedChecks.push({
          check: "verification_step",
          message: "Completion claimed without verification evidence."
        })
      }
      if (
        content.includes("complete") &&
        content.includes("todo") &&
        !content.includes("remaining")
      ) {
        missedChecks.push({
          check: "todo_resolution",
          message: "Completion mentions todos without explicit remaining/closed state."
        })
      }

      for (const missed of missedChecks) {
        options?.onChecklistMiss?.(missed)
      }
      return response
    }
  })
}
