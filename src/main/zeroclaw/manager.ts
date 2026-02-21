import { existsSync, mkdirSync } from "node:fs"
import { createServer } from "node:net"
import {
  createZeroClawDeployment,
  createZeroClawRuntimeEvent,
  deleteZeroClawDeployment,
  getActiveZeroClawInstallation,
  getZeroClawDeployment,
  getZeroClawDeploymentRuntimeData,
  listZeroClawDeployments,
  listZeroClawRuntimeEvents,
  resolveZeroClawPolicyForDeployment,
  updateZeroClawDeployment,
  upsertZeroClawPolicyBinding
} from "../db/zeroclaw"
import { listConnectors } from "../db/connectors"
import { listTools } from "../db/tools"
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces"
import { getApiKey, getZeroClawRuntimeDir } from "../storage"
import type {
  ConnectorDefinition,
  ToolDefinition,
  ZeroClawActionResult,
  ZeroClawCapabilityMode,
  ZeroClawCapabilityPolicy,
  ZeroClawDeploymentSpec,
  ZeroClawDeploymentState,
  ZeroClawDoctorCheck,
  ZeroClawDoctorReport,
  ZeroClawEffectiveCapabilitySet,
  ZeroClawInstallStatus,
  ZeroClawInstallActivity,
  ZeroClawRuntimeHealth
} from "../types"
import { listGlobalSkills } from "../services/skills-registry"
import { writeZeroClawDeploymentConfig } from "./config-builder"
import { ZeroClawInstaller } from "./installer"
import { ZeroClawProcessSupervisor } from "./process-supervisor"
import { loadZeroClawManifest } from "./release-manifest"

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function normalizePolicy(input?: Partial<ZeroClawCapabilityPolicy>): ZeroClawCapabilityPolicy {
  return {
    mode:
      input?.mode === "global_plus_assigned" ||
      input?.mode === "assigned_only" ||
      input?.mode === "deny_all_except_assigned"
        ? input.mode
        : "global_only",
    includeGlobalSkills: input?.includeGlobalSkills !== false,
    assignedSkillIds: Array.from(
      new Set((input?.assignedSkillIds || []).map((item) => item.trim()))
    ),
    assignedToolNames: Array.from(
      new Set((input?.assignedToolNames || []).map((item) => normalizeToken(item)))
    ),
    assignedConnectorKeys: Array.from(
      new Set((input?.assignedConnectorKeys || []).map((item) => normalizeToken(item)))
    ),
    deniedToolNames: Array.from(
      new Set((input?.deniedToolNames || []).map((item) => normalizeToken(item)))
    ),
    deniedConnectorKeys: Array.from(
      new Set((input?.deniedConnectorKeys || []).map((item) => normalizeToken(item)))
    )
  }
}

function resolveCapabilitiesForMode<T extends { name?: string; key?: string }>(
  mode: ZeroClawCapabilityMode,
  allEntries: T[],
  assignedIds: string[],
  deniedIds: string[],
  idSelector: (entry: T) => string
): T[] {
  const assigned = new Set(assignedIds.map((item) => normalizeToken(item)))
  const denied = new Set(deniedIds.map((item) => normalizeToken(item)))

  const all = allEntries.filter((entry) => !denied.has(idSelector(entry)))
  if (mode === "global_only") {
    return all
  }

  const selected = allEntries.filter((entry) => assigned.has(idSelector(entry)))
  if (mode === "assigned_only" || mode === "deny_all_except_assigned") {
    return selected.filter((entry) => !denied.has(idSelector(entry)))
  }

  const union = new Map<string, T>()
  for (const entry of all) {
    union.set(idSelector(entry), entry)
  }
  for (const entry of selected) {
    union.set(idSelector(entry), entry)
  }
  return Array.from(union.values()).filter((entry) => !denied.has(idSelector(entry)))
}

