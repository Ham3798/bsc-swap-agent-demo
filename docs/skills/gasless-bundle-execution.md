# gasless-bundle-execution

Use this skill for BSC zero-gas and sponsor-aware execution paths.

## Intended role

- sponsor policy check
- bundle composition
- user tx plus sponsor tx flow
- bundle pricing and submission routing

## Current state

- interface-first
- not fully implemented in the planner path
- no live sponsor policy engine yet

## Planned MCP dependencies

- `bsc-execution-mcp`
  - `sponsor_policy_check`
  - `build_bundle`
  - `quote_bundle_price`
  - `submit_bundle`

## Output contract

Must eventually surface:

- sponsor approval or rejection
- policy reason
- bundle composition summary
- bundle pricing summary
- target endpoints
- execution readiness
