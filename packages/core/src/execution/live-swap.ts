import { performance } from "node:perf_hooks"
import {
  type TypedDataDomain,
  type TypedDataParameter,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  type Address,
  type Hex
} from "viem"
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts"
import { bsc, bscTestnet } from "viem/chains"

import type {
  ExecutionAudit,
  JitRouterRequest,
  Network,
  PayloadCandidate,
  PlanningResult,
  SwapExecutionFeedback,
  SwapExecutionPhaseSummary,
  SwapExecutionSummary,
  SwapExecutionSubmissionSummary,
  TokenRef
} from "@bsc-swap-agent-demo/shared"

import type { CapabilityRegistry } from "../capabilities/types"
import { auditExecution, broadcastPrivateRawTransaction } from "../submission/private-execution"
import { loadPrivateSubmissionRegistry, selectRegistryEndpoints } from "../submission/private-registry"
import {
  buildJitOrderTypedData,
  computeJitCandidateSetHash,
  encodeJitRouterExecute,
  getJitRouterAddress,
  getJitRouterNonce,
  JIT_ADAPTER_IDS
} from "../submission/jit-router"

const DEFAULT_BUILDER_TARGETS = 3
const DEFAULT_RECEIPT_BLOCK_WINDOW = 2n
const DEFAULT_RECEIPT_WAIT_MS = 12_000
const POLL_INTERVAL_MS = 900
const BNB_NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

const ALLOWED_JIT_PLATFORMS = ["openoceanv2", "1inch", "pancakeswap"] as const

