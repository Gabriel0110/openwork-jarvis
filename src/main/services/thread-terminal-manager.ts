import { chmodSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { BrowserWindow } from "electron"
import { spawn as spawnPty, type IPty } from "node-pty"
import type { TerminalSessionState, TerminalStreamEvent } from "../types"

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32
const MIN_COLS = 20
const MAX_COLS = 500
const MIN_ROWS = 5
const MAX_ROWS = 200

interface TerminalSessionRuntime {
  threadId: string
  pty: IPty
  cwd: string
  shell: string
  cols: number
  rows: number
  startedAt: Date
  alive: boolean
  lastExitCode?: number
}

function safeDirectory(pathCandidate: string | undefined): string | null {
  if (!pathCandidate || pathCandidate.trim().length === 0) {
    return null
  }

  try {
    const normalized = resolve(pathCandidate.trim())
    const stats = statSync(normalized)
    return stats.isDirectory() ? normalized : null
  } catch {
    return null
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeCols(value: number | undefined): number {
  return clamp(Math.floor(value || DEFAULT_COLS), MIN_COLS, MAX_COLS)
}

function normalizeRows(value: number | undefined): number {
  return clamp(Math.floor(value || DEFAULT_ROWS), MIN_ROWS, MAX_ROWS)
}

function resolveShellCommand(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    const shell = process.env["COMSPEC"] || "powershell.exe"
    return { shell, args: [] }
  }

  const shell = process.env["SHELL"]?.trim() || "/bin/zsh"
  return { shell, args: ["-l"] }
}

function buildTerminalEnv(cwd: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }
  env["TERM"] = "xterm-256color"
  env["PWD"] = cwd
  return env
}

function expandAsarCandidates(pathValue: string): string[] {
  const normalized = resolve(pathValue)
  const unpacked = normalized
    .replace("app.asar", "app.asar.unpacked")
    .replace("node_modules.asar", "node_modules.asar.unpacked")
  return unpacked === normalized ? [normalized] : [normalized, unpacked]
}

function getSpawnHelperCandidates(): string[] {
  if (process.platform === "win32") {
    return []
  }

  let unixTerminalPath: string
  try {
    unixTerminalPath = require.resolve("node-pty/lib/unixTerminal.js")
  } catch {
    return []
  }

  const libDir = dirname(unixTerminalPath)
  const candidates = [
    resolve(libDir, "../build/Release/spawn-helper"),
    resolve(libDir, "../build/Debug/spawn-helper"),
    resolve(libDir, `../prebuilds/${process.platform}-${process.arch}/spawn-helper`)
  ]

  const expanded = candidates.flatMap((candidate) => expandAsarCandidates(candidate))
  return Array.from(new Set(expanded))
}

function isExecutable(mode: number): boolean {
  return (mode & 0o111) !== 0
}

function ensureSpawnHelperExecutable(): void {
  for (const candidate of getSpawnHelperCandidates()) {
    try {
      const stats = statSync(candidate)
      if (!stats.isFile()) {
        continue
      }
      if (isExecutable(stats.mode)) {
        return
      }
      chmodSync(candidate, 0o755)
      return
    } catch {
      continue
    }
  }
}

function isPosixSpawnError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return error.message.toLowerCase().includes("posix_spawnp")
}

function toSessionState(session: TerminalSessionRuntime): TerminalSessionState {
  return {
    threadId: session.threadId,
    cwd: session.cwd,
    shell: session.shell,
    pid: session.pty.pid,
    alive: session.alive,
    cols: session.cols,
    rows: session.rows,
    startedAt: session.startedAt,
    lastExitCode: session.lastExitCode
  }
}

export class ThreadTerminalManager {
  private sessions = new Map<string, TerminalSessionRuntime>()

