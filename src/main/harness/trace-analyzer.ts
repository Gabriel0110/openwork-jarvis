import {
  createHarnessFinding,
  createHarnessHypothesis,
  listHarnessFindings
} from "../db/harness-findings"
import { getHarnessRun, listHarnessTaskResults } from "../db/harness-runs"
import type { HarnessFinding, HarnessFindingSeverity, HarnessHypothesis } from "../types"
import { buildHarnessFingerprint } from "./trace-types"

interface AnalysisCandidate {
  runId: string
  taskKey: string
  taskName: string
  score: number
  notes?: string
  stopReason?: string
}

function severityFromScore(score: number): HarnessFindingSeverity {
  if (score < 25) {
    return "critical"
  }
  if (score < 45) {
    return "high"
  }
  if (score < 65) {
    return "medium"
  }
  return "low"
}

function inferCategory(candidate: AnalysisCandidate): HarnessFinding["category"] {
  const notes = (candidate.notes || "").toLowerCase()
  const stopReason = (candidate.stopReason || "").toLowerCase()

  if (stopReason.includes("loop")) {
    return "loop_or_stall"
  }
  if (stopReason.includes("policy")) {
    return "policy_friction"
  }
  if (stopReason.includes("budget")) {
    return "budget_misallocation"
  }
  if (notes.includes("verify") || notes.includes("test")) {
    return "missing_verification"
  }
  if (notes.includes("tool")) {
    return "tool_misuse"
  }
  if (notes.includes("artifact") || notes.includes("missing")) {
    return "output_contract_failure"
  }
  return "spec_non_compliance"
}

function buildHypotheses(category: HarnessFinding["category"]): Array<{
  title: string
  summary: string
  interventionType: string
  interventionPayload: Record<string, unknown>
  confidence: number
}> {
  if (category === "missing_verification") {
    return [
      {
        title: "Force verification checklist before completion",
        summary:
          "Inject pre-completion verification requirements and require explicit evidence in final response.",
        interventionType: "middleware_pre_completion",
        interventionPayload: { checklist: ["tests", "artifact_validation", "todo_resolution"] },
        confidence: 0.83
      }
    ]
  }

  if (category === "loop_or_stall") {
    return [
      {
        title: "Tighten loop detection threshold",
        summary:
          "Repeated tool-call sequence indicates low progress loop. Reduce max repeat pattern budget and force stop reason escalation.",
        interventionType: "middleware_loop_detection",
        interventionPayload: { maxRepeatedPattern: 3, escalation: "stop" },
        confidence: 0.8
      }
    ]
  }

  if (category === "policy_friction") {
    return [
      {
        title: "Review likely policy false positives",
        summary:
          "Policy denies were likely over-constraining for this task class. Queue policy simulation for candidate allowlist changes.",
        interventionType: "policy_simulation",
        interventionPayload: { queueReview: true, focus: "tool/filesystem scope" },
        confidence: 0.72
      }
    ]
  }

  if (category === "budget_misallocation") {
    return [
      {
        title: "Increase targeted budget while preserving safeguards",
        summary:
          "Task appears under-budgeted for complexity; increase tool-call and token ceilings for matching tier.",
        interventionType: "budget_profile_patch",
        interventionPayload: { taskTier: "hard", maxToolCallsDelta: 20, maxTokensDelta: 4000 },
        confidence: 0.69
      }
    ]
  }

  return [
    {
      title: "Prompt contract reinforcement",
      summary:
        "Strengthen task output contract and acceptance criteria in system/user prompt wrapper for this suite.",
      interventionType: "prompt_patch",
      interventionPayload: { includeOutputChecklist: true, includeArtifactContract: true },
      confidence: 0.66
    }
  ]
}

function partitionCandidates(
  candidates: AnalysisCandidate[],
  batchSize: number
): AnalysisCandidate[][] {
  const batches: AnalysisCandidate[][] = []
  for (let index = 0; index < candidates.length; index += batchSize) {
    batches.push(candidates.slice(index, index + batchSize))
  }
  return batches
}

async function analyzeBatch(batch: AnalysisCandidate[]): Promise<
  Array<{
    candidate: AnalysisCandidate
    category: HarnessFinding["category"]
    severity: HarnessFindingSeverity
    hypotheses: ReturnType<typeof buildHypotheses>
  }>
> {
  return batch.map((candidate) => {
    const category = inferCategory(candidate)
    const severity = severityFromScore(candidate.score)
    return {
      candidate,
      category,
      severity,
      hypotheses: buildHypotheses(category)
    }
  })
}

export async function analyzeHarnessRun(runId: string): Promise<{
  findings: HarnessFinding[]
  hypotheses: HarnessHypothesis[]
}> {
  const run = getHarnessRun(runId)
  if (!run) {
    throw new Error(`Harness run "${runId}" not found.`)
  }

  const taskResults = listHarnessTaskResults(runId)
  const failedCandidates: AnalysisCandidate[] = taskResults
    .filter((taskResult) => taskResult.status === "failed" || taskResult.scoreTotal < 70)
    .map((taskResult) => ({
      runId,
      taskKey: taskResult.taskKey,
      taskName: taskResult.taskName,
      score: taskResult.scoreTotal,
      notes: taskResult.notes,
      stopReason: taskResult.stopReason
    }))

  const batches = partitionCandidates(failedCandidates, 4)
  const analyses = await Promise.all(batches.map((batch) => analyzeBatch(batch)))

  const createdFindings: HarnessFinding[] = []
  const createdHypotheses: HarnessHypothesis[] = []

  for (const batchResult of analyses) {
    for (const item of batchResult) {
      const fingerprint = buildHarnessFingerprint([
        run.suiteKey,
        item.category,
        item.candidate.taskKey,
        item.candidate.stopReason
      ])

      const finding = createHarnessFinding({
        runId,
        taskKey: item.candidate.taskKey,
        fingerprint,
        category: item.category,
        severity: item.severity,
        title: `${item.category.replace(/_/g, " ")} on ${item.candidate.taskName}`,
        summary: `Task "${item.candidate.taskName}" scored ${item.candidate.score.toFixed(
          1
        )}. Candidate root cause: ${item.category}.`,
        evidence: [
          {
            nodeId: `task:${item.candidate.taskKey}`,
            description: `Score ${item.candidate.score.toFixed(1)} with stop reason "${item.candidate.stopReason || "none"}".`
          }
        ],
        confidence: Math.max(0.45, Math.min(0.95, 1 - item.candidate.score / 120)),
        intervention: {
          suggestedHypotheses: item.hypotheses.map((hypothesis) => hypothesis.title)
        }
      })
      createdFindings.push(finding)

      let rank = 1
      for (const hypothesis of item.hypotheses) {
        const created = createHarnessHypothesis({
          findingId: finding.id,
          runId,
          title: hypothesis.title,
          summary: hypothesis.summary,
          interventionType: hypothesis.interventionType,
          interventionPayload: hypothesis.interventionPayload,
          confidence: hypothesis.confidence,
          rank
        })
        createdHypotheses.push(created)
        rank += 1
      }
    }
  }

  return {
    findings: listHarnessFindings({ runId, limit: 1000 }),
    hypotheses: createdHypotheses
  }
}
