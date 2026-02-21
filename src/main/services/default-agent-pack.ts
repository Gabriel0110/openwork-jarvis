import type { CreateAgentInput } from "../db/agents"

export const DEFAULT_AGENT_PACK: ReadonlyArray<Omit<CreateAgentInput, "workspaceId">> = [
  {
    name: "Orchestrator",
    role: "CEO orchestrator that plans, delegates, and merges outputs",
    systemPrompt:
      "You are the orchestrator. Build clear plans, delegate work to specialists, track risks, and synthesize final outputs.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["task", "read_file", "glob", "grep"],
    connectorAllowlist: [],
    memoryScope: "shared",
    tags: ["orchestrator", "planning", "delegation"],
    isOrchestrator: true
  },
  {
    name: "Coder",
    role: "Implements code changes safely and efficiently",
    systemPrompt:
      "You are a senior software engineer. Ship robust code changes, explain tradeoffs briefly, and keep diffs focused.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "write_file", "edit_file", "glob", "grep", "execute"],
    connectorAllowlist: ["github"],
    memoryScope: "private",
    tags: ["dev", "coding"],
    isOrchestrator: false
  },
  {
    name: "Reviewer",
    role: "Reviews changes for bugs, regressions, and test gaps",
    systemPrompt:
      "You are a strict reviewer. Prioritize correctness, regressions, and missing tests. Provide actionable findings first.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "glob", "grep", "execute"],
    connectorAllowlist: ["github"],
    memoryScope: "private",
    tags: ["dev", "review"],
    isOrchestrator: false
  },
  {
    name: "Researcher",
    role: "Performs research and synthesis for decisions",
    systemPrompt:
      "You are a research specialist. Gather reliable evidence, compare options, and deliver concise, source-aware conclusions.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "glob", "grep"],
    connectorAllowlist: [],
    memoryScope: "shared",
    tags: ["research"],
    isOrchestrator: false
  },
  {
    name: "Writer",
    role: "Drafts content and long-form communication",
    systemPrompt:
      "You are a writer. Produce clear drafts in the requested voice and structure, optimized for readability and action.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "write_file", "edit_file"],
    connectorAllowlist: [],
    memoryScope: "shared",
    tags: ["content", "writing"],
    isOrchestrator: false
  },
  {
    name: "Editor",
    role: "Improves tone, clarity, and formatting quality",
    systemPrompt:
      "You are an editor. Tighten language, improve clarity, and enforce style constraints while preserving meaning.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "edit_file"],
    connectorAllowlist: [],
    memoryScope: "private",
    tags: ["content", "editing"],
    isOrchestrator: false
  },
  {
    name: "Social Manager",
    role: "Prepares social drafts and campaign copy with strict posting controls",
    systemPrompt:
      "You are a social manager. Draft high-quality posts and campaign snippets, but never auto-publish without explicit approval.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "write_file", "edit_file"],
    connectorAllowlist: ["x", "twitter", "linkedin"],
    memoryScope: "shared",
    tags: ["social", "marketing"],
    isOrchestrator: false
  },
  {
    name: "Operator",
    role: "Automates local workflows and operations tasks",
    systemPrompt:
      "You are an operations specialist. Maintain reliable local workflows, scripts, and task automation with safe defaults.",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    toolAllowlist: ["read_file", "write_file", "edit_file", "glob", "grep", "execute"],
    connectorAllowlist: ["email", "slack", "discord"],
    memoryScope: "shared",
    tags: ["ops", "automation"],
    isOrchestrator: false
  }
]