  private emitEvent(event: TerminalStreamEvent): void {
    const channel = `terminal:stream:${event.threadId}`
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue
      }
      window.webContents.send(channel, event)
    }
  }

  private attachListeners(session: TerminalSessionRuntime): void {
    session.pty.onData((data) => {
      this.emitEvent({
        type: "data",
        threadId: session.threadId,
        data
      })
    })

    session.pty.onExit(({ exitCode, signal }) => {
      const current = this.sessions.get(session.threadId)
      if (!current) {
        return
      }
      current.alive = false
      current.lastExitCode = exitCode

      this.emitEvent({
        type: "exit",
        threadId: session.threadId,
        exitCode,
        signal,
        state: toSessionState(current)
      })
      this.emitEvent({
        type: "state",
        threadId: session.threadId,
        state: toSessionState(current)
      })
    })
  }

  private spawnSession(
    threadId: string,
    workspacePath?: string,
    cols?: number,
    rows?: number
  ): TerminalSessionRuntime {
    const cwd = safeDirectory(workspacePath) || homedir()
    const dimensions = {
      cols: normalizeCols(cols),
      rows: normalizeRows(rows)
    }
    const resolvedShell = resolveShellCommand()
    const env = buildTerminalEnv(cwd)
    ensureSpawnHelperExecutable()

    let pty: IPty
    try {
      pty = spawnPty(resolvedShell.shell, resolvedShell.args, {
        name: "xterm-256color",
        cwd,
        cols: dimensions.cols,
        rows: dimensions.rows,
        env
      })
    } catch (error) {
      if (isPosixSpawnError(error) && process.platform !== "win32") {
        ensureSpawnHelperExecutable()
        pty = spawnPty(resolvedShell.shell, resolvedShell.args, {
          name: "xterm-256color",
          cwd,
          cols: dimensions.cols,
          rows: dimensions.rows,
          env
        })
      } else {
        throw error
      }
    }

    const session: TerminalSessionRuntime = {
      threadId,
      pty,
      cwd,
      shell: resolvedShell.shell,
      cols: dimensions.cols,
      rows: dimensions.rows,
      startedAt: new Date(),
      alive: true
    }

    this.attachListeners(session)
    this.sessions.set(threadId, session)
    this.emitEvent({
      type: "state",
      threadId,
      state: toSessionState(session)
    })
    return session
  }

  connect(
    threadId: string,
    workspacePath?: string,
    cols?: number,
    rows?: number
  ): TerminalSessionState {
    const existing = this.sessions.get(threadId)
    if (existing?.alive) {
      if (cols || rows) {
        this.resize(threadId, cols || existing.cols, rows || existing.rows)
      }
      return toSessionState(existing)
    }

    const session = this.spawnSession(threadId, workspacePath, cols, rows)
    return toSessionState(session)
  }

  getState(threadId: string): TerminalSessionState | null {
    const session = this.sessions.get(threadId)
    if (!session) {
      return null
    }
    return toSessionState(session)
  }

  input(threadId: string, data: string): void {
    const session = this.sessions.get(threadId)
    if (!session || !session.alive) {
      throw new Error("Terminal session is not running.")
    }
    session.pty.write(data)
  }

  resize(threadId: string, cols: number, rows: number): TerminalSessionState {
    const session = this.sessions.get(threadId)
    if (!session || !session.alive) {
      throw new Error("Terminal session is not running.")
    }

    const nextCols = normalizeCols(cols)
    const nextRows = normalizeRows(rows)
    session.cols = nextCols
    session.rows = nextRows
    session.pty.resize(nextCols, nextRows)

    const state = toSessionState(session)
    this.emitEvent({
      type: "state",
      threadId,
      state
    })
    return state
  }

  kill(threadId: string): TerminalSessionState | null {
    const session = this.sessions.get(threadId)
    if (!session) {
      return null
    }
    if (session.alive) {
      session.pty.kill()
    }
    return toSessionState(session)
  }

  restart(
    threadId: string,
    workspacePath?: string,
    cols?: number,
    rows?: number
  ): TerminalSessionState {
    const existing = this.sessions.get(threadId)
    if (existing?.alive) {
      existing.pty.kill()
      existing.alive = false
    }
    this.sessions.delete(threadId)
    return this.connect(threadId, workspacePath, cols, rows)
  }

  dispose(threadId: string): void {
    const session = this.sessions.get(threadId)
    if (!session) {
      return
    }
    if (session.alive) {
      session.pty.kill()
    }
    this.sessions.delete(threadId)
  }

  disposeAll(): void {
    for (const threadId of this.sessions.keys()) {
      this.dispose(threadId)
    }
  }
}

let terminalManagerSingleton: ThreadTerminalManager | null = null

export function getThreadTerminalManager(): ThreadTerminalManager {
  if (!terminalManagerSingleton) {
    terminalManagerSingleton = new ThreadTerminalManager()
  }
  return terminalManagerSingleton
}
