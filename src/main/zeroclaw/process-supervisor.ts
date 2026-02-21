import { spawn } from "node:child_process"
import type { ZeroClawDeploymentStatus, ZeroClawRuntimeHealth } from "../types"
import { ZeroClawEventBridge } from "./event-bridge"
import { ZeroClawHealthPoller } from "./health-poller"
import type { ZeroClawSupervisorHandle, ZeroClawSupervisorLaunchOptions } from "./types"

interface SupervisorRecord {
  handle: ZeroClawSupervisorHandle
  process: ReturnType<typeof spawn> | null
  poller: ZeroClawHealthPoller | null
  bridge: ZeroClawEventBridge
  options: ZeroClawSupervisorLaunchOptions
  restartCount: number
  restartTimer: ReturnType<typeof setTimeout> | null
  stopping: boolean
}

interface ZeroClawProcessSupervisorOptions {
  onStatusChange?: (
    deploymentId: string,
    status: ZeroClawDeploymentStatus,
    updates?: { pid?: number; lastError?: string }
  ) => void
  onHealth?: (health: ZeroClawRuntimeHealth) => void
}

function resolveStatusFromHealth(
  previous: ZeroClawDeploymentStatus,
  health: ZeroClawRuntimeHealth
): ZeroClawDeploymentStatus {
  if (health.status === "healthy") {
    return "running"
  }
  if (previous === "starting" && health.status === "unknown") {
    return "starting"
  }
  if (health.status === "degraded") {
    return "running"
  }
  if (health.status === "unhealthy") {
    return previous === "stopping" ? "stopping" : "error"
  }
  return previous
}

export class ZeroClawProcessSupervisor {
  private readonly records = new Map<string, SupervisorRecord>()
  private readonly onStatusChange?: ZeroClawProcessSupervisorOptions["onStatusChange"]
  private readonly onHealth?: ZeroClawProcessSupervisorOptions["onHealth"]

  constructor(options?: ZeroClawProcessSupervisorOptions) {
    this.onStatusChange = options?.onStatusChange
    this.onHealth = options?.onHealth
  }

  getHandle(deploymentId: string): ZeroClawSupervisorHandle | undefined {
    return this.records.get(deploymentId)?.handle
  }

  getHandles(): ZeroClawSupervisorHandle[] {
    return Array.from(this.records.values()).map((entry) => entry.handle)
  }

