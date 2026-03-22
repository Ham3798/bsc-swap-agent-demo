# jit-routing

Use this skill for contract-backed fallback execution ordering.

## What it does

- order candidate route calls
- prepare JIT router calldata
- simulate candidate fallback behavior
- reason about best quote vs best execution-ready route at the contract layer

## Current state

- contract primitive exists in `contracts/src/JitSwapRouter.sol`
- forge tests exist
- planner integration is pending

## Planned MCP dependencies

- `bsc-execution-mcp`
  - `encode_jit_router_call`
  - `simulate_candidate_routes`

## Output contract

Must eventually surface:

- ordered candidate list
- minOut
- deadline
- recipient
- encoded JIT payload
- fallback count
