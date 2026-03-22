import { describe, expect, it } from "bun:test"

import type { PayloadCandidate, PlanningResult } from "@bsc-swap-agent-demo/shared"

import { deriveExecutionFeedback } from "./live-swap"

function makeResult(overrides: Partial<PlanningResult> = {}): PlanningResult {
  return {
    observedRouteIds: ["matcha", "openoceanv2", "pancakeswap", "paraswap", "1inch"],
    bestQuoteRouteId: "matcha",
    bestReadyRouteId: "openoceanv2",
    quoteFreshness: "fresh",
    payloadCandidates: [
      {
        id: "matcha-router-calldata",
        type: "router-calldata",
        platform: "matcha",
        routeFamily: "aggregator",
        executionMode: "self-executed",
        estimatedGas: "100000",
        minOutAmount: "0",
        approvalRequired: false,
        simulation: { ok: true, estimatedGas: "100000", note: "ok" },
        to: "0x1111111111111111111111111111111111111111",
        value: "0",
        data: "0x1234"
      },
      {
        id: "openocean-router-calldata",
        type: "router-calldata",
        platform: "openoceanv2",
        routeFamily: "aggregator",
        executionMode: "self-executed",
        estimatedGas: "160000",
        minOutAmount: "0",
        approvalRequired: false,
        simulation: { ok: true, estimatedGas: "160000", note: "ok" },
        to: "0x2222222222222222222222222222222222222222",
        value: "0",
        data: "0x5678"
      }
    ],
    ...overrides
  } as PlanningResult
}

function makePayload(overrides: Partial<PayloadCandidate> = {}): PayloadCandidate {
  return {
    id: "openocean-router-calldata",
    type: "router-calldata",
    platform: "openoceanv2",
    routeFamily: "aggregator",
    executionMode: "self-executed",
    estimatedGas: "160000",
    minOutAmount: "0",
    approvalRequired: false,
    simulation: { ok: true, estimatedGas: "160000", note: "ok" },
    to: "0x2222222222222222222222222222222222222222",
    value: "0",
    data: "0x5678"
  }
}

describe("live private swap feedback", () => {
  it("marks fast successful inclusion as good and held", () => {
    const feedback = deriveExecutionFeedback({
      result: makeResult(),
      payload: makePayload(),
      acceptedCount: 3,
      endpointCount: 3,
      builderRoundTripMs: 420,
      audit: {
        status: "success",
        inclusionBlockDelta: 1,
        realizedOut: "105",
        expectedQuoteOut: "100",
        protectedMinOut: "95",
        quoteDeltaRaw: "5",
        minOutDeltaRaw: "10"
      }
    })

    expect(feedback.timeliness).toBe("good")
    expect(feedback.priceProtection).toBe("held")
    expect(feedback.executionQuality).toBe("good")
    expect(feedback.mevProtectionAssessment).toBe("private-builder-path-used")
    expect(feedback.submitFindings).toContain("builder reach broad")
    expect(feedback.postTradeFindings).toContain("timeliness met target")
    expect(feedback.postTradeFindings).toContain("quote held or improved")
  })

  it("marks slow execution as weak but still protected below quote", () => {
    const feedback = deriveExecutionFeedback({
      result: makeResult(),
      payload: makePayload(),
      acceptedCount: 1,
      endpointCount: 3,
      builderRoundTripMs: 2200,
      audit: {
        status: "success",
        inclusionBlockDelta: 3,
        realizedOut: "95",
        expectedQuoteOut: "100",
        protectedMinOut: "90",
        quoteDeltaRaw: "-5",
        minOutDeltaRaw: "5"
      }
    })

    expect(feedback.timeliness).toBe("weak")
    expect(feedback.priceProtection).toBe("held")
    expect(feedback.executionQuality).toBe("good")
    expect(feedback.submitFindings).toContain("builder reach partial")
    expect(feedback.submitFindings).toContain("relay acceptance slow")
    expect(feedback.postTradeFindings).toContain("timeliness missed target")
    expect(feedback.postTradeFindings).toContain("price degraded versus quote but protection held")
  })

  it("marks failed execution when no receipt success exists", () => {
    const feedback = deriveExecutionFeedback({
      result: makeResult(),
      payload: makePayload(),
      acceptedCount: 0,
      endpointCount: 3,
      audit: {
        status: "reverted"
      }
    })

    expect(feedback.executionQuality).toBe("failed")
    expect(feedback.priceProtection).toBe("failed")
    expect(feedback.mevProtectionAssessment).toBe("private-builder-path-unavailable")
    expect(feedback.submitFindings).toContain("private path failed")
    expect(feedback.postTradeFindings).toContain("execution failed or remains unconfirmed")
  })

  it("uses direct-router wording when JIT live criteria are not met", () => {
    const feedback = deriveExecutionFeedback({
      result: makeResult({ jitRouterRequest: undefined }),
      payload: makePayload(),
      acceptedCount: 1,
      endpointCount: 3,
      approvalCompleted: true,
      executionVariant: "direct-router",
      audit: {
        status: "success",
        inclusionBlockDelta: 1,
        realizedOut: "100",
        expectedQuoteOut: "100",
        protectedMinOut: "95",
        quoteDeltaRaw: "0",
        minOutDeltaRaw: "5"
      }
    })

    expect(feedback.preTradeFindings).toContain("direct self-executed route used builder-private delivery")
    expect(feedback.submitFindings).toContain("approval exact allowance granted to direct router spender")
    expect(feedback.summaryVerdict).toContain("direct private execution succeeded")
  })
})
