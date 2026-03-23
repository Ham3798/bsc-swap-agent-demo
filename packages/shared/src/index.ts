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
  | "execution-family-selection"
  | "liquidity-discovery"
  | "route-comparison"
  | "price-impact-assessment"
  | "mev-risk-assessment"
  | "payload-construction"
  | "execution-package-construction"
  | "execution-package-comparison"
  | "path-quality-assessment"
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

export type QuoteMethod = "aggregator-http" | "native-http" | "onchain-quoter"
export type CoverageConfidence = "high" | "medium" | "low"
export type CuratedVenueCategory = "aggregator" | "dex"
export type QuoteAuditCategory = "aggregator" | "meta-aggregator" | "dex" | "modeled"
export type QuoteAuditMode = "native" | "modeled" | "direct"
export type QuoteAuditStatus = "observed" | "unsupported" | "failed" | "empty"
export type NativeQuoteStatus = "none" | "planned" | "implemented"
export type RecommendedAction = "implement-now" | "implement-later" | "exclude"
export type ResponseShapeConfidence = "high" | "medium" | "low"
export type DocsQuality = "high" | "medium" | "low"
export type AllowanceModel = "native-input" | "erc20-approval" | "mixed" | "unknown"
export type RouteSourceType = "native" | "modeled" | "fallback"

export interface ProviderFeasibility {
  quoteEndpointAvailable: boolean
  swapBuildAvailable: boolean
  bscSupported: boolean
  authRequired: boolean
  rateLimitNotes: string
  allowanceModel: AllowanceModel
  responseShapeConfidence: ResponseShapeConfidence
  docsQuality: DocsQuality
  recommendedAction: RecommendedAction
}

export interface VenueCoverageSnapshot {
  topDexesObservedByDefiLlama: string[]
  topDexesObservedInQuotes: string[]
  missingHighShareVenues: string[]
  coverageRatio: number
  notes: string[]
}

export interface CuratedVenue {
  id: string
  displayName: string
  category: CuratedVenueCategory
  defiLlamaSlug?: string
  bscRelevant: boolean
  nativeQuoteStatus: NativeQuoteStatus
  feasibility: ProviderFeasibility
  included: boolean
  notes: string[]
}

export interface ProviderUniverseSnapshot {
  discoveredCandidates: string[]
  curatedCandidates: CuratedVenue[]
  implementedNativeAdapters: string[]
  implementedDirectDexCandidates: string[]
  modeledAdapters: string[]
  implementNowCandidates: string[]
  implementLaterCandidates: string[]
  excludedCandidates: string[]
  missingHighImpactCandidates: string[]
}

export interface RouteCandidate {
  id: string
  platform: string
  routeFamily: RouteFamily
  quoteSource: string
  routeSourceType: RouteSourceType
  quoteMethod: QuoteMethod
  providerNative: boolean
  providerUniverseCategory: CuratedVenueCategory
  feasibilityStatus: RecommendedAction
  quotedOut: string
  quotedOutFormatted: string
  priceImpactPct: number
  estimatedGas: string
  expectedExecutionStability: "high" | "medium" | "low"
  protocolFit: "aggregator" | "single-venue" | "hybrid"
  mevExposure: "high" | "medium" | "low"
  coverageConfidence: CoverageConfidence
  coverageNotes?: string[]
  quoteRequestNotes?: string[]
  routeSummary: string
  dexes: LiquidityVenueShare[]
  score: number
  rejectionReason?: string
}

export interface QuoteProviderAuditEntry {
  providerId: string
  category: QuoteAuditCategory
  mode: QuoteAuditMode
  status: QuoteAuditStatus
  reason?: string
  rawReason?: string
  quoteCount: number
  latencyMs?: number
}

export interface PriceImpactAssessment {
  bestQuotedRouteId: string | null
  lowestImpactRouteId: string | null
  bestExecutionRouteId?: string | null
  commentary: string
}

export type SubmissionPath = "public-mempool" | "private-rpc" | "intent-api"
export type SubmissionChannel =
  | "public-mempool"
  | "private-rpc"
  | "centralized-intent-server"
  | "builder-aware-broadcast"
export type RouteFamily =
  | "direct-dex"
  | "aggregator"
  | "meta-aggregator"
  | "solver-intent"
  | "protocol-specific"
export type ExecutionMode =
  | "self-executed"
  | "delegated-to-solver"
  | "delegated-to-server"
export type PlannerControlLevel = "direct" | "handoff" | "informational"
export type SubmissionSourceType = "registry-backed" | "direct-public-rpc" | "intent-server"
export type SubmissionVerificationStatus = "unverified" | "reachable" | "protocol-unknown" | "verified"
export type PayloadType =
  | "router-calldata"
  | "multicall"
  | "signed-intent"
  | "server-handoff"
  | "approval-plus-intent"

export interface MevRiskAssessment {
  level: "high" | "medium" | "low"
  summary: string
  publicPathRisk: string
  preferredSubmission: SubmissionPath
  riskDrivers: string[]
  preferredSubmissionFamily: SubmissionChannel
}

export interface PayloadCandidate {
  id: string
  type: PayloadType
  platform: string
  routeFamily: RouteFamily
  to: string
  data: string
  value: string
  minOutAmount: string
  estimatedGas: string
  executionMode: ExecutionMode
  approvalRequired?: boolean
  simulation: {
    ok: boolean
    estimatedGas: string
    note: string
  }
}

