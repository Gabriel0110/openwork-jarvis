import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  buildMessageWithMentionContext,
  buildWorkspaceMentionContext
} from "../../src/main/services/workspace-file-mentions"

describe("workspace-file-mentions", () => {
  it("loads @mentioned workspace files into a bounded context block", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "openwork-mentions-"))
    try {
      await mkdir(path.join(workspaceRoot, "src"), { recursive: true })
      await writeFile(path.join(workspaceRoot, "src", "agent.ts"), 'export const agent = "ok"\n')

      const result = await buildWorkspaceMentionContext({
        message: "Review @src/agent.ts for issues",
        workspacePath: workspaceRoot
      })

      expect(result.mentions).toEqual(["/src/agent.ts"])
      expect(result.files).toHaveLength(1)
      expect(result.files[0]?.relativePath).toBe("/src/agent.ts")
      expect(result.contextBlock).toContain("Referenced Workspace Files")
      expect(result.contextBlock).toContain('export const agent = "ok"')
      expect(result.skipped).toHaveLength(0)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("ignores email-like tokens and rejects path traversal mentions", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "openwork-mentions-"))
    try {
      await writeFile(path.join(workspaceRoot, "README.md"), "hello\n")
      const result = await buildWorkspaceMentionContext({
        message: "Email me at dev@example.com and check @../secret plus @README.md",
        workspacePath: workspaceRoot
      })

      expect(result.mentions).toEqual(["/README.md"])
      expect(result.files).toHaveLength(1)
      expect(result.files[0]?.relativePath).toBe("/README.md")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("composes a final request message when context exists", () => {
    const merged = buildMessageWithMentionContext("Fix this", "### Referenced Workspace Files")
    expect(merged).toContain("### Referenced Workspace Files")
    expect(merged).toContain("### User Request")
    expect(merged).toContain("Fix this")
  })

  it("supports explicit mention paths in addition to inline @tokens", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "openwork-mentions-"))
    try {
      await mkdir(path.join(workspaceRoot, "src"), { recursive: true })
      await writeFile(path.join(workspaceRoot, "src", "index.ts"), "export {}\n")

      const result = await buildWorkspaceMentionContext({
        message: "Please review this",
        workspacePath: workspaceRoot,
        explicitMentions: ["/src/index.ts"]
      })

      expect(result.mentions).toEqual(["/src/index.ts"])
      expect(result.files).toHaveLength(1)
      expect(result.files[0]?.relativePath).toBe("/src/index.ts")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
