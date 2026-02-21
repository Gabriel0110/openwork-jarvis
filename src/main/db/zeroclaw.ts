import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import { DEFAULT_WORKSPACE_ID } from "./workspaces"
import type {
  ProviderId,
  ZeroClawCapabilityPolicy,
  ZeroClawDeploymentState,
  ZeroClawDeploymentStatus,
  ZeroClawDesiredState,
  ZeroClawEffectiveCapabilitySet,
  ZeroClawEventSeverity,
  ZeroClawRuntimeEvent,
  ZeroClawVersionRecord
} from "../types"

interface ZeroClawInstallationRow {
  version: string
  source: "managed" | "external"
  install_path: string
  binary_path: string
  checksum_sha256: string | null
  status: string
  last_error: string | null
  is_active: number
  installed_at: number
  updated_at: number
}

interface ZeroClawDeploymentRow {
  deployment_id: string
  workspace_id: string
  name: string
  description: string | null
  runtime_version: string
  workspace_path: string
  model_provider: ProviderId
  model_name: string
  gateway_host: string
  gateway_port: number
  api_base_url: string
  status: ZeroClawDeploymentStatus
  desired_state: ZeroClawDesiredState
  env_json: string
  config_json: string
  policy_json: string
  effective_capabilities_json: string
  process_pid: number | null
  process_started_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

export interface ZeroClawDeploymentRuntimeData {
  env: Record<string, string>
  config: Record<string, unknown>
}

interface ZeroClawRuntimeEventRow {
  event_id: string
  deployment_id: string
  event_type: string
  severity: ZeroClawEventSeverity
  message: string
  payload: string
  correlation_id: string | null
  occurred_at: number
  created_at: number
}

interface ZeroClawPolicyBindingRow {
  binding_id: string
  deployment_id: string
  mode: ZeroClawCapabilityPolicy["mode"]
  include_global_skills: number
  assigned_skill_ids: string
  assigned_tool_names: string
  assigned_connector_keys: string
  denied_tool_names: string
  denied_connector_keys: string
  created_at: number
  updated_at: number
}

export interface UpsertZeroClawInstallationInput {
  version: string
  source: "managed" | "external"
  installPath: string
  binaryPath: string
  checksumSha256?: string
  status?: "installed" | "error"
  lastError?: string
  isActive?: boolean
}

export interface CreateZeroClawDeploymentInput {
  workspaceId?: string
  name: string
  description?: string
  runtimeVersion: string
  workspacePath: string
  modelProvider: ProviderId
  modelName: string
  gatewayHost: string
  gatewayPort: number
  apiBaseUrl: string
  desiredState: ZeroClawDesiredState
  status: ZeroClawDeploymentStatus
  env: Record<string, string>
  config: Record<string, unknown>
  policy: ZeroClawCapabilityPolicy
  effectiveCapabilities: ZeroClawEffectiveCapabilitySet
}

export interface UpdateZeroClawDeploymentInput {
  name?: string
  description?: string
  runtimeVersion?: string
  workspacePath?: string
  modelProvider?: ProviderId
  modelName?: string
  gatewayHost?: string
  gatewayPort?: number
  apiBaseUrl?: string
  desiredState?: ZeroClawDesiredState
  status?: ZeroClawDeploymentStatus
  env?: Record<string, string>
  config?: Record<string, unknown>
  policy?: ZeroClawCapabilityPolicy
  effectiveCapabilities?: ZeroClawEffectiveCapabilitySet
  processId?: number | null
  processStartedAt?: number | null
  lastError?: string | null
}

export interface CreateZeroClawRuntimeEventInput {
  deploymentId: string
  eventType: string
  severity: ZeroClawEventSeverity
  message: string
  payload?: Record<string, unknown>
  correlationId?: string
  occurredAt?: number
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // no-op
  }
  return {}
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string")
    }
  } catch {
    // no-op
  }
  return []
}