export async function executePlannedPrivateSwap(input: {
  result: PlanningResult
  network: Network
  registry: CapabilityRegistry
  walletAddress?: string
  maxEndpoints?: number
  onTrace?: (line: string) => void
}): Promise<SwapExecutionSummary> {
  const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY)
  if (!privateKey) {
    throw new Error("Missing PRIVATE_KEY.")
  }

  const account = privateKeyToAccount(privateKey)
  const expectedWallet = getAddress(input.walletAddress ?? process.env.DEMO_WALLET_ADDRESS ?? account.address)
  if (account.address.toLowerCase() !== expectedWallet.toLowerCase()) {
    throw new Error(`PRIVATE_KEY address ${account.address} does not match DEMO_WALLET_ADDRESS ${expectedWallet}.`)
  }

  const client = createRpcClient(input.network)
  const walletClient = createWalletClient({
    account,
    chain: input.network === "bsc" ? bsc : bscTestnet,
    transport: http(resolveRpcUrl(input.network))
  })

  const sellToken = await resolveExecutionToken(input.registry, input.result.intent.sellToken ?? "", input.network)
  const buyToken = await resolveExecutionToken(input.registry, input.result.intent.buyToken ?? "", input.network)
  const amountIn = await resolveAmountIn({
    registry: input.registry,
    network: input.network,
    walletAddress: account.address,
    sellToken,
    requestedAmount: input.result.intent.amount ?? ""
  })
  const selectedPayload =
    input.result.payloadCandidates.find((candidate) => candidate.id === input.result.recommendedPlan.payloadId) ??
    input.result.payloadCandidates[0]

  if (!selectedPayload || selectedPayload.executionMode !== "self-executed") {
    return {
      mode: "live",
      recommendedHandoff: "none",
      signed: false,
      submitted: false,
      skippedReason: "No self-executed payload is available for live private execution."
    }
  }

  const jitRequest =
    input.result.executionRecommendationMode === "jit-best-of-3"
      ? await buildLiveJitRequest({
          result: input.result,
          registry: input.registry,
          network: input.network,
          walletAddress: account.address,
          sellToken,
          buyToken,
          amountIn,
          client
        })
      : undefined

  const registry = await loadPrivateSubmissionRegistry()
  const maxEndpoints = input.maxEndpoints ?? Number(process.env.PRIVATE_SUBMIT_MAX_ENDPOINTS ?? DEFAULT_BUILDER_TARGETS)
  const builderEndpoints = selectRegistryEndpoints(registry, "builder-relay", Number.isFinite(maxEndpoints) ? maxEndpoints : DEFAULT_BUILDER_TARGETS)
  input.onTrace?.(`delivery path selected builder-private`)
  input.onTrace?.(`builder targets ${builderEndpoints.length} from registry`)
  if (!builderEndpoints.length) {
    return {
      mode: "live",
      recommendedHandoff: "none",
      signed: false,
      submitted: false,
      skippedReason: "No builder relay endpoints are available in bsc-mev-info."
    }
  }

  let executionVariant: "jit-v21" | "direct-router" = "direct-router"
  let approvalSpender = selectedPayload.to
  let swapTx: { to: Address; data: Hex; value: bigint }
  let expectedQuoteOut = selectedPayload.minOutAmount
  let protectedMinOut = selectedPayload.minOutAmount
  let armedCandidateRouteIds: string[] | undefined

  if (jitRequest) {
    executionVariant = "jit-v21"
    approvalSpender = jitRequest.approvalSpender
    armedCandidateRouteIds = jitRequest.candidates.map((candidate) => candidate.routeId)
    const signature = await walletClient.signTypedData({
      account,
      ...(buildJitOrderTypedData({
        network: input.network,
        routerAddress: jitRequest.routerAddress as `0x${string}`,
        order: {
          user: jitRequest.order.user as `0x${string}`,
          recipient: jitRequest.order.recipient as `0x${string}`,
          tokenIn: jitRequest.order.tokenIn as `0x${string}`,
          tokenOut: jitRequest.order.tokenOut as `0x${string}`,
          amountIn: jitRequest.order.amountIn,
          minOut: jitRequest.order.minOutAmount,
          maxBlockNumber: jitRequest.order.maxBlockNumber,
          nonce: jitRequest.order.nonce,
          candidateSetHash: jitRequest.order.candidateSetHash as `0x${string}`
        }
      }) as {
        domain: TypedDataDomain
        types: Record<string, readonly TypedDataParameter[]>
        primaryType: "Order"
        message: Record<string, unknown>
      })
    })

    const executePayload = encodeJitRouterExecute({
      network: input.network,
      routerAddress: jitRequest.routerAddress as `0x${string}`,
      order: {
        user: jitRequest.order.user as `0x${string}`,
        recipient: jitRequest.order.recipient as `0x${string}`,
        tokenIn: jitRequest.order.tokenIn as `0x${string}`,
        tokenOut: jitRequest.order.tokenOut as `0x${string}`,
        amountIn: jitRequest.order.amountIn,
        minOut: jitRequest.order.minOutAmount,
        maxBlockNumber: jitRequest.order.maxBlockNumber,
        nonce: jitRequest.order.nonce,
        candidateSetHash: jitRequest.order.candidateSetHash as `0x${string}`
      },
      candidates: jitRequest.candidates.map((candidate) => ({
        adapterId: candidate.adapterId,
        router: candidate.router as `0x${string}`,
        value: candidate.value,
        data: candidate.callData as `0x${string}`
      })),
      signature
    })

    swapTx = {
      to: executePayload.to as Address,
      data: executePayload.data as Hex,
      value: BigInt(executePayload.value)
    }
    expectedQuoteOut = maxQuotedOut(jitRequest) ?? selectedPayload.minOutAmount
    protectedMinOut = jitRequest.order.minOutAmount
  } else {
    swapTx = {
      to: selectedPayload.to as Address,
      data: selectedPayload.data as Hex,
      value: BigInt(selectedPayload.value)
    }
    const selectedRoute =
      input.result.routeCandidates.find((route) => route.id === input.result.recommendedPlan.routeId) ??
      input.result.routeCandidates.find((route) => route.platform === selectedPayload.platform) ??
      input.result.routeCandidates[0]
    expectedQuoteOut = selectedRoute?.quotedOut ?? selectedPayload.minOutAmount
    protectedMinOut = selectedPayload.minOutAmount
  }

  let approvalPhase: SwapExecutionPhaseSummary | undefined
  if (!sellToken.isNative) {
    const allowance = await client.readContract({
      address: sellToken.address as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, approvalSpender as Address]
    })
    input.onTrace?.(
      `allowance check spender=${shortAddressForTrace(approvalSpender)} current=${allowance.toString()} required=${amountIn}`
    )
    if (allowance < BigInt(amountIn)) {
      input.onTrace?.(`approval required`)
      approvalPhase = await executePrivatePhase({
        network: input.network,
        client,
        walletClient,
        account,
        builders: builderEndpoints,
        tx: {
          to: sellToken.address as Address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [approvalSpender as Address, BigInt(amountIn)]
          }),
          value: 0n
        },
        phase: "approval",
        onTrace: input.onTrace
      })

      if (approvalPhase.audit?.status !== "success") {
        return {
          mode: "live",
          recommendedHandoff: "builder-broadcast-handoff",
          executionVariant,
          signed: approvalPhase.signed,
          submitted: approvalPhase.submitted,
          approval: approvalPhase,
          skippedReason: "Approval transaction did not complete successfully."
        }
      }
    }
  }

  const swapPhase = await executePrivatePhase({
    network: input.network,
    client,
    walletClient,
    account,
    builders: builderEndpoints,
    tx: swapTx,
    phase: "swap",
    audit: {
      buyTokenAddress: buyToken.address as `0x${string}`,
      recipient: account.address as `0x${string}`,
      expectedQuoteOut,
      protectedMinOut,
      executionPath: "builder-aware-broadcast",
      armedCandidateRouteIds
    },
    onTrace: input.onTrace
  })

  const feedback = swapPhase.audit
    ? deriveExecutionFeedback({
        result: input.result,
        payload: selectedPayload,
        audit: swapPhase.audit,
        acceptedCount: swapPhase.submission?.acceptedCount ?? 0,
        endpointCount: swapPhase.submission?.endpointCount ?? builderEndpoints.length,
        builderRoundTripMs: swapPhase.submission?.builderRoundTripMs,
        approvalCompleted: approvalPhase?.audit?.status === "success",
        executionVariant
      })
    : undefined

  return {
    mode: "live",
    recommendedHandoff: "builder-broadcast-handoff",
    executionVariant,
    signed: swapPhase.signed,
    submitted: swapPhase.submitted,
    approval: approvalPhase,
    swap: swapPhase,
    signing: swapPhase.signing,
    submission: swapPhase.submission,
    audit: swapPhase.audit,
    feedback,
    executedRouteId: swapPhase.audit?.executedRouteId,
    jitSelectedCandidateIndex: swapPhase.audit?.jitSelectedCandidateIndex,
    armedCandidateRouteIds
  }
}

