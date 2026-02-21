import type { IpcMain } from "electron"
import {
  createTool,
  deleteTool,
  ensureDefaultTools,
  getTool,
  listTools,
  updateTool
} from "../db/tools"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import type {
  ToolCreateParams,
  ToolDeleteParams,
  ToolGetParams,
  ToolListParams,
  ToolUpdateParams
} from "../types"

export function registerToolHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("tools:list", async (_event, params?: ToolListParams) => {
    const workspaceId = params?.workspaceId || DEFAULT_WORKSPACE_ID
    ensureDefaultTools(workspaceId)
    return listTools(workspaceId, params?.includeDisabled ?? true)
  })

  ipcMain.handle("tools:get", async (_event, params: ToolGetParams) => {
    const tool = getTool(params.toolId)
    if (!tool) {
      throw new Error("Tool not found.")
    }
    return tool
  })

  ipcMain.handle("tools:create", async (_event, params: ToolCreateParams) => {
    const workspaceId = params.workspaceId || DEFAULT_WORKSPACE_ID
    ensureDefaultTools(workspaceId)
    return createTool({
      workspaceId,
      name: params.name,
      displayName: params.displayName,
      description: params.description,
      category: params.category,
      action: params.action,
      riskTier: params.riskTier,
      implementationType: params.implementationType,
      config: params.config,
      enabled: params.enabled
    })
  })

  ipcMain.handle("tools:update", async (_event, params: ToolUpdateParams) => {
    const updated = updateTool(params.toolId, params.updates)
    if (!updated) {
      throw new Error("Tool not found.")
    }
    return updated
  })

  ipcMain.handle("tools:delete", async (_event, params: ToolDeleteParams) => {
    deleteTool(params.toolId)
  })
}
