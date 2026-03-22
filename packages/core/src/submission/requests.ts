import type {
  Guardrail,
  IntentSubmissionRequest,
  Network,
  PayloadCandidate,
  PlanningResult,
  PrivateSubmissionRequest,
  PublicTransactionRequest,
  StructuredIntent
} from "@bsc-swap-agent-demo/shared"

const CHAIN_IDS: Record<Network, number> = {
  bsc: 56,
  "bsc-testnet": 97
}

export function buildPublicTransactionRequest(input: {
  network: Network
  walletAddress?: string
  payload: PayloadCandidate
  guardrails?: Guardrail[]
  slippageBps?: number
}): PublicTransactionRequest {
  const deadlineGuardrail = input.guardrails?.find((guardrail) => guardrail.name === "deadline")
  const deadlineSeconds = deadlineGuardrail ? extractDeadlineSeconds(deadlineGuardrail.value) : undefined
  return {
    chainId: CHAIN_IDS[input.network],
    from: input.walletAddress,
    to: input.payload.to,
    data: input.payload.data,
    value: input.payload.value,
    gas: input.payload.simulation.estimatedGas || input.payload.estimatedGas,
    path: "public-mempool",
    minOutAmount: input.payload.minOutAmount,
    slippageBps: input.slippageBps,
    deadlineSeconds,
    rationale: "Unsigned public mempool request for browser-wallet handoff."
  }
}

export function buildPrivateSubmissionRequest(input: {
  network: Network
  routeId: string
  payloadId: string
  providerName: string
  submissionFamily: "private-rpc" | "builder-aware-broadcast"
  guardrails: Guardrail[]
}): PrivateSubmissionRequest {
  return {
    mode: "private-rpc",
    network: input.network,
    routeId: input.routeId,
    payloadId: input.payloadId,
    submissionFamily: input.submissionFamily,
    providerName: input.providerName,
    liveStatus: "advisory",
    method: "eth_sendRawTransaction",
    endpointType:
      input.submissionFamily === "builder-aware-broadcast" ? "builder-relay" : "validator-mev-rpc",
    recommendedTargetCount: input.submissionFamily === "builder-aware-broadcast" ? 3 : 1,
    whyChosen: "Recommended when a builder-friendly private path improves execution quality for a self-executed swap.",
    requiredCapabilities: [
      "signed raw transaction",
      "private-rpc access",
      "builder-friendly delivery metadata",
      "guardrail enforcement"
    ],
    note:
      "Signed raw transaction handoff is supported through registry-backed private endpoints, but planner-side direct signing and wallet relay integration are still pending.",
    guardrails: input.guardrails
  }
}

export function buildIntentSubmissionRequest(input: {
  network: Network
  intent: StructuredIntent
  routeId: string
  payloadType: PayloadCandidate["type"]
}): IntentSubmissionRequest {
  return {
    mode: "intent-api",
    network: input.network,
    intent: input.intent,
    routeId: input.routeId,
    payloadType: input.payloadType,
    providerName: "CoW-style intent server",
    handoffReason: "Delegated execution can be cleaner when solver-side settlement is preferable to direct public or private broadcast.",
    safetyRequirements: [
      "token approval policy",
      "intent expiration",
      "quote freshness",
      "external solver trust assumptions"
    ],
    note: "Intent-style handoff reserved for a later backend signing and relay stage."
  }
}

export function attachSubmissionRequests(input: {
  network: Network
  walletAddress?: string
  result: PlanningResult
}): PlanningResult {
  const payload = input.result.payloadCandidates.find(
    (candidate) => candidate.id === input.result.recommendedPlan.payloadId
  )
  if (!payload) {
    return input.result
  }

  const publicSubmitRequest =
    input.result.recommendedPlan.executionMode === "self-executed" && payload.type === "router-calldata"
      ? buildPublicTransactionRequest({
          network: input.network,
          walletAddress: input.walletAddress,
          payload,
          guardrails: input.result.guardrails,
          slippageBps: input.result.effectiveSlippageBps
        })
      : undefined

  const privateSubmitRequest =
    input.result.recommendedPlan.submissionChannel === "private-rpc" ||
    input.result.recommendedPlan.submissionChannel === "builder-aware-broadcast"
      ? buildPrivateSubmissionRequest({
          network: input.network,
          routeId: input.result.recommendedPlan.routeId,
          payloadId: payload.id,
          providerName: input.result.recommendedPlan.submissionProvider,
          submissionFamily: input.result.recommendedPlan.submissionChannel as "private-rpc" | "builder-aware-broadcast",
          guardrails: input.result.guardrails
        })
      : undefined

  const intentSubmitRequest =
    input.result.recommendedPlan.submissionChannel === "centralized-intent-server" ||
    payload.type === "approval-plus-intent"
      ? buildIntentSubmissionRequest({
          network: input.network,
          intent: input.result.intent,
          routeId: input.result.recommendedPlan.routeId,
          payloadType: payload.type
        })
      : undefined

  return {
    ...input.result,
    publicSubmitRequest,
    privateSubmitRequest,
    intentSubmitRequest
  }
}

function extractDeadlineSeconds(value: string): number | undefined {
  const match = value.match(/([0-9]+)\s*seconds?/i)
  return match ? Number(match[1]) : undefined
}
