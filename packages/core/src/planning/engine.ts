import type {
  AlternativeRejected,
  CoverageConfidence,
  DecisionTraceField,
  ExecutionCapabilityName,
  ExecutionBoundary,
  ExecutionCapabilityUsage,
  ExecutionPackage,
  FollowUpResponse,
  LiquiditySnapshot,
  MevRiskAssessment,
  PayloadCandidate,
  PlanningEvent,
  PlanningResult,
  PlanningSessionState,
  PriceImpactAssessment,
  RouteCandidate,
  SkillContext,
  SkillResponse,
  StructuredIntent,
  TokenRef,
  UnknownField
} from "@bsc-swap-agent-demo/shared"

import type { CapabilityRegistry } from "../capabilities/types"
import { buildGuardrails } from "../policy/guardrails"
import { attachSubmissionRequests } from "../submission/requests"
import { createPlanningEvent, finalizeDecisionTrace } from "./events"
import { extractIntent, hydratePlanningState as continueWithAnswer } from "./intent"
import {
  type StageSummarizer,
  STAGE_SUMMARY_PROMPT_VERSION,
  summarizeStageWithLLM
} from "./stage-summarizer"

export async function* runPlanningStream(input: {
  message: string
  context: SkillContext
  registry: CapabilityRegistry
  state?: PlanningSessionState
  intentExtractor?: (rawInput: string) => Promise<StructuredIntent>
  stageSummarizer?: StageSummarizer
  sessionId?: string
}): AsyncGenerator<PlanningEvent> {
  const emit = (event: Omit<PlanningEvent, "id" | "timestamp" | "sessionId">): PlanningEvent =>
    createPlanningEvent({ sessionId: input.sessionId, ...event })

  const priorEvents = [...(input.state?.events ?? [])]
  const stageSummarizer = input.stageSummarizer ?? summarizeStageWithLLM
  const intent = input.state?.intent ?? await (input.intentExtractor ?? extractIntent)(input.message)
  const state =
    input.state ??
    ({
      rawInput: input.message,
      intent,
      missingFieldsResolved: [],
      events: priorEvents
    } satisfies PlanningSessionState)

  if (!input.state) {
    yield emit({
      stage: "intent-parsing",
      kind: "stage-started",
      status: "running",
      message: "Starting natural-language intent parsing.",
      data: {
        title: "Intent parsing",
        inputPreview: [{ label: "raw_input", value: input.message }]
      }
    })
    yield emit({
      stage: "intent-parsing",
      kind: "reasoning",
      status: "completed",
      message: "Parsed the natural-language swap request into a structured intent.",
      data: {
        reasoningSource: "deterministic",
        observations: [
          { label: "action", value: state.intent.action },
          { label: "sell_token", value: state.intent.sellToken ?? "unknown" },
          { label: "buy_token", value: state.intent.buyToken ?? "unknown" },
          { label: "amount", value: state.intent.amount ?? "missing" },
          {
            label: "unknown_fields",
            value: state.intent.unknowns.length ? state.intent.unknowns.join(", ") : "none"
          },
          {
            label: "parser_model",
            value: process.env.GEMINI_MODEL || "gemini-2.5-flash"
          }
        ],
        decision: "Use the parsed intent as the execution-planning input.",
        intent: state.intent
      }
    })
    yield emit({
      stage: "intent-parsing",
      kind: "stage-completed",
      status: "completed",
      message: "Intent parsing completed."
    })
  }

  const followUp = await maybeBuildFollowUp({
    state,
    context: input.context,
    registry: input.registry,
    existingEvents: priorEvents,
    sessionId: input.sessionId
  })
  if (followUp) {
    for (const event of followUp.events) {
      yield event
    }
    return
  }

  if (!input.context.walletAddress) {
    throw new Error(
      "Missing wallet address. Set DEMO_WALLET_ADDRESS so route payloads can be simulated with real account context."
    )
  }

  const slippageBps = state.intent.slippageBps ?? 50

  yield emit({
    stage: "execution-family-selection",
    kind: "stage-started",
    status: "running",
    message: "Selecting the execution family for this swap request.",
    data: {
      title: "Execution family selection",
      inputPreview: [
        { label: "sell_token", value: state.intent.sellToken ?? "unknown" },
        { label: "buy_token", value: state.intent.buyToken ?? "unknown" },
        { label: "prefer_private", value: String(state.intent.preferences.preferPrivate ?? false) }
      ]
    }
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "execution-family-selection",
    stageSummarizer,
    deterministicMessage:
      "Selected execution families to compare: self-executed router paths and delegated solver-intent paths.",
    deterministicData: {
      observations: [
        { label: "self_executed_family", value: "direct-dex and aggregator paths can use router calldata." },
        { label: "delegated_family", value: "solver-intent and meta-aggregator paths may use approval plus intent handoff." }
      ],
      decision:
        "Compare both self-executed and delegated execution families so the planner can recommend the best overall execution package."
    },
    summaryInput: {
      stage: "execution-family-selection",
      intent: state.intent,
      toolObservations: [
        { label: "self_executed_family", value: "direct-dex and aggregator" },
        { label: "delegated_family", value: "solver-intent and meta-aggregator" }
      ]
    }
  })) {
    yield event
  }
  yield emit({
    stage: "execution-family-selection",
    kind: "stage-completed",
    status: "completed",
    message: "Execution family selection completed."
  })

  yield emit({
    stage: "liquidity-discovery",
    kind: "stage-started",
    status: "running",
    message: "Starting liquidity discovery.",
    data: {
      title: "Liquidity discovery",
      inputPreview: traceTokenInputs(state.intent.sellToken ?? "unknown", state.intent.buyToken ?? "unknown", state.intent.amount ?? "unknown")
    }
  })

  yield emit({
    stage: "liquidity-discovery",
    kind: "tool-started",
    status: "running",
    message: "Resolving sell token metadata.",
    data: { toolName: "resolveToken", inputPreview: [{ label: "query", value: state.intent.sellToken ?? "unknown" }] }
  })
  const sellToken = await resolveRequiredToken(input.registry, state.intent.sellToken!, input.context.network)
  yield emit({
    stage: "liquidity-discovery",
    kind: "tool-succeeded",
    status: "completed",
    message: "Resolved sell token metadata.",
    data: {
      toolName: "resolveToken",
      outputPreview: [
        { label: "symbol", value: sellToken.symbol },
        { label: "address", value: sellToken.address }
      ]
    }
  })

  yield emit({
    stage: "liquidity-discovery",
    kind: "tool-started",
    status: "running",
    message: "Resolving buy token metadata.",
    data: { toolName: "resolveToken", inputPreview: [{ label: "query", value: state.intent.buyToken ?? "unknown" }] }
  })
  const buyToken = await resolveRequiredToken(input.registry, state.intent.buyToken!, input.context.network)
  const amountRaw = parseAmountToRaw(state.intent.amount!, sellToken.decimals)
  yield emit({
    stage: "liquidity-discovery",
    kind: "tool-succeeded",
    status: "completed",
    message: "Resolved buy token metadata.",
    data: {
      toolName: "resolveToken",
      outputPreview: [
        { label: "symbol", value: buyToken.symbol },
        { label: "address", value: buyToken.address }
      ]
    }
  })

  yield emit({
    stage: "liquidity-discovery",
    kind: "tool-started",
    status: "running",
    message: "Fetching route candidates from the quote provider.",
    data: {
      toolName: "getQuoteCandidates",
      inputPreview: traceTokenInputs(sellToken.symbol, buyToken.symbol, state.intent.amount!)
    }
  })
  const quoteResult = input.registry.quote.getQuoteCandidatesWithAudit
    ? await input.registry.quote.getQuoteCandidatesWithAudit({
        network: input.context.network,
        sellToken,
        buyToken,
        amount: state.intent.amount!,
        amountRaw,
        slippageBps
      })
    : {
        candidates: await input.registry.quote.getQuoteCandidates({
          network: input.context.network,
          sellToken,
          buyToken,
          amount: state.intent.amount!,
          amountRaw,
          slippageBps
        }),
        audit: [],
        observedAt: new Date().toISOString()
      }
  const routeCandidatesRaw = quoteResult.candidates
  const quoteFreshness = deriveQuoteFreshness(quoteResult.observedAt)
  const providerUniverseSnapshot = await input.registry.market.buildCuratedUniverseSnapshot({
    network: input.context.network
  })
  const venueCoverageSnapshot = await input.registry.market.getVenueCoverageSnapshot({
    network: input.context.network,
    observedDexes: collectObservedDexes(routeCandidatesRaw),
    pair: { sellToken: sellToken.symbol, buyToken: buyToken.symbol }
  })
  const routeCandidatesObserved = applyVenueCoverage(routeCandidatesRaw, venueCoverageSnapshot)
  yield emit({
    stage: "liquidity-discovery",
    kind: "tool-succeeded",
    status: "completed",
    message: "Fetched route candidates.",
    data: {
      toolName: "getQuoteCandidates",
      outputPreview: [
        {
          label: "queried",
          value: quoteResult.audit.map((item) => `${item.providerId}(${item.mode})`).join(", ")
        },
        {
          label: "seen",
          value: routeCandidatesObserved
            .slice(0, 3)
            .map((candidate) => `${candidate.id} ${candidate.quotedOutFormatted}`)
            .join(", ")
        },
        {
          label: "drop",
          value: quoteResult.audit
            .filter((item) => item.status !== "observed")
            .map((item) => `${item.providerId} ${item.reason ?? item.status}`)
            .join(", ")
        },
        { label: "candidate_count", value: String(routeCandidatesObserved.length) },
        { label: "dominant_venues", value: summarizeDexes(routeCandidatesObserved) },
        {
          label: "coverage_ratio",
          value: `${Math.round(venueCoverageSnapshot.coverageRatio * 100)}%`
        },
        {
          label: "curated_aggregators",
          value: providerUniverseSnapshot.curatedCandidates
            .filter((candidate) => candidate.category === "aggregator" && candidate.included)
            .map((candidate) => candidate.displayName)
            .join(", ")
        }
      ]
    }
  })

  if (routeCandidatesObserved.length < 2) {
    yield emit({
      stage: "liquidity-discovery",
      kind: "stage-failed",
      status: "failed",
      message: "Could not gather enough route candidates to explain execution tradeoffs.",
      data: {
        observations: [{ label: "candidate_count", value: String(routeCandidatesObserved.length) }],
        decision: "Stop because best-execution comparison needs at least two candidates.",
        error: "Need at least two route candidates to explain best execution tradeoffs."
      }
    })
    throw new Error("Need at least two route candidates to explain best execution tradeoffs.")
  }

  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "liquidity-discovery",
    stageSummarizer,
    deterministicMessage: "Fetched live route candidates and venue composition for the requested swap.",
    deterministicData: {
      observations: [
        { label: "quote_source", value: "OpenOcean aggregator APIs" },
        { label: "candidate_count", value: String(routeCandidatesObserved.length) },
        { label: "dominant_venues", value: summarizeDexes(routeCandidatesObserved) },
        {
          label: "coverage_ratio",
          value: `${Math.round(venueCoverageSnapshot.coverageRatio * 100)}%`
        },
        {
          label: "modeled_adapters",
          value: providerUniverseSnapshot.modeledAdapters.join(", ") || "none"
        }
      ],
      decision: "Use the candidate set as the basis for execution-quality comparison.",
      artifacts: routeCandidatesObserved.slice(0, 4).map((candidate) => ({
        label: candidate.id,
        value: candidate.quotedOutFormatted
      }))
    },
    summaryInput: {
      stage: "liquidity-discovery",
      intent: state.intent,
      toolObservations: [
        { label: "quote_source", value: "OpenOcean aggregator APIs" },
        { label: "candidate_count", value: String(routeCandidatesObserved.length) },
        { label: "dominant_venues", value: summarizeDexes(routeCandidatesObserved) },
        {
          label: "coverage_ratio",
          value: `${Math.round(venueCoverageSnapshot.coverageRatio * 100)}%`
        },
        {
          label: "modeled_adapters",
          value: providerUniverseSnapshot.modeledAdapters.join(", ") || "none"
        }
      ],
      currentCandidates: routeCandidatesObserved.slice(0, 4)
    }
  })) {
    yield event
  }
  yield emit({
    stage: "liquidity-discovery",
    kind: "stage-completed",
    status: "completed",
    message: "Liquidity discovery completed."
  })

  yield emit({
    stage: "route-comparison",
    kind: "stage-started",
    status: "running",
    message: "Starting route comparison.",
    data: {
      title: "Route comparison",
      inputPreview: [{ label: "candidate_ids", value: routeCandidatesRaw.map((route) => route.id).join(", ") }]
    }
  })
  const mevRiskAssessment = assessMevRisk(routeCandidatesObserved, state.intent)
  const routeCandidates = scoreRoutes(routeCandidatesObserved, mevRiskAssessment, state.intent)
  const recommendedRoute = routeCandidates[0]
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "route-comparison",
    stageSummarizer,
    deterministicMessage: "Compared route candidates by quoted output, impact, stability, and MEV exposure.",
    deterministicData: {
      observations: routeCandidates.map((candidate) => ({
        label: candidate.id,
        value: `score=${candidate.score.toFixed(4)}, impact=${candidate.priceImpactPct.toFixed(3)}%, mev=${candidate.mevExposure}, coverage=${candidate.coverageConfidence}`
      })),
      decision: `Keep ${routeCandidates
        .slice(0, 2)
        .map((candidate) => candidate.id)
        .join(", ")} for payload preparation.`,
      artifacts: routeCandidates.slice(1).map((candidate) => ({
        label: candidate.id,
        value: candidate.rejectionReason ?? "lower execution score"
      }))
    },
    summaryInput: {
      stage: "route-comparison",
      intent: state.intent,
      toolObservations: routeCandidates.map((candidate) => ({
        label: candidate.id,
        value: `${candidate.quotedOutFormatted}, impact=${candidate.priceImpactPct.toFixed(3)}%, stability=${candidate.expectedExecutionStability}, mev=${candidate.mevExposure}, coverage=${candidate.coverageConfidence}`
      })),
      currentCandidates: routeCandidates,
      recommendedCandidate: recommendedRoute,
      rejectedCandidates: routeCandidates.slice(1).map((candidate) => ({
        id: candidate.id,
        reason: candidate.rejectionReason ?? "lower execution score"
      }))
    }
  })) {
    yield event
  }
  yield emit({
    stage: "route-comparison",
    kind: "stage-completed",
    status: "completed",
    message: "Route comparison completed."
  })

  yield emit({
    stage: "payload-construction",
    kind: "stage-started",
    status: "running",
    message: "Starting payload construction and simulation.",
    data: {
      title: "Payload construction",
      inputPreview: [{ label: "candidate_count", value: String(Math.min(2, routeCandidates.length)) }]
    }
  })

  const payloadCandidates: PayloadCandidate[] = []
  for (const [index, candidate] of routeCandidates.slice(0, 2).entries()) {
    yield emit({
      stage: "payload-construction",
      kind: "tool-started",
      status: "running",
      message: `Encoding router calldata for ${candidate.id}.`,
      data: {
        toolName: "encodeRouterCalldata",
        inputPreview: [
          { label: "route", value: candidate.id },
          { label: "platform", value: candidate.platform }
        ]
      }
    })
    const encoded = await input.registry.quote.encodeRouterCalldata({
      network: input.context.network,
      platform: candidate.platform,
      sellToken,
      buyToken,
      amount: state.intent.amount!,
      amountRaw,
      slippageBps,
      account: input.context.walletAddress
    })
    yield emit({
      stage: "payload-construction",
      kind: "tool-succeeded",
      status: "completed",
      message: `Encoded router calldata for ${candidate.id}.`,
      data: {
        toolName: "encodeRouterCalldata",
        outputPreview: [
          { label: "target", value: encoded.to },
          { label: "data_preview", value: `${encoded.data.slice(0, 18)}...` }
        ]
      }
    })

    yield emit({
      stage: "payload-construction",
      kind: "tool-started",
      status: "running",
      message: `Simulating ${candidate.id} payload through direct RPC.`,
      data: {
        toolName: "simulateTransaction",
        inputPreview: [
          { label: "route", value: candidate.id },
          { label: "target", value: encoded.to }
        ]
      }
    })
    const simulation = await input.registry.quote.simulateTransaction({
      network: input.context.network,
      account: input.context.walletAddress,
      to: encoded.to,
      data: encoded.data,
      value: encoded.value
    })
    if (!simulation.ok) {
      yield emit({
        stage: "payload-construction",
        kind: "tool-failed",
        status: "failed",
        message: `Simulation failed for ${candidate.id}.`,
        data: {
          toolName: "simulateTransaction",
          outputPreview: [{ label: "simulation_error", value: simulation.note }]
        }
      })
      yield emit({
        stage: "payload-construction",
        kind: "stage-failed",
        status: "failed",
        message: `Built a candidate payload for ${candidate.id}, but direct RPC simulation failed.`,
        data: {
          observations: [
            { label: "target", value: encoded.to },
            { label: "data_preview", value: `${encoded.data.slice(0, 18)}...` },
            { label: "data_length", value: String(encoded.data.length) }
          ],
          decision: "Stop because the recommended payload must simulate successfully.",
          error: simulation.note
        }
      })
      throw new Error(`RPC simulation failed for ${candidate.platform}: ${simulation.note}`)
    }
    yield emit({
      stage: "payload-construction",
      kind: "tool-succeeded",
      status: "completed",
      message: `Simulation succeeded for ${candidate.id}.`,
      data: {
        toolName: "simulateTransaction",
        outputPreview: [
          { label: "estimated_gas", value: simulation.estimatedGas },
          { label: "result", value: simulation.note }
        ]
      }
    })
    payloadCandidates.push({
      id: `payload-${index + 1}-${candidate.id}`,
      type: "router-calldata",
      routeFamily: candidate.routeFamily,
      ...encoded,
      executionMode: "self-executed",
      approvalRequired: !sellToken.isNative,
      simulation
    })
  }

  const payload = payloadCandidates[0]
  yield emit({
    stage: "payload-construction",
    kind: "reasoning",
    status: "completed",
    message: "Built router-calldata payload candidates and simulated them with direct RPC account context.",
    data: {
      reasoningSource: "deterministic",
      observations: payloadCandidates.map((candidate) => ({
        label: candidate.id,
        value: `target=${candidate.to}, gas=${candidate.simulation.estimatedGas}`
      })),
      decision: `Use ${payload.id} as the primary payload because it matches the recommended route and passed simulation.`,
      artifacts: payloadCandidates.map((candidate) => ({
        label: candidate.id,
        value: `${candidate.data.slice(0, 18)}... (${candidate.data.length} chars)`
      }))
    }
  })
  yield emit({
    stage: "payload-construction",
    kind: "stage-completed",
    status: "completed",
    message: "Payload construction completed."
  })

  yield emit({
    stage: "price-impact-assessment",
    kind: "stage-started",
    status: "running",
    message: "Assessing quoted output versus price impact."
  })
  const priceImpactAssessment = buildPriceImpactAssessment(routeCandidates)
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "price-impact-assessment",
    stageSummarizer,
    deterministicMessage: "Compared the best quoted route with the lowest-impact route.",
    deterministicData: {
      observations: [
        { label: "best_quoted_route", value: priceImpactAssessment.bestQuotedRouteId ?? "none" },
        { label: "lowest_impact_route", value: priceImpactAssessment.lowestImpactRouteId ?? "none" }
      ],
      decision: priceImpactAssessment.commentary
    },
    summaryInput: {
      stage: "price-impact-assessment",
      intent: state.intent,
      toolObservations: [
        { label: "best_quoted_route", value: priceImpactAssessment.bestQuotedRouteId ?? "none" },
        { label: "lowest_impact_route", value: priceImpactAssessment.lowestImpactRouteId ?? "none" },
        {
          label: "mismatch",
          value: String(priceImpactAssessment.bestQuotedRouteId !== priceImpactAssessment.lowestImpactRouteId)
        }
      ],
      priceImpactAssessment
    }
  })) {
    yield event
  }
  yield emit({
    stage: "price-impact-assessment",
    kind: "stage-completed",
    status: "completed",
    message: "Price impact assessment completed."
  })

  yield emit({
    stage: "mev-risk-assessment",
    kind: "stage-started",
    status: "running",
    message: "Assessing MEV sensitivity and submission exposure."
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "mev-risk-assessment",
    stageSummarizer,
    deterministicMessage: "Estimated MEV sensitivity based on route fragmentation, trade shape, and user preference.",
    deterministicData: {
      observations: [
        { label: "risk_level", value: mevRiskAssessment.level },
        { label: "public_path_risk", value: mevRiskAssessment.publicPathRisk }
      ],
      decision: `Prefer ${mevRiskAssessment.preferredSubmission} due to ${mevRiskAssessment.level} MEV sensitivity.`
    },
    summaryInput: {
      stage: "mev-risk-assessment",
      intent: state.intent,
      toolObservations: [
        { label: "risk_level", value: mevRiskAssessment.level },
        { label: "public_path_risk", value: mevRiskAssessment.publicPathRisk },
        {
          label: "fragmented_routes",
          value: String(routeCandidates.some((candidate) => candidate.dexes.length >= 3))
        }
      ],
      currentCandidates: routeCandidates,
      mevAssessment: mevRiskAssessment
    }
  })) {
    yield event
  }
  yield emit({
    stage: "mev-risk-assessment",
    kind: "stage-completed",
    status: "completed",
    message: "MEV risk assessment completed."
  })

  const liquiditySnapshot = buildLiquiditySnapshot({
    sellToken,
    buyToken,
    routes: routeCandidates
  })
  const guardrails = buildGuardrails({
    intent: state.intent,
    route: recommendedRoute,
    payload,
    mevRisk: mevRiskAssessment
  })
  yield emit({
    stage: "guardrail-application",
    kind: "stage-started",
    status: "running",
    message: "Applying deterministic execution guardrails."
  })
  yield emit({
    stage: "guardrail-application",
    kind: "reasoning",
    status: "completed",
    message: "Applied deterministic safety rules to the recommended route and payload.",
    data: {
      reasoningSource: "deterministic",
      observations: guardrails.map((guardrail) => ({
        label: guardrail.name,
        value: `${guardrail.status}: ${guardrail.value}`
      })),
      decision: "Carry forward the plan only with simulation, slippage, deadline, and stale-quote protections."
    }
  })
  yield emit({
    stage: "guardrail-application",
    kind: "stage-completed",
    status: "completed",
    message: "Guardrail application completed."
  })

  yield emit({
    stage: "submission-strategy",
    kind: "stage-started",
    status: "running",
    message: "Comparing submission paths for the current MEV profile."
  })
  yield emit({
    stage: "submission-strategy",
    kind: "tool-started",
    status: "running",
    message: "Fetching submission path recommendations.",
    data: {
      toolName: "getSubmissionPaths",
      inputPreview: [{ label: "mev_risk_level", value: mevRiskAssessment.level }]
    }
  })
  const submissionCandidates = await input.registry.submission.getSubmissionPaths({
    network: input.context.network,
    mevRiskLevel: mevRiskAssessment.level,
    preferPrivate: state.intent.preferences.preferPrivate
  })
  const privatePathRegistrySummary = await input.registry.submission.getPrivatePathRegistrySummary?.({
    network: input.context.network
  })
  const executionCapabilitySummary = await input.registry.submission.getExecutionCapabilitySummary?.({
    network: input.context.network
  })
  const capabilityAvailable = deriveExecutionCapabilityNames(executionCapabilitySummary)
  const keptRouteIds = routeCandidates
    .filter((candidate) =>
      payloadCandidates.some(
        (payloadCandidate) =>
          payloadCandidate.platform === candidate.platform && payloadCandidate.routeFamily === candidate.routeFamily
      )
    )
    .map((candidate) => candidate.id)
  let executionCapabilityUsage: ExecutionCapabilityUsage = {
    available: capabilityAvailable,
    used: [],
    notes: executionCapabilitySummary?.available
      ? ["route-sim unavailable, local simulation only"]
      : ["execution-mcp unavailable, local simulation only"]
  }
  if (executionCapabilitySummary?.available && executionCapabilitySummary.routeSimulationAvailable) {
    const amountForRouteSim = typeof state.intent.amount === "string" ? state.intent.amount : String(state.intent.amount ?? "")
    const routeSimulation = await input.registry.submission.simulateCandidateRoutes?.({
      network: input.context.network,
      sellToken,
      buyToken,
      amount: amountForRouteSim,
      slippageBps,
      account: input.context.walletAddress,
      routeIds: keptRouteIds
    })
    if (routeSimulation) {
      executionCapabilityUsage = {
        available: capabilityAvailable,
        used: routeSimulation.usage.used,
        notes: routeSimulation.note ? [routeSimulation.note] : routeSimulation.usage.notes
      }
    }
  }
  const recommendedSubmission =
    submissionCandidates.find((candidate) => candidate.recommended) ?? submissionCandidates[0]
  yield emit({
    stage: "submission-strategy",
    kind: "tool-succeeded",
    status: "completed",
    message: "Fetched submission path recommendations.",
    data: {
      toolName: "getSubmissionPaths",
      outputPreview: submissionCandidates.map((candidate) => ({
        label:
          candidate.submissionChannel === "public-mempool"
            ? "public"
            : candidate.submissionChannel === "private-rpc"
              ? "private"
              : candidate.submissionChannel === "builder-aware-broadcast"
                ? "builder"
                : "intent",
        value: [candidate.liveStatus, candidate.verificationStatus, candidate.sourceType === "registry-backed" ? "registry" : null]
          .filter(Boolean)
          .join(" ")
      }))
    }
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "submission-strategy",
    stageSummarizer,
    deterministicMessage: "Compared public and advisory private submission paths against the MEV profile of the swap.",
    deterministicData: {
      observations: submissionCandidates.map((candidate) => ({
        label: candidate.path,
        value: `${candidate.availability}; recommended=${candidate.recommended}`
      })),
      decision:
        recommendedSubmission.path === "public-mempool"
          ? "Keep public mempool as the available path, but surface extraction risk."
          : `Recommend ${recommendedSubmission.path} because submission quality is part of execution quality.`,
      artifacts:
        recommendedSubmission.path === "public-mempool"
          ? []
          : [{ label: "public_path_not_chosen", value: "Higher extraction risk under builder-aware conditions." }]
    },
    summaryInput: {
      stage: "submission-strategy",
      intent: state.intent,
      toolObservations: submissionCandidates.map((candidate) => ({
        label: candidate.path,
        value: `${candidate.availability}; recommended=${candidate.recommended}`
      })),
      submissionCandidates,
      mevAssessment: mevRiskAssessment
    }
  })) {
    yield event
  }
  yield emit({
    stage: "submission-strategy",
    kind: "stage-completed",
    status: "completed",
    message: "Submission strategy completed."
  })

  payloadCandidates.push(
    buildDelegatedIntentPayload({
      intent: state.intent,
      route: recommendedRoute
    })
  )

  yield emit({
    stage: "execution-package-construction",
    kind: "stage-started",
    status: "running",
    message: "Constructing execution packages from route, payload, and submission combinations.",
    data: {
      title: "Execution package construction",
      inputPreview: [{ label: "route_count", value: String(routeCandidates.length) }]
    }
  })
  const executionPackages = buildExecutionPackages({
    intent: state.intent,
    routeCandidates,
    payloadCandidates,
    submissionCandidates
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "execution-package-construction",
    stageSummarizer,
    deterministicMessage:
      "Built execution packages that combine route family, payload type, submission channel, and delegation mode.",
    deterministicData: {
      observations: executionPackages.map((pkg) => ({
        label: pkg.id,
        value: `${pkg.routeFamily}, ${pkg.payloadType}, ${pkg.submissionProvider}, ${pkg.executionMode}`
      })),
      decision: "Compare full execution packages instead of treating route choice and submission choice as separate decisions."
    },
    summaryInput: {
      stage: "execution-package-construction",
      intent: state.intent,
      toolObservations: executionPackages.map((pkg) => ({
        label: pkg.id,
        value: `${pkg.routeProvider}, ${pkg.submissionProvider}, ${pkg.executionMode}`
      }))
    }
  })) {
    yield event
  }
  yield emit({
    stage: "execution-package-construction",
    kind: "stage-completed",
    status: "completed",
    message: "Execution package construction completed."
  })

  const bestPricePackage =
    executionPackages.reduce((best, candidate) => {
      const currentBestRoute = routeCandidates.find((route) => route.id === best.routeId)
      const nextRoute = routeCandidates.find((route) => route.id === candidate.routeId)
      if (!currentBestRoute || !nextRoute) {
        return best
      }
      return BigInt(nextRoute.quotedOut) > BigInt(currentBestRoute.quotedOut) ? candidate : best
    }, executionPackages[0])
  const bestExecutionPackage = executionPackages.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best
  , executionPackages[0])

  yield emit({
    stage: "execution-package-comparison",
    kind: "stage-started",
    status: "running",
    message: "Comparing execution packages across self-executed and delegated paths.",
    data: {
      title: "Execution package comparison",
      inputPreview: [{ label: "package_count", value: String(executionPackages.length) }]
    }
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "execution-package-comparison",
    stageSummarizer,
    deterministicMessage:
      "Compared execution packages across route family, payload type, submission channel, and delegation boundary.",
    deterministicData: {
      observations: executionPackages.map((pkg) => ({
        label: pkg.id,
        value: `score=${pkg.score.toFixed(3)}, mode=${pkg.executionMode}, provider=${pkg.submissionProvider}`
      })),
      decision: `Choose ${bestExecutionPackage.id} as the best execution package while tracking ${bestPricePackage.id} as the best price package.`
    },
    summaryInput: {
      stage: "execution-package-comparison",
      intent: state.intent,
      toolObservations: executionPackages.map((pkg) => ({
        label: pkg.id,
        value: `score=${pkg.score.toFixed(3)}, route=${pkg.routeProvider}, submission=${pkg.submissionProvider}`
      }))
    }
  })) {
    yield event
  }
  yield emit({
    stage: "execution-package-comparison",
    kind: "stage-completed",
    status: "completed",
    message: "Execution package comparison completed."
  })

  yield emit({
    stage: "path-quality-assessment",
    kind: "stage-started",
    status: "running",
    message: "Assessing path quality, delegation boundaries, and approval overhead.",
    data: { title: "Path quality assessment" }
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "path-quality-assessment",
    stageSummarizer,
    deterministicMessage:
      "Assessed path quality by balancing route quality, submission quality, approval overhead, and delegation tradeoffs.",
    deterministicData: {
      observations: [
        { label: "best_price_package", value: bestPricePackage.id },
        { label: "best_execution_package", value: bestExecutionPackage.id },
        { label: "execution_mode", value: bestExecutionPackage.executionMode },
        { label: "delegation_boundary", value: bestExecutionPackage.plannerControlLevel }
      ],
      decision:
        bestPricePackage.id === bestExecutionPackage.id
          ? "Best price and best execution align for this swap."
          : "Best price does not win outright because submission channel, delegation shape, and approval overhead change execution quality."
    },
    summaryInput: {
      stage: "path-quality-assessment",
      intent: state.intent,
      toolObservations: [
        { label: "best_price_package", value: bestPricePackage.id },
        { label: "best_execution_package", value: bestExecutionPackage.id },
        { label: "execution_mode", value: bestExecutionPackage.executionMode },
        { label: "submission_provider", value: bestExecutionPackage.submissionProvider }
      ]
    }
  })) {
    yield event
  }
  yield emit({
    stage: "path-quality-assessment",
    kind: "stage-completed",
    status: "completed",
    message: "Path quality assessment completed."
  })

  const alternativesRejected = routeCandidates.slice(1).map((candidate) => ({
    routeId: candidate.id,
    reason:
      candidate.rejectionReason ||
      "Rejected because it underperformed on execution quality relative to the recommended route."
  })) as AlternativeRejected[]

  yield emit({
    stage: "final-recommendation",
    kind: "stage-started",
    status: "running",
    message: "Assembling the final execution recommendation."
  })
  for (const event of await buildStageReasoningEvents({
    emit,
    stage: "final-recommendation",
    stageSummarizer,
    deterministicMessage: "Combined route, payload, submission path, delegation mode, and guardrails into the final execution plan.",
    deterministicData: {
      observations: [
        { label: "best_price_package", value: bestPricePackage.id },
        { label: "best_execution_package", value: bestExecutionPackage.id },
        { label: "execution_mode", value: bestExecutionPackage.executionMode },
        { label: "submission_provider", value: bestExecutionPackage.submissionProvider }
      ],
      decision: `Recommend ${bestExecutionPackage.id} as the best execution package for this swap.`,
      artifacts: alternativesRejected.map((candidate) => ({
        label: candidate.routeId,
        value: candidate.reason
      }))
    },
    summaryInput: {
      stage: "final-recommendation",
      intent: state.intent,
      toolObservations: [
        { label: "best_price_package", value: bestPricePackage.id },
        { label: "best_execution_package", value: bestExecutionPackage.id },
        { label: "execution_mode", value: bestExecutionPackage.executionMode },
        { label: "submission_provider", value: bestExecutionPackage.submissionProvider }
      ],
      recommendedCandidate: recommendedRoute,
      rejectedCandidates: alternativesRejected.map((candidate) => ({
        id: candidate.routeId,
        reason: candidate.reason
      })),
      submissionCandidates
    }
  })) {
    yield event
  }
  yield emit({
    stage: "final-recommendation",
    kind: "stage-completed",
    status: "completed",
    message: "Final recommendation completed."
  })

  const finalState: PlanningSessionState = {
    rawInput: state.rawInput,
    intent: state.intent,
    missingFieldsResolved: state.missingFieldsResolved,
    events: []
  }

  const result = attachSubmissionRequests({
    network: input.context.network,
    walletAddress: input.context.walletAddress,
    result: {
      intent: state.intent,
      missingFieldsResolved: state.missingFieldsResolved,
      decisionTrace: [],
      liquiditySnapshot,
      venueCoverageSnapshot,
      providerUniverseSnapshot,
      routeCandidates,
      quoteProviderAudit: quoteResult.audit,
      quoteObservedAt: quoteResult.observedAt,
      quoteFreshness,
      executionPackages,
      priceImpactAssessment,
      bestObservedQuoteConfidence: deriveBestObservedQuoteConfidence(routeCandidates, priceImpactAssessment),
      mevRiskAssessment,
      payloadCandidates,
      submissionCandidates,
      privatePathRegistrySummary,
      executionCapabilitySummary,
      executionCapabilityUsage,
      guardrails,
      executionBoundary: buildExecutionBoundary(bestExecutionPackage),
      recommendedPlan: {
        routeId: bestExecutionPackage.routeId,
        payloadId: bestExecutionPackage.payloadId,
        submissionPath: bestExecutionPackage.submissionPath,
        executionPackageId: bestExecutionPackage.id,
        bestPricePackageId: bestPricePackage.id,
        bestExecutionPackageId: bestExecutionPackage.id,
        executionMode: bestExecutionPackage.executionMode,
        submissionChannel: bestExecutionPackage.submissionChannel,
        submissionProvider: bestExecutionPackage.submissionProvider,
        expectedOut: recommendedRoute.quotedOutFormatted,
        summary:
          `Recommended ${bestExecutionPackage.routeProvider} via ${bestExecutionPackage.submissionProvider} because it offers the strongest overall execution package, not just the best observed quote among the current adapters. ` +
          `This package balances route quality, path quality, delegation shape, and approval overhead for the current swap.`,
        riskNote:
          bestExecutionPackage.submissionChannel === "public-mempool"
            ? "Public submission remains directly executable, but it carries a weaker path-quality profile than builder-friendly alternatives."
            : [
                `${bestExecutionPackage.submissionProvider} is recommended as a builder-friendly choice, but some execution outcomes remain outside the planner's direct control.`,
                venueCoverageSnapshot.missingHighShareVenues.length
                  ? `Market coverage is still partial because some high-share BSC venues were not clearly observed: ${venueCoverageSnapshot.missingHighShareVenues.slice(0, 3).join(", ")}.`
                  : null
              ]
                .filter(Boolean)
                .join(" "),
        policyNote:
          bestExecutionPackage.executionMode === "self-executed"
            ? "Simulation, slippage bounds, deadline, and stale-quote checks remain mandatory before live self-execution."
            : "Approval policy, handoff requirements, and quote freshness remain mandatory before any delegated execution path."
      },
      observedRouteIds: routeCandidates.map((candidate) => candidate.id),
      defaultSelectedRouteId: routeCandidates[0]?.id ?? bestExecutionPackage.routeId,
      effectiveSlippageBps: slippageBps,
      executionReadyNow:
        quoteFreshness === "fresh" &&
        routeCandidates.some((candidate) =>
          payloadCandidates.some(
            (payloadCandidate) =>
              payloadCandidate.platform === candidate.platform &&
              payloadCandidate.routeFamily === candidate.routeFamily &&
              payloadCandidate.simulation.ok
          )
        ) &&
        submissionCandidates.some(
          (submission) => submission.submissionChannel === "public-mempool" && submission.liveStatus === "live"
        ),
      bestQuoteRouteId: priceImpactAssessment.bestQuotedRouteId,
      bestReadyRouteId: routeCandidates.find((candidate) =>
        payloadCandidates.some(
          (payloadCandidate) =>
            payloadCandidate.platform === candidate.platform &&
            payloadCandidate.routeFamily === candidate.routeFamily &&
            payloadCandidate.simulation.ok
        )
      )?.id ?? null,
      routeExecutionReadiness: routeCandidates.map((candidate) => {
        const payloadCandidate = payloadCandidates.find(
          (payload) => payload.platform === candidate.platform && payload.routeFamily === candidate.routeFamily
        )
        const simulationOk = payloadCandidate?.simulation.ok ?? false
        return {
          routeId: candidate.id,
          payloadReady: Boolean(payloadCandidate),
          simulationOk,
          liveExecutable: Boolean(
            payloadCandidate &&
              simulationOk &&
              payloadCandidate.executionMode === "self-executed" &&
              submissionCandidates.some(
                (submission) =>
                  submission.submissionChannel === "public-mempool" &&
                  submission.liveStatus === "live" &&
                  submission.routeFamilies.includes(candidate.routeFamily)
              )
          )
        }
      }),
      alternativesRejected
    }
  })

  yield emit({
    stage: "final-recommendation",
    kind: "plan-completed",
    status: "completed",
    message: "Planning completed successfully.",
    data: {
      result,
      state: finalState
    }
  })
}

