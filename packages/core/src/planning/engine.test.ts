import { describe, expect, it } from "bun:test"

import type {
  MevRiskAssessment,
  Network,
  PlanningEvent,
  SubmissionCandidate,
  StructuredIntent,
  TokenRef
} from "@bsc-swap-agent-demo/shared"

import type {
  CapabilityRegistry,
  ChainCapabilityAdapter,
  QuoteCapabilityAdapter,
  SubmissionCapabilityAdapter
} from "../capabilities/types"
import { formatPlan } from "../format/output"
import { runPlanningStream } from "../planning/engine"
import type { StageSummarizer } from "../planning/stage-summarizer"
import { continuePlanningSession, startPlanningSession } from "../session/store"
import { buildPublicTransactionRequest } from "../submission/requests"

class MockChainAdapter implements ChainCapabilityAdapter {
  async listTools(): Promise<string[]> {
    return []
  }
  async getChainInfo(_network: Network): Promise<unknown> {
    return {}
  }
  async getNativeBalance() {
    return { formatted: "1.23", raw: "1230000000000000000", symbol: "BNB" }
  }
  async getErc20Balance() {
    return { formatted: "250", raw: "250000000000000000000", symbol: "USDT" }
  }
  async getErc20TokenInfo() {
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
  async estimateGas() {
    return { estimatedGas: "100000" }
  }
}

class MockQuoteAdapter implements QuoteCapabilityAdapter {
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
}

class MockSubmissionAdapter implements SubmissionCapabilityAdapter {
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
        path: "intent-api",
        availability: "stub",
        recommended: false,
        rationale: "future"
      },
      {
        path: "multi-builder-broadcast",
        availability: "stub",
        recommended: false,
        rationale: "future"
      }
    ]
  }
}

class MockRegistry implements CapabilityRegistry {
  chain = new MockChainAdapter()
  quote = new MockQuoteAdapter()
  submission = new MockSubmissionAdapter()
  async close(): Promise<void> {}
}

