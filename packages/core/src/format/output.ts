import {
  createPresentationResult,
  createPartialPresentationTrace,
  formatStreamingUpdate as formatSharedStreamingUpdate,
  type DecisionTraceField,
  type PlanningEvent,
  type PlanningResult,
  type PartialPresentationTraceItem,
  type PresentationResult,
  type SwapExecutionSummary
} from "@bsc-swap-agent-demo/shared"

type QuoteCellStatus = "queued" | "run" | "ok" | "empty" | "fail"
type BuilderCellStatus = "idle" | "send" | "accepted" | "duplicate" | "rejected" | "timeout"

interface QuoteCellState {
  status: QuoteCellStatus
  latencyMs?: number
  quotedOut?: string
  note?: string
}

interface BuilderCellState {
  status: BuilderCellStatus
  latencyMs?: number
}

interface DashboardPhaseState {
  status?: string
  nonce?: string
  gas?: string
  accepted?: string
  txHash?: string
  submittedAt?: string
  submittedBlockNumber?: string
  blocks?: string
  wall?: string
  builders: Record<string, BuilderCellState>
}

export interface DashboardState {
  request: string
  network: "bsc" | "bsc-testnet"
  startedAtMs: number
  phase: DashboardPhase
  intent?: string
  tokens?: string
  bestQuote?: string
  bestQuoteRoute?: string
  quoteProviders: Record<string, QuoteCellState>
  selectedRoute?: string
  selectedQuoteSummary?: string
  decisionSummary?: string
  agentSummary?: string
  payloadSummary?: string
  guardSummary?: string
  allowance?: string
  approval: DashboardPhaseState
  swap: DashboardPhaseState
  receipt?: string
  audit?: string
  qualitySummary?: string
  explorerUrl?: string
  signals: string[]
  eventTail: string[]
}

type DashboardFailureKind = "planning" | "execution"
type DashboardPlanningFailureStage = "intent-parsing" | "liquidity-discovery" | "payload-construction" | "unknown"

const DASHBOARD_QUOTE_ORDER = ["openoceanv2", "paraswap", "pancakeswap", "thena", "woofi", "matcha", "1inch"] as const
const DASHBOARD_PHASE_ORDER = ["parsing", "quoting", "simulating", "deciding", "submitting", "confirmed", "failed"] as const
type DashboardPhase = (typeof DASHBOARD_PHASE_ORDER)[number]

export function formatPlan(result: PlanningResult): string {
  const selectedRoute =
    result.routeCandidates.find((route) => route.id === result.defaultSelectedRouteId) ??
    result.routeCandidates.find((route) => route.id === result.recommendedPlan.routeId) ??
    result.routeCandidates[0]
  const selectedPayload =
    result.payloadCandidates.find(
      (candidate) =>
        candidate.platform === selectedRoute?.platform && candidate.routeFamily === selectedRoute?.routeFamily
    ) ?? null
  const bestQuote =
    result.routeCandidates.find((route) => route.id === result.priceImpactAssessment.bestQuotedRouteId) ??
    result.routeCandidates[0]
  const bestReady =
    result.routeExecutionReadiness.find((item) => item.liveExecutable) ??
    result.routeExecutionReadiness.find((item) => item.simulationOk) ??
    result.routeExecutionReadiness[0]
  const bestReadyRoute = result.routeCandidates.find((route) => route.id === bestReady?.routeId) ?? selectedRoute
  const quoteFreshness = result.quoteFreshness
  const slippageReason =
    result.intent.slippageBps != null
      ? "user"
      : selectedRoute
        ? `auto:${deriveAutoSlippageLabel(selectedRoute.priceImpactPct)}`
        : "auto"
  const livePath = result.submissionCandidates.find((candidate) => candidate.submissionChannel === "public-mempool")
  const privatePath = result.submissionCandidates.find((candidate) => candidate.submissionChannel === "private-rpc")
  const builderPath = result.submissionCandidates.find(
    (candidate) => candidate.submissionChannel === "builder-aware-broadcast"
  )
  const opsAvailable = [
    result.privateSubmitRequest ? "private-submit" : null,
    builderPath?.availability === "live" ? "builder-broadcast" : null,
    result.executionCapabilityUsage.available.includes("audit") ? "audit" : null
  ].filter(Boolean) as string[]
  const evidenceLine =
    result.executionCapabilityUsage.used.includes("route-sim")
      ? "route-sim confirmed kept candidates"
      : "local simulation only"
  const liveLabel =
    result.recommendedHandoff === "private-rpc-handoff"
      ? "private-rpc-handoff"
      : result.recommendedHandoff === "builder-broadcast-handoff"
        ? "builder-broadcast-handoff"
        : result.recommendedHandoff === "public-wallet"
          ? "public-wallet"
          : "none"
  const nextStep =
    result.recommendedHandoff === "private-rpc-handoff" && result.privateSubmitRequest
      ? result.privateSubmitRequest.userAction ??
        "Sign the payload locally, then submit the raw transaction through private delivery."
      : result.recommendedHandoff === "builder-broadcast-handoff" && result.privateSubmitRequest
        ? result.privateSubmitRequest.userAction ??
          "Sign the payload locally, then broadcast the raw transaction to builder relays."
        : result.executionReadyNow
          ? "sign and broadcast via wallet now"
          : quoteFreshness === "stale"
            ? "refresh quote before execution"
            : "do not execute yet"
  const lines = [
    formatConsoleLine("known", [
      `routes=${result.observedRouteIds.length}`,
      `coverage=${result.venueCoverageSnapshot.topDexesObservedByDefiLlama.length ? "available" : "unavailable"}`,
      "private=advisory"
    ]),
    formatConsoleLine("best", [
      bestQuote ? `quote=${bestQuote.platform} ${bestQuote.quotedOutFormatted}` : "quote=none",
      bestReadyRoute ? `ready=${bestReadyRoute.platform}` : "ready=none"
    ]),
    formatConsoleLine(
      "live",
      [liveLabel],
      liveLabel === "none" ? "warn" : "success"
    ),
    formatConsoleLine(
      "ops",
      [opsAvailable.length ? `${opsAvailable.join(",")} available` : "none"],
      opsAvailable.length ? "success" : "dim"
    ),
    formatConsoleLine(
      "used",
      [result.executionCapabilityUsage.used.length ? result.executionCapabilityUsage.used.join(",") : "none"],
      result.executionCapabilityUsage.used.length ? "success" : "dim"
    ),
    formatConsoleLine("evidence", [evidenceLine], "dim"),
    result.allowanceCheck
      ? formatConsoleLine(
          "allowance",
          [
            result.allowanceCheck.status,
            result.allowanceCheck.spender ? `spender=${shortAddress(result.allowanceCheck.spender)}` : null,
            result.allowanceCheck.currentAllowance
              ? `current=${shortAmount(result.allowanceCheck.currentAllowance)}`
              : null,
            result.allowanceCheck.requiredAmount
              ? `required=${shortAmount(result.allowanceCheck.requiredAmount)}`
              : null
          ].filter(Boolean) as string[],
          result.allowanceCheck.status === "approve-required"
            ? "warn"
            : result.allowanceCheck.status === "ok" || result.allowanceCheck.status === "not-applicable"
              ? "success"
              : "dim"
        )
      : null,
    result.privateSubmitRequest
      ? formatConsoleLine(
          "sign",
          [
            "signed raw tx required",
            `channel=${result.privateSubmitRequest.preferredChannel ?? "validator"}`,
            `targets=${result.privateSubmitRequest.recommendedTargetCount ?? 1}`
          ],
          result.recommendedHandoff === "public-wallet" ? "dim" : "warn"
        )
      : null,
    bestQuote && bestReadyRoute && bestQuote.id !== bestReadyRoute.id
      ? formatConsoleLine("why", ["best quote was not the strongest execution-ready route"], "dim")
      : null,
    formatConsoleLine("guard", [
      `slippage=${result.effectiveSlippageBps}bps(${slippageReason})`,
      `quote=${quoteFreshness}`,
      selectedPayload
        ? `dry-run=${selectedPayload.simulation.ok ? "ok" : "failed"} gas=${selectedPayload.simulation.estimatedGas}`
        : "dry-run=missing"
    ]),
    result.publicSubmitRequest
      ? formatConsoleLine("tx", [
          `to=${shortAddress(result.publicSubmitRequest.to)}`,
          `value=${formatTxValue(result.publicSubmitRequest.value, result.intent.sellToken ?? undefined)}`,
          result.publicSubmitRequest.minOutAmount ? `minOut=${shortAmount(result.publicSubmitRequest.minOutAmount)}` : null,
          result.publicSubmitRequest.gas ? `gas=${result.publicSubmitRequest.gas}` : null,
          result.publicSubmitRequest.deadlineSeconds ? `deadline=${result.publicSubmitRequest.deadlineSeconds}s` : null,
          `path=${
            result.recommendedHandoff === "private-rpc-handoff"
              ? "private-rpc-handoff"
              : result.recommendedHandoff === "builder-broadcast-handoff"
                ? "builder-broadcast-handoff"
                : result.publicSubmitRequest.path
          }`
        ].filter(Boolean) as string[])
      : null,
    result.jitRouterRequest
      ? formatConsoleLine("jit", [
          "secure",
          `router=${shortAddress(result.jitRouterRequest.routerAddress)}`,
          `candidates=${result.jitRouterRequest.candidates.length}`,
          `minOut=${shortAmount(result.jitRouterRequest.order.minOutAmount)}`
        ])
      : null,
    formatConsoleLine(
      "next",
      [nextStep],
      liveLabel === "none" ? "warn" : "success"
    ),
    formatConsoleLine(
      "boundary",
      [
        [
          "planner builds/checks/handoff",
          "user signs",
          privatePath || builderPath ? "private delivery supported after raw-tx handoff" : null
        ]
          .filter(Boolean)
          .join("; ")
      ],
      "dim"
    )
  ]

  return lines.filter(Boolean).join("\n")
}

