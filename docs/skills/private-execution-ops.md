# private-execution-ops

Use this skill after a signed raw transaction already exists.

## What it does

- read private validator and builder endpoint registry
- probe endpoint reachability and likely raw-send semantics
- submit a signed raw transaction to one private validator RPC
- broadcast a signed raw transaction to multiple builder relays
- return endpoint-by-endpoint accept/reject and latency

## Inputs

- network
- signed raw transaction
- channel policy
  - validator
  - builder
  - both
- optional endpoint ids

## MCP dependencies

- `bsc-execution-mcp`
  - `get_private_endpoint_registry`
  - `probe_private_endpoint`
  - `private_rpc_submit_raw`
  - `multi_builder_broadcast_raw`

## Output contract

Must return:

- endpoint id
- endpoint type
- accepted or rejected
- latency
- tx hash if accepted
- normalized error if rejected

## Guardrails

- never sign
- never mutate transaction fields
- never claim builder privacy guarantees beyond observed endpoint behavior
