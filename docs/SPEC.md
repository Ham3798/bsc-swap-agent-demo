# SPEC

## Goal

Turn the repo from a single `swap-execution-planning` demo into a small execution stack with:

- `bnbchain-mcp` for chain reads
- `bsc-execution-mcp` for execution ops and audit
- multiple skill contracts for planning, private execution, audit, gasless, and JIT routing

## Current runtime split

### Planning path

- natural-language swap planning
- quote observation
- payload construction
- simulation
- guardrails
- public wallet handoff contract

### Execution ops path

- signed raw private submission
- multi-builder raw broadcast
- endpoint probing

### Audit path

- receipt status
- gas
- latency
- realized output

## Non-goals for this stage

- moving signing into the planner
- making gasless live before sponsor policy exists
- hiding trust boundaries between planner and execution ops

## MCP layers

### `bnbchain-mcp`

Read-focused chain capability layer:

- `get_chain_info`
- `get_native_balance`
- `get_erc20_balance`
- `get_erc20_token_info`
- `estimate_gas`
- optional:
  - `get_transaction_receipt`
  - `get_logs`
  - `read_contract`
  - `is_contract`

### `bsc-execution-mcp`

Execution-focused capability layer:

- `get_private_endpoint_registry`
- `probe_private_endpoint`
- `private_rpc_submit_raw`
- `multi_builder_broadcast_raw`
- `audit_swap_execution`
- `simulate_candidate_routes`

Later additions:

- `sponsor_policy_check`
- `build_bundle`
- `quote_bundle_price`
- `submit_bundle`
- `encode_jit_router_call`

## Skill catalog

### `swap-execution-planning`

- natural-language planning
- route and payload comparison
- guardrails
- readiness and handoff contract

### `private-execution-ops`

- signed raw tx submission to private endpoints
- multi-builder broadcast

### `swap-execution-audit`

- receipt and realized execution report

### `gasless-bundle-execution`

- sponsor policy and bundle flow
- interface-first in this stage

### `jit-routing`

- JIT router payload and fallback ordering
- contract primitive exists
- planner integration pending

## Status by capability

- planning path: live
- private raw submission: implemented outside planner
- execution audit: implemented outside planner
- gasless / bundle: not implemented
- JIT router contract: implemented
- JIT planner integration: pending

## Runtime policy

- planner CLI and web path stay planning-first
- planner surfaces execution capability discovery separately from actual in-run usage
- only `simulate_candidate_routes` is eligible for in-planner MCP usage today
- private submission starts only after a signed raw tx exists
- audit starts only after a tx hash exists
- gasless and JIT become planner payload families only after their execution contracts are live

## Success criterion

A viewer should be able to see:

1. how the planner chose a route and execution contract
2. how private execution is handled outside signing
3. how execution results are audited after the fact
4. where gasless and JIT fit in the future stack
