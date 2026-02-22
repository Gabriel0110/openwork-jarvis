#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const mode = String(process.env.HARNESS_GATE_MODE || "observe").toLowerCase()
const runDir = resolve(process.cwd(), "harness", ".runs")
const SOFT_MIN_SCORE = Number(process.env.HARNESS_GATE_MIN_SCORE_SOFT || "55")
const SOFT_MAX_FAILED = Number(process.env.HARNESS_GATE_MAX_FAILED_SOFT || "8")
const HARD_MIN_SCORE = Number(process.env.HARNESS_GATE_MIN_SCORE_HARD || "65")
const HARD_MAX_FAILED = Number(process.env.HARNESS_GATE_MAX_FAILED_HARD || "4")

if (!existsSync(runDir)) {
  console.log("[harness-gate] No harness run directory found. Skipping gate.")
  process.exit(0)
}

const files = readdirSync(runDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({
    file,
    path: resolve(runDir, file)
  }))
  .sort((left, right) => right.file.localeCompare(left.file))

if (files.length === 0) {
  console.log("[harness-gate] No harness run artifacts found. Skipping gate.")
  process.exit(0)
}

const runs = files.map((entry) => JSON.parse(readFileSync(entry.path, "utf-8")))
const score =
  runs.reduce((sum, run) => sum + Number(run?.summary?.averageScore || 0), 0) /
  Math.max(1, runs.length)
const failedCount = runs.reduce((sum, run) => sum + Number(run?.summary?.failedCount || 0), 0)

const normalizedMode = mode === "soft_gate" ? "soft" : mode === "hard_gate" ? "hard" : mode
let status = "pass"
let reason = "Observe mode, no enforcement."

if (normalizedMode === "soft") {
  if (score < SOFT_MIN_SCORE || failedCount > SOFT_MAX_FAILED) {
    status = "fail"
    reason = `Soft gate failed. score=${score.toFixed(2)} threshold=${SOFT_MIN_SCORE}, failed=${failedCount} threshold=${SOFT_MAX_FAILED}.`
  } else {
    reason = "Soft gate passed."
  }
} else if (normalizedMode === "hard") {
  if (score < HARD_MIN_SCORE || failedCount > HARD_MAX_FAILED) {
    status = "fail"
    reason = `Hard gate failed. score=${score.toFixed(2)} threshold=${HARD_MIN_SCORE}, failed=${failedCount} threshold=${HARD_MAX_FAILED}.`
  } else {
    reason = "Hard gate passed."
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: normalizedMode,
  score: Number(score.toFixed(3)),
  failedCount,
  evaluatedRuns: runs.length,
  thresholds: {
    soft: { minScore: SOFT_MIN_SCORE, maxFailed: SOFT_MAX_FAILED },
    hard: { minScore: HARD_MIN_SCORE, maxFailed: HARD_MAX_FAILED }
  },
  status,
  reason
}
writeFileSync(resolve(runDir, "gate-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8")

console.log(
  `[harness-gate] mode=${normalizedMode} score=${score.toFixed(2)} failedCount=${failedCount} evaluatedRuns=${runs.length} status=${status}`
)

if (normalizedMode === "observe") {
  process.exit(0)
}

if (normalizedMode === "soft") {
  if (status === "fail") {
    console.error(`[harness-gate] ${reason}`)
    process.exit(1)
  }
  process.exit(0)
}

if (normalizedMode === "hard") {
  if (status === "fail") {
    console.error(`[harness-gate] ${reason}`)
    process.exit(1)
  }
  process.exit(0)
}

console.log("[harness-gate] Unknown mode; defaulting to observe semantics.")
process.exit(0)
