# swap-execution-planning

Use this skill to plan one BSC swap from natural language.

## What it does

- parse swap intent
- resolve token metadata
- observe live quotes
- compare route and submission candidates
- build payload candidates
- simulate selected candidates
- apply slippage, deadline, and stale-quote guardrails
- emit execution readiness and handoff contracts

## What it does not do

- sign transactions
- submit private raw transactions
- submit bundles
- audit completed executions

## MCP dependencies

- `bnbchain-mcp`
  - `get_chain_info`
  - `get_native_balance`
  - `get_erc20_balance`
  - `get_erc20_token_info`
  - `estimate_gas`
- `bsc-execution-mcp` read-side tools when available
  - `get_private_endpoint_registry`
  - `probe_private_endpoint`
  - `simulate_candidate_routes`

## Output contract

Must surface:

- intent
- route candidates
- payload candidates
- submission candidates
- guardrails
- tx handoff contract
- readiness state
- planner boundary

## Current implementation reality

- public wallet handoff is the main live path
- execution capability discovery is visible in planner output
- only `simulate_candidate_routes` can be used inside the planner path today
- private submission is surfaced as a handoff contract, not as planner-owned signing
- private execution ops remain outside the planner signing path
- gasless and JIT payload families are not the default planner path yet
