import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { config as loadEnv } from "dotenv"

import { BnbCapabilityRegistry } from "../capabilities/registry"
import { formatPlan } from "../format/output"
import { finalizePlan, streamPlanningContinuation, streamPlanningSession } from "../session/store"

loadEnv()

async function main() {
  const rawInput = process.argv.slice(2).join(" ")
  const rl = readline.createInterface({ input, output })
  const registry = new BnbCapabilityRegistry()

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY. Gemini intent extraction is required.")
    }
    if (!process.env.DEMO_WALLET_ADDRESS) {
      throw new Error("Missing DEMO_WALLET_ADDRESS. Account-aware RPC simulation is required.")
    }
    if (!process.env.BSC_RPC_URL && ((process.env.DEMO_NETWORK as "bsc" | "bsc-testnet" | undefined) ?? "bsc") === "bsc") {
      throw new Error("Missing BSC_RPC_URL. Direct RPC simulation is required.")
    }

    const initialPrompt = rawInput || (await rl.question("User: "))
    const sessionId = crypto.randomUUID()
    let stream = streamPlanningSession({
      sessionId,
      message: initialPrompt,
      network: (process.env.DEMO_NETWORK as "bsc" | "bsc-testnet") || "bsc",
      walletAddress: process.env.DEMO_WALLET_ADDRESS || undefined,
      registry
    })

    while (true) {
      let followUpQuestion: string | null = null
      for await (const event of stream) {
        if (event.kind === "reasoning" && event.data?.reasoningSource === "llm") {
          console.log(`[${event.stage}] llm-summary: ${event.message}`)
        } else if (event.kind === "reasoning") {
          console.log(`[${event.stage}] reasoning: ${event.message}`)
        } else {
          console.log(`[${event.stage}] ${event.kind}: ${event.message}`)
        }
        if (event.kind === "follow-up-required") {
          followUpQuestion = event.data?.question ?? event.message
        }
      }

      if (!followUpQuestion) {
        break
      }

      console.log(`\nAssistant:\n${followUpQuestion}\n`)
      const answer = await rl.question("User: ")
      stream = streamPlanningContinuation({
        sessionId,
        answer,
        registry
      })
    }

    const result = finalizePlan(sessionId)
    console.log(`\nAssistant:\n${formatPlan(result)}\n`)
  } finally {
    await registry.close()
    rl.close()
  }
}

void main()
