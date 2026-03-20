# Swap Execution Planning for BSC

Use this skill for one task: planning a BSC token swap from a natural-language request.

The goal is not to send a transaction first. The goal is to explain the execution plan.

Best price is not the same as best execution. Submission path quality is part of execution quality.

## When to use this skill

Use this skill when:

- a user asks to swap token A to token B on BSC
- a user wants route comparison, price impact reasoning, MEV-aware planning, payload construction, or submission guidance
- a user does not just want a raw quote and instead wants execution planning

Do not use this skill as a general-purpose BSC assistant. It is narrowly scoped to one swap-planning workflow.

## What this skill does

This skill:

- parses swap intent from natural language
- resolves missing fields through follow-up
- inspects balances when wallet context exists
- queries BNB MCP and live quote sources
- compares route candidates
- evaluates MEV and public-vs-private submission exposure
- builds payload candidates
- applies deterministic guardrails
- returns a dry-run recommendation

## Required capabilities

This skill uses:

- `bnbchain-mcp` as the capability layer for chain, balance, token, and gas operations
- live quote data as a planning extension layer for route candidates
- Gemini API for intent extraction
- direct RPC simulation with wallet account context
- dry-run only execution by default

Current implementation reality:

- `bnbchain-mcp` provides core chain capabilities
- quote, payload, direct RPC simulation, and submission-path reasoning are implemented as demo-local planning extensions
- private RPC and multi-builder paths are advisory in this MVP

## Required MCP tools

This skill expects these MCP tools to be available:

- `get_chain_info`
- `get_native_balance`
- `get_erc20_balance`
- `get_erc20_token_info`
- `estimate_gas`

## Required non-MCP planning capabilities

This skill also uses demo-local planning extensions for:

- `get_quote_candidates`
- `encode_router_calldata`
- `simulate_transaction`
- `get_submission_paths`

This is intentional. The current MVP uses BNB MCP plus local planning extensions.

## Decision flow

The skill must make the following chain visible:

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

## Follow-up loop rules

- never invent critical missing values
- if amount is missing and wallet balance is available, use a balance-aware follow-up
- ask the fewest questions possible
- unresolved required fields must remain explicit

Example:

- `You currently hold X token. How much would you like to swap?`

## Best execution rules

- best price is not best execution
- compare quoted output, impact, execution stability, MEV exposure, and submission quality
- a public path may make a route look better than it will realize
- if MEV sensitivity is high, prefer private or builder-aware recommendations when available

## Output contract

The final answer must contain:

1. a markdown summary
2. a JSON block

The result must include:

- `intent`
- `route_candidates`
- `price_impact_assessment`
- `mev_risk_assessment`
- `payload_candidates`
- `submission_candidates`
- `guardrails`
- `recommended_plan`
- `alternatives_rejected`

The output should explain why the chosen plan is better than plausible alternatives.

## Run instructions

Install dependencies:

```bash
bun install
```

Run the canonical demo:

```bash
bun run start -- "Swap 100 USDT to BNB with low MEV risk"
```

Optional environment variables:

- `DEMO_WALLET_ADDRESS`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `BSC_RPC_URL`
- `BSC_TESTNET_RPC_URL`
- `BNB_MCP_DIR`
- `BNB_MCP_COMMAND`
- `BNB_MCP_ARGS`

This stage does not allow fallback parsing or fallback simulation.

## Limits of the MVP

- dry-run only
- private RPC and multi-builder paths are advisory
- no live swap submission in the main path
- not a general-purpose BSC assistant
- not a full routing engine or production execution system