describe("core planning engine", () => {
  const mockStageSummarizer: StageSummarizer = async (input) => ({
    summary: `LLM summary for ${input.stage}`,
    decision: `LLM decision for ${input.stage}`,
    observations: [{ label: "llm_stage", value: input.stage }]
  })

  const mockIntentExtractor = async (message: string): Promise<StructuredIntent> => {
    if (message.includes("Swap USDT to BNB")) {
      return {
        action: "swap" as const,
        sellToken: "USDT",
        buyToken: "BNB",
        amount: message.includes("100") ? "100" : null,
        slippageBps: null,
        preferences: {
          preferPrivate: true,
          preferFast: false,
          avoidStale: false
        },
        unknowns: message.includes("100") ? [] : ["amount"]
      }
    }
    return {
      action: "swap" as const,
      sellToken: "USDT",
      buyToken: "BNB",
      amount: "100",
      slippageBps: null,
      preferences: {
        preferPrivate: true,
        preferFast: false,
        avoidStale: false
      },
      unknowns: []
    }
  }

  it("asks a grounded follow-up when amount is missing and resumes through the session API", async () => {
    const registry = new MockRegistry()
    const session = await startPlanningSession({
      message: "Swap USDT to BNB with low MEV risk",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: mockIntentExtractor,
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("follow-up")
    if (session.response?.kind === "follow-up") {
      expect(session.response.question).toContain("You currently hold 250 USDT")
      expect(session.response.partialDecisionTrace.length).toBeGreaterThanOrEqual(2)
      expect(session.response.partialEvents.length).toBeGreaterThanOrEqual(4)
      expect(
        session.response.partialDecisionTrace.some((step) => step.stage === "missing-field-resolution")
      ).toBe(true)
    }

    const completed = await continuePlanningSession({
      sessionId: session.sessionId,
      answer: "100",
      registry,
      stageSummarizer: mockStageSummarizer
    })

    expect(completed.response?.kind).toBe("plan")
    if (completed.response?.kind === "plan") {
      expect(completed.response.result.routeCandidates.length).toBeGreaterThanOrEqual(2)
      expect(completed.response.result.publicSubmitRequest?.to).toBe("0xrouter")
      expect(completed.response.result.privateSubmitRequest?.mode).toBe("private-rpc")
      expect(completed.response.result.intentSubmitRequest?.mode).toBe("intent-api")
      expect(completed.response.result.decisionTrace.length).toBeGreaterThanOrEqual(8)
      expect(
        completed.response.result.decisionTrace.some((step) => step.stage === "final-recommendation")
      ).toBe(true)
    }
  })

  it("formats a plan with execution reasoning and submission request contracts", async () => {
    const registry = new MockRegistry()
    const session = await startPlanningSession({
      message: "Swap 100 USDT to BNB with low MEV risk",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: mockIntentExtractor,
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("plan")
    if (session.response?.kind !== "plan") {
      return
    }

    const formatted = formatPlan(session.response.result)
    expect(formatted).toContain("Recommended route:")
    expect(formatted).toContain("### Decision Trace")
    expect(formatted).toContain("LLM summary for route-comparison")
    expect(formatted).toContain("public_submit_request")
    expect(session.response.result.alternativesRejected.length).toBeGreaterThanOrEqual(1)
    expect(
      session.response.result.decisionTrace.some((step) => step.stage === "price-impact-assessment")
    ).toBe(true)
  })

  it("streams tool and stage events before finalizing the plan", async () => {
    const registry = new MockRegistry()
    const events: PlanningEvent[] = []

    for await (const event of runPlanningStream({
      message: "Swap 100 USDT to BNB with low MEV risk",
      context: {
        network: "bsc",
        walletAddress: "0xwallet",
        submitEnabled: false
      },
      registry,
      sessionId: "session-1",
      intentExtractor: mockIntentExtractor,
      stageSummarizer: mockStageSummarizer
    })) {
      events.push(event)
    }

    expect(events[0]?.kind).toBe("stage-started")
    expect(events.some((event) => event.kind === "tool-started")).toBe(true)
    expect(events.some((event) => event.kind === "tool-succeeded")).toBe(true)
    expect(events.some((event) => event.kind === "reasoning" && event.stage === "route-comparison")).toBe(true)
    expect(
      events.some(
        (event) =>
          event.kind === "reasoning" &&
          event.stage === "route-comparison" &&
          event.data?.reasoningSource === "llm"
      )
    ).toBe(true)
    expect(events.at(-1)?.kind).toBe("plan-completed")
  })

  it("falls back to deterministic reasoning when stage summarization fails", async () => {
    const registry = new MockRegistry()
    const events: PlanningEvent[] = []

    for await (const event of runPlanningStream({
      message: "Swap 100 USDT to BNB with low MEV risk",
      context: {
        network: "bsc",
        walletAddress: "0xwallet",
        submitEnabled: false
      },
      registry,
      sessionId: "session-2",
      intentExtractor: mockIntentExtractor,
      stageSummarizer: async () => {
        throw new Error("summary failed")
      }
    })) {
      events.push(event)
    }

    expect(
      events.some(
        (event) =>
          event.kind === "tool-failed" && event.data?.toolName === "summarizeStageWithLLM"
      )
    ).toBe(true)
    expect(
      events.some(
        (event) =>
          event.kind === "reasoning" &&
          event.stage === "route-comparison" &&
          event.data?.reasoningSource === "deterministic"
      )
    ).toBe(true)
    expect(events.at(-1)?.kind).toBe("plan-completed")
  })

  it("builds a browser-wallet public transaction request shape", () => {
    const request = buildPublicTransactionRequest({
      network: "bsc",
      walletAddress: "0xwallet",
      payload: {
        id: "payload-1",
        type: "router-calldata",
        platform: "openoceanv2",
        to: "0xrouter",
        data: "0xabcdef",
        value: "0",
        minOutAmount: "990",
        estimatedGas: "120000",
        simulation: {
          ok: true,
          estimatedGas: "110000",
          note: "ok"
        }
      }
    })

    expect(request.chainId).toBe(56)
    expect(request.from).toBe("0xwallet")
    expect(request.gas).toBe("110000")
  })
})
