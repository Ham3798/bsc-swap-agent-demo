import { describe, expect, it } from "bun:test"

import { hydratePlanningState, runSwapExecutionPlanningSkill } from "./swap-execution-planning"
import type {
  CapabilityLayer,
  MevRiskAssessment,
  Network,
  SubmissionCandidate,
  TokenRef
} from "../types"

class MockCapabilities implements CapabilityLayer {
  async listTools(): Promise<string[]> {
    return []
  }
  async getChainInfo(_network: Network): Promise<unknown> {
    return {}
  }
  async getNativeBalance(): Promise<{ formatted: string; raw: string; symbol?: string }> {
    return { formatted: "1.23", raw: "1230000000000000000", symbol: "BNB" }
  }
  async getErc20Balance(): Promise<{ formatted: string; raw: string; symbol?: string }> {
    return { formatted: "250", raw: "250000000000000000000", symbol: "USDT" }
  }
  async getErc20TokenInfo(): Promise<unknown> {
    return {}
  }
  async resolveToken(query: string): Promise<TokenRef | null> {
    if (query.toUpperCase() === "USDT") {
      return { symbol: "USDT", address: "0xusdt", decimals: 18 }
    }
    if (query.toUpperCase() === "BNB") {
      return {
        symbol: "BNB",
        address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        decimals: 18,
        isNative: true
      }
    }
    return null
  }
  async getQuoteCandidates(): Promise<any[]> {
    return [
      {
        id: "openoceanv2",
        platform: "openoceanv2",
        quotedOut: "1000",
        quotedOutFormatted: "1.0 BNB",
        priceImpactPct: 0.2,
        estimatedGas: "100000",
        expectedExecutionStability: "high",
        protocolFit: "aggregator",
        mevExposure: "medium",
        routeSummary: "Route spans 2 venues",
        dexes: [{ dexCode: "PancakeV3", shareBps: 7000 }],
        score: 0
      },
      {
        id: "matcha",
        platform: "matcha",
        quotedOut: "1010",
        quotedOutFormatted: "1.01 BNB",
        priceImpactPct: 1.2,
        estimatedGas: "120000",
        expectedExecutionStability: "low",
        protocolFit: "aggregator",
        mevExposure: "high",
        routeSummary: "Route spans 4 venues",
        dexes: [{ dexCode: "Thena", shareBps: 6000 }],
        score: 0
      }
    ]
  }
  async encodeRouterCalldata(input: { platform: string }) {
    return {
      platform: input.platform,
      to: "0xrouter",
      data: "0xabcdef",
      value: "0",
      minOutAmount: "990",
      estimatedGas: "100000"
    }
  }
  async simulateTransaction() {
    return { ok: true, estimatedGas: "100000", note: "ok" }
  }
  async getSubmissionPaths(input: {
    mevRiskLevel: MevRiskAssessment["level"]
  }): Promise<SubmissionCandidate[]> {
    return [
      {
        path: "private-rpc",
        availability: "stub",
        recommended: input.mevRiskLevel !== "low",
        rationale: "preferred"
      },
      {
        path: "public-mempool",
        availability: "live",
        recommended: false,
        rationale: "fallback"
      },
      {
        path: "multi-builder-broadcast",
        availability: "stub",
        recommended: false,
        rationale: "future"
      }
    ]
  }
  async close(): Promise<void> {}
}

describe("swap-execution-planning", () => {
  it("asks a grounded follow-up when amount is missing", async () => {
    const response = await runSwapExecutionPlanningSkill({
      rawInput: "Swap USDT to BNB with low MEV risk",
      context: {
        network: "bsc",
        walletAddress: "0xwallet"
      },
      capabilities: new MockCapabilities()
    })

    expect(response.kind).toBe("follow-up")
    if (response.kind === "follow-up") {
      expect(response.question).toContain("You currently hold 250 USDT")
    }
  })

  it("produces a route comparison plan after follow-up resolution", async () => {
    const first = await runSwapExecutionPlanningSkill({
      rawInput: "Swap USDT to BNB with low MEV risk",
      context: {
        network: "bsc",
        walletAddress: "0xwallet"
      },
      capabilities: new MockCapabilities()
    })

    expect(first.kind).toBe("follow-up")
    if (first.kind !== "follow-up") {
      return
    }

    const next = await runSwapExecutionPlanningSkill({
      rawInput: "Swap USDT to BNB with low MEV risk\n100",
      context: {
        network: "bsc",
        walletAddress: "0xwallet"
      },
      capabilities: new MockCapabilities(),
      state: hydratePlanningState(first, "100")
    })

    expect(next.kind).toBe("plan")
    if (next.kind === "plan") {
      expect(next.result.routeCandidates.length).toBeGreaterThanOrEqual(2)
      expect(next.result.mevRiskAssessment.level).toBeTruthy()
      expect(next.result.alternativesRejected.length).toBeGreaterThanOrEqual(1)
      expect(next.result.recommendedPlan.submissionPath).toBe("private-rpc")
    }
  })
})
