import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import type { ProviderId, SecurityDefaults, SettingsStorageLocations } from "./types"

const OPENWORK_DIR = join(homedir(), ".openwork")
const ENV_FILE = join(OPENWORK_DIR, ".env")
const SECURITY_DEFAULTS_FILE = join(OPENWORK_DIR, "security-defaults.json")

export const DEFAULT_SECURITY_DEFAULTS: SecurityDefaults = {
  requireExecApproval: true,
  requireNetworkApproval: true,
  denySocialPosting: true
}

// Environment variable names for each provider
const ENV_VAR_NAMES: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  ollama: "" // Ollama doesn't require an API key
}

export function getOpenworkDir(): string {
  if (!existsSync(OPENWORK_DIR)) {
    mkdirSync(OPENWORK_DIR, { recursive: true })
  }
  return OPENWORK_DIR
}

export function getDbPath(): string {
  return join(getOpenworkDir(), "openwork.sqlite")
}

export function getCheckpointDbPath(): string {
  return join(getOpenworkDir(), "langgraph.sqlite")
}

export function getThreadCheckpointDir(): string {
  const dir = join(getOpenworkDir(), "threads")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getThreadCheckpointPath(threadId: string): string {
  return join(getThreadCheckpointDir(), `${threadId}.sqlite`)
}

export function getZeroClawDir(): string {
  const dir = join(getOpenworkDir(), "zeroclaw")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getZeroClawRuntimeDir(): string {
  const dir = join(getZeroClawDir(), "runtime")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getZeroClawDeploymentsDir(): string {
  const dir = join(getZeroClawDir(), "deployments")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getZeroClawLogsDir(): string {
  const dir = join(getZeroClawDir(), "logs")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function deleteThreadCheckpoint(threadId: string): void {
  const path = getThreadCheckpointPath(threadId)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export function getEnvFilePath(): string {
  return ENV_FILE
}

function parseSecurityDefaultsInput(value: unknown): Partial<SecurityDefaults> {
  if (!value || typeof value !== "object") {
    return {}
  }

  const candidate = value as Record<string, unknown>
  return {
    requireExecApproval:
      typeof candidate.requireExecApproval === "boolean"
        ? candidate.requireExecApproval
        : undefined,
    requireNetworkApproval:
      typeof candidate.requireNetworkApproval === "boolean"
        ? candidate.requireNetworkApproval
        : undefined,
    denySocialPosting:
      typeof candidate.denySocialPosting === "boolean" ? candidate.denySocialPosting : undefined
  }
}

function mergeSecurityDefaults(overrides?: Partial<SecurityDefaults>): SecurityDefaults {
  return {
    requireExecApproval:
      overrides?.requireExecApproval ?? DEFAULT_SECURITY_DEFAULTS.requireExecApproval,
    requireNetworkApproval:
      overrides?.requireNetworkApproval ?? DEFAULT_SECURITY_DEFAULTS.requireNetworkApproval,
    denySocialPosting: overrides?.denySocialPosting ?? DEFAULT_SECURITY_DEFAULTS.denySocialPosting
  }
}

export function getSecurityDefaults(): SecurityDefaults {
  if (!existsSync(SECURITY_DEFAULTS_FILE)) {
    return DEFAULT_SECURITY_DEFAULTS
  }

  try {
    const raw = readFileSync(SECURITY_DEFAULTS_FILE, "utf-8")
    const parsed = JSON.parse(raw)
    return mergeSecurityDefaults(parseSecurityDefaultsInput(parsed))
  } catch {
    return DEFAULT_SECURITY_DEFAULTS
  }
}

export function setSecurityDefaults(updates: Partial<SecurityDefaults>): SecurityDefaults {
  const next = mergeSecurityDefaults({
    ...getSecurityDefaults(),
    ...updates
  })
  getOpenworkDir()
  writeFileSync(SECURITY_DEFAULTS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf-8")
  return next
}

export function getStorageLocations(): SettingsStorageLocations {
  return {
    openworkDir: getOpenworkDir(),
    dbPath: getDbPath(),
    checkpointDbPath: getCheckpointDbPath(),
    threadCheckpointDir: getThreadCheckpointDir(),
    envFilePath: getEnvFilePath(),
    zeroClawDir: getZeroClawDir(),
    zeroClawRuntimeDir: getZeroClawRuntimeDir(),
    zeroClawDeploymentsDir: getZeroClawDeploymentsDir(),
    zeroClawLogsDir: getZeroClawLogsDir()
  }
}

// Read .env file and parse into object
function parseEnvFile(): Record<string, string> {
  const envPath = getEnvFilePath()
  if (!existsSync(envPath)) return {}

  const content = readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      result[key] = value
    }
  }
  return result
}

// Write object back to .env file
function writeEnvFile(env: Record<string, string>): void {
  getOpenworkDir() // ensure dir exists
  const lines = Object.entries(env)
    .filter((entry) => entry[1])
    .map(([k, v]) => `${k}=${v}`)
  writeFileSync(getEnvFilePath(), lines.join("\n") + "\n")
}

// API key management
export function getApiKey(provider: string): string | undefined {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return undefined

  // Check .env file first
  const env = parseEnvFile()
  if (env[envVarName]) return env[envVarName]

  // Fall back to process environment
  return process.env[envVarName]
}

export function setApiKey(provider: string, apiKey: string): void {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return

  const env = parseEnvFile()
  env[envVarName] = apiKey
  writeEnvFile(env)

  // Also set in process.env for current session
  process.env[envVarName] = apiKey
}

export function deleteApiKey(provider: string): void {
  const envVarName = ENV_VAR_NAMES[provider]
  if (!envVarName) return

  const env = parseEnvFile()
  delete env[envVarName]
  writeEnvFile(env)

  // Also clear from process.env
  delete process.env[envVarName]
}

export function hasApiKey(provider: string): boolean {
  return !!getApiKey(provider)
}
