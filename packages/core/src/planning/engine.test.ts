import { describe, expect, it } from "bun:test"

import type {
  MevRiskAssessment,
  Network,
  PartialPresentationTraceItem,
  PlanningEvent,
  SubmissionCandidate,
  StructuredIntent,
  TokenRef
} from "@bsc-swap-agent-demo/shared"
import {
  createPartialPresentationTrace,
  createPresentationResult,
  toUserFacingErrorMessage
} from "@bsc-swap-agent-demo/shared"

import type {
  CapabilityRegistry,
  ChainCapabilityAdapter,
  MarketIntelligenceAdapter,
  QuoteCapabilityAdapter,
  SubmissionCapabilityAdapter,
  TokenResolutionResult
} from "../capabilities/types"
import { formatDebugPlan, formatPlan, formatStreamingUpdate } from "../format/output"
import { runPlanningStream } from "../planning/engine"
import type { StageSummarizer } from "../planning/stage-summarizer"
import { continuePlanningSession, startPlanningSession } from "../session/store"
import { buildPublicTransactionRequest } from "../submission/requests"

class MockChainAdapter implements ChainCapabilityAdapter {
  private readonly tokens: TokenRef[] = [
    { symbol: "USDT", address: "0xusdt", decimals: 18 },
    { symbol: "BNB", address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", decimals: 18, isNative: true },
    { symbol: "CAKE", address: "0xcake", decimals: 18 }
  ]
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
  async resolveToken(query: string, network: Network): Promise<TokenRef | null> {
    return (await this.resolveTokenDetailed(query, network)).resolvedToken
  }
  async resolveTokenDetailed(query: string, _network: Network): Promise<TokenResolutionResult> {
    const normalized = query.trim().toUpperCase()
    if (normalized === "Pancake swap token".toUpperCase() || normalized === "Pancake token".toUpperCase()) {
      return {
        resolvedToken: this.tokens.find((token) => token.symbol === "CAKE") ?? null,
        resolvedBy: "alias",
        normalizedQuery: "CAKE",
        suggestions: []
      }
    }
    const exact = this.tokens.find((token) => token.symbol === normalized || token.address.toLowerCase() === query.toLowerCase())
    if (exact) {
      return {
        resolvedToken: exact,
        resolvedBy: "exact-symbol",
        normalizedQuery: exact.symbol,
        suggestions: []
      }
    }
    if (normalized === "PANCAKE") {
      return {
        resolvedToken: null,
        resolvedBy: "unresolved",
        normalizedQuery: "pancake",
        suggestions: [this.tokens.find((token) => token.symbol === "CAKE")!]
      }
    }
    return {
      resolvedToken: null,
      resolvedBy: "unresolved",
      normalizedQuery: normalized.toLowerCase(),
      suggestions: []
    }
  }
  async estimateGas() {
    return { estimatedGas: "100000" }
  }
}

class MockQuoteAdapter implements QuoteCapabilityAdapter {
  async getQuoteCandidates(): Promise<any[]> {
    return (await this.getQuoteCandidatesWithAudit()).candidates
  }
  async getQuoteCandidatesWithAudit(): Promise<any> {
    return {
      observedAt: new Date().toISOString(),
      audit: [
        {
          providerId: "openoceanv2",
          category: "aggregator",
          mode: "native",
          status: "observed",
          quoteCount: 1,
          rawReason: undefined
        },
        {
          providerId: "pancakeswap",
          category: "dex",
          mode: "direct",
          status: "unsupported",
          reason: "unsupported-pair",
          rawReason: "unsupported-pair",
          quoteCount: 0
        },
        {
          providerId: "1inch",
          category: "modeled",
          mode: "modeled",
          status: "empty",
          reason: "no-modeled-quote",
          rawReason: "no-modeled-quote",
          quoteCount: 0
        }
      ],
      candidates: [
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
        quotedOut: "1000",
        quotedOutFormatted: "1.0 BNB",
        priceImpactPct: 0.2,
        estimatedGas: "100000",
        expectedExecutionStability: "high",
        protocolFit: "aggregator",
        mevExposure: "medium",
        coverageConfidence: "medium",
        coverageNotes: [],
        quoteRequestNotes: ["Queried through the currently connected native provider path."],
        routeSummary: "Route spans 2 venues",
        dexes: [{ dexCode: "PancakeV3", shareBps: 7000 }],
        score: 0
      },
      {
        id: "matcha",
        platform: "matcha",
        routeFamily: "aggregator",
        quoteSource: "openocean",
        routeSourceType: "modeled",
        quoteMethod: "aggregator-http",
        providerNative: false,
        providerUniverseCategory: "aggregator",
        feasibilityStatus: "implement-now",
        quotedOut: "1010",
        quotedOutFormatted: "1.01 BNB",
        priceImpactPct: 1.2,
        estimatedGas: "120000",
        expectedExecutionStability: "low",
        protocolFit: "aggregator",
        mevExposure: "high",
        coverageConfidence: "medium",
        coverageNotes: [],
        quoteRequestNotes: ["Using the OpenOcean-modeled fallback until a native provider adapter is enabled."],
        routeSummary: "Route spans 4 venues",
        dexes: [{ dexCode: "Thena", shareBps: 6000 }],
        score: 0
      }
    ]
    }
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

class MockMarketAdapter implements MarketIntelligenceAdapter {
  async discoverBscDexUniverse() {
    return [
      { id: "pancakeswap-v3", displayName: "PancakeSwap V3", volume24h: 1000, category: "dex" as const },
      { id: "thena", displayName: "Thena", volume24h: 900, category: "dex" as const },
      { id: "woofi", displayName: "WOOFi", volume24h: 800, category: "dex" as const },
      { id: "openocean", displayName: "OpenOcean", volume24h: 700, category: "aggregator" as const }
    ]
  }

