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
}): PublicTransactionRequest {
  return {
    chainId: CHAIN_IDS[input.network],
    from: input.walletAddress,
    to: input.payload.to,
    data: input.payload.data,
    value: input.payload.value,
    gas: input.payload.simulation.estimatedGas || input.payload.estimatedGas,
    rationale: "Unsigned public mempool request for browser-wallet handoff."
  }
}

export function buildPrivateSubmissionRequest(input: {
  network: Network
  routeId: string
  payloadId: string
  guardrails: Guardrail[]
}): PrivateSubmissionRequest {
  return {
    mode: "private-rpc",
    network: input.network,
    routeId: input.routeId,
    payloadId: input.payloadId,
    note: "Advisory private submission handoff for a future relayer-backed stage.",
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

  return {
    ...input.result,
    publicSubmitRequest: buildPublicTransactionRequest({
      network: input.network,
      walletAddress: input.walletAddress,
      payload
    }),
    privateSubmitRequest: buildPrivateSubmissionRequest({
      network: input.network,
      routeId: input.result.recommendedPlan.routeId,
      payloadId: payload.id,
      guardrails: input.result.guardrails
    }),
    intentSubmitRequest: buildIntentSubmissionRequest({
      network: input.network,
      intent: input.result.intent,
      routeId: input.result.recommendedPlan.routeId,
      payloadType: payload.type
    })
  }
}