function computeGates(
  tools: ToolDefinition[],
  connectors: ConnectorDefinition[]
): ZeroClawEffectiveCapabilitySet["gates"] {
  const hasRead = tools.some((tool) => tool.action === "read")
  const hasWrite = tools.some((tool) => tool.action === "write")
  const hasExec = tools.some((tool) => tool.action === "exec")
  const hasNetwork =
    tools.some((tool) => tool.category === "network" || tool.action === "post") ||
    connectors.length > 0
  const hasChannel = connectors.length > 0 || tools.some((tool) => tool.category === "connector")
  return {
    read: hasRead,
    write: hasWrite,
    exec: hasExec,
    network: hasNetwork,
    channel: hasChannel
  }
}

function providerApiKey(provider: ZeroClawDeploymentSpec["modelProvider"]): string | undefined {
  return getApiKey(provider)
}

async function findAvailablePort(preferred?: number): Promise<number> {
  if (preferred && Number.isInteger(preferred) && preferred > 0) {
    return preferred
  }
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", (error) => reject(error))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Failed to allocate local port."))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

export class ZeroClawManager {
  private readonly installer = new ZeroClawInstaller()
  private readonly supervisor: ZeroClawProcessSupervisor
  private readonly healthByDeployment = new Map<string, ZeroClawRuntimeHealth>()
  private readonly lastHealthStatus = new Map<string, ZeroClawRuntimeHealth["status"]>()
  private lastInstallError: string | undefined

  constructor() {
    this.supervisor = new ZeroClawProcessSupervisor({
      onStatusChange: (deploymentId, status, updates) => {
        const updated = updateZeroClawDeployment(deploymentId, {
          status,
          processId: updates?.pid,
          lastError: updates?.lastError
        })
        if (!updated) {
          return
        }

        createZeroClawRuntimeEvent({
          deploymentId,
          eventType: "status",
          severity: status === "error" ? "error" : "info",
          message: `Runtime status changed to ${status}.`,
          payload: {
            status,
            pid: updates?.pid,
            lastError: updates?.lastError
          }
        })
      },
      onHealth: (health) => {
        this.healthByDeployment.set(health.deploymentId, health)
        const last = this.lastHealthStatus.get(health.deploymentId)
        if (last !== health.status) {
          this.lastHealthStatus.set(health.deploymentId, health.status)
          createZeroClawRuntimeEvent({
            deploymentId: health.deploymentId,
            eventType: "health",
            severity:
              health.status === "healthy"
                ? "info"
                : health.status === "degraded"
                  ? "warning"
                  : health.status === "unhealthy"
                    ? "error"
                    : "debug",
            message:
              health.status === "healthy"
                ? "Health probe OK."
                : health.error || `Health status: ${health.status}`,
            payload: {
              status: health.status,
              latencyMs: health.latencyMs,
              detail: health.detail || {}
            }
          })
        }
      }
    })
  }