export function deriveExecutionFeedback(input: {
  result: PlanningResult
  payload: PayloadCandidate
  audit: {
    status: "success" | "reverted" | "pending" | "not-found"
    inclusionBlockDelta?: number
    realizedOut?: string
    expectedQuoteOut?: string
    protectedMinOut?: string
    quoteDeltaRaw?: string
    minOutDeltaRaw?: string
  }
  acceptedCount: number
  endpointCount: number
  builderRoundTripMs?: number
  approvalCompleted?: boolean
  executionVariant?: "jit-v21" | "direct-router"
}): SwapExecutionFeedback {
  const timeliness =
    input.audit.inclusionBlockDelta == null ? "unknown" : input.audit.inclusionBlockDelta <= 2 ? "good" : "weak"
  const priceProtection =
    input.audit.status !== "success" || !input.audit.realizedOut || !input.audit.protectedMinOut
      ? input.audit.status === "success"
        ? "unknown"
        : "failed"
      : BigInt(input.audit.realizedOut) >= BigInt(input.audit.protectedMinOut)
        ? "held"
        : "within-guardrail"
  const executionQuality =
    input.audit.status === "success"
      ? "good"
      : input.audit.status === "pending" || input.audit.status === "not-found"
        ? "pending"
        : "failed"

  const preTradeFindings = derivePreTradeFindings(input.result, input.payload)
  const submitFindings = deriveSubmitFindings(input.acceptedCount, input.endpointCount, input.builderRoundTripMs)
  if (input.approvalCompleted) {
    submitFindings.unshift(
      input.executionVariant === "direct-router"
        ? "approval exact allowance granted to direct router spender"
        : "approval exact allowance granted to secure jit v2.1"
    )
  }
  const postTradeFindings = derivePostTradeFindings(input.audit)
  const summaryVerdict =
    executionQuality === "good"
      ? input.executionVariant === "direct-router"
        ? "direct private execution succeeded with measurable onchain evidence"
        : "secure jit v2.1 private execution succeeded with measurable onchain evidence"
      : executionQuality === "pending"
        ? input.executionVariant === "direct-router"
          ? "direct private execution submitted, but onchain confirmation is incomplete"
          : "secure jit v2.1 private execution submitted, but onchain confirmation is incomplete"
        : input.executionVariant === "direct-router"
          ? "direct private execution failed to reach a good onchain outcome"
          : "secure jit v2.1 private execution failed to reach a good onchain outcome"

  return {
    timeliness,
    priceProtection,
    executionQuality,
    mevProtectionAssessment: input.audit.status === "success" ? "private-builder-path-used" : "private-builder-path-unavailable",
    preTradeFindings,
    submitFindings,
    postTradeFindings,
    summaryVerdict,
    notes: [summaryVerdict]
  }
}

