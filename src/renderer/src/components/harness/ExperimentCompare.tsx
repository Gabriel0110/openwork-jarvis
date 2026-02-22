import type { HarnessExperimentRun, HarnessExperimentSpec } from "@/types"

interface ExperimentCompareProps {
  specs: HarnessExperimentSpec[]
  experiments: HarnessExperimentRun[]
  onRunExperiment: (specKey: string) => Promise<void>
  onPromote: (experimentRunId: string) => Promise<void>
  isWorking?: boolean
}

export function ExperimentCompare({
  specs,
  experiments,
  onRunExperiment,
  onPromote,
  isWorking = false
}: ExperimentCompareProps): React.JSX.Element {
  const selectedExperiment = experiments[0]

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border bg-background/60 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Experiments</div>
      <div className="flex flex-wrap gap-2">
        {specs.map((spec) => (
          <button
            type="button"
            key={spec.key}
            className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted/30 disabled:opacity-40"
            disabled={isWorking}
            onClick={() => onRunExperiment(spec.key)}
          >
            Run {spec.name}
          </button>
        ))}
        {specs.length === 0 && (
          <span className="text-xs text-muted-foreground">No specs found.</span>
        )}
      </div>
      <div className="max-h-[220px] space-y-2 overflow-auto">
        {experiments.map((experiment) => (
          <div key={experiment.id} className="rounded-sm border border-border/50 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{experiment.specKey}</div>
                <div className="text-muted-foreground">
                  {experiment.status} . {experiment.variants.length} variant result(s)
                  {typeof experiment.report?.sampleSize === "number"
                    ? ` . n=${experiment.report.sampleSize}`
                    : ""}
                  {typeof experiment.report?.retryCount === "number"
                    ? ` . retries=${experiment.report.retryCount}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                className="rounded-sm border border-border px-2 py-1 text-[10px] hover:bg-muted/30 disabled:opacity-40"
                disabled={!experiment.promotionDecision.recommendPromotion || isWorking}
                onClick={() => onPromote(experiment.id)}
              >
                Promote
              </button>
            </div>
            <div className="mt-1 text-muted-foreground">
              Recommendation: {experiment.promotionDecision.recommendPromotion ? "promote" : "hold"}
            </div>
          </div>
        ))}
      </div>

      {selectedExperiment && (
        <div className="rounded-sm border border-border/50 p-2 text-xs">
          <div className="mb-1 font-medium">Latest Variant Diagnostics</div>
          <div className="mb-2 text-muted-foreground">{selectedExperiment.specKey}</div>
          <div className="max-h-[220px] overflow-auto rounded-sm border border-border/40">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/50 text-muted-foreground">
                  <th className="px-2 py-1 text-left">Variant</th>
                  <th className="px-2 py-1 text-left">n</th>
                  <th className="px-2 py-1 text-left">Retries</th>
                  <th className="px-2 py-1 text-left">Score Δ</th>
                  <th className="px-2 py-1 text-left">Safety Δ</th>
                  <th className="px-2 py-1 text-left">Latency Δ</th>
                </tr>
              </thead>
              <tbody>
                {selectedExperiment.variants.map((variant) => (
                  <tr
                    key={`${selectedExperiment.id}:${variant.variantKey}`}
                    className="border-b border-border/30"
                  >
                    <td className="px-2 py-1">
                      {variant.variantLabel}
                      {variant.isBaseline ? " (baseline)" : ""}
                    </td>
                    <td className="px-2 py-1">{variant.sampleCount ?? "-"}</td>
                    <td className="px-2 py-1">{variant.retriesUsed ?? "-"}</td>
                    <td className="px-2 py-1">{variant.scoreDelta.toFixed(2)}</td>
                    <td className="px-2 py-1">{variant.safetyDelta.toFixed(2)}</td>
                    <td className="px-2 py-1">{Math.round(variant.latencyDeltaMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
