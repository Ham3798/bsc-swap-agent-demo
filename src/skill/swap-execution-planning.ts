import OpenAI from "openai"

import { buildGuardrails } from "../policy/guardrails"
import type {
  AlternativeRejected,
  CapabilityLayer,
  FollowUpResponse,
  MevRiskAssessment,
  MissingFieldResolution,
  PayloadCandidate,
  PlanningResult,
  PriceImpactAssessment,
  RouteCandidate,
  SkillContext,
  SkillResponse,
  StructuredIntent,
  SubmissionCandidate,
  TokenRef,
  UnknownField
} from "../types"

const DEFAULT_ACCOUNT = "0x000000000000000000000000000000000000dEaD"

interface PlanningState {
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
}

export async function runSwapExecutionPlanningSkill(input: {
  rawInput: string
  context: SkillContext
  capabilities: CapabilityLayer
  state?: PlanningState
}): Promise<SkillResponse> {
  const intent = input.state?.intent ?? (await extractIntent(input.rawInput))
  const state: PlanningState = {
    intent,
    missingFieldsResolved: input.state?.missingFieldsResolved ?? []
  }

  const followUp = await maybeBuildFollowUp({
    state,
    rawInput: input.rawInput,
    context: input.context,
    capabilities: input.capabilities
  })
  if (followUp) {
    return followUp
  }

  const slippageBps = state.intent.slippageBps ?? 50
  const sellToken = await resolveRequiredToken(input.capabilities, state.intent.sellToken!, input.context.network)
  const buyToken = await resolveRequiredToken(input.capabilities, state.intent.buyToken!, input.context.network)

  const routeCandidatesRaw = await input.capabilities.getQuoteCandidates({
    network: input.context.network,
    sellToken,
    buyToken,
    amount: state.intent.amount!,
    slippageBps
  })

  if (routeCandidatesRaw.length < 2) {
    throw new Error("Need at least two route candidates to explain best execution tradeoffs.")
  }

  const mevRiskAssessment = assessMevRisk(routeCandidatesRaw, state.intent)
  const routeCandidates = scoreRoutes(routeCandidatesRaw, mevRiskAssessment, state.intent)
  const recommendedRoute = routeCandidates[0]

  const payloadCandidates: PayloadCandidate[] = []
  for (const [index, candidate] of routeCandidates.slice(0, 2).entries()) {
    const encoded = await input.capabilities.encodeRouterCalldata({
      network: input.context.network,
      platform: candidate.platform,
      sellToken,
      buyToken,
      amount: state.intent.amount!,
      slippageBps,
      account: input.context.walletAddress || DEFAULT_ACCOUNT
    })
    const simulation = await input.capabilities.simulateTransaction({
      network: input.context.network,
      to: encoded.to,
      data: encoded.data,
      value: encoded.value
    })
    const payload = {
      id: `payload-${index + 1}-${candidate.id}`,
      type: "router-calldata",
      ...encoded,
      simulation: simulation.ok
        ? simulation
        : {
            ...simulation,
            estimatedGas: encoded.estimatedGas,
            note: `${simulation.note} Falling back to aggregator estimated gas for planning only.`
          }
    } satisfies PayloadCandidate
    payloadCandidates.push(payload)
  }

  const payload = payloadCandidates[0]
  const submissionCandidates = await input.capabilities.getSubmissionPaths({
    network: input.context.network,
    mevRiskLevel: mevRiskAssessment.level,
    preferPrivate: state.intent.preferences.preferPrivate
  })
  const recommendedSubmission =
    submissionCandidates.find((candidate) => candidate.recommended) ?? submissionCandidates[0]

  const priceImpactAssessment = buildPriceImpactAssessment(routeCandidatesRaw)
  const liquiditySnapshot = buildLiquiditySnapshot({
    sellToken,
    buyToken,
    routes: routeCandidatesRaw
  })
  const guardrails = buildGuardrails({
    intent: state.intent,
    route: recommendedRoute,
    payload,
    mevRisk: mevRiskAssessment
  })
  const alternativesRejected = routeCandidates
    .slice(1)
    .map((candidate) => ({
      routeId: candidate.id,
      reason:
        candidate.rejectionReason ||
        "Rejected because it underperformed on execution quality relative to the recommended route."
    }))
    .filter(Boolean) as AlternativeRejected[]

  const result: PlanningResult = {
    intent: state.intent,
    missingFieldsResolved: state.missingFieldsResolved,
    liquiditySnapshot,
    routeCandidates,
    priceImpactAssessment,
    mevRiskAssessment,
    payloadCandidates,
    submissionCandidates,
    guardrails,
    recommendedPlan: {
      routeId: recommendedRoute.id,
      payloadId: payload.id,
      submissionPath: recommendedSubmission.path,
      expectedOut: recommendedRoute.quotedOutFormatted,
      summary:
        `Recommended ${recommendedRoute.platform} because it offers the strongest execution-quality score, not just the highest nominal quote. ` +
        `The route balances output, impact (${recommendedRoute.priceImpactPct.toFixed(3)}%), and MEV-aware submission preferences.`,
      riskNote:
        recommendedSubmission.path === "public-mempool"
          ? "Public submission keeps availability high but exposes the swap to extraction risk."
          : "Private or builder-aware paths are still advisory in this MVP, but they better match the MEV sensitivity of the swap.",
      policyNote:
        "Simulation, slippage bounds, deadline, and stale-quote checks remain mandatory before any live submission."
    },
    alternativesRejected
  }

  return { kind: "plan", result }
}

