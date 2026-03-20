# SPEC

## Goal

Implement a minimal `swap-execution-planning skill` demo that takes one natural-language swap request and shows the internal execution-planning decisions.

Core question:

`A token 하나 B로 스왑해줘`

Canonical demo prompt:

`Swap 100 USDT to BNB with low MEV risk`

The demo must show how the skill reasons about:

- intent
- liquidity sources
- route candidates
- price impact
- MEV exposure
- best price vs best execution
- payload shape
- guardrails
- submission strategy

## Non-Goals

- generic agent framework
- production wallet UX
- real private builder integration
- bundle submission
- full swap execution in the first demo path
- transfer-first demo narratives

## Single Demo Flow

1. User asks for a swap in natural language.
2. Skill extracts structured intent.
3. If required fields are missing, skill uses a follow-up loop.
4. Skill queries MCP tools for balances, token metadata, liquidity, and route context.
5. Skill compares route candidates by price impact and expected execution quality.
6. Skill evaluates MEV exposure and possible submission paths.
7. Skill constructs payload candidates.
8. Skill applies deterministic guardrails.
9. Skill emits a final recommendation.
10. Optional submit is secondary and must stay off by default.

## Follow-Up Loop

Follow-up is required behavior, not an exception path.

Examples:

- If amount is missing, the skill may first read wallet balance.
- Then it may ask:
  - `You currently hold X token. How much would you like to swap?`

Rules:

- ask as few questions as possible
- only ask when the missing field materially blocks planning
- use current observations when asking
- unresolved required fields must remain explicit

## Required MCP Tools

### Core read/planning tools

- `get_chain_info`
- `get_native_balance`
- `get_erc20_balance`
- `get_erc20_token_info`
- `get_quote_candidates`
- `simulate_transaction`
- `encode_router_calldata`
- `get_submission_paths`

### Optional context tools

- `read_contract`
- `is_contract`
- `estimate_gas`

### Advisory or stub tools in V1

- `private_rpc_submit`
- `multi_builder_broadcast`
- `builder_path_score`

### De-emphasized tools

- `transfer_native_token`
- `transfer_erc20`

These may exist in the wider stack but are not part of the main demo path.

## Required Decision Stack

The skill must explicitly produce or make visible the following chain:

1. Intent parsing
2. Missing field resolution
3. Liquidity discovery
4. Price impact comparison
5. MEV risk assessment
6. Best execution reasoning
7. Payload construction
8. Guardrail application
9. Submission strategy selection
10. Final recommendation

## Guardrails

Deterministic rules must enforce:

- write tools disabled in dry-run
- follow-up before failure when a missing field is resolvable
- stop when required fields remain unresolved
- simulation required for swap payload candidates
- slippage bound required for swap recommendation
- deadline required for swap recommendation
- public path risk must be surfaced when private path is unavailable

## Required Output

The final result must include:

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

The output must explain why the chosen plan is better than plausible alternatives.

## Submit Rules

- default mode is `dry-run`
- optional submit exists only as a secondary capability
- swap submit is not required in the first demo path
- if submit is later enabled, it must be explicitly visible in the output

## One-Line Success Criterion

A viewer should be able to see one swap request and understand why the agent chose a specific route, payload, submission path, and set of guardrails.
