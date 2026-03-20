# PROMPT_CONTRACT

## 1. Intent Extraction

Purpose:

- convert one natural-language swap request into structured intent

Return JSON only.

```json
{
  "action": "swap | unknown",
  "sell_token": "string | null",
  "buy_token": "string | null",
  "amount": "string | null",
  "slippage_bps": "number | null",
  "preferences": {
    "prefer_private": "boolean | null",
    "prefer_fast": "boolean | null",
    "avoid_stale": "boolean | null"
  },
  "unknowns": ["string"]
}
```

Rules:

- do not invent missing values
- treat missing amount as a normal follow-up case
- extract MEV/privacy preference when clearly implied
- keep unresolved fields explicit in `unknowns`

## 2. Planning

Purpose:

- given structured intent and MCP observations, choose the best execution plan

Inputs:

- structured intent
- missing field resolution state
- available tool observations
- available tool list
- network
- submit enabled flag

The model must reason across:

- liquidity discovery
- route quality
- price impact
- expected realized execution quality
- MEV extraction risk
- submission path tradeoffs
- payload shape
- guardrails

The planning logic must explicitly reflect:

- best price is not the same as best execution
- public submission can expose a swap to MEV extraction
- private or builder-aware submission may be preferable when MEV sensitivity is high

Return:

- one recommended plan
- alternatives
- explicit rejection reasons for alternatives

## 3. Final Answer Format

The final answer must contain:

1. a markdown summary
2. a JSON block

The JSON block must contain:

- `intent`
- `missing_fields_resolved`
- `liquidity_snapshot`
- `route_candidates`
- `price_impact_assessment`
- `mev_risk_assessment`
- `payload_candidates`
- `submission_candidates`
- `guardrails`
- `recommended_plan`
- `alternatives_rejected`
- `submit_result?`

The markdown summary must:

- clearly state the recommended plan
- explain why other plausible paths were rejected
- separate risk notes from policy notes
- state whether submit is disabled, optional, or executed

## 4. Follow-Up Rule

If the plan cannot proceed due to a missing field:

- prefer one grounded follow-up question
- use observed context when possible
- example:
  - `You currently hold X token. How much would you like to swap?`

The skill should not ask unnecessary questions and should not silently fill in unknown critical values.

## 5. Stage Reasoning Summarizer

Purpose:

- turn compact tool observations into short intermediate reasoning summaries

Allowed inputs:

- `stage`
- `intent`
- `toolObservations`
- `currentCandidates`
- `recommendedCandidate`
- `rejectedCandidates`
- `mevAssessment`
- `priceImpactAssessment`
- `submissionCandidates`

Return JSON only.

```json
{
  "summary": "string",
  "decision": "string",
  "observations": [
    {
      "label": "string",
      "value": "string"
    }
  ]
}
```

Rules:

- `summary` must be 1-2 sentences
- `decision` must be 1 sentence
- `observations` must contain at most 3 items
- do not reveal chain-of-thought
- do not dump full prompts, calldata, RPC payloads, or quote blobs
- use only the provided structured inputs

Prompt version:

- `stage-summary-v1`