export interface SubmissionCandidate {
  path: SubmissionPath
  submissionChannel: SubmissionChannel
  providerName: string
  sourceType?: SubmissionSourceType
  verificationStatus?: SubmissionVerificationStatus
  endpointCount?: number
  endpointSample?: string[]
  availability: "advisory" | "stub" | "live"
  liveStatus: "live" | "advisory" | "info-only"
  recommended: boolean
  routeFamilies: RouteFamily[]
  plannerControlLevel: PlannerControlLevel
  expectedPrivacy: "high" | "medium" | "low"
  expectedInclusionQuality: "high" | "medium" | "low"
  expectedLatency: "fast" | "medium" | "slow"
  attackSurface: "high" | "medium" | "low"
  trustAssumption: string
  operationalStatus: string
  score: number
  rationale: string
  riskNote?: string
}

export interface EndpointProbeResult {
  endpointId: string
  reachable: boolean
  acceptsJsonRpc: boolean
  standardMethodsAvailable: string[]
  sendMethodObserved: boolean
  authRequiredLikely: boolean
  rawSendFeasible: boolean
  remarks: string[]
}

export interface PrivateSubmissionEndpoint {
  id: string
  displayName: string
  type: "validator-mev-rpc" | "builder-relay"
  rpcUrl: string
  website?: string
  contact?: string
  sourceFile: string
  verificationStatus: SubmissionVerificationStatus
  notes: string[]
  probe?: EndpointProbeResult
}

export interface PrivatePathRegistrySummary {
  validatorEndpointCount: number
  builderEndpointCount: number
  probedEndpointId?: string
  probedVerificationStatus?: SubmissionVerificationStatus
  notes: string[]
}

export interface ExecutionCapabilitySummary {
  available: boolean
  toolCount: number
  tools: string[]
  privateRegistryAvailable: boolean
  privateSubmitAvailable: boolean
  builderBroadcastAvailable: boolean
  auditAvailable: boolean
  routeSimulationAvailable: boolean
  registrySummary?: PrivatePathRegistrySummary
  notes: string[]
}

export type ExecutionCapabilityName =
  | "private-submit"
  | "builder-broadcast"
  | "audit"
  | "route-sim"

export interface ExecutionCapabilityUsage {
  available: ExecutionCapabilityName[]
  used: ExecutionCapabilityName[]
  notes: string[]
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
  executionPackageId: string
  bestPricePackageId: string
  bestExecutionPackageId: string
  executionMode: ExecutionMode
  submissionChannel: SubmissionChannel
  submissionProvider: string
  expectedOut: string
  summary: string
  riskNote: string
  policyNote: string
}

export type SelectionReasonCode =
  | "best-quote-also-selected"
  | "simulation-winner"
  | "private-path-winner"
  | "execution-package-winner"
  | "quote-winner-not-buildable"
  | "quote-winner-not-simulated"

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
  path: "public-mempool"
  minOutAmount?: string
  slippageBps?: number
  deadlineSeconds?: number
  rationale: string
}

export interface PrivateSubmissionTarget {
  endpointId: string
  displayName: string
  rpcUrl: string
  verificationStatus: SubmissionVerificationStatus
  type: "validator-mev-rpc" | "builder-relay"
}

export interface PrivateSubmissionRequest {
  mode: "private-rpc"
  network: Network
  routeId: string
  payloadId: string
  submissionFamily: SubmissionChannel
  providerName: string
  liveStatus: "live" | "advisory" | "info-only"
  preferredChannel?: "validator" | "builder" | "both"
  method?: "eth_sendRawTransaction"
  endpointType?: "validator-mev-rpc" | "builder-relay" | "mixed"
  suggestedTargets?: PrivateSubmissionTarget[]
  recommendedTargetCount?: number
  whyChosen: string
  requiredCapabilities: string[]
  userAction?: string
  cliCommand?: string
  note: string
  guardrails: Guardrail[]
}

export interface JitRouterRequestCandidate {
  routeId: string
  payloadId: string
  adapterId: number
  router: string
  callData: string
  value: string
  minOutAmount: string
}

export interface JitRouterOrder {
  user: string
  recipient: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  minOutAmount: string
  maxBlockNumber: string
  nonce: string
  candidateSetHash: string
}

export interface JitRouterRequest {
  mode: "jit-router"
  network: Network
  routerAddress: string
  payloadType: "jit-router-calldata"
  order: JitRouterOrder
  approvalSpender: string
  candidates: JitRouterRequestCandidate[]
  note: string
}

export type ExecutionRecommendationMode = "jit-best-of-3" | "direct-route"

export interface PrivateSubmissionResult {
  endpointId: string
  displayName: string
  rpcUrl: string
  type: "validator-mev-rpc" | "builder-relay"
  accepted: boolean
  latencyMs: number
  txHash?: string
  error?: string
}

export interface ExecutionAudit {
  txHash: string
  chainId: number
  blockNumber?: bigint
  submittedAt?: string
  submittedBlockNumber?: string
  confirmedAt?: string
  inclusionBlockDelta?: number
  status: "success" | "reverted" | "pending" | "not-found"
  gasUsed?: bigint
  effectiveGasPrice?: bigint
  inclusionLatencyMs?: number
  inclusionWallClockMs?: number
  chainTimestampDeltaMs?: number
  buyTokenAddress?: string
  recipient?: string
  expectedOut?: string
  expectedQuoteOut?: string
  protectedMinOut?: string
  realizedOut?: string
  realizedDelta?: string
  quoteDeltaRaw?: string
  minOutDeltaRaw?: string
  executionPath?: "public-mempool" | "private-rpc" | "builder-aware-broadcast" | "unknown"
  executedRouteId?: string
  jitSelectedCandidateIndex?: number
  armedCandidateRouteIds?: string[]
}

