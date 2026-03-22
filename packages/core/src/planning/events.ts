import type {
  DecisionTraceField,
  DecisionTraceStage,
  DecisionTraceStep,
  PlanningEvent,
  PlanningEventKind,
  PlanningEventStatus
} from "@bsc-swap-agent-demo/shared"

export function createPlanningEvent(input: {
  sessionId?: string
  stage: DecisionTraceStage
  kind: PlanningEventKind
  status: PlanningEventStatus
  message: string
  data?: PlanningEvent["data"]
}): PlanningEvent {
  return {
    id: `${input.stage}-${input.kind}-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    sessionId: input.sessionId,
    stage: input.stage,
    kind: input.kind,
    status: input.status,
    message: input.message,
    data: input.data
  }
}

export function finalizeDecisionTrace(events: PlanningEvent[]): DecisionTraceStep[] {
  const stageOrder: DecisionTraceStage[] = [
    "intent-parsing",
    "missing-field-resolution",
    "execution-family-selection",
    "liquidity-discovery",
    "route-comparison",
    "payload-construction",
    "price-impact-assessment",
    "mev-risk-assessment",
    "submission-strategy",
    "execution-package-construction",
    "execution-package-comparison",
    "path-quality-assessment",
    "guardrail-application",
    "final-recommendation"
  ]

  const grouped = new Map<DecisionTraceStage, PlanningEvent[]>()
  for (const event of events) {
    const existing = grouped.get(event.stage) ?? []
    existing.push(event)
    grouped.set(event.stage, existing)
  }

  const steps: Array<DecisionTraceStep | null> = stageOrder.map((stage) => {
      const stageEvents = grouped.get(stage)
      if (!stageEvents?.length) {
        return null
      }

      const stageStarted = stageEvents.find((event) => event.kind === "stage-started")
      const llmReasoning = [...stageEvents].reverse().find(
        (event) => event.kind === "reasoning" && event.data?.reasoningSource === "llm"
      )
      const lastReasoning =
        llmReasoning ??
        [...stageEvents].reverse().find((event) => event.kind === "reasoning")
      const completed = [...stageEvents].reverse().find(
        (event) => event.kind === "stage-completed" || event.kind === "follow-up-required"
      )
      const failed = [...stageEvents].reverse().find((event) => event.kind === "stage-failed")
      const terminal = failed ?? completed ?? lastReasoning ?? stageEvents[stageEvents.length - 1]

      const observations: DecisionTraceField[] = []
      const artifacts: DecisionTraceField[] = []

      for (const event of stageEvents) {
        if (event.kind === "tool-succeeded" || event.kind === "tool-failed") {
          const preview = event.data?.outputPreview ?? []
          const toolName = event.data?.toolName
          for (const field of preview) {
            observations.push({
              label: toolName ? `${toolName}.${field.label}` : field.label,
              value: field.value
            })
          }
        }
        if (event.kind === "reasoning") {
          observations.push(...(event.data?.observations ?? []))
          artifacts.push(...(event.data?.artifacts ?? []))
        }
      }

      return {
        id: `${stage}-${grouped.size}`,
        stage,
        title: stageStarted?.data?.title ?? titleFromStage(stage),
        status: terminal.status === "failed" ? "failed" : terminal.status === "needs-input" ? "needs-input" : "completed",
        summary: lastReasoning?.message ?? terminal.message,
        inputs: stageStarted?.data?.inputPreview ?? [],
        observations: dedupeFields(observations),
        decision: lastReasoning?.data?.decision ?? terminal.data?.decision,
        artifacts: dedupeFields(artifacts)
      } satisfies DecisionTraceStep
    })

  return steps.filter((step): step is DecisionTraceStep => step !== null)
}

function dedupeFields(fields: DecisionTraceField[]): DecisionTraceField[] {
  const seen = new Set<string>()
  const result: DecisionTraceField[] = []
  for (const field of fields) {
    const key = `${field.label}:${field.value}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(field)
  }
  return result
}

function titleFromStage(stage: DecisionTraceStage): string {
  return stage
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
