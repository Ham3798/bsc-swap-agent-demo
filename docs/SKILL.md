# BSC Swap Skills Catalog

This repo now has a small skill catalog instead of a single planner-only skill.

## Skills

### `swap-execution-planning`

Use this skill for:

- natural-language swap intent parsing
- quote observation across direct and aggregator paths
- payload construction
- dry-run simulation
- guardrails
- execution readiness and handoff contracts

This skill is still planning-first.
It does not sign or broadcast transactions itself.

See: [`./skills/swap-execution-planning.md`](./skills/swap-execution-planning.md)

### `private-execution-ops`

Use this skill for:

- signed raw transaction submission to private validator RPC endpoints
- multi-builder raw transaction broadcast
- endpoint registry lookup and endpoint probing

This skill operates after signing.

See: [`./skills/private-execution-ops.md`](./skills/private-execution-ops.md)

### `swap-execution-audit`

Use this skill for:

- receipt lookup
- inclusion latency
- realized output
- expected vs realized execution report

This skill operates after a transaction hash exists.

See: [`./skills/swap-execution-audit.md`](./skills/swap-execution-audit.md)

### `gasless-bundle-execution`

Use this skill for:

- sponsor policy
- bundle composition
- zero-gas execution path design

Current state: interface-first, not fully implemented.

See: [`./skills/gasless-bundle-execution.md`](./skills/gasless-bundle-execution.md)

### `jit-routing`

Use this skill for:

- JIT router payload preparation
- candidate fallback ordering
- contract-backed execution fallback

Current state: contract primitive exists, planner integration is pending.

See: [`./skills/jit-routing.md`](./skills/jit-routing.md)

## MCP split

This repo now assumes two MCP layers:

- `bnbchain-mcp`
  - chain reads, token/balance/gas, receipt/log reads
- `bsc-execution-mcp`
  - private execution ops
  - execution audit
  - route simulation helpers
  - later bundle / sponsor / JIT execution helpers

## Runtime policy

- planner CLI / web path uses `swap-execution-planning`
- signed raw tx ops use `private-execution-ops`
- tx hash analysis uses `swap-execution-audit`
- gasless and JIT remain capability surfaces until planner integration is completed
