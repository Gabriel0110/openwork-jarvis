import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import type { HarnessProfileSpec, HarnessSuiteSpec, HarnessTaskTier } from "../types"
import type { LoadedHarnessBenchmarks } from "./types"

const DEFAULT_PROFILE: HarnessProfileSpec = {
  key: "default-baseline",
  name: "Default Baseline",
  description: "Balanced scoring profile for coding, research, and automation suites.",
  weights: {
    correctness: 0.35,
    completeness: 0.25,
    safetyCompliance: 0.2,
    efficiency: 0.1,
    toolHygiene: 0.1
  },
  budgets: {
    maxDurationMs: 8 * 60 * 1000,
    maxToolCalls: 80,
    maxTokens: 20000
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string")
}

function resolveBenchmarksRoot(explicitRoot?: string): string {
  if (explicitRoot && existsSync(explicitRoot)) {
    return explicitRoot
  }

  const candidates = [
    resolve(process.cwd(), "harness", "benchmarks"),
    resolve(__dirname, "../../../harness/benchmarks"),
    resolve(__dirname, "../../../../harness/benchmarks")
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error("Harness benchmarks directory not found.")
}

function parseSuite(raw: unknown, sourceFile: string): HarnessSuiteSpec {
  const obj = asRecord(raw)
  const key = asString(obj.key, basename(sourceFile).replace(/\.(yaml|yml)$/i, ""))
  const name = asString(obj.name, key)
  const tasksRaw = Array.isArray(obj.tasks) ? obj.tasks : []

  if (tasksRaw.length === 0) {
    throw new Error(`Suite "${sourceFile}" has no tasks.`)
  }

  const tasks = tasksRaw.map((taskRaw, index) => {
    const taskObj = asRecord(taskRaw)
    const taskKey = asString(taskObj.key, `${key}-task-${index + 1}`)
    const taskName = asString(taskObj.name, taskKey)
    const tierRaw = asString(taskObj.tier, "medium")
    const tier: HarnessTaskTier = tierRaw === "easy" || tierRaw === "hard" ? tierRaw : "medium"
    const expectedArtifacts = Array.isArray(taskObj.expectedArtifacts)
      ? taskObj.expectedArtifacts.reduce<
          Array<{ path: string; required?: boolean; mustContain?: string[] }>
        >((acc, artifactRaw) => {
          const artifactObj = asRecord(artifactRaw)
          const path = asString(artifactObj.path)
          if (!path) {
            return acc
          }
          acc.push({
            path,
            required: artifactObj.required !== false,
            mustContain: asStringArray(artifactObj.mustContain)
          })
          return acc
        }, [])
      : []

    return {
      key: taskKey,
      name: taskName,
      description: asOptionalString(taskObj.description),
      tier,
      prompt: asString(taskObj.prompt, ""),
      fixturePath: asOptionalString(taskObj.fixturePath),
      expectedArtifacts,
      tags: asStringArray(taskObj.tags),
      maxDurationMs: asNumber(taskObj.maxDurationMs, DEFAULT_PROFILE.budgets.maxDurationMs),
      maxToolCalls: asNumber(taskObj.maxToolCalls, DEFAULT_PROFILE.budgets.maxToolCalls),
      maxTokens: asNumber(taskObj.maxTokens, DEFAULT_PROFILE.budgets.maxTokens)
    }
  })

  return {
    key,
    name,
    description: asOptionalString(obj.description),
    tags: asStringArray(obj.tags),
    tasks
  }
}

export function loadHarnessBenchmarks(explicitRoot?: string): LoadedHarnessBenchmarks {
  const root = resolveBenchmarksRoot(explicitRoot)
  const files = readdirSync(root).filter((file) => /\.(yaml|yml)$/i.test(file))

  if (files.length === 0) {
    throw new Error(`No benchmark suite files found in ${root}`)
  }

  const suites: HarnessSuiteSpec[] = []
  const profilesByKey = new Map<string, HarnessProfileSpec>([
    [DEFAULT_PROFILE.key, DEFAULT_PROFILE]
  ])

  for (const file of files) {
    const fullPath = resolve(root, file)
    const raw = readFileSync(fullPath, "utf-8")
    const parsed = parseYaml(raw) as unknown
    const record = asRecord(parsed)

    suites.push(parseSuite(record, file))

    const profileEntries = Array.isArray(record.profiles) ? record.profiles : []
    for (const entry of profileEntries) {
      const profileObj = asRecord(entry)
      const key = asString(profileObj.key).trim()
      if (!key) {
        continue
      }
      profilesByKey.set(key, {
        key,
        name: asString(profileObj.name, key),
        description: asOptionalString(profileObj.description),
        modelId: asOptionalString(profileObj.modelId),
        weights: {
          correctness: asNumber(profileObj.correctnessWeight, DEFAULT_PROFILE.weights.correctness),
          completeness: asNumber(
            profileObj.completenessWeight,
            DEFAULT_PROFILE.weights.completeness
          ),
          safetyCompliance: asNumber(
            profileObj.safetyComplianceWeight,
            DEFAULT_PROFILE.weights.safetyCompliance
          ),
          efficiency: asNumber(profileObj.efficiencyWeight, DEFAULT_PROFILE.weights.efficiency),
          toolHygiene: asNumber(profileObj.toolHygieneWeight, DEFAULT_PROFILE.weights.toolHygiene)
        },
        budgets: {
          maxDurationMs: asNumber(profileObj.maxDurationMs, DEFAULT_PROFILE.budgets.maxDurationMs),
          maxToolCalls: asNumber(profileObj.maxToolCalls, DEFAULT_PROFILE.budgets.maxToolCalls),
          maxTokens: asNumber(profileObj.maxTokens, DEFAULT_PROFILE.budgets.maxTokens)
        }
      })
    }
  }

  return {
    suites,
    profiles: Array.from(profilesByKey.values()),
    loadedAt: new Date().toISOString()
  }
}

export function listHarnessSuites(): HarnessSuiteSpec[] {
  return loadHarnessBenchmarks().suites
}

export function getHarnessSuite(suiteKey: string): HarnessSuiteSpec {
  const suite = loadHarnessBenchmarks().suites.find((candidate) => candidate.key === suiteKey)
  if (!suite) {
    throw new Error(`Harness suite "${suiteKey}" not found.`)
  }
  return suite
}

export function resolveHarnessProfile(profileKey?: string): HarnessProfileSpec {
  const { profiles } = loadHarnessBenchmarks()
  if (!profileKey) {
    return profiles[0] || DEFAULT_PROFILE
  }
  const found = profiles.find((profile) => profile.key === profileKey)
  if (!found) {
    throw new Error(`Harness profile "${profileKey}" not found.`)
  }
  return found
}
