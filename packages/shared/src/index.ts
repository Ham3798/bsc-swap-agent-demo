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

export type DecisionTraceStage =
  | "intent-parsing"
  | "missing-field-resolution"
  | "liquidity-discovery"
  | "route-comparison"
  | "price-impact-assessment"
  | "mev-risk-assessment"
  | "payload-construction"
  | "guardrail-application"
  | "submission-strategy"
  | "final-recommendation"

export interface DecisionTraceField {
  label: string
  value: string
}

export interface DecisionTraceStep {
  id: string
  stage: DecisionTraceStage
  title: string
  status: "completed" | "needs-input" | "failed"
  summary: string
  inputs: DecisionTraceField[]
  observations: DecisionTraceField[]
  decision?: string
  artifacts: DecisionTraceField[]
}

export type PlanningEventKind =
  | "stage-started"
  | "stage-completed"
  | "stage-failed"
  | "tool-started"
  | "tool-succeeded"
  | "tool-failed"
  | "reasoning"
  | "follow-up-required"
  | "plan-completed"

export type PlanningEventStatus = "running" | "completed" | "failed" | "needs-input"
export type ReasoningSource = "deterministic" | "llm"

export interface PlanningEvent {
  id: string
  kind: PlanningEventKind
  timestamp: string
  sessionId?: string
  stage: DecisionTraceStage
  status: PlanningEventStatus
  message: string
  data?: {
    title?: string
    toolName?: string
    inputPreview?: DecisionTraceField[]
    outputPreview?: DecisionTraceField[]
    observations?: DecisionTraceField[]
    decision?: string
    reasoningSource?: ReasoningSource
    model?: string
    promptVersion?: string
    artifacts?: DecisionTraceField[]
    question?: string
    missingField?: UnknownField
    intent?: StructuredIntent
    missingFieldsResolved?: MissingFieldResolution[]
    state?: PlanningSessionState
    result?: PlanningResult
    error?: string
  }
}

export interface TokenRef {
  symbol: string
  address: string
  decimals: number
  isNative?: boolean
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

export type SubmissionPath =
  | "public-mempool"
  | "private-rpc"
  | "multi-builder-broadcast"
  | "intent-api"

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

export interface PublicTransactionRequest {
  chainId: number
  from?: string
  to: string
  data: string
  value: string
  gas?: string
  rationale: string
}

export interface PrivateSubmissionRequest {
  mode: "private-rpc"
  network: Network
  routeId: string
  payloadId: string
  note: string
  guardrails: Guardrail[]
}

export interface IntentSubmissionRequest {
  mode: "intent-api"
  network: Network
  intent: StructuredIntent
  routeId: string
  payloadType: PayloadType
  note: string
}

export interface PlanningResult {
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
  decisionTrace: DecisionTraceStep[]
  liquiditySnapshot: LiquiditySnapshot
  routeCandidates: RouteCandidate[]
  priceImpactAssessment: PriceImpactAssessment
  mevRiskAssessment: MevRiskAssessment
  payloadCandidates: PayloadCandidate[]
  submissionCandidates: SubmissionCandidate[]
  guardrails: Guardrail[]
  recommendedPlan: RecommendedPlan
  alternativesRejected: AlternativeRejected[]
  publicSubmitRequest?: PublicTransactionRequest
  privateSubmitRequest?: PrivateSubmissionRequest
  intentSubmitRequest?: IntentSubmissionRequest
}

export interface FollowUpResponse {
  kind: "follow-up"
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
  partialDecisionTrace: DecisionTraceStep[]
  partialEvents: PlanningEvent[]
  question: string
}

export interface SkillContext {
  network: Network
  walletAddress?: string
  submitEnabled?: boolean
}

export interface PlanningSessionState {
  rawInput: string
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
  events: PlanningEvent[]
}

export type SkillResponse = FollowUpResponse | { kind: "plan"; result: PlanningResult }

export interface PlanningSessionSnapshot {
  sessionId: string
  status: "awaiting_follow_up" | "planned"
  rawMessage: string
  context: SkillContext
  state: PlanningSessionState
  events: PlanningEvent[]
  currentStage?: DecisionTraceStage
  followUp?: { question: string; missingField: UnknownField }
  finalResult?: PlanningResult
  response?: SkillResponse
}
