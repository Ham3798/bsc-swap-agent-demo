import type {
  Guardrail,
  IntentSubmissionRequest,
  JitRouterRequest,
  JitRouterRequestCandidate,
  Network,
  PayloadCandidate,
  PlanningResult,
  PrivateSubmissionRequest,
  PublicTransactionRequest,
  StructuredIntent
} from "@bsc-swap-agent-demo/shared"
import { computeJitCandidateSetHash, getJitRouterAddress, JIT_ADAPTER_IDS } from "./jit-router"

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
  preferredChannel?: "validator" | "builder" | "both"
}): PrivateSubmissionRequest {
  const preferredChannel =
    input.preferredChannel ??
    (input.submissionFamily === "builder-aware-broadcast" ? "builder" : "validator")
  const recommendedTargetCount =
    preferredChannel === "both" ? 4 : preferredChannel === "builder" ? 3 : 2
  const channelFlag = preferredChannel === "builder" ? "builder" : preferredChannel === "both" ? "both" : "validator"
  const cliCommand = `bun run submit:private -- <SIGNED_RAW_TX> --channel ${channelFlag} --max-endpoints ${recommendedTargetCount}`
  return {
    mode: "private-rpc",
    network: input.network,
    routeId: input.routeId,
    payloadId: input.payloadId,
    submissionFamily: input.submissionFamily,
    providerName: input.providerName,
    liveStatus: "live",
    preferredChannel,
    method: "eth_sendRawTransaction",
    endpointType:
      preferredChannel === "both"
        ? "mixed"
        : input.submissionFamily === "builder-aware-broadcast"
          ? "builder-relay"
          : "validator-mev-rpc",
    recommendedTargetCount,
    whyChosen: "Recommended when a builder-friendly private path improves execution quality for a self-executed swap.",
    requiredCapabilities: [
      "signed raw transaction",
      "private-rpc access",
      "builder-friendly delivery metadata",
      "guardrail enforcement"
    ],
    userAction: `Sign the payload locally, then submit the raw transaction through ${channelFlag} private delivery.`,
    cliCommand,
    note:
      "Signed raw transaction handoff is supported through registry-backed private endpoints. The planner prepares the payload, but the user still signs locally before private delivery.",
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

export function buildJitRouterRequest(input: {
  network: Network
  walletAddress: string
  sellTokenAddress?: `0x${string}`
  buyTokenAddress: `0x${string}`
  amountIn?: string
  maxBlockNumber?: string
  candidates: Array<{
    routeId: string
    payload: PayloadCandidate
  }>
  guardrails?: Guardrail[]
}): JitRouterRequest | undefined {
  if (!input.sellTokenAddress || !input.amountIn || !input.maxBlockNumber) {
    return undefined
  }
  const validCandidates = input.candidates
    .filter((candidate) => isHexAddress(candidate.payload.to))
    .map((candidate) => ({
      routeId: candidate.routeId,
      payload: candidate.payload,
      adapterId: resolveJitAdapterId(candidate.routeId)
    }))
    .filter(
      (candidate): candidate is { routeId: string; payload: PayloadCandidate; adapterId: number } =>
        candidate.adapterId != null
    )

  if (validCandidates.length !== 3) {
    return undefined
  }

  const candidates: JitRouterRequestCandidate[] = validCandidates.map((candidate) => ({
    routeId: candidate.routeId,
    payloadId: candidate.payload.id,
    adapterId: candidate.adapterId,
    router: candidate.payload.to,
    callData: candidate.payload.data,
    value: candidate.payload.value,
    minOutAmount: candidate.payload.minOutAmount
  }))
  const routerAddress = getJitRouterAddress(input.network)
  if (!routerAddress) {
    return undefined
  }
  const candidateSetHash = computeJitCandidateSetHash(
    candidates.map((candidate) => ({
      adapterId: candidate.adapterId,
      router: candidate.router as `0x${string}`,
      value: candidate.value,
      data: candidate.callData as `0x${string}`
    }))
  )

  return {
    mode: "jit-router",
    network: input.network,
    routerAddress,
    payloadType: "jit-router-calldata",
    order: {
      user: input.walletAddress,
      recipient: input.walletAddress,
      tokenIn: input.sellTokenAddress,
      tokenOut: input.buyTokenAddress,
      amountIn: input.amountIn,
      minOutAmount: validCandidates[0]?.payload.minOutAmount ?? "0",
      maxBlockNumber: input.maxBlockNumber,
      nonce: "0",
      candidateSetHash
    },
    approvalSpender: routerAddress,
    candidates,
    note: "Secure JIT v2.1 payload skeleton with signed-order authorization."
  }
}

export function attachSubmissionRequests(input: {
  network: Network
  walletAddress?: string
  buyTokenAddress?: `0x${string}`
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

  const preferredPrivateCandidate = pickPreferredPrivateCandidate(input.result, payload.routeFamily)
  const privateSubmitRequest =
    payload.executionMode === "self-executed" && preferredPrivateCandidate
      ? buildPrivateSubmissionRequest({
          network: input.network,
          routeId: input.result.recommendedPlan.routeId,
          payloadId: payload.id,
          providerName: preferredPrivateCandidate.providerName,
          submissionFamily: preferredPrivateCandidate.submissionChannel as "private-rpc" | "builder-aware-broadcast",
          preferredChannel:
            preferredPrivateCandidate.submissionChannel === "builder-aware-broadcast" ? "builder" : "validator",
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

  const jitCandidates =
    input.walletAddress && input.buyTokenAddress
      ? input.result.routeExecutionReadiness
          .filter((candidate) => candidate.payloadReady && candidate.simulationOk)
          .slice(0, 3)
          .map((candidate) => ({
            routeId: candidate.routeId,
            payload: input.result.payloadCandidates.find((payloadCandidate) => payloadCandidate.id === candidate.routeId) ??
              input.result.payloadCandidates.find(
                (payloadCandidate) =>
                  payloadCandidate.platform ===
                    input.result.routeCandidates.find((route) => route.id === candidate.routeId)?.platform &&
                  payloadCandidate.routeFamily ===
                    input.result.routeCandidates.find((route) => route.id === candidate.routeId)?.routeFamily
              )
          }))
          .filter((candidate): candidate is { routeId: string; payload: PayloadCandidate } => Boolean(candidate.payload))
      : []

  const jitRouterRequest =
    input.walletAddress && input.buyTokenAddress
      ? buildJitRouterRequest({
          network: input.network,
          walletAddress: input.walletAddress,
          sellTokenAddress: undefined,
          buyTokenAddress: input.buyTokenAddress,
          amountIn: undefined,
          maxBlockNumber: undefined,
          candidates: jitCandidates,
          guardrails: input.result.guardrails
        })
      : undefined

  const recommendedHandoff =
    payload.executionMode !== "self-executed"
      ? "none"
      : privateSubmitRequest
        ? privateSubmitRequest.submissionFamily === "builder-aware-broadcast"
          ? "builder-broadcast-handoff"
          : "private-rpc-handoff"
        : publicSubmitRequest
          ? "public-wallet"
          : "none"

  return {
    ...input.result,
    publicSubmitRequest,
    privateSubmitRequest,
    intentSubmitRequest,
    jitRouterRequest,
    recommendedHandoff
  }
}

function resolveJitAdapterId(routeId: string): number | undefined {
  if (routeId in JIT_ADAPTER_IDS) {
    return JIT_ADAPTER_IDS[routeId as keyof typeof JIT_ADAPTER_IDS]
  }
  return undefined
}

function pickPreferredPrivateCandidate(result: PlanningResult, routeFamily: PayloadCandidate["routeFamily"]) {
  const candidates = result.submissionCandidates.filter(
    (candidate) =>
      candidate.availability === "live" &&
      candidate.routeFamilies.includes(routeFamily) &&
      (candidate.submissionChannel === "private-rpc" || candidate.submissionChannel === "builder-aware-broadcast")
  )
  return (
    candidates.find((candidate) => candidate.submissionChannel === "builder-aware-broadcast") ??
    candidates.find((candidate) => candidate.recommended) ??
    candidates[0]
  )
}

function extractDeadlineSeconds(value: string): number | undefined {
  const match = value.match(/([0-9]+)\s*seconds?/i)
  return match ? Number(match[1]) : undefined
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}
