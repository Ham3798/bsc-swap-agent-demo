import { config as loadEnv } from "dotenv"

import { BnbCapabilityRegistry } from "../capabilities/registry"

loadEnv()

async function main() {
  const args = process.argv.slice(2)
  const [sellToken = "BNB", buyToken = "USDT", amount = "0.001"] = args.filter(
    (arg) => !arg.startsWith("--")
  )
  const network = ((process.env.DEMO_NETWORK as "bsc" | "bsc-testnet" | undefined) ?? "bsc")
  const registry = new BnbCapabilityRegistry()

  try {
    const sell = await registry.chain.resolveToken(sellToken, network)
    const buy = await registry.chain.resolveToken(buyToken, network)

    if (!sell || !buy) {
      throw new Error(`Could not resolve tokens: sell=${sellToken}, buy=${buyToken}`)
    }

    const quoteResult = registry.quote.getQuoteCandidatesWithAudit
      ? await registry.quote.getQuoteCandidatesWithAudit({
          network,
          sellToken: sell,
          buyToken: buy,
          amount,
          amountRaw: parseAmountToRaw(amount, sell.decimals),
          slippageBps: 50
        })
      : {
        candidates: await registry.quote.getQuoteCandidates({
          network,
          sellToken: sell,
          buyToken: buy,
          amount,
          amountRaw: parseAmountToRaw(amount, sell.decimals),
          slippageBps: 50
        }),
          audit: [],
          observedAt: new Date().toISOString()
        }

    console.log(`network  ${network}`)
    console.log(`pair     ${sell.symbol} -> ${buy.symbol}`)
    console.log(`amount   ${amount}`)
    console.log(`observed ${quoteResult.observedAt}`)
    console.log("")

    for (const entry of quoteResult.audit) {
      console.log(
        `${entry.providerId.padEnd(12)} ${entry.mode.padEnd(7)} ${entry.status.padEnd(11)} reason=${entry.reason ?? "-"} raw=${entry.rawReason ?? "-"} quotes=${entry.quoteCount}`
      )
    }

    if (quoteResult.candidates.length) {
      console.log("")
      console.log("candidates")
      for (const candidate of quoteResult.candidates) {
        console.log(
          `- ${candidate.id} ${candidate.quotedOutFormatted} family=${candidate.routeFamily} source=${candidate.quoteSource} native=${candidate.providerNative}`
        )
      }
    }
  } finally {
    await registry.close()
  }
}

void main()

function parseAmountToRaw(amount: string, decimals: number): string {
  const [wholePart, fractionalPart = ""] = amount.trim().split(".")
  const normalizedWhole = wholePart === "" ? "0" : wholePart
  const normalizedFraction = fractionalPart.replace(/[^0-9]/g, "").slice(0, decimals).padEnd(decimals, "0")
  return `${normalizedWhole}${normalizedFraction}`.replace(/^0+(?=\d)/, "") || "0"
}
