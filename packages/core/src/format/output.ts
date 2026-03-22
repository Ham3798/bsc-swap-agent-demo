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
      execution.swap?.submission ? `accepted=${execution.swap.submission.acceptedCount}/${execution.swap.submission.endpointCount}` : execution.submission ? `accepted=${execution.submission.acceptedCount}/${execution.submission.endpointCount}` : null,
      execution.swap?.submission?.builderRoundTripMs != null ? `builderMs=${execution.swap.submission.builderRoundTripMs}` : execution.submission?.builderRoundTripMs != null ? `builderMs=${execution.submission.builderRoundTripMs}` : null,
      execution.swap?.submission?.txHash ? `txHash=${execution.swap.submission.txHash}` : execution.submission?.txHash ? `txHash=${execution.submission.txHash}` : null
    ].filter(Boolean) as string[], execution.swap?.submitted ?? execution.submitted ? "success" : "warn"),
    formatConsoleLine("audit", [
      `status=${execution.swap?.audit?.status ?? execution.audit?.status ?? "skipped"}`,
      execution.swap?.audit?.blockNumber != null ? `block=${execution.swap.audit.blockNumber}` : execution.audit?.blockNumber != null ? `block=${execution.audit.blockNumber}` : null,
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

function colorize(text: string, tone: "label" | "success" | "warn" | "error" | "dim" | "plain" = "plain"): string {
  const codes: Record<typeof tone, string> = {
    label: "\u001b[36m",
    success: "\u001b[32m",
    warn: "\u001b[33m",
    error: "\u001b[31m",
    dim: "\u001b[2m",
    plain: ""
  }
  const reset = "\u001b[0m"
  return codes[tone] ? `${codes[tone]}${text}${reset}` : text
}

function formatConsoleLine(
  label: string,
  parts: string[],
  tone: "success" | "warn" | "error" | "dim" | "plain" = "plain"
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