async function buildLiveJitRequest(input: {
  result: PlanningResult
  registry: CapabilityRegistry
  network: Network
  walletAddress: `0x${string}`
  sellToken: TokenRef
  buyToken: TokenRef
  amountIn: string
  client: ReturnType<typeof createRpcClient>
}): Promise<JitRouterRequest | undefined> {
  const routerAddress = getJitRouterAddress(input.network)
  if (!routerAddress) {
    return undefined
  }

  const liveCandidates = input.result.routeCandidates
    .filter((route) =>
      input.result.jitCandidateRouteIds?.length
        ? input.result.jitCandidateRouteIds.includes(route.id)
        : ALLOWED_JIT_PLATFORMS.includes(route.id as (typeof ALLOWED_JIT_PLATFORMS)[number])
    )
    .filter((route) => route.providerNative && route.routeSourceType === "native")
    .filter((route) => {
      const readiness = input.result.routeExecutionReadiness.find((item) => item.routeId === route.id)
      return readiness?.simulationOk
    })
    .slice(0, 3)

  if (liveCandidates.length !== 3) {
    return undefined
  }

  const amount = input.sellToken.isNative
    ? formatAmountFromRaw(input.amountIn, input.sellToken.decimals)
    : formatAmountFromRaw(input.amountIn, input.sellToken.decimals)

  const payloads = []
  for (const route of liveCandidates) {
    const encoded = await input.registry.quote.encodeRouterCalldata({
      network: input.network,
      platform: route.platform,
      sellToken: input.sellToken,
      buyToken: input.buyToken,
      amount,
      amountRaw: input.amountIn,
      slippageBps: input.result.effectiveSlippageBps,
      account: routerAddress
    })
    payloads.push({
      route,
      payload: encoded,
      adapterId: JIT_ADAPTER_IDS[route.id as keyof typeof JIT_ADAPTER_IDS]
    })
  }

  const maxQuoted = payloads.reduce((best, item) => {
    return BigInt(item.route.quotedOut) > BigInt(best) ? item.route.quotedOut : best
  }, payloads[0]!.route.quotedOut)
  const minOut = applySlippage(maxQuoted, input.result.effectiveSlippageBps)
  const maxBlockNumber = (await input.client.getBlockNumber()) + 2n
  const candidates = payloads.map((item) => ({
    routeId: item.route.id,
    payloadId: `jit-v21-${item.route.id}`,
    adapterId: item.adapterId,
    router: item.payload.to,
    callData: item.payload.data,
    value: item.payload.value,
    minOutAmount: item.payload.minOutAmount
  }))
  const nonce = await getJitRouterNonce({
    client: input.client,
    routerAddress,
    user: input.walletAddress
  })
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
      tokenIn: input.sellToken.address,
      tokenOut: input.buyToken.address,
      amountIn: input.amountIn,
      minOutAmount: minOut.toString(),
      maxBlockNumber: maxBlockNumber.toString(),
      nonce: nonce.toString(),
      candidateSetHash
    },
    approvalSpender: routerAddress,
    candidates,
    note: "Secure JIT v2.1 live payload with signed-order authorization and builder-private execution."
  }
}