  async getChainDexOverview() {
    return [
      { name: "pancakeswap-v3", displayName: "PancakeSwap V3", volume24h: 1000 },
      { name: "thena", displayName: "Thena", volume24h: 900 },
      { name: "woofi", displayName: "WOOFi", volume24h: 800 }
    ]
  }

  async getDexSummary(input: { protocol: string }) {
    return {
      name: input.protocol,
      displayName: input.protocol,
      volume24h: 100
    }
  }

  async buildCuratedUniverseSnapshot() {
    return {
      discoveredCandidates: ["PancakeSwap V3", "Thena", "WOOFi", "OpenOcean"],
      curatedCandidates: [
        {
          id: "openoceanv2",
          displayName: "OpenOcean",
          category: "aggregator" as const,
          defiLlamaSlug: "openocean",
          bscRelevant: true,
          nativeQuoteStatus: "implemented" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: false,
            rateLimitNotes: "Subject to provider rate limits.",
            allowanceModel: "mixed" as const,
            responseShapeConfidence: "high" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-now" as const
          },
          included: true,
          notes: ["Directly connected today through the OpenOcean API."]
        },
        {
          id: "matcha",
          displayName: "Matcha / 0x",
          category: "aggregator" as const,
          defiLlamaSlug: "0x-api",
          bscRelevant: true,
          nativeQuoteStatus: "planned" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: true,
            rateLimitNotes: "Provider-specific auth and rate limits apply.",
            allowanceModel: "mixed" as const,
            responseShapeConfidence: "medium" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-now" as const
          },
          included: true,
          notes: ["Currently modeled through OpenOcean routing, not yet connected natively."]
        },
        {
          id: "paraswap",
          displayName: "ParaSwap",
          category: "aggregator" as const,
          defiLlamaSlug: "paraswap",
          bscRelevant: true,
          nativeQuoteStatus: "implemented" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: false,
            rateLimitNotes: "Provider-specific auth and rate limits apply.",
            allowanceModel: "mixed" as const,
            responseShapeConfidence: "medium" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-now" as const
          },
          included: true,
          notes: ["Native ParaSwap market routing is enabled through the Velora API."]
        },
        {
          id: "1inch",
          displayName: "1inch",
          category: "aggregator" as const,
          defiLlamaSlug: "1inch",
          bscRelevant: true,
          nativeQuoteStatus: "implemented" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: true,
            rateLimitNotes: "Provider-specific auth and rate limits apply.",
            allowanceModel: "mixed" as const,
            responseShapeConfidence: "medium" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-now" as const
          },
          included: true,
          notes: ["Native 1inch routing is enabled when ONEINCH_API_KEY is configured."]
        },
        {
          id: "pancakeswap",
          displayName: "PancakeSwap",
          category: "dex" as const,
          defiLlamaSlug: "pancakeswap-amm",
          bscRelevant: true,
          nativeQuoteStatus: "planned" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: false,
            rateLimitNotes: "Direct venue integration details vary by router/quoter design.",
            allowanceModel: "erc20-approval" as const,
            responseShapeConfidence: "medium" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-later" as const
          },
          included: true,
          notes: ["Top-priority direct BSC venue candidate."]
        },
        {
          id: "thena",
          displayName: "Thena",
          category: "dex" as const,
          defiLlamaSlug: "thena",
          bscRelevant: true,
          nativeQuoteStatus: "implemented" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: false,
            rateLimitNotes: "Direct venue integration details vary by router/quoter design.",
            allowanceModel: "erc20-approval" as const,
            responseShapeConfidence: "medium" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-later" as const
          },
          included: true,
          notes: ["Important BSC venue candidate for direct quote coverage."]
        },
        {
          id: "woofi",
          displayName: "WOOFi",
          category: "dex" as const,
          defiLlamaSlug: "woofi",
          bscRelevant: true,
          nativeQuoteStatus: "implemented" as const,
          feasibility: {
            quoteEndpointAvailable: true,
            swapBuildAvailable: true,
            bscSupported: true,
            authRequired: false,
            rateLimitNotes: "Direct venue integration details vary by router/quoter design.",
            allowanceModel: "erc20-approval" as const,
            responseShapeConfidence: "medium" as const,
            docsQuality: "medium" as const,
            recommendedAction: "implement-later" as const
          },
          included: true,
          notes: ["Important BSC venue candidate for direct quote coverage."]
        }
      ],
      implementedNativeAdapters: ["OpenOcean", "ParaSwap", "1inch"],
      implementedDirectDexCandidates: ["PancakeSwap", "Thena", "WOOFi"],
      modeledAdapters: ["Matcha / 0x"],
      implementNowCandidates: ["OpenOcean", "Matcha / 0x", "ParaSwap", "1inch"],
      implementLaterCandidates: ["PancakeSwap", "Thena", "WOOFi"],
      excludedCandidates: [],
      missingHighImpactCandidates: []
    }
  }

  async getVenueCoverageSnapshot() {
    return {
      topDexesObservedByDefiLlama: ["PancakeSwap V3", "Thena", "WOOFi"],
      topDexesObservedInQuotes: ["PancakeV3", "Thena"],
      missingHighShareVenues: ["WOOFi"],
      coverageRatio: 2 / 3,
      notes: ["DefiLlama is used as market intelligence."]
    }
  }
}