export async function planSwap(input: {
  message: string
  context: SkillContext
  registry: CapabilityRegistry
  state?: PlanningSessionState
  intentExtractor?: (rawInput: string) => Promise<StructuredIntent>
  stageSummarizer?: StageSummarizer
  sessionId?: string
}): Promise<SkillResponse> {
  const events = [...(input.state?.events ?? [])]
  let followUpEvent: PlanningEvent | null = null
  let finalResult: PlanningResult | null = null

  for await (const event of runPlanningStream(input)) {
    events.push(event)
    if (event.kind === "follow-up-required") {
      followUpEvent = event
    }
    if (event.kind === "plan-completed" && event.data?.result) {
      finalResult = {
        ...event.data.result,
        decisionTrace: finalizeDecisionTrace(events)
      }
    }
  }

  if (followUpEvent?.data?.intent && followUpEvent.data.question) {
    return {
      kind: "follow-up",
      intent: followUpEvent.data.intent,
      missingFieldsResolved: followUpEvent.data.missingFieldsResolved ?? [],
      partialDecisionTrace: finalizeDecisionTrace(events),
      partialEvents: events,
      question: followUpEvent.data.question
    }
  }

  if (!finalResult) {
    throw new Error("Planning completed without a final result.")
  }

  return {
    kind: "plan",
    result: finalResult
  }
}

