import type {
  ExecutionCapabilityUsage,
  ExecutionCapabilitySummary,
  MevRiskAssessment,
  Network,
  PrivatePathRegistrySummary,
  ProviderUniverseSnapshot,
  QuoteProviderAuditEntry,
  RouteCandidate,
  SubmissionCandidate,
  TokenRef,
  VenueCoverageSnapshot
} from "@bsc-swap-agent-demo/shared"

export interface ChainCapabilityAdapter {
  listTools(): Promise<string[]>
  getChainInfo(network: Network): Promise<unknown>
  getNativeBalance(
    address: string,
    network: Network
  ): Promise<{ formatted: string; raw: string; symbol?: string }>
  getErc20Balance(
    tokenAddress: string,
    address: string,
    network: Network
  ): Promise<{ formatted: string; raw: string; symbol?: string }>
  getErc20TokenInfo(tokenAddress: string, network: Network): Promise<unknown>
  resolveToken(query: string, network: Network): Promise<TokenRef | null>
  estimateGas(input: {
    network: Network
    to: string
    data?: string
    value?: string
  }): Promise<{ estimatedGas?: string }>
}

export interface QuoteCapabilityAdapter {
  getQuoteCandidates(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<RouteCandidate[]>
  getQuoteCandidatesWithAudit?(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
  }): Promise<{
    candidates: RouteCandidate[]
    audit: QuoteProviderAuditEntry[]
    observedAt: string
  }>
  encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    amountRaw: string
    slippageBps: number
    account: string
  }): Promise<{
    platform: string
    to: string
    data: string
    value: string
    minOutAmount: string
    estimatedGas: string
  }>
  simulateTransaction(input: {
    network: Network
    account: string
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }>
}

export interface SubmissionCapabilityAdapter {
  getSubmissionPaths(input: {
    network: Network
    mevRiskLevel: MevRiskAssessment["level"]
    preferPrivate: boolean | null
  }): Promise<SubmissionCandidate[]>
  getPrivatePathRegistrySummary?(input: {
    network: Network
  }): Promise<PrivatePathRegistrySummary | undefined>
  getExecutionCapabilitySummary?(input: {
    network: Network
  }): Promise<ExecutionCapabilitySummary | undefined>
  simulateCandidateRoutes?(input: {
    network: Network
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
    slippageBps: number
    account: string
    routeIds?: string[]
  }): Promise<{
    routeIds: string[]
    confirmed: boolean
    note: string
    usage: ExecutionCapabilityUsage
  }>
}

export interface MarketIntelligenceAdapter {
  discoverBscDexUniverse(input: {
    network: Network
  }): Promise<Array<{ id: string; displayName: string; volume24h?: number | null; category: "aggregator" | "dex" }>>
  getChainDexOverview(input: {
    network: Network
  }): Promise<Array<{ name: string; displayName: string; volume24h?: number | null }>>
  getDexSummary(input: {
    protocol: string
  }): Promise<{ name: string; displayName: string; volume24h?: number | null; chains?: string[] } | null>
  buildCuratedUniverseSnapshot(input: {
    network: Network
  }): Promise<ProviderUniverseSnapshot>
  getVenueCoverageSnapshot(input: {
    network: Network
    observedDexes: string[]
    pair?: { sellToken: string; buyToken: string }
  }): Promise<VenueCoverageSnapshot>
}

export interface CapabilityRegistry {
  chain: ChainCapabilityAdapter
  quote: QuoteCapabilityAdapter
  submission: SubmissionCapabilityAdapter
  market: MarketIntelligenceAdapter
  close(): Promise<void>
}
