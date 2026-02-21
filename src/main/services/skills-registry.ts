import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { listSkills, type LoaderSkillMetadata } from "deepagents"
import type {
  AgentSkillMode,
  SkillDefinition,
  SkillDetail,
  SkillListResult,
  SkillRegistryLocation,
  SkillSource
} from "../types"

const GLOBAL_SKILL_LOCATIONS: ReadonlyArray<{ source: SkillSource; path: string }> = [
  { source: "global_agents", path: join(homedir(), ".agents", "skills") },
  { source: "global_codex", path: join(homedir(), ".codex", "skills") }
]

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}

function parseAllowedTools(value: string | undefined): string[] {
  if (!value || typeof value !== "string") {
    return []
  }

  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function parseSkillsFromPath(path: string, source: SkillSource): SkillDefinition[] {
  if (!existsSync(path)) {
    return []
  }

  try {
    const parsed = listSkills({
      userSkillsDir: path
    })

    return parsed
      .map((entry) => mapSkillMetadata(entry, source))
      .filter((entry): entry is SkillDefinition => entry !== null)
  } catch (error) {
    console.warn(`[Skills] Failed loading skill registry path "${path}".`, error)
    return []
  }
}

function mapSkillMetadata(
  metadata: LoaderSkillMetadata,
  source: SkillSource
): SkillDefinition | null {
  const name = metadata.name?.trim()
  const description = metadata.description?.trim()
  const path = metadata.path?.trim()
  if (!name || !description || !path) {
    return null
  }

  return {
    id: `${source}:${normalizeSkillName(name)}`,
    name,
    description,
    path,
    source,
    license: metadata.license,
    compatibility: metadata.compatibility,
    metadata: metadata.metadata,
    allowedTools: parseAllowedTools(metadata.allowedTools)
  }
}

function resolveSkillLocations(): SkillRegistryLocation[] {
  return GLOBAL_SKILL_LOCATIONS.map((location) => ({
    source: location.source,
    path: location.path,
    exists: existsSync(location.path)
  }))
}

function getSourcePriority(source: SkillSource): number {
  if (source === "global_agents") {
    return 2
  }
  return 1
}

function collectMergedSkills(): SkillDefinition[] {
  const skillsByName = new Map<string, SkillDefinition>()

  for (const location of GLOBAL_SKILL_LOCATIONS) {
    const parsedSkills = parseSkillsFromPath(location.path, location.source)
    for (const skill of parsedSkills) {
      const normalizedName = normalizeSkillName(skill.name)
      const existing = skillsByName.get(normalizedName)
      if (!existing) {
        skillsByName.set(normalizedName, skill)
        continue
      }

      // Prefer ~/.agents/skills over ~/.codex/skills for duplicate names.
      if (getSourcePriority(skill.source) >= getSourcePriority(existing.source)) {
        skillsByName.set(normalizedName, skill)
      }
    }
  }

  return Array.from(skillsByName.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

export function normalizeAgentSkillMode(value: string | undefined): AgentSkillMode {
  if (value === "selected_only" || value === "global_plus_selected") {
    return value
  }
  return "global_only"
}

export function listGlobalSkills(): SkillListResult {
  return {
    skills: collectMergedSkills(),
    locations: resolveSkillLocations(),
    loadedAt: new Date().toISOString()
  }
}

export function getGlobalSkillDetail(skillId: string): SkillDetail | null {
  const skill = listGlobalSkills().skills.find((entry) => entry.id === skillId)
  if (!skill) {
    return null
  }

  try {
    const content = readFileSync(skill.path, "utf8")
    return {
      skill,
      content
    }
  } catch (error) {
    console.warn(`[Skills] Failed to read SKILL.md for "${skill.name}".`, error)
    return {
      skill,
      content: `Unable to read SKILL.md at ${skill.path}.`
    }
  }
}

export function getGlobalSkillByName(skillName: string): SkillDefinition | null {
  const normalizedName = normalizeSkillName(skillName)
  return (
    listGlobalSkills().skills.find((entry) => normalizeSkillName(entry.name) === normalizedName) ||
    null
  )
}

export function getGlobalSkillDetailByName(skillName: string): SkillDetail | null {
  const skill = getGlobalSkillByName(skillName)
  if (!skill) {
    return null
  }
  return getGlobalSkillDetail(skill.id)
}

export function resolveSkillsForAgent(
  skillMode: AgentSkillMode | undefined,
  skillsAllowlist: string[] | undefined
): SkillDefinition[] {
  const resolvedMode = normalizeAgentSkillMode(skillMode)
  const skillRegistry = listGlobalSkills().skills

  if (resolvedMode === "global_only") {
    return skillRegistry
  }

  const allowlist = new Set((skillsAllowlist || []).map((item) => normalizeSkillName(item)))
  if (allowlist.size === 0) {
    return resolvedMode === "selected_only" ? [] : skillRegistry
  }

  const selected = skillRegistry.filter((skill) => allowlist.has(normalizeSkillName(skill.name)))
  if (resolvedMode === "selected_only") {
    return selected
  }

  // global_plus_selected currently behaves as global + explicit selection (union),
  // which is equivalent to the global set because selected skills are global today.
  return skillRegistry
}

export function getSkillNameList(skills: SkillDefinition[]): string[] {
  return skills.map((skill) => skill.name)
}