function deriveQuoteFreshness(observedAt: string): "fresh" | "stale" {
  const ageMs = Date.now() - Date.parse(observedAt)
  return Number.isFinite(ageMs) && ageMs > 20_000 ? "stale" : "fresh"
}

function parseAmountToRaw(amount: string, decimals: number): string {
  const normalizedAmount = String(amount ?? "").trim()
  const [wholePart, fractionalPart = ""] = normalizedAmount.split(".")
  const normalizedWhole = wholePart === "" ? "0" : wholePart
  const normalizedFraction = fractionalPart.replace(/[^0-9]/g, "").slice(0, decimals).padEnd(decimals, "0")
  return `${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0"
}

function deriveExecutionCapabilityNames(
  summary?: PlanningResult["executionCapabilitySummary"]
): ExecutionCapabilityName[] {
  if (!summary?.available) {
    return []
  }

  return [
    summary.privateSubmitAvailable ? "private-submit" : null,
    summary.builderBroadcastAvailable ? "builder-broadcast" : null,
    summary.auditAvailable ? "audit" : null,
    summary.routeSimulationAvailable ? "route-sim" : null
  ].filter(Boolean) as ExecutionCapabilityName[]
}

export function continuePlan(sessionState: PlanningSessionState, userAnswer: string): PlanningSessionState {
  return continueWithAnswer(
    {
      intent: sessionState.intent,
      missingFieldsResolved: sessionState.missingFieldsResolved,
      partialEvents: sessionState.events
    },
    `${sessionState.rawInput}\n${userAnswer}`,
    userAnswer
  )
}

async function maybeBuildFollowUp(input: {
  state: PlanningSessionState
  context: SkillContext
  registry: CapabilityRegistry
  existingEvents: PlanningEvent[]
  sessionId?: string
}): Promise<{ events: PlanningEvent[] } | null> {
  const unknowns = new Set<UnknownField>(input.state.intent.unknowns)
  if (!unknowns.has("amount")) {
    return null
  }

  const emit = (event: Omit<PlanningEvent, "id" | "timestamp" | "sessionId">): PlanningEvent =>
    createPlanningEvent({ sessionId: input.sessionId, ...event })

  const events: PlanningEvent[] = [
    emit({
      stage: "missing-field-resolution",
      kind: "stage-started",
      status: "running",
      message: "Resolving missing fields before route planning.",
      data: {
        title: "Missing field resolution",
        inputPreview: [{ label: "missing_fields", value: input.state.intent.unknowns.join(", ") }]
      }
    })
  ]

  let balanceContext = ""
  if (input.context.walletAddress && input.state.intent.sellToken) {
    yieldToolStarted(events, emit, "missing-field-resolution", "resolveToken", [{ label: "query", value: input.state.intent.sellToken }], "Resolving token metadata for follow-up context.")
    const sellToken = await input.registry.chain.resolveToken(
      input.state.intent.sellToken,
      input.context.network
    )
    if (sellToken) {
      events.push(
        emit({
          stage: "missing-field-resolution",
          kind: "tool-succeeded",
          status: "completed",
          message: "Resolved follow-up token metadata.",
          data: {
            toolName: "resolveToken",
            outputPreview: [
              { label: "symbol", value: sellToken.symbol },
              { label: "address", value: sellToken.address }
            ]
          }
        })
      )
      try {
        if (sellToken.isNative) {
          yieldToolStarted(events, emit, "missing-field-resolution", "getNativeBalance", [{ label: "address", value: input.context.walletAddress }], "Fetching native balance for follow-up context.")
          const balance = await input.registry.chain.getNativeBalance(
            input.context.walletAddress,
            input.context.network
          )
          balanceContext = `You currently hold ${balance.formatted} ${sellToken.symbol}. `
          events.push(
            emit({
              stage: "missing-field-resolution",
              kind: "tool-succeeded",
              status: "completed",
              message: "Fetched native balance for follow-up context.",
              data: {
                toolName: "getNativeBalance",
                outputPreview: [{ label: "wallet_balance", value: balanceContext.trim() }]
              }
            })
          )
        } else {
          yieldToolStarted(events, emit, "missing-field-resolution", "getErc20Balance", [{ label: "address", value: input.context.walletAddress }, { label: "token", value: sellToken.address }], "Fetching ERC20 balance for follow-up context.")
          const balance = await input.registry.chain.getErc20Balance(
            sellToken.address,
            input.context.walletAddress,
            input.context.network
          )
          balanceContext = `You currently hold ${balance.formatted} ${sellToken.symbol}. `
          events.push(
            emit({
              stage: "missing-field-resolution",
              kind: "tool-succeeded",
              status: "completed",
              message: "Fetched ERC20 balance for follow-up context.",
              data: {
                toolName: "getErc20Balance",
                outputPreview: [{ label: "wallet_balance", value: balanceContext.trim() }]
              }
            })
          )
        }
      } catch {
        // Keep follow-up functional even if balance context fails.
      }
    }
  }

  const question = `${balanceContext}How much ${input.state.intent.sellToken ?? "of the sell token"} would you like to swap?`
  const nextState: PlanningSessionState = {
    rawInput: input.state.rawInput,
    intent: input.state.intent,
    missingFieldsResolved: input.state.missingFieldsResolved,
    events: [...input.existingEvents, ...events]
  }
  events.push(
    emit({
      stage: "missing-field-resolution",
      kind: "reasoning",
      status: "needs-input",
      message: "Planning is blocked on a required field, so the system asked a follow-up question.",
      data: {
        reasoningSource: "deterministic",
        observations: [
          ...(balanceContext ? [{ label: "wallet_balance", value: balanceContext.trim() }] : []),
          { label: "missing_fields", value: input.state.intent.unknowns.join(", ") }
        ],
        decision: question
      }
    }),
    emit({
      stage: "missing-field-resolution",
      kind: "follow-up-required",
      status: "needs-input",
      message: question,
      data: {
        question,
        missingField: "amount",
        intent: input.state.intent,
        missingFieldsResolved: input.state.missingFieldsResolved,
        state: nextState
      }
    })
  )

  return { events }
}

function yieldToolStarted(
  events: PlanningEvent[],
  emit: (event: Omit<PlanningEvent, "id" | "timestamp" | "sessionId">) => PlanningEvent,
  stage: PlanningEvent["stage"],
  toolName: string,
  inputPreview: { label: string; value: string }[],
  message: string
) {
  events.push(
    emit({
      stage,
      kind: "tool-started",
      status: "running",
      message,
      data: { toolName, inputPreview }
    })
  )
}

async function buildStageReasoningEvents(input: {
  emit: (event: Omit<PlanningEvent, "id" | "timestamp" | "sessionId">) => PlanningEvent
  stage: PlanningEvent["stage"]
  stageSummarizer: StageSummarizer
  deterministicMessage: string
  deterministicData: NonNullable<PlanningEvent["data"]>
  summaryInput?: Parameters<StageSummarizer>[0]
}): Promise<PlanningEvent[]> {
  const events: PlanningEvent[] = [
    input.emit({
      stage: input.stage,
      kind: "reasoning",
      status: "completed",
      message: input.deterministicMessage,
      data: {
        ...input.deterministicData,
        reasoningSource: "deterministic"
      }
    })
  ]

  if (!input.summaryInput || !shouldUseLlmSummary(input.stage)) {
    return events
  }

  yieldToolStarted(
    events,
    input.emit,
    input.stage,
    "summarizeStageWithLLM",
    [{ label: "stage", value: input.stage }],
    "Generating a compact LLM summary from tool observations."
  )

  try {
    const summary = await withTimeout(
      input.stageSummarizer(input.summaryInput),
      7000,
      `Timed out while generating an LLM summary for ${input.stage}.`
    )
    events.push(
      input.emit({
        stage: input.stage,
        kind: "tool-succeeded",
        status: "completed",
        message: "Generated a compact LLM summary.",
        data: {
          toolName: "summarizeStageWithLLM",
          outputPreview: [
            { label: "summary", value: summary.summary },
            { label: "decision", value: summary.decision }
          ]
        }
      }),
      input.emit({
        stage: input.stage,
        kind: "reasoning",
        status: "completed",
        message: summary.summary,
        data: {
          observations: summary.observations ?? [],
          decision: summary.decision,
          reasoningSource: "llm",
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          promptVersion: STAGE_SUMMARY_PROMPT_VERSION
        }
      })
    )
  } catch (error) {
    const message = truncatePreview(error instanceof Error ? error.message : String(error))
    events.push(
      input.emit({
        stage: input.stage,
        kind: "tool-failed",
        status: "failed",
        message: "LLM stage summary failed. Falling back to deterministic reasoning.",
        data: {
          toolName: "summarizeStageWithLLM",
          error: message,
          outputPreview: [
            {
              label: "summary_error",
              value: message
            }
          ]
        }
      })
    )
  }

  return events
}

function shouldUseLlmSummary(stage: PlanningEvent["stage"]): boolean {
  return (
    stage === "execution-family-selection" ||
    stage === "liquidity-discovery" ||
    stage === "route-comparison" ||
    stage === "execution-package-construction" ||
    stage === "execution-package-comparison" ||
    stage === "path-quality-assessment" ||
    stage === "price-impact-assessment" ||
    stage === "mev-risk-assessment" ||
    stage === "submission-strategy" ||
    stage === "final-recommendation"
  )
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function truncatePreview(value: string, maxLength = 180): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function assessMevRisk(routes: RouteCandidate[], intent: StructuredIntent): MevRiskAssessment {
  const maxImpact = Math.max(...routes.map((route) => route.priceImpactPct))
  const fragmented = routes.some((route) => route.dexes.length >= 3)
  const preferPrivate = intent.preferences.preferPrivate === true
  const riskDrivers = [
    ...(fragmented ? ["route fragmentation"] : []),
    ...(maxImpact > 0.5 ? ["price impact sensitivity"] : []),
    ...(preferPrivate ? ["user prefers private or builder-friendly delivery"] : [])
  ]
  const level: MevRiskAssessment["level"] =
    preferPrivate || maxImpact > 1 || fragmented ? "high" : maxImpact > 0.3 ? "medium" : "low"

  return {
    level,
    summary:
      level === "high"
        ? "This is a normal swap, not an intent-matched execution, so public exposure can create extraction risk under BSC's builder-aware environment."
        : "The swap is still MEV-exposed on public paths, but the trade size and route fragmentation suggest a more moderate risk profile.",
    publicPathRisk:
      "A public path may make the quoted route look better than the realized execution if searchers can react before inclusion.",
    preferredSubmission: level === "high" ? "private-rpc" : "public-mempool",
    riskDrivers,
    preferredSubmissionFamily:
      level === "high" ? "private-rpc" : "public-mempool"
  }
}

function scoreRoutes(
  routes: RouteCandidate[],
  mevRiskAssessment: MevRiskAssessment,
  intent: StructuredIntent
): RouteCandidate[] {
  const bestQuoted = routes.reduce((best, candidate) => {
    const quoted = BigInt(candidate.quotedOut)
    return quoted > best ? quoted : best
  }, 0n)

  return routes
    .map((candidate) => {
      const quoteScore =
        bestQuoted > 0n
          ? Number((BigInt(candidate.quotedOut) * 10000n) / bestQuoted) / 10000
          : 0
      const impactPenalty = candidate.priceImpactPct * 0.2
      const stabilityBoost =
        candidate.expectedExecutionStability === "high"
          ? 0.1
          : candidate.expectedExecutionStability === "medium"
            ? 0.05
            : 0
      const mevPenalty =
        mevRiskAssessment.level === "high" && intent.preferences.preferPrivate !== false
          ? candidate.mevExposure === "high"
            ? 0.18
            : candidate.mevExposure === "medium"
              ? 0.08
              : 0.02
          : 0
      const coverageAdjustment =
        candidate.coverageConfidence === "high"
          ? 0.03
          : candidate.coverageConfidence === "medium"
            ? 0
            : -0.04
      return {
        ...candidate,
        score: quoteScore + stabilityBoost - impactPenalty - mevPenalty + coverageAdjustment
      }
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index) => ({
      ...candidate,
      rejectionReason:
        index === 0
          ? undefined
          : candidate.priceImpactPct > routes[0].priceImpactPct
            ? "Rejected due to higher price impact."
            : "Rejected because it did not beat the recommended route on execution quality."
    }))
}

function buildPriceImpactAssessment(routes: RouteCandidate[]): PriceImpactAssessment {
  if (routes.length === 0) {
    return {
      bestQuotedRouteId: null,
      lowestImpactRouteId: null,
      commentary: "No routes were available to compare."
    }
  }

  const bestQuoted = routes.reduce((best, candidate) =>
    BigInt(candidate.quotedOut) > BigInt(best.quotedOut) ? candidate : best
  )
  const lowestImpact = routes.reduce((best, candidate) =>
    candidate.priceImpactPct < best.priceImpactPct ? candidate : best
  )

  return {
    bestQuotedRouteId: bestQuoted.id,
    lowestImpactRouteId: lowestImpact.id,
    bestExecutionRouteId: lowestImpact.id,
    commentary:
      bestQuoted.id === lowestImpact.id
        ? "The best observed quote also has the lowest measured price impact, so observed quote quality and execution quality align."
        : "The best observed quote is not the lowest-impact route, so realized execution may favor a slightly weaker observed quote with more stable price impact."
  }
}

function buildDelegatedIntentPayload(input: {
  intent: StructuredIntent
  route: RouteCandidate
}): PayloadCandidate {
  return {
    id: `payload-intent-${input.route.id}`,
    type: "approval-plus-intent",
    platform: "CoW-style intent path",
    routeFamily: "solver-intent",
    to: "intent-server://cow-style",
    data: JSON.stringify({
      sellToken: input.intent.sellToken,
      buyToken: input.intent.buyToken,
      amount: input.intent.amount
    }),
    value: "0",
    minOutAmount: input.route.quotedOut,
    estimatedGas: "0",
    executionMode: "delegated-to-solver",
    approvalRequired: true,
    simulation: {
      ok: true,
      estimatedGas: "0",
      note: "Delegated intent handoff does not simulate as direct router calldata in the current stage."
    }
  }
}

function buildExecutionPackages(input: {
  intent: StructuredIntent
  routeCandidates: RouteCandidate[]
  payloadCandidates: PayloadCandidate[]
  submissionCandidates: import("@bsc-swap-agent-demo/shared").SubmissionCandidate[]
}): ExecutionPackage[] {
  const packages: ExecutionPackage[] = []

  for (const route of input.routeCandidates) {
    const payload = input.payloadCandidates.find(
      (candidate) =>
        candidate.platform === route.platform && candidate.routeFamily === route.routeFamily
    )
    if (!payload) continue

    for (const submission of input.submissionCandidates.filter((candidate) =>
      candidate.routeFamilies.includes(route.routeFamily)
    )) {
      packages.push({
        id: `${route.id}-${submission.submissionChannel}`,
        routeId: route.id,
        routeProvider: route.platform,
        routeFamily: route.routeFamily,
        payloadId: payload.id,
        payloadType: payload.type,
        submissionPath: submission.path,
        submissionChannel: submission.submissionChannel,
        submissionProvider: submission.providerName,
        executionMode: payload.executionMode,
        approvalRequired: payload.approvalRequired ?? false,
        approvalPolicy: payload.approvalRequired
          ? "User approval is required before delegated handoff."
          : "No extra approval beyond the direct transaction payload.",
        trustAssumptions: [submission.trustAssumption],
        plannerControlLevel: submission.plannerControlLevel,
        quoteQuality: route.priceImpactPct < 0.2 ? "high" : route.priceImpactPct < 0.7 ? "medium" : "low",
        realizedExecutionConfidence:
          submission.submissionChannel === "public-mempool" ? "medium" : "high",
        slippageStability: route.expectedExecutionStability,
        latencyExpectation: submission.expectedLatency,
        inclusionPathQuality: submission.expectedInclusionQuality,
        operationalSimplicity:
          payload.executionMode === "self-executed" ? "high" : "medium",
        approvalOverhead:
          payload.approvalRequired ? "medium" : "low",
        trustAssumptionCost:
          submission.plannerControlLevel === "informational" ? "high" : "medium",
        publicExposure: submission.attackSurface,
        delegationSuitability:
          payload.executionMode === "self-executed" ? "medium" : "high",
        score: scoreExecutionPackage(route, payload, submission),
        liveStatus: submission.liveStatus,
        rationale:
          payload.executionMode === "self-executed"
            ? `${submission.providerName} keeps the flow self-executed while changing path quality.`
            : `${submission.providerName} delegates settlement to an external executor and turns the user flow into approval plus intent handoff.`
      })
    }
  }

  const delegatedPayload = input.payloadCandidates.find((candidate) => candidate.type === "approval-plus-intent")
  const bestRoute = input.routeCandidates[0]
  const intentSubmission = input.submissionCandidates.find(
    (candidate) => candidate.submissionChannel === "centralized-intent-server"
  )
  if (delegatedPayload && bestRoute && intentSubmission) {
    packages.push({
      id: `cow-style-intent-${intentSubmission.submissionChannel}`,
      routeId: bestRoute.id,
      routeProvider: "CoW-style intent path",
      routeFamily: "solver-intent",
      payloadId: delegatedPayload.id,
      payloadType: delegatedPayload.type,
      submissionPath: intentSubmission.path,
      submissionChannel: intentSubmission.submissionChannel,
      submissionProvider: intentSubmission.providerName,
      executionMode: "delegated-to-solver",
      approvalRequired: true,
      approvalPolicy: "User must approve token spend and submit the delegated intent.",
      trustAssumptions: [intentSubmission.trustAssumption],
      plannerControlLevel: intentSubmission.plannerControlLevel,
      quoteQuality: "medium",
      realizedExecutionConfidence: "medium",
      slippageStability: "medium",
      latencyExpectation: intentSubmission.expectedLatency,
      inclusionPathQuality: intentSubmission.expectedInclusionQuality,
      operationalSimplicity: "medium",
      approvalOverhead: "medium",
      trustAssumptionCost: "high",
      publicExposure: "low",
      delegationSuitability: "high",
      score:
        scoreExecutionPackage(bestRoute, delegatedPayload, intentSubmission) + 0.04,
      liveStatus: intentSubmission.liveStatus,
      rationale:
        "This advisory package delegates execution to a solver and reduces public-path dependence, but it adds trust and approval overhead."
    })
  }

  return packages.sort((a, b) => b.score - a.score)
}

function scoreExecutionPackage(
  route: RouteCandidate,
  payload: PayloadCandidate,
  submission: import("@bsc-swap-agent-demo/shared").SubmissionCandidate
): number {
  const routeScore = route.score
  const privacyBoost =
    submission.expectedPrivacy === "high" ? 0.08 : submission.expectedPrivacy === "medium" ? 0.03 : -0.03
  const inclusionBoost =
    submission.expectedInclusionQuality === "high"
      ? 0.08
      : submission.expectedInclusionQuality === "medium"
        ? 0.03
        : -0.02
  const attackPenalty =
    submission.attackSurface === "high" ? 0.09 : submission.attackSurface === "medium" ? 0.04 : 0.01
  const approvalPenalty = payload.approvalRequired ? 0.03 : 0
  const trustPenalty =
    submission.plannerControlLevel === "informational"
      ? 0.05
      : submission.plannerControlLevel === "handoff"
        ? 0.02
        : 0
  return routeScore + privacyBoost + inclusionBoost - attackPenalty - approvalPenalty - trustPenalty
}

function buildExecutionBoundary(input: ExecutionPackage): ExecutionBoundary {
  if (input.executionMode === "self-executed") {
    return {
      plannerControls: [
        "intent parsing",
        "route ranking",
        "payload construction",
        "simulation",
        "guardrail recommendation"
      ],
      userSigns: ["transaction signature"],
      externalExecutorControls: [
        `${input.submissionProvider} delivery semantics`,
        "final block inclusion outcome"
      ]
    }
  }

  return {
    plannerControls: [
      "intent parsing",
      "execution package recommendation",
      "approval policy recommendation",
      "guardrail recommendation"
    ],
    userSigns: ["token approval", "intent submission or handoff authorization"],
    externalExecutorControls: [
      `${input.submissionProvider} settlement logic`,
      "solver or server-side execution outcome",
      "final block inclusion outcome"
    ]
  }
}

function applyVenueCoverage(
  routes: RouteCandidate[],
  venueCoverageSnapshot: import("@bsc-swap-agent-demo/shared").VenueCoverageSnapshot
): RouteCandidate[] {
  return routes.map((route) => {
    const routeMatches = route.dexes.filter((dex) =>
      venueCoverageSnapshot.topDexesObservedByDefiLlama.some(
        (topDex) => normalizeVenueName(topDex) === normalizeVenueName(dex.dexCode)
      )
    ).length

    const coverageConfidence = deriveCoverageConfidence({
      routeMatches,
      snapshotCoverageRatio: venueCoverageSnapshot.coverageRatio,
      intelligenceAvailable: venueCoverageSnapshot.topDexesObservedByDefiLlama.length > 0
    })

    return {
      ...route,
      coverageConfidence,
      coverageNotes: [
        ...(route.coverageNotes ?? []),
        route.providerNative
          ? `Quote provenance: native ${route.quoteSource} path via ${route.quoteMethod}.`
          : `Quote provenance: ${route.platform} is modeled through ${route.quoteSource} via ${route.quoteMethod}.`,
        venueCoverageSnapshot.missingHighShareVenues.length
          ? `High-share venues not clearly observed: ${venueCoverageSnapshot.missingHighShareVenues.slice(0, 3).join(", ")}.`
          : "Current observed set covers the main BSC venues surfaced by market intelligence."
      ]
    }
  })
}

function deriveCoverageConfidence(input: {
  routeMatches: number
  snapshotCoverageRatio: number
  intelligenceAvailable: boolean
}): CoverageConfidence {
  if (!input.intelligenceAvailable) {
    return "medium"
  }
  if (input.routeMatches >= 2 || (input.routeMatches >= 1 && input.snapshotCoverageRatio >= 0.6)) {
    return "high"
  }
  if (input.routeMatches >= 1 || input.snapshotCoverageRatio >= 0.35) {
    return "medium"
  }
  return "low"
}

function deriveBestObservedQuoteConfidence(
  routes: RouteCandidate[],
  priceImpactAssessment: PriceImpactAssessment
): CoverageConfidence {
  const bestQuotedRoute = routes.find((route) => route.id === priceImpactAssessment.bestQuotedRouteId)
  return bestQuotedRoute?.coverageConfidence ?? "medium"
}

function buildLiquiditySnapshot(input: {
  sellToken: TokenRef
  buyToken: TokenRef
  routes: RouteCandidate[]
}): LiquiditySnapshot {
  const venueShares = new Map<string, number>()
  for (const route of input.routes) {
    for (const venue of route.dexes) {
      venueShares.set(venue.dexCode, (venueShares.get(venue.dexCode) ?? 0) + venue.shareBps)
    }
  }

  return {
    sellToken: input.sellToken.symbol,
    buyToken: input.buyToken.symbol,
    totalCandidateCount: input.routes.length,
    dominantVenues: Array.from(venueShares.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dexCode, shareBps]) => ({ dexCode, shareBps })),
    note: "Liquidity snapshot is derived from live aggregator route responses. It is a planning view, not a guaranteed execution view."
  }
}

async function resolveRequiredToken(
  registry: CapabilityRegistry,
  symbol: string,
  network: SkillContext["network"]
): Promise<TokenRef> {
  const token = await registry.chain.resolveToken(symbol, network)
  if (!token) {
    throw new Error(`Could not resolve token '${symbol}' on ${network}.`)
  }
  return token
}

function traceTokenInputs(sellToken: string, buyToken: string, amount: string) {
  return [
    { label: "sell_token", value: sellToken },
    { label: "buy_token", value: buyToken },
    { label: "amount", value: amount }
  ]
}

function summarizeDexes(candidates: RouteCandidate[]) {
  const dexCount = new Map<string, number>()
  for (const candidate of candidates) {
    for (const dex of candidate.dexes) {
      dexCount.set(dex.dexCode, (dexCount.get(dex.dexCode) ?? 0) + dex.shareBps)
    }
  }

  return Array.from(dexCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dexCode]) => dexCode)
    .join(", ")
}

function collectObservedDexes(routes: RouteCandidate[]): string[] {
  return [...new Set(routes.flatMap((route) => route.dexes.map((dex) => dex.dexCode)))]
}

function normalizeVenueName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^pancakeswap/, "pancake")
    .replace(/^pancake/, "pancake")
    .replace(/^thenafusion/, "thena")
    .replace(/^woofiv\d+/i, "woofi")
    .replace(/^woofi/, "woofi")
    .replace(/^uniswapv\d+/i, "uniswap")
    .replace(/^uniswap/, "uniswap")
}