export interface SwapExecutionSigningSummary {
  signer: string
  nonce: string
  gas: string
  gasPrice: string
  rawTransaction: string
}

export interface SwapExecutionSubmissionSummary {
  channel: "builder"
  endpointCount: number
  acceptedCount: number
  txHash?: string
  submittedAt: string
  submittedBlockNumber?: string
  startedAtMonotonicMs?: number
  firstAcceptedAtMonotonicMs?: number
  builderRoundTripMs?: number
  acceptedEndpointId?: string
  acceptedEndpointName?: string
  results: PrivateSubmissionResult[]
}

export interface SwapExecutionFeedback {
  timeliness: "good" | "weak" | "unknown"
  priceProtection: "held" | "within-guardrail" | "failed" | "unknown"
  executionQuality: "good" | "failed" | "pending"
  mevProtectionAssessment: "private-builder-path-used" | "private-builder-path-unavailable" | "not-submitted"
  preTradeFindings: string[]
  submitFindings: string[]
  postTradeFindings: string[]
  summaryVerdict: string
  notes: string[]
}

export interface SwapExecutionPhaseSummary {
  signed: boolean
  submitted: boolean
  skippedReason?: string
  signing?: SwapExecutionSigningSummary
  submission?: SwapExecutionSubmissionSummary
  audit?: ExecutionAudit
}

export interface SwapExecutionSummary {
  mode: "live" | "dry-run"
  recommendedHandoff: "builder-broadcast-handoff" | "none"
  executionVariant?: "jit-v21" | "direct-router"
  signed: boolean
  submitted: boolean
  skippedReason?: string
  approval?: SwapExecutionPhaseSummary
  swap?: SwapExecutionPhaseSummary
  signing?: SwapExecutionSigningSummary
  submission?: SwapExecutionSubmissionSummary
  audit?: ExecutionAudit
  feedback?: SwapExecutionFeedback
  executedRouteId?: string
  jitSelectedCandidateIndex?: number
  armedCandidateRouteIds?: string[]
}

export interface IntentSubmissionRequest {
  mode: "intent-api"
  network: Network
  intent: StructuredIntent
  routeId: string
  payloadType: PayloadType
  providerName: string
  handoffReason: string
  safetyRequirements: string[]
  note: string
}

export interface ExecutionPackage {
  id: string
  routeId: string
  routeProvider: string
  routeFamily: RouteFamily
  payloadId: string
  payloadType: PayloadType
  submissionPath: SubmissionPath
  submissionChannel: SubmissionChannel
  submissionProvider: string
  executionMode: ExecutionMode
  approvalRequired: boolean
  approvalPolicy: string
  trustAssumptions: string[]
  plannerControlLevel: PlannerControlLevel
  quoteQuality: "high" | "medium" | "low"
  realizedExecutionConfidence: "high" | "medium" | "low"
  slippageStability: "high" | "medium" | "low"
  latencyExpectation: "fast" | "medium" | "slow"
  inclusionPathQuality: "high" | "medium" | "low"
  operationalSimplicity: "high" | "medium" | "low"
  approvalOverhead: "high" | "medium" | "low"
  trustAssumptionCost: "high" | "medium" | "low"
  publicExposure: "high" | "medium" | "low"
  delegationSuitability: "high" | "medium" | "low"
  score: number
  liveStatus: "live" | "advisory" | "info-only"
  rationale: string
}

export interface ExecutionBoundary {
  plannerControls: string[]
  userSigns: string[]
  externalExecutorControls: string[]
}

export interface PresentationTraceItem {
  title: "What I understood" | "What I compared" | "What I recommend"
  observed: string
  decided: string
  whyItMatters: string
}

export type PresentationTraceTitle = PresentationTraceItem["title"]
export type PresentationTraceStatus = "pending" | "running" | "completed" | "failed"

export interface PresentationTraceDetail {
  toolsUsed: string[]
  observations: DecisionTraceField[]
  decisions: string[]
  whyItMatters: string
}

export interface PartialPresentationTraceItem {
  title: PresentationTraceTitle
  status: PresentationTraceStatus
  currentSentence: string
  detailsCount: number
  details: PresentationTraceDetail
}

export interface PresentationActivityItem {
  id: string
  label: string
  status: "running" | "completed" | "failed"
}

export interface PresentationDetailPreviews {
  packagesPreview: string[]
  routesPreview: string[]
  submissionPreview: string[]
}

export interface PresentationBestExecutionPackage {
  id: string
  routeProvider: string
  submissionProvider: string
  executionMode: ExecutionMode
}

export interface RouteExecutionReadiness {
  routeId: string
  payloadReady: boolean
  simulationOk: boolean
  liveExecutable: boolean
}

export interface AllowanceCheckSummary {
  status: "ok" | "approve-required" | "not-applicable" | "unavailable"
  spender?: string
  token?: string
  currentAllowance?: string
  requiredAmount?: string
  note?: string
}

export interface PresentationRouteCard {
  routeId: string
  provider: string
  routeType: string
  expectedOut: string
  estimatedGas: string
  priceImpactPct: number
  coverageLabel: string
  submissionLabel: string
  readinessLabel: string
  payloadReady: boolean
  simulationOk: boolean
  liveExecutable: boolean
  providerNative: boolean
}

export interface PresentationResult {
  intentSummary: string
  comparisonSummary: string
  recommendationSummary: string
  bestExecutionPackage: PresentationBestExecutionPackage
  routeCards: PresentationRouteCard[]
  selectedRouteSummary: string
  submissionSummary: string
  executionCapabilitySummary: string
  executionCapabilityUsageSummary: string
  boundarySummary: string
  quoteConfidenceSummary: string
  detailPreviews: PresentationDetailPreviews
  presentationTrace: PresentationTraceItem[]
  debugAvailable: true
}

