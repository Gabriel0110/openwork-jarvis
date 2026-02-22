#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { resolve, basename } from "node:path"
import { parse as parseYaml } from "yaml"

const args = process.argv.slice(2)
const command = args[0] || "run"
const root = process.cwd()
const benchmarksDir = resolve(root, "harness", "benchmarks")
const runDir = resolve(root, "harness", ".runs")

function parseSuites() {
  if (!existsSync(benchmarksDir)) {
    throw new Error(`Missing benchmarks directory: ${benchmarksDir}`)
  }
  const files = readdirSync(benchmarksDir).filter((f) => /\.ya?ml$/i.test(f))
  return files.map((file) => {
    const raw = readFileSync(resolve(benchmarksDir, file), "utf-8")
    const doc = parseYaml(raw)
    return {
      key: doc.key || basename(file).replace(/\.ya?ml$/i, ""),
      name: doc.name || file,
      tasks: Array.isArray(doc.tasks) ? doc.tasks : []
    }
  })
}

function evaluateTask(task) {
  const artifacts = Array.isArray(task.expectedArtifacts) ? task.expectedArtifacts : []
  if (artifacts.length === 0) {
    return { score: 70, missing: [] }
  }
  const missing = []
  let passed = 0
  for (const artifact of artifacts) {
    const artifactPath = resolve(root, artifact.path || "")
    const mustContain = Array.isArray(artifact.mustContain) ? artifact.mustContain : []
    if (!existsSync(artifactPath)) {
      if (artifact.required !== false) {
        missing.push(artifact.path)
      } else {
        passed += 1
      }
      continue
    }
    if (mustContain.length === 0) {
      passed += 1
      continue
    }
    const content = readFileSync(artifactPath, "utf-8")
    const missingToken = mustContain.find((token) => !content.includes(token))
    if (missingToken) {
      missing.push(`${artifact.path}::${missingToken}`)
    } else {
      passed += 1
    }
  }
  return {
    score: Math.max(0, Math.min(100, (passed / artifacts.length) * 100)),
    missing
  }
}

function runSuite(suite) {
  const taskResults = suite.tasks.map((task) => {
    const evaluated = evaluateTask(task)
    return {
      taskKey: task.key,
      taskName: task.name,
      tier: task.tier || "medium",
      score: Number(evaluated.score.toFixed(2)),
      status: evaluated.score >= 70 ? "passed" : "failed",
      missing: evaluated.missing
    }
  })

  const avg =
    taskResults.length === 0
      ? 0
      : taskResults.reduce((sum, result) => sum + result.score, 0) / taskResults.length

  const output = {
    suiteKey: suite.key,
    suiteName: suite.name,
    executedAt: new Date().toISOString(),
    summary: {
      taskCount: taskResults.length,
      passedCount: taskResults.filter((task) => task.status === "passed").length,
      failedCount: taskResults.filter((task) => task.status === "failed").length,
      averageScore: Number(avg.toFixed(2))
    },
    tasks: taskResults
  }

  if (!existsSync(runDir)) {
    mkdirSync(runDir, { recursive: true })
  }
  const outputPath = resolve(runDir, `${suite.key}-${Date.now()}.json`)
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8")
  return { output, outputPath }
}

function runRetention(retentionDays) {
  if (!existsSync(runDir)) {
    return { removed: 0, scanned: 0 }
  }
  const safeRetentionDays = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30
  const cutoffMs = Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000
  const reports = readdirSync(runDir).filter((file) => file.endsWith(".json"))
  let removed = 0
  for (const file of reports) {
    const path = resolve(runDir, file)
    const payload = JSON.parse(readFileSync(path, "utf-8"))
    const executedAtRaw = payload.executedAt || payload.generatedAt
    const executedAt = typeof executedAtRaw === "string" ? Date.parse(executedAtRaw) : NaN
    if (Number.isFinite(executedAt) && executedAt < cutoffMs) {
      removed += 1
      unlinkSync(path)
    }
  }
  return { removed, scanned: reports.length, retentionDays: safeRetentionDays }
}

function main() {
  const suites = parseSuites()

  if (command === "run") {
    const all = suites.map((suite) => runSuite(suite))
    console.log(
      JSON.stringify(
        all.map((entry) => ({
          suite: entry.output.suiteKey,
          ...entry.output.summary,
          outputPath: entry.outputPath
        })),
        null,
        2
      )
    )
    return
  }

  if (command === "run-suite") {
    const suiteKey = args.find((arg) => arg.startsWith("--suite="))?.split("=")[1]
    if (!suiteKey) {
      throw new Error("Usage: node scripts/harness-cli.mjs run-suite --suite=<suiteKey>")
    }
    const suite = suites.find((candidate) => candidate.key === suiteKey)
    if (!suite) {
      throw new Error(`Unknown suite: ${suiteKey}`)
    }
    const result = runSuite(suite)
    console.log(
      JSON.stringify({ ...result.output.summary, outputPath: result.outputPath }, null, 2)
    )
    return
  }

  if (command === "score-recompute") {
    if (!existsSync(runDir)) {
      console.log("No run artifacts found.")
      return
    }
    const reports = readdirSync(runDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const payload = JSON.parse(readFileSync(resolve(runDir, file), "utf-8"))
        return {
          file,
          suiteKey: payload.suiteKey,
          averageScore: payload.summary?.averageScore || 0,
          taskCount: payload.summary?.taskCount || 0
        }
      })
    console.log(JSON.stringify(reports, null, 2))
    return
  }

  if (command === "retention") {
    const daysArg = args.find((arg) => arg.startsWith("--days="))?.split("=")[1]
    const days = daysArg ? Number(daysArg) : 30
    const result = runRetention(days)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