export function formatExecutedSwap(result: PlanningResult, execution: SwapExecutionSummary): string {
  const selectedRoute =
    result.routeCandidates.find((route) => route.id === result.recommendedPlan.routeId) ?? result.routeCandidates[0]
  const payload =
    result.payloadCandidates.find((candidate) => candidate.id === result.recommendedPlan.payloadId) ??
    result.payloadCandidates[0]
  const buySymbol = result.intent.buyToken ?? "token"
  const inferredDecimals = selectedRoute ? inferDecimalsFromQuote(selectedRoute.quotedOut, selectedRoute.quotedOutFormatted) : null
  const quoteSummary = selectedRoute
    ? `${selectedRoute.platform} ${selectedRoute.quotedOutFormatted}`
    : "none"
  const jitCandidateCount = execution.executionVariant === "jit-v21" ? 3 : 0
  const decisionReason =
    execution.recommendedHandoff === "builder-broadcast-handoff" && execution.executionVariant === "jit-v21"
      ? "secure jit v2.1 private execution is the live path when exactly 3 native candidates are ready"
      : execution.recommendedHandoff === "builder-broadcast-handoff"
        ? "direct self-executed route used builder-private delivery because JIT live criteria were not met"
      : execution.skippedReason ?? "live execution was skipped"
  const explorerUrl = buildExplorerTxUrlFromExecution(execution)

  return [
    formatConsoleLine("intent", [
      `swap ${result.intent.amount ?? "unknown"} ${result.intent.sellToken ?? "unknown"} -> ${result.intent.buyToken ?? "unknown"}`
    ]),
    formatConsoleLine("tokens", [
      `${result.intent.sellToken ?? "unknown"} -> ${result.intent.buyToken ?? "unknown"}`
    ]),
    formatConsoleLine("quotes", [
      `observed=${result.observedRouteIds.length}`,
      `best=${quoteSummary}`
    ]),
    formatConsoleLine("payload", [
      `route=${selectedRoute?.platform ?? "unknown"}`,
      `jitCandidates=${jitCandidateCount}`,
      `gas=${payload?.simulation.estimatedGas ?? payload?.estimatedGas ?? "unknown"}`,
      `simulation=${payload?.simulation.ok ? "ok" : "failed"}`
    ]),
    formatConsoleLine("decision", [
      `route=${
        execution.recommendedHandoff === "builder-broadcast-handoff" && execution.executionVariant === "jit-v21"
          ? "jit-v2.1(best-of-3)"
          : selectedRoute?.platform ?? "unknown"
      }`,
      `path=${execution.recommendedHandoff}`,
      decisionReason
    ]),
    execution.approval
      ? formatConsoleLine("approval", [
          `required=yes`,
          `submitted=${execution.approval.submitted ? "yes" : "no"}`,
          execution.approval.submission ? `accepted=${execution.approval.submission.acceptedCount}/${execution.approval.submission.endpointCount}` : null,
          execution.approval.audit?.status ? `status=${execution.approval.audit.status}` : null,
          execution.approval.audit?.inclusionBlockDelta != null ? `blocks=${execution.approval.audit.inclusionBlockDelta}` : null,
          execution.approval.audit?.inclusionWallClockMs != null ? `wall=${execution.approval.audit.inclusionWallClockMs}ms` : null
        ].filter(Boolean) as string[], execution.approval.audit?.status === "success" ? "success" : "warn")
      : formatConsoleLine("approval", ["required=no"], "dim"),
    formatConsoleLine("sign", [
      `signed=${execution.swap?.signed ?? execution.signed ? "yes" : "no"}`,
      execution.swap?.signing ? `signer=${shortAddress(execution.swap.signing.signer)}` : execution.signing ? `signer=${shortAddress(execution.signing.signer)}` : null,
      execution.swap?.signing ? `nonce=${execution.swap.signing.nonce}` : execution.signing ? `nonce=${execution.signing.nonce}` : null,
      execution.swap?.signing ? `gas=${execution.swap.signing.gas}` : execution.signing ? `gas=${execution.signing.gas}` : null
    ].filter(Boolean) as string[], execution.swap?.signed ?? execution.signed ? "success" : "warn"),
    formatConsoleLine("submit", [
      `submitted=${execution.swap?.submitted ?? execution.submitted ? "yes" : "no"}`,
      execution.swap?.submission ? `channel=${execution.swap.submission.channel}` : execution.submission ? `channel=${execution.submission.channel}` : null,
      execution.swap?.submission?.submittedAt ? `at=${formatIsoTimestampCompact(execution.swap.submission.submittedAt)}` : execution.submission?.submittedAt ? `at=${formatIsoTimestampCompact(execution.submission.submittedAt)}` : null,
      execution.swap?.submission?.submittedBlockNumber ? `block=${execution.swap.submission.submittedBlockNumber}` : execution.submission?.submittedBlockNumber ? `block=${execution.submission.submittedBlockNumber}` : null,
      execution.swap?.submission ? `accepted=${execution.swap.submission.acceptedCount}/${execution.swap.submission.endpointCount}` : execution.submission ? `accepted=${execution.submission.acceptedCount}/${execution.submission.endpointCount}` : null,
      execution.swap?.submission?.builderRoundTripMs != null ? `builderMs=${execution.swap.submission.builderRoundTripMs}` : execution.submission?.builderRoundTripMs != null ? `builderMs=${execution.submission.builderRoundTripMs}` : null,
      execution.swap?.submission?.txHash ? `txHash=${execution.swap.submission.txHash}` : execution.submission?.txHash ? `txHash=${execution.submission.txHash}` : null
    ].filter(Boolean) as string[], execution.swap?.submitted ?? execution.submitted ? "success" : "warn"),
    formatConsoleLine("audit", [
      `status=${execution.swap?.audit?.status ?? execution.audit?.status ?? "skipped"}`,
      execution.swap?.audit?.submittedBlockNumber ? `from=${execution.swap.audit.submittedBlockNumber}` : execution.audit?.submittedBlockNumber ? `from=${execution.audit.submittedBlockNumber}` : null,
      execution.swap?.audit?.blockNumber != null ? `block=${execution.swap.audit.blockNumber}` : execution.audit?.blockNumber != null ? `block=${execution.audit.blockNumber}` : null,
      execution.swap?.audit?.submittedAt ? `submitted=${formatIsoTimestampCompact(execution.swap.audit.submittedAt)}` : execution.audit?.submittedAt ? `submitted=${formatIsoTimestampCompact(execution.audit.submittedAt)}` : null,
      execution.swap?.audit?.confirmedAt ? `at=${formatIsoTimestampCompact(execution.swap.audit.confirmedAt)}` : execution.audit?.confirmedAt ? `at=${formatIsoTimestampCompact(execution.audit.confirmedAt)}` : null,
      execution.swap?.audit?.inclusionBlockDelta != null ? `blocks=${execution.swap.audit.inclusionBlockDelta}` : execution.audit?.inclusionBlockDelta != null ? `blocks=${execution.audit.inclusionBlockDelta}` : null,
      execution.swap?.audit?.inclusionWallClockMs != null ? `wall=${execution.swap.audit.inclusionWallClockMs}ms` : execution.audit?.inclusionWallClockMs != null ? `wall=${execution.audit.inclusionWallClockMs}ms` : null,
      execution.swap?.audit?.realizedOut
        ? `realized=${formatAuditAmount(execution.swap.audit.realizedOut, inferredDecimals, buySymbol)}`
        : execution.audit?.realizedOut
          ? `realized=${formatAuditAmount(execution.audit.realizedOut, inferredDecimals, buySymbol)}`
        : null,
      execution.swap?.audit?.quoteDeltaRaw
        ? `vsQuote=${formatSignedAuditDelta(execution.swap.audit.quoteDeltaRaw, inferredDecimals, buySymbol)}`
        : execution.audit?.quoteDeltaRaw
          ? `vsQuote=${formatSignedAuditDelta(execution.audit.quoteDeltaRaw, inferredDecimals, buySymbol)}`
        : null,
      execution.swap?.audit?.minOutDeltaRaw
        ? `vsMinOut=${formatSignedAuditDelta(execution.swap.audit.minOutDeltaRaw, inferredDecimals, buySymbol)}`
        : execution.audit?.minOutDeltaRaw
          ? `vsMinOut=${formatSignedAuditDelta(execution.audit.minOutDeltaRaw, inferredDecimals, buySymbol)}`
        : null
    ].filter(Boolean) as string[]),
    explorerUrl ? formatConsoleLine("explorer", [explorerUrl], "success") : null,
    execution.feedback
      ? formatConsoleLine(
          "feedback-pre",
          execution.feedback.preTradeFindings.length ? execution.feedback.preTradeFindings : ["none"],
          "dim"
        )
      : null,
    execution.feedback
      ? formatConsoleLine(
          "feedback-submit",
          execution.feedback.submitFindings.length ? execution.feedback.submitFindings : ["none"],
          execution.feedback.executionQuality === "failed" ? "warn" : "dim"
        )
      : null,
    formatConsoleLine(
      "feedback-post",
      execution.feedback
        ? [
            ...(
              execution.feedback.postTradeFindings.length
                ? execution.feedback.postTradeFindings
                : ["none"]
            ),
            execution.feedback.summaryVerdict
          ]
        : [execution.skippedReason ?? "execution was skipped"],
      execution.feedback?.executionQuality === "failed" ? "warn" : "dim"
    )
  ]
    .filter(Boolean)
    .join("\n")
}

export function formatDebugPlan(result: PlanningResult): string {
  const recommendedRoute = result.routeCandidates.find(
    (candidate) => candidate.id === result.recommendedPlan.routeId
  )
  const recommendedPayload = result.payloadCandidates.find(
    (candidate) => candidate.id === result.recommendedPlan.payloadId
  )
  const bestPricePackage = result.executionPackages.find(
    (candidate) => candidate.id === result.recommendedPlan.bestPricePackageId
  )
  const bestExecutionPackage = result.executionPackages.find(
    (candidate) => candidate.id === result.recommendedPlan.bestExecutionPackageId
  )

  return [
    "## Swap Execution Plan",
    "",
    `Best Observed Quote Package: ${bestPricePackage?.id ?? result.recommendedPlan.bestPricePackageId}`,
    `Best Execution Package: ${bestExecutionPackage?.id ?? result.recommendedPlan.bestExecutionPackageId}`,
    `Best Observed Quote Confidence: ${result.bestObservedQuoteConfidence}`,
    `Execution Mode: ${result.recommendedPlan.executionMode}`,
    `Recommended Submission Channel: ${result.recommendedPlan.submissionChannel} / ${result.recommendedPlan.submissionProvider}`,
    `Delegation Boundary: ${result.executionBoundary.plannerControls.length ? "planner controls + external boundary" : "external boundary"}`,
    `Recommended route: ${recommendedRoute?.platform ?? result.recommendedPlan.routeId}`,
    `Payload type: ${recommendedPayload?.type ?? "router-calldata"}`,
    "",
    "### Why this plan",
    result.recommendedPlan.summary,
    "",
    "### Planner Boundary",
    `Planner controls: ${result.executionBoundary.plannerControls.join(", ")}`,
    `User signs or approves: ${result.executionBoundary.userSigns.join(", ")}`,
    `External executor controls: ${result.executionBoundary.externalExecutorControls.join(", ")}`,
    "",
    "### Risk note",
    result.recommendedPlan.riskNote,
    "",
    "### Policy note",
    result.recommendedPlan.policyNote,
    "",
    "### Decision Trace",
    ...result.decisionTrace.flatMap((step) => [
      `#### ${step.title}`,
      step.summary,
      ...(step.decision ? [`Decision: ${step.decision}`] : []),
      ...step.observations.slice(0, 4).map((item) => `- ${item.label}: ${item.value}`),
      ""
    ]),
    "",
    "### Alternatives rejected",
    ...result.alternativesRejected.map((item) => `- ${item.routeId}: ${item.reason}`),
    "",
    "### JSON",
    "```json",
    JSON.stringify(
      {
        intent: result.intent,
        missing_fields_resolved: result.missingFieldsResolved,
        decision_trace: result.decisionTrace,
        liquidity_snapshot: result.liquiditySnapshot,
        venue_coverage_snapshot: result.venueCoverageSnapshot,
        provider_universe_snapshot: result.providerUniverseSnapshot,
        route_candidates: result.routeCandidates,
        execution_packages: result.executionPackages,
        price_impact_assessment: result.priceImpactAssessment,
        best_observed_quote_confidence: result.bestObservedQuoteConfidence,
        mev_risk_assessment: result.mevRiskAssessment,
        payload_candidates: result.payloadCandidates.map((payload) => ({
          ...payload,
          data: `${payload.data.slice(0, 18)}...`,
          data_length: payload.data.length
        })),
        submission_candidates: result.submissionCandidates,
        private_path_registry_summary: result.privatePathRegistrySummary,
        execution_capability_summary: result.executionCapabilitySummary,
        guardrails: result.guardrails,
        execution_boundary: result.executionBoundary,
        recommended_plan: result.recommendedPlan,
        alternatives_rejected: result.alternativesRejected,
        public_submit_request: result.publicSubmitRequest,
        private_submit_request: result.privateSubmitRequest,
        intent_submit_request: result.intentSubmitRequest,
        jit_router_request: result.jitRouterRequest
      },
      null,
      2
    ),
    "```"
  ].join("\n")
}

export function toPresentationJson(result: PlanningResult): PresentationResult {
  return createPresentationResult(result)
}

export function toDebugJson(result: PlanningResult): PlanningResult {
  return result
}

export function buildPartialPresentationTrace(input: {
  events: PlanningEvent[]
  result?: PlanningResult | null
}): PartialPresentationTraceItem[] {
  return createPartialPresentationTrace(input)
}

export function formatStreamingUpdate(item: PartialPresentationTraceItem): string {
  return formatSharedStreamingUpdate(item)
}