export function hydratePlanningState(
  response: FollowUpResponse,
  userAnswer: string
): PlanningState {
  const amountMatch = userAnswer.match(/(\d+(?:\.\d+)?)/)
  if (!amountMatch) {
    return {
      intent: response.intent,
      missingFieldsResolved: response.missingFieldsResolved
    }
  }
  const amount = amountMatch[1]
  const intent: StructuredIntent = {
    ...response.intent,
    amount,
    unknowns: response.intent.unknowns.filter((item) => item !== "amount")
  }
  const missingFieldsResolved = [
    ...response.missingFieldsResolved,
    {
      field: "amount",
      value: amount,
      source: "user"
    } satisfies MissingFieldResolution
  ]
  return { intent, missingFieldsResolved }
}

async function maybeBuildFollowUp(input: {
  state: PlanningState
  rawInput: string
  context: SkillContext
  capabilities: CapabilityLayer
}): Promise<FollowUpResponse | null> {
  const unknowns = new Set<UnknownField>(input.state.intent.unknowns)
  if (!unknowns.has("amount")) {
    return null
  }

  let balanceContext = ""
  if (input.context.walletAddress && input.state.intent.sellToken) {
    const sellToken = await input.capabilities.resolveToken(
      input.state.intent.sellToken,
      input.context.network
    )
    if (sellToken) {
      try {
        if (sellToken.isNative) {
          const balance = await input.capabilities.getNativeBalance(
            input.context.walletAddress,
            input.context.network
          )
          balanceContext = `You currently hold ${balance.formatted} ${sellToken.symbol}. `
        } else {
          const balance = await input.capabilities.getErc20Balance(
            sellToken.address,
            input.context.walletAddress,
            input.context.network
          )
          balanceContext = `You currently hold ${balance.formatted} ${sellToken.symbol}. `
        }
      } catch {
        balanceContext = ""
      }
    }
  }

  return {
    kind: "follow-up",
    intent: input.state.intent,
    missingFieldsResolved: input.state.missingFieldsResolved,
    question: `${balanceContext}How much ${input.state.intent.sellToken ?? "of the sell token"} would you like to swap?`
  }
}

async function extractIntent(rawInput: string): Promise<StructuredIntent> {
  const llm = await extractIntentWithOpenAI(rawInput)
  if (llm) {
    return llm
  }
  return extractIntentWithRules(rawInput)
}

async function extractIntentWithOpenAI(rawInput: string): Promise<StructuredIntent | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"
  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract swap intent from user input. Return JSON only with fields: action, sellToken, buyToken, amount, slippageBps, preferences {preferPrivate, preferFast, avoidStale}, unknowns."
      },
      {
        role: "user",
        content: rawInput
      }
    ]
  })
  const content = response.choices[0]?.message?.content
  if (!content) {
    return null
  }
  try {
    const parsed = JSON.parse(content) as {
      action?: string
      sellToken?: string | null
      buyToken?: string | null
      amount?: string | null
      slippageBps?: number | null
      preferences?: {
        preferPrivate?: boolean | null
        preferFast?: boolean | null
        avoidStale?: boolean | null
      }
      unknowns?: UnknownField[]
    }
    return normalizeIntent(parsed)
  } catch {
    return null
  }
}

function extractIntentWithRules(rawInput: string): StructuredIntent {
  const lower = rawInput.toLowerCase()
  const regex =
    /swap\s+(?:(\d+(?:\.\d+)?)\s+)?([a-z0-9]{2,12})\s+(?:to|for)\s+([a-z0-9]{2,12})/i
  const match = rawInput.match(regex)

  const amount = match?.[1] ?? null
  const sellToken = match?.[2]?.toUpperCase() ?? null
  const buyToken = match?.[3]?.toUpperCase() ?? null
  const unknowns: UnknownField[] = []

  if (!sellToken) unknowns.push("sell_token")
  if (!buyToken) unknowns.push("buy_token")
  if (!amount) unknowns.push("amount")

  let slippageBps: number | null = null
  const slippageMatch = rawInput.match(/(\d+(?:\.\d+)?)\s*%/)
  if (slippageMatch) {
    slippageBps = Math.round(Number(slippageMatch[1]) * 100)
  }

  return {
    action: lower.includes("swap") || lower.includes("바꿔") ? "swap" : "unknown",
    sellToken,
    buyToken,
    amount,
    slippageBps,
    preferences: {
      preferPrivate: lower.includes("private") || lower.includes("mev"),
      preferFast: lower.includes("fast"),
      avoidStale: lower.includes("stale")
    },
    unknowns
  }
}