function defaultPolicy(): ZeroClawCapabilityPolicy {
  return {
    mode: "global_only",
    includeGlobalSkills: true,
    assignedSkillIds: [],
    assignedToolNames: [],
    assignedConnectorKeys: [],
    deniedToolNames: [],
    deniedConnectorKeys: []
  }
}

function defaultEffectiveCapabilities(
  policyMode: ZeroClawCapabilityPolicy["mode"]
): ZeroClawEffectiveCapabilitySet {
  return {
    mode: policyMode,
    skills: [],
    tools: [],
    connectors: [],
    gates: {
      read: true,
      write: false,
      exec: false,
      network: false,
      channel: false
    }
  }
}

function mapInstallationRow(row: ZeroClawInstallationRow): ZeroClawVersionRecord {
  return {
    version: row.version,
    source: row.source,
    installPath: row.install_path,
    binaryPath: row.binary_path,
    checksumSha256: row.checksum_sha256 || undefined,
    installedAt: new Date(row.installed_at),
    isActive: row.is_active === 1
  }
}

function parsePolicy(value: string): ZeroClawCapabilityPolicy {
  const parsed = parseJsonObject(value)
  return {
    mode:
      parsed.mode === "global_plus_assigned" ||
      parsed.mode === "assigned_only" ||
      parsed.mode === "deny_all_except_assigned"
        ? parsed.mode
        : "global_only",
    includeGlobalSkills: parsed.includeGlobalSkills !== false,
    assignedSkillIds: Array.isArray(parsed.assignedSkillIds)
      ? parsed.assignedSkillIds.filter((item): item is string => typeof item === "string")
      : [],
    assignedToolNames: Array.isArray(parsed.assignedToolNames)
      ? parsed.assignedToolNames.filter((item): item is string => typeof item === "string")
      : [],
    assignedConnectorKeys: Array.isArray(parsed.assignedConnectorKeys)
      ? parsed.assignedConnectorKeys.filter((item): item is string => typeof item === "string")
      : [],
    deniedToolNames: Array.isArray(parsed.deniedToolNames)
      ? parsed.deniedToolNames.filter((item): item is string => typeof item === "string")
      : [],
    deniedConnectorKeys: Array.isArray(parsed.deniedConnectorKeys)
      ? parsed.deniedConnectorKeys.filter((item): item is string => typeof item === "string")
      : []
  }
}

function parseEffectiveCapabilities(
  value: string,
  policyMode: ZeroClawCapabilityPolicy["mode"]
): ZeroClawEffectiveCapabilitySet {
  const parsed = parseJsonObject(value)
  const base = defaultEffectiveCapabilities(policyMode)

  const skills = Array.isArray(parsed.skills) ? parsed.skills : []
  const tools = Array.isArray(parsed.tools) ? parsed.tools : []
  const connectors = Array.isArray(parsed.connectors) ? parsed.connectors : []
  const gatesValue =
    typeof parsed.gates === "object" && parsed.gates && !Array.isArray(parsed.gates)
      ? (parsed.gates as Record<string, unknown>)
      : {}

  return {
    mode:
      parsed.mode === "global_plus_assigned" ||
      parsed.mode === "assigned_only" ||
      parsed.mode === "deny_all_except_assigned"
        ? parsed.mode
        : policyMode,
    skills: skills.filter((item): item is ZeroClawEffectiveCapabilitySet["skills"][number] => {
      return typeof item === "object" && item !== null
    }),
    tools: tools.filter((item): item is ZeroClawEffectiveCapabilitySet["tools"][number] => {
      return typeof item === "object" && item !== null
    }),
    connectors: connectors.filter(
      (item): item is ZeroClawEffectiveCapabilitySet["connectors"][number] => {
        return typeof item === "object" && item !== null
      }
    ),
    gates: {
      read: gatesValue.read === undefined ? base.gates.read : Boolean(gatesValue.read),
      write: gatesValue.write === undefined ? base.gates.write : Boolean(gatesValue.write),
      exec: gatesValue.exec === undefined ? base.gates.exec : Boolean(gatesValue.exec),
      network: gatesValue.network === undefined ? base.gates.network : Boolean(gatesValue.network),
      channel: gatesValue.channel === undefined ? base.gates.channel : Boolean(gatesValue.channel)
    }
  }
}