export function formatCliStreamingEvent(event: PlanningEvent): string | null {
  if (event.kind === "tool-started" && event.stage === "liquidity-discovery" && event.data?.toolName === "getQuoteCandidates") {
    return formatConsoleLine("@ quotes", ["querying providers..."], "dim")
  }

  if (event.kind === "tool-started" && event.stage === "liquidity-discovery" && event.data?.toolName === "getQuoteProvider") {
    const provider = event.data.inputPreview?.find((field) => field.label === "provider")?.value ?? "provider"
    return formatConsoleLine("quote", [`${provider} started`], "dim")
  }

  if ((event.kind === "tool-succeeded" || event.kind === "tool-failed") && event.stage === "liquidity-discovery" && event.data?.toolName === "getQuoteProvider") {
    const provider = event.data.outputPreview?.find((field) => field.label === "provider")?.value ?? "provider"
    const status = event.data.outputPreview?.find((field) => field.label === "status")?.value ?? (event.kind === "tool-succeeded" ? "observed" : "failed")
    const latency = event.data.outputPreview?.find((field) => field.label === "latency_ms")?.value
    const reason = event.data.outputPreview?.find((field) => field.label === "reason")?.value
    const count = event.data.outputPreview?.find((field) => field.label === "quote_count")?.value
    const parts = [
      provider,
      status === "observed" ? "ok" : status,
      count && status === "observed" ? `${count} route${count === "1" ? "" : "s"}` : null,
      latency ? `${latency}ms` : null,
      reason ? normalizeCliReason(reason) : null
    ].filter(Boolean) as string[]
    return formatConsoleLine("quote", parts, status === "observed" ? "success" : "warn")
  }

  if (event.kind === "tool-succeeded" && event.stage === "liquidity-discovery" && event.data?.toolName === "getQuoteCandidates") {
    const queried = event.data.outputPreview?.find((field) => field.label === "queried")?.value
    const seen = event.data.outputPreview?.find((field) => field.label === "seen")?.value
    const dropped = event.data.outputPreview?.find((field) => field.label === "drop")?.value
    return [
      queried ? formatConsoleLine("queried", [queried]) : null,
      seen ? formatConsoleLine("seen", [seen], "success") : null,
      dropped ? formatConsoleLine("drop", [dropped], "warn") : null
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (event.kind === "reasoning" && event.stage === "route-comparison" && event.data?.reasoningSource === "deterministic") {
    const keptItems = event.data.decision
      ?.match(/Keep (.+) for payload preparation\./)?.[1]
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? []
    const kept = keptItems.join(", ")
    const hold = (event.data.artifacts ?? [])
      .map((item) => item.label)
      .filter((label) => !keptItems.includes(label))
      .join(", ")
    return [
      kept ? formatConsoleLine("kept", [kept], "success") : null,
      hold ? formatConsoleLine("hold", [hold], "dim") : null,
      formatConsoleLine("rule", ["kept=top quoted candidates built this round; native/buildable wins ties"], "dim")
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (event.kind === "stage-completed" && event.stage === "liquidity-discovery") {
    return formatConsoleLine("+ quotes", ["observed routes"], "success")
  }

  if (event.kind === "tool-started" && event.stage === "payload-construction" && event.data?.toolName === "encodeRouterCalldata") {
    const route = event.data.inputPreview?.find((field) => field.label === "route")?.value ?? "route"
    return formatConsoleLine("@ payload", [`building router-calldata for ${route}...`], "dim")
  }

  if (event.kind === "tool-succeeded" && event.stage === "payload-construction" && event.data?.toolName === "simulateTransaction") {
    const gas = event.data.outputPreview?.find((field) => field.label === "estimated_gas")?.value
    const result = event.data.outputPreview?.find((field) => field.label === "result")?.value
    return formatConsoleLine(
      "sim",
      [result === "approval-required" ? "approval-required" : "ok", `gas=${displayGas(gas)}`],
      "success"
    )
  }

  if (event.kind === "tool-failed" && event.stage === "payload-construction" && event.data?.toolName === "simulateTransaction") {
    return formatConsoleLine("sim fail", [normalizeCliReason(event.data.outputPreview?.[0]?.value)], "warn")
  }

  if (event.kind === "stage-completed" && event.stage === "payload-construction") {
    return formatConsoleLine("+ payload", ["ready"], "success")
  }

  if (event.kind === "tool-started" && event.stage === "submission-strategy" && event.data?.toolName === "getSubmissionPaths") {
    return formatConsoleLine("@ submit", ["evaluating delivery paths..."], "dim")
  }

  if (event.kind === "tool-succeeded" && event.stage === "submission-strategy" && event.data?.toolName === "getSubmissionPaths") {
    const selected = event.data.outputPreview?.find((field) => field.label === "selected")?.value
    const order = ["public", "private", "builder", "intent"]
    const lines = [...(event.data.outputPreview ?? [])]
      .filter((field) => field.label !== "selected")
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
      .map((field) => formatConsoleLine(field.label, [field.value], field.label === "public" ? "success" : "warn"))
    if (selected) {
      lines.unshift(formatConsoleLine("path", [selected], "success"))
    }
    return lines.join("\n")
  }

  if (event.kind === "tool-succeeded" && event.stage === "liquidity-discovery" && event.data?.toolName === "checkAllowance") {
    const status = event.data.outputPreview?.find((field) => field.label === "allowance")?.value ?? "unknown"
    const spender = event.data.outputPreview?.find((field) => field.label === "spender")?.value
    const current = event.data.outputPreview?.find((field) => field.label === "current")?.value
    const required = event.data.outputPreview?.find((field) => field.label === "required")?.value
    const note = event.data.outputPreview?.find((field) => field.label === "note")?.value
    return formatConsoleLine(
      "allow",
      [status, spender ? `spender=${shortAddress(spender)}` : null, current ? `current=${shortAmount(current)}` : null, required ? `required=${shortAmount(required)}` : null, note ?? null].filter(Boolean) as string[],
      status === "approve-required" ? "warn" : status === "ok" || status === "not-applicable" ? "success" : "dim"
    )
  }

  if (event.kind === "stage-completed" && event.stage === "submission-strategy") {
    return formatConsoleLine("+ submit", ["public live, private advisory"], "success")
  }

  if (event.kind === "plan-completed" && event.data?.result) {
    const liveRoutes = event.data.result.routeExecutionReadiness.filter((item) => item.liveExecutable)
    return [
      formatConsoleLine(
        "+ ready",
        [event.data.result.executionReadyNow ? "public wallet handoff ready" : "refresh quote before execution"],
        event.data.result.executionReadyNow ? "success" : "warn"
      ),
      formatConsoleLine("note", ["private paths observed and ranked, not live-integrated"], "dim")
    ].join("\n")
  }

  return null
}

export function formatCliCheckpoint(input: {
  events: PlanningEvent[]
  checkpoint:
    | "intent"
    | "tokens"
    | "quotes"
    | "payload"
    | "submission"
    | "ready"
  result?: PlanningResult | null
}): string | null {
  if (input.checkpoint === "intent") {
    const reasoning = latestReasoning(input.events, ["execution-family-selection", "intent-parsing"])
    const intentFields = collectFields(input.events, ["intent-parsing"], ["action", "sell_token", "buy_token", "amount"])
    if (!reasoning && !intentFields.length) return null
    const observed = intentFields.length
      ? intentFields.map((field) => `${normalizeFieldLabel(field.label)}=${field.value}`).join(" | ")
      : "intent parsed"
    return [
      formatConsoleLine("intent", [observed]),
      formatConsoleLine(
        "why",
        [
          compactReasoning(
            reasoning?.message ??
              "I extracted the swap intent and treated user preferences as execution constraints."
          )
        ],
        "dim"
      )
    ].join("\n")
  }

  if (input.checkpoint === "tokens") {
    const tokenFields = collectFields(input.events, ["liquidity-discovery"], ["symbol", "address", "resolved", "normalized"])
    const resolvedSymbols = new Set(
      tokenFields.filter((field) => field.label === "symbol").map((field) => field.value)
    )
    if (resolvedSymbols.size < 2) return null
    return formatConsoleLine(
      "tokens",
      tokenFields.map((field) => `${normalizeFieldLabel(field.label)}=${field.value}`)
    )
  }

  if (input.checkpoint === "quotes") {
    const result = input.result
    if (!result) return null
    const queried = result.quoteProviderAudit
      .map((entry) => `${entry.providerId}(${entry.mode})`)
      .join(", ")
    const observed = result.routeCandidates
      .slice(0, 3)
      .map((route) => `${route.platform} ${route.quotedOutFormatted}`)
      .join(", ")
    const kept = result.routeExecutionReadiness
      .filter((item) => item.payloadReady)
      .map((item) => item.routeId)
      .join(", ")
    const held = result.routeExecutionReadiness
      .filter((item) => !item.payloadReady)
      .map((item) => item.routeId)
      .join(", ")
    const dropped = result.quoteProviderAudit
      .filter((item) => item.status !== "observed")
      .map((item) => `${item.providerId} (${item.reason ?? item.status})`)
      .join(", ")
    return [
      formatConsoleLine("quotes", [`queried=${queried || "none"}`]),
      formatConsoleLine("seen", [observed || "none"], observed ? "success" : "warn"),
      formatConsoleLine("kept", [kept || "none"], kept ? "success" : "warn"),
      held ? formatConsoleLine("hold", [held], "dim") : null,
      dropped ? formatConsoleLine("drop", [dropped], "warn") : null,
      formatConsoleLine("rule", ["kept=top quoted candidates built this round; native/buildable wins ties"], "dim")
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (input.checkpoint === "payload") {
    const result = input.result
    if (!result) return null
    const selectedRoute =
      result.routeCandidates.find((route) => route.id === result.defaultSelectedRouteId) ?? result.routeCandidates[0]
    const selectedPayload =
      result.payloadCandidates.find(
        (candidate) => candidate.platform === selectedRoute?.platform && candidate.routeFamily === selectedRoute?.routeFamily
      ) ?? result.payloadCandidates[0]
    if (!selectedRoute || !selectedPayload) return null
    return formatConsoleLine("payload", [
      `route=${selectedRoute.platform}`,
      `type=${selectedPayload.type}`,
      `sim=${selectedPayload.simulation.ok ? "ok" : "failed"}`,
      `gas=${selectedPayload.simulation.estimatedGas}`,
      `minOut=${selectedPayload.minOutAmount}`
    ])
  }

  if (input.checkpoint === "submission") {
    const result = input.result
    if (!result) return null
    const labels = result.submissionCandidates.map((candidate) => {
      const parts = [
        compactProviderName(candidate.providerName),
        candidate.liveStatus,
        candidate.verificationStatus,
        candidate.sourceType === "registry-backed" ? "registry" : null
      ].filter(Boolean)
      return parts.join(" ")
    })
    return formatConsoleLine("submit", labels)
  }

  if (input.checkpoint === "ready") {
    const result = input.result
    if (!result) return null
    const liveRoutes = result.routeExecutionReadiness.filter((item) => item.liveExecutable).map((item) => item.routeId)
    const readyMessage =
      result.recommendedHandoff === "private-rpc-handoff"
        ? "private raw-tx handoff ready"
        : result.recommendedHandoff === "builder-broadcast-handoff"
          ? "builder broadcast handoff ready"
          : liveRoutes.length
            ? "public wallet handoff ready"
            : "no live-executable route yet"
    const noteMessage =
      result.recommendedHandoff === "private-rpc-handoff" || result.recommendedHandoff === "builder-broadcast-handoff"
        ? "sign locally, then submit signed raw tx via private delivery"
        : "private paths observed and ranked, not live-integrated"
    return [
      formatConsoleLine(
        "ready",
        [readyMessage],
        readyMessage === "no live-executable route yet" ? "warn" : "success"
      ),
      formatConsoleLine("note", [noteMessage], "dim"),
      formatConsoleLine("boundary", ["planner builds/checks, user signs"], "dim")
    ].join("\n")
  }

  return null
}

export function createDashboardState(request: string, network: "bsc" | "bsc-testnet" = "bsc"): DashboardState {
  return {
    request,
    network,
    startedAtMs: Date.now(),
    phase: "parsing",
    quoteProviders: Object.fromEntries(
      DASHBOARD_QUOTE_ORDER.map((provider) => [provider, { status: "queued" } satisfies QuoteCellState])
    ),
    allowance: "pending",
    approval: { status: "pending", builders: {} },
    swap: { status: "pending", builders: {} },
    receipt: "pending",
    audit: "pending",
    agentSummary: "observing intent and waiting for quotes",
    signals: [],
    eventTail: []
  }
}

export function applyDashboardFailure(
  state: DashboardState,
  message: string,
  kind: DashboardFailureKind = "planning",
  stage: DashboardPlanningFailureStage = "unknown"
): DashboardState {
  const next = cloneDashboardState(state)
  next.phase = "failed"
  next.receipt = "failed"
  next.audit = kind === "execution" ? "pending" : "skipped"
  const failureVerdict = normalizeDashboardFailureVerdict(message, kind, stage)
  next.signals = [
    ...next.signals.filter((signal) => !signal.startsWith("verdict:")),
    `verdict:${failureVerdict}`
  ]
  const agentFailureSummary = buildAgentFailureSummary(message, kind, stage)
  if (agentFailureSummary) {
    next.agentSummary = agentFailureSummary
  }
  next.eventTail = []
  pushDashboardTail(next, normalizeDashboardFailureTail(message, kind, stage))
  return next
}

export function applyPlanningEventToDashboard(state: DashboardState, event: PlanningEvent): DashboardState {
  const next = cloneDashboardState(state)
  if (event.kind === "stage-failed") {
    const stage = normalizePlanningFailureStage(event.stage)
    if (stage === "payload-construction") {
      next.payloadSummary = buildPayloadSummaryFromValues("failed", undefined)
    }
    return applyDashboardFailure(next, event.message, "planning", stage)
  }
  if (event.kind === "plan-completed" && event.data?.result) {
    applyPlanningResultToDashboard(next, event.data.result)
    return next
  }
  next.phase = advanceDashboardPhase(next.phase, mapDashboardPhase(event.stage))
  const derivedAgentSummary = buildAgentSummaryFromEvent(next, event)
  if (derivedAgentSummary) {
    next.agentSummary = derivedAgentSummary
  }
  if (event.kind === "reasoning" && event.stage === "intent-parsing") {
    const action = event.data?.observations?.find((field) => field.label === "action")?.value
    const sell = event.data?.observations?.find((field) => field.label === "sell_token")?.value
    const buy = event.data?.observations?.find((field) => field.label === "buy_token")?.value
    const amount = event.data?.observations?.find((field) => field.label === "amount")?.value
    next.intent = [action, amount, sell, "->", buy].filter(Boolean).join(" ")
    if (sell && buy) {
      next.tokens = `${sell} -> ${buy}`
    }
  }
  if (event.kind === "tool-succeeded" && event.stage === "liquidity-discovery" && event.data?.toolName === "resolveToken") {
    const symbols = collectSymbolsFromDashboardEvent(next, event)
    if (symbols.length >= 2) {
      next.tokens = `${symbols[0]} -> ${symbols[1]}`
    }
  }
  if (event.data?.toolName === "getQuoteProvider") {
    const provider =
      event.data.outputPreview?.find((field) => field.label === "provider")?.value ??
      event.data.inputPreview?.find((field) => field.label === "provider")?.value
    if (provider) {
      const cell = next.quoteProviders[provider] ?? { status: "queued" as QuoteCellStatus }
      if (event.kind === "tool-started") {
        cell.status = "run"
      } else {
        const status = event.data.outputPreview?.find((field) => field.label === "status")?.value
        cell.status = status === "observed" ? "ok" : status === "empty" ? "empty" : "fail"
        const latency = event.data.outputPreview?.find((field) => field.label === "latency_ms")?.value
        cell.latencyMs = latency ? Number(latency) : undefined
        const quote = event.data.outputPreview?.find((field) => field.label === "best_quote")?.value
        cell.quotedOut = quote ?? cell.quotedOut
        const note = event.data.outputPreview?.find((field) => field.label === "reason")?.value
        cell.note = note
      }
      next.quoteProviders[provider] = cell
    }
  }
  if (event.kind === "tool-succeeded" && event.stage === "liquidity-discovery" && event.data?.toolName === "getQuoteCandidates") {
    const seen = event.data.outputPreview?.find((field) => field.label === "seen")?.value
    const bestQuote = parseBestQuoteSummary(seen)
    next.bestQuote = bestQuote?.summary ?? next.bestQuote
    next.bestQuoteRoute = bestQuote?.route ?? next.bestQuoteRoute
  }
  if ((event.kind === "tool-succeeded" || event.kind === "tool-failed") && event.stage === "payload-construction" && event.data?.toolName === "simulateTransaction") {
    const result = event.data.outputPreview?.find((field) => field.label === "result")?.value ??
      (event.kind === "tool-succeeded" ? "ok" : "failed")
    const gas = event.data.outputPreview?.find((field) => field.label === "estimated_gas")?.value
    next.payloadSummary = buildPayloadSummaryFromValues(normalizeDashboardSimulationStatus(result), gas)
  }
  if (event.kind === "tool-succeeded" && event.stage === "liquidity-discovery" && event.data?.toolName === "checkAllowance") {
    const status = event.data.outputPreview?.find((field) => field.label === "allowance")?.value ?? "unknown"
    const spender = event.data.outputPreview?.find((field) => field.label === "spender")?.value
    const current = event.data.outputPreview?.find((field) => field.label === "current")?.value
    const required = event.data.outputPreview?.find((field) => field.label === "required")?.value
    const token = state.intent?.split(" ").filter(Boolean).at(-3) ?? state.tokens?.split("->")[0]?.trim()
    next.allowance = formatDashboardAllowance({
      status,
      token,
      spender,
      current,
      required
    })
  }
  pushDashboardTail(next, formatCliStreamingEvent(event))
  return next
}

export function applyExecutionTraceToDashboard(state: DashboardState, trace: string): DashboardState {
  const next = cloneDashboardState(state)
  next.phase = advanceDashboardPhase(next.phase, "submitting")
  if (trace.startsWith("delivery path selected ")) {
    next.signals = upsertSignal(next.signals, `path:${normalizeDashboardPath(trace.replace("delivery path selected ", ""))}`)
  } else if (trace.startsWith("builder targets ")) {
    next.signals = upsertSignal(next.signals, trace)
  } else if (trace.startsWith("allowance check ")) {
    next.allowance = sanitizeAllowanceTrace(trace.replace("allowance check ", ""), state.tokens)
  } else if (trace === "approval required") {
    next.approval.status = "approve needed"
  } else if (trace.startsWith("approval signing ")) {
    next.approval.status = "signing"
    const nonce = trace.match(/nonce=(\d+)/)?.[1]
    const gas = trace.match(/gas=(\d+)/)?.[1]
    next.approval.nonce = nonce
    next.approval.gas = gas
  } else if (trace.startsWith("approval submit ")) {
    applySubmissionTrace(next.approval, trace, "approval submit ")
  } else if (trace.startsWith("approval receipt ")) {
    next.approval.status = trace.includes("success") ? "confirmed" : "pending"
    next.receipt = sanitizeReceiptTrace(trace.replace("approval receipt ", "approval "))
    next.approval.blocks = trace.match(/blocks=(\d+)/)?.[1]
    next.approval.wall = trace.match(/wall=(\d+ms)/)?.[1]
  } else if (trace.startsWith("swap signing ")) {
    next.swap.status = "signing"
    const nonce = trace.match(/nonce=(\d+)/)?.[1]
    const gas = trace.match(/gas=(\d+)/)?.[1]
    next.swap.nonce = nonce
    next.swap.gas = gas
  } else if (trace.startsWith("swap submit ")) {
    applySubmissionTrace(next.swap, trace, "swap submit ")
  } else if (trace.startsWith("swap receipt ")) {
    next.swap.status = trace.includes("success") ? "confirmed" : "pending"
    next.receipt = sanitizeReceiptTrace(trace.replace("swap receipt ", "swap "))
    next.swap.blocks = trace.match(/blocks=(\d+)/)?.[1]
    next.swap.wall = trace.match(/wall=(\d+ms)/)?.[1]
    next.phase = advanceDashboardPhase(next.phase, trace.includes("success") ? "confirmed" : "submitting")
  }
  pushDashboardTail(next, trace)
  return next
}

export function finalizeDashboardFromExecution(
  state: DashboardState,
  result: PlanningResult,
  execution?: SwapExecutionSummary
): DashboardState {
  const next = cloneDashboardState(state)
  next.phase = execution ? "confirmed" : next.phase
  applyPlanningResultToDashboard(next, result)
  const selectedRoute =
    result.routeCandidates.find((route) => route.id === result.recommendedPlan.routeId) ?? result.routeCandidates[0]
  if (result.allowanceCheck) {
    next.allowance = formatDashboardAllowance({
      status: result.allowanceCheck.status,
      token: result.allowanceCheck.token ?? result.intent.sellToken ?? undefined,
      spender: result.allowanceCheck.spender,
      current: result.allowanceCheck.currentAllowance,
      required: result.allowanceCheck.requiredAmount
    })
  }
  const audit = execution?.swap?.audit ?? execution?.audit
  if (audit) {
    const decimals = inferDecimalsFromQuote(selectedRoute?.quotedOut ?? "", selectedRoute?.quotedOutFormatted ?? "")
    next.audit = buildDashboardAuditSummary(result, audit, decimals)
    next.qualitySummary = buildQualitySummary({
      realizedOut: audit.realizedOut,
      expectedQuoteOut: audit.expectedQuoteOut,
      protectedMinOut: audit.protectedMinOut
    })
    next.receipt = [
      audit.status === "success" ? "confirmed" : audit.status,
      audit.submittedBlockNumber ? `from=${audit.submittedBlockNumber}` : null,
      audit.blockNumber != null ? `block=${audit.blockNumber}` : null,
      audit.submittedAt ? `submitted=${formatIsoTimestampCompact(audit.submittedAt)}` : null,
      audit.confirmedAt ? `at=${formatIsoTimestampCompact(audit.confirmedAt)}` : null,
      audit.inclusionBlockDelta != null ? formatBlockCount(String(audit.inclusionBlockDelta)) : null,
      audit.inclusionWallClockMs != null ? `wall=${formatTraceDuration(audit.inclusionWallClockMs)}` : null
    ].filter(Boolean).join(" | ")
  }
  const swapTxHash = execution?.swap?.submission?.txHash ?? execution?.submission?.txHash
  next.explorerUrl = swapTxHash ? buildExplorerTxUrl(state.network, swapTxHash) : next.explorerUrl
  next.signals = [
    ...next.signals.filter((signal) => !signal.startsWith("verdict:")),
    `verdict:${buildExecutionVerdict(result, audit)}`
  ]
  return next
}

export function renderDashboard(state: DashboardState): string {
  const elapsedMs = Math.max(0, Date.now() - state.startedAtMs)
  const quoteCells = DASHBOARD_QUOTE_ORDER.map((provider) =>
    formatQuoteCell(provider, state.quoteProviders[provider] ?? { status: "queued" })
  )
  const quoteCounts = countQuoteStatuses(state)
  const approvalBuilders = renderBuilderMatrix(state.approval.builders)
  const swapBuilders = renderBuilderMatrix(state.swap.builders)
  const pathSignal = state.signals.find((signal) => signal.startsWith("path:"))?.replace("path:", "")
  const verdictSignal = state.signals.find((signal) => signal.startsWith("verdict:"))?.replace("verdict:", "")
  const phase = normalizeDashboardPhaseLabel(state.phase)
  const allowance = state.allowance ?? "pending"
  const approvalStatus =
    allowance === "native token" ? "skipped (native token)" : (state.approval.status ?? "pending")
  const approvalMeta = [
    approvalStatus,
    state.approval.nonce ? `nonce=${state.approval.nonce}` : null,
    state.approval.gas ? `gas=${displayGas(state.approval.gas)}` : null,
    state.approval.submittedAt ? `at=${formatIsoTimestampCompact(state.approval.submittedAt)}` : null,
    state.approval.submittedBlockNumber ? `block=${state.approval.submittedBlockNumber}` : null,
    state.approval.blocks ? formatBlockCount(state.approval.blocks) : null,
    state.approval.wall ? `wall=${state.approval.wall}` : null,
    state.approval.accepted ? `accepted=${state.approval.accepted}` : null,
    state.approval.txHash ? `tx=${state.approval.txHash}` : null
  ]
    .filter(Boolean)
    .join(" | ")
  const swapMeta = [
    state.swap.status ?? "idle",
    state.swap.nonce ? `nonce=${state.swap.nonce}` : null,
    state.swap.gas ? `gas=${displayGas(state.swap.gas)}` : null,
    state.swap.submittedAt ? `at=${formatIsoTimestampCompact(state.swap.submittedAt)}` : null,
    state.swap.submittedBlockNumber ? `block=${state.swap.submittedBlockNumber}` : null,
    state.swap.blocks ? formatBlockCount(state.swap.blocks) : null,
    state.swap.wall ? `wall=${state.swap.wall}` : null,
    state.swap.accepted ? `accepted=${state.swap.accepted}` : null,
    state.swap.txHash ? `tx=${state.swap.txHash}` : null
  ]
    .filter(Boolean)
    .join(" | ")
  const tail = trimEventTail(state.eventTail)
  const lines = [
    colorize(asciiRule("LIVE SWAP"), "label"),
    `${colorize("request".padEnd(10), "label")} ${state.request}`,
    `${colorize("overview".padEnd(10), "label")} ${colorize(`phase=${phase}`, dashboardPhaseTone(phase))} | ${colorize(`path=${pathSignal ?? "pending"}`, dashboardPathTone(pathSignal))} | ${colorize(`elapsed=${formatTraceDuration(elapsedMs)}`, "dim")} | ${colorize(`route=${state.selectedRoute ?? "pending"}`, state.selectedRoute ? "success" : "dim")}`,
    colorize(asciiRule("MARKET"), "label"),
    `${colorize("intent".padEnd(10), "label")} ${state.intent ?? colorize("parsing...", "dim")}`,
    `${colorize("tokens".padEnd(10), "label")} ${state.tokens ?? colorize("resolving...", "dim")}`,
    wrapCells(quoteCells),
    `${colorize("quotes".padEnd(10), "label")} ${colorize(`ok=${quoteCounts.ok}`, "success")} | ${colorize(`fail=${quoteCounts.failed}`, quoteCounts.failed ? "warn" : "dim")} | ${colorize(state.bestQuote ?? "best observed=waiting...", state.bestQuote ? "success" : "dim")}`,
    state.decisionSummary ? `${colorize("decision".padEnd(10), "label")} ${colorizedDecisionSummary(state.decisionSummary)}` : null,
    state.agentSummary ? `${colorize("agent".padEnd(10), "label")} ${colorizedAgentSummary(state.agentSummary)}` : null,
    `${colorize("payload".padEnd(10), "label")} ${colorize(`route=${state.selectedRoute ?? "pending"}`, state.selectedRoute ? "success" : "dim")} | ${colorizedPayloadSummary(state.payloadSummary)}`,
    state.guardSummary ? `${colorize("guard".padEnd(10), "label")} ${colorizedGuardSummary(state.guardSummary)}` : null,
    `${colorize("allowance".padEnd(10), "label")} ${colorizedAllowanceSummary(allowance)}`,
    colorize(asciiRule("EXECUTION"), "label"),
    `${colorize("approval".padEnd(10), "label")} ${colorizedStatusSummary(approvalMeta || "pending")}`,
    allowance === "native token" ? null : `${colorize("builders".padEnd(10), "label")} ${colorizedBuilderLine(approvalBuilders)}`,
    `${colorize("swap".padEnd(10), "label")} ${colorizedStatusSummary(swapMeta || "pending")}`,
    `${colorize("builders".padEnd(10), "label")} ${colorizedBuilderLine(swapBuilders)}`,
    colorize(asciiRule("RESULT"), "label"),
    `${colorize("receipt".padEnd(10), "label")} ${colorizedReceiptSummary(state.receipt ?? "pending")}`,
    `${colorize("audit".padEnd(10), "label")} ${colorizedAuditSummary(state.audit ?? "pending")}`,
    state.qualitySummary ? `${colorize("quality".padEnd(10), "label")} ${colorizedQualitySummary(state.qualitySummary)}` : null,
    `${colorize("verdict".padEnd(10), "label")} ${colorizedVerdictSummary(verdictSignal, state.phase, pathSignal)}`,
    state.explorerUrl ? `${colorize("explorer".padEnd(10), "label")} ${colorize(state.explorerUrl, "success")}` : null,
    colorize(asciiRule("TAIL"), "label"),
    ...(tail.length ? tail : ["waiting..."])
  ].filter(Boolean) as string[]
  return lines.join("\n")
}

function normalizeToolName(toolName: string): string {
  const normalized: Record<string, string> = {
    resolveToken: "Resolve token metadata",
    getQuoteCandidates: "Look up routes",
    encodeRouterCalldata: "Build swap payload",
    simulateTransaction: "Simulate selected payload",
    listSubmissionCandidates: "Check submission options",
    summarizeStageWithLLM: "Summarize stage"
  }

  return normalized[toolName] ?? toolName
}

function latestReasoning(
  events: PlanningEvent[],
  stages: PlanningEvent["stage"][]
): PlanningEvent | undefined {
  const relevant = events.filter((event) => stages.includes(event.stage) && event.kind === "reasoning")
  return [...relevant].reverse().find((event) => event.data?.reasoningSource === "llm") ?? relevant.at(-1)
}

function collectFields(
  events: PlanningEvent[],
  stages: PlanningEvent["stage"][],
  allowedLabels?: string[]
): DecisionTraceField[] {
  return events
    .filter((event) => stages.includes(event.stage))
    .flatMap((event) => [
      ...(event.data?.observations ?? []),
      ...(event.data?.outputPreview ?? []),
      ...(event.data?.inputPreview ?? [])
    ])
    .filter((field) => !allowedLabels || allowedLabels.includes(field.label))
}

function normalizeFieldLabel(value: string): string {
  return value.replaceAll("_", " ")
}

function readinessLabelForRoute(result: PlanningResult, routeId: string): string {
  const readiness = result.routeExecutionReadiness.find((item) => item.routeId === routeId)
  if (!readiness) {
    return "observed"
  }
  const labels = ["observed"]
  if (readiness.payloadReady) {
    labels.push("buildable")
  } else {
    labels.push("quote-only")
  }
  if (readiness.simulationOk) {
    labels.push("simulated")
  }
  if (readiness.liveExecutable) {
    labels.push("live-executable")
  }
  return labels.join(", ")
}

function colorize(text: string, tone: "label" | "active" | "success" | "warn" | "error" | "dim" | "plain" = "plain"): string {
  const codes: Record<typeof tone, string> = {
    label: "\u001b[36m",
    active: "\u001b[34m",
    success: "\u001b[32m",
    warn: "\u001b[33m",
    error: "\u001b[31m",
    dim: "\u001b[90m",
    plain: ""
  }
  const reset = "\u001b[0m"
  return codes[tone] ? `${codes[tone]}${text}${reset}` : text
}

function formatConsoleLine(
  label: string,
  parts: string[],
  tone: "active" | "success" | "warn" | "error" | "dim" | "plain" = "plain"
): string {
  return `${colorize(label.padEnd(7), "label")} ${colorize(parts.filter(Boolean).join(" | "), tone)}`
}

function classifyQuoteFreshness(observedAt: string): "fresh" | "stale" {
  const ageMs = Date.now() - Date.parse(observedAt)
  return Number.isFinite(ageMs) && ageMs > 20_000 ? "stale" : "fresh"
}

function deriveAutoSlippageLabel(priceImpactPct: number): string {
  if (priceImpactPct <= 0.3) return "<=0.3%"
  if (priceImpactPct <= 1) return "<=1%"
  return ">1%"
}

function compactReasoning(message: string): string {
  const compacted = message.replace(/\s+/g, " ").trim()
  return compacted.length > 100 ? `${compacted.slice(0, 97)}...` : compacted
}

function normalizeCliReason(reason: string | undefined): string {
  if (!reason) return "failed"
  const normalized = reason.toLowerCase()
  if (normalized.includes("unsupported-pair")) return "unsupported-pair"
  if (normalized.includes("api-key-missing")) return "api-key-missing"
  if (normalized.includes("network-unsupported")) return "network-unsupported"
  if (normalized.includes("onchain-read-failed")) return "onchain-read-failed"
  if (normalized.includes("quote-api-error")) return "quote-api-error"
  if (normalized.includes("no-route")) return "no-route"
  if (normalized.includes("empty")) return "empty-quote"
  return "quote-failed"
}

function compactProviderName(name: string): string {
  return name
    .replace("Public wallet broadcast", "public")
    .replace("Private validator RPC", "private")
    .replace("Builder relay", "builder")
    .replace("CoW-style intent server", "intent")
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function shortAmount(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function formatTxValue(value: string, symbol?: string): string {
  if (value === "0") return symbol ? `0 ${symbol}` : "0"
  return symbol ? `${Number(value) / 1e18} ${symbol}` : value
}

function formatUnits(raw: string, decimals: number): string {
  const normalized = raw.replace(/^(-?)(\d+)$/, "$1$2")
  const sign = normalized.startsWith("-") ? "-" : ""
  const digits = sign ? normalized.slice(1) : normalized
  const padded = digits.padStart(decimals + 1, "0")
  const head = padded.slice(0, -decimals) || "0"
  const tail = padded.slice(-decimals).replace(/0+$/, "")
  return tail ? `${sign}${head}.${tail}` : `${sign}${head}`
}

function trimFloat(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

function inferDecimalsFromQuote(raw: string, formatted: string): number | null {
  const numeric = formatted.split(" ")[0]?.trim()
  if (!numeric) return null
  for (let decimals = 0; decimals <= 36; decimals += 1) {
    if (trimFloat(formatUnits(raw, decimals)) === numeric) {
      return decimals
    }
  }
  return null
}

function formatAuditAmount(raw: string, decimals: number | null, symbol: string): string {
  if (decimals == null) {
    return `${shortAmount(raw)} ${symbol}`
  }
  return `${trimFloat(formatUnits(raw, decimals))} ${symbol}`
}

function formatSignedAuditDelta(raw: string, decimals: number | null, symbol: string): string {
  if (decimals == null) {
    const prefix = raw.startsWith("-") ? "" : "+"
    return `${prefix}${shortAmount(raw)} ${symbol}`
  }
  const formatted = trimFloat(formatUnits(raw, decimals))
  const prefix = formatted.startsWith("-") ? "" : "+"
  return `${prefix}${formatted} ${symbol}`
}

function displayGas(value: string | undefined): string {
  if (!value || value === "0") return "unknown"
  return value
}

function cloneDashboardState(state: DashboardState): DashboardState {
  return {
    ...state,
    quoteProviders: Object.fromEntries(
      Object.entries(state.quoteProviders).map(([key, value]) => [key, { ...value }])
    ),
    approval: {
      ...state.approval,
      builders: Object.fromEntries(Object.entries(state.approval.builders).map(([key, value]) => [key, { ...value }]))
    },
    swap: {
      ...state.swap,
      builders: Object.fromEntries(Object.entries(state.swap.builders).map(([key, value]) => [key, { ...value }]))
    },
    signals: [...state.signals],
    eventTail: [...state.eventTail]
  }
}

function applyPlanningResultToDashboard(state: DashboardState, result: PlanningResult) {
  const selectedRoute =
    result.routeCandidates.find((route) => route.id === result.recommendedPlan.routeId) ?? result.routeCandidates[0]
  const bestQuoteRoute =
    result.routeCandidates.find((route) => route.id === result.priceImpactAssessment.bestQuotedRouteId) ??
    result.routeCandidates[0]
  state.selectedRoute = selectedRoute?.platform ?? state.selectedRoute
  state.selectedQuoteSummary = selectedRoute ? `${selectedRoute.platform} ${selectedRoute.quotedOutFormatted}` : state.selectedQuoteSummary
  state.bestQuote = bestQuoteRoute ? `best observed=${bestQuoteRoute.platform} ${bestQuoteRoute.quotedOutFormatted}` : state.bestQuote
  state.bestQuoteRoute = bestQuoteRoute?.platform ?? state.bestQuoteRoute
  state.decisionSummary = buildDecisionSummary(result, bestQuoteRoute, selectedRoute)
  state.agentSummary = buildAgentSummaryFromResult(result, bestQuoteRoute, selectedRoute)
  state.payloadSummary = buildPayloadSummary(result, selectedRoute)
  state.guardSummary = buildGuardSummary(result, selectedRoute)
}

function collectSymbolsFromDashboardEvent(state: DashboardState, event: PlanningEvent): string[] {
  const current = state.tokens?.split("->").map((item) => item.trim()).filter(Boolean) ?? []
  const symbol = event.data?.outputPreview?.find((field) => field.label === "symbol")?.value
  if (!symbol) return current
  return [...current, symbol].slice(0, 2)
}

function pushDashboardTail(state: DashboardState, line: string | null | undefined) {
  if (!line) return
  const normalizedLines = normalizeDashboardTailLines(line)
  if (!normalizedLines.length) return
  state.eventTail.push(...normalizedLines)
  if (state.eventTail.length > 5) {
    state.eventTail.splice(0, state.eventTail.length - 5)
  }
}

function upsertSignal(signals: string[], value: string): string[] {
  const key = value.split(":")[0]
  const next = signals.filter((signal) => signal.split(":")[0] !== key)
  next.push(value)
  return next
}

function applySubmissionTrace(phase: DashboardPhaseState, trace: string, prefix: string) {
  const started = trace.match(/^.+ started at=([^ ]+) block=([0-9]+)/)
  if (started) {
    phase.status = "submitting"
    phase.wall = undefined
    phase.blocks = undefined
    phase["submittedAt"] = started[1]
    phase["submittedBlockNumber"] = started[2]
    return
  }
  const summary = trace.match(/^.+ accepted (\d+\/\d+) txHash=(0x[a-fA-F0-9]+)/)
  if (summary) {
    phase.status = "submitted"
    phase.accepted = summary[1]
    phase.txHash = shortAddress(summary[2])
    return
  }
  const match = trace.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^ ]+) (accepted|rejected) (\\d+)ms(?: (.+))?$`))
  if (!match) return
  const [, builder, outcome, latency, reason] = match
  phase.builders[builder] = {
    status:
      outcome === "accepted"
        ? "accepted"
        : reason === "already-known"
          ? "duplicate"
          : reason === "timeout"
            ? "timeout"
            : "rejected",
    latencyMs: Number(latency)
  }
}

function renderBuilderMatrix(builders: Record<string, BuilderCellState>): string {
  const entries = Object.entries(builders)
  if (!entries.length) return "ap idle | eu idle | us idle"
  return entries
    .map(([name, state]) => {
      const status = state.status === "duplicate" ? "dup" : state.status
      return `${compactBuilderName(name)}:${status}${state.latencyMs != null ? ` ${formatTraceDuration(Math.max(0, state.latencyMs))}` : ""}`
    })
    .join(" | ")
}

function wrapCells(cells: string[]): string {
  const rows: string[] = []
  for (let index = 0; index < cells.length; index += 3) {
    rows.push([cells[index], cells[index + 1], cells[index + 2]].filter(Boolean).join(" | "))
  }
  return rows.join("\n")
}

function asciiRule(title: string): string {
  return `+ ${title} ${"-".repeat(Math.max(0, 88 - title.length))}`
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "")
}

function formatTraceDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function compactBuilderName(name: string): string {
  return name
    .replace("48club-puissant-builder-", "")
    .replace("builder0x69-", "")
    .replace("bloxroute-", "bx-")
    .replace("node-real-", "nr-")
}

function compactProviderNameForDashboard(name: string): string {
  const map: Record<string, string> = {
    openoceanv2: "openocean",
    pancakeswap: "pancake",
    paraswap: "paraswap",
    thena: "thena",
    woofi: "woofi",
    matcha: "matcha",
    "1inch": "1inch"
  }
  return map[name] ?? name
}

function formatQuoteCell(name: string, state: QuoteCellState): string {
  const shortName = compactProviderNameForDashboard(name).padEnd(10).slice(0, 10)
  const latency = state.latencyMs != null ? ` ${formatTraceDuration(Math.max(0, state.latencyMs))}` : ""
  if (state.status === "queued") return `${colorize(shortName, "label")} ${colorize("queued", "dim")}`
  if (state.status === "run") return `${colorize(shortName, "label")} ${colorize("run", "active")}`
  if (state.status === "empty") return `${colorize(shortName, "label")} ${colorize(`empty${latency}`, "warn")}`
  if (state.status === "fail") return `${colorize(shortName, "label")} ${colorize(`fail${latency}`, "error")}`
  return `${colorize(shortName, "label")} ${colorize(`ok${latency}`, "success")}`
}

function countQuoteStatuses(state: DashboardState): { ok: number; failed: number; running: number } {
  return Object.values(state.quoteProviders).reduce(
    (acc, item) => {
      if (item.status === "ok") acc.ok += 1
      if (item.status === "fail" || item.status === "empty") acc.failed += 1
      if (item.status === "run") acc.running += 1
      return acc
    },
    { ok: 0, failed: 0, running: 0 }
  )
}

function formatBlockCount(value: string | undefined): string | null {
  if (!value) return null
  const count = Number(value)
  if (!Number.isFinite(count)) return `${value} blocks`
  return `${count} block${count === 1 ? "" : "s"}`
}

function trimEventTail(eventTail: string[]): string[] {
  return eventTail
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.length > 112 ? `${line.slice(0, 109)}...` : line)
}

function mapDashboardPhase(stage: string): DashboardPhase {
  if (stage === "intent-parsing" || stage === "execution-family-selection") return "parsing"
  if (stage === "liquidity-discovery") return "quoting"
  if (stage === "payload-construction") return "simulating"
  if (stage === "submission-strategy") return "deciding"
  return "parsing"
}

function normalizeDashboardPhaseLabel(value: string): DashboardPhase {
  if (["parsing", "quoting", "simulating", "deciding", "submitting", "confirmed", "failed"].includes(value)) {
    return value as DashboardPhase
  }
  return "parsing"
}

function advanceDashboardPhase(current: DashboardPhase, next: DashboardPhase): DashboardPhase {
  const currentIndex = DASHBOARD_PHASE_ORDER.indexOf(normalizeDashboardPhaseLabel(current) as (typeof DASHBOARD_PHASE_ORDER)[number])
  const nextIndex = DASHBOARD_PHASE_ORDER.indexOf(normalizeDashboardPhaseLabel(next) as (typeof DASHBOARD_PHASE_ORDER)[number])
  return nextIndex > currentIndex ? next : normalizeDashboardPhaseLabel(current)
}

function normalizeDashboardPath(value: string): string {
  if (value === "builder-private" || value === "builder-broadcast-handoff") return "private builders"
  if (value === "validator-private" || value === "private-rpc-handoff") return "private validators"
  if (value === "public-wallet") return "public"
  return value
}

function sanitizeBestQuoteSummary(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.split(",")[0]?.trim() || value
}

function parseBestQuoteSummary(value: string | undefined): { route?: string; summary?: string } | undefined {
  const summary = sanitizeBestQuoteSummary(value)
  if (!summary) return undefined
  const route = summary.split(" ")[0]?.trim()
  return { route, summary }
}

function normalizeDashboardSimulationStatus(value: string): string {
  if (value === "approval-required") return "approve-needed"
  if (value === "ok") return "ok"
  if (value === "failed") return "failed"
  return "unknown"
}

function formatDashboardAllowance(input: {
  status: string
  token?: string
  spender?: string
  current?: string
  required?: string
}): string {
  if (input.status === "not-applicable") {
    return "native token"
  }
  const label =
    input.status === "approve-required"
      ? "approve needed"
      : input.status === "ok"
        ? "ok"
        : input.status === "unavailable"
          ? "unavailable"
          : input.status
  const token = input.token ?? "token"
  const amount = input.required ? `${shortAmount(input.required)} ${token}` : null
  return [label, input.spender ? `spender=${shortAddress(input.spender)}` : null, amount ? `amount=${amount}` : null]
    .filter(Boolean)
    .join(" | ")
}

function sanitizeAllowanceTrace(value: string, tokens?: string): string {
  const spender = value.match(/spender=([^ ]+)/)?.[1]
  const current = value.match(/current=([^ ]+)/)?.[1]
  const required = value.match(/required=([^ ]+)/)?.[1]
  const token = tokens?.split("->")[0]?.trim()
  const status =
    current && required
      ? BigInt(current) >= BigInt(required)
        ? "ok"
        : "approve-required"
      : "approve-required"
  return formatDashboardAllowance({
    status,
    token,
    spender,
    current,
    required
  })
}

function sanitizeReceiptTrace(value: string): string {
  const cleaned = value
    .replace(/^swap /, "")
    .replace(/^approval /, "")
    .replace("success", "confirmed")
  const block = cleaned.match(/block=([0-9]+)/)?.[1]
  const blocks = cleaned.match(/(?:^| )([0-9]+) blocks?/)?.[1] ?? cleaned.match(/blocks=([0-9]+)/)?.[1]
  const wall = cleaned.match(/wall=([0-9]+ms)/)?.[1] ?? cleaned.match(/([0-9.]+s|[0-9]+ms)/)?.[1]
  const submittedBlock = cleaned.match(/from=([0-9]+)/)?.[1]
  const submittedAt = cleaned.match(/submitted=([^ ]+)/)?.[1]
  const confirmedAt = cleaned.match(/at=([^ ]+)/)?.[1]
  const status = cleaned.includes("confirmed") ? "confirmed" : "pending"
  return [
    status,
    submittedBlock ? `from=${submittedBlock}` : null,
    block ? `block=${block}` : null,
    submittedAt ? `submitted=${formatIsoTimestampCompact(submittedAt)}` : null,
    confirmedAt ? `at=${formatIsoTimestampCompact(confirmedAt)}` : null,
    blocks ? formatBlockCount(blocks) : null,
    wall ? `wall=${wall}` : null
  ]
    .filter(Boolean)
    .join(" | ")
}

function buildBestVsSelectedSummary(
  bestQuoteRoute: PlanningResult["routeCandidates"][number] | undefined,
  selectedRoute: PlanningResult["routeCandidates"][number] | undefined
): string | undefined {
  if (!bestQuoteRoute || !selectedRoute) return undefined
  const selectedSummary = `selected=${selectedRoute.platform} ${selectedRoute.quotedOutFormatted}`
  if (bestQuoteRoute.id === selectedRoute.id) {
    return selectedSummary
  }
  const decimals =
    inferDecimalsFromQuote(bestQuoteRoute.quotedOut, bestQuoteRoute.quotedOutFormatted) ??
    inferDecimalsFromQuote(selectedRoute.quotedOut, selectedRoute.quotedOutFormatted)
  const deltaRaw = (BigInt(selectedRoute.quotedOut) - BigInt(bestQuoteRoute.quotedOut)).toString()
  const deltaAmount = formatSignedAuditDelta(deltaRaw, decimals, extractQuoteSymbol(bestQuoteRoute.quotedOutFormatted))
  const bps = computeSignedBps(BigInt(selectedRoute.quotedOut), BigInt(bestQuoteRoute.quotedOut))
  return `${selectedSummary} | delta vs best=${deltaAmount} (${formatSignedBps(bps)})`
}

function buildGuardSummary(
  result: PlanningResult,
  selectedRoute: PlanningResult["routeCandidates"][number] | undefined
): string | undefined {
  if (!selectedRoute) return undefined
  return [
    `impact=${selectedRoute.priceImpactPct.toFixed(3)}%`,
    `slippage=${result.effectiveSlippageBps}bps`,
    `quote=${result.quoteFreshness}`
  ].join(" | ")
}

function buildSelectedRouteReason(result: PlanningResult): string | undefined {
  const code = result.selectionReasonCode
  if (!code) {
    if (result.bestQuoteRouteId && result.recommendedPlan.routeId !== result.bestQuoteRouteId) {
      if (result.bestReadyRouteId === result.recommendedPlan.routeId) return "simulation winner"
      return "execution package winner"
    }
    return undefined
  }
  if (code === "best-quote-also-selected") return undefined
  const map: Record<NonNullable<PlanningResult["selectionReasonCode"]>, string> = {
    "best-quote-also-selected": "best quote also selected",
    "simulation-winner": "simulation winner",
    "private-path-winner": "private path winner",
    "execution-package-winner": "execution package winner",
    "quote-winner-not-buildable": "quote winner not buildable",
    "quote-winner-not-simulated": "quote winner not simulated"
  }
  return map[code]
}

function buildDecisionSummary(
  result: PlanningResult,
  bestQuoteRoute: PlanningResult["routeCandidates"][number] | undefined,
  selectedRoute: PlanningResult["routeCandidates"][number] | undefined
): string | undefined {
  if (!selectedRoute) return undefined
  const finalists =
    result.finalistsRouteIds?.length
      ? `finalists=${result.finalistsRouteIds.join(",")}`
      : null
  const policy = finalists ? "policy=top-3 quote" : null
  if (!bestQuoteRoute || bestQuoteRoute.id === selectedRoute.id) {
    return [finalists, `predicted winner=${selectedRoute.platform}`, "quote leader matched", policy]
      .filter(Boolean)
      .join(" | ")
  }
  const compare = buildBestVsSelectedSummary(bestQuoteRoute, selectedRoute)
  const compareDelta = compare?.split(" | ").slice(1).join(" | ")
  return [
    finalists,
    `predicted winner=${selectedRoute.platform}`,
    compareDelta,
    `reason=${buildSelectedRouteReason(result) ?? "execution package winner"}`,
    policy
  ]
    .filter(Boolean)
    .join(" | ")
}

function buildAgentSummaryFromResult(
  result: PlanningResult,
  bestQuoteRoute: PlanningResult["routeCandidates"][number] | undefined,
  selectedRoute: PlanningResult["routeCandidates"][number] | undefined
): string | undefined {
  if (!selectedRoute) return undefined
  const finalists = result.finalistsRouteIds?.join(",")
  const reason = buildSelectedRouteReason(result)
  const finalistSummary = buildCompactFinalistSummary(result)
  if (!bestQuoteRoute || bestQuoteRoute.id === selectedRoute.id) {
    return [
      finalistSummary ? `observed ${result.routeCandidates.length} routes; ${finalistSummary}` : null,
      `simulation kept ${selectedRoute.platform} as the quote leader`
    ]
      .filter(Boolean)
      .join(" | ")
  }
  return [
    finalistSummary,
    `selected ${selectedRoute.platform} after simulation${reason ? ` because ${reason}` : ""}`
  ]
    .filter(Boolean)
    .join(" | ")
}

function buildAgentSummaryFromEvent(state: DashboardState, event: PlanningEvent): string | undefined {
  if ((event.kind === "tool-succeeded" || event.kind === "tool-failed") && event.stage === "liquidity-discovery" && event.data?.toolName === "getQuoteProvider") {
    const ok = Object.values(state.quoteProviders).filter((value) => value.status === "ok").length
    const done = Object.values(state.quoteProviders).filter((value) => value.status === "ok" || value.status === "fail" || value.status === "empty").length
    const total = Object.keys(state.quoteProviders).length
    if (!done) return undefined
    if (done < total) {
      return `observed ${ok} viable quotes so far; waiting to keep the top-3 by quoted output`
    }
    return `observed ${ok} viable quotes; keeping the top-3 by quoted output`
  }
  if (event.kind === "reasoning" && event.stage === "route-comparison") {
    const decision = event.data?.decision ?? ""
    const keptMatch = decision.match(/Keep (.+?) for payload preparation/i)
    const kept = keptMatch?.[1]?.trim()
    const allObserved = Object.entries(state.quoteProviders)
      .filter(([, value]) => value.status === "ok")
      .map(([provider]) => compactProviderNameForDashboard(provider))
    const excluded = kept
      ? allObserved.filter(
          (provider) => !kept.split(",").map((item) => compactProviderNameForDashboard(item.trim())).includes(provider)
        )
      : []
    return [
      kept ? `kept ${kept} as top-3 quoted routes` : null,
      excluded.length ? `excluded ${excluded.join(",")} outside top-3 quote and not simulated this round` : null
    ]
      .filter(Boolean)
      .join(" | ")
  }
  if (event.kind === "tool-started" && event.stage === "payload-construction" && event.data?.toolName === "encodeRouterCalldata") {
    const finalists = state.decisionSummary?.match(/finalists=([^|]+)/)?.[1]?.trim()
    return finalists
      ? `simulating finalists=${finalists} for gas and buildability`
      : "simulating finalists for gas and buildability"
  }
  if (event.kind === "stage-completed" && event.stage === "payload-construction") {
    const winner = state.selectedRoute
    return winner ? `${winner} remained viable after simulation and gas checks` : undefined
  }
  if (event.kind === "tool-succeeded" && event.stage === "submission-strategy" && event.data?.toolName === "getSubmissionPaths") {
    const live = event.data.outputPreview?.find((field) => field.label === "live")?.value
    if (!live) return undefined
    return `using ${normalizeDashboardPath(live)} because that submission path is live`
  }
  if (event.kind === "stage-completed" && event.stage === "submission-strategy") {
    const pathSignal = state.signals.find((signal) => signal.startsWith("path:"))?.slice(5)
    return pathSignal ? `using ${pathSignal} because that submission path is live` : "submission path scored and ready"
  }
  return undefined
}

function buildPayloadSummary(
  result: PlanningResult,
  selectedRoute: PlanningResult["routeCandidates"][number] | undefined
): string {
  const payloadCandidate =
    result.payloadCandidates.find((candidate) => candidate.id === result.recommendedPlan.payloadId) ??
    result.payloadCandidates.find((candidate) => candidate.platform === selectedRoute?.platform)
  const gas = payloadCandidate?.simulation.estimatedGas ?? payloadCandidate?.estimatedGas
  const rawStatus = payloadCandidate
    ? payloadCandidate.simulation.ok
      ? "ok"
      : payloadCandidate.simulation.note?.toLowerCase().includes("approval")
        ? "approve-needed"
        : "failed"
    : "pending"
  return buildPayloadSummaryFromValues(rawStatus, gas)
}

function buildPayloadSummaryFromValues(rawStatus: string, gas: string | undefined): string {
  const shownGas = displayGas(gas)
  let normalized = rawStatus
  if ((normalized === "unknown" || normalized === "pending") && shownGas !== "unknown") {
    normalized = "ok"
  } else if (shownGas === "unknown" && normalized !== "failed" && normalized !== "approve-needed") {
    normalized = "pending"
  }
  return `sim=${normalizeDashboardPayloadStatus(normalized, shownGas)} | gas=${shownGas}`
}

function extractQuoteSymbol(formatted: string): string {
  return formatted.split(" ").slice(1).join(" ").trim() || "token"
}

function computeSignedBps(numeratorValue: bigint, denominatorValue: bigint): number | null {
  if (denominatorValue === 0n) return null
  return Number(((numeratorValue - denominatorValue) * 10_000n)) / Number(denominatorValue)
}

function formatSignedBps(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unknown"
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${value.toFixed(1)}bps`
}

function buildQualitySummary(input: {
  realizedOut?: string
  expectedQuoteOut?: string
  protectedMinOut?: string
}): string | undefined {
  if (!input.realizedOut || !input.expectedQuoteOut) return undefined
  const realized = BigInt(input.realizedOut)
  const quote = BigInt(input.expectedQuoteOut)
  if (quote <= 0n) return undefined
  const capturePct = (Number(realized) / Number(quote)) * 100
  const parts = [qualityInterpretationLabel(capturePct), `quote capture=${capturePct.toFixed(2)}%`]
  if (input.protectedMinOut) {
    const minOut = BigInt(input.protectedMinOut)
    const denominator = quote - minOut
    if (denominator > 0n) {
      const numerator = quote - realized
      const clamped = Math.max(0, Math.min(100, (Number(numerator) / Number(denominator)) * 100))
      parts.push(`slippage budget used=${clamped.toFixed(1)}%`)
    }
  }
  return parts.join(" | ")
}

function qualityInterpretationLabel(capturePct: number): string {
  if (capturePct >= 99.5) return "healthy"
  if (capturePct >= 97) return "moderate"
  return "weak"
}

function buildExecutionVerdict(
  result: PlanningResult,
  audit:
    | NonNullable<NonNullable<SwapExecutionSummary["swap"]>["audit"]>
    | NonNullable<SwapExecutionSummary["audit"]>
    | undefined
): string {
  if (!audit || audit.status !== "success") {
    return "execution failed or confirmation incomplete"
  }
  const selectedRouteId =
    audit.executedRouteId ??
    result.recommendedPlan.routeId
  const bestRouteId = result.priceImpactAssessment.bestQuotedRouteId
  const mismatch = Boolean(bestRouteId && selectedRouteId && bestRouteId !== selectedRouteId)
  const capturePct =
    audit.realizedOut && audit.expectedQuoteOut && BigInt(audit.expectedQuoteOut) > 0n
      ? (Number(BigInt(audit.realizedOut)) / Number(BigInt(audit.expectedQuoteOut))) * 100
      : null
  if (mismatch && capturePct != null && capturePct >= 99.5) {
    return "executed away from quote leader, but guardrail held"
  }
  if (!mismatch && capturePct != null && capturePct >= 99.5) {
    return "quote leader matched and guardrail held"
  }
  if (capturePct != null && capturePct >= 97) {
    return "small degradation from quote, still healthy"
  }
  return "quote degraded materially, but minOut held"
}

function buildDashboardAuditSummary(
  result: PlanningResult,
  audit:
    | NonNullable<NonNullable<SwapExecutionSummary["swap"]>["audit"]>
    | NonNullable<SwapExecutionSummary["audit"]>,
  decimals: number | null
): string {
  const buySymbol = result.intent.buyToken ?? "token"
  const parts: string[] = []
  if (audit.executedRouteId || result.recommendedPlan.routeId) {
    const executedRouteId = audit.executedRouteId ?? result.recommendedPlan.routeId
    const executedRoute =
      result.routeCandidates.find((route) => route.id === executedRouteId)?.platform ?? executedRouteId
    parts.push(`executed=${executedRoute}`)
  }
  if (audit.realizedOut) {
    parts.push(`got=${formatAuditAmount(audit.realizedOut, decimals, buySymbol)}`)
  }
  if (audit.quoteDeltaRaw) {
    parts.push(`vs best observed=${formatSignedAuditDelta(audit.quoteDeltaRaw, decimals, buySymbol)}`)
  }
  if (audit.realizedOut && result.bestExecutableRouteId) {
    const bestExecutableRoute = result.routeCandidates.find((route) => route.id === result.bestExecutableRouteId)
    if (bestExecutableRoute) {
      const deltaRaw = (BigInt(audit.realizedOut) - BigInt(bestExecutableRoute.quotedOut)).toString()
      parts.push(`vs best executable=${formatSignedAuditDelta(deltaRaw, decimals, buySymbol)}`)
    }
  }
  if (audit.minOutDeltaRaw) {
    parts.push(`vs minOut=${formatSignedAuditDelta(audit.minOutDeltaRaw, decimals, buySymbol)}`)
  }
  return parts.join(" | ") || `status=${audit.status}`
}

function normalizeDashboardTailLines(line: string): string[] {
  return stripAnsi(line)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeDashboardTailLine(item))
    .filter((item): item is string => Boolean(item))
}

function normalizeDashboardTailLine(line: string): string | null {
  if (
    line.startsWith("path    ") ||
    line.startsWith("public  ") ||
    line.startsWith("private ") ||
    line.startsWith("builder ") ||
    line.startsWith("+ submit") ||
    line.startsWith("+ payload") ||
    line.startsWith("@ submit") ||
    line.startsWith("note    ") ||
    line.startsWith("delivery path selected ") ||
    line.startsWith("builder targets ")
  ) {
    return null
  }
  if (line.startsWith("swap submit ")) {
    return line
      .replace("48club-puissant-builder-", "")
      .replace(" rejected ", " ")
      .replace(" already-known", " duplicate")
      .replace(" accepted ", " accepted ")
  }
  if (line.startsWith("approval submit ")) {
    return line
      .replace("48club-puissant-builder-", "")
      .replace(" rejected ", " ")
      .replace(" already-known", " duplicate")
      .replace(" accepted ", " accepted ")
  }
  if (line.startsWith("swap receipt success ")) {
    return `swap receipt ${sanitizeReceiptTrace(line.replace("swap receipt ", ""))}`
  }
  if (line.startsWith("swap receipt pending ")) {
    return `swap receipt ${sanitizeReceiptTrace(line.replace("swap receipt ", ""))}`
  }
  if (line.startsWith("approval receipt success ")) {
    return `approval ${sanitizeReceiptTrace(line.replace("approval receipt ", ""))}`
  }
  if (line.startsWith("approval receipt pending ")) {
    return `approval ${sanitizeReceiptTrace(line.replace("approval receipt ", ""))}`
  }
  if (line.startsWith("quote   ")) {
    return line.includes(" started") ? null : line
  }
  if (line.startsWith("swap signing ") || line.startsWith("approval signing ")) {
    return line
  }
  if (line.startsWith("swap submit started ") || line.startsWith("approval submit started ")) {
    return line
      .replace(/at=([^ ]+)/, (_match, timestamp) => `at ${formatIsoTimestampCompact(timestamp)}`)
      .replace(" block=", " block ")
  }
  return null
}

function dashboardPhaseTone(phase: string): "active" | "warn" | "success" | "error" {
  if (phase === "failed") return "error"
  if (phase === "confirmed") return "success"
  if (phase === "deciding" || phase === "submitting") return "warn"
  return "active"
}

function dashboardPathTone(path: string | undefined): "success" | "warn" | "dim" {
  if (!path || path === "pending") return "dim"
  if (path === "public") return "warn"
  return "success"
}

function colorizedPayloadSummary(summary: string | undefined): string {
  if (!summary) return `${colorize("sim=pending", "dim")} | ${colorize("gas=unknown", "dim")}`
  return summary
    .split(" | ")
    .map((part) => {
      if (part === "sim=ok") return colorize(part, "success")
      if (part === "sim=approve-needed") return colorize(part, "warn")
      if (part === "sim=failed") return colorize(part, "error")
      if (part === "sim=pending") return colorize(part, "dim")
      if (part === "gas=unknown") return colorize(part, "dim")
      if (part.startsWith("gas=")) return colorize(part, "plain")
      return part
    })
    .join(" | ")
}

function colorizedAllowanceSummary(summary: string): string {
  if (summary === "native token") return colorize(summary, "dim")
  if (summary === "pending") return colorize(summary, "dim")
  if (summary.startsWith("ok")) return colorize(summary, "success")
  if (summary.startsWith("approve needed")) return colorize(summary, "warn")
  if (summary.startsWith("unavailable")) return colorize(summary, "dim")
  return colorize(summary, "plain")
}

function colorizedDecisionSummary(summary: string): string {
  return summary
    .split(" | ")
    .map((part) => {
      if (part === "quote leader matched") return colorize(part, "success")
      if (part.startsWith("reason=")) return colorize(part, "warn")
      if (part.startsWith("delta vs best=")) {
        const bpsMatch = part.match(/\(([+-]?\d+(?:\.\d+)?)bps\)/)
        const bps = bpsMatch ? Number(bpsMatch[1]) : 0
        if (bps >= 0) return colorize(part, "success")
        if (bps > -10) return colorize(part, "warn")
        return colorize(part, "error")
      }
      return colorize(part, "plain")
    })
    .join(" | ")
}

function colorizedAgentSummary(summary: string): string {
  return summary
    .split(" | ")
    .map((part) => {
      if (part.startsWith("selected ") || part.includes("remained viable")) return colorize(part, "success")
      if (part.startsWith("using ")) return colorize(part, "warn")
      if (part.startsWith("excluded ")) return colorize(part, "dim")
      return colorize(part, "plain")
    })
    .join(" | ")
}

function colorizedGuardSummary(summary: string): string {
  return summary
    .split(" | ")
    .map((part) => {
      if (part.startsWith("impact=")) {
        const value = Number(part.replace("impact=", "").replace("%", ""))
        if (value <= 0.3) return colorize(part, "success")
        if (value <= 1) return colorize(part, "warn")
        return colorize(part, "error")
      }
      if (part.startsWith("quote=fresh")) return colorize(part, "success")
      if (part.startsWith("quote=stale")) return colorize(part, "warn")
      return colorize(part, "plain")
    })
    .join(" | ")
}

function colorizedStatusSummary(summary: string): string {
  return summary
    .split(" | ")
    .map((part, index) => {
      if (index === 0) {
        if (part.includes("confirmed") || part.includes("accepted")) return colorize(part, "success")
        if (part.includes("pending") || part.includes("approve needed") || part.includes("submitted") || part.includes("signing")) return colorize(part, "warn")
        if (part.includes("failed") || part.includes("rejected") || part.includes("timeout")) return colorize(part, "error")
        if (part.includes("idle") || part.includes("skipped")) return colorize(part, "dim")
      }
      if (part.startsWith("tx=")) return colorize(part, "plain")
      return colorize(part, "plain")
    })
    .join(" | ")
}

function colorizedBuilderLine(line: string): string {
  return line
    .split(" | ")
    .map((cell) => {
      if (cell.includes(":accepted")) return colorize(cell, "success")
      if (cell.includes(":dup") || cell.includes(":idle")) return colorize(cell, cell.includes(":dup") ? "warn" : "dim")
      if (cell.includes(":rejected") || cell.includes(":timeout")) return colorize(cell, "error")
      return colorize(cell, "plain")
    })
    .join(" | ")
}

function colorizedReceiptSummary(summary: string): string {
  if (summary.startsWith("confirmed")) return colorize(summary, "success")
  if (summary.startsWith("pending")) return colorize(summary, "warn")
  if (summary.startsWith("reverted") || summary.startsWith("not-found")) return colorize(summary, "error")
  if (summary.startsWith("failed")) return colorize(summary, "error")
  return colorize(summary, "plain")
}

function colorizedAuditSummary(summary: string): string {
  if (summary === "pending") return colorize(summary, "dim")
  if (summary === "skipped") return colorize(summary, "dim")
  if (summary.startsWith("failed")) return colorize(summary, "error")
  return colorize(summary, "success")
}

function colorizedQualitySummary(summary: string): string {
  return summary
    .split(" | ")
    .map((part) => {
      if (part === "healthy") return colorize(part, "success")
      if (part === "moderate") return colorize(part, "warn")
      if (part === "weak") return colorize(part, "error")
      if (part.startsWith("quote capture=")) {
        const value = Number(part.replace("quote capture=", "").replace("%", ""))
        if (value >= 99.5) return colorize(part, "success")
        if (value >= 97) return colorize(part, "warn")
        return colorize(part, "error")
      }
      if (part.startsWith("slippage budget used=")) {
        const value = Number(part.replace("slippage budget used=", "").replace("%", ""))
        if (value <= 30) return colorize(part, "success")
        if (value <= 70) return colorize(part, "warn")
        return colorize(part, "error")
      }
      return colorize(part, "plain")
    })
    .join(" | ")
}

function colorizedVerdictSummary(
  verdictSignal: string | undefined,
  phase: DashboardPhase,
  pathSignal: string | undefined
): string {
  if (verdictSignal) {
    if (phase === "failed") return colorize(verdictSignal, "error")
    const lowered = verdictSignal.toLowerCase()
    if (lowered.includes("failed") || lowered.includes("incomplete")) return colorize(verdictSignal, "error")
    if (lowered.includes("healthy") || lowered.includes("guardrail held") || lowered.includes("matched")) {
      return colorize(verdictSignal, "success")
    }
    return colorize(verdictSignal, "warn")
  }
  if (phase === "failed") {
    return colorize("parse failed", "error")
  }
  if (pathSignal) {
    return colorize("in progress", "warn")
  }
  return colorize("pending", "dim")
}

function normalizeDashboardPayloadStatus(status: string, gas: string): "ok" | "approve-needed" | "failed" | "pending" {
  if (status === "approve-needed") return "approve-needed"
  if (status === "failed") return "failed"
  if (gas === "unknown" && status !== "ok") return "pending"
  return "ok"
}

function buildCompactFinalistSummary(result: PlanningResult): string | undefined {
  const finalists = result.finalistsRouteIds?.join(",")
  if (!finalists) return undefined
  const nearestExcluded = computeExcludedMarginSummary(result)
  const base = `kept ${finalists} by top-3 quote`
  return nearestExcluded ? `${base}; ${nearestExcluded}` : base
}

function computeExcludedMarginSummary(result: PlanningResult): string | undefined {
  if (!result.excludedRouteIds?.length || !result.finalistsRouteIds?.length) return undefined
  const finalistRoutes = result.routeCandidates.filter((route) => result.finalistsRouteIds?.includes(route.id))
  const excludedRoutes = result.routeCandidates.filter((route) => result.excludedRouteIds?.includes(route.id))
  if (!finalistRoutes.length || !excludedRoutes.length) return undefined
  const floor = [...finalistRoutes].sort((a, b) => {
    const diff = BigInt(a.quotedOut) - BigInt(b.quotedOut)
    if (diff > 0n) return 1
    if (diff < 0n) return -1
    return a.score - b.score
  })[0]
  const nearestExcluded = [...excludedRoutes].sort((a, b) => {
    const diff = (BigInt(floor.quotedOut) - BigInt(a.quotedOut)) - (BigInt(floor.quotedOut) - BigInt(b.quotedOut))
    if (diff > 0n) return 1
    if (diff < 0n) return -1
    return 0
  })[0]
  if (!floor || !nearestExcluded) return undefined
  const bps = computeSignedBps(BigInt(nearestExcluded.quotedOut), BigInt(floor.quotedOut))
  return `excluded ${nearestExcluded.platform} trailed finalist by ${formatSignedBps(bps)}`
}

function normalizePlanningFailureStage(stage: PlanningEvent["stage"]): DashboardPlanningFailureStage {
  if (stage === "intent-parsing") return "intent-parsing"
  if (stage === "liquidity-discovery") return "liquidity-discovery"
  if (stage === "payload-construction") return "payload-construction"
  return "unknown"
}

function buildAgentFailureSummary(
  message: string,
  kind: DashboardFailureKind,
  stage: DashboardPlanningFailureStage
): string | undefined {
  if (kind === "execution") {
    return "execution started but did not complete cleanly"
  }
  if (stage === "payload-construction") {
    return "all finalists failed simulation; stopping before submission"
  }
  if (stage === "liquidity-discovery") {
    return "no executable route was observed during quote discovery"
  }
  if (stage === "intent-parsing") {
    return "could not turn the request into a complete swap intent"
  }
  return message ? compactReasoning(message) : undefined
}

function normalizeDashboardFailureVerdict(
  message: string,
  kind: DashboardFailureKind,
  stage: DashboardPlanningFailureStage
): string {
  if (kind === "execution") {
    if (message.toLowerCase().includes("timed out")) return "confirmation timed out"
    if (message.toLowerCase().includes("receipt")) return "receipt check failed"
    return "execution failed"
  }
  if (stage === "payload-construction") {
    return "no finalist survived simulation"
  }
  if (stage === "liquidity-discovery") {
    return "no executable route found"
  }
  if (message.includes("quota exhausted")) {
    return "Gemini quota exhausted"
  }
  if (message.includes("invalid response")) {
    return "intent parse failed"
  }
  if (message.includes("could not extract swap intent")) {
    return "intent parse failed"
  }
  return "planning failed"
}

function normalizeDashboardFailureTail(
  message: string,
  kind: DashboardFailureKind,
  stage: DashboardPlanningFailureStage
): string {
  if (kind === "execution") {
    return message
  }
  if (stage === "payload-construction") {
    return "no finalist survived simulation"
  }
  if (stage === "liquidity-discovery") {
    return "no executable route found during quote discovery"
  }
  if (message.includes("quota exhausted")) {
    return "gemini quota exhausted"
  }
  if (message.includes("invalid response")) {
    return "gemini returned an invalid response"
  }
  if (message.includes("could not extract swap intent")) {
    return "deterministic fallback failed"
  }
  return message
}

function formatIsoTimestampCompact(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
}

function buildExplorerTxUrl(network: "bsc" | "bsc-testnet", txHash: string): string {
  return network === "bsc"
    ? `https://bscscan.com/tx/${txHash}`
    : `https://testnet.bscscan.com/tx/${txHash}`
}

function buildExplorerTxUrlFromExecution(execution: SwapExecutionSummary): string | null {
  const txHash = execution.swap?.submission?.txHash ?? execution.submission?.txHash
  const chainId = execution.swap?.audit?.chainId ?? execution.audit?.chainId
  if (!txHash) return null
  return chainId === 97 ? buildExplorerTxUrl("bsc-testnet", txHash) : buildExplorerTxUrl("bsc", txHash)
}
