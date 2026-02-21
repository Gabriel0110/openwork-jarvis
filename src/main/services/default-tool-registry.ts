import type {
  PolicyAction,
  ToolCategory,
  ToolDefinition,
  ToolImplementationType,
  ToolRiskTier
} from "../types"

export interface DefaultToolSeed {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  action: PolicyAction
  riskTier: ToolRiskTier
  implementationType: ToolImplementationType
  config?: Record<string, unknown>
}

export const DEFAULT_TOOL_REGISTRY: ReadonlyArray<DefaultToolSeed> = [
  {
    name: "ls",
    displayName: "List Files",
    description: "Lists files and directories in workspace paths.",
    category: "filesystem",
    action: "read",
    riskTier: 0,
    implementationType: "builtin"
  },
  {
    name: "read_file",
    displayName: "Read File",
    description: "Reads text files from workspace paths.",
    category: "filesystem",
    action: "read",
    riskTier: 0,
    implementationType: "builtin"
  },
  {
    name: "glob",
    displayName: "Glob Search",
    description: "Searches files by glob pattern.",
    category: "filesystem",
    action: "read",
    riskTier: 0,
    implementationType: "builtin"
  },
  {
    name: "grep",
    displayName: "Grep Search",
    description: "Searches file contents by pattern.",
    category: "filesystem",
    action: "read",
    riskTier: 0,
    implementationType: "builtin"
  },
  {
    name: "write_file",
    displayName: "Write File",
    description: "Writes file content in workspace paths.",
    category: "filesystem",
    action: "write",
    riskTier: 1,
    implementationType: "builtin"
  },
  {
    name: "edit_file",
    displayName: "Edit File",
    description: "Applies targeted in-place file edits.",
    category: "filesystem",
    action: "write",
    riskTier: 1,
    implementationType: "builtin"
  },
  {
    name: "write_todos",
    displayName: "Write Todos",
    description: "Updates runtime todo/task list state.",
    category: "execution",
    action: "write",
    riskTier: 1,
    implementationType: "builtin"
  },
  {
    name: "execute",
    displayName: "Execute Command",
    description: "Runs shell commands with approval controls.",
    category: "execution",
    action: "exec",
    riskTier: 2,
    implementationType: "builtin"
  },
  {
    name: "task",
    displayName: "Delegate Task",
    description: "Delegates work to specialist subagents.",
    category: "execution",
    action: "exec",
    riskTier: 2,
    implementationType: "builtin"
  },
  {
    name: "connector:*",
    displayName: "Connector Capability",
    description: "Connector actions such as posting and outbound side effects.",
    category: "connector",
    action: "post",
    riskTier: 3,
    implementationType: "builtin"
  },
  {
    name: "search_memory",
    displayName: "Search Memory",
    description: "Queries workspace memory entries and indexed local knowledge.",
    category: "memory",
    action: "read",
    riskTier: 0,
    implementationType: "builtin"
  },
  {
    name: "read_skill",
    displayName: "Read Skill",
    description: "Loads SKILL.md instructions for assigned skills.",
    category: "skills",
    action: "read",
    riskTier: 0,
    implementationType: "builtin"
  }
]

export const SYSTEM_TOOL_NAMES = new Set(DEFAULT_TOOL_REGISTRY.map((tool) => tool.name))

export function canDeleteTool(tool: Pick<ToolDefinition, "source">): boolean {
  return tool.source === "custom"
}
