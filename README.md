# BSC Swap Agent Demo

Core-first monorepo for a BSC swap execution stack with planning, private execution, audit, and JIT routing primitives.

Core goal:

`For a single natural-language token swap request on BSC, show how the skill chooses the best execution package: payload, route family, submission channel, delegation boundary, and safety guardrails.`

Current milestone:

- `packages/core` contains the planning engine, capability layer, wallet boundary, and submission boundary.
- `packages/execution-mcp` exposes execution ops and audit as MCP tools.
- `apps/web` is now a read-only Next.js planner that consumes the core session API.
- `docs` holds the skill catalog and implementation documents.

## Agent entrypoint

Start here if you want to use this project as agent skills:

`Read ./docs/SKILL.md and choose the planning, execution, or audit skill that matches the task`

## What is implemented

- monorepo shape: `apps/web + packages/core + packages/shared + docs`
- session-based swap planning API
- CLI reference client on top of `packages/core`
- typed decision trace as a first-class planning output
- execution-package modeling across self-executed and delegated paths
- BNB MCP integration for chain and balance capabilities
- native and modeled quote discovery across multiple execution sources
- native aggregator paths for `OpenOcean`, `ParaSwap`, `1inch(env)`, and `0x/Matcha(env)`
- native direct venue paths for `PancakeSwap`, `Thena`, and `WOOFi`
- natural-language token alias normalization for obvious BSC protocol-token phrases such as `Pancake swap token -> CAKE`
- provider-universe and quote-confidence reporting with `bestObservedQuoteConfidence`
- private builder-broadcast execution as the default live swap path
- secure JIT v2.1 best-of-3 live router with signed-order authorization and exact-approve lifecycle for ERC-20 sells
- public transaction request builder for dry-run and fallback visibility
- private raw transaction submission to registry-backed validator RPC and builder relay endpoints
- execution audit CLI for receipt, gas, latency, and realized output
- JIT router contracts with Foundry tests (`v1` debug-only, `v2` live path)
- read-only web planner with wallet connect, follow-up flow, trace view, raw JSON view, and replay fixtures
- dry-run only output with markdown summary plus JSON

The current web app is still planning-first on purpose. The CLI can now sign with `PRIVATE_KEY`, broadcast to builder relays, and audit the result in one run.

## Replay mode

When Gemini quota is unavailable, the web app can replay fixed demo plans:

- `Replay: self-executed winner`
- `Replay: delegated winner`

These modes exist to rehearse the talk without relying on live LLM quota.

## Required environment

Minimum for the one-command mainnet demo:

- `GEMINI_API_KEY`
- `PRIVATE_KEY`
- `DEMO_WALLET_ADDRESS`
- `BSC_RPC_URL`
- `JIT_ROUTER_BSC_ADDRESS`

Recommended defaults:

- `DEMO_NETWORK=bsc`
- `PRIVATE_SUBMIT_MAX_ENDPOINTS=3`
- `BSC_MEV_INFO_DIR`

Optional:

- `GEMINI_MODEL`
- `ZEROX_API_KEY`
- `ONEINCH_API_KEY`
- `NEXT_ALLOWED_DEV_ORIGINS`
- `BNB_MCP_DIR`
- `BNB_MCP_COMMAND`
- `BNB_MCP_ARGS`
- `BSC_EXECUTION_MCP_COMMAND`
- `BSC_EXECUTION_MCP_ARGS`
- `BSC_TESTNET_RPC_URL`
## Run

```bash
bun install
export GEMINI_API_KEY=...
export PRIVATE_KEY=0x...
export DEMO_WALLET_ADDRESS=0xYourAddress
export BSC_RPC_URL=https://...
bun run start -- "Swap 100 USDT to BNB with low MEV risk"
bun run start --dry-run "Swap 100 USDT to BNB"
bun run web:dev
bun run mcp:execution
bun run diagnose:quotes BNB USDT 0.001
```

For LAN browser access during local development:

```bash
export NEXT_ALLOWED_DEV_ORIGINS=172.26.161.60:3000
```

The web demo expects the current LAN origin to be allowed by Next dev. If it is blocked, `/_next/*` assets can fail to load and the browser may show a generic client-side application error.

For the missing-amount follow-up flow:

```bash
bun run start -- "Swap USDT to BNB with low MEV risk"
```

The runtime now fails fast if Gemini intent extraction or direct RPC simulation cannot be performed.
Obvious protocol-token aliases are auto-resolved, and ambiguous token phrases now trigger a clarifying follow-up instead of a blind selection.

Live CLI behavior:

- default `bun run start -- "<swap request>"` signs with `.env` `PRIVATE_KEY`
- if the sell token is ERC-20 and allowance is insufficient, submits an exact approve to `JIT_ROUTER_BSC_ADDRESS` first
- builds a secure JIT v2.1 best-of-3 swap payload and broadcasts to top builder relays from `bsc-mev-info`
- audits approve + swap inclusion and realized output
- use `--dry-run` or `--no-submit` to stop after planning/simulation

## Demo verification

1. Start `bun run web:dev`
2. Open the LAN URL shown by Next.js
3. Confirm there is no `/_next/*` blocked-origin warning
4. Confirm the page renders normally before sending
5. Click `Send to planner`
6. On success, the live trace should progress through `What I understood / compared / recommend`
7. On failure, the UI should show a planner error bubble instead of a generic browser crash

## MCP dependency

By default the planner starts the local `bnbchain-mcp` server from:

`/Users/ham-yunsig/Documents/bnb/bnbchain-mcp`

Override with:

- `BNB_MCP_DIR`
- `BNB_MCP_COMMAND`
- `BNB_MCP_ARGS`

Execution ops and audit are exposed through the local `bsc-execution-mcp` package:

```bash
bun run mcp:execution
```

Secure JIT router status:

- the repo keeps a single live router contract: `JitSwapRouterV21`
- current BSC mainnet deployment: `0x42cC92A38d28742a43BA0DdE21317803145328FD`
- set `JIT_ROUTER_BSC_ADDRESS` to the deployed secure v2.1 address before live execution
- old insecure spender addresses must not be used for future approvals
- if you previously approved `0x84361F416ae89435fe857Ce6220545317244CECA` or `0x373F33cb87196f58bE01d10E2A998019Ac00C23B`, revoke those approvals before using the new router
- modeled routes are excluded from the live JIT set

Planner runs can auto-connect to this MCP server over stdio. Override the launch command with:

- `BSC_EXECUTION_MCP_COMMAND`
- `BSC_EXECUTION_MCP_ARGS`

## Read in this order

1. [`docs/SKILL.md`](./docs/SKILL.md)
2. [`docs/SPEC.md`](./docs/SPEC.md)
3. [`docs/CHECKLIST.md`](./docs/CHECKLIST.md)
4. [`docs/PROMPT_CONTRACT.md`](./docs/PROMPT_CONTRACT.md)

## Repo shape

- [`apps/web`](./apps/web)
- [`packages/core`](./packages/core)
- [`packages/execution-mcp`](./packages/execution-mcp)
- [`packages/shared`](./packages/shared)
- [`docs`](./docs)