export function toUserFacingErrorMessage(error: string): string {
  const trimmed = error.trim()

  if (trimmed.includes("RESOURCE_EXHAUSTED") || trimmed.includes("Quota exceeded")) {
    const retryMatch =
      trimmed.match(/retry in ([0-9.]+)s/i) ??
      trimmed.match(/retryDelay":"([0-9]+)s/i) ??
      trimmed.match(/retry in ([0-9.]+) seconds/i)
    const retryWindow = retryMatch ? ` Retry in about ${Math.ceil(Number(retryMatch[1]))}s or use replay mode.` : " Try replay mode or wait for quota to reset."
    return `Gemini quota is currently exhausted for live planning.${retryWindow}`
  }

  if (trimmed.includes("Missing GEMINI_API_KEY")) {
    return "Live planning is unavailable because GEMINI_API_KEY is not configured."
  }

  if (trimmed.includes("Missing DEMO_WALLET_ADDRESS")) {
    return "Live planning is unavailable because the demo wallet address is not configured."
  }

  if (trimmed.includes("Missing BSC_RPC_URL")) {
    return "Live planning is unavailable because the BSC RPC URL is not configured."
  }

  if (trimmed.includes("Missing PRIVATE_KEY")) {
    return "Live execution is unavailable because PRIVATE_KEY is not configured."
  }

  if (trimmed.includes("does not match DEMO_WALLET_ADDRESS")) {
    return "PRIVATE_KEY does not match DEMO_WALLET_ADDRESS."
  }

  if (trimmed.includes("transfer amount exceeds balance")) {
    return "The selected wallet does not hold enough of the sell token for this swap simulation."
  }

  if (
    trimmed.includes("insufficient funds for gas * price + value") ||
    trimmed.includes("The total cost (gas * gas fee + value) of executing this transaction exceeds the balance")
  ) {
    return "The selected wallet does not have enough BNB to cover the swap value plus gas for simulation."
  }

  if (trimmed.includes("Streaming request failed")) {
    return "The planner request failed before live updates could start."
  }

  if (trimmed.includes("Intent parsing unavailable: Gemini quota exhausted")) {
    return "Intent parsing unavailable: Gemini quota exhausted"
  }

  if (trimmed.includes("Intent parsing failed: Gemini returned an invalid response")) {
    return "Intent parsing failed: Gemini returned an invalid response"
  }

  if (trimmed.includes("Intent parsing failed: could not extract swap intent")) {
    return "Intent parsing failed: could not extract swap intent"
  }

  const tokenSuggestionMatch = trimmed.match(/^Could not resolve token '(.+)' on ([a-z-]+)\.\s*suggest\s+(.+)$/i)
  if (tokenSuggestionMatch) {
    return `Could not resolve token '${tokenSuggestionMatch[1]}' on ${tokenSuggestionMatch[2]}. Did you mean ${tokenSuggestionMatch[3]}?`
  }

  return trimmed
}

const PRESENTATION_TRACE_TITLES: PresentationTraceTitle[] = [
  "What I understood",
  "What I compared",
  "What I recommend"
]

const STAGE_GROUP_TITLE: Record<DecisionTraceStage, PresentationTraceTitle> = {
  "intent-parsing": "What I understood",
  "missing-field-resolution": "What I understood",
  "execution-family-selection": "What I understood",
  "liquidity-discovery": "What I compared",
  "route-comparison": "What I compared",
  "price-impact-assessment": "What I compared",
  "mev-risk-assessment": "What I compared",
  "payload-construction": "What I compared",
  "execution-package-construction": "What I compared",
  "execution-package-comparison": "What I compared",
  "path-quality-assessment": "What I compared",
  "guardrail-application": "What I recommend",
  "submission-strategy": "What I recommend",
  "final-recommendation": "What I recommend"
}

const STAGE_ACTIVITY_LABEL: Partial<Record<DecisionTraceStage, string>> = {
  "liquidity-discovery": "Looking up routes",
  "payload-construction": "Simulating selected payload",
  "execution-package-construction": "Checking execution packages",
  "execution-package-comparison": "Checking execution packages",
  "submission-strategy": "Checking submission options",
  "final-recommendation": "Preparing recommendation"
}

