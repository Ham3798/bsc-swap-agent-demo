import type {
  Guardrail,
  MevRiskAssessment,
  PayloadCandidate,
  RouteCandidate,
  StructuredIntent
} from "@bsc-swap-agent-demo/shared"

export function buildGuardrails(input: {
  intent: StructuredIntent
  route: RouteCandidate
  payload: PayloadCandidate
  mevRisk: MevRiskAssessment
}): Guardrail[] {
  const slippageBps = input.intent.slippageBps ?? defaultSlippageForImpact(input.route.priceImpactPct)
  const guardrails: Guardrail[] = [
    {
      name: "simulation-required",
      status: "required",
      value: input.payload.simulation.ok ? "passed" : "must-pass-before-submit",
      rationale: "Swap payloads must be simulated before any execution path is considered safe."
    },
    {
      name: "slippage-bound",
      status: "required",
      value: `${slippageBps} bps`,
      rationale: "A bounded slippage limit protects against stale execution and price movement during inclusion."
    },
    {
      name: "deadline",
      status: "required",
      value: "120 seconds",
      rationale: "A short deadline limits stale execution risk in fast-changing BSC liquidity conditions."
    },
    {
      name: "stale-quote-stop",
      status: "required",
      value: "re-quote if quote age exceeds 20 seconds",
      rationale: "Best price is not best execution if the quote is stale by the time it reaches the chain."
    }
  ]

  if (input.mevRisk.level !== "low") {
    guardrails.push({
      name: "public-path-warning",
      status: "recommended",
      value: "avoid public mempool if private path metadata is available",
      rationale:
        "Public submission can expose the swap to extraction risk even when the route looks optimal on quote."
    })
  }

  return guardrails
}

function defaultSlippageForImpact(priceImpactPct: number): number {
  if (priceImpactPct <= 0.3) {
    return 50
  }
  if (priceImpactPct <= 1) {
    return 75
  }
  return 100
}
