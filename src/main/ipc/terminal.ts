import type { IpcMain } from "electron"
import { getThreadTerminalManager } from "../services/thread-terminal-manager"
import type {
  TerminalConnectParams,
  TerminalInputParams,
  TerminalKillParams,
  TerminalRestartParams,
  TerminalResizeParams
} from "../types"

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`)
  }
  return value.trim()
}

function assertFiniteNumber(value: unknown, fieldName: string): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`${fieldName} must be a number.`)
  }
  return numeric
}

export function registerTerminalHandlers(ipcMain: IpcMain): void {
  const manager = getThreadTerminalManager()

  ipcMain.handle("terminal:connect", async (_event, params: TerminalConnectParams) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    return manager.connect(threadId, params.workspacePath, params.cols, params.rows)
  })

  ipcMain.handle("terminal:getState", async (_event, params: { threadId: string }) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    return manager.getState(threadId)
  })

  ipcMain.handle("terminal:input", async (_event, params: TerminalInputParams) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    if (typeof params?.data !== "string") {
      throw new Error("data must be a string.")
    }
    manager.input(threadId, params.data)
  })

  ipcMain.handle("terminal:resize", async (_event, params: TerminalResizeParams) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    const cols = assertFiniteNumber(params?.cols, "cols")
    const rows = assertFiniteNumber(params?.rows, "rows")
    return manager.resize(threadId, cols, rows)
  })

  ipcMain.handle("terminal:kill", async (_event, params: TerminalKillParams) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    return manager.kill(threadId)
  })

  ipcMain.handle("terminal:restart", async (_event, params: TerminalRestartParams) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    return manager.restart(threadId, params.workspacePath, params.cols, params.rows)
  })

  ipcMain.handle("terminal:dispose", async (_event, params: { threadId: string }) => {
    const threadId = assertNonEmptyString(params?.threadId, "threadId")
    manager.dispose(threadId)
  })
}
