import { config as loadEnv } from "dotenv"

import { broadcastPrivateRawTransaction } from "../submission/private-execution"

loadEnv()

async function main() {
  const args = process.argv.slice(2)
  const rawTransaction = args.find((arg) => !arg.startsWith("--"))
  const channel = readFlag(args, "--channel") as "validator" | "builder" | "both" | undefined
  const maxEndpoints = Number(readFlag(args, "--max-endpoints") ?? "3")
  const network = (readFlag(args, "--network") as "bsc" | "bsc-testnet" | undefined) ?? "bsc"

  if (!rawTransaction) {
    throw new Error("Usage: bun packages/core/src/cli/submit-private.ts <rawTx> [--channel validator|builder|both] [--max-endpoints 3] [--network bsc]")
  }

  const results = await broadcastPrivateRawTransaction({
    rawTransaction,
    network,
    channel,
    maxEndpoints: Number.isFinite(maxEndpoints) ? maxEndpoints : 3
  })

  const accepted = results.filter((result) => result.accepted)
  console.log(`network  ${network}`)
  console.log(`channel  ${channel ?? "both"}`)
  console.log(`targets  ${results.length}`)
  console.log("")

  for (const result of results) {
    const status = result.accepted ? "accepted" : "rejected"
    const detail = result.accepted ? result.txHash : result.error
    console.log(
      `${result.displayName.padEnd(28)} ${result.type.padEnd(18)} ${status.padEnd(8)} latency=${String(result.latencyMs).padStart(4)}ms ${detail ?? "-"}`
    )
  }

  console.log("")
  console.log(`accepted ${accepted.length}/${results.length}`)
  if (accepted.length > 0) {
    console.log(`txHash   ${accepted[0].txHash}`)
  }
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