function mapDeploymentRow(row: ZeroClawDeploymentRow): ZeroClawDeploymentState {
  const policy = parsePolicy(row.policy_json)
  return {
    id: row.deployment_id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description || undefined,
    runtimeVersion: row.runtime_version,
    workspacePath: row.workspace_path,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    status: row.status,
    desiredState: row.desired_state,
    processId: row.process_pid ?? undefined,
    gatewayHost: row.gateway_host,
    gatewayPort: Number(row.gateway_port),
    apiBaseUrl: row.api_base_url,
    lastError: row.last_error || undefined,
    policy,
    effectiveCapabilities: parseEffectiveCapabilities(row.effective_capabilities_json, policy.mode),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function getZeroClawDeploymentRow(deploymentId: string): ZeroClawDeploymentRow | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM zeroclaw_deployments WHERE deployment_id = ?")
  stmt.bind([deploymentId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as ZeroClawDeploymentRow
  stmt.free()
  return row
}

function mapRuntimeEventRow(row: ZeroClawRuntimeEventRow): ZeroClawRuntimeEvent {
  return {
    id: row.event_id,
    deploymentId: row.deployment_id,
    eventType: row.event_type,
    severity: row.severity,
    message: row.message,
    payload: parseJsonObject(row.payload),
    correlationId: row.correlation_id || undefined,
    occurredAt: new Date(row.occurred_at),
    createdAt: new Date(row.created_at)
  }
}

function mapPolicyBindingRow(row: ZeroClawPolicyBindingRow): ZeroClawCapabilityPolicy {
  return {
    mode: row.mode,
    includeGlobalSkills: row.include_global_skills === 1,
    assignedSkillIds: parseStringArray(row.assigned_skill_ids),
    assignedToolNames: parseStringArray(row.assigned_tool_names),
    assignedConnectorKeys: parseStringArray(row.assigned_connector_keys),
    deniedToolNames: parseStringArray(row.denied_tool_names),
    deniedConnectorKeys: parseStringArray(row.denied_connector_keys)
  }
}

export function listZeroClawInstallations(): ZeroClawVersionRecord[] {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM zeroclaw_installations ORDER BY installed_at DESC")
  const rows: ZeroClawVersionRecord[] = []
  while (stmt.step()) {
    rows.push(mapInstallationRow(stmt.getAsObject() as unknown as ZeroClawInstallationRow))
  }
  stmt.free()
  return rows
}

export function getActiveZeroClawInstallation(): ZeroClawVersionRecord | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM zeroclaw_installations WHERE is_active = 1 ORDER BY installed_at DESC LIMIT 1"
  )
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const result = mapInstallationRow(stmt.getAsObject() as unknown as ZeroClawInstallationRow)
  stmt.free()
  return result
}

export function getZeroClawInstallation(version: string): ZeroClawVersionRecord | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM zeroclaw_installations WHERE version = ?")
  stmt.bind([version])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const result = mapInstallationRow(stmt.getAsObject() as unknown as ZeroClawInstallationRow)
  stmt.free()
  return result
}

