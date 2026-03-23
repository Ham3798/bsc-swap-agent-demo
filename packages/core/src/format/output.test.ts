import { describe, expect, it } from "bun:test"

import type { PlanningEvent, PlanningResult, SwapExecutionSummary } from "@bsc-swap-agent-demo/shared"

import {
  applyDashboardFailure,
  applyPlanningEventToDashboard,
  createDashboardState,
  finalizeDashboardFromExecution,
  renderDashboard
} from "./output"

describe("dashboard agentic decision signals", () => {
  it("renders decision, agent summary, interpreted quality, verdict, and explorer rows", () => {
    const result = {
      intent: {
        action: "swap",
        sellToken: "BNB",
        buyToken: "USDC",
        amount: "0.001",
        slippageBps: null,
        preferences: { preferPrivate: null, preferFast: null, avoidStale: null },
        unknowns: []
      },
      routeCandidates: [
        {
          id: "openoceanv2",
          platform: "openoceanv2",
          routeFamily: "aggregator",
          quoteSource: "openocean",
          routeSourceType: "native",
          quoteMethod: "aggregator-http",
          providerNative: true,
          providerUniverseCategory: "aggregator",
          feasibilityStatus: "implement-now",
          quotedOut: "626959000000000000",
          quotedOutFormatted: "0.626959 USDC",
          priceImpactPct: 0.12,
          estimatedGas: "372958",
          expectedExecutionStability: "high",
          protocolFit: "aggregator",
          mevExposure: "medium",
          coverageConfidence: "medium",
          routeSummary: "best",
          dexes: [],
          score: 10
        },
        {
          id: "1inch",
          platform: "1inch",
          routeFamily: "aggregator",
          quoteSource: "1inch",
          routeSourceType: "native",
          quoteMethod: "aggregator-http",
          providerNative: true,
          providerUniverseCategory: "aggregator",
          feasibilityStatus: "implement-now",
          quotedOut: "626840000000000000",
          quotedOutFormatted: "0.626840 USDC",
          priceImpactPct: 0.21,
          estimatedGas: "372958",
          expectedExecutionStability: "high",
          protocolFit: "aggregator",
          mevExposure: "medium",
          coverageConfidence: "medium",
          routeSummary: "selected",
          dexes: [],
          score: 9
        }
      ],
      payloadCandidates: [],
      submissionCandidates: [],
      recommendedPlan: { routeId: "1inch" },
      priceImpactAssessment: { bestQuotedRouteId: "openoceanv2" },
      effectiveSlippageBps: 50,
      quoteFreshness: "fresh",
      bestQuoteRouteId: "openoceanv2",
      bestReadyRouteId: "1inch",
      finalistsRouteIds: ["openoceanv2", "1inch"],
      excludedRouteIds: [],
      finalistSelectionSummary: "kept top-3 quoted output; finalists=openoceanv2,1inch",
      routeExecutionReadiness: [{ routeId: "1inch", payloadReady: true, simulationOk: true, liveExecutable: true }],
      allowanceCheck: { status: "not-applicable" }
    } as unknown as PlanningResult

    const execution = {
      swap: {
        submission: {
          txHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
        },
        audit: {
          status: "success",
          chainId: 56,
          txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          realizedOut: "626784000000000000",
          expectedQuoteOut: "626959000000000000",
          protectedMinOut: "623848000000000000",
          quoteDeltaRaw: "-175000000000000",
          minOutDeltaRaw: "2936000000000000",
          submittedBlockNumber: "100",
          blockNumber: 103n,
          submittedAt: "2026-03-23T10:00:00.000Z",
          confirmedAt: "2026-03-23T10:00:02.000Z",
          inclusionBlockDelta: 3,
          inclusionWallClockMs: 1669
        }
      },
      feedback: {
        summaryVerdict: "direct private execution succeeded with measurable onchain evidence"
      }
    } as unknown as SwapExecutionSummary

    const dashboard = finalizeDashboardFromExecution(createDashboardState("test"), result, execution)
    const rendered = stripAnsi(renderDashboard(dashboard))

    expect(rendered).toContain("decision")
    expect(rendered).toContain("predicted winner=1inch")
    expect(rendered).toContain("delta vs best=")
    expect(rendered).toContain("policy=top-3 quote")
    expect(rendered).toContain("agent")
    expect(rendered).toContain("kept openoceanv2,1inch by top-3 quote")
    expect(rendered).toContain("selected 1inch after simulation because simulation winner")
    expect(rendered).toContain("guard")
    expect(rendered).toContain("impact=0.210%")
    expect(rendered).toContain("reason=simulation winner")
    expect(rendered).not.toContain("selection")
    expect(rendered).not.toContain("drift")
    expect(rendered).toContain("quality")
    expect(rendered).toContain("healthy")
    expect(rendered).toContain("quote capture=")
    expect(rendered).toContain("slippage budget used=")
    expect(rendered).toContain("verdict")
    expect(rendered).toContain("executed away from quote leader, but guardrail held")
    expect(rendered).toContain("explorer")
    expect(rendered).toContain("https://bscscan.com/tx/0x1111111111111111111111111111111111111111111111111111111111111111")
  })

  it("renders finalist bakeoff truth and executed route details", () => {
    const result = {
      intent: {
        action: "swap",
        sellToken: "USDC",
        buyToken: "BNB",
        amount: "all",
        slippageBps: null,
        preferences: { preferPrivate: null, preferFast: null, avoidStale: null },
        unknowns: []
      },
      routeCandidates: [
        {
          id: "paraswap",
          platform: "paraswap",
          routeFamily: "aggregator",
          quoteSource: "paraswap",
          routeSourceType: "native",
          quoteMethod: "aggregator-http",
          providerNative: true,
          providerUniverseCategory: "aggregator",
          feasibilityStatus: "implement-now",
          quotedOut: "1995000000000000",
          quotedOutFormatted: "0.001995 BNB",
          priceImpactPct: 0.03,
          estimatedGas: "430000",
          expectedExecutionStability: "high",
          protocolFit: "aggregator",
          mevExposure: "medium",
          coverageConfidence: "medium",
          routeSummary: "best",
          dexes: [],
          score: 11
        },
        {
          id: "openoceanv2",
          platform: "openoceanv2",
          routeFamily: "aggregator",
          quoteSource: "openocean",
          routeSourceType: "native",
          quoteMethod: "aggregator-http",
          providerNative: true,
          providerUniverseCategory: "aggregator",
          feasibilityStatus: "implement-now",
          quotedOut: "1992000000000000",
          quotedOutFormatted: "0.001992 BNB",
          priceImpactPct: 0.04,
          estimatedGas: "440000",
          expectedExecutionStability: "high",
          protocolFit: "aggregator",
          mevExposure: "medium",
          coverageConfidence: "medium",
          routeSummary: "buildable",
          dexes: [],
          score: 10
        },
        {
          id: "matcha",
          platform: "matcha",
          routeFamily: "aggregator",
          quoteSource: "matcha",
          routeSourceType: "native",
          quoteMethod: "aggregator-http",
          providerNative: true,
          providerUniverseCategory: "aggregator",
          feasibilityStatus: "implement-now",
          quotedOut: "1989000000000000",
          quotedOutFormatted: "0.001989 BNB",
          priceImpactPct: 0.05,
          estimatedGas: "450000",
          expectedExecutionStability: "high",
          protocolFit: "aggregator",
          mevExposure: "medium",
          coverageConfidence: "medium",
          routeSummary: "excluded",
          dexes: [],
          score: 9
        },
        {
          id: "pancakeswap",
          platform: "pancakeswap",
          routeFamily: "dex",
          quoteSource: "pancakeswap",
          routeSourceType: "native",
          quoteMethod: "router",
          providerNative: true,
          providerUniverseCategory: "dex",
          feasibilityStatus: "implement-now",
          quotedOut: "1988500000000000",
          quotedOutFormatted: "0.0019885 BNB",
          priceImpactPct: 0.06,
          estimatedGas: "460000",
          expectedExecutionStability: "medium",
          protocolFit: "dex",
          mevExposure: "medium",
          coverageConfidence: "medium",
          routeSummary: "excluded",
          dexes: [],
          score: 8
        }
      ],
      payloadCandidates: [],
      submissionCandidates: [],
      recommendedPlan: { routeId: "openoceanv2", payloadId: "payload-openocean" },
      priceImpactAssessment: { bestQuotedRouteId: "paraswap" },
      effectiveSlippageBps: 50,
      quoteFreshness: "fresh",
      bestQuoteRouteId: "paraswap",
      bestExecutableRouteId: "openoceanv2",
      executionRecommendationMode: "direct-route",
      finalistsRouteIds: ["paraswap", "openoceanv2", "1inch"],
      excludedRouteIds: ["matcha", "pancakeswap"],
      finalistSelectionSummary:
        "kept top-3 quoted output; excluded=matcha,pancakeswap because they were outside top-3 quoted output and not simulated this round",
      selectionReasonCode: "quote-winner-not-buildable",
      bestReadyRouteId: "openoceanv2",
      routeExecutionReadiness: [{ routeId: "openoceanv2", payloadReady: true, simulationOk: true, liveExecutable: true }],
      allowanceCheck: { status: "approve-required", spender: "0x1111111111111111111111111111111111111111", requiredAmount: "1000000" }
    } as unknown as PlanningResult

    const execution = {
      swap: {
        submission: {
          txHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
        },
        audit: {
          status: "success",
          chainId: 56,
          txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          realizedOut: "1990000000000000",
          expectedQuoteOut: "1995000000000000",
          protectedMinOut: "1985000000000000",
          quoteDeltaRaw: "-5000000000000",
          minOutDeltaRaw: "5000000000000",
          executedRouteId: "openoceanv2",
          submittedBlockNumber: "200",
          blockNumber: 202n,
          submittedAt: "2026-03-23T10:00:00.000Z",
          confirmedAt: "2026-03-23T10:00:02.000Z",
          inclusionBlockDelta: 2,
          inclusionWallClockMs: 1471
        }
      }
    } as unknown as SwapExecutionSummary

    const dashboard = finalizeDashboardFromExecution(createDashboardState("jit-test"), result, execution)
    const rendered = stripAnsi(renderDashboard(dashboard))

    expect(rendered).toContain("best observed=paraswap")
    expect(rendered).toContain("payload")
    expect(rendered).toContain("route=openoceanv2")
    expect(rendered).toContain("finalists=paraswap,openoceanv2,1inch")
    expect(rendered).toContain("predicted winner=openoceanv2")
    expect(rendered).toContain("reason=quote winner not buildable")
    expect(rendered).toContain("agent")
    expect(rendered).toContain("excluded matcha trailed finalist by")
    expect(rendered).toContain("executed=openoceanv2")
    expect(rendered).toContain("vs best observed=")
    expect(rendered).toContain("vs best executable=")
  })

  it("marks execution failures separately from planning failures", () => {
    const failed = applyDashboardFailure(createDashboardState("test"), "receipt polling timed out", "execution")
    const rendered = stripAnsi(renderDashboard(failed))

    expect(rendered).toContain("receipt    failed")
    expect(rendered).toContain("audit      pending")
    expect(rendered).toContain("verdict    confirmation timed out")
  })

  it("surfaces payload-construction failure reasons in normal mode", () => {
    const event = {
      kind: "stage-failed",
      stage: "payload-construction",
      status: "failed",
      message: "Built candidate payloads, but none simulated successfully.",
      data: {
        observations: [
          { label: "matcha", value: "simulation failed" },
          { label: "1inch", value: "simulation failed" }
        ],
        decision: "Stop because no execution-ready payload survived simulation.",
        error: "No payload candidates simulated successfully."
      }
    } as unknown as PlanningEvent

    const failed = applyPlanningEventToDashboard(createDashboardState("test"), event)
    const rendered = stripAnsi(renderDashboard(failed))

    expect(rendered).toContain("payload    route=pending | sim=failed | gas=unknown")
    expect(rendered).toContain("agent      all finalists failed simulation; stopping before submission")
    expect(rendered).toContain("verdict    no finalist survived simulation")
    expect(rendered).toContain("no finalist survived simulation")
  })
})

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "")
}