async function executePrivatePhase(input: {
  network: Network
  client: ReturnType<typeof createRpcClient>
  walletClient: ReturnType<typeof createWalletClient>
  account: PrivateKeyAccount
  builders: Array<{ id: string; displayName: string }>
  tx: { to: Address; data: Hex; value: bigint }
  phase: "approval" | "swap"
  onTrace?: (line: string) => void
  audit?: {
    buyTokenAddress?: `0x${string}`
    recipient?: `0x${string}`
    expectedQuoteOut?: string
    protectedMinOut?: string
    executionPath?: ExecutionAudit["executionPath"]
    armedCandidateRouteIds?: string[]
  }
}): Promise<SwapExecutionPhaseSummary> {
  const nonce = await input.client.getTransactionCount({ address: input.account.address, blockTag: "pending" })
  const gasPrice = await input.client.getGasPrice()
  const gasEstimate = await input.client.estimateGas({
    account: input.account.address,
    to: input.tx.to,
    data: input.tx.data,
    value: input.tx.value === 0n ? undefined : input.tx.value
  })
  const gas = withGasBuffer(gasEstimate)

  const rawTransaction = await input.walletClient.signTransaction({
    account: input.account,
    chain: input.network === "bsc" ? bsc : bscTestnet,
    to: input.tx.to,
    data: input.tx.data,
    value: input.tx.value,
    gas,
    gasPrice,
    nonce
  })
  input.onTrace?.(`${input.phase} signing nonce=${nonce} gas=${gas}`)

  const registry = await loadPrivateSubmissionRegistry()
  const submittedAtIso = new Date().toISOString()
  const startedAtMonotonicMs = performance.now()
  const submittedBlockNumber = await input.client.getBlockNumber()
  input.onTrace?.(`${input.phase} submit started at=${submittedAtIso} block=${submittedBlockNumber}`)
  const results = await broadcastPrivateRawTransaction({
    rawTransaction,
    network: input.network,
    channel: "builder",
    maxEndpoints: input.builders.length,
    endpointIds: input.builders.map((item) => item.id),
    registry
  })
  for (const result of results) {
    input.onTrace?.(
      `${input.phase} submit ${compactEndpointName(result.displayName)} ${result.accepted ? "accepted" : "rejected"} ${Math.max(0, result.latencyMs)}ms${result.error ? ` ${result.error}` : ""}`
    )
  }
  const accepted = results.filter((item) => item.accepted)
  const acceptedEndpoint = accepted[0]
  const firstAcceptedAtMonotonicMs = acceptedEndpoint ? performance.now() : undefined
  const builderRoundTripMs =
    firstAcceptedAtMonotonicMs != null ? Math.max(0, Math.round(firstAcceptedAtMonotonicMs - startedAtMonotonicMs)) : undefined
  const txHash = acceptedEndpoint?.txHash as `0x${string}` | undefined

  const submission: SwapExecutionSubmissionSummary = {
    channel: "builder",
    endpointCount: results.length,
    acceptedCount: accepted.length,
    txHash,
    submittedAt: submittedAtIso,
    submittedBlockNumber: submittedBlockNumber.toString(),
    startedAtMonotonicMs,
    firstAcceptedAtMonotonicMs,
    builderRoundTripMs,
    acceptedEndpointId: acceptedEndpoint?.endpointId,
    acceptedEndpointName: acceptedEndpoint?.displayName,
    results
  }

  if (!txHash) {
    return {
      signed: true,
      submitted: false,
      skippedReason: `${input.phase} builder broadcast was rejected by all endpoints`,
      signing: {
        signer: input.account.address,
        nonce: nonce.toString(),
        gas: gas.toString(),
        gasPrice: gasPrice.toString(),
        rawTransaction
      },
      submission
    }
  }

  input.onTrace?.(
    `${input.phase} submit accepted ${accepted.length}/${results.length} txHash=${txHash}`
  )

  const audit = await waitForAudit({
    network: input.network,
    txHash,
    submittedAtIso,
    submittedAtMonotonicMs: startedAtMonotonicMs,
    submittedBlockNumber,
    buyTokenAddress: input.audit?.buyTokenAddress,
    recipient: input.audit?.recipient,
    expectedQuoteOut: input.audit?.expectedQuoteOut,
    protectedMinOut: input.audit?.protectedMinOut,
    armedCandidateRouteIds: input.audit?.armedCandidateRouteIds,
    executionPath: input.audit?.executionPath ?? "builder-aware-broadcast",
    phase: input.phase,
    onTrace: input.onTrace
  })

  return {
    signed: true,
    submitted: true,
    signing: {
      signer: input.account.address,
      nonce: nonce.toString(),
      gas: gas.toString(),
      gasPrice: gasPrice.toString(),
      rawTransaction
    },
    submission,
    audit
  }
}

