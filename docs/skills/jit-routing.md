# jit-routing

Use this skill for contract-backed best-of-3 execution ordering.

## What it does

- order adapter-constrained route calls
- prepare JIT router calldata
- reason about best quote vs best execution-ready route at the contract layer
- support exact approve plus private builder submission

## Current state

- `contracts/src/JitSwapRouterV21.sol` is the single live router contract kept in the repo
- it uses EIP-712 signed orders before any `transferFrom(user, ...)`
- `bsc-execution-mcp` encodes v2.1 calldata through `encode_jit_router_call`
- one-command CLI uses the secure router for live private swaps when exactly 3 native candidates are available

## Security model

- signed order binds `user`, `recipient`, `tokenIn`, `tokenOut`, `amountIn`, `minOut`, `maxBlockNumber`, `nonce`, and `candidateSetHash`
- nonce replay protection is onchain
- exact approve goes to one spender only: the secure v2.1 router address
- older insecure spender addresses must be revoked before migrating

## JIT v2.1 contract

- exactly 3 candidates
- signed-order authorization
- candidate-set hash binding
- best-of-3 selection by realized output
- tie-break by input ordering
- `minOut` / slippage protection enforced onchain
- `maxBlockNumber` expiry
- revert when no candidate satisfies the protection policy
- live path is builder-private only

## Planned MCP dependencies

- `bsc-execution-mcp`
  - `encode_jit_router_call`
  - `simulate_candidate_routes`

## Output contract

Must eventually surface:

- ordered candidate list
- minOut
- maxBlockNumber
- recipient
- encoded JIT payload
- fallback count
- approval spender
