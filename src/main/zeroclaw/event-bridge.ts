import { appendFileSync } from "node:fs"
import { createZeroClawRuntimeEvent } from "../db/zeroclaw"
import type { ZeroClawEventSeverity, ZeroClawRuntimeEvent } from "../types"
import type { ZeroClawProcessEvent } from "./types"

interface ZeroClawEventBridgeOptions {
  deploymentId: string
  logPath: string
  onEvent?: (event: ZeroClawRuntimeEvent) => void
}

function toSeverity(
  value: unknown,
  fallback: ZeroClawEventSeverity = "info"
): ZeroClawEventSeverity {
  if (value === "debug" || value === "info" || value === "warning" || value === "error") {
    return value
  }
  return fallback
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // no-op
  }
  return null
}

export class ZeroClawEventBridge {
  private readonly deploymentId: string
  private readonly logPath: string
  private readonly onEvent?: (event: ZeroClawRuntimeEvent) => void
  private stdoutBuffer = ""
  private stderrBuffer = ""

  constructor(options: ZeroClawEventBridgeOptions) {
    this.deploymentId = options.deploymentId
    this.logPath = options.logPath
    this.onEvent = options.onEvent
  }

  emitProcessEvent(input: ZeroClawProcessEvent): ZeroClawRuntimeEvent {
    const event = createZeroClawRuntimeEvent({
      deploymentId: input.deploymentId,
      eventType: input.eventType,
      severity: input.severity,
      message: input.message,
      payload: input.payload,
      correlationId: input.correlationId
    })
    this.onEvent?.(event)
    return event
  }

  ingestStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    this.consumeBuffer("stdout")
  }

  ingestStderr(chunk: string): void {
    this.stderrBuffer += chunk
    this.consumeBuffer("stderr")
  }

  private consumeBuffer(source: "stdout" | "stderr"): void {
    const current = source === "stdout" ? this.stdoutBuffer : this.stderrBuffer
    const lines = current.split("\n")
    const rest = lines.pop() || ""
    if (source === "stdout") {
      this.stdoutBuffer = rest
    } else {
      this.stderrBuffer = rest
    }

    for (const line of lines) {
      this.ingestLine(source, line)
    }
  }

  private ingestLine(source: "stdout" | "stderr", line: string): void {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    appendFileSync(this.logPath, `[${new Date().toISOString()}] ${source}: ${trimmed}\n`, "utf-8")
    const json = parseJsonLine(trimmed)
    if (json) {
      const message =
        typeof json.message === "string"
          ? json.message
          : typeof json.msg === "string"
            ? json.msg
            : `${source} log`
      const eventType =
        typeof json.event === "string"
          ? json.event
          : typeof json.target === "string"
            ? json.target
            : source === "stderr"
              ? "stderr"
              : "stdout"
      this.emitProcessEvent({
        deploymentId: this.deploymentId,
        eventType,
        severity: toSeverity(json.level, source === "stderr" ? "error" : "info"),
        message,
        payload: json
      })
      return
    }

    this.emitProcessEvent({
      deploymentId: this.deploymentId,
      eventType: source,
      severity: source === "stderr" ? "error" : "info",
      message: trimmed,
      payload: {
        source
      }
    })
  }
}