async function waitForAudit(input: {
  network: Network
  txHash: `0x${string}`
  buyTokenAddress?: `0x${string}`
  recipient?: `0x${string}`
  expectedQuoteOut?: string
  protectedMinOut?: string
  submittedAtIso: string
  submittedAtMonotonicMs: number
  submittedBlockNumber: bigint
  armedCandidateRouteIds?: string[]
  executionPath: ExecutionAudit["executionPath"]
  phase: "approval" | "swap"
  onTrace?: (line: string) => void
}) {
  const client = createRpcClient(input.network)
  const deadline = Date.now() + DEFAULT_RECEIPT_WAIT_MS
  while (Date.now() < deadline) {
    const currentBlock = await client.getBlockNumber()
    const receipt = await client.getTransactionReceipt({ hash: input.txHash }).catch(() => null)
    if (receipt) {
      break
    }
    const elapsedMs = Math.max(0, Math.round(performance.now() - input.submittedAtMonotonicMs))
    const blocks = Number(currentBlock - input.submittedBlockNumber)
    input.onTrace?.(`${input.phase} receipt pending ${formatTraceDuration(elapsedMs)} ${Math.max(0, blocks)} blocks`)
    if (currentBlock > input.submittedBlockNumber + DEFAULT_RECEIPT_BLOCK_WINDOW) {
      break
    }
    await sleep(POLL_INTERVAL_MS)
  }

  const receiptObservedAtMonotonicMs = performance.now()
  const audit = await auditExecution({
    network: input.network,
    txHash: input.txHash,
    buyTokenAddress: input.buyTokenAddress,
    recipient: input.recipient,
    expectedOut: input.protectedMinOut,
    expectedQuoteOut: input.expectedQuoteOut,
    protectedMinOut: input.protectedMinOut,
    submittedAt: input.submittedAtIso,
    submittedBlockNumber: input.submittedBlockNumber,
    inclusionWallClockMs: Math.max(0, Math.round(receiptObservedAtMonotonicMs - input.submittedAtMonotonicMs)),
    executionPath: input.executionPath
  })
  if (audit.status === "success") {
    input.onTrace?.(
      `${input.phase} receipt success block=${audit.blockNumber?.toString() ?? "unknown"} blocks=${audit.inclusionBlockDelta ?? "unknown"} wall=${audit.inclusionWallClockMs ?? 0}ms${audit.confirmedAt ? ` at=${audit.confirmedAt}` : ""}`
    )
  } else {
    input.onTrace?.(`${input.phase} receipt ${audit.status}`)
  }
  return audit
}

