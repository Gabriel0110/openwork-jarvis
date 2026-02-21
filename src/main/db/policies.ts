import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  PolicyAction,
  PolicyDecision,
  PolicyResourceType,
  PolicyRule,
  PolicyScope,
  PolicyUpsertParams
} from "../types"

interface PolicyRow {
  policy_id: string
  agent_id: string
  resource_type: PolicyResourceType
  resource_key: string
  action: PolicyAction
  scope: PolicyScope
  decision: PolicyDecision
  constraints: string | null
  created_at: number
  updated_at: number
}

function parseConstraints(value: string | null): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === "object" && parsed ? parsed : {}
  } catch {
    return {}
  }
}

function mapRowToPolicy(row: PolicyRow): PolicyRule {
  return {
    id: row.policy_id,
    agentId: row.agent_id,
    resourceType: row.resource_type,
    resourceKey: row.resource_key,
    action: row.action,
    scope: row.scope,
    decision: row.decision,
    constraints: parseConstraints(row.constraints),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

export function listPoliciesByAgent(agentId: string): PolicyRule[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM agent_policies WHERE agent_id = ? ORDER BY updated_at DESC"
  )
  stmt.bind([agentId])

  const policies: PolicyRule[] = []
  while (stmt.step()) {
    policies.push(mapRowToPolicy(stmt.getAsObject() as unknown as PolicyRow))
  }
  stmt.free()
  return policies
}

export function getPolicy(policyId: string): PolicyRule | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM agent_policies WHERE policy_id = ?")
  stmt.bind([policyId])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as unknown as PolicyRow
  stmt.free()
  return mapRowToPolicy(row)
}

export function upsertPolicy(params: PolicyUpsertParams): PolicyRule {
  const database = getDb()
  const now = Date.now()
  const policyId = params.policyId || uuid()
  const constraints = JSON.stringify(params.constraints || {})

  if (params.policyId && getPolicy(params.policyId)) {
    database.run(
      `UPDATE agent_policies
       SET resource_type = ?, resource_key = ?, action = ?, scope = ?, decision = ?,
           constraints = ?, updated_at = ?
       WHERE policy_id = ?`,
      [
        params.resourceType,
        params.resourceKey,
        params.action,
        params.scope,
        params.decision,
        constraints,
        now,
        policyId
      ]
    )
  } else {
    database.run(
      `INSERT INTO agent_policies (
        policy_id, agent_id, resource_type, resource_key, action, scope, decision,
        constraints, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        policyId,
        params.agentId,
        params.resourceType,
        params.resourceKey,
        params.action,
        params.scope,
        params.decision,
        constraints,
        now,
        now
      ]
    )
  }

  scheduleDatabaseSave()

  return getPolicy(policyId) as PolicyRule
}

export function deletePolicy(policyId: string): void {
  const database = getDb()
  database.run("DELETE FROM agent_policies WHERE policy_id = ?", [policyId])
  scheduleDatabaseSave()
}
