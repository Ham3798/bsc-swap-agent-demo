# swap-execution-audit

Use this skill after a transaction hash exists.

## What it does

- fetch execution receipt state
- report gas used and effective gas price
- measure inclusion latency when submission time is known
- derive realized output when token and recipient are known
- compare expected output vs realized output

## Inputs

- network
- tx hash
- optional buy token address
- optional recipient
- optional expected output
- optional submitted timestamp
- optional execution path label

## MCP dependencies

- `bnbchain-mcp`
  - receipt/log read support
- `bsc-execution-mcp`
  - `audit_swap_execution`

## Output contract

Must return:

- status
- block number
- gas used
- effective gas price
- inclusion latency
- realized output
- realized delta
- execution path label

## Guardrails

- do not invent realized output if token/recipient context is missing
- treat `not-found` and `pending` distinctly