function derivePreTradeFindings(result: PlanningResult, payload: PayloadCandidate) {
  const findings: string[] = []
  if (result.observedRouteIds.length <= 5) {
    findings.push("coverage narrow")
  }
  if (result.bestQuoteRouteId && result.bestReadyRouteId && result.bestQuoteRouteId !== result.bestReadyRouteId) {
    findings.push("execution-ready route beat the quote leader on build/sim/path realism")
  }
  const gasValues = result.payloadCandidates
    .map((candidate) => BigInt(candidate.simulation.estimatedGas || candidate.estimatedGas))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const medianGas = gasValues.length ? gasValues[Math.floor(gasValues.length / 2)] : undefined
  const payloadGas = BigInt(payload.simulation.estimatedGas || payload.estimatedGas)
  if (medianGas != null && payloadGas > (medianGas * 12n) / 10n) {
    findings.push("selected route was relatively expensive to execute")
  }
  if (result.quoteFreshness !== "fresh") {
    findings.push("quote freshness blocked live execution")
  }
  if (result.jitRouterRequest?.candidates.length === 3) {
    findings.push("secure jit v2.1 used signed-order best-of-3 execution")
  } else {
    findings.push("direct self-executed route used builder-private delivery")
  }
  return findings
}

function deriveSubmitFindings(acceptedCount: number, endpointCount: number, builderRoundTripMs?: number) {
  const findings: string[] = []
  if (acceptedCount === 0) {
    findings.push("private path failed")
  } else if (acceptedCount < endpointCount) {
    findings.push("builder reach partial")
  } else {
    findings.push("builder reach broad")
  }
  if (builderRoundTripMs != null && builderRoundTripMs > 1500) {
    findings.push("relay acceptance slow")
  }
  return findings
}

function derivePostTradeFindings(audit: {
  status: "success" | "reverted" | "pending" | "not-found"
  inclusionBlockDelta?: number
  quoteDeltaRaw?: string
  minOutDeltaRaw?: string
}) {
  const findings: string[] = []
  if (audit.status === "reverted" || audit.status === "not-found") {
    findings.push("execution failed or remains unconfirmed")
    return findings
  }
  if (audit.inclusionBlockDelta != null) {
    findings.push(audit.inclusionBlockDelta <= 2 ? "timeliness met target" : "timeliness missed target")
  }
  if (audit.quoteDeltaRaw && audit.minOutDeltaRaw) {
    const quoteDelta = BigInt(audit.quoteDeltaRaw)
    const minOutDelta = BigInt(audit.minOutDeltaRaw)
    if (quoteDelta < 0n && minOutDelta >= 0n) {
      findings.push("price degraded versus quote but protection held")
    } else if (quoteDelta >= 0n) {
      findings.push("quote held or improved")
    }
  }
  return findings
}

