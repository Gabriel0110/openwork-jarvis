import type { IpcMain } from "electron"
import { deletePolicy, listPoliciesByAgent, upsertPolicy } from "../db/policies"
import { resolvePolicyDecision } from "../services/policy-engine"
import { getSecurityDefaults } from "../storage"
import type { PolicyDeleteParams, PolicyResolveParams, PolicyUpsertParams } from "../types"

export function registerPolicyHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("policies:list", async (_event, agentId: string) => {
    return listPoliciesByAgent(agentId)
  })

  ipcMain.handle("policies:upsert", async (_event, params: PolicyUpsertParams) => {
    return upsertPolicy(params)
  })

  ipcMain.handle("policies:delete", async (_event, { policyId }: PolicyDeleteParams) => {
    deletePolicy(policyId)
  })

  ipcMain.handle("policies:resolveDecision", async (_event, params: PolicyResolveParams) => {
    return resolvePolicyDecision({
      ...params,
      securityDefaults: params.securityDefaults || getSecurityDefaults()
    })
  })
}
