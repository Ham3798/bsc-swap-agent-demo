# BSC Swap Agent Demo

Minimal MVP for a `swap-execution-planning` agent demo on top of BNB Chain MCP.

Core goal:

`For a single natural-language token swap request on BSC, show how the skill decides payload, route, submission path, and safety guardrails under price impact and MEV constraints.`

Primary demo prompt:

`Swap 100 USDT to BNB with low MEV risk`

## Agent entrypoint

Start here if you want to use this project as an agent skill:

`Read ./SKILL.md and plan a BSC swap from natural language`

## What is implemented

- CLI chat for one swap-planning flow
- single `swap-execution-planning` skill
- BNB MCP integration for chain and balance capabilities
- live quote candidates through OpenOcean public APIs
- advisory submission-path reasoning for private RPC and builder-aware paths
- dry-run only output with markdown summary plus JSON

This repo is the root project for the current planning demo and the future web chatbot demo.

## Run

```bash
bun install
bun run start -- "Swap 100 USDT to BNB with low MEV risk"
```

If you want the follow-up loop to use balance context, set:

```bash
export DEMO_WALLET_ADDRESS=0xYourAddress
```

If `OPENAI_API_KEY` is present, intent extraction will first try an LLM. Otherwise it falls back to a local rule-based parser.

## MCP dependency

By default the demo starts the local `bnbchain-mcp` server from:

`/Users/ham-yunsig/Documents/bnb/bnbchain-mcp`

Override with:

- `BNB_MCP_DIR`
- `BNB_MCP_COMMAND`
- `BNB_MCP_ARGS`

## Read in this order

1. [`SKILL.md`](./SKILL.md)
2. [`SPEC.md`](./SPEC.md)
3. [`CHECKLIST.md`](./CHECKLIST.md)
4. [`PROMPT_CONTRACT.md`](./PROMPT_CONTRACT.md)
