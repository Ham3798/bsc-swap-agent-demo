import {
  createPresentationResult,
  createPartialPresentationTrace,
  formatStreamingUpdate as formatSharedStreamingUpdate,
  type DecisionTraceField,
  type PlanningEvent,
  type PlanningResult,
  type PartialPresentationTraceItem,
  type PresentationResult
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
  const intentPath = result.submissionCandidates.find(
    (candidate) => candidate.submissionChannel === "centralized-intent-server"
  )
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
    result.executionCapabilityUsage.available.length || result.executionCapabilitySummary
      ? formatConsoleLine(
          "caps",
          [
            `available=${result.executionCapabilityUsage.available.length ? result.executionCapabilityUsage.available.join(",") : "none"}`
          ],
          result.executionCapabilitySummary?.available ? "success" : "warn"
        )
      : null,
    formatConsoleLine(
      "used",
      [result.executionCapabilityUsage.used.length ? result.executionCapabilityUsage.used.join(",") : "none"],
      result.executionCapabilityUsage.used.length ? "success" : "dim"
    ),
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
          `path=${result.publicSubmitRequest.path}`
        ].filter(Boolean) as string[])
      : null,
    formatConsoleLine(
      "live",
      [result.executionReadyNow ? "public wallet handoff ready" : "public wallet handoff blocked"],
      result.executionReadyNow ? "success" : "warn"
    ),
    formatConsoleLine(
      "advisory",
      [
        privatePath ? "private validator" : null,
        builderPath ? "builder relay" : null
      ].filter(Boolean) as string[],
      "dim"
    ),
    formatConsoleLine(
      "next",
      [result.executionReadyNow ? "execute via wallet now" : quoteFreshness === "stale" ? "refresh quote before execution" : "do not execute yet"],
      result.executionReadyNow ? "success" : "warn"
    ),
    formatConsoleLine(
      "boundary",
      ["planner builds/checks, user signs, private delivery external"],
      "dim"
    )
  ]

  return lines.filter(Boolean).join("\n")
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
        intent_submit_request: result.intentSubmitRequest
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
      hold ? formatConsoleLine("note", ["kept=top payload-build candidates; hold=observed only"], "dim") : null
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
    const gas = event.data.outputPreview?.find((field) => field.label === "estimated_gas")?.value ?? "0"
    return formatConsoleLine("sim ok", [`gas=${gas}`], "success")
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
    const order = ["public", "private", "builder", "intent"]
    return [...(event.data.outputPreview ?? [])]
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
      .map((field) => formatConsoleLine(field.label, [field.value], field.label === "public" ? "success" : "warn"))
      .join("\n")
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
    const tokenFields = collectFields(input.events, ["liquidity-discovery"], ["symbol", "address"])
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
      held ? formatConsoleLine("note", ["kept=top payload-build candidates; hold=observed only"], "dim") : null,
      dropped ? formatConsoleLine("drop", [dropped], "warn") : null,
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
    return [
      formatConsoleLine(
        "ready",
        [
          liveRoutes.length ? "public execution can be prepared now" : "no live-executable route yet",
          "private paths observed and ranked, not live-integrated"
        ],
        liveRoutes.length ? "success" : "warn"
      ),
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
