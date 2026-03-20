export type Network = "bsc" | "bsc-testnet"

export type UnknownField =
  | "sell_token"
  | "buy_token"
  | "amount"
  | "slippage_bps"

export interface Preferences {
  preferPrivate: boolean | null
  preferFast: boolean | null
  avoidStale: boolean | null
}

export interface StructuredIntent {
  action: "swap" | "unknown"
  sellToken: string | null
  buyToken: string | null
  amount: string | null
  slippageBps: number | null
  preferences: Preferences
  unknowns: UnknownField[]
}

export interface MissingFieldResolution {
  field: UnknownField
  value: string
  source: "user" | "wallet-balance-context"
}

export interface TokenRef {
  symbol: string
  address: string
  decimals: number
  isNative?: boolean
}

export interface ToolObservation {
  tool: string
  input: Record<string, unknown>
  output: unknown
}

export interface LiquidityVenueShare {
  dexCode: string
  shareBps: number
}

export interface LiquiditySnapshot {
  sellToken: string
  buyToken: string
  totalCandidateCount: number
  dominantVenues: LiquidityVenueShare[]
  note: string
}

export interface RouteCandidate {
  id: string
  platform: string
  quotedOut: string
  quotedOutFormatted: string
  priceImpactPct: number
  estimatedGas: string
  expectedExecutionStability: "high" | "medium" | "low"
  protocolFit: "aggregator" | "single-venue" | "hybrid"
  mevExposure: "high" | "medium" | "low"
  routeSummary: string
  dexes: LiquidityVenueShare[]
  score: number
  rejectionReason?: string
}

export interface PriceImpactAssessment {
  bestQuotedRouteId: string | null
  lowestImpactRouteId: string | null
  commentary: string
}

export interface MevRiskAssessment {
  level: "high" | "medium" | "low"
  summary: string
  publicPathRisk: string
  preferredSubmission: SubmissionPath
}

export type PayloadType = "router-calldata" | "offchain-intent" | "multicall"

export interface PayloadCandidate {
  id: string
  type: PayloadType
  platform: string
  to: string
  data: string
  value: string
  minOutAmount: string
  estimatedGas: string
  simulation: {
    ok: boolean
    estimatedGas: string
    note: string
  }
}

export type SubmissionPath =
  | "public-mempool"
  | "private-rpc"
  | "multi-builder-broadcast"

export interface SubmissionCandidate {
  path: SubmissionPath
  availability: "advisory" | "stub" | "live"
  recommended: boolean
  rationale: string
  riskNote?: string
}

export interface Guardrail {
  name:
    | "simulation-required"
    | "slippage-bound"
    | "deadline"
    | "stale-quote-stop"
    | "public-path-warning"
  status: "required" | "recommended"
  value: string
  rationale: string
}

export interface RecommendedPlan {
  routeId: string
  payloadId: string
  submissionPath: SubmissionPath
  expectedOut: string
  summary: string
  riskNote: string
  policyNote: string
}

export interface AlternativeRejected {
  routeId: string
  reason: string
}

export interface PlanningResult {
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
  liquiditySnapshot: LiquiditySnapshot
  routeCandidates: RouteCandidate[]
  priceImpactAssessment: PriceImpactAssessment
  mevRiskAssessment: MevRiskAssessment
  payloadCandidates: PayloadCandidate[]
  submissionCandidates: SubmissionCandidate[]
  guardrails: Guardrail[]
  recommendedPlan: RecommendedPlan
  alternativesRejected: AlternativeRejected[]
}

export interface FollowUpResponse {
  kind: "follow-up"
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
  question: string
}

export interface SkillContext {
  network: Network
  walletAddress?: string
  submitEnabled?: boolean
}

export type SkillResponse = FollowUpResponse | { kind: "plan"; result: PlanningResult }

export interface CapabilityLayer {
  listTools(): Promise<string[]>
  getChainInfo(network: Network): Promise<unknown>
  getNativeBalance(address: string, network: Network): Promise<{ formatted: string; raw: string; symbol?: string }>
  getErc20Balance(
    tokenAddress: string,
    address: string,
    network: Network
  ): Promise<{ formatted: string; raw: string; symbol?: string }>
  getErc20TokenInfo(tokenAddress: string, network: Network): Promise<unknown>
  resolveToken(query: string, network: Network): Promise<TokenRef | null>
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
  }): Promise<Omit<PayloadCandidate, "id" | "type" | "simulation">>
  simulateTransaction(input: {
    network: Network
    to: string
    data: string
    value: string
  }): Promise<{ ok: boolean; estimatedGas: string; note: string }>
  getSubmissionPaths(input: {
    network: Network
    mevRiskLevel: MevRiskAssessment["level"]
    preferPrivate: boolean | null
  }): Promise<SubmissionCandidate[]>
  close(): Promise<void>
}
