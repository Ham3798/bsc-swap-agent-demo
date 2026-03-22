import { config as loadEnv } from "dotenv"

import { auditExecution } from "../submission/private-execution"

loadEnv()

async function main() {
  const args = process.argv.slice(2)
  const txHash = args.find((arg) => !arg.startsWith("--")) as `0x${string}` | undefined
  const network = (readFlag(args, "--network") as "bsc" | "bsc-testnet" | undefined) ?? "bsc"
  const buyTokenAddress = readFlag(args, "--buy-token") as `0x${string}` | undefined
  const recipient = readFlag(args, "--recipient") as `0x${string}` | undefined
  const expectedOut = readFlag(args, "--expected-out")
  const submittedAt = readFlag(args, "--submitted-at")
  const executionPath = readFlag(args, "--path") as
    | "public-mempool"
    | "private-rpc"
    | "builder-aware-broadcast"
    | "unknown"
    | undefined

  if (!txHash) {
    throw new Error("Usage: bun packages/core/src/cli/audit-execution.ts <txHash> [--buy-token 0x..] [--recipient 0x..] [--expected-out raw] [--submitted-at ISO] [--path public-mempool|private-rpc|builder-aware-broadcast]")
  }

  const audit = await auditExecution({
    network,
    txHash,
    buyTokenAddress,
    recipient,
    expectedOut,
    submittedAt,
    executionPath
  })

  console.log(`network   ${network}`)
  console.log(`txHash    ${audit.txHash}`)
  console.log(`status    ${audit.status}`)
  console.log(`path      ${audit.executionPath ?? "unknown"}`)
  if (audit.blockNumber != null) console.log(`block     ${audit.blockNumber}`)
  if (audit.gasUsed != null) console.log(`gasUsed   ${audit.gasUsed}`)
  if (audit.effectiveGasPrice != null) console.log(`gasPrice  ${audit.effectiveGasPrice}`)
  if (audit.inclusionLatencyMs != null) console.log(`latency   ${audit.inclusionLatencyMs}ms`)
  if (audit.expectedOut) console.log(`expected  ${audit.expectedOut}`)
  if (audit.realizedOut) console.log(`realized  ${audit.realizedOut}`)
  if (audit.realizedDelta) console.log(`delta     ${audit.realizedDelta}`)
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