class MockSubmissionAdapter implements SubmissionCapabilityAdapter {
  async getSubmissionPaths(input: {
    mevRiskLevel: MevRiskAssessment["level"]
  }): Promise<SubmissionCandidate[]> {
    return [
      {
        path: "private-rpc",
        submissionChannel: "private-rpc",
        providerName: "PancakeSwap Private RPC",
        availability: "live",
        liveStatus: "live",
        recommended: input.mevRiskLevel !== "low",
        routeFamilies: ["direct-dex", "aggregator"],
        plannerControlLevel: "handoff",
        expectedPrivacy: "high",
        expectedInclusionQuality: "high",
        expectedLatency: "fast",
        attackSurface: "low",
        trustAssumption: "private rpc trust",
        operationalStatus: "advisory",
        score: 0.8,
        rationale: "preferred"
      },
      {
        path: "public-mempool",
        submissionChannel: "public-mempool",
        providerName: "Public wallet broadcast",
        availability: "live",
        liveStatus: "live",
        recommended: false,
        routeFamilies: ["direct-dex", "aggregator"],
        plannerControlLevel: "direct",
        expectedPrivacy: "low",
        expectedInclusionQuality: "medium",
        expectedLatency: "fast",
        attackSurface: "medium",
        trustAssumption: "public path",
        operationalStatus: "live",
        score: 0.5,
        rationale: "fallback"
      },
      {
        path: "intent-api",
        submissionChannel: "centralized-intent-server",
        providerName: "CoW-style intent server",
        availability: "stub",
        liveStatus: "info-only",
        recommended: false,
        routeFamilies: ["meta-aggregator", "solver-intent"],
        plannerControlLevel: "informational",
        expectedPrivacy: "high",
        expectedInclusionQuality: "medium",
        expectedLatency: "medium",
        attackSurface: "low",
        trustAssumption: "solver trust",
        operationalStatus: "info-only",
        score: 0.7,
        rationale: "future"
      },
      {
        path: "private-rpc",
        submissionChannel: "builder-aware-broadcast",
        providerName: "Builder-aware private broadcast",
        availability: "live",
        liveStatus: "live",
        recommended: false,
        routeFamilies: ["direct-dex", "aggregator"],
        plannerControlLevel: "handoff",
        expectedPrivacy: "high",
        expectedInclusionQuality: "high",
        expectedLatency: "medium",
        attackSurface: "low",
        trustAssumption: "builder broadcast trust",
        operationalStatus: "advisory",
        score: 0.75,
        rationale: "future"
      }
    ]
  }
}

