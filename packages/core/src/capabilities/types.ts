import type {
  MevRiskAssessment,
  Network,
  RouteCandidate,
  SubmissionCandidate,
  TokenRef
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
    slippageBps: number
  }): Promise<RouteCandidate[]>
  encodeRouterCalldata(input: {
    network: Network
    platform: string
    sellToken: TokenRef
    buyToken: TokenRef
    amount: string
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
}

export interface CapabilityRegistry {
  chain: ChainCapabilityAdapter
  quote: QuoteCapabilityAdapter
  submission: SubmissionCapabilityAdapter
  close(): Promise<void>
}