export interface PlanningResult {
  intent: StructuredIntent
  missingFieldsResolved: MissingFieldResolution[]
  decisionTrace: DecisionTraceStep[]
  liquiditySnapshot: LiquiditySnapshot
  venueCoverageSnapshot: VenueCoverageSnapshot
  providerUniverseSnapshot: ProviderUniverseSnapshot
  routeCandidates: RouteCandidate[]
  quoteProviderAudit: QuoteProviderAuditEntry[]
  quoteObservedAt: string
  quoteFreshness: "fresh" | "stale"
  executionPackages: ExecutionPackage[]
  priceImpactAssessment: PriceImpactAssessment
  bestObservedQuoteConfidence: CoverageConfidence
  mevRiskAssessment: MevRiskAssessment
  payloadCandidates: PayloadCandidate[]
  submissionCandidates: SubmissionCandidate[]
  privatePathRegistrySummary?: PrivatePathRegistrySummary
  executionCapabilitySummary?: ExecutionCapabilitySummary
  executionCapabilityUsage: ExecutionCapabilityUsage
  guardrails: Guardrail[]
  executionBoundary: ExecutionBoundary
  recommendedPlan: RecommendedPlan
  observedRouteIds: string[]
  defaultSelectedRouteId: string
  effectiveSlippageBps: number
  executionReadyNow: boolean
  recommendedHandoff: "public-wallet" | "private-rpc-handoff" | "builder-broadcast-handoff" | "none"
  executionRecommendationMode: ExecutionRecommendationMode
  bestQuoteRouteId: string | null
  bestExecutableRouteId?: string | null
  finalistsRouteIds?: string[]
  excludedRouteIds?: string[]
  finalistSelectionSummary?: string
  jitCandidateRouteIds?: string[]
  bestReadyRouteId: string | null
  selectionReasonCode?: SelectionReasonCode
  selectionReasonDetail?: string
  routeExecutionReadiness: RouteExecutionReadiness[]
  allowanceCheck?: AllowanceCheckSummary
  alternativesRejected: AlternativeRejected[]
  publicSubmitRequest?: PublicTransactionRequest
  privateSubmitRequest?: PrivateSubmissionRequest
  intentSubmitRequest?: IntentSubmissionRequest
  jitRouterRequest?: JitRouterRequest
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

export function createPresentationResult(result: PlanningResult): PresentationResult {
  const bestExecutionPackage =
    result.executionPackages.find((pkg) => pkg.id === result.recommendedPlan.bestExecutionPackageId) ??
    result.executionPackages[0]
  const bestPricePackage =
    result.executionPackages.find((pkg) => pkg.id === result.recommendedPlan.bestPricePackageId) ??
    bestExecutionPackage
  const recommendedRoute =
    result.routeCandidates.find((candidate) => candidate.id === result.recommendedPlan.routeId) ??
    result.routeCandidates[0]
  const selectedRoute =
    result.routeCandidates.find((candidate) => candidate.id === result.defaultSelectedRouteId) ??
    recommendedRoute
  const orderedObservedRoutes = orderObservedRoutes(result)
  const routeCards = orderedObservedRoutes.slice(0, 3).map((route) => buildPresentationRouteCard(result, route))

  const intentSummary = [
    `I parsed your execution intent as swapping ${result.intent.sellToken ?? "an input token"} to ${result.intent.buyToken ?? "an output token"}.`,
    result.intent.preferences.preferPrivate
      ? "You prefer a builder-friendly or private delivery path when available."
      : "You did not ask for a special submission path.",
    result.intent.slippageBps ? `I will keep the ${result.intent.slippageBps} bps slippage bound.` : null
  ]
    .filter(Boolean)
    .join(" ")

  const priceVsExecutionAligned = bestPricePackage?.id === bestExecutionPackage?.id
  const comparisonSummary = priceVsExecutionAligned
    ? "I built a payload and checked which live route options can be built and simulated safely."
    : "I built a payload and checked both route quality and execution constraints before surfacing the live options."

  const recommendationSummary = selectedRoute
    ? `For this request, the preferred handoff is ${describeRecommendedHandoff(result.recommendedHandoff)}, and the default evidence route is ${selectedRoute.platform}.`
    : `For this request, the preferred handoff is ${describeRecommendedHandoff(result.recommendedHandoff)}.`

  const submissionSummary = buildSubmissionSummary(result)
  const executionCapabilitySummary = buildExecutionCapabilitySummary(result)
  const executionCapabilityUsageSummary = buildExecutionCapabilityUsageSummary(result)
  const quoteConfidenceSummary = buildQuoteConfidenceSummary(result, selectedRoute)
  const selectedRouteSummary = selectedRoute
    ? `${selectedRoute.platform} is the selected evidence route because it belongs to the observed set and matches the current execution constraints.`
    : "Pick one observed route to prepare execution."

  const boundarySummary = [
    "I control the planning, ranking, simulation, and guardrail side.",
    result.executionBoundary.userSigns.length
      ? `You still sign or approve ${compactList(result.executionBoundary.userSigns, 2)}.`
      : null,
    result.executionBoundary.externalExecutorControls.length
      ? `Final delivery or settlement can remain outside my direct control through ${compactList(result.executionBoundary.externalExecutorControls, 2)}.`
      : null
  ]
    .filter(Boolean)
    .join(" ")

  return {
    intentSummary,
    comparisonSummary,
    recommendationSummary,
    bestExecutionPackage: {
      id: bestExecutionPackage?.id ?? result.recommendedPlan.bestExecutionPackageId,
      routeProvider: bestExecutionPackage?.routeProvider ?? result.recommendedPlan.routeId,
      submissionProvider: bestExecutionPackage?.submissionProvider ?? result.recommendedPlan.submissionProvider,
      executionMode: bestExecutionPackage?.executionMode ?? result.recommendedPlan.executionMode
    },
    routeCards,
    selectedRouteSummary,
    submissionSummary,
    executionCapabilitySummary,
    executionCapabilityUsageSummary,
    boundarySummary,
    quoteConfidenceSummary,
    detailPreviews: {
      packagesPreview: result.executionPackages.slice(0, 3).map((pkg) => {
        return `${pkg.id}: ${pkg.routeProvider}, ${pkg.submissionProvider}, ${pkg.executionMode}`
      }),
      routesPreview: result.routeCandidates.slice(0, 3).map((route) => {
        return `${route.platform}: ${route.quotedOutFormatted}, impact ${route.priceImpactPct.toFixed(3)}%, ${route.coverageConfidence} coverage`
      }),
      submissionPreview: result.submissionCandidates.slice(0, 3).map((candidate) => {
        return `${candidate.providerName}: ${candidate.rationale}`
      })
    },
    presentationTrace: [
      {
        title: "What I understood",
        observed: intentSummary,
        decided: "I will convert the request into execution constraints before comparing routes and submission paths.",
        whyItMatters: "The planner needs the request and execution preferences before it can compare packages safely."
      },
      {
        title: "What I compared",
        observed: comparisonSummary,
        decided: "I checked observed routes, payload readiness, simulation status, and submission realism.",
        whyItMatters:
          "Route quality, submission quality, and delegation shape can change realized execution quality even when quotes are close."
      },
      {
        title: "What I recommend",
        observed: recommendationSummary,
        decided: selectedRoute
          ? `I would prepare the recommended handoff next and keep JIT as an experimental fallback payload only.`
          : "I would prepare the recommended handoff next and keep JIT experimental only.",
        whyItMatters: boundarySummary
      }
    ],
    debugAvailable: true
  }
}

export function createPartialPresentationTrace(input: {
  events: PlanningEvent[]
  result?: PlanningResult | null
}): PartialPresentationTraceItem[] {
  const finalPresentation = input.result ? createPresentationResult(input.result) : null

  return PRESENTATION_TRACE_TITLES.map((title, index) => {
    const titleEvents = input.events.filter((event) => STAGE_GROUP_TITLE[event.stage] === title)
    const latestEvent = titleEvents.at(-1)
    const status: PresentationTraceStatus = latestEvent
      ? latestEvent.status === "running"
        ? "running"
        : latestEvent.status === "failed"
          ? "failed"
          : "completed"
      : "pending"
    const details = buildPresentationTraceDetail(title, titleEvents, finalPresentation?.presentationTrace[index])
    const currentSentence =
      finalPresentation && status === "completed"
        ? finalPresentation.presentationTrace[index]?.observed ?? defaultStreamingSentence(title, status)
        : deriveStreamingSentence(title, status, latestEvent)

    return {
      title,
      status,
      currentSentence,
      detailsCount: details.toolsUsed.length + details.observations.length + details.decisions.length,
      details
    }
  })
}

export function createPresentationActivityFeed(events: PlanningEvent[]): PresentationActivityItem[] {
  const items = new Map<string, PresentationActivityItem>()

  for (const event of events) {
    if (event.kind === "follow-up-required" || event.kind === "plan-completed") {
      continue
    }
    const label = STAGE_ACTIVITY_LABEL[event.stage]
    if (!label) {
      continue
    }

    const current = items.get(label)
    const status: PresentationActivityItem["status"] =
      event.status === "failed" ? "failed" : event.status === "running" ? "running" : "completed"

    if (!current || current.status === "running" || status !== "running") {
      items.set(label, { id: `${event.stage}-${label}`, label, status })
    }
  }

  return [...items.values()].slice(-5)
}

export function formatStreamingUpdate(item: PartialPresentationTraceItem): string {
  if (item.status === "running") {
    return `Thinking: ${item.currentSentence}`
  }
  if (item.status === "failed") {
    return `${item.title}: ${item.currentSentence}`
  }
  if (item.status === "completed") {
    return `${item.title}: ${item.currentSentence}`
  }
  return "Thinking..."
}

function compactList(values: string[], limit: number): string {
  if (values.length <= limit) {
    return values.join(", ")
  }
  return `${values.slice(0, limit).join(", ")}, +${values.length - limit} more`
}

function buildQuoteConfidenceSummary(
  result: PlanningResult,
  recommendedRoute?: RouteCandidate
): string {
  const confidenceLine =
    result.venueCoverageSnapshot.topDexesObservedByDefiLlama.length === 0
      ? "Coverage audit unavailable because market-intelligence lookup did not return a usable BSC venue snapshot."
      : result.bestObservedQuoteConfidence === "high"
      ? "Current quote coverage looks broad enough to treat this as a strong observed market read."
      : result.bestObservedQuoteConfidence === "medium"
        ? "Current quote coverage is partial, so treat this as a strong observed quote set rather than a full market sweep."
        : "Current quote coverage is narrow, so treat this as a limited observed quote set."

  const provenanceLine = recommendedRoute
    ? recommendedRoute.providerNative
      ? `The recommended route comes from a native ${recommendedRoute.quoteSource} quote path.`
      : `The recommended route is observed through ${recommendedRoute.quoteSource}, so it is not an independent native quote for ${recommendedRoute.platform}.`
    : null

  const observedCount = result.observedRouteIds.length || result.routeCandidates.length
  const observedLine =
    observedCount <= 2
      ? `Observed route set is narrow for this request (${observedCount} route${observedCount === 1 ? "" : "s"} returned).`
      : `Observed route set is partial for this request (${observedCount} routes returned).`

  const coverageLine =
    result.venueCoverageSnapshot.topDexesObservedByDefiLlama.length === 0
      ? null
      : result.venueCoverageSnapshot.missingHighShareVenues.length
        ? `High-share BSC venues not clearly covered right now: ${compactList(result.venueCoverageSnapshot.missingHighShareVenues, 3)}.`
        : "No obvious high-share venue gaps were detected in the available coverage audit."

  return [confidenceLine, provenanceLine, observedLine, coverageLine].filter(Boolean).join(" ")
}

function buildSubmissionSummary(result: PlanningResult): string {
  const publicCandidate = result.submissionCandidates.find((candidate) => candidate.submissionChannel === "public-mempool")
  const privateCandidate = result.submissionCandidates.find((candidate) => candidate.submissionChannel === "private-rpc")
  const builderCandidate = result.submissionCandidates.find((candidate) => candidate.submissionChannel === "builder-aware-broadcast")
  const lines = [
    result.recommendedHandoff === "public-wallet"
      ? "Public wallet execution is the recommended handoff path for this demo."
      : result.recommendedHandoff === "private-rpc-handoff"
        ? "Private validator RPC handoff is the recommended next step after local signing."
        : result.recommendedHandoff === "builder-broadcast-handoff"
          ? "Builder relay handoff is the recommended next step after local signing."
          : null,
    publicCandidate ? "Public wallet handoff remains available." : null,
    privateCandidate ? `${privateCandidate.providerName} can accept a signed raw transaction.` : null,
    builderCandidate ? `${builderCandidate.providerName} can broadcast a signed raw transaction across relays.` : null
  ]
  return lines.filter(Boolean).join(" ")
}

function buildExecutionCapabilitySummary(result: PlanningResult): string {
  const summary = result.executionCapabilitySummary
  if (!summary?.available) {
    return "Execution MCP capability summary is unavailable, so planner capability reporting falls back to local surfaces only."
  }

  const enabled = [
    summary.privateSubmitAvailable ? "private raw submit" : null,
    summary.builderBroadcastAvailable ? "multi-builder broadcast" : null,
    summary.auditAvailable ? "execution audit" : null,
    summary.routeSimulationAvailable ? "candidate simulation" : null
  ].filter(Boolean)

  const registryLine = summary.privateRegistryAvailable && summary.registrySummary
    ? `Registry-backed private discovery is available for ${summary.registrySummary.validatorEndpointCount} validator and ${summary.registrySummary.builderEndpointCount} builder endpoints.`
    : "Registry-backed private discovery is not currently available."

  const enabledLine = enabled.length
    ? `Connected execution MCP tools: ${compactList(enabled as string[], 4)}.`
    : "Execution MCP connected, but no execution-facing tools were detected."

  return [enabledLine, registryLine].join(" ")
}

function buildExecutionCapabilityUsageSummary(result: PlanningResult): string {
  if (!result.executionCapabilitySummary?.available) {
    return "Used in this run: none."
  }

  if (!result.executionCapabilityUsage.used.length) {
    return "Used in this run: none. Planner stayed on local simulation only."
  }

  return `Used in this run: ${result.executionCapabilityUsage.used.join(", ")}.`
}

function buildPresentationRouteCard(
  result: PlanningResult,
  route: RouteCandidate
): PresentationRouteCard {
  const readiness = result.routeExecutionReadiness.find((item) => item.routeId === route.id)
  const submissionCompatibility = deriveSubmissionCompatibility(result, route)

  return {
    routeId: route.id,
    provider: route.platform,
    routeType: route.routeFamily === "aggregator" ? "Aggregator" : route.routeFamily === "direct-dex" ? "Direct DEX" : route.routeFamily,
    expectedOut: route.quotedOutFormatted,
    estimatedGas: route.estimatedGas,
    priceImpactPct: route.priceImpactPct,
    coverageLabel: `${route.providerNative ? "provider-backed" : "modeled"} · ${route.coverageConfidence} coverage`,
    submissionLabel: submissionCompatibility,
    readinessLabel: !readiness?.payloadReady
      ? "quote only"
      : readiness.liveExecutable
        ? "simulation ready"
        : readiness.simulationOk
          ? "advisory only"
          : "payload unavailable",
    payloadReady: readiness?.payloadReady ?? false,
    simulationOk: readiness?.simulationOk ?? false,
    liveExecutable: readiness?.liveExecutable ?? false,
    providerNative: route.providerNative
  }
}

function deriveSubmissionCompatibility(result: PlanningResult, route: RouteCandidate): string {
  const hasLivePublic = result.routeExecutionReadiness.some(
    (item) => item.routeId === route.id && item.liveExecutable
  )
  if (result.recommendedHandoff === "private-rpc-handoff") {
    return "private handoff preferred + public fallback"
  }
  if (result.recommendedHandoff === "builder-broadcast-handoff") {
    return "builder handoff preferred + public fallback"
  }
  if (hasLivePublic) {
    return "public handoff preferred + private available"
  }
  return "advisory only"
}

function describeRecommendedHandoff(
  handoff: PlanningResult["recommendedHandoff"]
): string {
  if (handoff === "private-rpc-handoff") return "private validator RPC handoff"
  if (handoff === "builder-broadcast-handoff") return "builder relay handoff"
  if (handoff === "public-wallet") return "public wallet handoff"
  return "no live handoff"
}

function orderObservedRoutes(result: PlanningResult): RouteCandidate[] {
  const readinessByRoute = new Map(result.routeExecutionReadiness.map((item) => [item.routeId, item]))
  const observedIds = new Set(result.observedRouteIds)
  return [...result.routeCandidates]
    .filter((route) => observedIds.size === 0 || observedIds.has(route.id))
    .sort((left, right) => {
      const leftReadiness = readinessByRoute.get(left.id)
      const rightReadiness = readinessByRoute.get(right.id)
      const leftExecutable = leftReadiness?.liveExecutable ? 1 : 0
      const rightExecutable = rightReadiness?.liveExecutable ? 1 : 0
      if (rightExecutable !== leftExecutable) {
        return rightExecutable - leftExecutable
      }
      const leftProviderBacked = left.providerNative ? 1 : 0
      const rightProviderBacked = right.providerNative ? 1 : 0
      if (rightProviderBacked !== leftProviderBacked) {
        return rightProviderBacked - leftProviderBacked
      }
      const leftOut = Number.parseFloat(left.quotedOutFormatted.split(" ")[0] ?? "0")
      const rightOut = Number.parseFloat(right.quotedOutFormatted.split(" ")[0] ?? "0")
      if (rightOut !== leftOut) {
        return rightOut - leftOut
      }
      const leftGas = Number(left.estimatedGas)
      const rightGas = Number(right.estimatedGas)
      if (leftGas !== rightGas) {
        return leftGas - rightGas
      }
      return left.priceImpactPct - right.priceImpactPct
    })
}

function buildPresentationTraceDetail(
  title: PresentationTraceTitle,
  events: PlanningEvent[],
  finalTrace?: PresentationTraceItem
): PresentationTraceDetail {
  const toolsUsed = unique(
    events
      .flatMap((event) => {
        const toolName = event.data?.toolName
        return toolName ? [normalizeToolName(toolName)] : []
      })
      .filter(Boolean)
  )

  const observations = uniqueFields(
    events.flatMap((event) => {
      const fields = [
        ...(event.data?.observations ?? []),
        ...(event.data?.outputPreview ?? []),
        ...(event.data?.inputPreview ?? [])
      ]
      return fields.filter(isSafeField).map((field) => ({
        label: normalizeFieldLabel(field.label),
        value: shortenValue(field.value)
      }))
    })
  ).slice(0, 5)

  const decisions = unique(
    events
      .flatMap((event) => (event.data?.decision ? [event.data.decision] : []))
      .filter((decision) => !decision.includes("summarizeStageWithLLM"))
      .map(shortenValue)
  ).slice(0, 3)

  return {
    toolsUsed,
    observations,
    decisions,
    whyItMatters: finalTrace?.whyItMatters ?? defaultWhyItMatters(title)
  }
}

function deriveStreamingSentence(
  title: PresentationTraceTitle,
  status: PresentationTraceStatus,
  latestEvent?: PlanningEvent
): string {
  if (!latestEvent) {
    return defaultStreamingSentence(title, status)
  }

  if (status === "running") {
    if (latestEvent.kind === "follow-up-required") {
      return "I need one more input before I can compare packages."
    }
    if (title === "What I understood") {
      return "I’m reading your request and extracting the swap intent."
    }
    if (title === "What I compared") {
      if (latestEvent.stage === "payload-construction") {
        return "I’m checking routes, packages, and selected payload safety now."
      }
      return "I’m checking routes and package options now."
    }
    return "I’m finalizing the recommendation and boundary."
  }

  if (status === "failed") {
    if (title === "What I understood") {
      return "I could not finish understanding the request."
    }
    if (title === "What I compared") {
      return "I stopped while checking routes, packages, and payload safety."
    }
    return "I could not finalize the recommendation."
  }

  if (status === "completed") {
    if (title === "What I understood") {
      return "I now understand the token pair and execution preferences."
    }
    if (title === "What I compared") {
      return "I compared best price against overall execution quality."
    }
    return "I finalized the recommendation and execution boundary."
  }

  return defaultStreamingSentence(title, status)
}

function defaultStreamingSentence(title: PresentationTraceTitle, status: PresentationTraceStatus): string {
  if (status === "pending") {
    if (title === "What I understood") {
      return "Thinking..."
    }
    if (title === "What I compared") {
      return "Waiting to compare routes and packages."
    }
    return "Waiting to prepare the recommendation."
  }
  if (status === "failed") {
    if (title === "What I understood") {
      return "I could not finish understanding the request."
    }
    if (title === "What I compared") {
      return "I stopped while checking routes, packages, and payload safety."
    }
    return "I could not finalize the recommendation."
  }
  if (title === "What I understood") {
    return "I’m reading your request and extracting the swap intent."
  }
  if (title === "What I compared") {
    return "I’m checking routes and package options now."
  }
  return "I’m finalizing the recommendation and boundary."
}

function defaultWhyItMatters(title: PresentationTraceTitle): string {
  if (title === "What I understood") {
    return "The planner needs the request and execution preferences before it can compare packages safely."
  }
  if (title === "What I compared") {
    return "Route quality, submission quality, and delegation shape can change realized execution quality."
  }
  return "The final recommendation should stay concise while making the execution boundary explicit."
}

function normalizeToolName(toolName: string): string {
  const normalized: Record<string, string> = {
    resolveToken: "Resolve token metadata",
    getQuoteCandidates: "Look up routes",
    encodeRouterCalldata: "Build swap payload",
    simulateTransaction: "Simulate selected payload",
    getSubmissionPaths: "Check submission options"
  }
  return normalized[toolName] ?? toolName.replace(/([a-z])([A-Z])/g, "$1 $2")
}

function normalizeFieldLabel(label: string): string {
  return label
    .replace(/^getSubmissionPaths\./, "")
    .replace(/^summarizeStageWithLLM\./, "")
    .replace(/_/g, " ")
    .replace(/\./g, " ")
    .trim()
}

function isSafeField(field: DecisionTraceField): boolean {
  const lowerLabel = String(field.label).toLowerCase()
  const lowerValue = String(field.value).toLowerCase()
  if (
    lowerLabel.includes("summarizestagewithllm") ||
    lowerLabel.includes("summary_error") ||
    lowerLabel.includes("promptversion") ||
    lowerLabel.includes("model") ||
    lowerLabel.includes("parser_model") ||
    lowerValue.includes("quota") ||
    lowerValue.includes("resource_exhausted")
  ) {
    return false
  }
  return true
}

function shortenValue(value: unknown, limit = 140): string {
  const normalized = String(value)
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function uniqueFields(values: DecisionTraceField[]): DecisionTraceField[] {
  const seen = new Set<string>()
  const output: DecisionTraceField[] = []
  for (const value of values) {
    const key = `${value.label}:${value.value}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}