class MockRegistry implements CapabilityRegistry {
  chain = new MockChainAdapter()
  quote = new MockQuoteAdapter()
  submission = new MockSubmissionAdapter()
  market = new MockMarketAdapter()
  async close(): Promise<void> {}
}

class CapturingQuoteAdapter extends MockQuoteAdapter {
  lastAmount?: string
  lastAmountRaw?: string

  override async getQuoteCandidatesWithAudit(input?: { amount: string; amountRaw: string }): Promise<any> {
    this.lastAmount = input?.amount
    this.lastAmountRaw = input?.amountRaw
    return super.getQuoteCandidatesWithAudit()
  }
}

class SingleRouteQuoteAdapter extends MockQuoteAdapter {
  override async getQuoteCandidatesWithAudit(): Promise<any> {
    const base = await super.getQuoteCandidatesWithAudit()
    return {
      ...base,
      candidates: base.candidates.slice(0, 1),
      audit: [
        { providerId: "openoceanv2", category: "aggregator", mode: "native", status: "observed", quoteCount: 1 },
        { providerId: "paraswap", category: "aggregator", mode: "native", status: "failed", reason: "quote-api-error", quoteCount: 0 }
      ]
    }
  }
}

class ApprovalBlockedQuoteAdapter extends MockQuoteAdapter {
  override async simulateTransaction() {
    return {
      ok: false,
      estimatedGas: "145000",
      note: "Gas estimation unavailable: Execution reverted with reason: BEP20: transfer amount exceeds allowance"
    }
  }
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
      expect(completed.response.result.executionPackages.length).toBeGreaterThanOrEqual(3)
      expect(completed.response.result.recommendedPlan.bestExecutionPackageId).toBeTruthy()
      expect(completed.response.result.executionBoundary.plannerControls.length).toBeGreaterThan(0)
      expect(completed.response.result.decisionTrace.length).toBeGreaterThanOrEqual(8)
      expect(
        completed.response.result.decisionTrace.some((step) => step.stage === "final-recommendation")
      ).toBe(true)
    }
  })

  it("auto-resolves obvious protocol token aliases", async () => {
    const registry = new MockRegistry()
    const session = await startPlanningSession({
      message: "Swap 0.001 BNB to Pancake swap token with low MEV risk",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: async () => ({
        action: "swap",
        sellToken: "BNB",
        buyToken: "PANCAKE SWAP TOKEN",
        amount: "0.001",
        slippageBps: null,
        preferences: {
          preferPrivate: true,
          preferFast: false,
          avoidStale: false
        },
        unknowns: []
      }),
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("plan")
    if (session.response?.kind === "plan") {
      expect(session.response.result.routeCandidates.length).toBeGreaterThan(0)
      const resolution = await registry.chain.resolveTokenDetailed?.("PANCAKE SWAP TOKEN", "bsc")
      expect(resolution?.resolvedBy).toBe("alias")
      expect(resolution?.resolvedToken?.symbol).toBe("CAKE")
    }
  })

  it("resolves all-in sell amounts from wallet balance before quoting", async () => {
    const registry = new MockRegistry()
    const quote = new CapturingQuoteAdapter()
    registry.quote = quote

    const session = await startPlanningSession({
      message: "Swap all USDT to BNB",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: async () => ({
        action: "swap",
        sellToken: "USDT",
        buyToken: "BNB",
        amount: "all",
        slippageBps: null,
        preferences: {
          preferPrivate: true,
          preferFast: false,
          avoidStale: false
        },
        unknowns: []
      }),
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("plan")
    expect(quote.lastAmount).toBe("250")
    expect(quote.lastAmountRaw).toBe("250000000000000000000")
  })

  it("continues planning when only one executable route is observed", async () => {
    const registry = new MockRegistry()
    registry.quote = new SingleRouteQuoteAdapter()

    const session = await startPlanningSession({
      message: "Swap 100 USDT to BNB",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: mockIntentExtractor,
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("plan")
    if (session.response?.kind === "plan") {
      expect(session.response.result.routeCandidates).toHaveLength(1)
      expect(session.response.result.payloadCandidates.length).toBeGreaterThan(0)
    }
  })

  it("continues planning when ERC20 sell routes are approval-gated", async () => {
    const registry = new MockRegistry()
    registry.quote = new ApprovalBlockedQuoteAdapter()

    const session = await startPlanningSession({
      message: "Swap 100 USDT to BNB",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: mockIntentExtractor,
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("plan")
    if (session.response?.kind === "plan") {
      expect(session.response.result.payloadCandidates.length).toBeGreaterThan(0)
      expect(session.response.result.payloadCandidates[0]?.approvalRequired).toBe(true)
      expect(session.response.result.payloadCandidates[0]?.simulation.ok).toBe(true)
      expect(session.response.result.payloadCandidates[0]?.simulation.note).toBe("approval-required")
    }
  })

  it("asks a follow-up when a token phrase stays ambiguous", async () => {
    const registry = new MockRegistry()
    const session = await startPlanningSession({
      message: "Swap 0.001 BNB to Pancake with low MEV risk",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: async () => ({
        action: "swap",
        sellToken: "BNB",
        buyToken: "PANCAKE",
        amount: "0.001",
        slippageBps: null,
        preferences: {
          preferPrivate: true,
          preferFast: false,
          avoidStale: false
        },
        unknowns: []
      }),
      stageSummarizer: mockStageSummarizer
    })

    expect(session.response?.kind).toBe("follow-up")
    if (session.response?.kind === "follow-up") {
      expect(session.response.question).toContain("Did you mean CAKE")
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

    const result = session.response.result
    const formatted = formatPlan(result)
    const debugFormatted = formatDebugPlan(result)
    const presentation = createPresentationResult(result)
    const bestPricePackage = result.executionPackages.find((pkg) => pkg.id === result.recommendedPlan.bestPricePackageId)
    const bestExecutionPackage = result.executionPackages.find(
      (pkg) => pkg.id === result.recommendedPlan.bestExecutionPackageId
    )

    expect(formatted).toContain("known")
    expect(formatted).toContain("best")
    expect(formatted).toContain("live")
    expect(formatted).toContain("ops")
    expect(formatted).toContain("used")
    expect(formatted).toContain("evidence")
    expect(formatted).toContain("sign")
    expect(formatted).toContain("guard")
    expect(formatted).toContain("next")
    expect(formatted).toContain("boundary")
    expect(formatted).toContain("slippage=")
    expect(formatted).toContain("dry-run=")
    expect(formatted).not.toContain("caps")
    expect(formatted).not.toContain("### JSON")
    expect(formatted).not.toContain("execution_packages")
    expect(formatted).toContain("evidence")
    expect(formatted).toContain("local simulation only")
    expect(debugFormatted).toContain("### Decision Trace")
    expect(debugFormatted).toContain("execution_packages")
    expect(bestPricePackage).toBeTruthy()
    expect(bestExecutionPackage).toBeTruthy()
    expect(bestExecutionPackage?.submissionProvider).toBe("PancakeSwap Private RPC")
    expect(bestExecutionPackage?.executionMode).toBe("self-executed")
    expect(bestPricePackage?.id).not.toBe(bestExecutionPackage?.id)
    expect(result.bestObservedQuoteConfidence).toBeTruthy()
    expect(result.venueCoverageSnapshot.missingHighShareVenues).toContain("WOOFi")
    expect(result.providerUniverseSnapshot.curatedCandidates.length).toBeGreaterThan(0)
    expect(result.quoteProviderAudit.length).toBeGreaterThan(0)
    expect(result.quoteObservedAt).toBeTruthy()
    expect(result.quoteFreshness).toBeTruthy()
    expect(result.effectiveSlippageBps).toBe(50)
    expect(result.executionReadyNow).toBeTruthy()
    expect(result.bestQuoteRouteId).toBeTruthy()
    expect(result.bestReadyRouteId).toBeTruthy()
    expect(result.jitRouterRequest).toBeUndefined()
    expect(result.providerUniverseSnapshot.modeledAdapters).toContain("Matcha / 0x")
    expect(result.alternativesRejected.length).toBeGreaterThanOrEqual(1)
    expect(result.decisionTrace.some((step) => step.stage === "price-impact-assessment")).toBe(true)
    expect(result.executionBoundary.externalExecutorControls.length).toBeGreaterThan(0)
    expect(presentation.presentationTrace).toHaveLength(3)
    expect(presentation.intentSummary).not.toContain("summary_error")
    expect(presentation.recommendationSummary).toContain("preferred handoff is builder relay handoff")
    expect(presentation.boundarySummary).toContain("I control the planning")
    expect(presentation.quoteConfidenceSummary).toContain("observed market read")
    expect(presentation.quoteConfidenceSummary).not.toContain("Still modeled through OpenOcean")
    expect(presentation.routeCards.length).toBeGreaterThan(0)
    expect(result.recommendedHandoff).toBe("builder-broadcast-handoff")
    expect(result.privateSubmitRequest?.liveStatus).toBe("live")
    expect(result.privateSubmitRequest?.cliCommand).toContain("submit:private")
    expect(formatted).toContain("builder-broadcast-handoff")
    expect(formatted).toContain("signed raw tx required")
    expect(formatted).not.toContain("experimental")
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
          event.stage === "execution-package-comparison" &&
          event.data?.reasoningSource === "llm"
      )
    ).toBe(true)
    expect(events.at(-1)?.kind).toBe("plan-completed")
  })

  it("builds a live presentation trace without leaking internal summary labels", async () => {
    const registry = new MockRegistry()
    const events: PlanningEvent[] = []
    let finalResult: import("@bsc-swap-agent-demo/shared").PlanningResult | null = null

    for await (const event of runPlanningStream({
      message: "Swap 100 USDT to BNB with low MEV risk",
      context: {
        network: "bsc",
        walletAddress: "0xwallet",
        submitEnabled: false
      },
      registry,
      sessionId: "session-live-trace",
      intentExtractor: mockIntentExtractor,
      stageSummarizer: async () => {
        throw new Error("summary failed")
      }
    })) {
      events.push(event)
      if (event.kind === "plan-completed" && event.data?.result) {
        finalResult = event.data.result
      }
    }

    const trace = createPartialPresentationTrace({ events, result: finalResult })
    const understood = trace.find((item) => item.title === "What I understood")
    const compared = trace.find((item) => item.title === "What I compared")
    const recommended = trace.find((item) => item.title === "What I recommend")

    expect(trace).toHaveLength(3)
    expect(understood?.status).toBe("completed")
    expect(compared?.status).toBe("completed")
    expect(recommended?.status).toBe("completed")
    expect(compared?.details.toolsUsed).toContain("Look up routes")
    expect(compared?.details.observations.some((field) => field.label.includes("summary error"))).toBe(false)
    expect(compared?.details.decisions.some((decision) => decision.includes("summarizeStageWithLLM"))).toBe(false)
    expect(formatStreamingUpdate(trace[0] as PartialPresentationTraceItem)).toContain("What I understood")
  })

  it("marks OpenOcean-modeled providers as observed quotes rather than independent native quotes", async () => {
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

    const result = session.response.result
    const matchaRoute = result.routeCandidates.find((route) => route.id === "matcha")
    const presentation = createPresentationResult(result)

    expect(matchaRoute?.providerNative).toBe(false)
    expect(matchaRoute?.quoteSource).toBe("openocean")
    expect(matchaRoute?.coverageNotes?.join(" ")).toContain("modeled through openocean")
    expect(presentation.comparisonSummary).toContain("live options")
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
          event.stage === "execution-package-comparison" &&
          event.data?.reasoningSource === "deterministic"
      )
    ).toBe(true)
    expect(
      events.some(
        (event) =>
          event.kind === "reasoning" &&
          event.stage === "final-recommendation" &&
          event.data?.reasoningSource === "deterministic"
      )
    ).toBe(true)
    expect(events.at(-1)?.kind).toBe("plan-completed")
  })

  it("builds both self-executed and delegated execution packages with public fallback context", async () => {
    const registry = new MockRegistry()
    const session = await startPlanningSession({
      message: "Swap 100 USDT to BNB with low MEV risk",
      network: "bsc",
      walletAddress: "0xwallet",
      registry,
      intentExtractor: mockIntentExtractor,
      stageSummarizer: async () => {
        throw new Error("skip llm summary")
      }
    })

    expect(session.response?.kind).toBe("plan")
    if (session.response?.kind !== "plan") {
      return
    }

    const result = session.response.result
    const selfExecuted = result.executionPackages.filter((pkg) => pkg.executionMode === "self-executed")
    const delegated = result.executionPackages.filter((pkg) => pkg.executionMode === "delegated-to-solver")
    const publicCandidate = result.submissionCandidates.find(
      (candidate) => candidate.submissionChannel === "public-mempool"
    )
    const delegatedPackage = result.executionPackages.find((pkg) => pkg.executionMode === "delegated-to-solver")
    const bestExecutionPackage = result.executionPackages.find(
      (pkg) => pkg.id === result.recommendedPlan.bestExecutionPackageId
    )

    expect(selfExecuted.length).toBeGreaterThan(0)
    expect(delegated.length).toBeGreaterThan(0)
    expect(publicCandidate?.providerName).toBe("Public wallet broadcast")
    expect(publicCandidate?.rationale).toContain("fallback")
    expect(delegatedPackage?.payloadType).toBe("approval-plus-intent")
    expect(delegatedPackage?.submissionChannel).toBe("centralized-intent-server")
    expect(bestExecutionPackage?.id).not.toBe(delegatedPackage?.id)
    expect(bestExecutionPackage?.submissionProvider).toBe("PancakeSwap Private RPC")
  })

  it("builds a browser-wallet public transaction request shape", () => {
    const request = buildPublicTransactionRequest({
      network: "bsc",
      walletAddress: "0xwallet",
      payload: {
        id: "payload-1",
        type: "router-calldata",
        platform: "openoceanv2",
        routeFamily: "aggregator",
        to: "0xrouter",
        data: "0xabcdef",
        value: "0",
        minOutAmount: "990",
        estimatedGas: "120000",
        executionMode: "self-executed",
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
    expect(request.path).toBe("public-mempool")
    expect(request.minOutAmount).toBe("990")
  })

  it("sanitizes quota errors for user-facing surfaces", () => {
    const message = toUserFacingErrorMessage(
      '{"error":{"code":429,"message":"Quota exceeded. Please retry in 45.8s.","status":"RESOURCE_EXHAUSTED"}}'
    )

    expect(message).toContain("Gemini quota is currently exhausted")
    expect(message).toContain("Retry in about")
    expect(message).not.toContain("RESOURCE_EXHAUSTED")
  })

  it("sanitizes insufficient-funds simulation errors for user-facing surfaces", () => {
    const message = toUserFacingErrorMessage(
      "RPC simulation failed: insufficient funds for gas * price + value: address 0xabc have 0 want 1000000000000000"
    )

    expect(message).toBe(
      "The selected wallet does not have enough BNB to cover the swap value plus gas for simulation."
    )
  })

  it("surfaces token resolution suggestions in user-facing errors", () => {
    const message = toUserFacingErrorMessage("Could not resolve token 'PANCAKE SWAP TOKEN' on bsc. suggest CAKE")

    expect(message).toContain("Could not resolve token")
    expect(message).toContain("Did you mean CAKE")
  })
})
