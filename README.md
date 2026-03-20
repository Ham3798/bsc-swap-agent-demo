# BSC Swap Agent Demo

Core-first monorepo for a `swap-execution-planning` agent on top of BNB Chain MCP.

Core goal:

`For a single natural-language token swap request on BSC, show how the skill decides payload, route, submission path, and safety guardrails under price impact and MEV constraints.`

Current milestone:

- `packages/core` contains the planning engine, capability layer, wallet boundary, and submission boundary.
- `apps/web` is now a read-only Next.js planner that consumes the core session API.
- `docs` holds the agent instruction layer and implementation documents.

## Agent entrypoint

Start here if you want to use this project as an agent skill:

`Read ./docs/SKILL.md and plan a BSC swap from natural language`

## What is implemented

- monorepo shape: `apps/web + packages/core + packages/shared + docs`
- session-based swap planning API
- CLI reference client on top of `packages/core`
- typed decision trace as a first-class planning output
- BNB MCP integration for chain and balance capabilities
- live quote candidates through OpenOcean public APIs
- advisory submission-path reasoning for private RPC, builder-aware, and intent handoff paths
- public transaction request builder for browser-wallet handoff
- read-only web planner with wallet connect, follow-up flow, trace view, and raw JSON view
- dry-run only output with markdown summary plus JSON

The current web app is read-only on purpose. Actual sign/send and execution handoff are deferred to the next stage.

## Required environment

This stage does not allow fallback paths.

- `GEMINI_API_KEY`
- `DEMO_WALLET_ADDRESS`
- `BSC_RPC_URL` for mainnet planning
- `BSC_TESTNET_RPC_URL` for testnet planning

Optional:

- `GEMINI_MODEL`
- `BNB_MCP_DIR`
- `BNB_MCP_COMMAND`
- `BNB_MCP_ARGS`

## Run

```bash
bun install
export GEMINI_API_KEY=...
export DEMO_WALLET_ADDRESS=0xYourAddress
export BSC_RPC_URL=https://...
bun run start -- "Swap 100 USDT to BNB with low MEV risk"
bun run web:dev
```

For the missing-amount follow-up flow:

```bash
bun run start -- "Swap USDT to BNB with low MEV risk"
```

The runtime now fails fast if Gemini intent extraction or direct RPC simulation cannot be performed.

## MCP dependency

By default the demo starts the local `bnbchain-mcp` server from:

`/Users/ham-yunsig/Documents/bnb/bnbchain-mcp`

Override with:

- `BNB_MCP_DIR`
- `BNB_MCP_COMMAND`
- `BNB_MCP_ARGS`

## Read in this order

1. [`docs/SKILL.md`](./docs/SKILL.md)
2. [`docs/SPEC.md`](./docs/SPEC.md)
3. [`docs/CHECKLIST.md`](./docs/CHECKLIST.md)
4. [`docs/PROMPT_CONTRACT.md`](./docs/PROMPT_CONTRACT.md)

## Repo shape

- [`apps/web`](./apps/web)
- [`packages/core`](./packages/core)
- [`packages/shared`](./packages/shared)
- [`docs`](./docs)
