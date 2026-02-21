import type { IpcMain } from "electron"
import type {
  ZeroClawDeploymentCreateParams,
  ZeroClawDeploymentDeleteParams,
  ZeroClawDeploymentGetParams,
  ZeroClawDeploymentListParams,
  ZeroClawDeploymentUpdateParams,
  ZeroClawDoctorRunParams,
  ZeroClawInstallVersionParams,
  ZeroClawLogsParams,
  ZeroClawPolicySetParams,
  ZeroClawRuntimeActionParams,
  ZeroClawUpgradeParams
} from "../types"
import { getZeroClawManager } from "../zeroclaw/manager"

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message)
  }
}

function ensureDeploymentId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("deploymentId is required.")
  }
  return value
}

export function registerZeroClawHandlers(ipcMain: IpcMain): void {
  const manager = getZeroClawManager()

  ipcMain.handle("zeroclaw:install:getStatus", async () => {
    return manager.getInstallStatus()
  })

  ipcMain.handle("zeroclaw:install:getActivity", async () => {
    return manager.getInstallActivity()
  })

  ipcMain.handle(
    "zeroclaw:install:installVersion",
    async (_event, params?: ZeroClawInstallVersionParams) => {
      return manager.installVersion(params?.version)
    }
  )

  ipcMain.handle("zeroclaw:install:verify", async () => {
    return manager.verifyInstallation()
  })

  ipcMain.handle("zeroclaw:install:upgrade", async (_event, params: ZeroClawUpgradeParams) => {
    if (!params?.version || params.version.trim().length === 0) {
      throw new Error("version is required for upgrade.")
    }
    return manager.upgrade(params.version)
  })

  ipcMain.handle(
    "zeroclaw:deployment:list",
    async (_event, params?: ZeroClawDeploymentListParams) => {
      return manager.listDeployments(params?.workspaceId)
    }
  )

  ipcMain.handle("zeroclaw:deployment:get", async (_event, params: ZeroClawDeploymentGetParams) => {
    const deployment = manager.getDeployment(ensureDeploymentId(params?.deploymentId))
    if (!deployment) {
      throw new Error("ZeroClaw deployment not found.")
    }
    return deployment
  })

  ipcMain.handle(
    "zeroclaw:deployment:create",
    async (_event, params: ZeroClawDeploymentCreateParams) => {
      assertObject(params, "Invalid create deployment payload.")
      assertObject(params.spec, "spec is required.")
      if (typeof params.spec.name !== "string" || params.spec.name.trim().length === 0) {
        throw new Error("Deployment name is required.")
      }
      if (
        typeof params.spec.workspacePath !== "string" ||
        params.spec.workspacePath.trim().length === 0
      ) {
        throw new Error("workspacePath is required.")
      }
      if (typeof params.spec.modelProvider !== "string" || !params.spec.modelProvider) {
        throw new Error("modelProvider is required.")
      }
      if (typeof params.spec.modelName !== "string" || !params.spec.modelName) {
        throw new Error("modelName is required.")
      }
      return manager.createDeployment(params.spec)
    }
  )

  ipcMain.handle(
    "zeroclaw:deployment:update",
    async (_event, params: ZeroClawDeploymentUpdateParams) => {
      assertObject(params, "Invalid update deployment payload.")
      return manager.updateDeployment(ensureDeploymentId(params.deploymentId), params.updates || {})
    }
  )

  ipcMain.handle(
    "zeroclaw:deployment:delete",
    async (_event, params: ZeroClawDeploymentDeleteParams) => {
      await manager.deleteDeployment(ensureDeploymentId(params?.deploymentId))
    }
  )

  ipcMain.handle("zeroclaw:runtime:start", async (_event, params: ZeroClawRuntimeActionParams) => {
    return manager.startRuntime(ensureDeploymentId(params?.deploymentId))
  })

  ipcMain.handle("zeroclaw:runtime:stop", async (_event, params: ZeroClawRuntimeActionParams) => {
    return manager.stopRuntime(ensureDeploymentId(params?.deploymentId))
  })

  ipcMain.handle(
    "zeroclaw:runtime:restart",
    async (_event, params: ZeroClawRuntimeActionParams) => {
      return manager.restartRuntime(ensureDeploymentId(params?.deploymentId))
    }
  )

  ipcMain.handle(
    "zeroclaw:runtime:getHealth",
    async (_event, params: ZeroClawRuntimeActionParams) => {
      return manager.getHealth(ensureDeploymentId(params?.deploymentId))
    }
  )

  ipcMain.handle("zeroclaw:logs:get", async (_event, params: ZeroClawLogsParams) => {
    if (!params || typeof params !== "object") {
      throw new Error("Invalid logs payload.")
    }
    return manager.getLogs(ensureDeploymentId(params.deploymentId), params.cursor, params.limit)
  })

  ipcMain.handle("zeroclaw:policy:get", async (_event, params: ZeroClawRuntimeActionParams) => {
    return manager.getPolicy(ensureDeploymentId(params?.deploymentId))
  })

  ipcMain.handle("zeroclaw:policy:set", async (_event, params: ZeroClawPolicySetParams) => {
    assertObject(params, "Invalid policy payload.")
    assertObject(params.policy, "policy is required.")
    return manager.setPolicy(ensureDeploymentId(params.deploymentId), params.policy)
  })

  ipcMain.handle("zeroclaw:doctor:run", async (_event, params?: ZeroClawDoctorRunParams) => {
    return manager.runDoctor(params?.deploymentId)
  })
}
