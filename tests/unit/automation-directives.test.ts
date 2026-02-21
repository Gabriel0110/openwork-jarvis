import { describe, expect, it } from "vitest"
import {
  buildAutomationDirective,
  resolveAutomationCwd
} from "../../src/main/services/automation-directives"
import type { WorkflowTemplateAutomationDraft } from "../../src/main/types"

function buildDraft(
  overrides?: Partial<WorkflowTemplateAutomationDraft>
): WorkflowTemplateAutomationDraft {
  return {
    name: "Daily Template Schedule",
    prompt: 'Run workflow template "Daily Template" and deliver artifacts.',
    rrule: "FREQ=HOURLY;INTERVAL=1",
    timezone: "UTC",
    status: "ACTIVE",
    template: {
      id: "tpl-1",
      name: "Daily Template",
      workspaceId: "default-workspace"
    },
    ...overrides
  }
}

describe("buildAutomationDirective", () => {
  it("creates a suggested-create automation directive with timezone note", () => {
    const directive = buildAutomationDirective(buildDraft(), "/Users/test/workspace")

    expect(directive).toContain('::automation-update{mode="suggested create"')
    expect(directive).toContain('name="Daily Template Schedule"')
    expect(directive).toContain('rrule="FREQ=HOURLY;INTERVAL=1"')
    expect(directive).toContain('cwds="/Users/test/workspace"')
    expect(directive).toContain('status="ACTIVE"}')
    expect(directive).toContain("# timezone: UTC")
  })

  it("escapes quotes and backslashes in directive attributes", () => {
    const directive = buildAutomationDirective(
      buildDraft({
        name: 'Ops "Morning" \\ Run',
        prompt: 'Run "morning" workflow\nwith path C:\\\\repo',
        timezone: 'America/New_York "NY"'
      }),
      '/tmp/"workspace"'
    )

    expect(directive).toContain('name="Ops \\"Morning\\" \\\\ Run"')
    expect(directive).toContain('prompt="Run \\"morning\\" workflow with path C:\\\\\\\\repo"')
    expect(directive).toContain('cwds="/tmp/\\"workspace\\""')
    expect(directive).toContain('# timezone: America/New_York \\"NY\\"')
  })
})

describe("resolveAutomationCwd", () => {
  it("prefers explicit cwd over thread/workspace paths", () => {
    const result = resolveAutomationCwd({
      explicitCwd: "/custom/cwd",
      threadWorkspacePath: "/thread/workspace",
      workspaceRootPath: "/workspace/root",
      workspaceId: "default-workspace"
    })

    expect(result).toEqual({
      cwd: "/custom/cwd",
      usedFallbackCwd: false
    })
  })

  it("falls back to workspace id when no paths are available", () => {
    const result = resolveAutomationCwd({
      workspaceId: "workspace-123"
    })

    expect(result).toEqual({
      cwd: "workspace-123",
      usedFallbackCwd: true
    })
  })
})
