import type { ZeroClawRuntimeHealth } from "../types"

interface HealthPollerOptions {
  deploymentId: string
  apiBaseUrl: string
  intervalMs?: number
  timeoutMs?: number
  onHealth: (health: ZeroClawRuntimeHealth) => void
}

export class ZeroClawHealthPoller {
  private readonly deploymentId: string
  private readonly apiBaseUrl: string
  private readonly intervalMs: number
  private readonly timeoutMs: number
  private readonly onHealth: (health: ZeroClawRuntimeHealth) => void
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: HealthPollerOptions) {
    this.deploymentId = options.deploymentId
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "")
    this.intervalMs = Math.max(2_000, options.intervalMs || 5_000)
    this.timeoutMs = Math.max(1_000, options.timeoutMs || 2_500)
    this.onHealth = options.onHealth
  }

  start(): void {
    if (this.timer) {
      return
    }
    void this.pollOnce()
    this.timer = setInterval(() => {
      void this.pollOnce()
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async pollOnce(): Promise<void> {
    const started = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.apiBaseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      })
      const latencyMs = Date.now() - started
      if (!response.ok) {
        this.onHealth({
          deploymentId: this.deploymentId,
          status: "degraded",
          checkedAt: new Date(),
          latencyMs,
          error: `HTTP ${response.status}`
        })
        return
      }

      const body = (await response.json()) as unknown
      this.onHealth({
        deploymentId: this.deploymentId,
        status: "healthy",
        checkedAt: new Date(),
        latencyMs,
        detail: typeof body === "object" && body ? (body as Record<string, unknown>) : {}
      })
    } catch (error) {
      this.onHealth({
        deploymentId: this.deploymentId,
        status: "unhealthy",
        checkedAt: new Date(),
        error: error instanceof Error ? error.message : "Health request failed"
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