  async start(options: ZeroClawSupervisorLaunchOptions): Promise<ZeroClawSupervisorHandle> {
    const existing = this.records.get(options.deployment.id)
    if (existing?.process && !existing.process.killed) {
      return existing.handle
    }

    const bridge = new ZeroClawEventBridge({
      deploymentId: options.deployment.id,
      logPath: options.logPath
    })
    const emitEvent = (event: {
      eventType: string
      severity: "debug" | "info" | "warning" | "error"
      message: string
      payload?: Record<string, unknown>
      correlationId?: string
    }): void => {
      bridge.emitProcessEvent({
        deploymentId: options.deployment.id,
        ...event
      })
      options.onEvent({
        deploymentId: options.deployment.id,
        ...event
      })
    }
    const child = spawn(
      options.binaryPath,
      [
        "daemon",
        "--host",
        options.deployment.gatewayHost,
        "--port",
        String(options.deployment.gatewayPort)
      ],
      {
        cwd: options.deployment.workspacePath,
        env: {
          ...process.env,
          ...options.env,
          ZEROCLAW_PROVIDER: options.deployment.modelProvider,
          ZEROCLAW_MODEL: options.deployment.modelName,
          ZEROCLAW_WORKSPACE: options.deployment.workspacePath,
          ZEROCLAW_GATEWAY_HOST: options.deployment.gatewayHost,
          ZEROCLAW_GATEWAY_PORT: String(options.deployment.gatewayPort)
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    )

    const handle: ZeroClawSupervisorHandle = {
      deploymentId: options.deployment.id,
      status: "starting",
      desiredState: "running",
      pid: child.pid,
      startedAt: Date.now()
    }

    const record: SupervisorRecord = {
      handle,
      process: child,
      poller: null,
      bridge,
      options,
      restartCount: existing?.restartCount || 0,
      restartTimer: null,
      stopping: false
    }
    this.records.set(options.deployment.id, record)

    this.onStatusChange?.(options.deployment.id, "starting", { pid: child.pid })
    emitEvent({
      eventType: "process_spawned",
      severity: "info",
      message: `ZeroClaw daemon started (pid ${child.pid || "unknown"}).`,
      payload: {
        pid: child.pid,
        host: options.deployment.gatewayHost,
        port: options.deployment.gatewayPort
      }
    })

    child.stdout.on("data", (chunk: Buffer) => {
      bridge.ingestStdout(chunk.toString())
    })
    child.stderr.on("data", (chunk: Buffer) => {
      bridge.ingestStderr(chunk.toString())
    })
    child.on("error", (error) => {
      emitEvent({
        eventType: "process_error",
        severity: "error",
        message: error.message
      })
      this.updateStatus(options.deployment.id, "error", { lastError: error.message })
    })
    child.on("close", (code, signal) => {
      this.handleProcessClose(options.deployment.id, code, signal)
    })

    const poller = new ZeroClawHealthPoller({
      deploymentId: options.deployment.id,
      apiBaseUrl: options.deployment.apiBaseUrl,
      onHealth: (health) => {
        const recordForHealth = this.records.get(options.deployment.id)
        if (!recordForHealth) {
          return
        }
        recordForHealth.handle.health = health
        this.onHealth?.(health)

        const nextStatus = resolveStatusFromHealth(recordForHealth.handle.status, health)
        if (nextStatus !== recordForHealth.handle.status) {
          this.updateStatus(options.deployment.id, nextStatus, {
            lastError: health.error
          })
        }
      }
    })
    poller.start()
    record.poller = poller
    return handle
  }

  async stop(deploymentId: string): Promise<void> {
    const record = this.records.get(deploymentId)
    if (!record) {
      return
    }

    record.handle.desiredState = "stopped"
    record.stopping = true
    this.updateStatus(deploymentId, "stopping")

    if (record.restartTimer) {
      clearTimeout(record.restartTimer)
      record.restartTimer = null
    }

    if (!record.process || record.process.killed) {
      record.poller?.stop()
      record.poller = null
      this.updateStatus(deploymentId, "stopped")
      return
    }

    const processRef = record.process
    processRef.kill("SIGTERM")
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!processRef.killed) {
          processRef.kill("SIGKILL")
        }
      }, 4_000)
      processRef.once("close", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  async restart(deploymentId: string): Promise<ZeroClawSupervisorHandle | null> {
    const record = this.records.get(deploymentId)
    if (!record) {
      return null
    }
    const options = record.options
    await this.stop(deploymentId)
    return this.start(options)
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.records.keys())
    for (const deploymentId of ids) {
      await this.stop(deploymentId)
    }
  }

  forget(deploymentId: string): void {
    const record = this.records.get(deploymentId)
    if (!record) {
      return
    }
    if (record.restartTimer) {
      clearTimeout(record.restartTimer)
    }
    record.poller?.stop()
    this.records.delete(deploymentId)
  }

  private handleProcessClose(
    deploymentId: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const record = this.records.get(deploymentId)
    if (!record) {
      return
    }

    record.poller?.stop()
    record.poller = null
    record.process = null

    const emitEvent = (event: {
      eventType: string
      severity: "debug" | "info" | "warning" | "error"
      message: string
      payload?: Record<string, unknown>
      correlationId?: string
    }): void => {
      record.bridge.emitProcessEvent({
        deploymentId,
        ...event
      })
      record.options.onEvent({
        deploymentId,
        ...event
      })
    }

    emitEvent({
      eventType: "process_exit",
      severity: code === 0 ? "info" : "warning",
      message: `ZeroClaw daemon exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
      payload: {
        code,
        signal
      }
    })

    if (record.stopping || record.handle.desiredState === "stopped") {
      this.updateStatus(deploymentId, "stopped")
      return
    }

    this.updateStatus(deploymentId, "error", {
      lastError: `process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`
    })

    record.restartCount += 1
    const delayMs = Math.min(30_000, 1_000 * Math.pow(2, Math.min(6, record.restartCount)))
    emitEvent({
      eventType: "process_restart_scheduled",
      severity: "warning",
      message: `Restart scheduled in ${delayMs}ms.`,
      payload: {
        restartCount: record.restartCount,
        delayMs
      }
    })

    record.restartTimer = setTimeout(() => {
      record.restartTimer = null
      record.stopping = false
      void this.start(record.options)
    }, delayMs)
  }

  private updateStatus(
    deploymentId: string,
    status: ZeroClawDeploymentStatus,
    updates?: { pid?: number; lastError?: string }
  ): void {
    const record = this.records.get(deploymentId)
    if (!record) {
      return
    }
    record.handle.status = status
    if (updates?.pid !== undefined) {
      record.handle.pid = updates.pid
    }
    this.onStatusChange?.(deploymentId, status, updates)
  }
}
