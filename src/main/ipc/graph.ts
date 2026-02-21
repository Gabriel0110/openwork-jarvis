import type { IpcMain } from "electron"
import {
  clearGraphLayoutByWorkspace,
  listGraphLayoutByWorkspace,
  upsertGraphLayout
} from "../db/graph-layouts"
import type {
  GraphLayoutClearParams,
  GraphLayoutListParams,
  GraphLayoutUpsertParams
} from "../types"

export function registerGraphHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("graph:getLayout", async (_event, params: GraphLayoutListParams) => {
    return listGraphLayoutByWorkspace(params.workspaceId)
  })

  ipcMain.handle("graph:upsertLayout", async (_event, params: GraphLayoutUpsertParams) => {
    return upsertGraphLayout({
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      x: params.x,
      y: params.y
    })
  })

  ipcMain.handle("graph:clearLayout", async (_event, params: GraphLayoutClearParams) => {
    clearGraphLayoutByWorkspace(params.workspaceId)
  })
}
