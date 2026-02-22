import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import {
  addHarnessExperimentVariant,
  createHarnessGateReport,
  createHarnessExperimentRun,
  getHarnessExperimentRun,
  listHarnessExperimentRuns,
  updateHarnessExperimentRun
} from "../db/harness-experiments"
import { getHarnessRun, listHarnessTaskResults } from "../db/harness-runs"
import type {
  HarnessExperimentRun,
  HarnessExperimentSpec,
  HarnessRun,
  HarnessRunStartParams,
  HarnessVariantResult
} from "../types"
import { startHarnessRun } from "./benchmark-runner"
import { evaluatePromotionPolicy } from "./promotion-policy"

const TERMINAL_RUN_STATUSES: HarnessRun["status"][] = ["completed", "failed", "cancelled"]

interface RunOperationalMetrics {
  toolCalls: number
  costUsd: number
}

interface SampleExecutionRecord {
  run: HarnessRun
  metrics: RunOperationalMetrics
  attemptsUsed: number
  sampleIndex: number
}

interface VariantAggregateContext {
  averageScore: number
  averageDurationMs: number
  averageCostUsd: number
  averageToolCalls: number
  averageSafety: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function resolveExperimentRoot(explicitRoot?: string): string {
  if (explicitRoot && existsSync(explicitRoot)) {
    return explicitRoot
  }
  const candidates = [
    resolve(process.cwd(), "harness", "experiments"),
    resolve(__dirname, "../../../harness/experiments"),
    resolve(__dirname, "../../../../harness/experiments")
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error("Harness experiments directory not found.")
}

function normalizeExperimentSpec(raw: unknown, sourceName?: string): HarnessExperimentSpec {
  const record = asRecord(raw)
  const key = asString(record.key, sourceName || "inline-experiment")
  const variants = Array.isArray(record.variants) ? record.variants : []
  if (variants.length === 0) {
    throw new Error(`Harness experiment "${key}" must define at least one variant.`)
  }

  return {
    key,
    name: asString(record.name, key),
    description: asString(record.description, ""),
    suiteKey: asString(record.suiteKey),
    profileKey: asString(record.profileKey, ""),
    sampleSize: Math.max(1, asNumber(record.sampleSize, 1)),
    retryCount: Math.max(0, asNumber(record.retryCount, 0)),
    gating: {
      minPrimaryDelta: asNumber(record.minPrimaryDelta, 1),
      maxSafetyRegression: asNumber(record.maxSafetyRegression, 1),
      maxCatastrophicDrop: asNumber(record.maxCatastrophicDrop, 8)
    },
    variants: variants.map((variantRaw, index) => {
      const variant = asRecord(variantRaw)
      return {
        key: asString(variant.key, `variant-${index + 1}`),
        label: asString(variant.label, `Variant ${index + 1}`),
        promptPatch: asString(variant.promptPatch, ""),
        middleware: asRecord(variant.middleware),
        budget: {
          maxDurationMs: asNumber(variant.maxDurationMs, 0) || undefined,
          maxToolCalls: asNumber(variant.maxToolCalls, 0) || undefined,
          maxTokens: asNumber(variant.maxTokens, 0) || undefined
        },
        modelId: asString(variant.modelId, "")
      }
    })
  }
}

function resolveGateStage(): "observe" | "soft_gate" | "hard_gate" {
  const raw = String(process.env.HARNESS_GATE_MODE || "observe").toLowerCase()
  if (raw === "hard" || raw === "hard_gate") {
    return "hard_gate"
  }
  if (raw === "soft" || raw === "soft_gate") {
    return "soft_gate"
  }
  return "observe"
}

function summarizeRunOperationalMetrics(runId: string): RunOperationalMetrics {
  const taskResults = listHarnessTaskResults(runId)
  return {
    toolCalls: taskResults.reduce((sum, task) => sum + (task.toolCalls || 0), 0),
    costUsd: Number(taskResults.reduce((sum, task) => sum + (task.costUsd || 0), 0).toFixed(6))
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function toRunSafetyScore(run: HarnessRun): number {
  return run.summary.stopReasons["policy_denied"]
    ? 50
    : Math.max(0, 100 - run.summary.failedCount * 8)
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function toInt32Hash(input: string): number {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0
  }
  return hash
}

function buildSampleSeed(
  specKey: string,
  variantKey: string,
  sampleIndex: number,
  attemptIndex: number
): number {
  const hash = toInt32Hash(`${specKey}:${variantKey}:${sampleIndex}:${attemptIndex}`)
  return Math.max(1, Math.abs(hash) % 2147483647)
}

function runNeedsRetry(status: HarnessRun["status"]): boolean {
  return status === "failed" || status === "cancelled"
}

function resolveVariantSummary(samples: SampleExecutionRecord[]): Record<string, unknown> {
  const statusCounts = samples.reduce<Record<string, number>>((acc, sample) => {
    acc[sample.run.status] = (acc[sample.run.status] || 0) + 1
    return acc
  }, {})
  const stopReasons = samples.reduce<Record<string, number>>((acc, sample) => {
    for (const [reason, count] of Object.entries(sample.run.summary.stopReasons || {})) {
      acc[reason] = (acc[reason] || 0) + Number(count || 0)
    }
    return acc
  }, {})
  return {
    statusCounts,
    stopReasons
  }
}

function toVariantResultFromSamples(params: {
  variantKey: string
  variantLabel: string
  isBaseline: boolean
  samples: SampleExecutionRecord[]
  baseline: VariantAggregateContext
}): HarnessVariantResult {
  const averageScore = average(params.samples.map((sample) => sample.run.summary.averageScore))
  const averageDurationMs = average(params.samples.map((sample) => sample.run.durationMs || 0))
  const averageCostUsd = average(params.samples.map((sample) => sample.metrics.costUsd))
  const averageToolCalls = average(params.samples.map((sample) => sample.metrics.toolCalls))
  const averageSafety = average(params.samples.map((sample) => toRunSafetyScore(sample.run)))
  const totalRetriesUsed = params.samples.reduce(
    (sum, sample) => sum + Math.max(0, sample.attemptsUsed - 1),
    0
  )
  const failedRunCount = params.samples.filter((sample) => sample.run.status !== "completed").length

  return {
    variantKey: params.variantKey,
    variantLabel: params.variantLabel,
    isBaseline: params.isBaseline,
    runId: params.samples[0]?.run.id,
    runIds: params.samples.map((sample) => sample.run.id),
    sampleCount: params.samples.length,
    retriesUsed: totalRetriesUsed,
    failedRunCount,
    averageScore: round(averageScore),
    scoreDelta: round(averageScore - params.baseline.averageScore),
    latencyDeltaMs: round(averageDurationMs - params.baseline.averageDurationMs),
    costDeltaUsd: round(averageCostUsd - params.baseline.averageCostUsd, 6),
    toolCallDelta: round(averageToolCalls - params.baseline.averageToolCalls, 2),
    safetyDelta: round(averageSafety - params.baseline.averageSafety, 3),
    summary: {
      ...resolveVariantSummary(params.samples),
      meanDurationMs: round(averageDurationMs, 2),
      meanCostUsd: round(averageCostUsd, 6),
      meanToolCalls: round(averageToolCalls, 2),
      meanSafetyScore: round(averageSafety, 2)
    }
  }
}

async function waitForRunCompletion(runId: string): Promise<HarnessRun> {
  while (true) {
    const run = getHarnessRun(runId)
    if (!run) {
      throw new Error(`Harness run "${runId}" disappeared during experiment execution.`)
    }
    if (TERMINAL_RUN_STATUSES.includes(run.status)) {
      return run
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))
  }
}

async function executeSampleWithRetries(params: {
  specKey: string
  variantKey: string
  sampleIndex: number
  retryCount: number
  buildRunParams: (seed: number) => HarnessRunStartParams
}): Promise<SampleExecutionRecord> {
  let attemptIndex = 0
  let lastSettled: HarnessRun | null = null

  while (attemptIndex <= params.retryCount) {
    const seed = buildSampleSeed(
      params.specKey,
      params.variantKey,
      params.sampleIndex,
      attemptIndex
    )
    const started = await startHarnessRun(params.buildRunParams(seed))
    const settled = await waitForRunCompletion(started.id)
    lastSettled = settled
    if (!runNeedsRetry(settled.status)) {
      break
    }
    attemptIndex += 1
  }

  if (!lastSettled) {
    throw new Error("Harness experiment sample execution did not produce a run.")
  }

  return {
    run: lastSettled,
    metrics: summarizeRunOperationalMetrics(lastSettled.id),
    attemptsUsed: attemptIndex + 1,
    sampleIndex: params.sampleIndex
  }
}

async function executeVariantSamples(params: {
  spec: HarnessExperimentSpec
  variantKey: string
  sampleSize: number
  retryCount: number
  buildRunParams: (seed: number) => HarnessRunStartParams
}): Promise<SampleExecutionRecord[]> {
  const samples: SampleExecutionRecord[] = []
  for (let sampleIndex = 0; sampleIndex < params.sampleSize; sampleIndex += 1) {
    const sample = await executeSampleWithRetries({
      specKey: params.spec.key,
      variantKey: params.variantKey,
      sampleIndex,
      retryCount: params.retryCount,
      buildRunParams: params.buildRunParams
    })
    samples.push(sample)
  }
  return samples
}

function toBaselineContext(samples: SampleExecutionRecord[]): VariantAggregateContext {
  return {
    averageScore: average(samples.map((sample) => sample.run.summary.averageScore)),
    averageDurationMs: average(samples.map((sample) => sample.run.durationMs || 0)),
    averageCostUsd: average(samples.map((sample) => sample.metrics.costUsd)),
    averageToolCalls: average(samples.map((sample) => sample.metrics.toolCalls)),
    averageSafety: average(samples.map((sample) => toRunSafetyScore(sample.run)))
  }
}

async function executeExperimentRun(
  experimentRunId: string,
  spec: HarnessExperimentSpec
): Promise<void> {
  const sampleSize = Math.max(1, spec.sampleSize || 1)
  const retryCount = Math.max(0, spec.retryCount || 0)
  const baselineSamples = await executeVariantSamples({
    spec,
    variantKey: "baseline",
    sampleSize,
    retryCount,
    buildRunParams: (seed) => ({
      suiteKey: spec.suiteKey,
      profileKey: spec.profileKey || undefined,
      seed
    })
  })

  const baselineContext = toBaselineContext(baselineSamples)
  const baselineVariant = toVariantResultFromSamples({
    variantKey: "baseline",
    variantLabel: "Baseline",
    isBaseline: true,
    samples: baselineSamples,
    baseline: baselineContext
  })
  addHarnessExperimentVariant({
    experimentRunId,
    variantKey: baselineVariant.variantKey,
    variantLabel: baselineVariant.variantLabel,
    isBaseline: true,
    result: baselineVariant
  })

  const candidateResults: HarnessVariantResult[] = []
  for (const variant of spec.variants) {
    const variantSamples = await executeVariantSamples({
      spec,
      variantKey: variant.key,
      sampleSize,
      retryCount,
      buildRunParams: (seed) => ({
        suiteKey: spec.suiteKey,
        profileKey: spec.profileKey || undefined,
        modelId: variant.modelId || undefined,
        seed,
        variantConfig: {
          variantKey: variant.key,
          variantLabel: variant.label,
          promptPatch: variant.promptPatch,
          middleware: variant.middleware,
          budget: variant.budget
        }
      })
    })

    const result = toVariantResultFromSamples({
      variantKey: variant.key,
      variantLabel: variant.label,
      isBaseline: false,
      samples: variantSamples,
      baseline: baselineContext
    })

    addHarnessExperimentVariant({
      experimentRunId,
      variantKey: variant.key,
      variantLabel: variant.label,
      isBaseline: false,
      config: {
        promptPatch: variant.promptPatch,
        middleware: variant.middleware,
        budget: variant.budget,
        modelId: variant.modelId
      },
      result
    })
    candidateResults.push(result)
  }

  const { bestVariant, decision } = evaluatePromotionPolicy({
    baseline: baselineVariant,
    candidates: candidateResults,
    minPrimaryDelta: spec.gating.minPrimaryDelta,
    maxSafetyRegression: spec.gating.maxSafetyRegression,
    maxCatastrophicDrop: spec.gating.maxCatastrophicDrop
  })

  updateHarnessExperimentRun(experimentRunId, {
    status: "completed",
    completedAt: Date.now(),
    report: {
      suiteKey: spec.suiteKey,
      profileKey: spec.profileKey || "default-baseline",
      sampleSize,
      retryCount,
      baselineRunIds: baselineVariant.runIds || [],
      variantCount: candidateResults.length,
      recommendedVariantKey: bestVariant?.variantKey || null,
      scoreDeltas: candidateResults.map((result) => ({
        variant: result.variantLabel,
        delta: result.scoreDelta
      })),
      variantDiagnostics: [baselineVariant, ...candidateResults].map((result) => ({
        variantKey: result.variantKey,
        variantLabel: result.variantLabel,
        sampleCount: result.sampleCount || 0,
        retriesUsed: result.retriesUsed || 0,
        failedRunCount: result.failedRunCount || 0,
        scoreDelta: result.scoreDelta,
        safetyDelta: result.safetyDelta,
        latencyDeltaMs: result.latencyDeltaMs,
        costDeltaUsd: result.costDeltaUsd,
        toolCallDelta: result.toolCallDelta
      }))
    },
    promotionDecision: decision
  })

  createHarnessGateReport({
    targetRef: `experiment:${experimentRunId}`,
    stage: resolveGateStage(),
    status: decision.recommendPromotion ? "pass" : decision.primaryDelta >= 0 ? "warn" : "fail",
    summary: {
      specKey: spec.key,
      suiteKey: spec.suiteKey,
      recommendedVariant: bestVariant?.variantKey || null,
      primaryDelta: decision.primaryDelta,
      reasons: decision.reasons
    }
  })
}

export function listHarnessExperimentSpecs(): HarnessExperimentSpec[] {
  const root = resolveExperimentRoot()
  const files = readdirSync(root).filter((file) => /\.(yaml|yml)$/i.test(file))
  return files.map((file) => {
    const content = readFileSync(resolve(root, file), "utf-8")
    return normalizeExperimentSpec(
      parseYaml(content) as unknown,
      basename(file).replace(/\.(yaml|yml)$/i, "")
    )
  })
}

export function resolveExperimentSpec(
  specIdOrInlineSpec: string | HarnessExperimentSpec
): HarnessExperimentSpec {
  if (typeof specIdOrInlineSpec !== "string") {
    return normalizeExperimentSpec(specIdOrInlineSpec, specIdOrInlineSpec.key)
  }
  const allSpecs = listHarnessExperimentSpecs()
  const found = allSpecs.find((spec) => spec.key === specIdOrInlineSpec)
  if (!found) {
    throw new Error(`Harness experiment spec "${specIdOrInlineSpec}" not found.`)
  }
  return found
}

export async function runHarnessExperiment(
  specIdOrInlineSpec: string | HarnessExperimentSpec
): Promise<HarnessExperimentRun> {
  const spec = resolveExperimentSpec(specIdOrInlineSpec)
  const experimentRun = createHarnessExperimentRun({
    specKey: spec.key,
    baselineSuiteKey: spec.suiteKey,
    status: "running"
  })
  updateHarnessExperimentRun(experimentRun.id, {
    status: "running",
    startedAt: Date.now(),
    report: {
      sampleSize: spec.sampleSize,
      retryCount: spec.retryCount
    }
  })

  try {
    await executeExperimentRun(experimentRun.id, spec)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateHarnessExperimentRun(experimentRun.id, {
      status: "failed",
      completedAt: Date.now(),
      notes: message
    })
    createHarnessGateReport({
      targetRef: `experiment:${experimentRun.id}`,
      stage: resolveGateStage(),
      status: "fail",
      summary: {
        specKey: spec.key,
        suiteKey: spec.suiteKey,
        reason: message
      }
    })
  }

  return getHarnessExperimentRun(experimentRun.id) as HarnessExperimentRun
}

export function listHarnessExperimentRunRecords(filters?: {
  status?: HarnessExperimentRun["status"]
  limit?: number
}): HarnessExperimentRun[] {
  return listHarnessExperimentRuns(filters)
}