async function resolveExecutionToken(
  registry: CapabilityRegistry,
  tokenQuery: string,
  network: Network
): Promise<TokenRef> {
  const resolution = registry.chain.resolveTokenDetailed
    ? await registry.chain.resolveTokenDetailed(tokenQuery, network)
    : {
        resolvedToken: await registry.chain.resolveToken(tokenQuery, network),
        resolvedBy: "exact-symbol",
        normalizedQuery: tokenQuery,
        suggestions: []
      }

  if (!resolution.resolvedToken) {
    throw new Error(`Could not resolve token '${tokenQuery}' on ${network}.`)
  }

  return resolution.resolvedToken
}

async function resolveAmountIn(input: {
  registry: CapabilityRegistry
  network: Network
  walletAddress: string
  sellToken: TokenRef
  requestedAmount: string
}): Promise<string> {
  const requested = String(input.requestedAmount ?? "").trim()
  if (requested.toLowerCase() !== "all") {
    return parseAmountToRaw(requested, input.sellToken.decimals)
  }

  const balance = input.sellToken.isNative
    ? await input.registry.chain.getNativeBalance(input.walletAddress, input.network)
    : await input.registry.chain.getErc20Balance(input.sellToken.address, input.walletAddress, input.network)
  let raw = BigInt(balance.raw)
  if (input.sellToken.isNative) {
    const nativeReserve = 300_000_000_000_000n
    raw = raw > nativeReserve ? raw - nativeReserve : 0n
  }
  if (raw <= 0n) {
    throw new Error(
      input.sellToken.isNative
        ? "Wallet does not have enough BNB to swap after reserving gas."
        : `Wallet does not hold any ${input.sellToken.symbol} to swap.`
    )
  }
  return raw.toString()
}

function createRpcClient(network: Network) {
  return createPublicClient({
    chain: network === "bsc" ? bsc : bscTestnet,
    transport: http(resolveRpcUrl(network))
  })
}

function resolveRpcUrl(network: Network): string {
  const rpcUrl = network === "bsc" ? process.env.BSC_RPC_URL : process.env.BSC_TESTNET_RPC_URL
  if (!rpcUrl) {
    throw new Error(network === "bsc" ? "Missing BSC_RPC_URL." : "Missing BSC_TESTNET_RPC_URL.")
  }
  return rpcUrl
}

function normalizePrivateKey(value?: string): `0x${string}` | undefined {
  if (!value) return undefined
  const normalized = value.startsWith("0x") ? value : `0x${value}`
  return normalized as `0x${string}`
}

function withGasBuffer(estimatedGas: bigint): bigint {
  return (estimatedGas * 12n) / 10n
}

function parseAmountToRaw(amount: string, decimals: number): string {
  const normalizedAmount = String(amount ?? "").trim()
  const [wholePart, fractionalPart = ""] = normalizedAmount.split(".")
  const normalizedWhole = wholePart === "" ? "0" : wholePart
  const normalizedFraction = fractionalPart.replace(/[^0-9]/g, "").slice(0, decimals).padEnd(decimals, "0")
  return `${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0"
}

function formatAmountFromRaw(raw: string, decimals: number): string {
  const digits = raw.replace(/^(-?)(\d+)$/, "$1$2")
  const sign = digits.startsWith("-") ? "-" : ""
  const unsigned = sign ? digits.slice(1) : digits
  const padded = unsigned.padStart(decimals + 1, "0")
  const head = padded.slice(0, -decimals) || "0"
  const tail = padded.slice(-decimals).replace(/0+$/, "")
  return tail ? `${sign}${head}.${tail}` : `${sign}${head}`
}

function applySlippage(rawQuotedOut: string, slippageBps: number): bigint {
  const quoted = BigInt(rawQuotedOut)
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n
}

function maxQuotedOut(request: JitRouterRequest): string | undefined {
  return request.candidates.length ? request.candidates.reduce((best, candidate) => {
    return BigInt(candidate.minOutAmount) > BigInt(best) ? candidate.minOutAmount : best
  }, request.candidates[0]!.minOutAmount) : undefined
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function compactEndpointName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-")
}

function formatTraceDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function shortAddressForTrace(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}
