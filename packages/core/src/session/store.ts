import type {
  MissingFieldResolution,
  PlanningEvent,
  PlanningResult,
  PlanningSessionSnapshot,
  SkillContext,
  StructuredIntent,
  UnknownField
} from "@bsc-swap-agent-demo/shared"

import type { CapabilityRegistry } from "../capabilities/types"
import { finalizeDecisionTrace } from "../planning/events"
import { continuePlan, runPlanningStream } from "../planning/engine"
import type { StageSummarizer } from "../planning/stage-summarizer"

const sessions = new Map<string, PlanningSessionSnapshot>()

export async function startPlanningSession(input: {
  message: string
  walletAddress?: string
  network: SkillContext["network"]
  registry: CapabilityRegistry
  intentExtractor?: (rawInput: string) => Promise<StructuredIntent>
  stageSummarizer?: StageSummarizer
}): Promise<PlanningSessionSnapshot> {
  const sessionId = crypto.randomUUID()
  for await (const _event of streamPlanningSession({
    sessionId,
    message: input.message,
    walletAddress: input.walletAddress,
    network: input.network,
      registry: input.registry,
      intentExtractor: input.intentExtractor,
      stageSummarizer: input.stageSummarizer
    })) {
    // Consume the stream to persist the snapshot in the session store.
  }

  const snapshot = sessions.get(sessionId)
  if (!snapshot) {
    throw new Error(`Failed to persist planning session ${sessionId}.`)
  }
  return snapshot
}

export async function continuePlanningSession(input: {
  sessionId: string
  answer: string
  registry: CapabilityRegistry
  stageSummarizer?: StageSummarizer
}): Promise<PlanningSessionSnapshot> {
  for await (const _event of streamPlanningContinuation({
    sessionId: input.sessionId,
    answer: input.answer,
    registry: input.registry,
    stageSummarizer: input.stageSummarizer
  })) {
    // Consume the stream to persist the snapshot in the session store.
  }

  const snapshot = sessions.get(input.sessionId)
  if (!snapshot) {
    throw new Error(`Failed to persist planning session ${input.sessionId}.`)
  }
  return snapshot
}

export function streamPlanningSession(input: {
  sessionId: string
  message: string
  walletAddress?: string
  network: SkillContext["network"]
  registry: CapabilityRegistry
  intentExtractor?: (rawInput: string) => Promise<StructuredIntent>
  stageSummarizer?: StageSummarizer
}): AsyncGenerator<PlanningEvent> {
  const context: SkillContext = {
    network: input.network,
    walletAddress: input.walletAddress,
    submitEnabled: false
  }

  return streamAndPersist({
    sessionId: input.sessionId,
    rawMessage: input.message,
    context,
    registry: input.registry,
    stream: runPlanningStream({
      message: input.message,
      context,
      registry: input.registry,
      intentExtractor: input.intentExtractor,
      stageSummarizer: input.stageSummarizer,
      sessionId: input.sessionId
    })
  })
}

export function streamPlanningContinuation(input: {
  sessionId: string
  answer: string
  registry: CapabilityRegistry
  stageSummarizer?: StageSummarizer
}): AsyncGenerator<PlanningEvent> {
  const existing = sessions.get(input.sessionId)
  if (!existing) {
    throw new Error(`Unknown planning session ${input.sessionId}`)
  }
  const nextState = continuePlan(existing.state, input.answer)
  return streamAndPersist({
    sessionId: input.sessionId,
    rawMessage: existing.rawMessage,
    context: existing.context,
    registry: input.registry,
    stream: runPlanningStream({
      message: nextState.rawInput,
      context: existing.context,
      registry: input.registry,
      state: nextState,
      stageSummarizer: input.stageSummarizer,
      sessionId: input.sessionId
    })
  })
}

export function getPlanningState(sessionId: string): PlanningSessionSnapshot | null {
  return sessions.get(sessionId) ?? null
}

export function finalizePlan(sessionId: string): PlanningResult {
  const snapshot = sessions.get(sessionId)
  if (!snapshot?.finalResult) {
    throw new Error(`Planning session ${sessionId} has no finalized plan.`)
  }
  return snapshot.finalResult
}

async function* streamAndPersist(input: {
  sessionId: string
  rawMessage: string
  context: SkillContext
  registry: CapabilityRegistry
  stream: AsyncGenerator<PlanningEvent>
}): AsyncGenerator<PlanningEvent> {
  const events: PlanningEvent[] = []
  let followUp: { question: string; missingField: UnknownField } | undefined
  let finalResult: PlanningResult | undefined
  let state: {
    rawInput: string
    intent: StructuredIntent
    missingFieldsResolved: MissingFieldResolution[]
    events: PlanningEvent[]
  } = {
    rawInput: input.rawMessage,
    intent: {
      action: "unknown",
      sellToken: null,
      buyToken: null,
      amount: null,
      slippageBps: null,
      preferences: {
        preferPrivate: null,
        preferFast: null,
        avoidStale: null
      },
      unknowns: []
    } as StructuredIntent,
    missingFieldsResolved: [],
    events
  }

  try {
    for await (const event of input.stream) {
      events.push(event)
      if (event.kind === "follow-up-required" && event.data?.state) {
        state = {
          ...event.data.state,
          events: [...events]
        }
        followUp = {
          question: event.data.question ?? event.message,
          missingField: event.data.missingField ?? "amount"
        }
      }
      if (event.kind === "plan-completed" && event.data?.state && event.data.result) {
        state = {
          ...event.data.state,
          events: [...events]
        }
        finalResult = {
          ...event.data.result,
          decisionTrace: finalizeDecisionTrace(events)
        }
      }
      yield event
    }
  } finally {
    sessions.set(input.sessionId, {
      sessionId: input.sessionId,
      status: followUp ? "awaiting_follow_up" : "planned",
      rawMessage: input.rawMessage,
      context: input.context,
      state,
      events: [...events],
      currentStage: events.at(-1)?.stage,
      followUp,
      finalResult,
      response: finalResult
        ? { kind: "plan", result: finalResult }
        : followUp
          ? {
              kind: "follow-up",
              intent: state.intent,
              missingFieldsResolved: state.missingFieldsResolved,
              partialDecisionTrace: finalizeDecisionTrace(events),
              partialEvents: [...events],
              question: followUp.question
            }
          : undefined
    })
  }
}