  async hydrate(): Promise<void> {
    const deployments = listZeroClawDeployments(DEFAULT_WORKSPACE_ID)
    for (const deployment of deployments) {
      if (deployment.desiredState === "running") {
        try {
          await this.startRuntime(deployment.id)
        } catch (error) {
          createZeroClawRuntimeEvent({
            deploymentId: deployment.id,
            eventType: "hydrate_start_failed",
            severity: "error",
            message: error instanceof Error ? error.message : "Failed to start deployment on launch"
          })
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.supervisor.stopAll()
  }

  getInstallStatus(): ZeroClawInstallStatus {
    return this.installer.getInstallStatus(this.lastInstallError)
  }

  getInstallActivity(): ZeroClawInstallActivity {
    return this.installer.getInstallActivity()
  }

  async installVersion(version?: string): Promise<ZeroClawInstallStatus> {
    try {
      await this.installer.installVersion(version)
      this.lastInstallError = undefined
      return this.getInstallStatus()
    } catch (error) {
      this.lastInstallError = error instanceof Error ? error.message : "Install failed"
      throw error
    }
  }

  async verifyInstallation(): Promise<ZeroClawActionResult> {
    return this.installer.verifyActiveInstallation()
  }

  async upgrade(version: string): Promise<ZeroClawInstallStatus> {
    try {
      await this.installer.upgrade(version)
      this.lastInstallError = undefined
      return this.getInstallStatus()
    } catch (error) {
      this.lastInstallError = error instanceof Error ? error.message : "Upgrade failed"
      throw error
    }
  }

  listDeployments(workspaceId?: string): ZeroClawDeploymentState[] {
    return listZeroClawDeployments(workspaceId || DEFAULT_WORKSPACE_ID)
  }

  getDeployment(deploymentId: string): ZeroClawDeploymentState | null {
    return getZeroClawDeployment(deploymentId)
  }

  private resolveEffectiveCapabilities(
    workspaceId: string,
    policy: ZeroClawCapabilityPolicy
  ): ZeroClawEffectiveCapabilitySet {
    const skills = listGlobalSkills().skills
    const tools = listTools(workspaceId, false)
    const connectors = listConnectors(workspaceId).filter((entry) => entry.enabled)

    const effectiveSkills =
      policy.includeGlobalSkills || policy.mode !== "assigned_only"
        ? resolveCapabilitiesForMode(policy.mode, skills, policy.assignedSkillIds, [], (entry) =>
            normalizeToken(entry.id)
          )
        : skills.filter((entry) => policy.assignedSkillIds.includes(entry.id))

    const effectiveTools = resolveCapabilitiesForMode(
      policy.mode,
      tools.filter((entry) => entry.enabled),
      policy.assignedToolNames,
      policy.deniedToolNames,
      (entry) => normalizeToken(entry.name)
    )
    const effectiveConnectors = resolveCapabilitiesForMode(
      policy.mode,
      connectors,
      policy.assignedConnectorKeys,
      policy.deniedConnectorKeys,
      (entry) => normalizeToken(entry.key)
    )

    return {
      mode: policy.mode,
      skills: effectiveSkills,
      tools: effectiveTools,
      connectors: effectiveConnectors,
      gates: computeGates(effectiveTools, effectiveConnectors)
    }
  }

  private buildRuntimeEnv(deployment: ZeroClawDeploymentState): Record<string, string> {
    const runtimeData = getZeroClawDeploymentRuntimeData(deployment.id)
    const env: Record<string, string> = {
      ...(runtimeData?.env || {})
    }

    const key = providerApiKey(deployment.modelProvider)
    if (key) {
      env.ZEROCLAW_API_KEY = key
    }
    return env
  }

  private async ensureRuntimeVersion(version: string): Promise<void> {
    const installStatus = this.getInstallStatus()
    const hasVersion = installStatus.installations.some((entry) => entry.version === version)
    if (hasVersion) {
      return
    }
    await this.installVersion(version)
  }

  async createDeployment(spec: ZeroClawDeploymentSpec): Promise<ZeroClawDeploymentState> {
    const workspaceId = spec.workspaceId || DEFAULT_WORKSPACE_ID
    const runtimeVersion =
      spec.runtimeVersion ||
      getActiveZeroClawInstallation()?.version ||
      loadZeroClawManifest().latestVersion
    const gatewayPort = await findAvailablePort(spec.gatewayPort)
    const gatewayHost = spec.gatewayHost || "127.0.0.1"
    const apiBaseUrl = spec.apiBaseUrl || `http://${gatewayHost}:${gatewayPort}`
    const policy = normalizePolicy(spec.policy)
    const effectiveCapabilities = this.resolveEffectiveCapabilities(workspaceId, policy)

    const deployment = createZeroClawDeployment({
      workspaceId,
      name: spec.name,
      description: spec.description,
      runtimeVersion,
      workspacePath: spec.workspacePath,
      modelProvider: spec.modelProvider,
      modelName: spec.modelName,
      gatewayHost,
      gatewayPort,
      apiBaseUrl,
      desiredState: spec.autoStart === false ? "stopped" : "running",
      status: "created",
      env: spec.env || {},
      config: {},
      policy,
      effectiveCapabilities
    })
    upsertZeroClawPolicyBinding(deployment.id, policy)
    writeZeroClawDeploymentConfig({
      deployment,
      policy,
      effectiveCapabilities
    })

    createZeroClawRuntimeEvent({
      deploymentId: deployment.id,
      eventType: "deployment_created",
      severity: "info",
      message: `Deployment "${deployment.name}" created.`,
      payload: {
        runtimeVersion,
        workspacePath: deployment.workspacePath
      }
    })

    if (spec.autoStart !== false) {
      await this.startRuntime(deployment.id)
      return getZeroClawDeployment(deployment.id) as ZeroClawDeploymentState
    }
    return deployment
  }

  async updateDeployment(
    deploymentId: string,
    updates: Partial<
      Omit<ZeroClawDeploymentSpec, "workspaceId" | "policy"> & {
        desiredState: ZeroClawDeploymentState["desiredState"]
        policy: Partial<ZeroClawCapabilityPolicy>
      }
    >
  ): Promise<ZeroClawDeploymentState> {
    const existing = getZeroClawDeployment(deploymentId)
    if (!existing) {
      throw new Error("ZeroClaw deployment not found.")
    }

    const policy = normalizePolicy({
      ...existing.policy,
      ...(updates.policy || {})
    })
    const effective = this.resolveEffectiveCapabilities(existing.workspaceId, policy)

    const updated = updateZeroClawDeployment(deploymentId, {
      name: updates.name,
      description: updates.description,
      runtimeVersion: updates.runtimeVersion,
      workspacePath: updates.workspacePath,
      modelProvider: updates.modelProvider,
      modelName: updates.modelName,
      gatewayHost: updates.gatewayHost,
      gatewayPort: updates.gatewayPort,
      apiBaseUrl: updates.apiBaseUrl,
      desiredState: updates.desiredState,
      env: updates.env,
      policy,
      effectiveCapabilities: effective,
      lastError: null
    })
    if (!updated) {
      throw new Error("Failed to update ZeroClaw deployment.")
    }

    upsertZeroClawPolicyBinding(deploymentId, policy)
    writeZeroClawDeploymentConfig({
      deployment: updated,
      policy,
      effectiveCapabilities: effective
    })

    if (updates.desiredState === "running") {
      await this.startRuntime(deploymentId)
    } else if (updates.desiredState === "stopped") {
      await this.stopRuntime(deploymentId)
    }

    createZeroClawRuntimeEvent({
      deploymentId,
      eventType: "deployment_updated",
      severity: "info",
      message: `Deployment "${updated.name}" updated.`
    })

    return getZeroClawDeployment(deploymentId) as ZeroClawDeploymentState
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    await this.stopRuntime(deploymentId)
    this.supervisor.forget(deploymentId)
    deleteZeroClawDeployment(deploymentId)
  }

  getPolicy(deploymentId: string): ZeroClawCapabilityPolicy {
    return resolveZeroClawPolicyForDeployment(deploymentId)
  }

  async setPolicy(
    deploymentId: string,
    policyInput: ZeroClawCapabilityPolicy
  ): Promise<ZeroClawDeploymentState> {
    const deployment = getZeroClawDeployment(deploymentId)
    if (!deployment) {
      throw new Error("ZeroClaw deployment not found.")
    }

    const policy = normalizePolicy(policyInput)
    const effective = this.resolveEffectiveCapabilities(deployment.workspaceId, policy)
    upsertZeroClawPolicyBinding(deploymentId, policy)
    const updated = updateZeroClawDeployment(deploymentId, {
      policy,
      effectiveCapabilities: effective
    })
    if (!updated) {
      throw new Error("Failed updating policy.")
    }

    writeZeroClawDeploymentConfig({
      deployment: updated,
      policy,
      effectiveCapabilities: effective
    })
    return updated
  }

  async startRuntime(deploymentId: string): Promise<ZeroClawDeploymentState> {
    const deployment = getZeroClawDeployment(deploymentId)
    if (!deployment) {
      throw new Error("ZeroClaw deployment not found.")
    }

    await this.ensureRuntimeVersion(deployment.runtimeVersion)
    const installStatus = this.getInstallStatus()
    const installation = installStatus.installations.find(
      (entry) => entry.version === deployment.runtimeVersion
    )
    if (!installation) {
      throw new Error(`Runtime version ${deployment.runtimeVersion} is not installed.`)
    }

    const runtimeRoot = getZeroClawRuntimeDir()
    mkdirSync(runtimeRoot, { recursive: true })
    const runtimeData = getZeroClawDeploymentRuntimeData(deploymentId)
    const policy = this.getPolicy(deploymentId)
    const effective = deployment.effectiveCapabilities
    const files = writeZeroClawDeploymentConfig({
      deployment,
      policy,
      effectiveCapabilities: effective
    })
    const env = this.buildRuntimeEnv(deployment)

    await this.supervisor.start({
      deployment,
      binaryPath: installation.binaryPath,
      configPath: files.configPath,
      logPath: files.logPath,
      envPath: files.envPath,
      env: {
        ...env,
        ...(runtimeData?.env || {}),
        HOME: files.homeDir
      },
      onEvent: () => {
        // Event bridge writes directly to DB; manager-level event callback is reserved for future hooks.
      }
    })

    const updated = updateZeroClawDeployment(deploymentId, {
      desiredState: "running"
    })
    if (!updated) {
      throw new Error("Failed to persist runtime start state.")
    }
    return updated
  }

  async stopRuntime(deploymentId: string): Promise<ZeroClawDeploymentState> {
    await this.supervisor.stop(deploymentId)
    const updated = updateZeroClawDeployment(deploymentId, {
      desiredState: "stopped",
      status: "stopped",
      processId: null
    })
    if (!updated) {
      throw new Error("ZeroClaw deployment not found.")
    }
    return updated
  }

  async restartRuntime(deploymentId: string): Promise<ZeroClawDeploymentState> {
    const handle = await this.supervisor.restart(deploymentId)
    const updated = updateZeroClawDeployment(deploymentId, {
      desiredState: "running",
      status: handle ? "starting" : "error"
    })
    if (!updated) {
      throw new Error("ZeroClaw deployment not found.")
    }
    return updated
  }

  getHealth(deploymentId: string): ZeroClawRuntimeHealth {
    return (
      this.healthByDeployment.get(deploymentId) || {
        deploymentId,
        status: "unknown",
        checkedAt: new Date()
      }
    )
  }

  getLogs(deploymentId: string, cursor?: string, limit?: number) {
    return listZeroClawRuntimeEvents(deploymentId, {
      cursor,
      limit
    })
  }

  async runDoctor(deploymentId?: string): Promise<ZeroClawDoctorReport> {
    const checks: ZeroClawDoctorCheck[] = []
    const installStatus = this.getInstallStatus()
    const active = installStatus.installations.find((entry) => entry.isActive)

    checks.push({
      id: "runtime-installed",
      label: "Runtime installation",
      ok: !!active,
      details: active
        ? `Active version ${active.version}`
        : "No active ZeroClaw installation found.",
      repairHint: active ? undefined : "Install a runtime version before starting deployments."
    })

    if (active) {
      const verify = await this.installer.verifyInstalledVersion(active.version)
      checks.push({
        id: "runtime-integrity",
        label: "Binary integrity",
        ok: verify.ok,
        details: verify.message,
        repairHint: verify.ok ? undefined : "Reinstall runtime version to repair binary."
      })
    }

    if (deploymentId) {
      const deployment = getZeroClawDeployment(deploymentId)
      if (!deployment) {
        checks.push({
          id: "deployment-exists",
          label: "Deployment exists",
          ok: false,
          details: "Deployment not found."
        })
      } else {
        checks.push({
          id: "workspace-path",
          label: "Workspace path accessible",
          ok: existsSync(deployment.workspacePath),
          details: deployment.workspacePath,
          repairHint: "Update deployment workspace path to an existing directory."
        })
        checks.push({
          id: "provider-key",
          label: "Provider API key present",
          ok: Boolean(providerApiKey(deployment.modelProvider)),
          details: deployment.modelProvider,
          repairHint: `Set ${deployment.modelProvider} API key in Settings before starting runtime.`
        })
      }
    }

    const healthy = checks.every((check) => check.ok)
    return {
      deploymentId,
      generatedAt: new Date(),
      healthy,
      checks
    }
  }
}

let managerSingleton: ZeroClawManager | null = null

export function getZeroClawManager(): ZeroClawManager {
  if (!managerSingleton) {
    managerSingleton = new ZeroClawManager()
  }
  return managerSingleton
}