function normalizeIntent(parsed: {
  action?: string
  sellToken?: string | null
  buyToken?: string | null
  amount?: string | null
  slippageBps?: number | null
  preferences?: {
    preferPrivate?: boolean | null
    preferFast?: boolean | null
    avoidStale?: boolean | null
  }
  unknowns?: UnknownField[]
}): StructuredIntent {
  const unknowns = new Set<UnknownField>(parsed.unknowns ?? [])
  if (!parsed.sellToken) unknowns.add("sell_token")
  if (!parsed.buyToken) unknowns.add("buy_token")
  if (!parsed.amount) unknowns.add("amount")
  return {
    action: parsed.action === "swap" ? "swap" : "unknown",
    sellToken: parsed.sellToken?.toUpperCase() ?? null,
    buyToken: parsed.buyToken?.toUpperCase() ?? null,
    amount: parsed.amount ?? null,
    slippageBps: parsed.slippageBps ?? null,
    preferences: {
      preferPrivate: parsed.preferences?.preferPrivate ?? null,
      preferFast: parsed.preferences?.preferFast ?? null,
      avoidStale: parsed.preferences?.avoidStale ?? null
    },
    unknowns: Array.from(unknowns)
  }
}

function assessMevRisk(routes: RouteCandidate[], intent: StructuredIntent): MevRiskAssessment {
  const maxImpact = Math.max(...routes.map((route) => route.priceImpactPct))
  const fragmented = routes.some((route) => route.dexes.length >= 3)
  const preferPrivate = intent.preferences.preferPrivate === true
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
    preferredSubmission: level === "high" ? "private-rpc" : "public-mempool"
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
      const score = quoteScore + stabilityBoost - impactPenalty - mevPenalty
      return {
        ...candidate,
        score
      }
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index, arr) => ({
      ...candidate,
      rejectionReason:
        index === 0
          ? undefined
          : buildRejectionReason(candidate, arr[0])
    }))
}

function buildRejectionReason(candidate: RouteCandidate, winner: RouteCandidate): string {
  const parts = []
  if (BigInt(candidate.quotedOut) > BigInt(winner.quotedOut)) {
    parts.push("higher nominal quote but weaker realized execution profile")
  }
  if (candidate.priceImpactPct > winner.priceImpactPct) {
    parts.push("higher price impact")
  }
  if (stabilityRank(candidate.expectedExecutionStability) < stabilityRank(winner.expectedExecutionStability)) {
    parts.push("lower execution stability")
  }
  if (mevRank(candidate.mevExposure) > mevRank(winner.mevExposure)) {
    parts.push("higher MEV exposure")
  }
  return parts.length
    ? `Rejected due to ${parts.join(", ")}.`
    : "Rejected because the overall execution-quality score was lower."
}

function buildPriceImpactAssessment(routes: RouteCandidate[]): PriceImpactAssessment {
  const bestQuoted = routes.reduce((best, current) =>
    BigInt(current.quotedOut) > BigInt(best.quotedOut) ? current : best
  )
  const lowestImpact = routes.reduce((best, current) =>
    current.priceImpactPct < best.priceImpactPct ? current : best
  )
  return {
    bestQuotedRouteId: bestQuoted.id,
    lowestImpactRouteId: lowestImpact.id,
    commentary:
      bestQuoted.id === lowestImpact.id
        ? "The best quote and lowest-impact route are aligned for this input size."
        : "The best quote is not the lowest-impact route, so realized execution may favor a slightly weaker quote with more stable price impact."
  }
}

function stabilityRank(value: RouteCandidate["expectedExecutionStability"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1
}

function mevRank(value: RouteCandidate["mevExposure"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1
}

function buildLiquiditySnapshot(input: {
  sellToken: TokenRef
  buyToken: TokenRef
  routes: RouteCandidate[]
}) {
  const dominant = new Map<string, number>()
  for (const route of input.routes) {
    for (const dex of route.dexes) {
      dominant.set(dex.dexCode, (dominant.get(dex.dexCode) ?? 0) + dex.shareBps)
    }
  }
  const dominantVenues = Array.from(dominant.entries())
    .map(([dexCode, shareBps]) => ({ dexCode, shareBps }))
    .sort((a, b) => b.shareBps - a.shareBps)
    .slice(0, 5)

  return {
    sellToken: input.sellToken.symbol,
    buyToken: input.buyToken.symbol,
    totalCandidateCount: input.routes.length,
    dominantVenues,
    note:
      "Liquidity snapshot is derived from live aggregator route responses. It is a planning view, not a guaranteed execution view."
  }
}

async function resolveRequiredToken(
  capabilities: CapabilityLayer,
  symbol: string,
  network: SkillContext["network"]
): Promise<TokenRef> {
  const token = await capabilities.resolveToken(symbol, network)
  if (!token) {
    throw new Error(`Unable to resolve token ${symbol}`)
  }
  return token
}