export function upsertZeroClawInstallation(
  input: UpsertZeroClawInstallationInput
): ZeroClawVersionRecord {
  const database = getDb()
  const now = Date.now()
  const existing = getZeroClawInstallation(input.version)

  if (input.isActive) {
    database.run("UPDATE zeroclaw_installations SET is_active = 0, updated_at = ?", [now])
  }

  if (existing) {
    database.run(
      `UPDATE zeroclaw_installations
       SET source = ?, install_path = ?, binary_path = ?, checksum_sha256 = ?, status = ?,
           last_error = ?, is_active = ?, updated_at = ?
       WHERE version = ?`,
      [
        input.source,
        input.installPath,
        input.binaryPath,
        input.checksumSha256 || null,
        input.status || "installed",
        input.lastError || null,
        input.isActive ? 1 : existing.isActive ? 1 : 0,
        now,
        input.version
      ]
    )
  } else {
    database.run(
      `INSERT INTO zeroclaw_installations (
        version, source, install_path, binary_path, checksum_sha256, status, last_error, is_active,
        installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.version,
        input.source,
        input.installPath,
        input.binaryPath,
        input.checksumSha256 || null,
        input.status || "installed",
        input.lastError || null,
        input.isActive ? 1 : 0,
        now,
        now
      ]
    )
  }

  scheduleDatabaseSave()
  return getZeroClawInstallation(input.version) as ZeroClawVersionRecord
}

export function setActiveZeroClawInstallation(version: string): void {
  const database = getDb()
  const now = Date.now()
  database.run("UPDATE zeroclaw_installations SET is_active = 0, updated_at = ?", [now])
  database.run(
    "UPDATE zeroclaw_installations SET is_active = 1, updated_at = ? WHERE version = ?",
    [now, version]
  )
  scheduleDatabaseSave()
}

export function listZeroClawDeployments(
  workspaceId = DEFAULT_WORKSPACE_ID
): ZeroClawDeploymentState[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM zeroclaw_deployments WHERE workspace_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([workspaceId])
  const rows: ZeroClawDeploymentState[] = []
  while (stmt.step()) {
    rows.push(mapDeploymentRow(stmt.getAsObject() as unknown as ZeroClawDeploymentRow))
  }
  stmt.free()
  return rows
}

export function getZeroClawDeployment(deploymentId: string): ZeroClawDeploymentState | null {
  const row = getZeroClawDeploymentRow(deploymentId)
  if (!row) {
    return null
  }
  return mapDeploymentRow(row)
}

export function getZeroClawDeploymentRuntimeData(
  deploymentId: string
): ZeroClawDeploymentRuntimeData | null {
  const row = getZeroClawDeploymentRow(deploymentId)
  if (!row) {
    return null
  }

  const envRaw = parseJsonObject(row.env_json)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(envRaw)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  return {
    env,
    config: parseJsonObject(row.config_json)
  }
}

export function createZeroClawDeployment(
  input: CreateZeroClawDeploymentInput
): ZeroClawDeploymentState {
  const database = getDb()
  const now = Date.now()
  const deploymentId = uuid()

  database.run(
    `INSERT INTO zeroclaw_deployments (
      deployment_id, workspace_id, name, description, runtime_version, workspace_path, model_provider,
      model_name, gateway_host, gateway_port, api_base_url, status, desired_state, env_json, config_json,
      policy_json, effective_capabilities_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deploymentId,
      input.workspaceId || DEFAULT_WORKSPACE_ID,
      input.name.trim(),
      input.description?.trim() || null,
      input.runtimeVersion,
      input.workspacePath,
      input.modelProvider,
      input.modelName,
      input.gatewayHost,
      input.gatewayPort,
      input.apiBaseUrl,
      input.status,
      input.desiredState,
      JSON.stringify(input.env || {}),
      JSON.stringify(input.config || {}),
      JSON.stringify(input.policy || defaultPolicy()),
      JSON.stringify(input.effectiveCapabilities || defaultEffectiveCapabilities("global_only")),
      now,
      now
    ]
  )

  upsertZeroClawPolicyBinding(deploymentId, input.policy)
  scheduleDatabaseSave()
  return getZeroClawDeployment(deploymentId) as ZeroClawDeploymentState
}

export function updateZeroClawDeployment(
  deploymentId: string,
  updates: UpdateZeroClawDeploymentInput
): ZeroClawDeploymentState | null {
  const existingRow = getZeroClawDeploymentRow(deploymentId)
  if (!existingRow) {
    return null
  }
  const existing = mapDeploymentRow(existingRow)

  const database = getDb()
  const now = Date.now()
  const nextPolicy = updates.policy || existing.policy
  const nextEffectiveCapabilities = updates.effectiveCapabilities || existing.effectiveCapabilities

  database.run(
    `UPDATE zeroclaw_deployments
     SET name = ?, description = ?, runtime_version = ?, workspace_path = ?, model_provider = ?,
         model_name = ?, gateway_host = ?, gateway_port = ?, api_base_url = ?, status = ?,
         desired_state = ?, env_json = ?, config_json = ?, policy_json = ?, effective_capabilities_json = ?,
         process_pid = ?, process_started_at = ?, last_error = ?, updated_at = ?
     WHERE deployment_id = ?`,
    [
      updates.name?.trim() || existing.name,
      updates.description === undefined
        ? existing.description || null
        : updates.description || null,
      updates.runtimeVersion || existing.runtimeVersion,
      updates.workspacePath || existing.workspacePath,
      updates.modelProvider || existing.modelProvider,
      updates.modelName || existing.modelName,
      updates.gatewayHost || existing.gatewayHost,
      updates.gatewayPort ?? existing.gatewayPort,
      updates.apiBaseUrl || existing.apiBaseUrl,
      updates.status || existing.status,
      updates.desiredState || existing.desiredState,
      JSON.stringify(updates.env || parseJsonObject(existingRow.env_json)),
      JSON.stringify(updates.config || parseJsonObject(existingRow.config_json)),
      JSON.stringify(nextPolicy),
      JSON.stringify(nextEffectiveCapabilities),
      updates.processId === undefined ? existing.processId || null : updates.processId,
      updates.processStartedAt === undefined
        ? existingRow.process_started_at
        : updates.processStartedAt,
      updates.lastError === undefined ? existing.lastError || null : updates.lastError,
      now,
      deploymentId
    ]
  )

  if (updates.policy) {
    upsertZeroClawPolicyBinding(deploymentId, updates.policy)
  }

  scheduleDatabaseSave()
  return getZeroClawDeployment(deploymentId)
}

export function deleteZeroClawDeployment(deploymentId: string): void {
  const database = getDb()
  database.run("DELETE FROM zeroclaw_deployments WHERE deployment_id = ?", [deploymentId])
  scheduleDatabaseSave()
}

export function listZeroClawRuntimeEvents(
  deploymentId: string,
  options?: { cursor?: string; limit?: number }
): { events: ZeroClawRuntimeEvent[]; nextCursor?: string } {
  const database = getDb()
  const limit = Math.max(1, Math.min(500, options?.limit || 100))
  const cursorTs = options?.cursor ? Number(options.cursor) : null

  const query =
    cursorTs && Number.isFinite(cursorTs)
      ? "SELECT * FROM zeroclaw_runtime_events WHERE deployment_id = ? AND occurred_at < ? ORDER BY occurred_at DESC LIMIT ?"
      : "SELECT * FROM zeroclaw_runtime_events WHERE deployment_id = ? ORDER BY occurred_at DESC LIMIT ?"

  const stmt = database.prepare(query)
  if (cursorTs && Number.isFinite(cursorTs)) {
    stmt.bind([deploymentId, cursorTs, limit])
  } else {
    stmt.bind([deploymentId, limit])
  }

  const events: ZeroClawRuntimeEvent[] = []
  while (stmt.step()) {
    events.push(mapRuntimeEventRow(stmt.getAsObject() as unknown as ZeroClawRuntimeEventRow))
  }
  stmt.free()

  const nextCursor =
    events.length > 0 ? String(events[events.length - 1].occurredAt.getTime()) : undefined

  return {
    events,
    nextCursor
  }
}

export function createZeroClawRuntimeEvent(
  input: CreateZeroClawRuntimeEventInput
): ZeroClawRuntimeEvent {
  const database = getDb()
  const now = Date.now()
  const eventId = uuid()
  const occurredAt = input.occurredAt || now
  database.run(
    `INSERT INTO zeroclaw_runtime_events (
      event_id, deployment_id, event_type, severity, message, payload, correlation_id, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      input.deploymentId,
      input.eventType,
      input.severity,
      input.message,
      JSON.stringify(input.payload || {}),
      input.correlationId || null,
      occurredAt,
      now
    ]
  )

  scheduleDatabaseSave()
  const stmt = database.prepare("SELECT * FROM zeroclaw_runtime_events WHERE event_id = ?")
  stmt.bind([eventId])
  if (!stmt.step()) {
    stmt.free()
    throw new Error("Failed to insert ZeroClaw runtime event.")
  }
  const result = mapRuntimeEventRow(stmt.getAsObject() as unknown as ZeroClawRuntimeEventRow)
  stmt.free()
  return result
}

export function getZeroClawPolicyBinding(deploymentId: string): ZeroClawCapabilityPolicy | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM zeroclaw_policy_bindings WHERE deployment_id = ? LIMIT 1"
  )
  stmt.bind([deploymentId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const policy = mapPolicyBindingRow(stmt.getAsObject() as unknown as ZeroClawPolicyBindingRow)
  stmt.free()
  return policy
}

export function upsertZeroClawPolicyBinding(
  deploymentId: string,
  policy: ZeroClawCapabilityPolicy
): ZeroClawCapabilityPolicy {
  const database = getDb()
  const now = Date.now()
  const existing = getZeroClawPolicyBinding(deploymentId)

  const normalized: ZeroClawCapabilityPolicy = {
    mode: policy.mode || "global_only",
    includeGlobalSkills: policy.includeGlobalSkills !== false,
    assignedSkillIds: Array.from(new Set(policy.assignedSkillIds || [])),
    assignedToolNames: Array.from(new Set(policy.assignedToolNames || [])),
    assignedConnectorKeys: Array.from(new Set(policy.assignedConnectorKeys || [])),
    deniedToolNames: Array.from(new Set(policy.deniedToolNames || [])),
    deniedConnectorKeys: Array.from(new Set(policy.deniedConnectorKeys || []))
  }

  if (existing) {
    database.run(
      `UPDATE zeroclaw_policy_bindings
       SET mode = ?, include_global_skills = ?, assigned_skill_ids = ?, assigned_tool_names = ?,
           assigned_connector_keys = ?, denied_tool_names = ?, denied_connector_keys = ?, updated_at = ?
       WHERE deployment_id = ?`,
      [
        normalized.mode,
        normalized.includeGlobalSkills ? 1 : 0,
        JSON.stringify(normalized.assignedSkillIds),
        JSON.stringify(normalized.assignedToolNames),
        JSON.stringify(normalized.assignedConnectorKeys),
        JSON.stringify(normalized.deniedToolNames),
        JSON.stringify(normalized.deniedConnectorKeys),
        now,
        deploymentId
      ]
    )
  } else {
    database.run(
      `INSERT INTO zeroclaw_policy_bindings (
        binding_id, deployment_id, mode, include_global_skills, assigned_skill_ids, assigned_tool_names,
        assigned_connector_keys, denied_tool_names, denied_connector_keys, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        deploymentId,
        normalized.mode,
        normalized.includeGlobalSkills ? 1 : 0,
        JSON.stringify(normalized.assignedSkillIds),
        JSON.stringify(normalized.assignedToolNames),
        JSON.stringify(normalized.assignedConnectorKeys),
        JSON.stringify(normalized.deniedToolNames),
        JSON.stringify(normalized.deniedConnectorKeys),
        now,
        now
      ]
    )
  }

  scheduleDatabaseSave()
  return normalized
}

export function resolveZeroClawPolicyForDeployment(deploymentId: string): ZeroClawCapabilityPolicy {
  return getZeroClawPolicyBinding(deploymentId) || defaultPolicy()
}
